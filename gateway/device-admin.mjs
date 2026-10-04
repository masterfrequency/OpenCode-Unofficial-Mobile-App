import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const storeFile = process.env.DEVICE_STORE_FILE ? resolve(process.env.DEVICE_STORE_FILE) : fileURLToPath(new URL('.devices.json', import.meta.url))
const [command = 'list', deviceID] = process.argv.slice(2)
if (!existsSync(storeFile)) throw new Error(`Device store not found: ${storeFile}`)
const store = JSON.parse(readFileSync(storeFile, 'utf8'))
if (store?.version !== 1 || !Array.isArray(store.devices)) throw new Error('Invalid device store')

if (command === 'list') {
  console.table(store.devices.map(({ id, name, role, createdAt, lastSeenAt }) => ({ id, name, role, createdAt, lastSeenAt: lastSeenAt || 'never' })))
} else if (command === 'promote') {
  const device = requireDevice(deviceID)
  device.role = 'owner'
  save()
  console.log(`Promoted ${device.name} (${device.id}) to owner.`)
} else if (command === 'revoke') {
  const index = store.devices.findIndex((device) => device.id === deviceID)
  if (index < 0) throw new Error('Device not found')
  const [device] = store.devices.splice(index, 1)
  save()
  console.log(`Revoked ${device.name} (${device.id}).`)
} else if (command === 'reset') {
  if (process.argv[3] !== '--confirm') throw new Error('Reset disconnects every phone. Run: node device-admin.mjs reset --confirm')
  store.devices = []
  save()
  console.log('All paired devices removed. Restart the gateway and pair a new owner.')
} else {
  throw new Error('Usage: node device-admin.mjs list | promote DEVICE_ID | revoke DEVICE_ID | reset --confirm')
}

function requireDevice(id) {
  const device = store.devices.find((item) => item.id === id)
  if (!device) throw new Error('Device not found')
  return device
}

function save() {
  const temporary = `${storeFile}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, storeFile)
  chmodSync(storeFile, 0o600)
}
