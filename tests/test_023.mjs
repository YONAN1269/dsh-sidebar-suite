// dsh-sidebar-suite 0.2.3 (0.2.4 additions) — the detail-page settings card
// and its feedback box, including the marketplace comments channel.
//
// The settings UI is a React component the old client test never rendered (it
// deliberately failed `require('react')`). This runs the real client bundle in
// a vm sandbox with a minimal React whose useState/useEffect drive re-renders,
// then asserts on the produced element tree and on the HTTP calls a click
// makes. Each scenario gets its own sandbox: the client keeps module-level
// ownership state, so reusing one would test the teardown logic instead.
import fs from 'node:fs'
import vm from 'node:vm'
import { pathToFileURL, fileURLToPath } from 'node:url'

// Relocatable: <repo>/tests -> <repo>. No machine-specific paths (CI-safe).
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const CLIENT = ROOT + '/lib/client.js'

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  →  ' + extra : '')) }
}

// ---- minimal DOM ---------------------------------------------------------
function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    style: {},
    className: '',
    textContent: '',
    parentNode: null,
    setAttribute(name, value) { this.attributes[name] = String(value) },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null },
    removeAttribute(name) { delete this.attributes[name] },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) },
    appendChild(child) { if (child) { child.parentNode = this; this.children.push(child) } return child },
    insertBefore(child) { if (child) { child.parentNode = this; this.children.unshift(child) } return child },
    removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); return child },
    addEventListener() {}, removeEventListener() {}, click() {}, focus() {},
    getBoundingClientRect() { return { width: 260, height: 40, top: 0, left: 0 } },
    querySelector() { return null },
    querySelectorAll() { return [] },
  }
}

// ---- element-tree helpers ------------------------------------------------
function findAll(node, predicate, out) {
  const result = out || []
  if (!node || typeof node !== 'object') return result
  if (node.type && predicate(node)) result.push(node)
  for (const child of node.children || []) findAll(child, predicate, result)
  return result
}

function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.children)
}

// ---- one isolated client instance ---------------------------------------
function buildClient(fetchImpl) {
  const doc = {
    baseURI: 'http://localhost/app/',
    documentElement: makeEl('html'),
    body: makeEl('body'),
    head: makeEl('head'),
    getElementById() { return null },
    querySelector() { return null },
    querySelectorAll() { return [] },
    createElement: makeEl,
    addEventListener() {}, removeEventListener() {},
  }

  // React hooks: index-based storage, so a re-render sees the same slots.
  const hooks = []
  let hookIndex = 0
  let pending = []
  const ran = new Set()
  let Component = null

  function useState(initial) {
    const index = hookIndex++
    if (hooks.length <= index) hooks[index] = typeof initial === 'function' ? initial() : initial
    return [hooks[index], (next) => {
      hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
      render()
    }]
  }
  function useEffect(fn) {
    pending.push({ index: hookIndex++, fn })
  }
  const ReactStub = {
    createElement(type, props) {
      const children = []
      const rest = Array.prototype.slice.call(arguments, 2)
      const push = (value) => {
        if (value === null || value === undefined || value === false) return
        if (Array.isArray(value)) { value.forEach(push); return }
        children.push(value)
      }
      rest.forEach(push)
      return { type, props: props || {}, children }
    },
    useState,
    useEffect,
    Fragment: 'Fragment',
  }

  function render() {
    if (!Component) return null
    hookIndex = 0
    pending = []
    const tree = Component()
    for (const effect of pending) {
      if (ran.has(effect.index)) continue
      ran.add(effect.index)
      effect.fn()
    }
    return tree
  }

  const requests = []
  const storage = new Map()
  const opened = []
  const copied = []
  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
      getComputedStyle: () => ({ position: 'static' }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      setTimeout, clearTimeout, setInterval, clearInterval,
      // The real shell answers window.open with "deny" after handing the URL
      // to the OS browser, so returning null here is the faithful behaviour.
      open(url, target) { opened.push({ url: String(url), target: String(target || '') }); return null },
    },
    document: doc,
    navigator: {
      language: 'zh-CN',
      clipboard: {
        writeText(text) { copied.push(String(text)); return Promise.resolve() },
      },
    },
    localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) },
    fetch: async (url, init) => {
      requests.push({ url: String(url), method: (init && init.method) || 'GET', body: init && init.body })
      return fetchImpl(url, init)
    },
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console,
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(CLIENT, 'utf8'), sandbox, { filename: 'client.js' })

  const mod = sandbox.__entry.factory(() => ReactStub)
  const registered = []
  const specNames = []
  const slots = {
    inject(spec, cb) { if (typeof cb === 'function') cb() },
    register(spec, component) { registered.push(component); specNames.push(spec && spec.name); return () => {} },
  }
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'zh-CN' }) },
    effect(fn) { const d = fn(); if (typeof d === 'function') d(); return d },
    get() { return undefined },
    inject(deps, cb) { if (typeof cb === 'function') cb({ slots, configForms: undefined }) },
  }
  mod.apply(ctx)

  return {
    requests,
    registered,
    specNames,
    setComponent(component) { Component = component },
    render,
    opened,
    copied,
    storage,
    /** Make every clipboard route fail, the way a locked-down browser would. */
    breakCopy() {
      sandbox.navigator.clipboard.writeText = () => Promise.reject(new Error('blocked'))
    },
    get hooks() { return hooks },
  }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json' },
  })
}

