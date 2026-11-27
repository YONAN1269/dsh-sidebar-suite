// R-10 (TS-07) — scheduler and exit-hook regression, driven through injected
// clock / timers / hook registrar. No real setInterval and no process exit.
//
//   - a due tick runs exactly one scheduled cleanup
//   - the exit hook, once triggered, writes the tracking store to disk
//   - repeated scheduler starts never hang a second interval timer
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOME = mkdtempSync(join(tmpdir(), 'dsbs-078-'))
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

async function main() {
  const mod = await import(pathToFileURL(ROOT + '/lib/temp-session-host.mjs').href)

  let tick = 1_700_000_000_000
  const now = () => tick
  const timers = {
    intervals: [],
    setInterval(fn, ms) {
      const id = { fn, ms }
      this.intervals.push(id)
      return id
    },
    clearInterval(id) {
      const i = this.intervals.indexOf(id)
      if (i >= 0) this.intervals.splice(i, 1)
    },
  }
  const hooks = { fns: [], onExit(fn) { hooks.fns.push(fn) } }

  const ctx = makeCtx()
  const host = mod.createTempSessionHost(ctx, { now, timers, hooks })
  host.register(ctx)

  // Exit hook registered once per process.
  check('R-10: the exit hook is registered exactly once', hooks.fns.length === 1, String(hooks.fns.length))

  // Enable the daily cleanup through the public config path.
  const saved = host.saveConfig({ scheduleDelete: true, scheduleTime: '03:00' })
  check('R-10: scheduleDelete can be enabled via saveConfig', saved.ok === true, JSON.stringify(saved))
  check('R-10: one interval timer is mounted after enabling the schedule',
    timers.intervals.length === 1, String(timers.intervals.length))

  // Repeated start must not stack a second timer: stopScheduler clears the old
  // one before the new interval is created.
  host.startScheduler(true)
  host.restartScheduler(true)
  check('R-10: repeated scheduler starts keep a single timer',
    timers.intervals.length === 1, String(timers.intervals.length))

  // Advance the injected clock past the next due run, then fire the captured
  // interval callback once.
  const nextRunAt = host.state.scheduler.nextRunAt
  check('R-10: a next run time was computed', !!nextRunAt, String(nextRunAt))
  tick = nextRunAt.getTime() + 60_000
  const tickCallback = timers.intervals[0].fn
  await tickCallback()

  check('R-10: a due tick ran one scheduled cleanup',
    host.state.lastPurge && host.state.lastPurge.reason === 'scheduled',
    JSON.stringify(host.state.lastPurge))
  check('R-10: the tick recorded its run time', !!host.state.scheduler.lastRunAt,
    String(host.state.scheduler.lastRunAt))

  // The exit hook writes the tracking store to disk (the quit-path purgeSync).
  const storeFile = join(HOME, 'dsh-sidebar-suite', 'temp-sessions.json')
  hooks.fns[0]()
  check('R-10: invoking the exit hook writes the store file', existsSync(storeFile), storeFile)
  if (existsSync(storeFile)) {
    const body = JSON.parse(readFileSync(storeFile, 'utf8'))
    check('R-10: the hook-written store parses and lists kept sessions',
      body && Array.isArray(body.sessions), JSON.stringify(body))
  }

  // A second hook registration must not replace the first one.
  host.register(ctx)
  check('R-10: a second register does not add another exit hook',
    hooks.fns.length === 1, String(hooks.fns.length))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => { try { rmSync(HOME, { recursive: true, force: true }) } catch (error) { void error } })
