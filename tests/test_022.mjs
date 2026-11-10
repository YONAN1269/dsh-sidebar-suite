// dsh-sidebar-suite 0.2.2 — temporary-session cleanup policy tests.
//
// Runs the real Host half against a throwaway DSH_HOME. The only shared state
// with the working copy is temp-session-config.txt: it is written by
// saveConfig(), so it is backed up up front and restored in `finally`.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// Relocatable: <repo>/tests -> <repo>. No machine-specific paths (CI-safe).
const PLUGIN = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOST = join(PLUGIN, 'lib', 'temp-session-host.mjs')
const CONFIG = join(PLUGIN, 'temp-session-config.txt')

const HOME = mkdtempSync(join(tmpdir(), 'dsbs-022-'))
process.env.DSH_HOME = HOME

const originalConfig = readFileSync(CONFIG, 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  →  ' + extra : '')) }
}

function makeCtx(registered) {
  return {
    get(name) {
      if (name === 'connection') {
        return { fetch: { register(spec) { registered.push(spec) } } }
      }
      if (name === 'workspaceRegistry') {
        return { archiveSession: async () => true }
      }
      return null
    },
    logger: { debug() {}, warn() {}, info() {}, error() {} },
  }
}

const registered = []
let host = null

try {
  const mod = await import(pathToFileURL(HOST).href)
  host = mod.createTempSessionHost(makeCtx(registered))
  host.register(makeCtx(registered))

  // ---- routes -----------------------------------------------------------
  check('routes: seven routes registered', registered.length === 7, 'got ' + registered.length)
  const paths = registered.map((r) => r.path)
  check('routes: config route present', paths.includes('/api/dsh-temp-session.config'))
  check('routes: status still present', paths.includes('/api/dsh-temp-session.status'))

  // ---- clock / next run -------------------------------------------------
  const next = host.computeNextRun('03:00')
  check('schedule: next run is a future Date', next instanceof Date && next.getTime() > Date.now())
  check('schedule: target carries HH:MM', next && next.getHours() === 3 && next.getMinutes() === 0)
  check('schedule: invalid clock rejected', host.computeNextRun('25:00') === null && host.computeNextRun('abc') === null && host.computeNextRun('') === null)
  const loose = host.computeNextRun('7:5')
  check('schedule: 7:5 normalizes to 07:05', !!loose && loose.getHours() === 7 && loose.getMinutes() === 5)

  // ---- saveConfig keeps the file readable -------------------------------
  const before = readFileSync(CONFIG, 'utf8')
  const firstLine = before.split(/\r?\n/)[0]
  const saved = host.saveConfig({ scheduleDelete: true, scheduleTime: '04:15' })
  const after = readFileSync(CONFIG, 'utf8')
  check('config: save reported ok', saved && saved.ok === true, JSON.stringify(saved))
  check('config: SCHEDULE_DELETE written', /^SCHEDULE_DELETE=on$/m.test(after))
  check('config: SCHEDULE_TIME written', /^SCHEDULE_TIME=04:15$/m.test(after))
  check('config: header comment preserved', after.split(/\r?\n/)[0] === firstLine)
  check('config: inline comment preserved', after.includes('# 退出 DSH 时删除临时会话'))
  check('config: unrelated key untouched', /^TEMP_BUTTON_STYLE=pair$/m.test(after))
  check('config: no lines added when all keys exist', after.split(/\r?\n/).length === before.split(/\r?\n/).length,
    before.split(/\r?\n/).length + ' → ' + after.split(/\r?\n/).length)
  check('config: in-memory state updated', host.state.config.scheduleDelete === true && host.state.config.scheduleTime === '04:15')

  // ---- a missing key is appended, not lost ------------------------------
  writeFileSync(CONFIG, after.replace(/^SCHEDULE_TIME=.*\r?\n/m, ''), 'utf8')
  host.saveConfig({ scheduleTime: '05:45' })
  const appended = readFileSync(CONFIG, 'utf8')
  check('config: missing key re-appended', /^SCHEDULE_TIME=05:45$/m.test(appended))

  // ---- GET / POST through the registered route --------------------------
  const configRoute = registered.find((r) => r.path === '/api/dsh-temp-session.config')
  const getRes = await configRoute.fetch(new Request('http://localhost/api/dsh-temp-session.config'))
  const getBody = await getRes.json()
  check('route: GET returns current config', getBody.ok === true && getBody.scheduleTime === '05:45' && getBody.scheduleDelete === true,
    JSON.stringify(getBody))

  const postRes = await configRoute.fetch(new Request('http://localhost/api/dsh-temp-session.config', {
    method: 'POST',
    body: JSON.stringify({ scheduleDelete: false, scheduleTime: '23:30' }),
  }))
  const postBody = await postRes.json()
  check('route: POST saves and echoes', postBody.ok === true && postBody.scheduleDelete === false && postBody.scheduleTime === '23:30',
    JSON.stringify(postBody))
  check('route: POST persisted to file', /^SCHEDULE_TIME=23:30$/m.test(readFileSync(CONFIG, 'utf8')))

  const badRes = await configRoute.fetch(new Request('http://localhost/api/dsh-temp-session.config', {
    method: 'POST',
    body: '{not json',
  }))
  check('route: POST rejects broken JSON', badRes.status === 400)

  // ---- an active session survives the scheduled pass --------------------
  const activeId = 'sess-active-1'
  const activeDir = join(HOME, 'sessions', 'ws1', activeId)
  mkdirSync(activeDir, { recursive: true })
  const activeFile = join(activeDir, 'session.v4.jsonl.zstd')
  writeFileSync(activeFile, 'live')
  await host.track(activeId)
  const activeReport = await host.purgeAll('test-scheduled', { skipActiveMs: 3 * 60 * 1000 })
  check('purge: active session skipped', activeReport.skipped === 1 && activeReport.removed === 0, JSON.stringify(activeReport))
  check('purge: active session still tracked', host.state.tracked.includes(activeId))
  check('purge: active session still on disk', existsSync(activeFile))

  // ---- the same session is deleted once it goes quiet -------------------
  const old = new Date(Date.now() - 10 * 60 * 1000)
  utimesSync(activeFile, old, old)
  const idleReport = await host.purgeAll('test-scheduled', { skipActiveMs: 3 * 60 * 1000 })
  check('purge: idle session deleted', idleReport.removed === 1 && !existsSync(activeDir), JSON.stringify(idleReport))
  check('purge: idle session untracked', !host.state.tracked.includes(activeId))

  // ---- quitting ignores the protection (the user asked for it) ---------
  const quitId = 'sess-quit-1'
  const quitDir = join(HOME, 'sessions', 'ws1', quitId)
  mkdirSync(quitDir, { recursive: true })
  writeFileSync(join(quitDir, 'session.v4.jsonl.zstd'), 'fresh')
  await host.track(quitId)
  const quitReport = host.purgeSync('test-quit')
  check('purgeSync: deletes even a just-written session', quitReport.removed === 1 && !existsSync(quitDir), JSON.stringify(quitReport))

  // ---- status exposes what the detail page needs ------------------------
  host.saveConfig({ scheduleDelete: true, scheduleTime: '02:10' })
  const status = host.status()
  check('status: schedule fields present', status.scheduleDelete === true && status.scheduleTime === '02:10')
  check('status: schedule block has next run', !!status.schedule && typeof status.schedule.nextRunAt === 'string', JSON.stringify(status.schedule))
  check('status: next run is in the future', new Date(status.schedule.nextRunAt).getTime() > Date.now())

  host.saveConfig({ scheduleDelete: false })
  const offStatus = host.status()
  check('status: disabling clears next run', offStatus.scheduleDelete === false && offStatus.schedule.nextRunAt === null)
} finally {
  if (host) {
    try { host.state.tracked = [] } catch (error) { void error }
  }
  writeFileSync(CONFIG, originalConfig, 'utf8')
  try { rmSync(HOME, { recursive: true, force: true }) } catch (error) { void error }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