// ---- scenario 1: healthy backend ----------------------------------------
let serverConfig = { deleteOnExit: true, scheduleDelete: false, scheduleTime: '03:00' }
const live = buildClient(async (url, init) => {
  const text = String(url)
  const method = (init && init.method) || 'GET'
  if (text.includes('dsh-temp-session.config')) {
    if (method === 'POST') {
      serverConfig = Object.assign({}, serverConfig, JSON.parse(init.body || '{}'))
      return jsonResponse(Object.assign({ ok: true }, serverConfig))
    }
    return jsonResponse(Object.assign({ ok: true }, serverConfig))
  }
  if (text.includes('dsh-temp-session.status')) return jsonResponse({ ok: true, showButton: true })
  if (text.includes('dsh-temp-session.list')) return jsonResponse({ ok: true, ids: [], count: 0 })
  return new Response('not found', { status: 404 })
})

// 0.6.0: two contributions — the detail-page card, then the New-session seat.
check(
  'client: detail-page component registered',
  live.registered.length === 2
    && live.specNames[0] === 'plugins.bundle.config'
    && live.specNames[1] === 'sidebar.session.action',
  live.specNames.join(',')
)
const Component = live.registered[0]
check('client: registered a component function', typeof Component === 'function')
live.setComponent(Component)

let tree = live.render()
check('policy: card renders', !!tree)
check('policy: title present', textOf(tree).includes('临时会话自动删除'), textOf(tree).slice(0, 100))
check('intro: settings card states the sidebar focus', textOf(tree).includes('专门针对改进 DSH 左侧栏体验'))
check('intro: settings card names usefulness and looks', textOf(tree).includes('强实用性') && textOf(tree).includes('美观性'))
check('intro: statement has its own hook', findAll(tree, (n) => n.props && Object.prototype.hasOwnProperty.call(n.props, 'data-dsbs-intro')).length === 1)

await new Promise((r) => setTimeout(r, 80))
tree = live.render()
check('policy: both switches shown', textOf(tree).includes('退出 DSH 时删除') && textOf(tree).includes('每天定时清理'))
check('policy: current values reflected', textOf(tree).includes('开') && textOf(tree).includes('关'), textOf(tree).slice(-200))

const buttons = findAll(tree, (n) => n.type === 'button' && n.props && n.props.onClick)
check('policy: two toggle buttons wired', buttons.length >= 2, String(buttons.length))

const offToggle = buttons.find((b) => textOf(b) === '关')
check('policy: schedule toggle starts off', !!offToggle)
if (offToggle) {
  const before = live.requests.filter((r) => r.method === 'POST').length
  offToggle.props.onClick()
  await new Promise((r) => setTimeout(r, 40))
  const posts = live.requests.filter((r) => r.method === 'POST')
  check('policy: click sends a save request', posts.length === before + 1, String(posts.length))
  const body = posts.length ? JSON.parse(posts[posts.length - 1].body) : {}
  check('policy: click enables the schedule', body.scheduleDelete === true, JSON.stringify(body))
  check('policy: backend state updated', serverConfig.scheduleDelete === true)
}

