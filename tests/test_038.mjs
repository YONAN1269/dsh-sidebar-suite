// 0.6.0 — the Temp button moved from DOM surgery to the host's own seat.
//
// DSH 0.2.2-rc.3 declares `sidebar.session.action`: a hoc layer the sidebar
// renders *inside* its New-session row, right after the host's button, and the
// row became a flex container. Mounting into that seat is what removes the
// `calc(100% - 92px)` / `-44px` pair, and what makes TEMP_BUTTON_STYLE=own work
// again (the row wraps instead of fighting a block flow).
//
// Two halves. The first half pins the shapes that must not drift back (which
// element we look for, which CSS is allowed to touch the host button, how the
// `own` flag is written). The second half mounts the bundle against rc.3
// markup — row > button + slot outlet > seat — and checks that the button really
// lands inside the seat while the host row is left byte-identical.
//
// tests/test_020 mounts against <= rc.2 markup (no seat) and still covers the
// fallback path end to end; `npm run smoke` exercises the real host.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const SRC = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

const fail = []
const check = (name, ok, extra) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)))
  if (!ok) fail.push(name)
}

// ---- the seat is registered and declared the way a hoc entry requires -----
check('seat: sidebar.session.action is registered', SRC.includes("name: 'sidebar.session.action'"))
check('seat: registered with an id (hoc entries throw without one)',
  /name: 'sidebar\.session\.action',\s*\n\s*id: '[^']+'/.test(SRC))
check('seat: registration waits for the slot to be declared',
  SRC.includes("slots.inject('sidebar.session.action'"))
check('seat: the occupant returns the host content plus one empty div',
  SRC.includes("'data-dsbs-temp-anchor': ''") && SRC.includes('props ? props.children : null'))
check('seat: wide=false is read as the collapsed rail', SRC.includes('tempSlotWide = wide'))

// ---- placement prefers the seat, and still falls back -------------------
check('place: looks for the seat first', SRC.includes("document.querySelector('[data-dsbs-temp-anchor]')"))
check('place: slot mode appends the button into the seat',
  /if \(mode === 'slot'\)[\s\S]{0,220}tempSlot\.appendChild\(tempButton\)/.test(SRC))
check('place: the legacy sibling path survives for older hosts',
  SRC.includes("host.insertBefore(tempSlot, native.nextSibling)"))
check('place: mounting mode is published on <html>',
  SRC.includes("html.setAttribute('data-dsbs-temp-mode', mode)"))

// ---- the layout hacks are confined to the legacy mode -------------------
// Every `calc(100% - 92px)` and every `-44px` must sit behind
// html[data-dsbs-temp-mode="dom"], or they would squeeze the host's button in
// the rc.3 flex row where it already sizes itself.
const cssLines = SRC.split('\n').filter((line) => line.includes('!important}') || line.includes('z-index:2}'))
const hacks = cssLines.filter((line) => line.includes('calc(100% - 92px)') || line.includes('margin:-44px'))
check('css: the shrinking rules exist', hacks.length >= 1, hacks.length)
check('css: every shrink/negative-margin rule is dom-mode scoped',
  hacks.every((line) => line.includes('data-dsbs-temp-mode="dom"')),
  hacks.filter((line) => !line.includes('data-dsbs-temp-mode="dom"')).length)

check('css: slot mode sizes the seat, not the host button',
  SRC.includes('html[data-dsbs-temp-mode="slot"] [data-dsbs-temp-slot]{display:flex;flex:0 0 auto'))
check('css: own mode lets the host row wrap',
  SRC.includes('html[data-dsbs-temp-mode="slot"][data-dsbs-temp-style="own"] [data-dsbs-newchat]{flex-wrap:wrap}'))
check('css: own mode gives the seat the whole second line',
  SRC.includes('html[data-dsbs-temp-mode="slot"][data-dsbs-temp-style="own"] [data-dsbs-temp-slot]{flex:0 0 100%'))

// ---- the setting flag carries the value the CSS reads --------------------
// 0.5.x wrote a boolean ("true"), so `[data-dsbs-temp-style="own"]` never
// matched and TEMP_BUTTON_STYLE=own silently did nothing.
check('style: own is written as the literal the CSS matches',
  SRC.includes("html.setAttribute('data-dsbs-temp-style', 'own')"))
check('style: the boolean write is gone',
  !SRC.includes("setFlag(html, 'data-dsbs-temp-style'"))

// ---- the on/off switch survives a React re-render -----------------------
check('css: hidden seat is driven by an <html> flag too',
  SRC.includes("html[data-dsbs-temp-off=\"true\"] [data-dsbs-temp-slot]{display:none!important}"))
check('lifecycle: the seat registration is disposed with the plugin',
  SRC.includes('tempSeatDisposer'))

// ---------------------------------------------------------------------------
// Behaviour: mount the bundle against rc.3 markup and watch where it puts the
// button. This is the part that used to require the real client — the seat is
// just an element with an attribute, so the shared DOM stub can render it.
// ---------------------------------------------------------------------------

const settle = () => new Promise((r) => setTimeout(r, 0))

