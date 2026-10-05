const $ = (selector) => document.querySelector(selector)
const STORE_KEY = 'opencode.remote.profiles.v2'
const LEGACY_KEY = 'opencode.remote.profiles.v1'
const WELCOME_KEY = 'opencode.remote.welcome.v1'
const TOKEN_LENGTH = 32
const vault = window.AndroidVault || null
const SOUND_VOLUME_KEY = 'opencode.remote.soundVolume.v1'
const AUTO_SCROLL_KEY = 'opencode.remote.autoScroll.v1'
const FONT_SIZE_KEY = 'opencode.remote.fontSize.v1'
const DRAFT_KEY = 'opencode.remote.drafts.v1'
const MAX_FILE_BYTES = 8 * 1024 * 1024

let profiles = loadProfiles()
let activeProfile = null
let activeToken = ''
let activeSession = null
let editingId = null
let polling = null
let providers = null
let selectedModel = JSON.parse(localStorage.getItem('opencode.remote.model.v1') || 'null')
let modelFilter = 'free'
let currentScreen = '#connectionsScreen'
let thinkingTimer = null
let lastAssistantText = ''
let responseBaselineText = ''
let waitingForAssistant = false
let focusedPromptText = ''
let pinUntil = 0
let pendingToken = ''
let originalProfileUrl = ''
let typewriter = { key: '', target: '', count: 0, timer: null, lastGrowth: 0 }
let toastTimer = null
let renderedPermission = ''
let sessionBusy = false
let sendGrace = 0
let liveStatus = ''
let eventAbort = null
let eventsLive = false
let eventRetry = 0
let lastEventAt = 0
let refreshTimer = null
let lastRefreshAt = 0
let lastPermCheck = 0
let allSessions = []
let sheetSession = null
let pendingFiles = []
let pendingShare = null
let outbox = []
let offline = false
let draftTimer = null
let lastSessionsLoad = 0
let follow = true
let pendingNew = false
let lastScrollH = 0
let lastMessages = []
let queues = new Map()
let pausedSessions = new Set()
let flushing = false
const FOLLOW_SLACK = 56
const PIN_KEY = 'opencode.remote.pins.v1'
const TAB_INDEX = { '#sessionsScreen': 0, '#projectsScreen': 1, '#modelsScreen': 2 }
const NOTIFY_KEY = 'opencode.remote.notify.v1'
const HAPTIC_KEY = 'opencode.remote.haptics.v1'
const NOTIFY_ASKED_KEY = 'opencode.remote.notify.asked.v1'
const LAST_PROFILE_KEY = 'opencode.remote.lastProfile.v1'
const TODO_OPEN_KEY = 'opencode.remote.todoOpen.v1'
const nativeDevice = window.AndroidDevice || null
let todoSig = ''
let recordedSig = ''
let tokenWarningAt = 0
/* ── Phone integration (haptics, notifications, launcher) ───────────────── */
function prefOn(key) { return localStorage.getItem(key) !== 'off' }
function prefValue(key, fallback) { try { return localStorage.getItem(key) || fallback } catch (_) { return fallback } }
function soundVolume() { return Math.max(0, Math.min(1, Number(prefValue(SOUND_VOLUME_KEY, '10')) / 100)) }
function autoScrollMode() { return prefValue(AUTO_SCROLL_KEY, 'smart') }
function haptic(kind) {
  if (!prefOn(HAPTIC_KEY) || document.visibilityState !== 'visible') return
  try { nativeDevice?.haptic?.(kind) } catch (_) {}
}
function currentTitle() { return $('#chatTitle').textContent || 'Session' }
function watchSession() {
  if (!nativeDevice?.watch || !activeProfile || !activeSession || !prefOn(NOTIFY_KEY)) return
  try {
    if (nativeDevice.notificationsAllowed && !nativeDevice.notificationsAllowed() && !localStorage.getItem(NOTIFY_ASKED_KEY)) {
      localStorage.setItem(NOTIFY_ASKED_KEY, '1')
      nativeDevice.requestNotifications()
    }
    nativeDevice.watch(activeProfile.id, activeSession, currentTitle(), activeProfile.url, activeProfile.directory || '')
  } catch (_) {}
}
function unwatchSession(id) { try { nativeDevice?.unwatch?.(id) } catch (_) {} }
function recordSession(state) {
  if (!nativeDevice?.recordSession || !activeProfile || !activeSession) return
  const sig = `${activeProfile.id}|${activeSession}|${state}|${currentTitle()}`
  if (sig === recordedSig) return
  recordedSig = sig
  try { nativeDevice.recordSession(activeProfile.id, activeSession, currentTitle(), state) } catch (_) {}
}

function playSound(id, volume = 1) {
  const audio = $(id)
  if (!audio) return
  try { audio.pause(); audio.currentTime = 0; audio.volume = Math.max(0, Math.min(1, volume * soundVolume())); audio.play().catch(() => {}) } catch (_) {}
}

function updateViewportInsets() {
  const viewport = window.visualViewport
  const height = viewport ? viewport.height : window.innerHeight
  const root = document.documentElement.style
  root.setProperty('--app-viewport-height', `${Math.round(height)}px`)
  root.setProperty('--keyboard-inset', '0px')
  document.body.classList.toggle('keyboard-visible', height < window.screen.height * .78)
  if (currentScreen === '#chatScreen') requestAnimationFrame(focusLatestUserMessage)
  else keepFocusedFieldVisible()
}
window.updateViewportInsets = updateViewportInsets

function keepFocusedFieldVisible(delay = 0) {
  const field = document.activeElement
  if (!field || !field.matches || !field.matches('input, textarea, select') || field.closest('#chatScreen')) return
  setTimeout(() => { try { field.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch (_) {} }, delay)
}
document.addEventListener('focusin', () => keepFocusedFieldVisible(320))

function assistantText(messages) {
  return messages.filter((entry) => entry.info?.role === 'assistant').flatMap((entry) => (entry.parts || []).filter((part) => part.type === 'text' && part.text).map((part) => part.text)).join('\n')
}

function pinQuestionToTop() { pinUntil = Date.now() + 1800; requestAnimationFrame(focusLatestUserMessage) }

// Runs only right after sending (while the keyboard closes and the layout settles).
// Any touch or scroll by the user cancels it, so it never pulls the view back.
function focusLatestUserMessage() {
  if (Date.now() > pinUntil) return
  const container = $('#messages')
  const users = container?.querySelectorAll(':scope > .message.user:not(.file-message)') || []
  const message = users[users.length - 1]
  if (!container || !message || !focusedPromptText) return
  container.scrollTo({ top: Math.max(0, message.offsetTop - 10), behavior: 'smooth' })
}

function showOptimisticPrompt(text, raw = text, textFiles = []) {
  const container = $('#messages')
  container.classList.add('focus-latest')
  container.querySelectorAll(':scope > .empty, :scope > .skeleton').forEach((node) => node.remove())
  container.dataset.ready = '1'
  const chips = textFiles.map((name) => fileChipHtml(name)).join('')
  container.insertAdjacentHTML('beforeend', `<div class="message user optimistic enter">${text ? `<div class="bubble">${esc(text)}</div>` : ''}${chips}</div>`)
  const node = container.lastElementChild
  node.__text = text
  node.__raw = raw
  pinQuestionToTop()
  return node
}

function syncTabs(index) {
  const bar = $('#tabbar')
  bar.style.setProperty('--tab', index)
  bar.querySelectorAll('button').forEach((button, position) => button.classList.toggle('active', position === index))
}

function show(id) {
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'))
  const screen = $(id)
  screen.classList.add('active')
  // Lists replay their staggered entrance whenever their screen is shown again.
  screen.querySelectorAll('.list').forEach((list) => { list.dataset.anim = '1' })
  currentScreen = id
  document.body.dataset.screen = id.slice(1)
  if (id in TAB_INDEX) syncTabs(TAB_INDEX[id])
  if (id !== '#chatScreen') window.scrollTo(0, 0)
  else requestAnimationFrame(updateComposer)
  syncChatBackground()
}

function syncChatBackground() {
  const video = $('#chatBackground')
  if (!video) return
  const animatedScreens = ['#sessionsScreen', '#projectsScreen', '#modelsScreen', '#settingsScreen', '#chatScreen']
  const onVideoScreen = animatedScreens.includes(currentScreen)
  document.body.dataset.video = onVideoScreen ? '1' : '0'
  const shouldPlay = onVideoScreen && !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (shouldPlay) video.play().catch(() => {})
  else video.pause()
}

function resetTypewriter() {
  clearInterval(typewriter.timer)
  typewriter = { key: '', target: '', count: 0, timer: null, lastGrowth: 0 }
}

function beginTypewriter(key, text) {
  resetTypewriter()
  typewriter.key = key
  typewriter.target = text
  typewriter.lastGrowth = Date.now()
  typewriter.timer = setInterval(tickTypewriter, 24)
}

/* Keep one DOM tree while a long answer is being revealed. Re-parsing all of
   the accumulated Markdown every 24 ms made Android WebView repeatedly repaint
   the large blurred glass layer and animated border, which could flash on long
   responses. Markdown is parsed once, when the response is complete. */
function renderLiveText(bubble, text) {
  if (!bubble.__liveTextNode) {
    const liveText = document.createTextNode('')
    const caret = document.createElement('span')
    caret.className = 'caret'
    caret.setAttribute('aria-hidden', 'true')
    bubble.replaceChildren(liveText, caret)
    bubble.__liveTextNode = liveText
    bubble.__liveRaw = ''
    bubble.classList.add('live-text')
  }
  const previous = bubble.__liveRaw || ''
  if (text.startsWith(previous)) bubble.__liveTextNode.appendData(text.slice(previous.length))
  else bubble.__liveTextNode.data = text
  bubble.__liveRaw = text
}

function finishLiveText(bubble, text) {
  bubble.classList.remove('live-text')
  delete bubble.__liveTextNode
  delete bubble.__liveRaw
  bubble.innerHTML = renderMarkdown(text)
}

function tickTypewriter() {
  const bubble = document.querySelector('[data-typewriter-active="true"]')
  if (!bubble) return
  if (typewriter.count < typewriter.target.length) {
    // Catch up faster when the model is far ahead of the reveal.
    const backlog = typewriter.target.length - typewriter.count
    typewriter.count = Math.min(typewriter.target.length, typewriter.count + Math.max(1, Math.ceil(backlog / 45)))
    renderLiveText(bubble, typewriter.target.slice(0, typewriter.count))
    afterGrowth()
  } else if (Date.now() - typewriter.lastGrowth > 6000) {
    bubble.__live = false
    bubble.__text = typewriter.target
    bubble.classList.remove('live')
    delete bubble.dataset.typewriterActive
    finishLiveText(bubble, typewriter.target)
    resetTypewriter()
    afterGrowth()
  }
}

function updateTypewriter(key, text, start) {
  if (start && typewriter.key !== key) beginTypewriter(key, text)
  if (typewriter.key === key && text !== typewriter.target) {
    typewriter.target = text
    typewriter.lastGrowth = Date.now()
  }
  return typewriter.key === key ? typewriter.target.slice(0, typewriter.count) : text
}

const thinkingNode = document.getElementById('thinking')
const thinkingLabel = document.getElementById('thinkingText')
const THINKING_FALLBACK = ['OpenCode is thinking…', 'Reading project context…', 'Planning the next step…', 'Working on your request…', 'Waiting for the model…']
const TOOL_VERBS = { bash: 'Running', shell: 'Running', read: 'Reading', write: 'Writing', edit: 'Editing', patch: 'Patching', multiedit: 'Editing', grep: 'Searching', glob: 'Searching', list: 'Listing', ls: 'Listing', webfetch: 'Fetching', websearch: 'Searching the web', todowrite: 'Planning', todoread: 'Reviewing plan', task: 'Delegating' }
let fallbackIndex = 0

function placeThinking() {
  const container = $('#messages')
  const node = thinkingNode
  if (!container || !node || node.hidden) return
  if (container.lastElementChild !== node) container.appendChild(node)
}

function updateSendMode() {
  const send = $('#sendButton')
  const hasInput = $('#promptInput').value.trim().length > 0 || pendingFiles.length > 0
  const mode = sessionBusy ? (hasInput ? 'queue' : 'stop') : 'send'
  send.classList.toggle('stop', mode === 'stop')
  send.classList.toggle('queue', mode === 'queue')
  send.setAttribute('aria-label', mode === 'stop' ? 'Stop response' : mode === 'queue' ? 'Add to queue' : 'Send')
  send.querySelector('use').setAttribute('href', mode === 'stop' ? '#i-stop' : '#i-arrow-up')
  $('#promptInput').placeholder = sessionBusy ? 'Queue a message…' : 'Ask OpenCode anything…'
}

function stopThinking() {
  clearInterval(thinkingTimer); thinkingTimer = null
  thinkingNode.hidden = true
  liveStatus = ''
  sessionBusy = false
  updateSendMode()
  $('#chatScreen').classList.remove('responding')
  $('#chatState').textContent = 'CONNECTED'
}

function startThinking() {
  const wasRunning = !!thinkingTimer
  sessionBusy = true
  updateSendMode()
  thinkingNode.hidden = false
  $('#chatScreen').classList.add('responding')
  $('#chatState').textContent = 'WORKING'
  placeThinking()
  if (wasRunning) return
  watchSession(); recordSession('working')
  fallbackIndex = 0
  thinkingLabel.textContent = THINKING_FALLBACK[0]
  announce('OpenCode is working')
  thinkingTimer = setInterval(() => {
    if (liveStatus) return
    fallbackIndex = (fallbackIndex + 1) % THINKING_FALLBACK.length
    thinkingLabel.textContent = THINKING_FALLBACK[fallbackIndex]
  }, 2600)
}

function deriveBusy(messages) {
  const last = messages[messages.length - 1]
  if (!last) return false
  const info = last.info || {}
  if (info.role === 'assistant') return !info.time?.completed && !info.error
  if (info.role === 'user') return Date.now() - (info.time?.created || 0) < 120000
  return false
}

function liveStatusFor(messages) {
  const last = messages[messages.length - 1]
  if (!last || last.info?.role !== 'assistant') return ''
  const parts = last.parts || []
  for (let index = parts.length - 1; index >= Math.max(0, parts.length - 6); index--) {
    const part = parts[index]
    if (part.type === 'tool' && ['running', 'pending'].includes(part.state?.status)) {
      const verb = TOOL_VERBS[String(part.tool || '').toLowerCase()] || `Using ${part.tool || 'tool'}`
      const detail = toolSummary(part)
      return (detail ? `${verb} · ${detail}` : `${verb}…`).slice(0, 64)
    }
    if (part.type === 'reasoning' && !part.time?.end) return 'Reasoning…'
    if (part.type === 'text' && part.text && !part.time?.end) return 'Writing response…'
  }
  return ''
}

function applyBusy(messages) {
  const busy = deriveBusy(messages) || Date.now() < sendGrace
  if (busy) {
    startThinking()
    liveStatus = liveStatusFor(messages)
    if (liveStatus) thinkingLabel.textContent = liveStatus
  } else if (sessionBusy) {
    const finishedSession = activeSession
    stopThinking()
    const lastText = assistantText(messages).split('\n').pop() || ''
    announce(`OpenCode finished. ${lastText.slice(0, 160)}`)
    onTaskFinished(finishedSession, messages)
  }
}

function onTaskFinished(sessionId, messages) {
  const info = messages[messages.length - 1]?.info
  const aborted = info?.error?.name === 'MessageAbortedError'
  recordSession(aborted ? 'idle' : 'done')
  // When hidden, the native watcher owns the alert; when visible there is nothing left to watch.
  if (document.visibilityState === 'visible') unwatchSession(sessionId)
  if (aborted) return
  const queued = (queues.get(sessionId) || []).length && !pausedSessions.has(sessionId)
  if (!queued) haptic(info?.error ? 'error' : 'done')
}

function notify(message) {
  const toast = $('#toast')
  toast.textContent = message
  toast.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200)
}

