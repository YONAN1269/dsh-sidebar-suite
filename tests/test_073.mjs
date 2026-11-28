// dsh-sidebar-suite 1.1.5 — presentation and dictionary guards: R-15/R-16
// copy, R-20 disabled state, R-21 focus ring, UI-06/07/08/10/11, pages pill
// sizing, CE-04 timer teardown, CE-11 named constants, PD-11 version comment,
// R-18 English-only count suffix.
//
// These are source-contract assertions against the real client.js. The
// executable branches for R-04/R-13/R-16/CE-06 live in test_070/071/072.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const SRC = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

const enBlock = SRC.slice(SRC.indexOf('en: {'), SRC.indexOf('zh: {'))
const zhBlock = SRC.slice(SRC.indexOf('zh: {'))
const CJK = /[一-鿿]/

function rule(selector) {
  const start = SRC.indexOf(selector)
  if (start < 0) return ''
  const end = SRC.indexOf('}', start)
  return end >= 0 ? SRC.slice(start, end + 1) : ''
}

// ---- R-20: plugin-scoped disabled state ---------------------------------
// The host's disabled look is set on component-class selectors (e.g.
// `.selector:disabled`, `.input:disabled`, `.trigger:disabled`); none carries
// `!important`. The plugin rule therefore upgrades to element-level
// selectors (button/input + [disabled]) so its specificity (0,2,1) beats the
// host class rule (0,2,0) without a plugin-side `!important`.
{
  const btnRule = rule('[data-dsbs-config] button[disabled]')
  check('R20: a plugin-scoped disabled button rule exists', btnRule.length > 0, btnRule)
  check('R20: disabled state dims and resets the pointer cursor',
    btnRule.indexOf('opacity:.4') >= 0 && btnRule.indexOf('cursor:default') >= 0, btnRule)
  check('R20: the rule also covers disabled inputs and panel action buttons',
    SRC.indexOf('[data-dsbs-config] input[disabled]') >= 0 &&
    SRC.indexOf('[data-dsbs-webpage-actions] button[disabled]') >= 0, SRC)
  check('R20: the old bare-attribute disabled rule is gone',
    SRC.indexOf('[data-dsbs-config] [disabled]') < 0 &&
    SRC.indexOf('[data-dsbs-webpage-actions] [disabled]') < 0)
  check('R20: no bare global [disabled] rule is introduced',
    !/(^|[,{])\s*\[disabled\]\{/m.test(SRC))
  // The schedule-time and keep-deleted-day inputs used to carry an inline
  // opacity:.55 that a stylesheet rule could not override; disabled inputs
  // must now ride the shared CSS rule instead of a conditional inline fade.
  check('R20: disabled inputs no longer fade themselves via inline opacity',
    !/opacity:\s*policy\./.test(SRC))
}

// ---- R-21: focus-visible rings reuse the shared focus token -------------
{
  const btnRule = rule('[data-dsbs-config] button:focus-visible')
  const numRule = rule('[data-dsbs-config] input[type="number"]:focus-visible')
  check('R21: config pills/cards get a focus-visible ring', btnRule.length > 0, btnRule)
  check('R21: number inputs get a focus-visible ring', numRule.length > 0, numRule)
  check('R21: the ring reuses --dsw-focus-ring-* tokens',
    btnRule.indexOf('var(--dsw-focus-ring-width') >= 0 &&
    btnRule.indexOf('var(--dsw-focus-ring-color') >= 0 &&
    numRule.indexOf('var(--dsw-focus-ring-width') >= 0 &&
    numRule.indexOf('var(--dsw-focus-ring-color') >= 0, btnRule + ' | ' + numRule)
}

// ---- UI-06: reduced motion stops the pulse ------------------------------
{
  const media = SRC.indexOf('@media (prefers-reduced-motion: reduce)')
  check('UI06: a reduced-motion media block exists', media >= 0)
  check('UI06: the pulse animation is disabled under reduced motion',
    media >= 0 && SRC.slice(media, media + 260).indexOf('[data-dsbs-webpage-pulse]{animation:none}') >= 0)
}

// ---- UI-08: tab bar right-edge fade mask --------------------------------
{
  const r = rule('[data-dsbs-tabs]')
  check('UI08: the third-party tab bar carries a right-edge mask',
    r.indexOf('mask-image:linear-gradient(to right,#000') >= 0, r)
}

// ---- UI-10: webview surface follows the alias background ----------------
{
  const webviewRule = rule('[data-dsbs-webpage-body] webview')
  check('UI10: the embedded webview background follows the alias base bg',
    webviewRule.indexOf('var(--dsw-alias-bg-base') >= 0, webviewRule)
}

// ---- UI-11: panel subtitle aligns to 11px --------------------------------
{
  const r = rule('[data-dsbs-webpage-title] span')
  check('UI11: the panel subtitle is 11px', r.indexOf('font-size:11px') >= 0, r)
}

// ---- pages pill: 22px buttons, 10.5px text, 24px container ---------------
{
  const bar = rule('[data-dsbs-pages]{')
  const btn = rule('[data-dsbs-pages] button{')
  check('Pill: the page-pill container keeps its 24px height', bar.indexOf('height:24px') >= 0, bar)
  check('Pill: pill buttons are 22px high', btn.indexOf('height:22px') >= 0, btn)
  check('Pill: pill text is 10.5px', btn.indexOf('font-size:10.5px') >= 0, btn)
}

// ---- R-15: update-command note, bilingual -------------------------------
{
  const bilStart = SRC.indexOf('BILINGUAL_SETTINGS = {')
  const bilEnd = SRC.indexOf('for (var key in BILINGUAL_SETTINGS)')
  const bilBlock = SRC.slice(bilStart, bilEnd)
  check('R15: the update-command note row is rendered',
    SRC.indexOf('data-dsbs-update-note') >= 0)
  check('R15: the note key is in the bilingual settings catalog',
    bilBlock.indexOf("'options.updateNote'") >= 0)
  const noteLine = bilBlock.slice(bilBlock.indexOf('options.updateNote'), bilBlock.indexOf('options.updateNote') + 360)
  check('R15: the note carries both a Chinese and an English half',
    CJK.test(noteLine) && /[A-Za-z]/.test(noteLine))
  check('R15: the note mentions replacing the desktop profile',
    noteLine.indexOf('desktop') >= 0)
}

// ---- R-18: English count suffix is English-only --------------------------
{
  const m = SRC.match(/'temp\.countSuffix':\s*'([^']*)'/)
  const enSuffix = enBlock.match(/'temp\.countSuffix':\s*'([^']*)'/)
  check('R18: the English count suffix entry exists', !!enSuffix)
  check('R18: the English count suffix has no CJK characters',
    !!enSuffix && !CJK.test(enSuffix[1]), enSuffix && enSuffix[1])
  check('R18: the zh count suffix keeps its Chinese wording',
    zhBlock.indexOf('当前 {n} 个临时会话') >= 0)
  void m
}