tree = live.render()
const timeInput = findAll(tree, (n) => n.type === 'input' && n.props && n.props.type === 'time')[0]
check('policy: time input rendered', !!timeInput)
check('policy: time input shows current value', !!timeInput && timeInput.props.value === '03:00', timeInput && String(timeInput.props.value))
if (timeInput) {
  const before = live.requests.filter((r) => r.method === 'POST').length
  timeInput.props.onChange({ target: { value: '23:30' } })
  await new Promise((r) => setTimeout(r, 40))
  const posts = live.requests.filter((r) => r.method === 'POST')
  const body = posts.length ? JSON.parse(posts[posts.length - 1].body) : {}
  check('policy: changing the time saves it', posts.length === before + 1 && body.scheduleTime === '23:30', JSON.stringify(body))
  check('policy: backend time updated', serverConfig.scheduleTime === '23:30')
}

tree = live.render()
check('policy: saved hint appears', textOf(tree).includes('已保存'), textOf(tree).slice(-90))

// ---- scenario 2: the host half is not answering -------------------------
const dead = buildClient(async () => new Response('not found', { status: 404 }))
check('policy/dead: component still registered', dead.registered.length === 2, String(dead.registered.length))
dead.setComponent(dead.registered[0])
tree = dead.render()
await new Promise((r) => setTimeout(r, 80))
tree = dead.render()
check('policy/dead: shows the restart hint', textOf(tree).includes('读取不到清理设置'), textOf(tree).slice(-200))
check('policy/dead: still renders the title', textOf(tree).includes('临时会话自动删除'))
check('policy/dead: no time input when unavailable', findAll(tree, (n) => n.type === 'input').length === 0)

// ---- scenario 3: the feedback entry --------------------------------------
// A bundle has no server to post to, so the entry point can only offer two
// channels: the clipboard, and a URL the desktop shell hands to the browser
// (app.asar lib/main.js attaches setWindowOpenHandler to the main window).
// Both are asserted here — what exactly gets copied, and what the pre-filled
// issue URL carries.
const RICH_ENV = {
  plugin: '0.2.3',
  dshClient: '0.2.2',
  platform: 'win32',
  arch: 'x64',
  os: '10.0.22631',
  node: '22.14.0',
  electron: '38.0.0',
}
const rich = buildClient(async (url) => {
  const text = String(url)
  if (text.includes('dsh-temp-session.config')) {
    return jsonResponse({ ok: true, deleteOnExit: true, scheduleDelete: true, scheduleTime: '03:00' })
  }
  if (text.includes('dsh-temp-session.status')) {
    return jsonResponse({
      ok: true,
      buttonStyle: 'pair',
      tempCount: 2,
      deleteOnExit: true,
      scheduleDelete: false,
      routes: { registered: 7, errors: [] },
      lastPurge: { reason: 'quit', at: '2026-11-10T09:00:00.000Z', tried: 2, removed: 2, hidden: 0, failed: [] },
      lastError: 'delete t1 failed: EBUSY',
      env: RICH_ENV,
    })
  }
  return new Response('not found', { status: 404 })
})
rich.setComponent(rich.registered[0])
let ftree = rich.render()
await new Promise((r) => setTimeout(r, 80))
ftree = rich.render()

check('feedback: block renders', textOf(ftree).includes('反馈'))
const area = findAll(ftree, (n) => n.type === 'textarea')[0]
check('feedback: textarea rendered', !!area)
check('feedback: textarea starts empty', !!area && area.props.value === '', area && String(area.props.value))

if (area) {
  area.props.onChange({ target: { value: '点「临时」后侧栏没有新会话' } })
  ftree = rich.render()
  check('feedback: draft saved to localStorage',
    rich.storage.get('dsh-sidebar-suite:feedback-draft') === '点「临时」后侧栏没有新会话',
    String(rich.storage.get('dsh-sidebar-suite:feedback-draft')))
}

const copyBtn = findAll(ftree, (n) => n.type === 'button' && n.props && Object.prototype.hasOwnProperty.call(n.props, 'data-dsbs-feedback-copy'))[0]
check('feedback: copy button rendered', !!copyBtn)
if (copyBtn) {
  copyBtn.props.onClick()
  await new Promise((r) => setTimeout(r, 100))
  const report = rich.copied[rich.copied.length - 1] || ''
  check('feedback: copy reached the clipboard', report.length > 0)
  check('feedback: copy carries the note', report.includes('点「临时」后侧栏没有新会话'), report.slice(0, 120))
  check('feedback: copy carries the plugin version', report.includes('plugin: 0.2.3'))
  check('feedback: copy carries the desktop version', report.includes('dsh desktop: 0.2.2'))
  check('feedback: copy carries the layout', report.includes('default layout: b'), report)
  check('feedback: copy carries the system', report.includes('win32 10.0.22631 x64'), report)
  check('feedback: copy carries the route count', report.includes('routes: 7'))
  check('feedback: copy carries the last error', report.includes('EBUSY'))
  check('feedback: copy carries the last cleanup', report.includes('last cleanup: quit'))
  ftree = rich.render()
  check('feedback: copy confirmation shown', textOf(ftree).includes('已复制'), textOf(ftree).slice(-180))
}