function vaultAvailable() {
  return vault && ['put', 'read', 'has', 'remove'].every((method) => typeof vault[method] === 'function')
}

function loadProfiles() {
  try {
    const saved = localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_KEY)
    const parsed = saved ? JSON.parse(saved) : []
    return parsed.map((profile) => ({ ...profile, id: profile.id || mintId() }))
  } catch (_) { return [] }
}

function saveProfiles() {
  localStorage.setItem(STORE_KEY, JSON.stringify(profiles.map(({ token, ...profile }) => profile)))
}

function mintId() {
  return 'p_' + Array.from(crypto.getRandomValues(new Uint8Array(8))).map((value) => value.toString(16).padStart(2, '0')).join('')
}

function readToken(profile) {
  if (!profile) return { ok: true, exists: false, value: '', error: null }
  if (!vaultAvailable()) return { ok: false, exists: false, value: '', error: 'secure Android storage is unavailable in this build' }
  try {
    const result = JSON.parse(vault.read(profile.id))
    if (!result || typeof result.ok !== 'boolean') throw new Error('invalid secure-storage response')
    return { ok: result.ok, exists: !!result.exists, value: result.ok ? String(result.value || '') : '', error: result.error || null }
  } catch (error) {
    return { ok: false, exists: false, value: '', error: error.message || 'secure token read failed' }
  }
}

function storeToken(profile, token) {
  if (!vaultAvailable()) return { ok: false, reason: 'secure Android storage is unavailable in this build' }
  const reason = vault.put(profile.id, token)
  if (reason) return { ok: false, reason }
  const verified = readToken(profile)
  return verified.ok && verified.exists && verified.value === token ? { ok: true } : { ok: false, reason: verified.error || 'token could not be verified after saving' }
}

function migrateLegacyTokens() {
  if (!vaultAvailable()) return
  let changed = false
  let failed = false
  profiles.forEach((profile) => {
    if (!profile.token) return
    const current = readToken(profile)
    if (!current.ok || !current.exists || !current.value) {
      const stored = storeToken(profile, profile.token)
      if (!stored.ok) { failed = true; return }
    }
    delete profile.token
    changed = true
  })
  if (changed && !failed) saveProfiles()
  if (failed) notify('A legacy token could not be migrated. Open Edit and enter the token again.')
}

function apiUrl(path) {
  const url = new URL(`/api${path}`, activeProfile.url)
  if (activeProfile.directory) url.searchParams.set('directory', activeProfile.directory)
  return url
}