// ---- UI-07: gold star keeps its color with a rationale comment -----------
{
  check('UI07: the gold star color is retained', SRC.indexOf('#e8b931') >= 0)
  const commentBlock = SRC.slice(SRC.indexOf('Star color:'), SRC.indexOf('Star color:') + 320)
  check('UI07: a comment records why no alias token is wired in',
    commentBlock.indexOf('alias') >= 0 && commentBlock.indexOf('token') >= 0, commentBlock)
}

// ---- CE-04: archive listener timer handle is cleared on teardown ---------
{
  check('CE04: the debounce timer handle is held in a variable',
    /var favoriteArchiveTimer = null/.test(SRC))
  check('CE04: the teardown clears the timer handle',
    /clearTimeout\(favoriteArchiveTimer\)/.test(SRC) && /favoriteArchiveTimer = null/.test(SRC))
}

// ---- CE-11: inline magic numbers are named constants --------------------
{
  const constants = [
    'FAVORITE_QUEUE_MAX', 'FAVORITE_ARCHIVE_READ_WINDOW_MS', 'FAVORITE_ARCHIVE_RECHECK_MS',
    'WEB_LOGIN_RETRY_WINDOW_MS', 'WEB_LOGIN_RESTORE_RETRY_MS', 'WEB_LOGIN_CAPTURE_POLL_MS',
  ]
  for (const name of constants) {
    check('CE11: constant ' + name + ' is defined and used',
      new RegExp('var ' + name + ' =').test(SRC) &&
      SRC.split(name).length >= 3)
  }
}

// ---- PD-11: no stale next-version comment in the bundle -----------------
{
  check('PD11: client.js no longer mentions 1.1.7', SRC.indexOf('1.1.7') < 0)
  check('PD11: the bundle version is 1.1.6', SRC.indexOf("var VERSION = '1.1.6'") >= 0)
}

// ---- PD-12: the settings page subscribes even when configForms is late ---
// Review fix: the mount-time subscribe used to give up for the component's
// lifetime when the controller had not come up yet, leaving the highlighted
// layout card on a stale default. The effect now retries once a second and
// re-seeds the moment the controller appears.
{
  check('PD12: the mode/focus subscribe retries until the controller appears',
    SRC.indexOf('window.setTimeout(attempt, 1000)') >= 0)
  check('PD12: the subscribe effect re-seeds after subscribing',
    /off = controller\.subscribe\(function \(\) \{[\s\S]{0,80}?\}\)[\s\S]{0,80}adopt\(\)/.test(SRC))
}

// ---- R-16: clear-login copy in both dictionaries -------------------------
{
  const keys = ['page.clearLogin', 'page.clearLoginConfirm', 'page.clearLoginOk', 'page.clearLoginEmpty', 'page.clearLoginFail']
  for (const key of keys) {
    check('R16: dict key ' + key + ' exists in en and zh',
      enBlock.indexOf("'" + key + "'") >= 0 && zhBlock.indexOf("'" + key + "'") >= 0)
  }
  check('UI09: fav.emptyAll exists in en and zh',
    enBlock.indexOf("'fav.emptyAll'") >= 0 && zhBlock.indexOf("'fav.emptyAll'") >= 0)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exitCode = 1
