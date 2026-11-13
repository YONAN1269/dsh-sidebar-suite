// dsh-sidebar-suite 0.6.1 — community PR #105 review follow-ups.
//
// 1. The writable temp-session-config.txt now lives in DSH home instead of the
//    npm package directory, so `pnpm add dsh-sidebar-suite@<new>` cannot reset
//    a user's switches. First boot copies the packaged template over; after
//    that the packaged file is read-only as far as the plugin is concerned.
// 2. The daily cleanup timer is registered through ctx.effect where the host
//    offers it, so disposing/re-applying the plugin tears the interval down.
//
// Everything runs against throwaway DSH_HOME directories; the working copy is
// only ever READ.
import fs from 'node:fs'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOST = join(ROOT, 'lib', 'temp-session-host.mjs')
const TEMPLATE = join(ROOT, 'temp-session-config.txt')
const templateText = readFileSync(TEMPLATE, 'utf8')

const HOME_A = mkdtempSync(join(tmpdir(), 'dsbs-039-a-'))
const HOME_B = mkdtempSync(join(tmpdir(), 'dsbs-039-b-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = HOME_A
const CONFIG_A = join(HOME_A, 'dsh-sidebar-suite', 'temp-session-config.txt')
const CONFIG_B = join(HOME_B, 'dsh-sidebar-suite', 'temp-session-config.txt')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

function makeCtx(options = {}) {
  const registered = []
  const ctx = {
    get(name) {
      if (name === 'connection') return { fetch: { register(spec) { registered.push(spec) } } }
      if (name === 'workspaceRegistry') return { archiveSession: async () => true }
      return null
    },
    logger: { debug() {}, warn() {}, info() {}, error() {} },
    registered,
  }
  if (options.effect) {
    ctx.disposers = []
    ctx.effectCalls = 0
    ctx.effect = (fn) => {
      ctx.effectCalls += 1
      const disposer = fn()
      if (typeof disposer === 'function') ctx.disposers.push(disposer)
      return disposer
    }
  }
  return ctx
}

let host = null
try {
  const mod = await import(pathToFileURL(HOST).href)
  const ctx = makeCtx()
  host = mod.createTempSessionHost(ctx)
  host.register(ctx)

  // ---- 1. the live config is in DSH home ---------------------------------
  check('path: configPath is inside DSH home', host.configPath() === CONFIG_A, host.configPath())
  check('path: packaged file is only a template', host.legacyConfigPath() === TEMPLATE, host.legacyConfigPath())
  check('path: status exposes the data-directory path', host.status().configFile === CONFIG_A)
  check('path: probe exposes the template path', host.probe().configTemplate === TEMPLATE)
  check('migration: first boot seeds the data copy', fs.existsSync(CONFIG_A))
  check('migration: seeded text equals the packaged template', readFileSync(CONFIG_A, 'utf8') === templateText)
  check('migration: state flags the seed', host.state.configMigrated === true)
  check('migration: status says it happened', host.status().configMigrated === true)

  // ---- 2. writing settings never touches the package --------------------
  const saved = host.saveConfig({ scheduleDelete: true, scheduleTime: '04:15', maxKept: 7 })
  check('write: save reported ok', saved && saved.ok === true, JSON.stringify(saved))
  check('write: new values landed in DSH home', /^SCHEDULE_TIME=04:15$/m.test(readFileSync(CONFIG_A, 'utf8')))
  check('write: packaged template is unchanged', readFileSync(TEMPLATE, 'utf8') === templateText)
  check('write: schedule is on for the effect checks', host.state.config.scheduleDelete === true)

  // ---- 3. a second boot does not overwrite user values ------------------
  const beforeSecondBoot = readFileSync(CONFIG_A, 'utf8')
  const host2 = mod.createTempSessionHost(ctx)
  host2.register(ctx)
  check('reboot: data copy is byte-identical', readFileSync(CONFIG_A, 'utf8') === beforeSecondBoot)
  check('reboot: MAX_KEPT survived', host2.state.config.maxKept === 7, String(host2.state.config.maxKept))
  check('reboot: schedule value survived', host2.state.config.scheduleTime === '04:15')

  // ---- 4. a different DSH_HOME gets its own copy -------------------------
  process.env.DSH_HOME = HOME_B
  check('home override: configPath follows DSH_HOME', host2.configPath() === CONFIG_B, host2.configPath())
  check('home override: B starts without a config', !fs.existsSync(CONFIG_B))
  host2.ensureConfigFile()
  check('home override: B is seeded from the template', fs.existsSync(CONFIG_B) && readFileSync(CONFIG_B, 'utf8') === templateText)
  process.env.DSH_HOME = HOME_A

  // ---- 5. the daily timer is owned by ctx.effect ------------------------
  // The first ctx had no `effect`: the legacy standalone interval stays.
  check('effect: plain host keeps the fallback timer', host2.state.schedulerEffectBound === false)
  check('effect: fallback is reported as unmanaged', host2.status().schedule.managed === false)
  check('effect: fallback timer is alive', host2.state.scheduler.timer !== null)

  host2.stopScheduler()
  host2.state.schedulerEffectBound = false
  const effectCtx = makeCtx({ effect: true })
  host2.bindSchedulerEffect(effectCtx)
  check('effect: host.effect was called once', effectCtx.effectCalls === 1)
  check('effect: timer restarted under the host', host2.state.scheduler.timer !== null)
  check('effect: lifecycle is reported as managed', host2.status().schedule.managed === true)
  check('effect: a disposer was captured', effectCtx.disposers.length === 1)
  for (const dispose of effectCtx.disposers) dispose()
  check('effect: disposing stops the interval', host2.state.scheduler.timer === null)
  check('effect: next run is cleared too', host2.state.scheduler.nextRunAt === null)

  const effectCtx2 = makeCtx({ effect: true })
  host2.bindSchedulerEffect(effectCtx2)
  check('effect: re-applying does not stack effects', effectCtx2.effectCalls === 0)
  check('effect: re-applying still restarts the timer', host2.state.scheduler.timer !== null)
  host2.stopScheduler()

  // ---- 6. source-level contract -----------------------------------------
  const src = readFileSync(HOST, 'utf8')
  check('source: configPath uses dshHome()', /function configPath\(\)[\s\S]{0,160}join\(dshHome\(\)/.test(src))
  check('source: packaged path is only read from', src.includes("join(PLUGIN_ROOT, 'temp-session-config.txt')"))
  check('source: register binds the effect', src.includes('bindSchedulerEffect(hostCtx)'))
  check('source: disposer calls stopScheduler', /return \(\) => stopScheduler\(\)/.test(src))
} finally {
  if (host) {
    try { host.state.tracked = [] } catch (error) { void error }
    try { host.stopScheduler() } catch (error) { void error }
  }
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  for (const dir of [HOME_A, HOME_B]) {
    try { rmSync(dir, { recursive: true, force: true }) } catch (error) { void error }
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