function request(path, options = {}) {
  if (!activeProfile || !activeToken) throw new Error('Connection profile or access token is missing')
  return fetch(apiUrl(path), {
    ...options,
    headers: { Authorization: `Bearer ${activeToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  }).catch((error) => { error.network = true; setOffline(true); throw error }).then(async (response) => {
    setOffline(false)
    if (!response.ok) {
      const detail = await response.text()
      const error = new Error(response.status === 401
        ? 'This phone’s gateway credential is no longer accepted. It may have expired, been revoked, or the gateway may have been reset. Open Servers, edit this connection, and pair again with a fresh six-digit code.'
        : detail || `Server returned ${response.status}`)
      error.status = response.status
      throw error
    }
    if (response.status === 204) return null
    const body = await response.text()
    if (!body) return null
    try { return JSON.parse(body) } catch (_) { return body }
  })
}

function setOffline(flag) {
  if (flag === offline) return
  offline = flag
  $('#netBanner').hidden = !flag
  if (!flag) { flushOutbox(); if (activeSession && !eventsLive) startEvents() }
}

function announce(message) {
  const node = $('#announcer')
  node.textContent = ''
  setTimeout(() => { node.textContent = message }, 60)
}

function renderProfiles() {
  const html = profiles.length ? profiles.map((profile) => {
    const stored = readToken(profile)
    const tokenLabel = !stored.ok ? 'Secure storage error · tap Edit' : stored.exists && stored.value ? 'Ready to connect' : 'Token required'
    const tokenClass = !stored.ok ? 'error' : stored.exists && stored.value ? 'ok' : 'warn'
    return `<div class="profile" data-id="${esc(profile.id)}"><span class="tile"><img src="logo-sm.png" alt=""></span><div class="meta"><strong>${esc(profile.name)}</strong><small>${esc(profile.url)}</small><span class="chip ${tokenClass}"><i class="dot"></i>${esc(tokenLabel)}</span></div><button class="profile-menu" aria-label="Edit connection" data-edit="${esc(profile.id)}">${icon('more')}</button></div>`
  }).join('') : `<button class="empty add-empty" id="emptyAdd"><div class="empty-ico">${icon('server')}</div><strong>No connections yet</strong><span>Tap here to add your VPS or home PC.</span></button>`
  setList($('#profileList'), html, true)
}

function editProfile(id = null) {
  editingId = id
  pendingToken = ''
  originalProfileUrl = ''
  $('#profileForm').reset()
  $('#testResult').textContent = ''
  $('#diagnosticResult').hidden = true
  $('#pairHelp').hidden = true
  const profile = profiles.find((item) => item.id === id)
  $('#profileFormTitle').textContent = profile ? 'Edit connection' : 'New connection'
  $('#deleteProfile').hidden = !profile
  $('#manageDevices').hidden = !profile
  $('#gatewayStatus').hidden = !profile
  if (profile) {
    const stored = readToken(profile)
    $('#profileName').value = profile.name
    $('#profileUrl').value = profile.url
    originalProfileUrl = profile.url
    $('#profileDirectory').value = profile.directory || ''
    $('#saveProfile').disabled = !stored.ok || !stored.exists || !stored.value
    if (!stored.ok) $('#testResult').textContent = `Secure token could not be read: ${stored.error}. Pair again to repair this profile.`
    else if (stored.exists && stored.value) $('#testResult').textContent = 'This profile is already paired. Pair again only if the server or URL changed.'
  } else {
    $('#saveProfile').disabled = true
  }
  show('#editorScreen')
}

function formProfile() {
  return {
    name: $('#profileName').value.trim(),
    url: $('#profileUrl').value.trim().replace(/\/$/, ''),
    directory: $('#profileDirectory').value.trim(),
  }
}

async function testProfile(tokenOverride = '') {
  const candidate = formProfile()
  const existing = profiles.find((item) => item.id === editingId)
  const stored = existing ? readToken(existing) : { ok: true, exists: false, value: '' }
  if (!tokenOverride && !stored.ok) return $('#testResult').textContent = `Secure token read failed: ${stored.error}. Pair again to repair this profile.`
  const token = tokenOverride || stored.value || ''
  if (!candidate.url.startsWith('https://')) return $('#testResult').textContent = 'HTTPS is required.'
  if (token.length < TOKEN_LENGTH) return $('#testResult').textContent = 'Pair this profile before testing it.'
  $('#testResult').textContent = 'Testing secure connection…'
  $('#diagnosticResult').hidden = false
  $('#diagnosticResult').innerHTML = diagnosticRow('HTTPS address', true, 'Valid') + diagnosticRow('Gateway', null, 'Testing…') + diagnosticRow('Authentication', null, 'Testing…') + diagnosticRow('OpenCode', null, 'Testing…')
  try {
    const response = await fetch(new URL('/health', candidate.url), { headers: { Authorization: `Bearer ${token}` } })
    if (response.status === 401) { $('#diagnosticResult').innerHTML = diagnosticRow('HTTPS address', true, 'Reached') + diagnosticRow('Gateway', true, 'Online') + diagnosticRow('Authentication', false, 'Pair again') + diagnosticRow('OpenCode', null, 'Not tested'); throw new Error('This phone’s gateway credential is no longer accepted. Generate a fresh six-digit pairing code on the OpenCode computer, then tap Pair and test connection again.') }
    if (!response.ok) throw new Error(`gateway returned HTTP ${response.status}`)
    const health = await response.json()
    $('#diagnosticResult').innerHTML = diagnosticRow('HTTPS address', true, 'Secure') + diagnosticRow('Gateway', true, 'Online') + diagnosticRow('Authentication', true, 'Accepted') + diagnosticRow('OpenCode', !!health.opencode, health.opencode ? 'Ready' : 'Unavailable')
    $('#testResult').textContent = health.opencode ? '✓ Gateway and OpenCode are ready' : 'Gateway connected, but OpenCode is unavailable'
  } catch (error) {
    if (!$('#diagnosticResult').querySelector('.bad')) $('#diagnosticResult').innerHTML = diagnosticRow('HTTPS address', true, 'Valid') + diagnosticRow('Gateway', false, classifyNetworkError(error)) + diagnosticRow('Authentication', null, 'Not tested') + diagnosticRow('OpenCode', null, 'Not tested')
    $('#testResult').textContent = `Could not connect: ${error.message}`
  }
}

async function pairProfile() {
  const url = $('#profileUrl').value.trim().replace(/\/$/, '')
  const code = $('#pairingCode').value.trim()
  if (!url.startsWith('https://')) return $('#testResult').textContent = 'Enter the Tailscale HTTPS gateway URL first.'
  if (!/^\d{6}$/.test(code)) return $('#testResult').textContent = 'Enter the six-digit code shown by the gateway.'
  $('#testResult').textContent = 'Pairing securely over HTTPS…'
  $('#pairProfile').disabled = true
  try {
    const deviceName = window.AndroidDevice?.label?.() || 'Android device'
    const response = await fetch(new URL('/pair', url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, deviceName }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || `gateway returned HTTP ${response.status}`)
    if (typeof result.token !== 'string' || result.token.length < TOKEN_LENGTH) throw new Error('gateway returned an invalid token')
    pendingToken = result.token
    $('#pairingCode').value = ''
    $('#saveProfile').disabled = false
    await testProfile(pendingToken)
  } catch (error) {
    $('#testResult').textContent = `Pairing failed: ${classifyNetworkError(error)}`
  } finally {
    $('#pairProfile').disabled = false
  }
}

function diagnosticRow(name, ok, detail) { return `<div class="diagnostic-row"><span>${escapeHTML(name)}</span><b class="${ok === true ? 'ok' : ok === false ? 'bad' : ''}">${escapeHTML(detail)}</b></div>` }
function classifyNetworkError(error) { const text = String(error?.message || error); return /certificate|ssl/i.test(text) ? 'Certificate error' : /failed to fetch|network/i.test(text) ? 'DNS, VPN, or network failure' : text }

function commitProfile(event) {
  event.preventDefault()
  const candidate = formProfile()
  if (!candidate.name) return notify('Give this connection a name')
  if (!candidate.url.startsWith('https://')) return notify('Gateway URL must start with https://')

  const previous = profiles.find((item) => item.id === editingId)
  const stored = previous ? readToken(previous) : { ok: true, exists: false, value: '' }
  if (!pendingToken && !stored.ok) return notify(`Secure token read failed: ${stored.error}. Pair again to repair this profile.`)
  if (previous && candidate.url !== originalProfileUrl && !pendingToken) return notify('The gateway URL changed. Pair with the new server before saving.')
  const token = pendingToken || stored.value || ''
  if (token.length < TOKEN_LENGTH) return notify('Pair this profile before saving')

  const profile = { id: editingId || mintId(), name: candidate.name, url: candidate.url, directory: candidate.directory }
  if (pendingToken || !previous) {
    const result = storeToken(profile, token)
    if (!result.ok) return notify(`Could not save token: ${result.reason}`)
  }

  const index = profiles.findIndex((item) => item.id === profile.id)
  if (index >= 0) profiles[index] = profile
  else profiles.push(profile)
  saveProfiles()
  editingId = null
  renderProfiles()
  show('#connectionsScreen')
  notify('Profile saved securely')
}

function deleteProfile() {
  const index = profiles.findIndex((item) => item.id === editingId)
  if (index < 0) return
  if (vaultAvailable()) vault.remove(profiles[index].id)
  profiles.splice(index, 1)
  saveProfiles(); editingId = null; renderProfiles(); show('#connectionsScreen'); notify('Profile deleted')
}

async function connectProfile(id) {
  activeProfile = profiles.find((item) => item.id === id)
  const stored = readToken(activeProfile)
  if (!stored.ok) { notify(`Secure token read failed: ${stored.error}. Re-enter the token to repair this profile.`); return editProfile(id) }
  activeToken = stored.value
  if (!activeProfile || !stored.exists || !activeToken) return editProfile(id)
  try { localStorage.setItem(LAST_PROFILE_KEY, id) } catch (_) {}
  $('#activeDirectory').textContent = activeProfile.directory || 'Default workspace'
  $('#projectConnectionName').textContent = activeProfile.name
  updateModelLabel()
  show('#sessionsScreen')
  await loadSessions()
}

function setConnection(state, label) {
  $('#connectionState').textContent = label
  $('#sessionHero').dataset.state = state
}

function shortError(error) { return String(error?.message || error || 'Unknown error').slice(0, 220) }

async function loadSessions() {
  setConnection('connecting', 'CONNECTING')
  const list = $('#sessionList')
  if (!list.querySelector('.session-item')) setList(list, skeletons(3), true)
  try {
    const sessions = await request('/session')
    setConnection('online', 'CONNECTED')
    lastSessionsLoad = Date.now()
    allSessions = [...sessions].sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0))
    renderSessions()
  } catch (error) {
    setConnection('offline', 'OFFLINE')
    const rejected = error?.status === 401
    setList(list, emptyState({ ic: 'alert', title: rejected ? 'Pair this phone again' : 'Connection failed', text: shortError(error), action: rejected ? '<button class="primary retry-button" id="repairConnection">Repair connection</button>' : '<button class="secondary retry-button" id="retrySessions">Try again</button>' }), true)
  }
}

function readPins() { try { return JSON.parse(localStorage.getItem(PIN_KEY) || '{}') } catch (_) { return {} } }
function pinnedIds() { return new Set((activeProfile && readPins()[activeProfile.id]) || []) }
function setPinned(id, flag) {
  if (!activeProfile) return
  const pins = readPins()
  const set = new Set(pins[activeProfile.id] || [])
  if (flag) set.add(id); else set.delete(id)
  pins[activeProfile.id] = [...set]
  try { localStorage.setItem(PIN_KEY, JSON.stringify(pins)) } catch (_) {}
}

function sessionItemHtml(session, pinned) {
  const title = session.title || 'Untitled session'
  const current = session.id === activeSession ? ' current' : ''
  const mark = pinned ? `<span class="pin-mark" title="Pinned">${icon('pin')}</span>` : ''
  return `<div class="session-item${current}${pinned ? ' pinned' : ''}" role="button" tabindex="0" data-id="${esc(session.id)}" data-title="${esc(title)}"><span class="tile">${icon('chat')}</span><div class="meta"><strong>${mark}${esc(title)}</strong><small>${esc(relTime(session.time?.updated) || 'No activity yet')}</small></div><button type="button" class="session-more" data-more aria-label="Session options for ${esc(title)}">${icon('more')}</button></div>`
}

function renderSessions() {
  const list = $('#sessionList')
  const query = $('#sessionSearch').value.trim().toLowerCase()
  const sorted = query ? allSessions.filter((session) => String(session.title || 'Untitled session').toLowerCase().includes(query)) : allSessions
  const pins = pinnedIds()
  const pinnedRows = sorted.filter((session) => pins.has(session.id))
  const rest = sorted.filter((session) => !pins.has(session.id))
  let lastGroup = ''
  let html = pinnedRows.length ? `<div class="group-label pin-label">${icon('pin')}Pinned</div>${pinnedRows.map((session) => sessionItemHtml(session, true)).join('')}` : ''
  html += rest.map((session) => {
    const group = dayLabel(session.time?.updated)
    const heading = group !== lastGroup ? `<div class="group-label">${group}</div>` : ''
    lastGroup = group
    return heading + sessionItemHtml(session, false)
  }).join('')
  const empty = query ? emptyState({ ic: 'search', title: 'No matches', text: 'No session title contains that text.' }) : emptyState({ ic: 'chat', title: 'No sessions yet', text: 'Tap + to start your first conversation.' })
  setList(list, html || empty, true)
}

function isWide() { return window.matchMedia('(min-width:840px)').matches }

async function createSession() {
  const sessBody = { directory: activeProfile?.directory || '' }
  try { const session = await request('/session', { method: 'POST', body: JSON.stringify(sessBody) }); await openSession(session.id, session.title || 'New session') }
  catch (error) { notify(error.message) }
}

function leaveChat() {
  saveDraft()
  closeChatSearch()
  clearInterval(polling); polling = null
  stopEvents()
  stopThinking()
  activeSession = null
}

function schedulePoll() {
  clearInterval(polling)
  polling = setInterval(loadMessages, eventsLive ? 10000 : 1200)
}

async function openSession(id, title, options = {}) {
  if (activeSession && activeSession !== id) saveDraft()
  stopEvents(); resetTypewriter(); stopThinking(); activeSession = id; lastAssistantText = ''; responseBaselineText = ''; waitingForAssistant = false; focusedPromptText = ''; pinUntil = 0; sendGrace = 0
  renderedPermission = ''; $('#permissionArea').innerHTML = ''
  todoSig = ''; setTodos([])
  try { nativeDevice?.clearNotifications?.(id) } catch (_) {}
  const container = $('#messages')
  container.classList.remove('focus-latest'); delete container.dataset.ready; container.innerHTML = skeletons(2)
  $('#toBottom').classList.remove('show', 'has-new')
  follow = true; pendingNew = false; lastScrollH = 0; lastMessages = []
  closeChatSearch(); $('#chatSearchInput').value = ''
  $('#chatUsage').hidden = true
  renderQueue()
  pendingFiles = []; renderTray()
  $('#chatTitle').textContent = title; show('#chatScreen'); restoreDraft(); recordSession('idle')
  if (options.prefill) { $('#promptInput').value = options.prefill; updateComposer() }
  applyPendingShare()
  updateViewportInsets()
  document.querySelectorAll('#sessionList .session-item').forEach((item) => item.classList.toggle('current', item.dataset.id === id))
  if (isWide() && Date.now() - lastSessionsLoad > 15000) loadSessions()
  await loadMessages(); schedulePoll(); startEvents(); flushOutbox()
  if (options.prefill) { $('#promptInput').focus(); const end = $('#promptInput').value.length; $('#promptInput').setSelectionRange(end, end) }
}

/* ── Drafts ─────────────────────────────────────────────────────────────── */
function readDrafts() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') } catch (_) { return {} } }

function saveDraft() {
  if (!activeSession) return
  const drafts = readDrafts()
  const text = $('#promptInput').value
  if (text.trim()) drafts[activeSession] = text; else delete drafts[activeSession]
  const keys = Object.keys(drafts)
  if (keys.length > 60) keys.slice(0, keys.length - 60).forEach((key) => delete drafts[key])
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)) } catch (_) {}
}

function restoreDraft() {
  $('#promptInput').value = (activeSession && readDrafts()[activeSession]) || ''
  updateComposer()
}

/* ── Live events (SSE) with polling fallback ─────────────────────────────── */
function stopEvents() {
  if (eventAbort) { eventAbort.abort(); eventAbort = null }
  eventsLive = false
}

function scheduleRefresh() {
  if (refreshTimer) return
  const wait = Math.max(0, 450 - (Date.now() - lastRefreshAt))
  refreshTimer = setTimeout(() => { refreshTimer = null; lastRefreshAt = Date.now(); loadMessages() }, wait)
}

function handleEventChunk(chunk) {
  const data = chunk.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
  if (!data) return
  lastEventAt = Date.now()
  let event
  try { event = JSON.parse(data) } catch (_) { return }
  const type = String(event.type || '')
  const props = event.properties || {}
  const sessionID = props.sessionID || props.info?.sessionID || props.part?.sessionID
  if (type === 'todo.updated') { if (sessionID === activeSession && Array.isArray(props.todos)) setTodos(props.todos); return }
  if (type.startsWith('permission.')) { if (!sessionID || sessionID === activeSession) loadPermissions(true); return }
  if (type === 'session.updated' || type === 'session.created' || type === 'session.deleted') {
    if (isWide() && currentScreen === '#chatScreen') loadSessions()
    if (props.info?.id !== activeSession) return
  } else if (sessionID && sessionID !== activeSession) return
  if (type.startsWith('message.') || type.startsWith('session.')) scheduleRefresh()
}

async function startEvents() {
  stopEvents()
  if (!activeProfile || !activeToken || !activeSession) return
  const controller = new AbortController()
  eventAbort = controller
  const session = activeSession
  let buffer = ''
  try {
    const response = await fetch(apiUrl('/event'), { headers: { Authorization: `Bearer ${activeToken}`, Accept: 'text/event-stream' }, signal: controller.signal })
    if (response.status === 401) { const error = new Error('This phone must be paired with the gateway again.'); error.status = 401; throw error }
    if (!response.ok || !response.body) throw new Error('Event stream unavailable')
    eventsLive = true; eventRetry = 0; lastEventAt = Date.now()
    setOffline(false); schedulePoll(); scheduleRefresh()
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let index
      while ((index = buffer.indexOf('\n\n')) >= 0) { handleEventChunk(buffer.slice(0, index)); buffer = buffer.slice(index + 2) }
    }
  } catch (error) {
    if (controller.signal.aborted) return
    if (error.status === 401) {
      $('#chatState').textContent = 'PAIR AGAIN'
      if (Date.now() - tokenWarningAt > 10000) { tokenWarningAt = Date.now(); notify('Gateway access expired or was revoked. Open Servers, edit this connection, and pair again with a fresh six-digit code.') }
    }
    if (error.name === 'TypeError') setOffline(true)
  }
  if (controller.signal.aborted || eventAbort !== controller || session !== activeSession) return
  eventsLive = false
  eventRetry = Math.min(eventRetry + 1, 6)
  schedulePoll()
  setTimeout(() => { if (activeSession === session && eventAbort === controller) startEvents() }, Math.min(15000, 800 * 2 ** eventRetry))
}

setInterval(() => {
  if (eventsLive && eventAbort && Date.now() - lastEventAt > 60000) eventAbort.abort()
  if (activeSession && eventAbort && eventAbort.signal.aborted) startEvents()
}, 20000)

function messageItems(messages) {
  return messages.flatMap((entry) => {
    const role = entry.info?.role === 'user' ? 'user' : 'assistant'
    const base = entry.info?.id || role
    const created = entry.info?.time?.created
    const items = []
    ;(entry.parts || []).forEach((part, index) => {
      const key = `${base}:${part.id || index}`
      if (part.type === 'tool') items.push({ key, kind: 'tool', part, sig: toolSig(part) })
      else if (part.type === 'text' && part.text) items.push({ key, kind: role, text: part.text, time: created })
      else if (part.type === 'file' && role === 'user') items.push({ key, kind: 'file', part })
    })
    if (entry.info?.error) items.push({ key: `${base}:error`, kind: 'error', text: formatModelError(entry.info.error), aborted: entry.info.error?.name === 'MessageAbortedError' })
    return items
  })
}

const ATTACHED_RE = /\n*<attached file="([^"]*)">[\s\S]*?<\/attached>/g
function splitAttachments(text) {
  const names = []
  const clean = String(text).replace(ATTACHED_RE, (_, name) => { names.push(name); return '' }).trim()
  return { clean, names }
}

function fileChipHtml(name, thumb) {
  return `<div class="file-chip">${thumb ? `<img src="${esc(thumb)}" alt="${esc(name)}">` : icon('clip')}${thumb ? '' : `<span>${esc(name)}</span>`}</div>`
}

const ACTION_META = { copy: { label: 'Copy', ic: 'copy' }, edit: { label: 'Edit', ic: 'edit' }, retry: { label: 'Retry', ic: 'refresh' } }
function messageActions(kinds) {
  return `<div class="msg-actions">${kinds.map((kind) => `<button type="button" class="msg-action" data-msg-action="${kind}" aria-label="${ACTION_META[kind].label}">${icon(ACTION_META[kind].ic)}<span>${ACTION_META[kind].label}</span></button>`).join('')}</div>`
}

function messageNode(item) {
  const holder = document.createElement('div')
  let stripped = null
  if (item.kind === 'user') {
    stripped = splitAttachments(item.text)
    const chips = stripped.names.map((name) => fileChipHtml(name)).join('')
    holder.innerHTML = `<div class="message user">${stripped.clean ? `<div class="bubble">${esc(stripped.clean)}</div>` : ''}${chips}${messageActions(['copy', 'edit'])}</div>`
  }
  else if (item.kind === 'assistant') holder.innerHTML = `<div class="message assistant"><div class="msg-meta"><span class="avatar-mini"><img src="logo-sm.png" alt=""></span><span>OpenCode</span>${item.time ? `<time>${esc(new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</time>` : ''}</div><div class="bubble md"></div>${messageActions(['copy', 'retry'])}</div>`
  else if (item.kind === 'file') {
    const part = item.part
    const name = part.filename || 'attachment'
    const thumb = String(part.mime || '').startsWith('image/') && String(part.url || '').startsWith('data:image/') ? part.url : ''
    holder.innerHTML = `<div class="message user file-message">${fileChipHtml(name, thumb)}</div>`
  }
  else if (item.kind === 'tool') holder.innerHTML = `<div class="message tool-message">${toolChipHtml(item.part)}</div>`
  else holder.innerHTML = `<div class="message error-message"><div class="msg-meta">${item.aborted ? 'Stopped' : 'Model error'}</div><div class="bubble">${esc(item.text)}</div>${messageActions(['retry'])}</div>`
  const node = holder.firstElementChild
  node.dataset.key = item.key
  if (item.kind === 'tool') { node.__sig = item.sig; node.__part = item.part; node.__open = false }
  if (item.kind === 'user') { node.__text = stripped.clean; node.__raw = item.text }
  return node
}

function syncAssistant(node, text, displayed, active) {
  const bubble = node.querySelector('.bubble')
  if (active) {
    let changed = false
    if (!bubble.__live) { bubble.__live = true; renderLiveText(bubble, displayed); changed = true }
    bubble.classList.add('live')
    bubble.dataset.typewriterActive = 'true'
    return changed
  }
  const wasLive = bubble.__live
  if (wasLive) { bubble.__live = false; bubble.classList.remove('live'); delete bubble.dataset.typewriterActive }
  if (wasLive || bubble.__text !== text) { finishLiveText(bubble, text); bubble.__text = text; return true }
  return false
}

/* Keyed reconciliation: existing messages stay in the DOM (no flicker, scroll
   position and text selection survive polling) and only new ones animate in. */
function reconcileMessages(items, newestKey, responseArrived) {
  const container = $('#messages')
  const firstRender = !container.dataset.ready
  let changed = false
  container.querySelectorAll(':scope > .skeleton, :scope > .empty').forEach((node) => node.remove())
  if (!items.length && !container.querySelector(':scope > .message')) {
    container.innerHTML = emptyState({ ic: 'sparkle', title: 'Start a conversation', text: 'Ask OpenCode to explain, build or debug something in this project.' })
    container.dataset.ready = '1'
    return
  }
  const existing = new Map()
  container.querySelectorAll(':scope > .message[data-key]').forEach((node) => existing.set(node.dataset.key, node))
  const optimistic = container.querySelector(':scope > .message.optimistic')
  if (optimistic) {
    const lastUser = [...items].reverse().find((item) => item.kind === 'user')
    if (lastUser && !existing.has(lastUser.key) && lastUser.text === optimistic.__raw) {
      optimistic.dataset.key = lastUser.key
      optimistic.classList.remove('optimistic')
      existing.set(lastUser.key, optimistic)
    }
  }
  const byKey = new Map()
  let anchor = null
  items.forEach((item) => {
    let node = existing.get(item.key)
    existing.delete(item.key)
    const isNewest = item.kind === 'assistant' && item.key === newestKey
    const displayed = isNewest ? updateTypewriter(item.key, item.text, responseArrived) : item.text
    const active = item.kind === 'assistant' && typewriter.key === item.key
    if (!node) { node = messageNode(item); if (!firstRender) node.classList.add('enter'); changed = true }
    if (item.kind === 'assistant') { node.__fullText = item.text; if (syncAssistant(node, item.text, displayed, active)) changed = true }
    else if (item.kind === 'tool' && node.__sig !== item.sig) {
      node.__sig = item.sig; node.__part = item.part
      node.innerHTML = toolChipHtml(item.part, !!node.__open)
      changed = true
    }
    byKey.set(item.key, node)
    const spot = anchor ? anchor.nextElementSibling : container.firstElementChild
    if (spot !== node) container.insertBefore(node, spot)
    anchor = node
  })
  if (existing.size) changed = true
  existing.forEach((node) => node.remove())
  const pending = container.querySelector(':scope > .message.optimistic')
  if (pending) container.appendChild(pending)
  // The Retry action only belongs on the final reply (or error) of the conversation.
  container.querySelectorAll(':scope > .message.is-last').forEach((node) => node.classList.remove('is-last'))
  for (let index = items.length - 1; index >= 0; index--) {
    const kind = items[index].kind
    if (kind === 'user' || kind === 'file') break
    if (kind === 'assistant' || kind === 'error') { byKey.get(items[index].key)?.classList.add('is-last'); break }
  }
  placeThinking()
  container.dataset.ready = '1'
  if (firstRender) requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; follow = true; pendingNew = false; lastScrollH = container.scrollHeight; syncBottomButton() })
  else if (changed) afterGrowth()
  if (changed) refreshChatSearch()
}

async function loadMessages() {
  if (!activeSession) return
  const session = activeSession
  try {
    const messages = await request(`/session/${session}/message`)
    if (session !== activeSession) return
    const nextAssistantText = assistantText(messages)
    const responseArrived = waitingForAssistant && nextAssistantText.length > responseBaselineText.length && nextAssistantText !== responseBaselineText
    if (responseArrived) { waitingForAssistant = false; playSound('#soundReceived', .9) }
    lastAssistantText = nextAssistantText
    const assistantParts = messages.flatMap((entry) => (entry.parts || []).map((part, index) => ({ entry, part, index }))).filter(({ entry, part }) => entry.info?.role === 'assistant' && part.type === 'text' && part.text)
    const newestAssistant = assistantParts[assistantParts.length - 1]
    const newestKey = newestAssistant ? `${newestAssistant.entry.info?.id || 'assistant'}:${newestAssistant.part.id || newestAssistant.index}` : ''
    reconcileMessages(messageItems(messages), newestKey, responseArrived)
    lastMessages = messages
    applyBusy(messages)
    renderUsage(messages)
    setTodos(todosFromMessages(messages))
    const lastInfo = messages[messages.length - 1]?.info
    if (lastInfo?.role === 'assistant' && lastInfo.error && (queues.get(session) || []).length && !pausedSessions.has(session)) { pausedSessions.add(session); renderQueue() }
    if (!sessionBusy) $('#chatState').textContent = 'CONNECTED'
    if (focusedPromptText) { $('#messages').classList.add('focus-latest'); focusLatestUserMessage() }
    if (!sessionBusy) maybeFlushQueue()
  } catch (error) {
    $('#chatState').textContent = error?.status === 401 ? 'PAIR AGAIN' : 'RETRYING'
    if (error?.status === 401 && Date.now() - tokenWarningAt > 10000) { tokenWarningAt = Date.now(); notify(shortError(error)) }
  }
  loadPermissions()
}

async function loadPermissions(force = false) {
  if (!force && eventsLive && Date.now() - lastPermCheck < 8000) return
  if (!force && Date.now() - lastPermCheck < 2500) return
  lastPermCheck = Date.now()
  try {
    const permissions = await request('/permission')
    const permission = permissions.find((item) => item.sessionID === activeSession)
    const signature = permission ? permission.id : ''
    if (signature === renderedPermission) return
    renderedPermission = signature
    $('#permissionArea').innerHTML = permission ? `<div class="permission" role="alert"><p><strong>Permission required</strong><br>${escapeHTML(permission.title || permission.permission || 'OpenCode requests approval')}</p><div><button data-answer="reject" class="secondary">Deny</button><button data-answer="once" class="primary">Allow once</button></div></div>` : ''
    if (permission) { announce('Permission required'); haptic('attention') }
    document.querySelectorAll('[data-answer]').forEach((button) => button.addEventListener('click', () => replyPermission(permission.id, button.dataset.answer)))
  } catch (_) {}
}

async function replyPermission(id, reply) {
  try { await request(`/permission/${id}/reply`, { method: 'POST', body: JSON.stringify({ reply }) }); renderedPermission = ''; $('#permissionArea').innerHTML = ''; try { nativeDevice?.clearNotifications?.(activeSession) } catch (_) {} }
  catch (error) { notify(error.message) }
}

async function sendPrompt(event) {
  event.preventDefault()
  const typed = $('#promptInput').value.trim()
  if (!typed && !pendingFiles.length) return sessionBusy ? abortSession() : undefined
  if (selectedModel && !providers) {
    try { providers = await request('/provider') }
    catch (error) { return notify(`Could not verify selected model: ${error.message}`) }
  }
  if (selectedModel) {
    const available = modelRows().some((model) => model.providerID === selectedModel.providerID && model.modelID === selectedModel.modelID && model.connected && model.textOutput)
    if (!available) { notify('Selected model is not connected or cannot return text. Choose another model.'); return loadModels() }
  }
  const textFiles = pendingFiles.filter((file) => file.text !== undefined)
  const binaryFiles = pendingFiles.filter((file) => file.dataUrl)
  const shown = typed || 'See the attached file.'
  const inline = textFiles.map((file) => `\n\n<attached file="${file.name.replace(/"/g, "'")}">\n${file.text}\n</attached>`).join('')
  const promptText = shown + inline
  const entry = {
    body: {
      parts: [{ type: 'text', text: promptText }, ...binaryFiles.map((file) => ({ type: 'file', mime: file.mime, filename: file.name, url: file.dataUrl }))],
      ...(selectedModel ? { model: { providerID: selectedModel.providerID, modelID: selectedModel.modelID } } : {}),
    },
    shown,
    raw: promptText,
    names: textFiles.map((file) => file.name),
  }
  $('#promptInput').value = ''; pendingFiles = []; renderTray(); saveDraft(); updateComposer(); tap()
  const queued = queues.get(activeSession) || []
  // While OpenCode is busy (or earlier items are still waiting) new instructions join the queue.
  if (sessionBusy || (queued.length && !pausedSessions.has(activeSession))) return enqueue(entry)
  pausedSessions.delete(activeSession)
  $('#promptInput').blur()
  await submitEntry(entry)
}

async function submitEntry(entry) {
  const { body, shown, raw, names = [] } = entry
  const session = activeSession
  responseBaselineText = lastAssistantText
  waitingForAssistant = true
  focusedPromptText = raw
  sendGrace = Date.now() + 8000
  follow = true; pendingNew = false
  const node = showOptimisticPrompt(shown, raw, names)
  playSound('#soundSent', .9); startThinking(); updateViewportInsets()
  try { await request(`/session/${session}/prompt_async`, { method: 'POST', body: JSON.stringify(body) }); await loadMessages() }
  catch (error) {
    waitingForAssistant = false; sendGrace = 0
    if (error.network) {
      outbox.push({ session, body, node })
      node.insertAdjacentHTML('beforeend', '<span class="queued-note">Not sent · will retry automatically</span>')
      stopThinking(); notify('No connection. Message queued.')
      return
    }
    focusedPromptText = ''; $('#messages').classList.remove('focus-latest'); stopThinking(); notify(error.message); loadMessages()
  }
}

/* ── Retry / regenerate ─────────────────────────────────────────────────── */
function retryLast() {
  if (sessionBusy || !activeSession) return
  const entry = [...lastMessages].reverse().find((item) => item.info?.role === 'user')
  if (!entry) return notify('Nothing to retry')
  const parts = entry.parts || []
  const texts = parts.filter((part) => part.type === 'text' && part.text && !part.synthetic)
  const files = parts.filter((part) => part.type === 'file' && part.url)
  if (!texts.length && !files.length) return notify('Nothing to retry')
  const raw = texts.map((part) => part.text).join('\n')
  const model = selectedModel ? { providerID: selectedModel.providerID, modelID: selectedModel.modelID } : (entry.info?.model?.providerID ? { providerID: entry.info.model.providerID, modelID: entry.info.model.modelID } : null)
  const body = {
    parts: [...(raw ? [{ type: 'text', text: raw }] : []), ...files.map((part) => ({ type: 'file', mime: part.mime, filename: part.filename, url: part.url }))],
    ...(model ? { model } : {}),
  }
  const { clean, names } = splitAttachments(raw)
  tap()
  pausedSessions.delete(activeSession)
  submitEntry({ body, shown: clean || 'See the attached file.', raw, names })
}

/* ── Message queue ──────────────────────────────────────────────────────── */
function enqueue(entry) {
  const list = queues.get(activeSession) || []
  list.push(entry)
  queues.set(activeSession, list)
  renderQueue()
  notify('Queued · runs after the current task')
}

function renderQueue() {
  const tray = $('#queueTray')
  const list = (activeSession && queues.get(activeSession)) || []
  tray.hidden = !list.length
  if (!list.length) tray.innerHTML = ''
  else {
    const paused = pausedSessions.has(activeSession)
    const head = `<div class="queue-head"><b>${icon('list')}${paused ? 'Paused' : 'Queued'} · ${list.length}</b>${paused ? '<button type="button" class="queue-resume" data-queue-resume>Resume</button>' : '<small>Runs when OpenCode finishes</small>'}</div>`
    tray.innerHTML = head + list.map((entry, index) => `<div class="queue-item"><span>${esc(entry.shown.split('\n')[0])}${entry.names.length ? ` · ${entry.names.length} file${entry.names.length === 1 ? '' : 's'}` : ''}</span><button type="button" data-queue-remove="${index}" aria-label="Remove from queue">${icon('x')}</button></div>`).join('')
  }
  updateSendMode()
}

function maybeFlushQueue() {
  const list = queues.get(activeSession)
  if (!list || !list.length || pausedSessions.has(activeSession) || sessionBusy || offline || flushing || Date.now() < sendGrace) return
  const entry = list.shift()
  renderQueue()
  flushing = true
  Promise.resolve(submitEntry(entry)).finally(() => { flushing = false })
}

async function flushOutbox() {
  if (offline || !outbox.length) return
  for (const item of outbox.filter((entry) => entry.session === activeSession)) {
    try {
      await request(`/session/${item.session}/prompt_async`, { method: 'POST', body: JSON.stringify(item.body) })
      outbox = outbox.filter((entry) => entry !== item)
      item.node?.querySelector('.queued-note')?.remove()
      waitingForAssistant = true; sendGrace = Date.now() + 8000; startThinking()
    } catch (error) {
      if (error.network) return
      outbox = outbox.filter((entry) => entry !== item)
      notify(`Queued message failed: ${shortError(error)}`)
    }
  }
  loadMessages()
}

async function abortSession() {
  if (!activeSession) return
  try {
    await request(`/session/${activeSession}/abort`, { method: 'POST' })
    sendGrace = 0; waitingForAssistant = false
    if ((queues.get(activeSession) || []).length) { pausedSessions.add(activeSession); renderQueue() }
    notify('Stopped'); announce('Stopped')
    await loadMessages()
  } catch (error) { notify(shortError(error)) }
}

/* ── Attachments, voice, share ──────────────────────────────────────────── */
function readDataUrl(blob) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob) })
}

