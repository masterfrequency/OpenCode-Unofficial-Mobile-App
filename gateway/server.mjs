import http from 'node:http'
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const listenHost = process.env.GATEWAY_HOST || '127.0.0.1'
const listenPort = Number(process.env.GATEWAY_PORT || 4174)
const upstream = new URL(process.env.OPENCODE_URL || 'http://127.0.0.1:4096')
const token = process.env.OPENCODE_REMOTE_TOKEN
const pairingTtlMinutes = Number(process.env.PAIRING_TTL_MINUTES || 60)
const pairingCodeFile = process.env.PAIRING_CODE_FILE ? resolve(process.env.PAIRING_CODE_FILE) : new URL('.pairing-code', import.meta.url)
const deviceStoreFile = process.env.DEVICE_STORE_FILE ? resolve(process.env.DEVICE_STORE_FILE) : fileURLToPath(new URL('.devices.json', import.meta.url))
const maxPairedDevices = Number(process.env.MAX_PAIRED_DEVICES || 20)
const authFailures = new Map()
const pairFailures = new Map()
const pairingCode = String(randomInt(100000, 1000000))
const pairingExpiresAt = Date.now() + pairingTtlMinutes * 60_000
let pairingClaimed = false
let pairingInProgress = false
let deviceStore = loadDeviceStore()
const lastSeenWrites = new Map()
const startedAt = new Date().toISOString()
const opencodeVersion = commandVersion('opencode')
const tailscaleVersion = commandVersion('tailscale')

if (!token || token.length < 32) throw new Error('OPENCODE_REMOTE_TOKEN must contain at least 32 characters')
if (!Number.isFinite(pairingTtlMinutes) || pairingTtlMinutes < 5 || pairingTtlMinutes > 1440) throw new Error('PAIRING_TTL_MINUTES must be between 5 and 1440')
if (!Number.isInteger(maxPairedDevices) || maxPairedDevices < 1 || maxPairedDevices > 100) throw new Error('MAX_PAIRED_DEVICES must be between 1 and 100')
if (!['127.0.0.1', '::1', 'localhost'].includes(listenHost) && process.env.ALLOW_NON_LOOPBACK_GATEWAY !== 'true') {
  throw new Error('Refusing non-loopback GATEWAY_HOST. Containers must explicitly set ALLOW_NON_LOOPBACK_GATEWAY=true and provide network isolation.')
}

