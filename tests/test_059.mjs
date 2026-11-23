// 0.8.9 — "创建临时会话失败：session create failed: agent-preset/not-found:
// Unknown agent preset: ops-ptc" (reported on a real 0.8.7 install).
//
// Not a Temp-button bug. Host side, `agents.createSession` resolves the Agent
// preset *before* it writes anything: the explicit `agentPreset`, else the
// registry's `selectedDefault`. That default lives in the profile as a plain
// string, and it outlives the plugin that declared the preset — dsh-ops was
// purged, `ops-ptc` stayed behind, and from then on *every* new session in that
// profile dies, the host's own New-session button included.
//
// Two things to pin:
//   1. Temp inherits the preset of the conversation it is created next to, so
//      it does not depend on that orphaned string when a working session exists.
//   2. When creation still fails on a missing preset, the toast names the preset
//      and says whose problem it is — the raw chain reads like our bug.
//
// Both helpers are pure, so they are lifted out of the bundle and exercised
// directly (no test hooks in the shipped file).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const SRC = readFileSync(ROOT + '/lib/client.js', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra))) }
}

/** Lift one `function name(...) { ... }` declaration out of the bundle. */
function lift(name) {
  const start = SRC.indexOf('function ' + name + '(')
  if (start < 0) throw new Error('not found in bundle: ' + name)
  let depth = 0
  let i = SRC.indexOf('{', start)
  const open = i
  for (; i < SRC.length; i += 1) {
    const ch = SRC[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return SRC.slice(start, i + 1)
    }
  }
  throw new Error('unbalanced braces in ' + name + ' (opened at ' + open + ')')
}

const listOf = new Function(lift('listOf') + '\nreturn listOf')()
const currentAgentPreset = new Function(
  lift('listOf') + '\n' + lift('currentAgentPreset') + '\nreturn currentAgentPreset')()
const missingPresetName = new Function(lift('missingPresetName') + '\nreturn missingPresetName')()

/** A uiWorkspace stand-in holding one current session and one preset. */
function fakeUi(preset, options = {}) {
  const current = options.current === undefined ? 's-1' : options.current
  const summary = {}
  if (preset !== undefined) summary.projectionValues = { agentPreset: preset }
  return {
    mainReference: { sessionId: current },
    sessions: { list: { getSnapshot: () => ({ ids: ['s-1'], byId: { 's-1': summary } }) } }
  }
}

// ---- inheriting the neighbour's preset ------------------------------------
check('preset: reads the current conversation\'s preset',
  currentAgentPreset(fakeUi('standard')) === 'standard')
check('preset: no current session means "let the host decide"',
  currentAgentPreset(fakeUi('standard', { current: null })) === '')
check('preset: a session without a projection yields nothing',
  currentAgentPreset(fakeUi(undefined)) === '')
check('preset: a non-string projection is ignored (no [object Object] in a request)',
  currentAgentPreset(fakeUi({ id: 'standard' })) === '')
check('preset: a throwing store is swallowed, not propagated into the click',
  currentAgentPreset({ mainReference: { sessionId: 's-1' }, sessions: { list: { getSnapshot() { throw new Error('boom') } } } }) === '')
check('preset: a missing sessions service is swallowed too',
  currentAgentPreset({ mainReference: { sessionId: 's-1' } }) === '')

// ---- the request actually carries it -------------------------------------
check('request: createNamed gets agentPreset only when it is known',
  /ui\.createNamed\(agentPreset \? \{ workspaceId: workspaceId, agentPreset: agentPreset \} : \{ workspaceId: workspaceId \}\)/.test(SRC))
check('request: the preset is resolved once, before the promise chain',
  /var workspaceId = newSessionWorkspace\(ui\)[\s\S]{0,200}?var agentPreset = currentAgentPreset\(ui\)[\s\S]{0,120}?var before = knownSessionIds\(ui\)/.test(SRC))

// ---- recognising the host's rejection ------------------------------------
// The real string, verbatim from the 0.8.7 toast on the user's machine.
const REAL = 'session create failed: agent-preset/not-found: Unknown agent preset: ops-ptc'
check('hint: pulls the preset out of the real message', missingPresetName({ message: REAL }) === 'ops-ptc', missingPresetName({ message: REAL }))
check('hint: works when the host appends its own tail',
  missingPresetName(new Error(REAL + ' (available: standard, ops)')) === 'ops-ptc')
check('hint: ignores unrelated failures',
  missingPresetName(new Error('workspace "w-1" not found')) === '')
check('hint: ignores a bare timeout',
  missingPresetName(new Error('The operation was aborted')) === '')
check('hint: survives a non-Error rejection',
  missingPresetName('agent-preset/not-found: Unknown agent preset: ops') === 'ops')
check('hint: nothing to say about an empty rejection', missingPresetName(undefined) === '')

// ---- the toast it produces ----------------------------------------------
check('toast: the preset name is substituted everywhere it appears',
  SRC.includes("String(t('temp.presetMissing')).split('{name}').join(stalePreset)"))
check('toast: the stale-preset branch runs before the generic failure toast',
  SRC.indexOf('var stalePreset = missingPresetName(error)') > 0 &&
  SRC.indexOf('var stalePreset = missingPresetName(error)') < SRC.indexOf("toast(t('temp.failed') + String((error && error.message) || error)"))
check('toast: it still goes out as an error, not a success',
  /if \(stalePreset\) \{\s*\n\s*toast\([^\n]+, true\)/.test(SRC))

// ---- both dictionaries carry the wording, with the placeholder ----------
for (const [lang, marker] of [['en', "'temp.label': 'Temp'"], ['zh', "'temp.label': '临时'"]]) {
  const at = SRC.indexOf(marker)
  const next = SRC.indexOf("'temp.presetMissing'", at)
  check('i18n(' + lang + '): temp.presetMissing exists in this table',
    at > 0 && next > at && next - at < 4000, next)
}
check('i18n: both languages keep the {name} placeholder',
  (SRC.match(/'temp\.presetMissing': '[^']*\{name\}[^']*'/g) || []).length === 2,
  (SRC.match(/'temp\.presetMissing': '[^']*\{name\}[^']*'/g) || []).length)

console.log('\n' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exitCode = 1