async function prepareImage(file) {
  const dataUrl = await readDataUrl(file)
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return dataUrl
  try {
    const image = await new Promise((resolve, reject) => { const node = new Image(); node.onload = () => resolve(node); node.onerror = reject; node.src = dataUrl })
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale)
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL(file.type === 'image/png' && scale === 1 ? 'image/png' : 'image/jpeg', .86)
  } catch (_) { return dataUrl }
}

const TEXT_EXT = /\.(txt|md|json|js|ts|tsx|jsx|py|java|kt|go|rs|c|h|cpp|cs|rb|php|sh|yml|yaml|toml|xml|html|css|sql|log|csv|gradle|swift)$/i

async function addFile(file) {
  if (pendingFiles.length >= 6) return notify('You can attach up to 6 files')
  if (file.size > MAX_FILE_BYTES) return notify(`${file.name} is larger than 8 MB`)
  const name = file.name || 'attachment'
  if (file.type.startsWith('text/') || TEXT_EXT.test(name)) {
    if (file.size > 200 * 1024) return notify(`${name} is too large to paste as text (200 KB max)`)
    pendingFiles.push({ name, mime: file.type || 'text/plain', text: await file.text(), size: file.size })
  } else if (file.type.startsWith('image/')) {
    const dataUrl = await prepareImage(file)
    pendingFiles.push({ name, mime: dataUrl.slice(5, dataUrl.indexOf(';')), dataUrl, size: file.size })
  } else if (file.type === 'application/pdf') {
    pendingFiles.push({ name, mime: 'application/pdf', dataUrl: await readDataUrl(file), size: file.size })
  } else notify(`${name}: unsupported file type`)
}

