// dsh-sidebar-suite 1.1.6 — store write mutex + trailing-dot id guard.
//
// #1 Concurrent store writes could land their renames in thread-pool order: two
//    overlapping saveStore() calls snapshot `state.tracked` at their own
//    stringify line, and the stale snapshot could overwrite the newer one — a
//    track() re-marking a session the user had just kept (untrack), which the
//    next quit then deletes, with saveStore returning true to both callers.
//    saveStore is now serialized through a promise chain (saveStoreNow holds
//    the actual write), so the file always ends up matching the last mutation.
// #2 Win32 strips trailing dots from path components, so an id like
//    `session-x.` passed SESSION_ID_PATTERN but made realpath/lstat/rm operate
//    on the REAL `session-x` — a different, existing session. isUnsafeId now
//    rejects a trailing dot, both at the /track route and when loading a store
//    an older (or tampered) build wrote.
//
// Everything runs against a throwaway DSH_HOME. No machine-specific paths.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOST = pathToFileURL(path.join(ROOT, 'lib', 'temp-session-host.mjs')).href
const HOST_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'temp-session-host.mjs'), 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-086-'))
process.env.DSH_HOME = HOME
const DATA_DIR = path.join(HOME, 'dsh-sidebar-suite')
const STORE = path.join(DATA_DIR, 'temp-sessions.json')

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

async function boot(tag, hostOptions) {
  const mod = await import(HOST + '?v086=' + tag)
  const routes = new Map()
  const ctx = makeCtx(routes)
  const host = mod.createTempSessionHost(ctx, hostOptions)
  host.register(ctx)
  return { host, routes, mod }
}

/** A minimal on-disk session: <sessions>/<workspace>/<id>/transcript.jsonl. */
function makeSession(workspace, id) {
  const dir = path.join(HOME, 'sessions', workspace, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'), '{"title":"t"}\n', 'utf8')
  return dir
}

function storedSessions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, 'utf8'))
    return Array.isArray(parsed) ? parsed : parsed.sessions
  } catch (error) {
    return null
  }
}

