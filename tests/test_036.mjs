// dsh-sidebar-suite 0.5.0 — layout `a` is gone, `n` (official default) is in.
//
// This suite guards the INTERACTION contract, not just the strings:
//   * the pill always offers exactly three mutually exclusive modes (b/c/n);
//   * the official default hides neither host group and has no action buttons;
//   * the pill stays visible there, so switching back is always possible even
//     when showQuickSwitch is off (the "you got in and cannot get out" trap);
//   * a profile still carrying `mode: a` migrates to `n` on read.
//
// It runs the real lib/client.js against the DOM stub. Replace client.js with
// the published 0.4.1 bundle and the mode/n/migration assertions fail.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { El, Doc, buildSidebar, matchSelector, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const client = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')
const index = fs.readFileSync(ROOT + '/lib/index.js', 'utf8')
const pkg = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8'))
const readme = fs.readFileSync(ROOT + '/README.md', 'utf8')
const guide = fs.readFileSync(ROOT + '/使用说明.md', 'utf8')
const changelog = fs.readFileSync(ROOT + '/CHANGELOG.md', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

// A minimal stand-in for the host's configForms service. It lets a legacy
// profile enter through the real config path instead of a hand-made shortcut.
function fakeConfigForms(initial) {
  const value = Object.assign({}, initial)
  const subs = []
  let revision = 1
  const controller = {
    getSnapshot: () => ({ value: Object.assign({}, value), revision }),
    subscribe(fn) { subs.push(fn); return () => {} },
    mutate(ops) {
      for (const op of ops) value[op.path[0]] = op.value
      revision += 1
      for (const fn of subs) fn()
      return Promise.resolve({ ok: true })
    },
  }
  return { get: () => controller }
}

function buildClient(options) {
  const settings = options || {}
  const tree = buildSidebar()
  const doc = tree.doc
  const storage = new Map()

  class MutationObserverStub {
    constructor(callback) { this.callback = callback; this.targets = [] }
    observe(target) { this.targets.push(target) }
    disconnect() { this.targets = [] }
    takeRecords() { return [] }
  }
  class ResizeObserverStub {
    constructor(callback) { this.callback = callback }
    observe() {}
    disconnect() {}
  }

  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
      getComputedStyle: () => ({ position: 'static', display: 'block' }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
      open() { return null },
    },
    document: doc,
    navigator: { language: 'zh-CN', clipboard: { writeText: () => Promise.resolve() } },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    fetch: async () => new Response('{}', { status: 404 }),
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub,
    ResizeObserver: ResizeObserverStub,
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
    requestAnimationFrame: (cb) => sbTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console,
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(client, sandbox, { filename: 'client.js' })

  const ReactStub = { createElement: () => null, useState: (value) => [value, () => {}], useEffect() {}, Fragment: 'Fragment' }
  const mod = sandbox.__entry.factory(() => ReactStub)

  const published = {}
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe() { return () => {} }, register() { return () => {} } },
    effect(fn) { return fn() },
    get(name) {
      if (name === 'configForms' && settings.configForms) return settings.configForms
      return undefined
    },
    inject(deps, callback) {
      if (typeof callback === 'function') {
        callback({ slots: { inject() {}, register() { return () => {} } }, configForms: undefined })
      }
    },
    provide(name, value) { published[name] = value },
  }
  mod.apply(ctx)
  const service = published.sidebarSuite || sandbox.window.__dshSidebarSuite
  return { tree, service, published, sandbox }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

