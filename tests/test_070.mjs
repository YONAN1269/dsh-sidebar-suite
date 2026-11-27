// dsh-sidebar-suite 1.1.5 — favorites archive bridge, escaping, queue merge,
// empty state (R-13, CE-07, CE-08, CE-11, UI-09, UI-01).
//
// Drives the real client bundle in a VM on the shared DOM stub. The archive
// registry is a hand-built stub whose answer shapes match the verified
// archive-manager contract plus the older wrapped shapes the bundle used to
// assume.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const SRC = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')
const FAV_KEY = 'dsh-sidebar-suite:favorites.v1'

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function addSessionRow(doc, tree, session) {
  const row = doc.createElement('div')
  row.setAttribute('data-row-key', 'session:' + session.id)
  row.className = 'sessionRow'
  const title = doc.createElement('span')
  title.className = 'MarqueeText_title__test'
  title.textContent = session.title
  row.appendChild(title)
  tree.workspaces.appendChild(row)
  return row
}

function mount(options = {}) {
  const opts = options || {}
  const tree = buildSidebar({ gridHost: true })
  const doc = tree.doc
  const storage = new Map()
  const warnings = []
  if (opts.favorites !== undefined) storage.set(FAV_KEY, JSON.stringify(opts.favorites))

  const sessions = opts.sessions || []
  const registrations = []
  const menuRegistrations = []
  const effects = []

  for (const session of sessions) addSessionRow(doc, tree, session)

  const seenById = {}
  const ids = []
  for (const session of sessions) {
    ids.push(session.id)
    seenById[session.id] = {
      id: session.id,
      displayTitle: session.title,
      updatedAt: session.updatedAt || 0,
    }
  }
  const ui = {
    openSession() {},
    workspaces: { list: { getSnapshot: () => ({ items: [], archivedSessionIds: [] }) } },
    sessions: { list: { getSnapshot: () => ({ ids, byId: seenById }) } },
    mainReference: { sessionId: opts.currentSession || '' },
  }
  const menus = {
    active: { getSnapshot: () => null },
    register(contribution) { menuRegistrations.push(contribution); return () => {} },
    open() {},
  }
  const slots = {
    inject(name, callback) { if (typeof callback === 'function') callback() },
    register(spec, component) { registrations.push({ spec, component }); return () => {} },
    entriesOfSlot() { return [] },
    subscribe() { return () => {} },
  }

  class MutationObserverStub { observe() {} disconnect() {} takeRecords() { return [] } }
  class ResizeObserverStub { observe() {} disconnect() {} }

  const ReactStub = {
    createElement(type, props) {
      return { type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
    },
    useState(initial) { return [initial, () => {}] },
    useEffect(fn) { effects.push(fn) },
    Fragment: 'Fragment',
  }

  const sandbox = {
    window: {
      __ModuleLoader__: { load(entry) { sandbox.__entry = entry } },
      getComputedStyle: () => ({ position: 'static', display: 'block' }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
      open() { return null },
      innerWidth: 1280, innerHeight: 800,
    },
    document: doc,
    navigator: { language: 'zh-CN' },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub,
    ResizeObserver: ResizeObserverStub,
    setTimeout: sbTimeout, clearTimeout, setInterval: sbInterval, clearInterval,
    requestAnimationFrame: (cb) => sbTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console: { log() {}, info() {}, debug() {}, warn: (...a) => warnings.push(a.map(String).join(' ')), error() {} },
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox, { filename: 'client.js' })

  const mod = sandbox.__entry.factory(() => ReactStub)
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'zh-CN' }), subscribe() { return () => {} }, register() { return () => {} } },
    effect(fn) { const cleanup = fn(); effects.push(cleanup); return cleanup },
    get(name) {
      if (name === 'uiWorkspace') return ui
      if (name === 'remote.workspaceRegistry') return opts.archive || undefined
      return undefined
    },
    inject(deps, callback) {
      if (typeof callback !== 'function') return
      const scope = {}
      if (Array.isArray(deps) && deps.indexOf('slots') >= 0) scope.slots = slots
      if (Array.isArray(deps) && deps.indexOf('contextMenus') >= 0) scope.contextMenus = menus
      callback(scope)
    },
  }
  mod.apply(ctx)

  return {
    doc, tree, storage, warnings, registrations,
    componentFor(name) {
      const entry = registrations.find((r) => r.spec && r.spec.name === name)
      return entry ? entry.component : null
    },
    styleText(id) {
      const style = doc.getElementById(id)
      return style ? String(style.textContent || '') : ''
    },
  }
}

function clickEvent() {
  return { stopPropagation() {}, preventDefault() {} }
}