try {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(path.join(DATA_DIR, 'temp-session-config.txt'),
    'DELETE_ON_EXIT=off\n', 'utf8') // no startup purge, so store content is observable

  // ---- #1a: a burst of concurrent track/untrack keeps file == memory ----
  // The old code let two saves stringify the same instant and land out of
  // order; the invariant "file matches memory after every call settles" is
  // what the mutex restores. Toggling two ids concurrently exercises the
  // interleaving; the final untracks make the expected end state deterministic.
  const a = await boot('mutex')
  const ops = []
  for (let i = 0; i < 40; i += 1) {
    ops.push(a.host.track('session-race-a'))
    ops.push(a.host.track('session-race-b'))
    if (i % 2 === 0) ops.push(a.host.untrack('session-race-b'))
    else ops.push(a.host.untrack('session-race-a'))
  }
  await Promise.all(ops)
  const inMemory = a.host.state.tracked.slice().sort()
  const onDisk = (storedSessions() || []).slice().sort()
  check('mutex: file matches memory after 160 concurrent saves',
    JSON.stringify(inMemory) === JSON.stringify(onDisk),
    'memory=' + JSON.stringify(inMemory) + ' disk=' + JSON.stringify(onDisk))
  check('mutex: every save reported the written list to its caller',
    typeof a.host.state.lastError === 'string' && !/store write failed/.test(a.host.state.lastError),
    a.host.state.lastError)

  // ---- #1b: the serialize point is inside saveStore (source contract) ----
  check('mutex: saveStore serializes through a write chain',
    /let storeWriteChain = Promise\.resolve\(\)/.test(HOST_SRC) &&
    /storeWriteChain\.then\(\(\) => saveStoreNow\(\)/.test(HOST_SRC))

  // ---- #2a: /track refuses a trailing-dot id ----------------------------
  const trackRoute = a.routes.get('/api/dsh-temp-session.track')
  const dotResponse = await trackRoute.fetch(
    new Request('http://localhost/api/dsh-temp-session.track?sessionId=session-target.'),
    { method: 'POST' },
  )
  const dotBody = await dotResponse.json()
  // queryOf() normalizes before the route sees it, so a rejected id surfaces
  // as "sessionId required" at the route and "invalid session id" on the
  // direct host.track() path below. Both refuse before any filesystem call.
  check('dot id: /track refuses session-target.',
    dotBody.ok === false && dotBody.error === 'sessionId required',
    JSON.stringify(dotBody))
  const directTrack = await a.host.track('session-target.')
  check('dot id: host.track refuses session-target.',
    directTrack.ok === false && directTrack.error === 'invalid session id',
    JSON.stringify(directTrack))
  check('dot id: the real session-target was NOT tracked',
    !a.host.state.tracked.includes('session-target'),
    JSON.stringify(a.host.state.tracked))

  // ---- #2b: untrack/remove refuse it too --------------------------------
  const untrackRoute = a.routes.get('/api/dsh-temp-session.untrack')
  const untrackBody = await (await untrackRoute.fetch(
    new Request('http://localhost/api/dsh-temp-session.untrack?sessionId=session-target.'),
    { method: 'POST' },
  )).json()
  check('dot id: /untrack refuses session-target.', untrackBody.ok === false)

  // ---- #2c: a store written by an older build cannot smuggle one in -----
  fs.writeFileSync(STORE,
    JSON.stringify({ version: 1, sessions: ['session-real.', 'session-keep'] }), 'utf8')
  const b = await boot('dot-store')
  await b.routes.get('/api/dsh-temp-session.status').fetch(
    new Request('http://localhost/api/dsh-temp-session.status'))
  check('dot id: a dotted id in the store is dropped on load',
    JSON.stringify(b.host.state.tracked) === JSON.stringify(['session-keep']),
    JSON.stringify(b.host.state.tracked))
  // The load itself never writes; the next save is what scrubbes the file.
  await b.host.track('session-second')
  check('dot id: the store save after load no longer carries the dotted id',
    !(storedSessions() || []).some((id) => /[.]$/.test(id)),
    JSON.stringify(storedSessions()))

  // ---- #2d: normalizeId keeps legitimate ids working --------------------
  await b.host.track('session-9f0c2e44-1234-4a5b-8c6d-112233445566')
  check('dot id: normal uuid ids still track',
    b.host.state.tracked.includes('session-9f0c2e44-1234-4a5b-8c6d-112233445566'))

  // ---- #3: /track refuses an EXISTING stale session (the two-step delete) -
  // The route pair track+remove used to delete any session by id: removeOne
  // only refuses untracked ids, and /track accepted any of them. The route now
  // refuses sessions whose every readable directory stamp is older than the
  // age window — which a session created moments ago can never be. The window
  // is forced to 300ms here because birthtime cannot be backdated with utimes;
  // the seeded directory then settles past the window before the POST.
  fs.rmSync(STORE, { force: true })
  const c = await boot('stale-guard', { trackMaxAgeMs: 300 })
  makeSession('ws-stale', 'session-old-target')
  await new Promise((resolve) => setTimeout(resolve, 600))
  const trackRouteC = c.routes.get('/api/dsh-temp-session.track')
  const staleBody = await (await trackRouteC.fetch(
    new Request('http://localhost/api/dsh-temp-session.track?sessionId=session-old-target'),
    { method: 'POST' },
  )).json()
  check('track guard: an existing session is refused by the route',
    staleBody.ok === false && staleBody.error === 'session is not a new temporary session',
    JSON.stringify(staleBody))
  check('track guard: the refused id is NOT tracked',
    !c.host.state.tracked.includes('session-old-target'),
    JSON.stringify(c.host.state.tracked))

  // ---- #3b: a fresh directory still tracks (the legitimate click) --------
  makeSession('ws-stale', 'session-just-made')
  const freshBody = await (await trackRouteC.fetch(
    new Request('http://localhost/api/dsh-temp-session.track?sessionId=session-just-made'),
    { method: 'POST' },
  )).json()
  check('track guard: a session created moments ago still tracks',
    freshBody.ok === true, JSON.stringify(freshBody))
  check('track guard: the fresh id IS tracked',
    c.host.state.tracked.includes('session-just-made'),
    JSON.stringify(c.host.state.tracked))

  // ---- #3c: phantom ids stay trackable (zombie contract, fail-open) ------
  const phantomBody = await (await trackRouteC.fetch(
    new Request('http://localhost/api/dsh-temp-session.track?sessionId=session-phantom'),
    { method: 'POST' },
  )).json()
  check('track guard: a phantom id (no directory) still tracks',
    phantomBody.ok === true && c.host.state.tracked.includes('session-phantom'),
    JSON.stringify(phantomBody))

  // ---- #3d: an already-tracked id re-tracks (idempotent, no new power) ---
  const againBody = await (await trackRouteC.fetch(
    new Request('http://localhost/api/dsh-temp-session.track?sessionId=session-phantom'),
    { method: 'POST' },
  )).json()
  check('track guard: re-tracking an already-tracked id stays ok',
    againBody.ok === true, JSON.stringify(againBody))

  // ---- #4: purge judges gone-ness by parked counts, not "any success" ----
  // A session living in two workspaces with only one parked used to have its
  // index entry deleted anyway; the index then said "gone" while a copy still
  // existed. The index now counts directories per id and purge subtracts what
  // it actually moved.
  fs.rmSync(STORE, { force: true })
  const d = await boot('count-index')
  makeSession('ws-count-a', 'session-multi')
  makeSession('ws-count-b', 'session-multi')
  await d.host.track('session-multi')
  const purgeReport = await d.host.purgeAll('test-count')
  check('purge index: both copies removed, reported as removed',
    purgeReport.removed === 1 && purgeReport.failed.length === 0,
    JSON.stringify(purgeReport))
  check('purge index: id is untracked after both copies are gone',
    !d.host.state.tracked.includes('session-multi'))

  // ---- #4b: source contract — the index counts and purge decrements ------
  check('purge index: indexSessionIds counts directories per key',
    /found\.set\(key, \(found\.get\(key\) \|\| 0\) \+ 1\)/.test(HOST_SRC))
  check('purge index: purge subtracts moved, not "any success"',
    /\(liveIds\.get\(key\) \|\| 0\) - moved/.test(HOST_SRC) &&
    /if \(left > 0\) liveIds\.set\(key, left\)/.test(HOST_SRC))
  check('purge index: sessionGoneFromDisk reads the count, not membership',
    /!\(\(index\.get\(sessionKey\(sessionId\)\) \|\| 0\) > 0\)/.test(HOST_SRC))
  check('track guard: route consults the stale-session gate',
    /if \(isStaleSession\(sessionId\)\) \{[\s\S]{0,160}?not a new temporary session/.test(HOST_SRC))

  // ---- #5: a transient config read failure keeps last-known-good --------
  // The old behaviour assigned DEFAULT_CONFIG on a failed re-read: a
  // OneDrive/antivirus lock flipped DELETE_ON_EXIT back to on, stopped the
  // scheduler and bumped configRevision so every poll re-applied defaults.
  // The file must merely stay unreadable, not vanish (a vanished file is
  // re-seeded), so the test swaps it for a same-name directory (EISDIR).
  fs.rmSync(STORE, { force: true })
  const cfgPath = path.join(DATA_DIR, 'temp-session-config.txt')
  fs.writeFileSync(cfgPath, 'DELETE_ON_EXIT=off\nMAX_KEPT=77\n', 'utf8')
  const e = await boot('cfg-lastgood')
  const statusRouteE = e.routes.get('/api/dsh-temp-session.status')
  await statusRouteE.fetch(new Request('http://localhost/api/dsh-temp-session.status'))
  check('config guard: the good config is loaded first',
    e.host.state.configLoaded === true &&
    e.host.state.config.deleteOnExit === false && e.host.state.config.maxKept === 77,
    JSON.stringify(e.host.state.config))
  const revisionBefore = e.host.state.configRevision
  fs.rmSync(cfgPath)
  fs.mkdirSync(cfgPath)
  await statusRouteE.fetch(new Request('http://localhost/api/dsh-temp-session.status'))
  check('config guard: a failed re-read keeps DELETE_ON_EXIT=off',
    e.host.state.config.deleteOnExit === false && e.host.state.config.maxKept === 77,
    JSON.stringify(e.host.state.config))
  check('config guard: the read failure is surfaced, not silent',
    typeof e.host.state.config.error === 'string' && e.host.state.config.error.length > 0,
    JSON.stringify(e.host.state.config.error))
  check('config guard: a failed re-read does not bump configRevision',
    e.host.state.configRevision === revisionBefore,
    revisionBefore + ' -> ' + e.host.state.configRevision)
  fs.rmdirSync(cfgPath)
  fs.writeFileSync(cfgPath, 'DELETE_ON_EXIT=on\n', 'utf8')
  await statusRouteE.fetch(new Request('http://localhost/api/dsh-temp-session.status'))
  check('config guard: values recover when the file is readable again',
    e.host.state.config.deleteOnExit === true, JSON.stringify(e.host.state.config))

  // ---- #6: quitting with an unreadable config honours the last value ----
  // With the old exit-time default (deleteOnExit on when unreadable), a lock
  // held at quit deleted sessions the user had explicitly kept.
  fs.rmSync(STORE, { force: true })
  fs.writeFileSync(cfgPath, 'DELETE_ON_EXIT=off\n', 'utf8')
  const exitHandlers = []
  const f = await boot('exit-lastgood', { hooks: { onExit(handler) { exitHandlers.push(handler) } } })
  makeSession('ws-exit', 'session-quit-keep')
  await f.host.track('session-quit-keep')
  fs.rmSync(cfgPath)
  fs.mkdirSync(cfgPath)
  const quitDir = path.join(HOME, 'sessions', 'ws-exit', 'session-quit-keep')
  for (const handler of exitHandlers) handler()
  check('exit guard: unreadable config at quit keeps the kept session',
    fs.existsSync(quitDir) && f.host.state.tracked.includes('session-quit-keep'),
    'dir=' + fs.existsSync(quitDir) + ' tracked=' + JSON.stringify(f.host.state.tracked))
  fs.rmdirSync(cfgPath)

  // ---- #7: one failed register pass does not stick forever --------------
  // The connection service can arrive after the first apply; the old code
  // never cleared `degraded`/`routes.errors`, so the settings page reported a
  // degraded host even after every route had mounted on a later pass.
  fs.rmSync(STORE, { force: true })
  const g = await boot('degraded-reset')
  const badLogger = { debug() {}, warn() {}, info() {}, error() {} }
  g.host.register({ get: () => null, logger: badLogger })
  check('degraded reset: a failed pass reports the reason',
    g.host.state.degraded === 'connection.fetch unavailable' && g.host.state.routes.errors.length > 0,
    JSON.stringify({ degraded: g.host.state.degraded, errors: g.host.state.routes.errors.length }))
  const goodCtxG = {
    get(name) {
      if (name === 'connection') return { fetch: { register() {} } }
      return null
    },
    logger: badLogger,
  }
  g.host.register(goodCtxG)
  check('degraded reset: a good pass clears the stale diagnostics',
    g.host.state.degraded === '' && g.host.state.routes.errors.length === 0,
    JSON.stringify({ degraded: g.host.state.degraded, errors: g.host.state.routes.errors }))
  check('degraded reset: the good pass actually registered the routes',
    g.host.state.routes.registered > 0)
} catch (error) {
  check('test harness did not throw', false, (error && error.stack) || String(error))
} finally {
  process.removeAllListeners('exit')
  try { fs.rmSync(HOME, { recursive: true, force: true }) }
  catch (error) { console.error('CLEANUP_FAIL ' + HOME + ' ' + error.code + ' ' + error.message) }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exitCode = 1