const issueBtn = findAll(ftree, (n) => n.type === 'button' && n.props && Object.prototype.hasOwnProperty.call(n.props, 'data-dsbs-feedback-issue'))[0]
check('feedback: issue button rendered', !!issueBtn)
if (issueBtn) {
  issueBtn.props.onClick()
  await new Promise((r) => setTimeout(r, 100))
  const openedUrl = rich.opened.length ? rich.opened[rich.opened.length - 1].url : ''
  check('feedback: issue opens the repo',
    openedUrl.startsWith('https://github.com/YONAN1269/dsh-sidebar-suite/issues/new?'),
    openedUrl.slice(0, 90))
  const decoded = openedUrl ? decodeURIComponent(openedUrl) : ''
  check('feedback: issue title is the first line', decoded.includes('点「临时」后侧栏没有新会话'), decoded.slice(0, 160))
  check('feedback: issue body is the report', decoded.includes('plugin: 0.2.3'))
  check('feedback: issue URL stays short enough', openedUrl.length < 7000, String(openedUrl.length))
}

// ---- 0.2.4: the feedback channel the plugin market actually defines -----
// dsh-market keys every plugin's thread on `plugin:<owner/repo>` inside the
// public catalog repository. Users who never visit GitHub Issues still have
// that entrance, and the detail page must name it and point at that exact term.
const marketBtn = findAll(rich.render(), (n) => n.type === 'button' && n.props && Object.prototype.hasOwnProperty.call(n.props, 'data-dsbs-feedback-market'))[0]
check('feedback: marketplace comments button rendered', !!marketBtn)
check('feedback: marketplace channel is named', textOf(rich.render()).includes('插件市场评论区'))
check('feedback: detail page says where the author receives it', textOf(rich.render()).includes('作者在哪收到'))
check('feedback: empty-thread guidance shown', textOf(rich.render()).includes('没有匹配的讨论'))
if (marketBtn) {
  const beforeMarket = rich.opened.length
  marketBtn.props.onClick()
  await new Promise((r) => setTimeout(r, 60))
  const marketUrl = rich.opened.length > beforeMarket ? rich.opened[rich.opened.length - 1].url : ''
  check('feedback: market button opens the catalog discussion',
    marketUrl.startsWith('https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/discussions?discussions_q='),
    marketUrl.slice(0, 120))
  check('feedback: market URL carries the plugin term',
    decodeURIComponent(marketUrl).includes('plugin:YONAN1269/dsh-sidebar-suite'),
    decodeURIComponent(marketUrl).slice(0, 160))
}

// A pasted log must not blow past what the OS accepts as a URL.
const longArea = findAll(rich.render(), (n) => n.type === 'textarea')[0]
longArea.props.onChange({ target: { value: '问'.repeat(4000) } })
const longBtn = findAll(rich.render(), (n) => n.type === 'button' && n.props && Object.prototype.hasOwnProperty.call(n.props, 'data-dsbs-feedback-issue'))[0]
longBtn.props.onClick()
await new Promise((r) => setTimeout(r, 120))
const longUrl = rich.opened[rich.opened.length - 1].url
check('feedback: long note still fits the URL limit', longUrl.length < 7000, String(longUrl.length))
check('feedback: truncation is marked', decodeURIComponent(longUrl).includes('(truncated)'))

// ---- scenario 4: a browser that refuses the clipboard --------------------
const broken = buildClient(async () => new Response('not found', { status: 404 }))
broken.breakCopy()
broken.setComponent(broken.registered[0])
let btree = broken.render()
await new Promise((r) => setTimeout(r, 80))
btree = broken.render()
const bcopy = findAll(btree, (n) => n.type === 'button' && n.props && Object.prototype.hasOwnProperty.call(n.props, 'data-dsbs-feedback-copy'))[0]
check('feedback/blocked: copy button still rendered', !!bcopy)
if (bcopy) {
  bcopy.props.onClick()
  await new Promise((r) => setTimeout(r, 120))
  btree = broken.render()
  check('feedback/blocked: the refusal is reported', textOf(btree).includes('复制被浏览器拒绝了'), textOf(btree).slice(-220))
}