async function main() {
  // ---- R-13: archive bridge answer shapes ------------------------------
  {
    // Verified archive-manager shape: favoriteSessions() resolves the bare
    // state object { favoriteSessionIds: string[] } (workspace.js:522).
    const archive = {
      favoriteSessions: async () => ({ favoriteSessionIds: ['s1'] }),
      setSessionFavorite: async () => ({ favoriteSessionIds: ['s1'] }),
    }
    const h = mount({ archive, sessions: [{ id: 's1', title: 'Bare shape', updatedAt: 1000 }] })
    await settle()
    const row = h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s1"]')
    check('B1: bare { favoriteSessionIds } bridge answer renders the row', !!row)
  }

  {
    // Older wrapped shape A: { ok: true, value: { favoriteSessionIds: [] } }.
    const archive = {
      favoriteSessions: async () => ({ ok: true, value: { favoriteSessionIds: ['s1'] } }),
      setSessionFavorite: async () => ({ ok: true, value: { favoriteSessionIds: ['s1'] } }),
    }
    const h = mount({ archive, sessions: [{ id: 's1', title: 'Wrapped object', updatedAt: 1000 }] })
    await settle()
    const row = h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s1"]')
    check('B2: wrapped { ok, value: { favoriteSessionIds } } answer renders', !!row)
  }

  {
    // Older wrapped shape B: { ok: true, value: [] }.
    const archive = {
      favoriteSessions: async () => ({ ok: true, value: ['s1'] }),
      setSessionFavorite: async () => ({ ok: true, value: ['s1'] }),
    }
    const h = mount({ archive, sessions: [{ id: 's1', title: 'Wrapped array', updatedAt: 1000 }] })
    await settle()
    const row = h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s1"]')
    check('B3: wrapped { ok, value: [] } answer renders', !!row)
  }

  {
    // Unrecognized shape: must not throw, must keep the local list, and must
    // leave a prefixed console.warn instead of failing silently.
    const archive = {
      favoriteSessions: async () => ({ ok: true, value: 'garbage' }),
      setSessionFavorite: async () => ({ ok: true, value: 'garbage' }),
    }
    const h = mount({
      favorites: ['s1'],
      archive,
      sessions: [{ id: 's1', title: 'Local kept', updatedAt: 1000 }],
    })
    await settle()
    const local = JSON.parse(h.storage.get(FAV_KEY))
    check('B4: unrecognized shape keeps the local favorites', Array.isArray(local) && local.includes('s1'), JSON.stringify(local))
    check('B4b: an unrecognized answer logs a prefixed warning',
      h.warnings.some((w) => w.indexOf('[dsh-sidebar-suite]') === 0), h.warnings.join(' | '))
  }

  {
    // A non-object answer (string) degrades to the local list, no throw.
    const archive = {
      favoriteSessions: async () => 'plain-string',
      setSessionFavorite: async () => 'plain-string',
    }
    const h = mount({
      favorites: ['s1'],
      archive,
      sessions: [{ id: 's1', title: 'String answer', updatedAt: 1000 }],
    })
    await settle()
    const local = JSON.parse(h.storage.get(FAV_KEY))
    check('B5: a non-object answer degrades without throwing', Array.isArray(local) && local.includes('s1'))
    check('B5b: the string answer logs a prefixed warning',
      h.warnings.some((w) => w.indexOf('[dsh-sidebar-suite]') === 0), h.warnings.join(' | '))
  }

  // ---- CE-07: control-character escape in generated selectors ----------
  {
    const weird = 'a\fb\0c'
    const h = mount({ favorites: [weird], sessions: [{ id: weird, title: 'Escape me', updatedAt: 1000 }] })
    await settle()
    const style = h.styleText('dsh-sidebar-suite-favorites-style')
    check('CE07: form feed is escaped in the generated selector', style.indexOf('\\f ') >= 0, style)
    check('CE07b: NUL is escaped in the generated selector', style.indexOf('\\0 ') >= 0, style)
  }

  // ---- CE-08: same-id queued toggle merges instead of stacking ----------
  {
    const calls = []
    let resolveWrite = null
    const archive = {
      favoriteSessions: async () => ({ favoriteSessionIds: [] }),
      setSessionFavorite(input) {
        calls.push(input)
        return new Promise((resolve) => { resolveWrite = { input, resolve } })
      },
    }
    const h = mount({ archive, sessions: [{ id: 's1', title: 'Queue target', updatedAt: 1000 }] })
    await settle()
    const component = h.componentFor('sidebar.workspaces.session.row.action')
    // Add, then remove, while the first write is in flight. The second toggle
    // on the same id must merge into the one queued intent instead of stacking
    // a duplicate, so the drained queue produces a single follow-up write.
    component({ sessionId: 's1' }).props.onClick(clickEvent())
    await settle()
    component({ sessionId: 's1' }).props.onClick(clickEvent())
    await settle()
    check('CE08: only the first write leaves while one toggle is in flight', calls.length === 1, JSON.stringify(calls))
    check('CE08b: the first write asks for the add', calls.length === 1 && calls[0].favorite === true, JSON.stringify(calls))

    resolveWrite.resolve({ favoriteSessionIds: [] })
    await settle()
    await settle()
    check('CE08c: the drained queue produces exactly one follow-up write', calls.length === 2, JSON.stringify(calls))
    check('CE08d: the merged follow-up keeps the latest intent (remove)',
      calls.length === 2 && calls[1].favorite === false, JSON.stringify(calls[1]))
  }

  // ---- UI-09: empty favorites keep one weakened empty line ---------------
  {
    const h = mount({ favorites: [], sessions: [] })
    await settle()
    const group = h.doc.querySelector('[data-dsbs-favorites]')
    check('UI09: the empty favorites group stays visible', !!group && !group.hasAttribute('hidden'))
    const empty = h.doc.querySelector('[data-dsbs-fav-list] [data-dsbs-fav-empty]')
    check('UI09b: one weakened empty line is painted', !!empty && empty.textContent === '暂无收藏。', empty && empty.textContent)
  }

  // ---- UI-01: header star x aligns with the row star; chevron clear of it -
  //
  // Layout math (offsets relative to the inner left edge of each row/head box;
  // the two outer boxes share the same favorites-group indent, so equal inner
  // offsets mean equal absolute x):
  //   row star  = first flow child, offset = row padding-left          = 8px
  //   head mark = first flow child (order:1), offset = head padding-left = 8px
  // Both land on x = 12 (box edge) + 8 = 20px; the mark box is 20 -> 38px.
  // The left padding band is only 8px wide (box edge 12 -> content edge 20),
  // which cannot hold a 16x16 chevron hit box, so the chevron stays in the
  // flex flow and is ordered to the right (order:4) next to the count badge
  // (order:3). The mark stays first; label (order:2) fills the middle, so the
  // chevron never overlaps the mark horizontally.
  {
    const h = mount({ favorites: [], sessions: [] })
    await settle()
    const style = h.styleText('dsh-sidebar-suite-style')
    const lines = style.split('\n')
    const headRule = lines.find((r) => r.indexOf('[data-dsbs-fav-head]{') >= 0) || ''
    const chevronRule = lines.find((r) => r.indexOf('[data-dsbs-fav-chevron]') >= 0) || ''
    const markRule = lines.find((r) => r.indexOf('[data-dsbs-fav-mark]') >= 0) || ''
    const labelRule = lines.find((r) => r.indexOf('[data-dsbs-fav-label]') >= 0) || ''
    const countRule = lines.find((r) => r.indexOf('[data-dsbs-fav-count]') >= 0) || ''
    const rowRule = lines.find((r) => r.indexOf('[data-dsbs-fav-row]{') >= 0) || ''
    const rowStarRule = lines.find((r) => r.indexOf('[data-dsbs-fav-star]') >= 0) || ''

    function paddingLeft(rule) {
      const m = /padding:\s*0\s+(\d+)px/.exec(rule)
      return m ? Number(m[1]) : null
    }
    function hitBox(rule) {
      const w = /width:\s*(\d+)px/.exec(rule)
      const hgt = /height:\s*(\d+)px/.exec(rule)
      return { w: w ? Number(w[1]) : null, h: hgt ? Number(hgt[1]) : null }
    }
    function order(rule) {
      const m = /order:\s*(\d+)/.exec(rule)
      return m ? Number(m[1]) : null
    }

    const headPL = paddingLeft(headRule)
    const rowPL = paddingLeft(rowRule)
    const chevron = hitBox(chevronRule)
    const mark = hitBox(markRule)
    const rowStar = hitBox(rowStarRule)
    const markOrder = order(markRule)
    const labelOrder = order(labelRule)
    const countOrder = order(countRule)
    const chevronOrder = order(chevronRule)

    check('UI01: head and row share the same 8px left padding',
      headPL === 8 && rowPL === 8, JSON.stringify({ headPL, rowPL }))
    check('UI01: the mark keeps the 8px offset -> x=20, aligned with the row star',
      headPL === 8 && rowPL === 8 && mark.w === 18 && rowStar.w === 18,
      JSON.stringify({ headPL, rowPL, mark, rowStar }))
    check('UI01: the chevron is in flow (not absolutely positioned)',
      chevronRule.indexOf('position:absolute') < 0 && headRule.indexOf('position:relative') < 0,
      chevronRule)
    check('UI01: the chevron hit box is at least 16x16',
      chevron.w >= 16 && chevron.h >= 16, JSON.stringify(chevron))
    check('UI01: head mark and row star keep the 18x20 box',
      mark.h === 20 && rowStar.h === 20, JSON.stringify({ mark, rowStar }))
    // Non-overlap: mark is order:1 (leftmost), chevron is order:4 (rightmost,
    // after count order:3), with the label order:2 between them. The chevron's
    // left edge sits after the label's elastic region, so its right edge is
    // always to the right of the mark's right edge rather than overlapping it.
    check('UI01: chevron sits after the mark in flow order (no left-band overlap)',
      markOrder === 1 && labelOrder === 2 && countOrder === 3 && chevronOrder === 4,
      JSON.stringify({ markOrder, labelOrder, countOrder, chevronOrder }))
    check('UI01: left band 8px is narrower than the 16px chevron hit box',
      headPL < chevron.w, JSON.stringify({ headPL, chevronW: chevron.w }))
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
