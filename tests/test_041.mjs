// dsh-sidebar-suite 0.7.2 — four reliability defects found in the follow-up
// audit of the "temporary = gone on exit" promise.
//
// #1 DELETE_ON_EXIT=off was ignored on quit: the exit hook called purgeSync
//    unconditionally, deleting sessions the user believed were kept forever.
//    purgeOnExit() now re-reads the on-disk config synchronously.
// #2 saveStore() swallowed write failures, so untrack() ("keep as permanent")
//    reported ok:true while the id stayed on disk — the next launch reloaded it
//    and DELETED the session. Writes now report failure and callers roll back.
// #3 purgeAll() assigned a snapshot-derived `kept` array wholesale, erasing any
//    id added by a concurrent track() during its awaits. It now removes only the
//    ids it actually deleted, from the CURRENT list.
// #4 (client) loadTempStatus gave up after 3 failures; a startup race left temp
//    badges and the keep/delete menu dead for the whole page session. Covered
//    by a source assertion below (browser code, no DOM harness here).
//
// Everything runs against a throwaway DSH_HOME. No machine-specific paths.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOST = pathToFileURL(path.join(ROOT, 'lib', 'temp-session-host.mjs')).href
const CLIENT_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const HOST_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'temp-session-host.mjs'), 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-041-'))
process.env.DSH_HOME = HOME
const SESSIONS = path.join(HOME, 'sessions')
const DATA_DIR = path.join(HOME, 'dsh-sidebar-suite')
const STORE = path.join(DATA_DIR, 'temp-sessions.json')
const CONFIG = path.join(DATA_DIR, 'temp-session-config.txt')

function makeSession(workspace, id) {
  const dir = path.join(SESSIONS, workspace, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'), '{"role":"user"}\n', 'utf8')
  return dir
}

function makeCtx(routes) {
  return {
    get(name) {
      if (name === 'connection') return { fetch: { register(spec) { routes.set(spec.path, spec) } } }
      if (name === 'workspaceRegistry') return { archiveSession: async () => true }
      return null
    },
    logger: { debug() {}, warn() {}, info() {}, error() {} },
  }
}

async function boot(tag) {
  try { fs.rmSync(STORE, { force: true }) } catch (error) { void error }
  const mod = await import(HOST + '?v041=' + tag)
  const routes = new Map()
  const host = mod.createTempSessionHost(makeCtx(routes))
  host.register(makeCtx(routes))
  const statusRoute = routes.get('/api/dsh-temp-session.status')
  await statusRoute.fetch(new Request('http://localhost/api/dsh-temp-session.status'))
  return { host, routes, mod }
}

try {
  // ---- #1: DELETE_ON_EXIT=off is honoured on quit -----------------------
  const a = await boot('exit-off')
  const keepDir = makeSession('ws-exit', 'session-exit-keep')
  await a.host.track('session-exit-keep')
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(CONFIG, 'DELETE_ON_EXIT=off\n', 'utf8')
  const skipReport = a.host.purgeOnExit()
  check('exit-off: purgeOnExit skips when DELETE_ON_EXIT=off',
    skipReport && skipReport.skippedByConfig === true, JSON.stringify(skipReport))
  check('exit-off: session survives on disk', fs.existsSync(keepDir))
  check('exit-off: id stays tracked', a.host.state.tracked.includes('session-exit-keep'),
    JSON.stringify(a.host.state.tracked))

  // Flip back to on: the same call must now delete (fail-safe default honoured).
  fs.writeFileSync(CONFIG, 'DELETE_ON_EXIT=on\n', 'utf8')
  const doReport = a.host.purgeOnExit()
  check('exit-on: purgeOnExit deletes when DELETE_ON_EXIT=on',
    doReport && doReport.removed >= 1 && !fs.existsSync(keepDir), JSON.stringify(doReport))
  check('exit-on: source exit hook routes through purgeOnExit',
    /process\.once\('exit',[\s\S]{0,160}?purgeOnExit\(\)/.test(HOST_SRC))
  a.host.state.tracked = []

  // ---- #2: a failed store write is reported, not swallowed -------------
  const b = await boot('write-fail')
  const keepId = 'session-keep-permanent'
  makeSession('ws-write', keepId)
  await b.host.track(keepId)
  check('write-fail: setup tracked the id', b.host.state.tracked.includes(keepId))

  // Break the store's parent directory: mkdir/writeFile in saveStore now fail.
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
  fs.writeFileSync(DATA_DIR, 'occupied by a file', 'utf8')
  const failedUntrack = await b.host.untrack(keepId)
  check('write-fail: untrack reports ok:false on a failed write',
    failedUntrack && failedUntrack.ok === false, JSON.stringify(failedUntrack))
  check('write-fail: untrack rolls back so the id stays tracked',
    b.host.state.tracked.includes(keepId), JSON.stringify(b.host.state.tracked))
  check('write-fail: reason is surfaced to the caller',
    !!(failedUntrack && typeof failedUntrack.error === 'string' && failedUntrack.error.length > 0),
    JSON.stringify(failedUntrack))
  // saveStore now returns a boolean and callers check it. The write path grew
  // (per-write temp name, corrupt-file backup, rename fallback), so assert the
  // contract rather than the exact shape: a function that returns true on
  // success and false out of its catch.
  const saveStoreSrc = (HOST_SRC.split('async function saveStore()')[1] || '').split('\n}\n')[0]
  check('write-fail: saveStore returns a boolean on both paths',
    /return true/.test(saveStoreSrc) && /return false/.test(saveStoreSrc))
  // Restore the data dir so the finally cleanup and later sections work.
  fs.rmSync(DATA_DIR, { force: true })
  fs.mkdirSync(DATA_DIR, { recursive: true })
  b.host.state.tracked = []

  // ---- #3: a concurrent track during purgeAll is not erased ------------
  const c = await boot('concurrent')
  const victimId = 'session-concurrent-victim'
  const newcomerId = 'session-concurrent-newcomer'
  const victimDir = makeSession('ws-concurrent', victimId)
  await c.host.track(victimId)
  check('concurrent: setup tracked the victim', c.host.state.tracked.includes(victimId))

  // Start purgeAll (it will await removeSession). While it is suspended at the
  // first await, inject a new id via track(), then let purgeAll finish.
  const purgePromise = c.host.purgeAll('test-concurrent')
  const injected = c.host.track(newcomerId)
  await injected
  await purgePromise
  check('concurrent: victim directory was deleted', !fs.existsSync(victimDir))
  check('concurrent: newly tracked id survives the purge',
    c.host.state.tracked.includes(newcomerId), JSON.stringify(c.host.state.tracked))
  check('concurrent: victim id is gone from tracking',
    !c.host.state.tracked.includes(victimId), JSON.stringify(c.host.state.tracked))
  c.host.state.tracked = []

  // ---- #4: client no longer gives up permanently after 3 failures ------
  check('status-retry: no permanent tempStatusTries>=3 bailout',
    !/tempStatusTries >= 3/.test(CLIENT_SRC))
  check('status-retry: capped backoff on failure',
    /backoffMs = Math\.min\(1000 \* Math\.pow\(2, tempStatusTries - 1\), 15000\)/.test(CLIENT_SRC))
  check('status-retry: retries gated by a backoff deadline, not a hard count',
    /nowMs < tempStatusNextTry/.test(CLIENT_SRC))
} finally {
  process.removeAllListeners('exit')
  try { fs.rmSync(HOME, { recursive: true, force: true }) }
  catch (error) { console.error('CLEANUP_FAIL ' + HOME + ' ' + error.code + ' ' + error.message) }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
