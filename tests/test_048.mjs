// dsh-sidebar-suite 0.7.4 (unreleased) — behaviour tests for the display-only
// session-path route that backs "Open session folder".
//
// The old source-text guard could not catch a wrong response body, and the
// linked-workspace case returned [] (so the page claimed the folder was gone).
// This test calls the REAL route handler against throwaway DSH_HOME dirs.
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

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-048-'))
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-048-out-'))
const DATA = path.join(HOME, 'dsh-sidebar-suite')
const SESSIONS = path.join(HOME, 'sessions')
fs.mkdirSync(DATA, { recursive: true })
fs.mkdirSync(SESSIONS, { recursive: true })
fs.writeFileSync(
  path.join(DATA, 'temp-session-config.txt'),
  'DELETE_ON_EXIT=off\nSCHEDULE_DELETE=off\n',
  'utf8',
)
process.env.DSH_HOME = HOME

const NORMAL_ID = 'session-048-normal'
const LINKED_ID = 'session-048-linked'
const normalDir = path.join(SESSIONS, 'normal-ws', NORMAL_ID)
const linkedWs = path.join(SESSIONS, 'linked-ws')
const outsideDir = path.join(OUTSIDE, LINKED_ID)
fs.mkdirSync(normalDir, { recursive: true })
fs.writeFileSync(path.join(normalDir, 'transcript.json'), '{}')
fs.mkdirSync(outsideDir, { recursive: true })
fs.writeFileSync(path.join(outsideDir, 'transcript.json'), '{}')
try {
  fs.symlinkSync(OUTSIDE, linkedWs, process.platform === 'win32' ? 'junction' : 'dir')
} catch (error) {
  console.log('SKIP  linked workspace setup not supported: ' + (error && error.message))
  fs.rmSync(HOME, { recursive: true, force: true })
  fs.rmSync(OUTSIDE, { recursive: true, force: true })
  console.log('\n0 passed, 0 failed')
  process.exit(0)
}
fs.writeFileSync(
  path.join(DATA, 'temp-sessions.json'),
  JSON.stringify({ version: 1, sessions: [NORMAL_ID, LINKED_ID] }, null, 2),
  'utf8',
)

const routes = new Map()
const fetchRegistry = {
  register(route) {
    routes.set(route.path, route)
    return async () => routes.delete(route.path)
  },
}
const hostCtx = {
  connection: { fetch: fetchRegistry },
  get(name) { return name === 'connection' ? hostCtx.connection : undefined },
}

async function main() {
  const mod = await import(HOST + '?v048=' + Date.now())
  const host = mod.createTempSessionHost(hostCtx)
  host.register(hostCtx)
  host.refreshConfigIfChanged()

  const call = async (p) => {
    const route = routes.get(String(p).split('?')[0])
    if (!route) throw new Error('no route for ' + p)
    const res = await route.fetch(new Request('http://dsh.invalid' + p))
    return { status: res.status, body: await res.json() }
  }
  const PATH_URL = '/api/dsh-temp-session.paths?sessionId='

  // ---- 1. normal tracked session: the real absolute path -----------------
  const normal = await call(PATH_URL + NORMAL_ID)
  check('normal: 200 with a path list',
    normal.status === 200 && normal.body.ok === true && Array.isArray(normal.body.paths),
    JSON.stringify(normal))
  check('normal: returns the on-disk directory',
    normal.body.paths.length === 1 && path.resolve(normal.body.paths[0]) === normalDir,
    JSON.stringify(normal.body.paths))

  // ---- 2. linked workspace: display the path instead of "folder gone" ----
  const linked = await call(PATH_URL + LINKED_ID)
  check('linked: still returns a usable path',
    linked.status === 200 && linked.body.paths.length === 1,
    JSON.stringify(linked))
  check('linked: path is the one the user sees in the sidebar',
    path.resolve(linked.body.paths[0]) === path.join(linkedWs, LINKED_ID),
    JSON.stringify(linked.body.paths))
  check('linked: does not leak the junction target outside the sessions root',
    !JSON.stringify(linked.body).includes(OUTSIDE.replace(/\\/g, '\\\\')),
    JSON.stringify(linked.body))
  check('linked: the file itself was not touched',
    fs.existsSync(path.join(outsideDir, 'transcript.json')))

  // ---- 3. untracked ids and traversal attempts ---------------------------
  const untracked = await call(PATH_URL + 'not-tracked-048')
  check('untracked: no path is disclosed',
    untracked.body.ok === true && untracked.body.paths.length === 0,
    JSON.stringify(untracked))
  for (const bad of ['..', '..%2Foutside', '%2e%2e%2f', 'C%3A%5Cfoo']) {
    const result = await call(PATH_URL + bad)
    check('rejects unsafe sessionId ' + bad,
      result.status === 400 && result.body.ok === false,
      JSON.stringify(result))
  }

  // ---- 4. route stays read-only ------------------------------------------
  const route = routes.get('/api/dsh-temp-session.paths')
  check('route: GET only', !!route && Array.isArray(route.methods) && route.methods.join(',') === 'GET',
    route && JSON.stringify(route.methods))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
  process.removeAllListeners('exit')
  for (const dir of [HOME, OUTSIDE]) {
    try { fs.rmSync(dir, { recursive: true, force: true }) }
    catch (error) { console.error('CLEANUP_FAIL ' + dir + ' ' + error.code + ' ' + error.message) }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