// ---- the host payload the report is built from ---------------------------
const hostModule = await import(pathToFileURL(ROOT + '/lib/temp-session-host.mjs').href)
const hostStatus = hostModule.createTempSessionHost().status()
check('host: status exposes the plugin version', /^\d+\.\d+\.\d+/.test(hostStatus.env.plugin), hostStatus.env.plugin)
check('host: status exposes the platform', hostStatus.env.platform === process.platform)
check('host: status exposes the node version', hostStatus.env.node === process.versions.node)
check('host: status exposes the route count', typeof hostStatus.routes.registered === 'number')

// ---- 0.2.8: every remaining config key has a working control ------------
let uiConfig = {
  ok: true,
  showButton: true, inChatMode: 'hide', buttonStyle: 'pair',
  expandAllSessions: true, deleteOnExit: true, scheduleDelete: false,
  scheduleTime: '03:00', maxKept: 20, configRevision: 4,
  configFile: 'temp-session-config.txt',
}
const uiPosts = []
const ui = buildClient(async (url, init) => {
  const text = String(url)
  const method = (init && init.method) || 'GET'
  if (text.includes('dsh-temp-session.config')) {
    if (method === 'POST') {
      const patch = JSON.parse(init.body || '{}')
      uiPosts.push(patch)
      uiConfig = Object.assign({}, uiConfig, patch, { configRevision: uiConfig.configRevision + 1 })
      return jsonResponse(uiConfig)
    }
    return jsonResponse(uiConfig)
  }
  if (text.includes('dsh-temp-session.purge')) return jsonResponse({ ok: true, removed: 2 })
  if (text.includes('dsh-temp-session.status')) return jsonResponse({ ok: true, showButton: true })
  if (text.includes('dsh-temp-session.list')) return jsonResponse({ ok: true, ids: [], count: 0 })
  return new Response('not found', { status: 404 })
})
ui.setComponent(ui.registered[0])
let utree = ui.render()
await new Promise((r) => setTimeout(r, 80))
utree = ui.render()
const uitext = textOf(utree)

check('0.2.8: options card renders',
  findAll(utree, (n) => n.props && Object.prototype.hasOwnProperty.call(n.props, 'data-dsbs-options')).length === 1)
check('0.2.8: every option label is visible',
  ['侧栏与临时会话', '显示「临时」按钮', 'CHAT 官网模式', '按钮摆法',
    '会话默认全展开', '最多保留', '立即清理临时会话'].every((s) => uitext.includes(s)),
  uitext.slice(0, 260))
check('0.2.8: revision and file are shown',
  uitext.includes('设置版本 / Settings rev') && uitext.includes('temp-session-config.txt'))
check('0.2.8: hot-reload help is shown', uitext.includes('Notepad') && uitext.includes('no restart'))

const ownBtn = findAll(utree, (n) => n.type === 'button' && textOf(n) === '独占一行 / Own row')[0]
check('0.2.8: own-row pill renders', !!ownBtn)
if (ownBtn) {
  ownBtn.props.onClick()
  await new Promise((r) => setTimeout(r, 60))
  check('0.2.8: pill posts buttonStyle=own', uiPosts.some((p) => p.buttonStyle === 'own'), JSON.stringify(uiPosts))
}

const keptInput = findAll(utree, (n) => n.type === 'input' && n.props && n.props.type === 'number')[0]
check('0.2.8: maxKept number input renders', !!keptInput)
if (keptInput) {
  keptInput.props.onChange({ target: { value: '42' } })
  await new Promise((r) => setTimeout(r, 60))
  check('0.2.8: number input posts maxKept=42', uiPosts.some((p) => p.maxKept === 42), JSON.stringify(uiPosts))
}

const purgeBtn = findAll(utree, (n) => n.type === 'button' && textOf(n).includes('立即清理临时会话'))[0]
check('0.2.8: manual cleanup button renders', !!purgeBtn)
if (purgeBtn) {
  purgeBtn.props.onClick()
  await new Promise((r) => setTimeout(r, 80))
  check('0.2.8: cleanup calls the purge route', ui.requests.some((r) => r.url.includes('dsh-temp-session.purge')))
  check('0.2.8: cleanup result is shown', textOf(ui.render()).includes('已清理 / Removed 2'))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