async function main() {
  // ---- 1. source contracts -----------------------------------------------
  check('0.5.0: MODES is exactly b, c, n in that order', /var MODES = \['b', 'c', 'n'\]/.test(client))
  check('0.5.0: a survives only as a read alias for n', /var LEGACY_MODES = \{ a: 'n' \}/.test(client))
  check('0.5.0: the startup default is still b', /var DEFAULTS = \{ mode: 'b'/.test(client))
  check('0.5.0: no CSS rule selects the removed mode', !/data-dsbs-mode="a"\]/.test(client))
  check('0.5.0: the two fold buttons are gone',
    !client.includes("makeButton('fold-ext'") && !client.includes("makeButton('fold-ws'"))
  check('0.5.0: the fold glyphs are gone', !/\[data-dsbs-glyph="fold/.test(client))
  check('0.5.0: the a glyph is gone', !/\[data-dsbs-glyph="a"\]/.test(client))
  check('0.5.0: normalizeMode maps the legacy id',
    /function normalizeMode\(raw\)[\s\S]{0,220}LEGACY_MODES\[raw\]/.test(client))
  check('0.5.0: every config read goes through normalizeMode',
    /out\.mode = normalizeMode\(raw\.mode\)/.test(client))
  check('0.5.0: the settings picker reads through normalizeMode',
    /return normalizeMode\(value && value\.mode\)/.test(client))
  check('0.5.0: c has its own explicit branch', /else if \(state\.mode === 'c'\)/.test(client))
  check('0.5.0: the official default branch hides neither group',
    /extHidden = false\s+wsHidden = false/.test(client))
  check('0.5.0: mode buttons use their own id as glyph',
    client.includes("modeButton.setAttribute('data-dsbs-glyph', mode)"))
  check('0.5.0: only two context actions remain',
    client.includes('context: [tabSwap, pop]'))
  check('0.5.0: an empty action set hides the divider',
    /if \(visibleContext > 0\) parts\.separator\.removeAttribute\('hidden'\)[\s\S]{0,120}else parts\.separator\.setAttribute\('hidden', ''\)/.test(client))
  check('0.5.0: getLayout documents the new value set',
    /'b' \(toggle\), 'c' \(overlay\), 'n' \(official default\)/.test(client))
  check('0.5.0: both dictionaries describe mode n',
    /'mode\.n': 'Default'/.test(client) && /'mode\.n': '官方默认'/.test(client))
  check('0.5.0: schema accepts b/c/n and keeps a as an alias',
    /\.union\(\['b', 'c', 'n', 'a'\]\)/.test(index))
  // Version-pinned on purpose, but only as a floor: this suite owns the 0.5.x
  // layout contract, so a later patch (0.5.1 fixed the delete-path guard) must
  // not force an edit here. The lockstep check below is the real invariant.
  check('0.5.0+: package version is at least 0.5.0', pkg.version.localeCompare('0.5.0', 'en', { numeric: true }) >= 0)
  const embedded = (/var VERSION = '([^']+)'/.exec(client) || [])[1] || ''
  check('0.5.0+: client VERSION matches the package', embedded === pkg.version, embedded + ' vs ' + pkg.version)
  check('0.5.x: changelog has a 0.5.0 section', /^## 0\.5\.0/m.test(changelog))
  check('0.5.0: README documents the official default', /官方默认 \/ Default/.test(readme))
  check('0.5.0: the guide explains the a -> n migration',
    /mode: a/.test(guide) && /官方默认/.test(guide))
  check('0.5.0: the test chain includes this suite', /test_036\.mjs/.test(pkg.scripts.test || ''))

  // ---- 2. real bundle: the pill and the three modes ----------------------
  const loop = buildClient()
  await settle()
  const root = loop.tree.root
  const html = loop.tree.doc.documentElement
  const btn = (id) => root.querySelector('[data-dsbs-btn="' + id + '"]')
  const seg = root.querySelector('[data-dsbs-seg]')
  const separator = root.querySelector('[data-dsbs-sep]')
  const nav = loop.tree.nav
  const region = loop.tree.region

  check('runtime: the service is published', !!loop.service)
  check('runtime: fresh install starts in b', html.getAttribute('data-dsbs-mode') === 'b')
  check('runtime: the pill has exactly b, c and n',
    !!btn('mode-b') && !!btn('mode-c') && !!btn('mode-n'))
  check('runtime: the removed a button is not rendered', !btn('mode-a'))
  check('runtime: each mode glyph matches its id',
    btn('mode-b').getAttribute('data-dsbs-glyph') === 'b' &&
    btn('mode-c').getAttribute('data-dsbs-glyph') === 'c' &&
    btn('mode-n').getAttribute('data-dsbs-glyph') === 'n')
  check('runtime: no fold controls are rendered', !btn('fold-ext') && !btn('fold-ws'))

  // ---- 3. official default: no dead states, always a way back -----------
  btn('mode-n').click()
  await settle()
  check('official default: html mode is n', html.getAttribute('data-dsbs-mode') === 'n')
  check('official default: getLayout reports n', loop.service.getLayout().mode === 'n')
  check('official default: the panels group stays interactive',
    !nav.hasAttribute('inert') && !nav.hasAttribute('aria-hidden'))
  check('official default: the workspaces group stays interactive',
    !region.hasAttribute('inert') && !region.hasAttribute('aria-hidden'))
  check('official default: no action button is shown',
    btn('tab-swap').hasAttribute('hidden') && btn('pop').hasAttribute('hidden'))
  check('official default: the divider is hidden too', !!separator && separator.hasAttribute('hidden'))
  check('official default: the pill is NOT hidden (there is always a way back)',
    !!seg && !seg.hasAttribute('hidden') &&
    !btn('mode-b').hasAttribute('hidden') && !btn('mode-c').hasAttribute('hidden') &&
    !btn('mode-n').hasAttribute('hidden'))
  check('official default: the active mode is marked for assistive tech',
    btn('mode-n').getAttribute('aria-pressed') === 'true' &&
    btn('mode-b').getAttribute('aria-pressed') === 'false')

  btn('mode-b').click()
  await settle()
  check('no dead end: clicking b leaves the official default',
    html.getAttribute('data-dsbs-mode') === 'b')
  check('no dead end: the tab action returns in b', !btn('tab-swap').hasAttribute('hidden'))
  check('no dead end: the divider returns in b', !!separator && !separator.hasAttribute('hidden'))

  btn('mode-c').click()
  await settle()
  check('overlay: its own action returns in c',
    !btn('pop').hasAttribute('hidden') && btn('tab-swap').hasAttribute('hidden'))

  // ---- 4. legacy config migration ---------------------------------------
  {
    const legacy = buildClient({
      configForms: fakeConfigForms({ mode: 'a', tab: 'ws', showQuickSwitch: false, foldExt: true, foldWs: true }),
    })
    await settle()
    const legacyHtml = legacy.tree.doc.documentElement
    check('migration: a legacy profile still boots', !!legacy.service)
    check('migration: mode a is normalized to n, not silently dropped to b',
      legacyHtml.getAttribute('data-dsbs-mode') === 'n')
    check('migration: getLayout never reports the removed a',
      legacy.service.getLayout().mode === 'n')
    check('migration: legacy fold keys create no controls',
      !legacy.tree.root.querySelector('[data-dsbs-btn="fold-ext"]') &&
      !legacy.tree.root.querySelector('[data-dsbs-btn="fold-ws"]'))
    check('migration: legacy fold flags are not written back to html',
      !legacyHtml.hasAttribute('data-dsbs-fold-ext') && !legacyHtml.hasAttribute('data-dsbs-fold-ws'))
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => {
  console.error('test_036 crashed:', error)
  process.exitCode = 1
})
