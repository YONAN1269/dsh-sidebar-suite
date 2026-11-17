// dsh-sidebar-suite 0.7.3 — follow-up audit: store integrity + zombie ids.
//
// #1 A torn/corrupt temp-sessions.json was read as "no temp sessions", which
//    silently permanentised every tracked session. loadStore now keeps the last
//    known-good list on a non-ENOENT read error, and saveStore writes atomically
//    (sibling .tmp + rename) so a crash cannot produce a torn file. Ids are
//    de-duplicated so a repeat cannot cause double deletes / false failures.
// #2 A tracked id whose session directory is genuinely gone (crash between rm
//    and save, host UI archive) was reported as a permanent failure forever.
//    Cleanup now judges by "gone from disk" — but only when the root is readable
//    and no entry with that id remains, so guard-refused symlinks still retry.
// #4 Write-failure rollback re-reads the file (preserving concurrent tracks)
//    and unions the pre-call snapshot so an unreadable file still rolls back.
// #5 The daily scheduler re-reads config on each tick, so a hand edit to
//    SCHEDULE_DELETE is honoured even with no page polling.
// #6 register() no longer bumps configRevision on a no-op re-apply.
// #7 The probe route awaits ensureReady before reporting.
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

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-042-'))
process.env.DSH_HOME = HOME
const SESSIONS = path.join(HOME, 'sessions')
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

async function boot(tag) {
  const mod = await import(HOST + '?v042=' + tag)
  const routes = new Map()
  const ctx = makeCtx(routes)
  const host = mod.createTempSessionHost(ctx)
  host.register(ctx)
  return { host, routes, mod }
}

try {
  // ---- #1a: duplicate ids in the store are de-duplicated on load --------
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(path.join(DATA_DIR, 'temp-session-config.txt'),
    'DELETE_ON_EXIT=off\n', 'utf8') // no startup purge, so dedup is observable
  fs.writeFileSync(STORE, JSON.stringify({ version: 1, sessions: ['session-dup', 'session-dup', 'session-other'] }), 'utf8')
  const a = await boot('dedup')
  const statusRoute = a.routes.get('/api/dsh-temp-session.status')
  await statusRoute.fetch(new Request('http://localhost/api/dsh-temp-session.status'))
  check('dedup: load collapses repeated ids',
    a.host.state.tracked.length === 2 &&
    a.host.state.tracked.filter((id) => id === 'session-dup').length === 1,
    JSON.stringify(a.host.state.tracked))

  // ---- #1b: atomic write leaves no .tmp file behind ---------------------
  a.host.state.tracked = []
  await a.host.track('session-atomic')
  check('atomic: store was written', fs.existsSync(STORE))
  check('atomic: no half-written .tmp file remains', !fs.existsSync(STORE + '.tmp'))
  const persisted = JSON.parse(fs.readFileSync(STORE, 'utf8'))
  check('atomic: persisted list matches memory',
    Array.isArray(persisted.sessions) && persisted.sessions.includes('session-atomic'),
    JSON.stringify(persisted))

  // ---- #1c: a corrupt store is reported, not silently treated as empty --
  check('source: loadStore keeps tracked on a non-ENOENT read error',
    /store read failed:[\s\S]{0,300}?state\.storeReadError[\s\S]{0,80}?return/.test(HOST_SRC))
  check('source: saveStore uses a .tmp sibling + rename',
    /const tmp = path \+ '\.tmp'[\s\S]{0,200}?await rename\(tmp, path\)/.test(HOST_SRC))

  // ---- #2: a zombie id (no directory on disk) is dropped by purgeAll ----
  const b = await boot('zombie')
  await b.host.track('session-zombie') // never create a directory for it
  check('zombie: setup tracked the id', b.host.state.tracked.includes('session-zombie'))
  const purge = await b.host.purgeAll('manual')
  check('zombie: purge counts the missing session as removed', purge.removed >= 1, JSON.stringify(purge))
  check('zombie: id is no longer tracked', !b.host.state.tracked.includes('session-zombie'),
    JSON.stringify(b.host.state.tracked))
  check('zombie: no false failure entry', !purge.failed.includes('session-zombie'), JSON.stringify(purge.failed))

  // ---- #2b: a guard-refused symlink is NOT treated as a zombie -----------
  const outside = path.join(HOME, 'outside-' + Date.now())
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'safe', 'utf8')
  const linkId = 'session-symlink-zombie-check'
  const linkPath = path.join(SESSIONS, 'ws-z', linkId)
  fs.mkdirSync(path.dirname(linkPath), { recursive: true })
  try { fs.symlinkSync(outside, linkPath, 'junction') } catch (error) { void error }
  const c = await boot('symlink-zombie')
  await c.host.track(linkId)
  const cPurge = await c.host.purgeAll('manual')
  check('zombie-guard: refused symlink stays tracked',
    c.host.state.tracked.includes(linkId), JSON.stringify(c.host.state.tracked))
  check('zombie-guard: refused symlink is a reported failure',
    cPurge.failed.includes(linkId), JSON.stringify(cPurge))
  check('zombie-guard: outside target survived', fs.existsSync(path.join(outside, 'keep.txt')))

  // ---- #6: register does not bump configRevision on a no-op re-apply -----
  const d = await boot('revision')
  const revBefore = d.host.state.configRevision
  d.host.register(makeCtx(new Map()))
  check('revision: no-op re-apply does not advance configRevision',
    d.host.state.configRevision === revBefore,
    revBefore + ' -> ' + d.host.state.configRevision)

  // ---- #7: probe awaits ensureReady (source contract) -------------------
  check('source: probe route awaits ensureReady',
    /\.probe', \['GET'\], async \(\) => \{ await ensureReady\(\); return json\(probe\(\)\) \}\]/.test(HOST_SRC))

  // ---- #5: scheduler re-reads config on each tick (source contract) -----
  check('source: schedulerTick refreshes config before acting',
    /async function schedulerTick\(\) \{[\s\S]{0,200}?refreshConfigIfChanged\(\)/.test(HOST_SRC))
} catch (error) {
  check('test harness did not throw', false, (error && error.stack) || String(error))
} finally {
  try { fs.rmSync(HOME, { recursive: true, force: true }) } catch (error) { void error }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exitCode = 1
