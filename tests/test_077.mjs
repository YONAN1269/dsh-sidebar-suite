// CH-07 — GET `/api/dsh-temp-session.trash` is read-only: listing the trash
// must never prune an entry. Retention still runs at boot (ensureReady) and on
// the scheduled purge (purgeAll).
//
// CH-05 / CH-08 — POST body caps: web-login-save 128KB, temp-session.config
// 16KB; an oversized body is rejected 413 before any parsing or write.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOME = mkdtempSync(join(tmpdir(), 'dsbs-077-'))
process.env.DSH_HOME = HOME

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

function makeCtx() {
  const registered = []
  return {
    registered,
    get(name) {
      if (name !== 'connection') return null
      return { fetch: { register(spec) { registered.push(spec) } } }
    },
    logger: { debug() {}, warn() {}, info() {}, error() {} },
  }
}

function seedTrash(key, id) {
  const dir = join(HOME, 'dsh-sidebar-suite', 'trash', key)
  mkdirSync(join(dir, 'data'), { recursive: true })
  writeFileSync(join(dir, 'data', 'session.jsonl'), 'x')
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({
    id, workspace: '--proj--', deletedAt: '2020-01-01T00:00:00.000Z', reason: 'test', title: '',
  }))
  return dir
}

async function main() {
  const tempModule = await import(pathToFileURL(ROOT + '/lib/temp-session-host.mjs').href)
  const tempCtx = makeCtx()
  const tempHost = tempModule.createTempSessionHost(tempCtx)
  tempHost.register(tempCtx)
  // Let the boot pass (its own retention prune) finish before seeding entries,
  // so any prune observed on the GET route can be attributed to the listing.
  await tempHost.ensureReady()

  const trashRoute = tempCtx.registered.find((r) => r.path === '/api/dsh-temp-session.trash')
  check('CH-07: the trash GET route is mounted', !!trashRoute)

  const dirA = seedTrash('1700000000000-session-077-a', 'session-077-a')
  const dirB = seedTrash('1700000000001-session-077-b', 'session-077-b')

  const prunesBefore = tempHost.state.trashPrunes
  const listed = await (await trashRoute.fetch(new Request('http://localhost/api/dsh-temp-session.trash'))).json()
  check('CH-07: the GET route lists both seeded entries',
    listed.ok === true && listed.entries.length === 2, JSON.stringify(listed.entries))
  check('CH-07: the GET route does not prune anything',
    tempHost.state.trashPrunes === prunesBefore,
    `prunes ${prunesBefore} -> ${tempHost.state.trashPrunes}`)
  check('CH-07: both entry directories survive the read-only GET',
    existsSync(dirA) && existsSync(dirB), [dirA, dirB].join(','))

  // Retention still runs off the boot/scheduled paths, not off the listing.
  await tempHost.purgeAll('test-retention')
  check('CH-07: the purge path still removes expired entries',
    !existsSync(dirA) && !existsSync(dirB), 'dirs after purge')

  // Source contract: the GET handler block must not call pruneTrashSync.
  const tempSrc = readFileSync(ROOT + '/lib/temp-session-host.mjs', 'utf8')
  const trashBlock = tempSrc.slice(
    tempSrc.indexOf("'/api/dsh-temp-session.trash'"),
    tempSrc.indexOf("'/api/dsh-temp-session.trash-restore'"),
  )
  check('CH-07: the GET trash handler contains no prune call',
    trashBlock.indexOf('pruneTrashSync') < 0)
  check('CH-07: ensureReady still prunes at boot',
    /ensureReady\(\)[\s\S]*?pruneTrashSync\(\)/.test(tempSrc))
  check('CH-07: purgeAll (scheduled/manual) still prunes the trash',
    /async function purgeAll[\s\S]*?pruneTrashSync\(\)/.test(tempSrc))

  // ---- CH-05: web-login-save body over 128KB -> 413 -----------------------
  const webModule = await import(pathToFileURL(ROOT + '/lib/web-login-host.mjs').href)
  const webCtx = makeCtx()
  const webHost = webModule.createWebLoginHost({ get: () => null })
  webHost.register(webCtx)
  const saveRoute = webCtx.registered.find((r) => r.path === '/api/dsh-sidebar-suite.web-login-save')
  check('CH-05: the save route is mounted', !!saveRoute)

  const oversizedSave = JSON.stringify({ page: 'chat', entries: { userToken: 'x'.repeat(130 * 1024) } })
  const saveRes = await saveRoute.fetch(new Request('http://localhost/api/dsh-sidebar-suite.web-login-save', {
    method: 'POST',
    body: oversizedSave,
  }))
  const saveBody = await saveRes.json()
  check('CH-05: an oversized save body returns 413 without parsing',
    saveRes.status === 413 && saveBody.ok === false, JSON.stringify({ status: saveRes.status, body: saveBody }))
  check('CH-05: nothing was written for the rejected save',
    webHost.state.writes === 0, String(webHost.state.writes))

  // A normal-sized body is still accepted by the size gate (validation may
  // reject it for other reasons, but not with 413).
  const smallSave = JSON.stringify({ page: 'chat', entries: { userToken: 'TEST-VALUE' } })
  const smallRes = await saveRoute.fetch(new Request('http://localhost/api/dsh-sidebar-suite.web-login-save', {
    method: 'POST',
    body: smallSave,
  }))
  check('CH-05: a normal save body is not a 413', smallRes.status !== 413, String(smallRes.status))

  // ---- CH-08: config POST body over 16KB -> 413 --------------------------
  const configRoute = tempCtx.registered.find((r) => r.path === '/api/dsh-temp-session.config')
  check('CH-08: the config route is mounted', !!configRoute)
  const oversizedConfig = JSON.stringify({ keepDeleted: true, filler: 'y'.repeat(20 * 1024) })
  const configRes = await configRoute.fetch(new Request('http://localhost/api/dsh-temp-session.config', {
    method: 'POST',
    body: oversizedConfig,
  }))
  const configBody = await configRes.json()
  check('CH-08: an oversized config body returns 413 before parsing',
    configRes.status === 413 && configBody.ok === false, JSON.stringify({ status: configRes.status, body: configBody }))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => {
    process.removeAllListeners('exit')
    try { rmSync(HOME, { recursive: true, force: true }) }
    catch (error) { console.error('CLEANUP_FAIL ' + HOME + ' ' + error.code + ' ' + error.message) }
  })
