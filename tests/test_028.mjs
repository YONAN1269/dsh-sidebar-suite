// dsh-sidebar-suite 0.2.8 — graphical settings for every config key + hot
// reload of temp-session-config.txt.
//
// Part A drives the REAL Host half against a throwaway DSH_HOME: it edits the
// config file the way Notepad would and asserts the running process picks the
// change up without a restart, without a second register(), and without
// clobbering a hand edit when the UI saves one of its own switches.
// Part B guards the wiring/copy so this cannot silently regress.
import fs from 'node:fs'
import { mkdtempSync, readFileSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// Relocatable: <repo>/tests -> <repo>. No machine-specific paths (CI-safe).
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const CLIENT = ROOT + '/lib/client.js'
const HOST = ROOT + '/lib/temp-session-host.mjs'
const TEMPLATE = ROOT + '/temp-session-config.txt'
const HOME = mkdtempSync(join(tmpdir(), 'dsbs-028-'))
process.env.DSH_HOME = HOME
// 0.6.1: the live config lives in DSH home; the packaged file is a template.
const CONFIG = HOME + '/dsh-sidebar-suite/temp-session-config.txt'
const originalConfig = readFileSync(TEMPLATE, 'utf8')
fs.mkdirSync(HOME + '/dsh-sidebar-suite', { recursive: true })
fs.writeFileSync(CONFIG, originalConfig, 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  →  ' + extra : '')) }
}

function makeCtx(registered) {
  return {
    get(name) {
      if (name === 'connection') return { fetch: { register(spec) { registered.push(spec) } } }
      if (name === 'workspaceRegistry') return { archiveSession: async () => true }
      return null
    },
    logger: { debug() {}, warn() {}, info() {}, error() {} },
  }
}

/** Force a distinct mtime so the stamp cannot collide on coarse filesystems. */
function editConfig(text) {
  writeFileSync(CONFIG, text, 'utf8')
  const stamp = new Date(Date.now() + 2000)
  utimesSync(CONFIG, stamp, stamp)
}

const swap = (key, value) => originalConfig.replace(new RegExp('^' + key + '=.*$', 'm'), key + '=' + value)

// ---- Part A: the Host half really reloads a Notepad edit ------------------
try {
  const hostModule = await import(pathToFileURL(HOST).href)
  const registered = []
  const host = hostModule.createTempSessionHost(makeCtx(registered))
  host.register(makeCtx(registered))

  const boot = host.status()
  check('boot: revision is a number', typeof boot.configRevision === 'number', String(boot.configRevision))
  check('boot: status carries every editable key',
    boot.showButton === true && boot.chatModePolicy === 'hide' && boot.buttonStyle === 'pair' &&
    boot.expandAllSessions === true && boot.deleteOnExit === true && boot.scheduleDelete === false &&
    boot.scheduleTime === '03:00' && boot.maxKept === 20)
  check('boot: configFile is exposed', typeof boot.configFile === 'string' && boot.configFile.endsWith('temp-session-config.txt'))
  check('boot: source is boot', boot.configReloadSource === 'boot', boot.configReloadSource)

  // A hand edit changes six keys at once. No re-register, no restart.
  let edited = originalConfig
  for (const [key, value] of [
    ['SHOW_TEMP_BUTTON', 'off'],
    ['TEMP_IN_CHAT_MODE', 'show'],
    ['TEMP_BUTTON_STYLE', 'own'],
    ['EXPAND_ALL_SESSIONS', 'off'],
    ['SCHEDULE_DELETE', 'on'],
    ['SCHEDULE_TIME', '23:30'],
    ['MAX_KEPT', '7'],
  ]) edited = edited.replace(new RegExp('^' + key + '=.*$', 'm'), key + '=' + value)
  editConfig(edited)

  const hot = host.status()
  check('hot reload: revision advanced', hot.configRevision > boot.configRevision,
    boot.configRevision + ' -> ' + hot.configRevision)
  check('hot reload: source is file', hot.configReloadSource === 'file', hot.configReloadSource)
  check('hot reload: showButton off', hot.showButton === false)
  check('hot reload: chat policy show', hot.chatModePolicy === 'show', hot.chatModePolicy)
  check('hot reload: buttonStyle own', hot.buttonStyle === 'own', hot.buttonStyle)
  check('hot reload: expandAll off', hot.expandAllSessions === false)
  check('hot reload: maxKept 7', hot.maxKept === 7, String(hot.maxKept))
  check('hot reload: daily cleanup enabled', hot.scheduleDelete === true)
  check('hot reload: clock moved', hot.scheduleTime === '23:30', hot.scheduleTime)
  check('hot reload: scheduler target recomputed',
    !!(hot.schedule && hot.schedule.enabled && hot.schedule.nextRunAt),
    JSON.stringify(hot.schedule))
  check('hot reload: publicConfig agrees', host.publicConfig().maxKept === 7 && host.publicConfig().buttonStyle === 'own')
  check('hot reload: probe carries the revision', host.probe().configRevision === hot.configRevision)

  // The UI saving one switch must not erase an unrelated hand edit.
  editConfig(swap('MAX_KEPT', '33'))
  const saved = host.saveConfig({ deleteOnExit: false })
  const fileAfterSave = readFileSync(CONFIG, 'utf8')
  check('ui save: reported ok', saved && saved.ok === true)
  check('ui save: unrelated hand edit survives', /^MAX_KEPT=33$/m.test(fileAfterSave))
  check('ui save: the UI change is written', /^DELETE_ON_EXIT=off$/m.test(fileAfterSave))
  const afterSave = host.status()
  check('ui save: in-memory state has both', afterSave.maxKept === 33 && afterSave.deleteOnExit === false,
    afterSave.maxKept + '/' + afterSave.deleteOnExit)
  check('ui save: source is ui', afterSave.configReloadSource === 'ui', afterSave.configReloadSource)

  const configRoute = registered.find((r) => r.path === '/api/dsh-temp-session.config')
  check('route: config route registered', !!configRoute)
  if (configRoute) {
    const res = await configRoute.fetch(new Request('http://localhost/api/dsh-temp-session.config'))
    const body = await res.json()
    check('route: GET exposes all keys',
      body.ok === true && body.showButton === true && body.buttonStyle === 'pair' &&
      body.expandAllSessions === true && body.maxKept === 33 && typeof body.configRevision === 'number',
      JSON.stringify(body))
  }
  check('hot reload: refresh helper is exported', typeof hostModule.createTempSessionHost(makeCtx([])).refreshConfigIfChanged === 'function')
} finally {
  writeFileSync(CONFIG, originalConfig, 'utf8')
}

// ---- Part B: wiring and user-facing copy ----------------------------------
const client = readFileSync(CLIENT, 'utf8')
const hostSrc = readFileSync(HOST, 'utf8')
const cfg = readFileSync(CONFIG, 'utf8')
const pkg = JSON.parse(readFileSync(ROOT + '/package.json', 'utf8'))
const readme = readFileSync(ROOT + '/README.md', 'utf8')
const detail = readFileSync(ROOT + '/DETAIL.md', 'utf8')
const guide = readFileSync(ROOT + '/使用说明.md', 'utf8')
const changelog = readFileSync(ROOT + '/CHANGELOG.md', 'utf8')

check('config: header no longer demands a restart', /0\.2\.8/.test(cfg) && !/FULLY QUIT and reopen/.test(cfg))
check('config: header explains the ~3s hot reload', /3 秒自动生效/.test(cfg) && /no restart/.test(cfg))
check('config: all eight keys are still present',
  ['SHOW_TEMP_BUTTON', 'TEMP_IN_CHAT_MODE', 'TEMP_BUTTON_STYLE', 'EXPAND_ALL_SESSIONS',
    'DELETE_ON_EXIT', 'SCHEDULE_DELETE', 'SCHEDULE_TIME', 'MAX_KEPT'].every((k) => new RegExp('^' + k + '=', 'm').test(cfg)))
check('host: reload is stamp-based, no fs.watch dependency',
  hostSrc.includes('function refreshConfigIfChanged') && hostSrc.includes('configStamp()'))
check('host: status is a reload checkpoint', /function status\(\) \{[\s\S]{0,160}refreshConfigIfChanged\(\)/.test(hostSrc))
check('client: sidebar re-applies settings in place', client.includes('function applyTempSettings(data)'))
check('client: sidebar has a config heartbeat', client.includes("'sidebar-suite: config hot reload'"))
check('client: visibility can be turned back on', client.includes('else tempButton.removeAttribute(\'hidden\')'))
check('client: new options card is rendered', client.includes("'data-dsbs-options': ENTRY"))
check('client: every remaining key has a control',
  ['showButton', 'inChatMode', 'buttonStyle', 'expandAllSessions', 'maxKept'].every((k) =>
    client.includes('persist({ ' + k + ': ') || client.includes('persist({ ' + k + ':') || client.includes(k + ': next') || client.includes(k + ': Math.min')))
check('client: manual cleanup uses the real purge route',
  client.includes("'api/dsh-temp-session.purge'") && client.includes('function purgeNow()'))
check('client: detail page polling is revision-gated', client.includes('rev !== revision'))
check('client: settings help explains both edit paths', client.includes('Notepad') && client.includes('no restart'))
// Anchored to "0.2.8 or later" rather than an exact string: this suite tests
// the 0.2.8 feature set, and bumping the version for the next release should
// not break it.
const gte = (a, b) => {
  const x = String(a).split('.').map(Number)
  const y = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  }
  return true
}
check('package: version is 0.2.8 or later', gte(pkg.version, '0.2.8'), pkg.version)
check('package: test chain includes 0.2.8 suite', /tests\/test_028\.mjs/.test((pkg.scripts || {}).test || ''))
check('docs: README no longer says a config edit needs a restart',
  !/保存后\*\*完全退出并重开 DSH\*\* 生效/.test(readme))
check('docs: DETAIL describes the 0.2.8 settings', /0\.2\.8/.test(detail))
check('docs: guide describes hot reload', /3 秒|自动生效/.test(guide))
check('docs: changelog records 0.2.8', /## 0\.2\.8/.test(changelog))

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
