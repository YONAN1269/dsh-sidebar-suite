// dsh-sidebar-suite 0.2.9 (updated for 0.5.0) — the toolbar became a
// segmented control with real vector icons. 0.5.0 removed the two fold
// buttons and layout `a` entirely; the pill now holds b / c / n.
//
// Nothing here drives a browser: 0.2.9 is a pure client-side change, so the
// assertions are contracts on lib/client.js plus the docs/version wiring. The
// class of bug this guards against is the one 0.2.8 shipped — a toolbar that
// rendered as 22x8 slivers because line-height:0 collapsed the buttons, and a
// "change layout" button with no glyph at all.
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Relocatable: <repo>/tests -> <repo>. No machine-specific paths (CI-safe).
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

// Ask the runner itself which suites it discovers, so wiring assertions do not
// go stale when suites are added or removed.
function suiteList() {
  const r = spawnSync(process.execPath, [ROOT + '/scripts/run-tests.mjs', '--list'], { encoding: 'utf8' })
  return (r.stdout || '').split(/\r?\n/).filter(Boolean)
}
const CLIENT = ROOT + '/lib/client.js'
const pkg = JSON.parse(readFileSync(ROOT + '/package.json', 'utf8'))
const client = readFileSync(CLIENT, 'utf8')
const index = readFileSync(ROOT + '/lib/index.js', 'utf8')
const readme = readFileSync(ROOT + '/README.md', 'utf8')
const detail = readFileSync(ROOT + '/DETAIL.md', 'utf8')
const guide = readFileSync(ROOT + '/使用说明.md', 'utf8')
const changelog = readFileSync(ROOT + '/CHANGELOG.md', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  →  ' + extra : '')) }
}

// ---- the segmented control ------------------------------------------------
check('bar: the three modes share one pill', client.includes("seg.setAttribute('data-dsbs-seg', '')"))
check('bar: the pill is a labelled group', client.includes("seg.setAttribute('role', 'group')"))
check('bar: every mode button goes into the pill',
  /for \(i = 0; i < MODES\.length; i\+\+\)[\s\S]{0,400}?seg\.appendChild\(modeButton\)/.test(client))
check('bar: the pill is appended before the divider',
  /bar\.appendChild\(seg\)[\s\S]{0,200}?bar\.appendChild\(separator\)/.test(client))
check('bar: divider still tracks the visible action buttons',
  client.includes('runtime.parts = { separator: separator, seg: seg, context: [tabSwap, pop, quick] }'))

// ---- icons ---------------------------------------------------------------
const GLYPHS = ['b', 'c', 'n', 'swap', 'pop', 'quick']
for (const g of GLYPHS) {
  check('icon: CSS defines a mask for "' + g + '"',
    client.includes('[data-dsbs-glyph="' + g + '"]{--dsbs-icon:url('))
}
// One factory call: the glyph is the mode id itself (b / c / n).
check('icon: each mode button uses its own mode id as the glyph',
  client.includes("modeButton.setAttribute('data-dsbs-glyph', mode)"))
for (const g of ['swap', 'pop', 'quick']) {
  check('icon: a button actually asks for "' + g + '"',
    client.includes("setAttribute('data-dsbs-glyph', '" + g + "')"))
}
check('0.5.0: the fold buttons and their glyphs are gone',
  !client.includes("makeButton('fold-ext'") && !client.includes("makeButton('fold-ws'") &&
  !client.includes('[data-dsbs-glyph="fold"]'))
check('0.5.0: the pill still holds three modes, in order',
  /var MODES = \['b', 'c', 'n'\]/.test(client))