async function addFiles(list) {
  for (const file of Array.from(list)) { try { await addFile(file) } catch (_) { notify(`Could not read ${file.name}`) } }
  renderTray(); updateComposer()
}

function renderTray() {
  const tray = $('#attachTray')
  tray.hidden = !pendingFiles.length
  tray.innerHTML = pendingFiles.map((file, index) => `<div class="attach-chip">${file.dataUrl && file.mime.startsWith('image/') ? `<img src="${esc(file.dataUrl)}" alt="">` : icon('file')}<span>${esc(file.name)}</span><button type="button" data-remove="${index}" aria-label="Remove ${esc(file.name)}">${icon('x')}</button></div>`).join('')
  $('#sendButton').classList.toggle('ready', pendingFiles.length > 0 || $('#promptInput').value.trim().length > 0)
  updateSendMode()
}

window.voiceResult = (text) => {
  if (!text) return
  const input = $('#promptInput')
  input.value = input.value ? `${input.value.replace(/\s+$/, '')} ${text}` : text
  updateComposer(); saveDraft(); input.focus()
}

window.receiveShared = (payload) => {
  pendingShare = payload
  if (currentScreen === '#chatScreen') applyPendingShare()
  else notify('Open a chat to add the shared content')
}

async function applyPendingShare() {
  if (!pendingShare) return
  const payload = pendingShare
  pendingShare = null
  const input = $('#promptInput')
  if (payload.text) { input.value = input.value ? `${input.value}\n${payload.text}` : payload.text; updateComposer(); saveDraft() }
  for (const shared of payload.files || []) {
    try {
      const blob = await (await fetch(shared.dataUrl)).blob()
      await addFile(new File([blob], shared.name || 'shared', { type: shared.mime || blob.type }))
    } catch (_) { notify('Could not read a shared file') }
  }
  renderTray(); updateComposer()
  notify('Shared content added')
}

/* ── Conversation export ───────────────────────────────────────────────── */
function markdownFilename() {
  const clean = ($('#chatTitle').textContent || 'OpenCode conversation').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80)
  return `${clean || 'OpenCode conversation'}.md`
}

function conversationMarkdown() {
  const title = ($('#chatTitle').textContent || 'OpenCode conversation').trim()
  const lines = [`# ${title}`, '', `> Exported from OpenCode Unofficial on ${new Date().toLocaleString()}.`]
  if (activeProfile?.name) lines.push(`> Server: ${activeProfile.name}`)
  if (activeProfile?.directory) lines.push(`> Project: \`${activeProfile.directory.replace(/`/g, '\\`')}\``)
  lines.push('')
  for (const entry of lastMessages) {
    const role = entry.info?.role === 'user' ? 'You' : entry.info?.role === 'assistant' ? 'OpenCode' : 'System'
    const when = entry.info?.time?.created || entry.info?.time?.completed
    lines.push(`## ${role}${when ? ` · ${new Date(when).toLocaleString()}` : ''}`, '')
    let wrote = false
    for (const part of entry.parts || []) {
      if (part.type === 'text' && part.text) { lines.push(part.text.trim(), ''); wrote = true }
      else if (part.type === 'file') { lines.push(`- Attachment: **${part.filename || part.name || 'file'}**`, ''); wrote = true }
      else if (part.type === 'tool') {
        const status = part.state?.status || 'recorded'
        lines.push(`> Tool: \`${part.tool || 'tool'}\` — ${status}`, '')
        wrote = true
      }
    }
    if (!wrote) lines.push('_No text content._', '')
  }
  return lines.join('\n').trim() + '\n'
}

function openExportSheet() {
  if (!activeSession || !lastMessages.length) return notify('There is no conversation to export yet')
  $('#exportSheet').hidden = false
}

function saveConversationMarkdown() {
  const filename = markdownFilename()
  const markdown = conversationMarkdown()
  if (window.AndroidFiles?.exportText) return window.AndroidFiles.exportText(filename, markdown)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  $('#exportSheet').hidden = true; notify('Markdown saved')
}

async function shareConversationMarkdown() {
  const filename = markdownFilename()
  const markdown = conversationMarkdown()
  if (window.AndroidFiles?.shareText) { window.AndroidFiles.shareText(filename, markdown); $('#exportSheet').hidden = true; return }
  try { await navigator.share({ title: filename.replace(/\.md$/, ''), text: markdown }); $('#exportSheet').hidden = true }
  catch (error) { if (error?.name !== 'AbortError') notify('Sharing is not available on this device') }
}

window.conversationExportFinished = (ok, message) => {
  if (ok) $('#exportSheet').hidden = true
  notify(message)
}

/* ── Session menu, edit & branch ────────────────────────────────────────── */
function openSessionSheet(id, title) {
  sheetSession = { id, title }
  $('#sessionSheetTitle').textContent = title
  $('#sessionRename').value = title
  const del = $('#deleteSession')
  del.dataset.armed = ''; del.textContent = 'Delete session'
  $('#pinSession').textContent = pinnedIds().has(id) ? 'Unpin from top' : 'Pin to top'
  $('#sessionSheet').hidden = false
}

async function renameSession(event) {
  event.preventDefault()
  if (!sheetSession) return
  const title = $('#sessionRename').value.trim()
  if (!title) return
  try {
    await request(`/session/${sheetSession.id}`, { method: 'PATCH', body: JSON.stringify({ title }) })
    if (sheetSession.id === activeSession) $('#chatTitle').textContent = title
    $('#sessionSheet').hidden = true; notify('Renamed'); loadSessions()
  } catch (error) { notify(shortError(error)) }
}

async function deleteSessionNow() {
  const button = $('#deleteSession')
  if (!sheetSession) return
  if (button.dataset.armed !== '1') { button.dataset.armed = '1'; button.textContent = 'Tap again to delete for good'; return }
  try {
    await request(`/session/${sheetSession.id}`, { method: 'DELETE' })
    const wasActive = sheetSession.id === activeSession
    setPinned(sheetSession.id, false); queues.delete(sheetSession.id); pausedSessions.delete(sheetSession.id)
    const drafts = readDrafts(); delete drafts[sheetSession.id]; try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)) } catch (_) {}
    $('#sessionSheet').hidden = true; notify('Session deleted')
    if (wasActive) { leaveChat(); show('#sessionsScreen') }
    loadSessions()
  } catch (error) { notify(shortError(error)) }
}

function prefillComposer(text) {
  const input = $('#promptInput')
  input.value = text; updateComposer(); saveDraft(); input.focus(); input.setSelectionRange(text.length, text.length)
}

async function editFromMessage(message) {
  const text = message.__text || message.querySelector('.bubble')?.innerText || ''
  const messageID = String(message.dataset.key || '').split(':')[0]
  if (!/^msg_/.test(messageID) || message.classList.contains('optimistic')) return prefillComposer(text)
  try {
    const branch = await request(`/session/${activeSession}/fork`, { method: 'POST', body: JSON.stringify({ messageID }) })
    if (!branch?.id) throw new Error('Branch failed')
    notify('Branched from here. Edit and send.')
    await openSession(branch.id, branch.title || 'Branch', { prefill: text })
    loadSessions()
  } catch (_) {
    notify('Could not branch. Editing in this chat instead.')
    prefillComposer(text)
  }
}

async function loadProjects() {
  if (!activeProfile) return notify('Choose a connection first')
  show('#projectsScreen')
  const list = $('#projectList')
  if (!list.querySelector('.project-item')) setList(list, skeletons(3), true)
  try {
    const projects = await request('/project')
    const html = projects.length ? projects.map((project) => {
      const directory = project.worktree || ''
      const name = project.name || directory.split(/[\\/]/).filter(Boolean).pop() || project.id || 'Project'
      const active = directory && directory === activeProfile.directory
      return `<button class="project-item${active ? ' active' : ''}" data-directory="${esc(directory)}"><span class="tile">${icon('folder')}</span><div class="meta"><strong>${esc(name)}</strong><small class="mono">${esc(directory || project.id || '')}</small></div>${active ? '<span class="badge active">ACTIVE</span>' : icon('chev-r', 'chev')}</button>`
    }).join('') : emptyState({ ic: 'folder', title: 'No projects yet', text: 'No projects have been opened by this OpenCode installation yet.' })
    setList(list, html, true)
  } catch (error) { setList(list, emptyState({ ic: 'alert', title: 'Could not load projects', text: shortError(error) }), true) }
}

function selectProject(directory) {
  if (!directory) return
  activeProfile.directory = directory
  const index = profiles.findIndex((profile) => profile.id === activeProfile.id)
  if (index >= 0) profiles[index] = { ...activeProfile }
  saveProfiles()
  $('#activeDirectory').textContent = directory
  notify('Project selected')
  show('#sessionsScreen')
  loadSessions()
}

async function loadModels() {
  if (!activeProfile) return notify('Choose a connection first')
  show('#modelsScreen')
  const list = $('#modelList')
  if (!list.querySelector('.model-item')) setList(list, skeletons(4), true)
  try {
    providers = await request('/provider')
    renderModels(true)
  } catch (error) { setList(list, emptyState({ ic: 'alert', title: 'Could not load models', text: shortError(error) }), true) }
}

function modelRows() {
  if (!providers) return []
  return (providers.all || []).flatMap((provider) => Object.values(provider.models || {}).map((model) => ({
    providerID: provider.id,
    providerName: provider.name,
    modelID: model.id,
    name: model.name || model.id,
    connected: (providers.connected || []).includes(provider.id),
    free: isFreeModel(model),
    textOutput: supportsText(model),
    status: model.status || 'active',
    context: model.limit?.context,
    readiness: (providers.connected || []).includes(provider.id) ? 'READY' : 'KEY REQUIRED',
  })))
}

