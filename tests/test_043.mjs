// dsh-sidebar-suite 0.7.4 (unreleased) — audit follow-up.
//
// #1 bindSchedulerEffect() used a one-shot `schedulerEffectBound` guard. On a
//    hot reload the module-level host is re-applied with a NEW ctx, but the
//    effect stayed bound to the OLD scope. When Cordis later disposed that old
//    scope, stopScheduler() ran with no new binding — the plugin was stopped
//    yet its 30s purge timer kept deleting sessions.
// #2 loadTempStatus()'s status fetch had no watchdog. A host that accepted the
//    request but never answered left tempStatusPending=true forever, so every
//    later heartbeat skipped it and temp badges/menu never initialised.
// #3 setField() updated in-memory config first and swallowed mutate() failures.
//    A stale revision or rejected promise showed a toggle as saved while the
//    next launch read back the old value. Now it rolls back and toasts.
//
// Everything runs against a throwaway DSH_HOME. No machine-specific paths.
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

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-043-'))
const DATA_DIR = path.join(HOME, 'dsh-sidebar-suite')
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.writeFileSync(
  path.join(DATA_DIR, 'temp-session-config.txt'),
  'SCHEDULE_DELETE=on\nSCHEDULE_TIME=03:00\nDELETE_ON_EXIT=on\n',
  'utf8',
)
process.env.DSH_HOME = HOME

function makeEffectCtx() {
  const ctx = {
    effectCalls: 0,
    disposers: [],
    effect(fn) {
      ctx.effectCalls += 1
      const disposer = fn()
      if (typeof disposer === 'function') ctx.disposers.push(disposer)
      return disposer
    },
    get(name) {
      if (name === 'connection') return { fetch: { register() {} } }
      if (name === 'workspaceRegistry') return { archiveSession: async () => true }
      return null
    },
    logger: { debug() {}, warn() {}, info() {}, error() {} },
  }
  return ctx
}

async function main() {
  // ---- 1. scheduler effect follows the CURRENT ctx ------------------------
  const mod = await import(HOST + '?v043=' + Date.now())
  const host = mod.createTempSessionHost(null)
  const ctx1 = makeEffectCtx()
  host.register(ctx1)

  check('effect: first apply binds once', ctx1.effectCalls === 1, 'calls=' + ctx1.effectCalls)
  check('effect: first apply is managed', host.state.schedulerEffectBound === true)
  check('effect: timer is alive', host.state.scheduler.timer !== null)
  check('effect: first ctx owns the timer', host.state.schedulerCtx === ctx1)

  const ctx2 = makeEffectCtx()
  host.register(ctx2)
  check('effect: re-apply binds the new ctx', ctx2.effectCalls === 1, 'calls=' + ctx2.effectCalls)
  check('effect: new ctx owns the timer', host.state.schedulerCtx === ctx2)
  check('effect: no duplicate timer', host.state.scheduler.timer !== null)

  // Cordis disposes the OLD scope AFTER the new one is up. Its stale cleanup
  // used to stop the new scope's timer — the plugin was dead but still purging.
  for (const dispose of ctx1.disposers) dispose()
  check('effect: stale disposer leaves the new timer alive', host.state.scheduler.timer !== null)
  check('effect: stale disposer does not clear ownership', host.state.schedulerCtx === ctx2)

  for (const dispose of ctx2.disposers) dispose()
  check('effect: current disposer stops the timer', host.state.scheduler.timer === null)
  check('effect: ownership is released', host.state.schedulerCtx === null)
  check('effect: unmanaged state is reported', host.status().schedule.managed === false)

  // ---- 2. watchdog and rollback are present in the shipped source ---------
  check('status: a timeout is passed to the status call',
    /api\/dsh-temp-session\.status',\s*\{\s*timeoutMs:\s*20000\s*\}/.test(CLIENT_SRC))
  check('tempCall: timeout is opt-in through options.timeoutMs',
    CLIENT_SRC.includes('var timeoutMs = options && options.timeoutMs'))
  check('tempCall: watchdog rejects on timeout',
    /request timeout after ' \+ timeoutMs/.test(CLIENT_SRC))
  check('tempCall: watchdog timer is cleared on settle',
    (CLIENT_SRC.match(/clearTimeout\(timer\)/g) || []).length >= 2)

  check('setField: remembers the previous value',
    CLIENT_SRC.includes('var previous = config.values[field]') &&
    CLIENT_SRC.includes('rollbackPatch[field] = previous'))
  check('setField: a failed mutate rolls back',
    /config\.values = assign\(\{\}, config\.values, rollbackPatch\)/.test(CLIENT_SRC))
  check('setField: a failed mutate is surfaced',
    CLIENT_SRC.includes("toast(t('policy.failed')"))
  check('setField: the silent catch is gone',
    !CLIENT_SRC.includes("result.catch(function () {})"))
  // 0.8.6 — the real host refuses a write whose expectedRevision was read
  // before an earlier write in the same controller queue landed, and the
  // client-side mutate() only answers boolean, so the toast showed a bare
  // config key ("保存失败: tab"). The revision now resolves inside the host
  // controller's serialized queue, one retry absorbs the residual race, and
  // the toast names the control.
  check('setField: the revision is resolved by the host write queue',
    !CLIENT_SRC.includes('config.controller.mutate(ops, revision)') &&
    !CLIENT_SRC.includes('snapshot && snapshot.revision'))
  check('setField: one in-place retry absorbs a lost revision race',
    CLIENT_SRC.includes('function retryOrFail()') &&
    CLIENT_SRC.includes('setTimeout(function () {') && CLIENT_SRC.includes('}, 400)') &&
    CLIENT_SRC.includes('if (attempts >= 2)') &&
    CLIENT_SRC.includes('if (!runtime.disposed) attempt()'))
  check('setField: the refusal toast names the control',
    CLIENT_SRC.includes('function fieldLabel(field)') &&
    CLIENT_SRC.includes('fieldLabel(field)') && CLIENT_SRC.includes("'policy.conflictHint'"))
  check('writeDefaultMode: same no-preread contract',
    /controller\.mutate\(\[\{ op: 'set', path: \['mode'\], value: mode \}\]\)/.test(CLIENT_SRC))

  // ---- 3. guard source stays honest ---------------------------------------
  check('source: schedulerCtx is part of host state', HOST_SRC.includes('schedulerCtx: null'))
  check('source: stale cleanup is guarded',
    HOST_SRC.includes('if (state.schedulerCtx !== boundCtx) return'))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