check('icon: the quick-switch button got a glyph at last', // 0.2.8 shipped it blank
  /var quick = makeButton\('quick'[\s\S]{0,800}?quick\.setAttribute\('data-dsbs-glyph', 'quick'\)/.test(client))
check('icon: glyphs are masks, not <svg> children', // relabel() rewrites textContent
  !client.includes('createElementNS(') && client.includes('mask-image:var(--dsbs-icon)'))
check('icon: SVG payloads carry no raw single quote', // it would break the JS string literal
  !/--dsbs-icon:url\("[^)]*'/.test(client))

// ---- 0.7.3: legible in a narrow column, honest when unusable ------------
// The Cycle glyph was a pair of curved arrows that read as the same thing as
// the straight swap arrows once the column shows icons only. It is now a
// four-quadrant layout mark.
check('0.7.3: Cycle carries a layout glyph, not a second pair of arrows',
  /\[data-dsbs-glyph="quick"\]\{--dsbs-icon:url\("[^"]*%3Crect/.test(client) &&
  !client.includes('M13.4 7A5.5 5.5'))
// Code defaulted to true since 0.1.3 while the docs said "off by default".
check('0.7.3: Cycle is off by default, and schema agrees with the client',
  /var DEFAULTS = \{ mode: 'b', showQuickSwitch: false, tab: 'ext' \}/.test(client) &&
  /showQuickSwitch: false/.test(index))
check('0.7.3: the docs and the code tell the same story about Cycle',
  /默认不出现/.test(readme) && /默认不出现/.test(detail) && /showQuickSwitch: false/.test(client))
// A consumer tab owns the column, so the layout controls cannot act on it.
check('0.7.3: a consumer tab hides the whole bar, leaving no dead buttons',
  /if \(pluginTab\) runtime\.bar\.setAttribute\('hidden', ''\)/.test(client))
check('0.7.3: the track-uncertain case has its own honest wording',
  /'temp\.trackUncertain'/.test(client) && /temp\.trackUncertain/.test(client))
check('0.7.3: an unknown track result keeps the badge (safe direction)',
  /if \(createdId\) \{\s*if \(error && error\.trackFailed\) \{/.test(client))
check('0.7.3: the tab strip names the provider (tabs.own finally rendered)',
  client.includes("String(t('tabs.own')).replace('{name}', tabOwner)"))
check('0.7.3: the schedule-time field is really disabled when its switch is off',
  /disabled: policy\.scheduleDelete !== true/.test(client))
// The bar carries `display:flex` from an author rule, which beats the UA
// sheet's `[hidden]{display:none}`. Without an explicit rule, hiding the bar
// is a no-op -- exactly the bug this suite cannot see through the DOM stub.
check('0.7.3: the bar itself can actually be hidden by the hidden attribute',
  /\[data-dsbs-bar\]\[hidden\]\{display:none!important\}/.test(client))
check('0.7.3: a hidden tab cannot own the column (no dead end)',
  /activeRecord && activeRecord\.hidden !== true/.test(client))
check('0.7.3: a stuck temp creation is released by a watchdog',
  /tempWatchdog = setTimeout\(function \(\) \{[\s\S]{0,200}?releaseTempBusy\(\)/.test(client))
check('0.7.3: a slow session creation is re-checked before it is called failed',
  /var late = newOnes\(\)/.test(client))
check('0.7.3: creating a session hands the column back from a consumer tab',
  /if \(runtime\.activeTab\) activateTab\(null\)/.test(client))
check('0.7.3: an unresolvable sidebar clears the ptab flag before bailing',
  /setFlag\(html, 'data-dsbs-ptab', false\)\s*return/.test(client))
check('0.7.3: leaving the rail does not undo a newer layout choice',
  /if \(config\.values\.mode === runtime\.railSaved\.mode\)/.test(client))
check('0.7.3: getLayout filters activeTab like getActiveTab does',
  /activeTab: runtime\.activeTab && findTab\(runtime\.activeTab\) \? runtime\.activeTab : null/.test(client))
check('0.7.3: tab.close() unregisters instead of doing nothing when inactive',
  /close: function \(\) \{\s*unregisterTab\(record\.id, record\)/.test(client))
check('0.7.3: an out-of-range maxKept is put back, not silently ignored',
  /if \(target\) target\.value = String\(policy\.maxKept\)/.test(client))

// ---- geometry the 0.2.8 toolbar got wrong --------------------------------
const baseButton = (client.split('[data-dsbs-bar] button[data-dsbs-glyph]{')[1] || '').split('}')[0]
check('size: buttons are 28x26, not a collapsed sliver',
  baseButton.includes('width:28px') && baseButton.includes('height:26px') && client.includes('width:16px;height:16px'))
check('size: the base button sets an explicit box and zero padding',
  baseButton.includes('padding:0!important') && baseButton.includes('line-height:0!important'))
check('divider: rides to the right edge so the row is not lopsided',
  /\[data-dsbs-bar\]>span\{margin-left:auto/.test(client))

// ---- narrow / wide adaptation -------------------------------------------
check('narrow: the words hide but the glyph box does not collapse',
  /\[data-dsbs-bar\] button\[data-dsbs-glyph\]\{[^}]*font-size:0!important/.test(client))
check('wide: action buttons win their words back',
  client.includes('html:not([data-dsbs-narrow="true"]) [data-dsbs-bar]>button[data-dsbs-glyph]{width:auto!important'))
check('wide: the pill stays iconic even when there is room', // three labels would overflow
  /html:not\(\[data-dsbs-narrow="true"\]\) \[data-dsbs-bar\]>button/.test(client) &&
  !/html:not\(\[data-dsbs-narrow="true"\]\) \[data-dsbs-seg\]>button\{[^}]*font-size:12px/.test(client))
check('wide: the word grows the button, not the flex shrink', // flex:none lost to host styles
  client.includes('min-width:max-content!important'))

// ---- session rows --------------------------------------------------------
check('rows: active row gets a 2px inset accent rail',
  /\[data-row-key\^="session:"\]\[aria-selected="true"\]\{box-shadow:inset 2px 0 0 var\(--dsw-alias-state-business-primary/.test(client))
check('rows: the rail is dropped in the collapsed rail view',
  client.includes('html[data-dsbs-rail="true"] [data-row-key^="session:"][aria-selected="true"]{box-shadow:none!important}'))

// ---- version + docs ------------------------------------------------------
// "0.2.9 or later", not an exact string, so the next release does not have to
// touch this file.
const gte = (a, b) => {
  const x = String(a).split('.').map(Number)
  const y = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  }
  return true
}
check('package: version is 0.2.9 or later', gte(pkg.version, '0.2.9'), pkg.version)
check('package: the 0.2.9 suite is wired into the runner',
  /scripts\/run-tests\.mjs/.test((pkg.scripts || {}).test || '') &&
  suiteList().includes('test_029.mjs'))
check('docs: changelog records 0.2.9', /## 0\.2\.9/.test(changelog))
check('docs: changelog spells out the restart requirement', /0\.2\.9[\s\S]{0,800}?托盘退出/.test(changelog))
check('docs: README describes the toolbar as one control', /分段|segmented/i.test(readme))
check('docs: DETAIL describes the 0.2.9 toolbar', /0\.2\.9/.test(detail))
check('docs: guide mentions the icon toolbar', /图标/.test(guide))

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