function safeEqual(left, right) {
  const expected = Buffer.from(String(left || ''))
  const actual = Buffer.from(String(right || ''))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function tokenHash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function authenticate(request) {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') || ''
  if (safeEqual(token, supplied)) return { type: 'bootstrap', role: 'owner', device: null }
  if (!supplied) return null
  const suppliedHash = tokenHash(supplied)
  const device = deviceStore.devices.find((item) => safeEqual(item.tokenHash, suppliedHash))
  if (!device) return null
  touchDevice(device)
  return { type: 'device', role: device.role, device }
}

function loadDeviceStore() {
  if (!existsSync(deviceStoreFile)) return { version: 1, devices: [] }
  const parsed = JSON.parse(readFileSync(deviceStoreFile, 'utf8'))
  if (parsed?.version !== 1 || !Array.isArray(parsed.devices)) throw new Error('DEVICE_STORE_FILE has an unsupported or invalid format')
  for (const device of parsed.devices) {
    if (!device.id || !device.tokenHash || !['owner', 'member'].includes(device.role)) throw new Error('DEVICE_STORE_FILE contains an invalid device')
  }
  return parsed
}

function saveDeviceStore() {
  const temporary = `${deviceStoreFile}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(deviceStore, null, 2) + '\n', { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, deviceStoreFile)
  chmodSync(deviceStoreFile, 0o600)
}

function touchDevice(device) {
  const now = Date.now()
  device.lastSeenAt = new Date(now).toISOString()
  const previous = lastSeenWrites.get(device.id) || 0
  if (now - previous < 60_000) return
  lastSeenWrites.set(device.id, now)
  try { saveDeviceStore() } catch (error) { console.error(`Could not update device activity: ${error.message}`) }
}

function publicDevice(device) {
  return { id: device.id, name: device.name, role: device.role, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt || null }
}

function commandVersion(command) {
  try { return execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0].slice(0, 120) }
  catch (_) { return null }
}

function authRateLimited(request) {
  const key = request.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const recent = (authFailures.get(key) || []).filter((time) => now - time < 60_000)
  authFailures.set(key, recent)
  return recent.length >= 30
}

function recordAuthFailure(request) {
  const key = request.socket.remoteAddress || 'unknown'
  const recent = authFailures.get(key) || []
  recent.push(Date.now())
  authFailures.set(key, recent)
}

function pairRateLimited(request, failed = false) {
  const key = request.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const recent = (pairFailures.get(key) || []).filter((time) => now - time < 60_000)
  if (failed) recent.push(now)
  pairFailures.set(key, recent)
  return recent.length >= 8
}

function codeMatches(supplied) {
  const expected = Buffer.from(pairingCode)
  const actual = Buffer.from(String(supplied || ''))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

const server = http.createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Cache-Control', 'no-store')
  if (request.method === 'OPTIONS') return response.writeHead(204).end()

  if (request.method === 'POST' && request.url === '/pair') {
    if (pairRateLimited(request)) return response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' }).end('{"error":"too many pairing attempts"}')
    if (pairingClaimed || Date.now() > pairingExpiresAt) return response.writeHead(410, { 'Content-Type': 'application/json' }).end('{"error":"pairing code expired or was already used; restart the gateway for a new code"}')
    if (pairingInProgress) return response.writeHead(409, { 'Content-Type': 'application/json' }).end('{"error":"another pairing request is in progress"}')
    pairingInProgress = true
    try {
      const payload = await readJson(request)
      if (!codeMatches(payload.code)) {
        pairRateLimited(request, true)
        return response.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"incorrect pairing code"}')
      }
      if (deviceStore.devices.length >= maxPairedDevices) throw new Error(`Maximum of ${maxPairedDevices} paired devices reached`)
      const deviceToken = randomBytes(32).toString('hex')
      const device = {
        id: randomBytes(12).toString('hex'),
        name: String(payload.deviceName || 'Android device').trim().slice(0, 80) || 'Android device',
        role: deviceStore.devices.some((item) => item.role === 'owner') ? 'member' : 'owner',
        tokenHash: tokenHash(deviceToken),
        createdAt: new Date().toISOString(),
        lastSeenAt: null,
      }
      deviceStore.devices.push(device)
      try { saveDeviceStore() }
      catch (error) { deviceStore.devices.pop(); throw new Error(`could not save device credential: ${error.message}`) }
      pairingClaimed = true
      return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ token: deviceToken, device: publicDevice(device) }))
    } catch (error) {
      return response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }))
    } finally { pairingInProgress = false }
  }

  if (authRateLimited(request)) return response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' }).end('{"error":"too many authentication failures"}')
  const principal = authenticate(request)
  if (!principal) { recordAuthFailure(request); return response.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"unauthorized"}') }

  if (request.method === 'GET' && request.url === '/gateway/devices') {
    if (principal.role !== 'owner') return response.writeHead(403, { 'Content-Type': 'application/json' }).end('{"error":"only an owner device can manage paired devices"}')
    return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      currentDeviceID: principal.device?.id || null,
      authentication: principal.type,
      devices: deviceStore.devices.map(publicDevice),
    }))
  }

  const deviceRoute = new URL(request.url, 'http://gateway.local').pathname.match(/^\/gateway\/devices\/([a-f0-9]{24})$/)
  if (request.method === 'PATCH' && deviceRoute) {
    if (principal.role !== 'owner') return response.writeHead(403, { 'Content-Type': 'application/json' }).end('{"error":"only an owner device can transfer ownership"}')
    try {
      const payload = await readJson(request)
      if (payload.role !== 'owner') throw new Error('role must be owner')
      const device = deviceStore.devices.find((item) => item.id === deviceRoute[1])
      if (!device) return response.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"device not found"}')
      const previousRole = device.role
      device.role = 'owner'
      try { saveDeviceStore() } catch (error) { device.role = previousRole; throw error }
      return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ device: publicDevice(device) }))
    } catch (error) {
      return response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }))
    }
  }
  if (request.method === 'DELETE' && deviceRoute) {
    if (principal.role !== 'owner') return response.writeHead(403, { 'Content-Type': 'application/json' }).end('{"error":"only an owner device can revoke paired devices"}')
    const deviceID = deviceRoute[1]
    if (principal.device?.id === deviceID) return response.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"this device cannot revoke itself"}')
    const index = deviceStore.devices.findIndex((item) => item.id === deviceID)
    if (index < 0) return response.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"device not found"}')
    const [removed] = deviceStore.devices.splice(index, 1)
    try { saveDeviceStore() }
    catch (error) {
      deviceStore.devices.splice(index, 0, removed)
      return response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: `could not update device store: ${error.message}` }))
    }
    return response.writeHead(204).end()
  }

  if (request.url === '/health') {
    const check = http.get(new URL('/session', upstream), (upstreamResponse) => {
      upstreamResponse.resume()
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ gateway: true, authenticated: true, opencode: upstreamResponse.statusCode < 500, upstreamStatus: upstreamResponse.statusCode, gatewayVersion: '1.0.0', opencodeVersion, tailscaleVersion, startedAt, pairedDeviceCount: deviceStore.devices.length, authentication: principal.type, role: principal.role, deviceID: principal.device?.id || null }))
    })
    check.on('error', () => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ gateway: true, authenticated: true, opencode: false, gatewayVersion: '1.0.0', opencodeVersion, tailscaleVersion, startedAt, pairedDeviceCount: deviceStore.devices.length, authentication: principal.type, role: principal.role, deviceID: principal.device?.id || null })))
    return
  }

  if (request.method === 'POST' && request.url === '/gateway/provider/configure') {
    try {
      const payload = await readJson(request)
      if (!payload.key || typeof payload.key !== 'string') throw new Error('API key is required')
      if (payload.kind === 'openrouter') {
        await upstreamJson('/auth/openrouter', { method: 'PUT', body: { type: 'api', key: payload.key } })
        const catalog = await upstreamJson('/provider')
        const provider = catalog.all?.find((item) => item.id === 'openrouter')
        return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ providerID: 'openrouter', models: Object.keys(provider?.models || {}).length }))
      }

      const providerID = String(payload.providerID || '').replace(/[^a-z0-9_-]/g, '-')
      if (!providerID) throw new Error('Provider ID is required')
      if (!String(payload.baseURL || '').startsWith('https://')) throw new Error('Custom endpoint must use HTTPS')
      const modelResponse = await fetch(new URL('models', payload.baseURL.endsWith('/') ? payload.baseURL : payload.baseURL + '/'), { headers: { Authorization: `Bearer ${payload.key}` } })
      if (!modelResponse.ok) throw new Error(`Model discovery failed with HTTP ${modelResponse.status}`)
      const modelPayload = await modelResponse.json()
      const models = (modelPayload.data || modelPayload.models || []).map((model) => typeof model === 'string' ? model : model.id).filter(Boolean)
      if (!models.length) throw new Error('Endpoint returned no models')
      const configPath = payload.directory ? `/config?directory=${encodeURIComponent(payload.directory)}` : '/config'
      await upstreamJson(configPath, { method: 'PATCH', body: { provider: { [providerID]: { name: payload.name || providerID, npm: '@ai-sdk/openai-compatible', options: { baseURL: payload.baseURL }, models: Object.fromEntries(models.map((id) => [id, { name: id }])) } } } })
      await upstreamJson(`/auth/${encodeURIComponent(providerID)}`, { method: 'PUT', body: { type: 'api', key: payload.key } })
      return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ providerID, models: models.length }))
    } catch (error) {
      return response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }))
    }
  }

  const incoming = new URL(request.url, 'http://gateway.local')
  if (!incoming.pathname.startsWith('/api/')) return response.writeHead(404).end()
  const target = new URL(incoming.pathname.slice(4) + incoming.search, upstream)
  const headers = { ...request.headers, host: upstream.host }
  delete headers.authorization
  delete headers.origin
  delete headers.referer

  const proxy = http.request(target, { method: request.method, headers }, (upstreamResponse) => {
    const outputHeaders = { ...upstreamResponse.headers }
    delete outputHeaders['access-control-allow-origin']
    response.writeHead(upstreamResponse.statusCode || 502, outputHeaders)
    upstreamResponse.pipe(response)
  })
  proxy.on('error', (error) => response.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message })))
  request.pipe(proxy)
})

try {
  writeFileSync(pairingCodeFile, pairingCode + '\n', { mode: 0o600 })
  chmodSync(pairingCodeFile, 0o600)
} catch (error) {
  console.error(`Could not write pairing-code file: ${error.message}`)
}

server.listen(listenPort, listenHost, () => {
  console.log(`OpenCode Remote Gateway 1.0.0 listening on http://${listenHost}:${listenPort}`)
  console.log(`One-time pairing code (valid ${pairingTtlMinutes} minutes): ${pairingCode}`)
})

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > 1_000_000) return reject(new Error('Request body is too large'))
      chunks.push(chunk)
    })
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (_) { reject(new Error('Invalid JSON request')) }
    })
    request.on('error', reject)
  })
}

async function upstreamJson(path, options = {}) {
  const response = await fetch(new URL(path, upstream), {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  if (!response.ok) throw new Error((await response.text()) || `OpenCode returned HTTP ${response.status}`)
  return response.status === 204 ? null : response.json()
}