function isFreeModel(model) {
  if (!model.cost || typeof model.cost.input !== 'number' || typeof model.cost.output !== 'number') return false
  return Number(model.cost.input || 0) === 0 && Number(model.cost.output || 0) === 0
}

function supportsText(model) {
  const output = model.modalities?.output
  return !Array.isArray(output) || output.includes('text')
}

function renderModels(animate = false) {
  const query = $('#modelSearch').value.trim().toLowerCase()
  const rows = modelRows().filter((model) => model.status !== 'deprecated' && model.textOutput).filter((model) => modelFilter === 'all' || (modelFilter === 'free' ? model.free && model.connected : model.connected)).filter((model) => !query || `${model.name} ${model.providerName} ${model.modelID}`.toLowerCase().includes(query))
  const html = rows.length ? rows.map((model) => {
    const selected = selectedModel?.providerID === model.providerID && selectedModel?.modelID === model.modelID
    const badge = model.connected ? (model.free ? '<span class="badge free">FREE</span>' : '<span class="badge ready">READY</span>') : '<span class="badge key">NEEDS KEY</span>'
    return `<button class="model-item${selected ? ' selected' : ''}" data-provider="${esc(model.providerID)}" data-model="${esc(model.modelID)}" data-name="${esc(model.name)}"><span class="tile mono" style="--h:${hueOf(model.providerName)}">${esc(monogram(model.providerName))}</span><div class="meta"><strong>${esc(model.name)}</strong><small>${esc(model.providerName)}${model.context ? ` · ${Math.round(model.context / 1000)}k context` : ''}</small></div><div class="end">${badge}${selected ? icon('check') : ''}</div></button>`
  }).join('') : emptyState({ ic: 'sliders', title: 'No models match', text: 'Connect a provider or switch to the Catalog tab.' })
  setList($('#modelList'), html, animate === true)
}

function selectModel(providerID, modelID, name) {
  selectedModel = { providerID, modelID, name }
  localStorage.setItem('opencode.remote.model.v1', JSON.stringify(selectedModel))
  updateModelLabel(); renderModels(false); notify(`${name} selected`)
  const chosen = $('#modelList .model-item.selected')
  if (chosen) { chosen.classList.remove('flash'); void chosen.offsetWidth; chosen.classList.add('flash') }
}

function updateModelLabel() {
  $('#selectedModelName').textContent = selectedModel?.name || 'Choose model'
}

function formatModelError(error) {
  if (typeof error === 'string') return error
  if (error?.name === 'MessageAbortedError') return 'The reply was stopped before it finished.'
  return error?.data?.message || error?.message || error?.name || 'The selected model failed to respond.'
}

function openProviderForm(kind) {
  $('#providerForm').reset()
  $('#providerKind').value = kind
  $('#providerResult').textContent = ''
  const openRouter = kind === 'openrouter'
  $('#providerFormTitle').textContent = openRouter ? 'Connect OpenRouter' : 'Add custom endpoint'
  $('#providerName').value = openRouter ? 'OpenRouter' : ''
  $('#providerId').value = openRouter ? 'openrouter' : ''
  $('#providerIdRow').hidden = openRouter
  $('#providerUrlRow').hidden = openRouter
  $('#providerUrl').required = !openRouter
  $('#providerSheet').hidden = false
}