function mountRc3() {
  const tree = buildSidebar()
  const doc = tree.doc
  const row = doc.createElement('div')
  row.setAttribute('class', 'wtg9ga_newSessionRow')
  const hostButton = doc.createElement('button')
  hostButton.setAttribute('class', 'wtg9ga_newSession')
  hostButton.setAttribute('type', 'button')
  const outlet = doc.createElement('div')
  outlet.setAttribute('data-slot', 'sidebar.session.action')
  const seat = doc.createElement('div')
  seat.setAttribute('data-dsbs-temp-anchor', '')
  seat.setAttribute('data-dsbs-temp-slot', '')
  row.appendChild(hostButton)
  row.appendChild(outlet)
  outlet.appendChild(seat)
  tree.root.appendChild(row)

  const storage = new Map()
  class MutationObserverStub {
    constructor(cb) { this.cb = cb }
    observe() {}
    disconnect() {}
    takeRecords() { return [] }
  }
  class ResizeObserverStub {
    constructor(cb) { this.cb = cb }
    observe() {}
    disconnect() {}
  }

  const host = {
    __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
    getComputedStyle: () => ({ position: 'static', display: 'block' }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
    open() { return null },
  }
  // The bundle reaches React through this hook; the seat component is only ever
  // *called* by us here, so a recording createElement is enough.
  const effects = []
  const ReactStub = {
    createElement(type, props) {
      return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
    },
    useState: (value) => [value, () => {}],
    useEffect(fn) { effects.push(fn) },
    Fragment: 'Fragment',
  }
  const sandbox = {
    window: host,
    document: doc,
    navigator: { language: 'zh-CN', clipboard: { writeText: () => Promise.resolve() } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    fetch: async () => new Response('{}', { status: 404 }),
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub,
    ResizeObserver: ResizeObserverStub,
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
    requestAnimationFrame: (cb) => sbTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console,
    require(name) { return name === 'react' ? ReactStub : null },
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox, { filename: 'client.js' })

  const mod = sandbox.__entry.factory(() => ReactStub)
  const registered = []
  const slots = {
    inject(name, cb) { if (typeof cb === 'function') cb() },
    register(spec, component) { registered.push({ spec, component }); return () => {} },
  }
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe() { return () => {} }, register() { return () => {} } },
    effect(fn) { return fn() },
    get() { return undefined },
    inject(deps, cb) { if (typeof cb === 'function') cb({ slots, configForms: undefined }) },
    provide() {},
  }
  mod.apply(ctx)
  return { tree, doc, row, hostButton, outlet, seat, registered, effects }
}

const live = mountRc3()
await settle()
await new Promise((r) => setTimeout(r, 20))

const tempBtn = live.doc.querySelector('[data-dsbs-btn="temp"]')
check('mount: the Temp button exists', !!tempBtn)
check('mount: it is mounted inside the host seat, not beside it',
  !!tempBtn && tempBtn.parentElement === live.seat)
check('mount: the seat is still the only one we render',
  (live.doc.querySelectorAll('[data-dsbs-temp-slot]') || []).length === 1)
check('mount: the host button is left alone (no sibling wrapper injected)',
  live.row.children.length === 2 && live.row.children[0] === live.hostButton && live.row.children[1] === live.outlet,
  live.row.children.map((c) => c.tagName + ':' + (c.getAttribute('class') || '')).join('|'))
const htmlEl = live.doc.documentElement
check('mount: the mounting mode is published for the CSS',
  htmlEl.getAttribute('data-dsbs-temp-mode') === 'slot',
  htmlEl.getAttribute('data-dsbs-temp-mode'))
check('mount: the New-session row is tagged so own-mode can wrap it',
  live.row.hasAttribute('data-dsbs-newchat'))

const seatEntry = live.registered.find((r) => r.spec && r.spec.name === 'sidebar.session.action')
check('mount: the seat occupant is registered on the host slot', !!seatEntry)
if (seatEntry) {
  const rendered = seatEntry.component({ wide: true, children: 'HOST-BUTTON' })
  const kids = (rendered && rendered.children) || []
  check('seat: host content is passed through untouched', kids[0] === 'HOST-BUTTON', String(kids[0]))
  const anchor = kids[1]
  check('seat: it renders exactly one empty anchor after the host content',
    !!anchor && anchor.props && anchor.props['data-dsbs-temp-anchor'] === '' && (anchor.children || []).length === 0)
  seatEntry.component({ wide: false, children: 'HOST-BUTTON' })
  // The occupant re-places on its next effect pass; run the recorded effects.
  for (const fn of live.effects.splice(0)) fn()
  await settle()
  await new Promise((r) => setTimeout(r, 20))
  check('seat: wide=false hides the Temp button in the collapsed rail',
    htmlEl.getAttribute('data-dsbs-temp-solo') === 'true',
    htmlEl.getAttribute('data-dsbs-temp-solo'))
}

console.log('')
if (fail.length) {
  console.error(fail.length + ' failed: ' + fail.join(' | '))
  process.exit(1)
}
console.log('all seat checks passed')
