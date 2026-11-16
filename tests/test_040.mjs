// dsh-sidebar-suite 0.7.0 — reliability fixes from the 0.6.1 code review.
//
// P1: `removeOne` used to drop a tracked id when the files were locked and the
//     row was only archived (hidden). The directory then lived on disk forever
//     with nobody tracking it — a direct breach of "temporary = gone on exit".
//     Now a hide-only result keeps the id and is reported as a failed delete.
// P2a: MAX_KEPT overflow trimming used to splice the oldest ids out and delete
//     them blindly. Now it skips a session in use right now and keeps any id
//     whose delete failed, and never deletes a newer session in their place.
// P2b: mutating routes are POST-only, so a GET (e.g. a prefetch) cannot delete.
// P3:  `safeSessionDir` now records WHY a guard refused a path instead of
//     silently returning '' with an empty lastError.
//
// Everything runs against a throwaway DSH_HOME. No machine-specific paths.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOST = pathToFileURL(path.join(ROOT, 'lib', 'temp-session-host.mjs')).href

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-040-'))
process.env.DSH_HOME = HOME
const SESSIONS = path.join(HOME, 'sessions')
const STORE = path.join(HOME, 'dsh-sidebar-suite', 'temp-sessions.json')
const CONFIG = path.join(HOME, 'dsh-sidebar-suite', 'temp-session-config.txt')

function makeSession(workspace, id, ageMs = 0) {
  const dir = path.join(SESSIONS, workspace, id)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'transcript.jsonl')
  fs.writeFileSync(file, '{"role":"user"}\n', 'utf8')
  if (ageMs > 0) {
    const old = new Date(Date.now() - ageMs)
    fs.utimesSync(file, old, old)
  }
  return dir
}

function makeCtx(routes, opts = {}) {
  return {
    get(name) {
      if (name === 'connection') return { fetch: { register(spec) { routes.set(spec.path, spec) } } }
      if (name === 'workspaceRegistry') {
        return {
          archiveSession: async (id) => {
            if (opts.archiveFails) throw new Error('archive refused')
            return true
          },
        }
      }
      return null
    },
    logger: { debug() {}, warn() {}, info() {}, error() {} },
  }
}

async function boot(tag, opts) {
  // Each boot must start from an empty tracking store: a fresh module instance
  // still reads whatever the previous section persisted to disk.
  try { fs.rmSync(STORE, { force: true }) } catch (error) { void error }
  const mod = await import(HOST + '?v040=' + tag)
  const routes = new Map()
  const host = mod.createTempSessionHost(makeCtx(routes, opts))
  host.register(makeCtx(routes, opts))
  const statusRoute = routes.get('/api/dsh-temp-session.status')
  await statusRoute.fetch(new Request('http://localhost/api/dsh-temp-session.status'))
  return { host, routes, mod }
}

async function call(routes, name, query, method = 'POST') {
  const route = routes.get('/api/dsh-temp-session.' + name)
  const url = 'http://localhost/api/dsh-temp-session.' + name + (query ? '?' + query : '')
  const res = await route.fetch(new Request(url, { method }))
  let body = null
  try { body = await res.json() } catch (error) { void error }
  return { status: res.status, body }
}

