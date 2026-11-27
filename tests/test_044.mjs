// dsh-sidebar-suite 0.7.4 (unreleased) — linked-workspace deletion dead state.
//
// indexSessionIds() follows a workspace symlink/junction and sees the sessions
// inside it, but safeSessionDir() refuses to delete anything whose real path
// leaves the sessions root. Both rules are right on their own; together they
// left a tracked id that could never be deleted: purge retried it at every
// startup and every 30s tick, and the page's "delete" silently did nothing.
//
// Fix under test: keep the safety refusal, recognise the case, untrack the id
// and return the concrete path instead of an endless retry.
//
// Runs against throwaway DSH_HOME directories only. No machine-specific paths.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOST = pathToFileURL(path.join(ROOT, 'lib', 'temp-session-host.mjs')).href
const HOST_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'temp-session-host.mjs'), 'utf8')
const CLIENT_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-044-'))
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-044-out-'))
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

const LINKED_ID = 'session-044-linked'
const NORMAL_ID = 'session-044-normal'
const linkedFile = path.join(OUTSIDE, LINKED_ID, 'transcript.json')
const normalDir = path.join(SESSIONS, 'normal-ws', NORMAL_ID)
fs.mkdirSync(path.dirname(linkedFile), { recursive: true })
fs.writeFileSync(linkedFile, '{}')
fs.mkdirSync(normalDir, { recursive: true })
fs.writeFileSync(path.join(normalDir, 'transcript.json'), '{}')

const linkedWs = path.join(SESSIONS, 'linked-ws')
try {
  fs.symlinkSync(OUTSIDE, linkedWs, process.platform === 'win32' ? 'junction' : 'dir')
} catch (error) {
  console.log('SKIP  linked workspace setup not supported: ' + (error && error.message))
  console.log('\n0 passed, 0 failed')
  try { fs.rmSync(HOME, { recursive: true, force: true }) } catch (e) { void e }
  try { fs.rmSync(OUTSIDE, { recursive: true, force: true }) } catch (e) { void e }
  process.exit(0)
}

fs.writeFileSync(
  path.join(DATA, 'temp-sessions.json'),
  JSON.stringify({ version: 1, sessions: [LINKED_ID, NORMAL_ID] }, null, 2),
  'utf8',
)

async function main() {
  try {
  const mod = await import(HOST + '?v044=' + Date.now())
  const host = mod.createTempSessionHost(null)
  // The host reads its config on the first status/route call; force that here
  // so the throwaway DELETE_ON_EXIT=off is honoured before ensureReady().
  host.refreshConfigIfChanged()

  // ---- 1. single delete: a clear answer, no silent retry -----------------
  const single = await host.removeOne(LINKED_ID)
  check('single: reports the blocked case', single.blocked === true, JSON.stringify(single).slice(0, 400))
  check('single: does not claim success', single.ok !== true)
  check('single: error explains the safety refusal', /linked workspace/i.test(single.error || ''), String(single.error))
  check('single: error does not promise a retry', !/retry|next launch/i.test(single.error || ''))
  check('single: returns the manual-removal path',
    Array.isArray(single.paths) && single.paths.length === 1 &&
    path.resolve(single.paths[0]) === path.join(linkedWs, LINKED_ID))
  check('single: id is no longer tracked', !host.state.tracked.includes(LINKED_ID))
  check('single: files were NOT deleted outside the root', fs.existsSync(linkedFile))
  check('single: report records the block',
    !!(host.status().lastPurge && host.status().lastPurge.blocked.includes(LINKED_ID)))

  // ---- 2. purge: blocked ids are cleared, not retried forever ------------
  host.state.tracked.push(LINKED_ID)
  const report = await host.purgeAll('test')
  check('purge: linked id reported as blocked', report.blocked.includes(LINKED_ID))
  check('purge: blocked path is reported', report.blockedPaths.some((p) => path.resolve(p) === path.join(linkedWs, LINKED_ID)),
    JSON.stringify(report.blockedPaths))
  check('purge: blocked id is untracked', !host.state.tracked.includes(LINKED_ID))
  check('purge: outside files survive', fs.existsSync(linkedFile))
  check('purge: ordinary session is still deleted', !fs.existsSync(normalDir) && report.removed >= 1,
    `exists=${fs.existsSync(normalDir)} removed=${report.removed} report=${JSON.stringify(report).slice(0, 500)}`)

  // ---- 3. sync quit path keeps the same semantics ------------------------
  host.state.tracked.push(LINKED_ID)
  const sync = host.purgeSync('process-exit')
  check('exit: linked id is not kept for another retry', !sync.kept.includes(LINKED_ID))
  check('exit: linked id is listed as blocked', sync.blocked.includes(LINKED_ID))
  check('exit: files still survive', fs.existsSync(linkedFile))

  // ---- 4. source guards --------------------------------------------------
  check('source: linked-workspace detection exists', HOST_SRC.includes('function linkedWorkspaceDirs'))
  check('source: guard still refuses outside-root deletes',
    HOST_SRC.includes('if (!isInsideRoot(rootReal, targetReal)) return \'\''))
  check('source: removeOne is exposed for the route', HOST_SRC.includes('    removeOne,'))
  check('client: the refusal reason reaches the user',
    CLIENT_SRC.includes("throw new Error((data && data.error) || 'delete failed')") &&
    CLIENT_SRC.includes("toast(opError('temp.menu.failed', error), true)") &&
    CLIENT_SRC.includes("var message = String((error && error.message) || error)"))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
  } finally {
    try { fs.rmSync(HOME, { recursive: true, force: true }) } catch (error) { void error }
    try { fs.rmSync(OUTSIDE, { recursive: true, force: true }) } catch (error) { void error }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