async function saveProvider(event) {
  event.preventDefault()
  if (!activeProfile) return $('#providerResult').textContent = 'Choose a server connection first.'
  const kind = $('#providerKind').value
  const payload = { kind, name: $('#providerName').value.trim(), providerID: $('#providerId').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'), baseURL: $('#providerUrl').value.trim().replace(/\/$/, ''), key: $('#providerKey').value.trim(), directory: activeProfile.directory || '' }
  if (!payload.key) return $('#providerResult').textContent = 'API key is required.'
  if (kind === 'custom' && !payload.baseURL.startsWith('https://')) return $('#providerResult').textContent = 'Custom endpoint must use HTTPS.'
  $('#providerResult').textContent = 'Connecting provider and discovering models…'
  try {
    const response = await fetch(new URL('/gateway/provider/configure', activeProfile.url), { method: 'POST', headers: { Authorization: `Bearer ${activeToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
    $('#providerKey').value = ''
    $('#providerResult').textContent = `Connected · ${result.models} models available`
    setTimeout(() => { $('#providerSheet').hidden = true; loadModels() }, 700)
  } catch (error) { $('#providerResult').textContent = `Could not connect: ${error.message}` }
}

function openGuide() { $('#setupGuide').hidden = false }
function closeGuide() { $('#setupGuide').hidden = true }
async function openDeviceManager() {
  const profile = profiles.find((item) => item.id === editingId)
  if (!profile) return
  const stored = readToken(profile)
  if (!stored.ok || !stored.value) return notify(stored.error || 'Pair this profile first')
  $('#deviceSheet').hidden = false
  $('#deviceList').innerHTML = skeletons(2)
  try {
    const response = await fetch(new URL('/gateway/devices', profile.url), { headers: { Authorization: `Bearer ${stored.value}` } })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
    renderDevices(result, profile, stored.value)
  } catch (error) {
    $('#deviceList').innerHTML = emptyState({ ic: 'alert', title: 'Device management unavailable', text: shortError(error) })
  }
}
function renderDevices(result, profile, credential) {
  $('#deviceList').innerHTML = result.devices.length ? result.devices.map((device) => {
    const current = device.id === result.currentDeviceID
    const actions = current ? '<span class="device-current">This phone</span>' : `<div class="device-actions">${device.role === 'member' ? `<button type="button" class="secondary device-promote" data-device="${escapeHTML(device.id)}">Make owner</button>` : ''}<button type="button" class="danger device-revoke" data-device="${escapeHTML(device.id)}">Revoke</button></div>`
    return `<article class="device-card"><div><strong>${escapeHTML(device.name)}</strong><small>${escapeHTML(device.role)} · paired ${escapeHTML(formatTime(device.createdAt))}</small><small>${device.lastSeenAt ? `Last active ${escapeHTML(formatTime(device.lastSeenAt))}` : 'Not used yet'}</small></div>${actions}</article>`
  }).join('') : emptyState({ ic: 'server', title: 'No device records found' })
  document.querySelectorAll('.device-promote').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Make this device an owner? Owners can view and revoke other devices.')) return
    try {
      const response = await fetch(new URL(`/gateway/devices/${button.dataset.device}`, profile.url), { method: 'PATCH', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'owner' }) })
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `HTTP ${response.status}`) }
      notify('Device is now an owner'); await openDeviceManager()
    } catch (error) { notify(`Could not transfer ownership: ${error.message}`) }
  }))
  document.querySelectorAll('.device-revoke').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Revoke this device? It will lose access immediately.')) return
    button.disabled = true
    try {
      const response = await fetch(new URL(`/gateway/devices/${button.dataset.device}`, profile.url), { method: 'DELETE', headers: { Authorization: `Bearer ${credential}` } })
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `HTTP ${response.status}`) }
      notify('Device revoked')
      await openDeviceManager()
    } catch (error) { notify(`Could not revoke device: ${error.message}`); button.disabled = false }
  }))
}
function versionParts(value) { return String(value || '0').split('.').map((part) => Number(part.replace(/\D.*$/, '')) || 0) }
function versionBelow(value, minimum) { const a = versionParts(value); const b = versionParts(minimum); for (let i = 0; i < 3; i += 1) { if (a[i] !== b[i]) return a[i] < b[i] } return false }
async function openGatewayStatus() {
  const profile = profiles.find((item) => item.id === editingId)
  if (!profile) return
  const stored = readToken(profile)
  if (!stored.ok || !stored.value) return notify(stored.error || 'Pair this profile first')
  $('#statusSheet').hidden = false
  $('#statusList').innerHTML = skeletons(3)
  try {
    const response = await fetch(new URL('/health', profile.url), { headers: { Authorization: `Bearer ${stored.value}` } })
    const health = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(health.error || `HTTP ${response.status}`)
    const warning = versionBelow(health.gatewayVersion, '1.0.0') ? '<div class="warning"><strong>Update recommended</strong><p>This app expects gateway 1.0.0 or newer for device recovery and complete status reporting.</p></div>' : ''
    const rows = [['Gateway', health.gatewayVersion || 'Unknown'], ['OpenCode', health.opencodeVersion || (health.opencode ? 'Connected' : 'Unavailable')], ['Tailscale', health.tailscaleVersion || 'Not detected'], ['Paired devices', String(health.pairedDeviceCount ?? 'Unknown')], ['Your role', health.role || 'Unknown'], ['Started', health.startedAt ? new Date(health.startedAt).toLocaleString() : 'Unknown']]
    $('#statusList').innerHTML = warning + rows.map(([name, value]) => `<article class="status-row"><span>${escapeHTML(name)}</span><strong>${escapeHTML(value)}</strong></article>`).join('')
  } catch (error) { $('#statusList').innerHTML = emptyState({ ic: 'alert', title: 'Status unavailable', text: shortError(error) }) }
}
function downloadGateway() {
  if (!window.AndroidFiles || typeof window.AndroidFiles.exportGatewayPackage !== 'function') return notify('Gateway export is available in the installed Android app')
  $('#gatewayDownloadState').textContent = 'Choose where to save the gateway ZIP…'
  window.AndroidFiles.exportGatewayPackage()
}
function downloadInstaller(kind) {
  const method = kind === 'windows' ? 'exportWindowsInstaller' : 'exportDebianInstaller'
  if (!window.AndroidFiles || typeof window.AndroidFiles[method] !== 'function') return notify('Installer export is available in the installed Android app')
  $('#gatewayDownloadState').textContent = 'Choose where to save the installer…'
  window.AndroidFiles[method]()
}
window.gatewayExportFinished = function (ok, message) {
  $('#gatewayDownloadState').textContent = ok ? `${message}. Transfer it to the OpenCode computer and extract it.` : message
  notify(message)
}
function closeIntro() { $('#introVideo').pause(); $('#intro').hidden = true; document.body.classList.remove('intro-on'); if (!localStorage.getItem(WELCOME_KEY)) show('#welcomeScreen') }
function revealIntroVideo() { $('#introVideo').classList.add('ready') }
function addCopyButtons() {
  document.querySelectorAll('.route pre').forEach((pre) => {
    const wrap = document.createElement('div')
    wrap.className = 'cmd'
    pre.replaceWith(wrap)
    wrap.appendChild(pre)
    const button = document.createElement('button')
    button.className = 'copy-command'
    button.type = 'button'
    button.textContent = 'Copy'
    button.addEventListener('click', () => copyText(pre.textContent).then((ok) => notify(ok ? 'Command copied' : 'Could not copy command')))
    wrap.appendChild(button)
  })
}
window.handleAndroidBack = function () {
  if (!$('#intro').hidden) { closeIntro(); return true }
  if (!$('#exportSheet').hidden) { $('#exportSheet').hidden = true; return true }
  if (!$('#sessionSheet').hidden) { $('#sessionSheet').hidden = true; return true }
  if (!$('#providerSheet').hidden) { $('#providerSheet').hidden = true; return true }
  if (!$('#deviceSheet').hidden) { $('#deviceSheet').hidden = true; return true }
  if (!$('#statusSheet').hidden) { $('#statusSheet').hidden = true; return true }
  if (!$('#setupGuide').hidden) { closeGuide(); return true }
  if (currentScreen === '#chatScreen' && searchOpen()) { closeChatSearch(); return true }
  if (currentScreen === '#chatScreen') { leaveChat(); show('#sessionsScreen'); loadSessions(); return true }
  if (currentScreen === '#projectsScreen' || currentScreen === '#modelsScreen') { show('#sessionsScreen'); return true }
  if (currentScreen === '#editorScreen' || currentScreen === '#welcomeScreen' || currentScreen === '#settingsScreen') { editingId = null; show('#connectionsScreen'); return true }
  if (currentScreen === '#sessionsScreen') { activeProfile = null; activeToken = ''; show('#connectionsScreen'); return true }
  return false
}
function escapeHTML(value) { const node = document.createElement('div'); node.textContent = value ?? ''; return node.innerHTML }
function formatTime(value) { return value ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '' }

$('#addProfile').addEventListener('click', () => editProfile())
$('#openSettings').addEventListener('click', () => { syncPhoneCard(); show('#settingsScreen') })
$('#backFromSettings').addEventListener('click', () => show('#connectionsScreen'))
$('#helpButton').addEventListener('click', openGuide)
$('#profileHelp').addEventListener('click', openGuide)
$('#skipWelcome').addEventListener('click', () => { localStorage.setItem(WELCOME_KEY, 'seen'); show('#connectionsScreen') })
$('#skipIntro').addEventListener('click', closeIntro)
$('#introVideo').addEventListener('ended', closeIntro)
$('#introVideo').addEventListener('playing', revealIntroVideo, { once: true })
$('#startAdding').addEventListener('click', () => { localStorage.setItem(WELCOME_KEY, 'seen'); editProfile() })
$('#openSetupGuide').addEventListener('click', openGuide)
$('#downloadGateway').addEventListener('click', downloadGateway)
$('#downloadWindowsInstaller').addEventListener('click', () => downloadInstaller('windows'))
$('#downloadDebianInstaller').addEventListener('click', () => downloadInstaller('debian'))
$('#closeSetupGuide').addEventListener('click', closeGuide)
$('#guideAddProfile').addEventListener('click', () => { closeGuide(); localStorage.setItem(WELCOME_KEY, 'seen'); editProfile() })
document.querySelectorAll('[data-route]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-route]').forEach((item) => item.classList.toggle('active', item === button))
  document.querySelectorAll('.route').forEach((route) => route.classList.toggle('active', route.id === `route-${button.dataset.route}`))
  syncSeg(button.parentElement)
}))
$('#cancelProfile').addEventListener('click', () => { editingId = null; show('#connectionsScreen') })
$('#pairProfile').addEventListener('click', pairProfile)
$('#manageDevices').addEventListener('click', openDeviceManager)
$('#gatewayStatus').addEventListener('click', openGatewayStatus)
$('#closeDeviceSheet').addEventListener('click', () => { $('#deviceSheet').hidden = true })
$('#closeStatusSheet').addEventListener('click', () => { $('#statusSheet').hidden = true })
$('#explainPairing').addEventListener('click', () => { $('#pairHelp').hidden = !$('#pairHelp').hidden })
$('#profileUrl').addEventListener('input', () => {
  const changed = $('#profileUrl').value.trim().replace(/\/$/, '') !== originalProfileUrl
  if (changed) { pendingToken = ''; $('#saveProfile').disabled = true; $('#testResult').textContent = 'Pair with this gateway URL before saving.' }
  else if (editingId) { const stored = readToken(profiles.find((profile) => profile.id === editingId)); $('#saveProfile').disabled = !(stored.ok && stored.exists && stored.value) }
})
$('#profileForm').addEventListener('submit', commitProfile)
$('#deleteProfile').addEventListener('click', deleteProfile)
$('#backConnections').addEventListener('click', () => { activeProfile = null; activeToken = ''; show('#connectionsScreen') })
$('#refreshSessions').addEventListener('click', loadSessions)
$('#createSession').addEventListener('click', createSession)
$('#backSessions').addEventListener('click', () => { leaveChat(); show('#sessionsScreen'); loadSessions() })
$('#reloadMessages').addEventListener('click', loadMessages)
$('#exportConversation').addEventListener('click', openExportSheet)
$('#closeExportSheet').addEventListener('click', () => { $('#exportSheet').hidden = true })
$('#saveConversation').addEventListener('click', saveConversationMarkdown)
$('#shareConversation').addEventListener('click', shareConversationMarkdown)
$('#promptForm').addEventListener('submit', sendPrompt)
$('#modelPicker').addEventListener('click', loadModels)
$('#backFromProjects').addEventListener('click', () => show('#sessionsScreen'))
$('#refreshProjects').addEventListener('click', loadProjects)
$('#backFromModels').addEventListener('click', () => show('#sessionsScreen'))
$('#refreshModels').addEventListener('click', loadModels)
$('#modelSearch').addEventListener('input', () => renderModels(false))
document.querySelectorAll('[data-model-filter]').forEach((button) => button.addEventListener('click', () => {
  modelFilter = button.dataset.modelFilter
  document.querySelectorAll('[data-model-filter]').forEach((item) => item.classList.toggle('active', item === button))
  $('#modelFilterNote').textContent = modelFilter === 'free' ? 'Only zero-cost text models from providers already connected to this OpenCode server.' : modelFilter === 'connected' ? 'All text-capable models whose provider credentials are configured.' : 'Discovery catalog only. Connect the provider before using a model.'
  syncSeg($('.model-tabs'))
  renderModels(false)
}))
$('#addOpenRouter').addEventListener('click', () => openProviderForm('openrouter'))
$('#addCustomProvider').addEventListener('click', () => openProviderForm('custom'))
$('#closeProviderSheet').addEventListener('click', () => { $('#providerSheet').hidden = true })
$('#providerForm').addEventListener('submit', saveProvider)
document.addEventListener('click', (event) => {
  const button = event.target.closest('button')
  if (button && !button.classList.contains('send')) { playSound('#soundButton', .7); tap() }
}, true)
// Shared tab bar + delegated list handlers (lists are re-rendered in place, so handlers live on the containers).
$('#tabbar').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tab]')
  if (!button) return
  if (button.dataset.tab === 'chats') { show('#sessionsScreen'); loadSessions() }
  else if (button.dataset.tab === 'projects') loadProjects()
  else if (button.dataset.tab === 'models') loadModels()
  else { leaveChat(); activeProfile = null; activeToken = ''; show('#connectionsScreen') }
})
$('#profileList').addEventListener('click', (event) => {
  if (event.target.closest('#emptyAdd')) return editProfile()
  const item = event.target.closest('.profile')
  if (!item) return
  if (event.target.closest('[data-edit]')) return editProfile(item.dataset.id)
  connectProfile(item.dataset.id)
})
$('#sessionList').addEventListener('click', (event) => {
  if (event.target.closest('#retrySessions')) return loadSessions()
  if (event.target.closest('#repairConnection')) return activeProfile && editProfile(activeProfile.id)
  const item = event.target.closest('.session-item')
  if (!item) return
  if (event.target.closest('[data-more]')) return openSessionSheet(item.dataset.id, item.dataset.title)
  openSession(item.dataset.id, item.dataset.title)
})
$('#sessionList').addEventListener('keydown', (event) => {
  const item = event.target.closest('.session-item')
  if (item && event.target === item && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openSession(item.dataset.id, item.dataset.title) }
})
$('#sessionList').addEventListener('contextmenu', (event) => {
  const item = event.target.closest('.session-item')
  if (item) { event.preventDefault(); openSessionSheet(item.dataset.id, item.dataset.title) }
})
$('#sessionSearch').addEventListener('input', renderSessions)
$('#sessionForm').addEventListener('submit', renameSession)
$('#deleteSession').addEventListener('click', deleteSessionNow)
$('#closeSessionSheet').addEventListener('click', () => { $('#sessionSheet').hidden = true })
$('#attachButton').addEventListener('click', () => $('#fileInput').click())
$('#fileInput').addEventListener('change', async (event) => { await addFiles(event.target.files); event.target.value = '' })
$('#attachTray').addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove]')
  if (remove) { pendingFiles.splice(Number(remove.dataset.remove), 1); renderTray() }
})
$('#micButton').addEventListener('click', () => {
  if (window.AndroidDevice && typeof window.AndroidDevice.voice === 'function') window.AndroidDevice.voice()
  else notify('Voice input is not available in this build')
})
$('#promptInput').addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 400); renderTray(); updateSendMode() })
$('#netBanner').addEventListener('click', () => { if (activeSession) { loadMessages(); startEvents() } else loadSessions() })
window.addEventListener('offline', () => setOffline(true))
window.addEventListener('online', () => { if (activeSession) { loadMessages(); startEvents() } })
document.addEventListener('visibilitychange', () => { if (document.hidden) saveDraft(); else if (activeSession) { loadMessages(); if (!eventsLive) startEvents() } })
$('#projectList').addEventListener('click', (event) => {
  const item = event.target.closest('.project-item')
  if (item) selectProject(item.dataset.directory)
})
$('#modelList').addEventListener('click', (event) => {
  const item = event.target.closest('.model-item')
  if (item) selectModel(item.dataset.provider, item.dataset.model, item.dataset.name)
})
const cancelPin = () => { pinUntil = 0 }
;['touchstart', 'wheel', 'pointerdown', 'keydown'].forEach((name) => $('#messages').addEventListener(name, cancelPin, { passive: true }))
$('#messages').addEventListener('scroll', () => {
  const container = $('#messages')
  const mode = autoScrollMode()
  follow = mode === 'always' || (mode === 'smart' && distanceBelow(container) <= FOLLOW_SLACK)
  if (follow) pendingNew = false
  lastScrollH = container.scrollHeight
  syncBottomButton()
}, { passive: true })
$('#toBottom').addEventListener('click', () => {
  follow = true; pendingNew = false
  scrollToEnd()
  lastScrollH = $('#messages').scrollHeight
  syncBottomButton()
})
$('#messages').addEventListener('click', (event) => {
  const head = event.target.closest('[data-tool-toggle]')
  if (head) toggleTool(head.closest('.message'))
})
$('#messages').addEventListener('keydown', (event) => {
  const head = event.target.closest('[data-tool-toggle]')
  if (head && event.target === head && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggleTool(head.closest('.message')) }
})
$('#queueTray').addEventListener('click', (event) => {
  const remove = event.target.closest('[data-queue-remove]')
  if (remove) { const list = queues.get(activeSession) || []; list.splice(Number(remove.dataset.queueRemove), 1); renderQueue(); return }
  if (event.target.closest('[data-queue-resume]')) { pausedSessions.delete(activeSession); renderQueue(); maybeFlushQueue() }
})
$('#pinSession').addEventListener('click', () => {
  if (!sheetSession) return
  const flag = !pinnedIds().has(sheetSession.id)
  setPinned(sheetSession.id, flag)
  $('#sessionSheet').hidden = true
  renderSessions()
  notify(flag ? 'Pinned to top' : 'Unpinned')
})
$('#chatUsage').addEventListener('click', () => { if ($('#chatUsage').__detail) notify($('#chatUsage').__detail) })
$('#searchToggle').addEventListener('click', () => (searchOpen() ? closeChatSearch() : openChatSearch()))
$('#chatSearchClose').addEventListener('click', closeChatSearch)
$('#chatSearchPrev').addEventListener('click', () => stepSearch(-1))
$('#chatSearchNext').addEventListener('click', () => stepSearch(1))
$('#chatSearchInput').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runChatSearch(), 180) })
$('#chatSearchInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); stepSearch(event.shiftKey ? -1 : 1) }
  else if (event.key === 'Escape') closeChatSearch()
})
window.addEventListener('resize', updateViewportInsets)
window.visualViewport?.addEventListener('resize', updateViewportInsets)
window.visualViewport?.addEventListener('scroll', updateViewportInsets)
document.addEventListener('visibilitychange', syncChatBackground)

/* ── Plan / todo panel ──────────────────────────────────────────────────── */
const TODO_STATES = ['pending', 'in_progress', 'completed', 'cancelled']

function todosFromMessages(messages) {
  for (let m = messages.length - 1; m >= 0; m--) {
    const parts = messages[m].parts || []
    for (let p = parts.length - 1; p >= 0; p--) {
      const part = parts[p]
      if (part.type !== 'tool' || String(part.tool || '').toLowerCase() !== 'todowrite') continue
      const list = part.state?.input?.todos || part.state?.metadata?.todos
      if (Array.isArray(list)) return list
    }
  }
  return []
}

function setTodos(list) {
  const todos = (Array.isArray(list) ? list : []).filter((item) => item && typeof item.content === 'string' && item.content.trim())
    .map((item) => ({ content: item.content.trim(), status: TODO_STATES.includes(item.status) ? item.status : 'pending' }))
  const signature = JSON.stringify(todos)
  if (signature === todoSig) return
  todoSig = signature
  const panel = $('#todoPanel')
  if (!todos.length) { panel.hidden = true; $('#todoList').innerHTML = ''; return }
  const total = todos.filter((item) => item.status !== 'cancelled').length || todos.length
  const done = todos.filter((item) => item.status === 'completed').length
  const active = todos.find((item) => item.status === 'in_progress')
  const complete = done >= total
  panel.hidden = false
  panel.classList.toggle('complete', complete)
  $('#todoTitle').textContent = active ? active.content : complete ? 'Plan complete' : 'Plan'
  $('#todoCount').textContent = `${done}/${total}`
  $('#todoFill').style.width = `${Math.round((done / total) * 100)}%`
  $('#todoList').innerHTML = todos.map((item) => `<li data-status="${item.status}">${escapeHTML(item.content)}</li>`).join('')
  applyTodoOpen()
}

function applyTodoOpen() {
  const open = localStorage.getItem(TODO_OPEN_KEY) === '1'
  $('#todoList').hidden = !open
  $('#todoToggle').setAttribute('aria-expanded', String(open))
  $('#todoPanel').classList.toggle('open', open)
}

$('#todoToggle').addEventListener('click', () => {
  try { localStorage.setItem(TODO_OPEN_KEY, localStorage.getItem(TODO_OPEN_KEY) === '1' ? '0' : '1') } catch (_) {}
  applyTodoOpen()
  tap()
  requestAnimationFrame(() => { if (follow) scrollToEnd(); else syncBottomButton() })
})

/* ── Native entry points: shortcuts, widget, notifications ──────────────── */
window.nativeOpenSession = async (profileId, sessionId, title) => {
  if (!$('#intro').hidden) closeIntro()
  if (!profiles.some((profile) => profile.id === profileId)) { notify('That connection no longer exists'); return }
  if (currentScreen === '#chatScreen' && activeSession === sessionId && activeProfile?.id === profileId) return
  if (activeSession) { leaveChat(); show('#sessionsScreen') }
  if (!activeProfile || activeProfile.id !== profileId || !activeToken) await connectProfile(profileId)
  if (!activeProfile || activeProfile.id !== profileId || !activeToken) return
  await openSession(sessionId, title || 'Session')
}

window.nativeNewChat = async () => {
  if (!$('#intro').hidden) closeIntro()
  if (!profiles.length) { notify('Add a connection first'); show('#connectionsScreen'); return }
  let id = null
  try { id = localStorage.getItem(LAST_PROFILE_KEY) } catch (_) {}
  if (!profiles.some((profile) => profile.id === id)) id = profiles.length === 1 ? profiles[0].id : null
  if (!id) { notify('Choose a server to start a new chat'); show('#connectionsScreen'); return }
  if (activeSession) { leaveChat(); show('#sessionsScreen') }
  if (!activeProfile || activeProfile.id !== id || !activeToken) await connectProfile(id)
  if (!activeProfile || activeProfile.id !== id || !activeToken) return
  await createSession()
}

// Called by the native watcher when a watched session changes while the app is on screen.
window.nativeTaskEvent = (kind, sessionId, title) => {
  if (currentScreen === '#chatScreen' && sessionId === activeSession) return
  const name = title || 'A session'
  if (kind === 'permission') { notify(`${name} needs your approval`); haptic('attention') }
  else { notify(kind === 'failed' ? `${name} stopped with an error` : `${name} finished`); haptic(kind === 'failed' ? 'error' : 'done') }
  if (currentScreen === '#sessionsScreen') loadSessions()
}

window.notifyPermissionResult = (granted) => {
  if (!granted) {
    try { localStorage.setItem(NOTIFY_KEY, 'off') } catch (_) {}
    syncPhoneCard()
    notify('Notifications are blocked. Allow them in Android settings to get alerts.')
  }
}

/* ── “On this phone” settings ───────────────────────────────────────────── */
function syncPhoneCard() {
  $('#notifyToggle').checked = prefOn(NOTIFY_KEY)
  $('#hapticToggle').checked = prefOn(HAPTIC_KEY)
  const volume = String(Math.round(soundVolume() * 100))
  $('#soundVolume').value = volume
  $('#soundVolume').style.setProperty('--range', `${volume}%`)
  $('#soundVolumeValue').textContent = `${volume}%`
  $('#autoScroll').value = autoScrollMode()
  $('#fontSize').value = prefValue(FONT_SIZE_KEY, '100')
}
function applyFontSize(value = prefValue(FONT_SIZE_KEY, '100')) {
  const percent = ['100', '115', '130'].includes(String(value)) ? Number(value) : 100
  document.body.dataset.fontSize = String(percent)
  try { nativeDevice?.setTextZoom?.(percent) } catch (_) {}
}
syncPhoneCard()
applyFontSize()
if (nativeDevice && typeof nativeDevice.haptic === 'function') {
  $('#notifyToggle').addEventListener('change', (event) => {
    const on = event.target.checked
    try { localStorage.setItem(NOTIFY_KEY, on ? 'on' : 'off') } catch (_) {}
    if (on) { try { nativeDevice.requestNotifications() } catch (_) {} }
    else if (activeSession) unwatchSession(activeSession)
  })
  $('#hapticToggle').addEventListener('change', (event) => {
    try { localStorage.setItem(HAPTIC_KEY, event.target.checked ? 'on' : 'off') } catch (_) {}
    if (event.target.checked) { try { nativeDevice.haptic('done') } catch (_) {} }
  })
} else {
  $('#notifyToggle').disabled = true
  $('#hapticToggle').disabled = true
}

$('#soundVolume').addEventListener('input', (event) => {
  const value = String(event.target.value)
  event.target.style.setProperty('--range', `${value}%`)
  $('#soundVolumeValue').textContent = `${value}%`
  try { localStorage.setItem(SOUND_VOLUME_KEY, value) } catch (_) {}
})
$('#soundVolume').addEventListener('change', () => playSound('#soundButton', 1))
$('#autoScroll').addEventListener('change', (event) => {
  try { localStorage.setItem(AUTO_SCROLL_KEY, event.target.value) } catch (_) {}
  follow = event.target.value === 'always' || (event.target.value === 'smart' && distanceBelow() <= FOLLOW_SLACK)
  if (follow) { pendingNew = false; scrollToEnd() }
  syncBottomButton()
})
$('#fontSize').addEventListener('change', (event) => {
  try { localStorage.setItem(FONT_SIZE_KEY, event.target.value) } catch (_) {}
  applyFontSize(event.target.value)
  requestAnimationFrame(updateViewportInsets)
})

migrateLegacyTokens()
renderProfiles()
updateViewportInsets()
addCopyButtons()
$('#intro').hidden = false
document.body.classList.add('intro-on')
if ($('#introVideo').readyState >= 2) revealIntroVideo()
$('#introVideo').play().catch(() => {})

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-msg-action]')
  if (!button) return
  const message = button.closest('.message')
  if (button.dataset.msgAction === 'retry') { retryLast(); return }
  const text = message?.__fullText || message?.__text || message?.querySelector('.bubble')?.innerText || ''
  if (!text) return
  tap()
  if (button.dataset.msgAction === 'copy') {
    copyText(text).then((ok) => {
      notify(ok ? 'Copied' : 'Could not copy')
      if (!ok) return
      const label = button.querySelector('span')
      button.classList.add('done'); label.textContent = 'Copied'
      setTimeout(() => { button.classList.remove('done'); label.textContent = 'Copy' }, 1500)
    })
  } else editFromMessage(message)
})


/* ── Follow the answer only while you are at the bottom ─────────────────── */
function contentEnd(container) {
  for (let index = container.children.length - 1; index >= 0; index--) {
    const el = container.children[index]
    if (!el.hidden && el.offsetParent !== null) return el.offsetTop + el.offsetHeight
  }
  return 0
}

// How far the end of the conversation is below the visible area (the big
// "pin the question" padding is deliberately ignored).
function distanceBelow(container = $('#messages')) { return contentEnd(container) + 22 - (container.scrollTop + container.clientHeight) }

function syncBottomButton() {
  const button = $('#toBottom')
  const distance = distanceBelow()
  const fresh = pendingNew && distance > FOLLOW_SLACK
  button.classList.toggle('has-new', fresh)
  button.classList.toggle('show', fresh || distance > 260)
}

function scrollToEnd() {
  const container = $('#messages')
  const target = Math.max(0, contentEnd(container) + 22 - container.clientHeight)
  if (target > container.scrollTop) container.scrollTop = target
}

let followFrame = 0
function afterGrowth() {
  const container = $('#messages')
  if (!container || currentScreen !== '#chatScreen') return
  const grew = container.scrollHeight > lastScrollH + 1
  lastScrollH = container.scrollHeight
  const mode = autoScrollMode()
  if (mode === 'always') follow = true
  if (mode !== 'off' && follow) {
    if (Date.now() < pinUntil || followFrame) return
    followFrame = requestAnimationFrame(() => { followFrame = 0; scrollToEnd(); lastScrollH = container.scrollHeight; syncBottomButton() })
    return
  }
  if (grew && distanceBelow(container) > FOLLOW_SLACK) pendingNew = true
  syncBottomButton()
}

/* ── Tool details ───────────────────────────────────────────────────────── */
function toggleTool(node, force) {
  if (!node || !node.__part) return
  const open = force === undefined ? !node.__open : force
  if (open === !!node.__open) return
  node.__open = open
  node.innerHTML = toolChipHtml(node.__part, open, true)
  if (open) follow = false
  lastScrollH = $('#messages').scrollHeight
  syncBottomButton()
}

/* ── Token and cost display ─────────────────────────────────────────────── */
function renderUsage(messages) {
  const el = $('#chatUsage')
  const sum = { input: 0, output: 0, reasoning: 0, read: 0, write: 0, cost: 0 }
  messages.forEach((entry) => {
    const info = entry.info
    if (info?.role !== 'assistant') return
    const tokens = info.tokens || {}
    sum.input += Number(tokens.input) || 0
    sum.output += Number(tokens.output) || 0
    sum.reasoning += Number(tokens.reasoning) || 0
    sum.read += Number(tokens.cache?.read) || 0
    sum.write += Number(tokens.cache?.write) || 0
    sum.cost += Number(info.cost) || 0
  })
  const total = sum.input + sum.output + sum.reasoning
  if (!total && !sum.cost) { el.hidden = true; el.textContent = ''; el.__detail = ''; return }
  el.hidden = false
  el.textContent = ` · ${fmtTokens(total)} tok${sum.cost > 0 ? ` · ${fmtCost(sum.cost)}` : ''}`
  el.__detail = `Input ${fmtTokens(sum.input)} · Output ${fmtTokens(sum.output)}${sum.reasoning ? ` · Reasoning ${fmtTokens(sum.reasoning)}` : ''} · Cache ${fmtTokens(sum.read)} read / ${fmtTokens(sum.write)} write · ${sum.cost > 0 ? `Cost ${fmtCost(sum.cost)}` : 'Cost not reported'}`
}

/* ── Search inside the conversation ─────────────────────────────────────── */
const CAN_HIGHLIGHT = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
let searchMatches = []
let searchIndex = -1
let searchTimer = null

function searchOpen() { return !$('#chatSearch').hidden }

function openChatSearch() {
  $('#chatSearch').hidden = false
  $('#searchToggle').classList.add('on')
  const input = $('#chatSearchInput')
  input.focus(); input.select()
  if (input.value.trim()) runChatSearch()
}

function clearSearchHighlights() {
  if (CAN_HIGHLIGHT) { CSS.highlights.delete('chat-find'); CSS.highlights.delete('chat-find-current') }
  document.querySelectorAll('#messages .search-hit, #messages .search-current').forEach((node) => node.classList.remove('search-hit', 'search-current'))
}

function closeChatSearch() {
  const bar = $('#chatSearch')
  if (bar.hidden) return
  bar.hidden = true
  $('#searchToggle').classList.remove('on')
  clearTimeout(searchTimer)
  clearSearchHighlights()
  searchMatches = []; searchIndex = -1
  updateSearchCount()
  $('#chatSearchInput').blur()
}

function collectTextRanges(root, query) {
  const ranges = []
  if (!root) return ranges
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement && !node.parentElement.closest('.msg-actions, .msg-meta, .code-head, .diff-head') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.toLowerCase()
    for (let from = 0; ranges.length < 500;) {
      const at = text.indexOf(query, from)
      if (at < 0) break
      const range = document.createRange()
      range.setStart(node, at); range.setEnd(node, at + query.length)
      ranges.push(range)
      from = at + query.length
    }
  }
  return ranges
}

function updateSearchCount() {
  const query = $('#chatSearchInput').value.trim()
  $('#chatSearchCount').textContent = !query ? '' : searchMatches.length ? `${searchIndex + 1}/${searchMatches.length}` : '0'
  const none = !searchMatches.length
  $('#chatSearchPrev').disabled = none
  $('#chatSearchNext').disabled = none
}

function runChatSearch({ keep = false, scroll = true } = {}) {
  const query = $('#chatSearchInput').value.trim().toLowerCase()
  const previousIndex = searchIndex
  clearSearchHighlights()
  searchMatches = []
  if (query.length >= 2) {
    $('#messages').querySelectorAll(':scope > .message[data-key], :scope > .message.optimistic').forEach((node) => {
      if (node.classList.contains('tool-message')) {
        if (node.__part && toolSearchText(node.__part).includes(query)) searchMatches.push({ node, tool: true })
        return
      }
      collectTextRanges(node, query).forEach((range) => searchMatches.push({ node, range }))
    })
  }
  searchIndex = !searchMatches.length ? -1 : keep && previousIndex >= 0 ? Math.min(previousIndex, searchMatches.length - 1) : searchMatches.length - 1
  showCurrentMatch(scroll)
}

function showCurrentMatch(scroll) {
  const query = $('#chatSearchInput').value.trim().toLowerCase()
  const match = searchMatches[searchIndex]
  document.querySelectorAll('#messages .search-current').forEach((node) => node.classList.remove('search-current'))
  searchMatches.forEach((entry) => entry.node.classList.add('search-hit'))
  if (match && match.tool && !match.node.__open) toggleTool(match.node, true)
  if (match && match.tool) match.range = collectTextRanges(match.node.querySelector('.tool-body'), query)[0] || null
  if (CAN_HIGHLIGHT) {
    const all = searchMatches.filter((entry) => entry.range && !entry.tool).map((entry) => entry.range)
    searchMatches.filter((entry) => entry.tool && entry.node.__open).forEach((entry) => all.push(...collectTextRanges(entry.node.querySelector('.tool-body'), query)))
    if (all.length) CSS.highlights.set('chat-find', new Highlight(...all)); else CSS.highlights.delete('chat-find')
    if (match && match.range) CSS.highlights.set('chat-find-current', new Highlight(match.range)); else CSS.highlights.delete('chat-find-current')
  }
  updateSearchCount()
  if (!match) return
  match.node.classList.add('search-current')
  if (!scroll) return
  const container = $('#messages')
  const rect = (match.range || match.node).getBoundingClientRect()
  const box = container.getBoundingClientRect()
  container.scrollTo({ top: Math.max(0, container.scrollTop + rect.top - box.top - container.clientHeight * 0.3), behavior: 'smooth' })
}

function stepSearch(direction) {
  if (!searchMatches.length) return
  searchIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length
  showCurrentMatch(true)
}

// Messages re-render while OpenCode streams; keep the highlights in sync without moving the view.
function refreshChatSearch() {
  if (!searchOpen() || !$('#chatSearchInput').value.trim()) return
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => runChatSearch({ keep: true, scroll: false }), 300)
}