try {
  // ---- P2b: mutating routes are POST-only -------------------------------
  const a = await boot('methods')
  const mutating = ['track', 'untrack', 'remove', 'purge']
  for (const name of mutating) {
    const spec = a.routes.get('/api/dsh-temp-session.' + name)
    check('methods: ' + name + ' is POST-only',
      Array.isArray(spec.methods) && spec.methods.length === 1 && spec.methods[0] === 'POST',
      JSON.stringify(spec.methods))
  }
  for (const name of ['status', 'list', 'config', 'probe']) {
    const spec = a.routes.get('/api/dsh-temp-session.' + name)
    check('methods: ' + name + ' still allows GET',
      Array.isArray(spec.methods) && spec.methods.includes('GET'), JSON.stringify(spec.methods))
  }

  // ---- P1: a hide-only remove keeps the id tracked ----------------------
  // A symlink standing in for a session directory is refused by safeSessionDir
  // (no real directory to delete), so removeSession() removes 0 and the row is
  // only archived via hideSession. That is exactly the old leak path.
  const outside = path.join(HOME, 'outside-' + Date.now())
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'do not delete', 'utf8')
  const linkId = 'session-p1-hidden'
  const linkPath = path.join(SESSIONS, 'ws-p1', linkId)
  fs.mkdirSync(path.dirname(linkPath), { recursive: true })
  try {
    fs.symlinkSync(outside, linkPath, 'junction')
  } catch (error) {
    // Some filesystems refuse junctions; fall back to a plain missing dir so
    // removeSession still reports 0 and the hide path is exercised.
    try { fs.rmSync(linkPath, { force: true }) } catch (e) { void e }
  }
  await a.host.track(linkId)
  const removed = await call(a.routes, 'remove', 'sessionId=' + encodeURIComponent(linkId))
  check('p1: remove reports the hide outcome honestly',
    removed.body && removed.body.ok === true && removed.body.hidden === true && removed.body.removed === false,
    JSON.stringify(removed.body))
  check('p1: a hidden-not-deleted id stays tracked for a later retry',
    a.host.state.tracked.includes(linkId), JSON.stringify(a.host.state.tracked))
  check('p1: no tracked id is silently dropped on hide',
    Array.isArray(removed.body.ids) && removed.body.ids.includes(linkId), JSON.stringify(removed.body.ids))
  check('p1: outside target survived', fs.existsSync(path.join(outside, 'keep.txt')))

  // A real delete still forgets the id (regression guard for the happy path).
  const realId = 'session-p1-real'
  const realDir = makeSession('ws-p1', realId)
  await a.host.track(realId)
  const realRemoved = await call(a.routes, 'remove', 'sessionId=' + realId)
  check('p1: a real delete reports removed=true',
    realRemoved.body && realRemoved.body.removed === true, JSON.stringify(realRemoved.body))
  check('p1: a really deleted id is untracked',
    !a.host.state.tracked.includes(realId) && !fs.existsSync(realDir), JSON.stringify(a.host.state.tracked))
  a.host.state.tracked = []

  // ---- P2a: MAX_KEPT trimming protects active + failed deletes ---------
  const b = await boot('trim')
  b.host.saveConfig({ maxKept: 1 })
  // Three ids, oldest first. The oldest is ACTIVE (fresh mtime), the middle one
  // is idle and deletable, the newest must never be touched. With maxKept=1 and
  // three tracked ids there is an overflow of 2, so both oldest ids are
  // examined: active → kept, idle → deleted; the newest is never a candidate.
  const oldActive = 'session-trim-active'
  const midIdle = 'session-trim-idle'
  const newest = 'session-trim-new'
  const dirActive = makeSession('ws-trim', oldActive, 0)
  const dirIdle = makeSession('ws-trim', midIdle, 10 * 60 * 1000)
  const dirNew = makeSession('ws-trim', newest, 0)
  // Give the "newest" an old mtime too so only the explicit active case is protected.
  fs.utimesSync(path.join(dirNew, 'transcript.jsonl'),
    new Date(Date.now() - 10 * 60 * 1000), new Date(Date.now() - 10 * 60 * 1000))
  for (const id of [oldActive, midIdle, newest]) await b.host.track(id)
  // Overflow kicks in from the 2nd track (maxKept=1). After all three, the
  // oldest is active → kept, the middle is idle → deleted; the newest is never
  // a candidate. Result: {active, new}.
  check('trim: active oldest session is NOT deleted', fs.existsSync(dirActive))
  check('trim: active oldest session stays tracked', b.host.state.tracked.includes(oldActive), JSON.stringify(b.host.state.tracked))
  check('trim: idle middle session was trimmed', !fs.existsSync(dirIdle))
  check('trim: newest session is untouched', fs.existsSync(dirNew) && b.host.state.tracked.includes(newest))
  check('trim: no newer session was deleted in the active one\'s place',
    b.host.state.tracked.length === 2 &&
    b.host.state.tracked.includes(newest) &&
    b.host.state.tracked.includes(oldActive), JSON.stringify(b.host.state.tracked))
  b.host.state.tracked = []

  // ---- P3: guard refusals expose a reason -------------------------------
  const c = await boot('guard')
  c.host.state.lastError = ''
  // A workspace id containing a separator is refused by the plain-parse guard
  // before realpath; use a symlinked session dir instead so we go through the
  // realpath/lstat branch that used to be silent when it refused.
  const outside2 = path.join(HOME, 'outside2-' + Date.now())
  fs.mkdirSync(outside2, { recursive: true })
  const guardId = 'session-guard-symlink'
  const guardPath = path.join(SESSIONS, 'ws-guard', guardId)
  fs.mkdirSync(path.dirname(guardPath), { recursive: true })
  try { fs.symlinkSync(outside2, guardPath, 'junction') } catch (error) { void error }
  // purgeAll on the tracked symlink id must not delete the target, and either
  // the guard's reason or the archive failure must be visible in lastError.
  await c.host.track(guardId)
  const purge = await call(c.routes, 'purge')
  check('guard: purge reports a failed id for the refused path',
    purge.body && Array.isArray(purge.body.failed) && purge.body.failed.includes(guardId),
    JSON.stringify(purge.body))
  check('guard: outside target survived a symlinked session id', fs.existsSync(outside2))
  // Source-level: the guard now writes lastError instead of swallowing errors.
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'temp-session-host.mjs'), 'utf8')
  check('guard: source records path-guard errors in lastError',
    /state\.lastError = `session path guard: \$\{code\}/.test(src))
  c.host.state.tracked = []

  // ---- test_020 is opt-in ------------------------------------------------
  const t020 = fs.readFileSync(path.join(ROOT, 'tests', 'test_020.mjs'), 'utf8')
  check('test_020: compat checks are opt-in via DSH_CHAT_CLIENT',
    /const CHAT_CLIENT = process\.env\.DSH_CHAT_CLIENT \|\| ''/.test(t020) &&
    /if \(CHAT_CLIENT && fs\.existsSync\(CHAT_CLIENT\)\)/.test(t020))
} finally {
  for (const dir of [HOME]) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (error) { void error }
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
