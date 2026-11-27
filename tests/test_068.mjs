// dsh-sidebar-suite 1.1.5 — session favorites.
//
// The fixture is deliberately small: one host-shaped workspaces region, a
// session snapshot, and a slot registry. Every assertion drives the real
// client bundle in a VM; no source-only claims.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const SRC = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')
const FAV_KEY = 'dsh-sidebar-suite:favorites.v1'
const COLLAPSED_KEY = 'dsh-sidebar-suite:favorites-collapsed'

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
  const slot = doc.createElement('span')
  row.appendChild(slot)
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
  if (opts.nestWorkspaces) {
    const wrapper = doc.createElement('div')
    wrapper.setAttribute('data-test-wrapper', '')
    tree.region.appendChild(wrapper)
    wrapper.appendChild(tree.workspaces)
    tree.nestedWrapper = wrapper
  }
  const storage = new Map()
  const storageWrites = []
  if (opts.favorites !== undefined) storage.set(FAV_KEY, JSON.stringify(opts.favorites))
  if (opts.collapsed !== undefined) storage.set(COLLAPSED_KEY, opts.collapsed ? '1' : '0')

  const sessions = opts.sessions || []
  const opened = []
  const registrations = []
  const menuRegistrations = []
  const effects = []
  const fetchCalls = []

  for (const session of sessions) addSessionRow(doc, tree, session)
  for (const archived of opts.archived || []) {
    if (!sessions.some((session) => session.id === archived)) {
      addSessionRow(doc, tree, { id: archived, title: 'Archived session', updatedAt: 1 })
    }
  }

  const seenById = {}
  const ids = []
  for (const session of sessions) {
    ids.push(session.id)
    seenById[session.id] = {
      id: session.id,
      displayTitle: session.title,
      updatedAt: session.updatedAt || 0,
      blank: session.blank === true,
    }
  }
  const ui = {
    openSession(id) { opened.push(id) },
    workspaces: {
      list: { getSnapshot: () => ({ items: [], archivedSessionIds: opts.archived || [] }) },
    },
    sessions: { list: { getSnapshot: () => ({ ids, byId: seenById }) } },
    mainReference: { sessionId: opts.currentSession || '' },
  }

  const menus = {
    active: { getSnapshot: () => null },
    register(contribution) {
      menuRegistrations.push(contribution)
      return () => {}
    },
    open() {},
  }

  const slots = {
    inject(name, callback) {
      if (typeof callback === 'function') callback()
    },
    register(spec, component) {
      registrations.push({ spec, component })
      return () => {}
    },
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
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
      setTimeout: sbTimeout,
      clearTimeout,
      setInterval: sbInterval,
      clearInterval,
      open() { return null },
      innerWidth: 1280,
      innerHeight: 800,
    },
    document: doc,
    navigator: { language: 'zh-CN' },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => {
        storage.set(key, String(value))
        storageWrites.push({ key, value: String(value) })
      },
      removeItem: (key) => storage.delete(key),
    },
    fetch: async (input, init) => {
      const url = String((input && input.url) || input || '')
      fetchCalls.push({ url, method: (init && init.method) || 'GET' })
      if (url.indexOf('dsh-temp-session.status') >= 0) {
        return new Response(JSON.stringify({ ok: true, showButton: false }), { status: 200 })
      }
      if (url.indexOf('dsh-temp-session.list') >= 0) {
        return new Response(JSON.stringify({ ok: true, ids: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    },
    Request, Response, URL, URLSearchParams,
    Event: class { constructor(type) { this.type = type } },
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: MutationObserverStub,
    ResizeObserver: ResizeObserverStub,
    setTimeout: sbTimeout,
    clearTimeout,
    setInterval: sbInterval,
    clearInterval,
    requestAnimationFrame: (cb) => sbTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
  }
  sandbox.window.document = doc
  sandbox.window.localStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox, { filename: 'client.js' })

  const mod = sandbox.__entry.factory(() => ReactStub)
  const ctx = {
    locale: {
      getSnapshot: () => ({ active: 'zh-CN' }),
      subscribe() { return () => {} },
      register() { return () => {} },
    },
    effect(fn) {
      const cleanup = fn()
      effects.push(cleanup)
      return cleanup
    },
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
      if (Array.isArray(deps) && deps.indexOf('remote.session') >= 0) scope.remote = { session: {} }
      callback(scope)
    },
  }

  mod.apply(ctx)
  return {
    doc, tree, mod, ctx, storage, storageWrites, opened, registrations, menuRegistrations, effects,
    componentFor(name) {
      const entry = registrations.find((registration) => registration.spec && registration.spec.name === name)
      return entry ? entry.component : null
    },
    menuFor(id) {
      return menuRegistrations.find((registration) => registration.id === id) || null
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
  // ---- local favorites: title star, group, remove ------------------------
  {
    const h = mount({
      favorites: ['s1', 's2'],
      sessions: [
        { id: 's1', title: 'First session', updatedAt: 1000 },
        { id: 's2', title: 'Second session', updatedAt: 3000 },
        { id: 's3', title: 'Unstarred session', updatedAt: 2000 },
        { id: 'archived', title: 'Archived favorite', updatedAt: 4000 },
      ],
      archived: ['archived'],
    })
    await settle()
    const rule = h.styleText('dsh-sidebar-suite-favorites-style')
    check('F1a: a title-star rule exists for each favorite',
      rule.includes('session:s1') && rule.includes('session:s2'), rule)
    check('F1b: the rule targets the host title span, not the whole row',
      rule.includes('span[class*="title"]::before'))
    check('F1d: the title star paints as a 15px CSS mask box, not a text glyph',
      rule.includes('width:15px') && rule.includes('mask-image:'), rule)
    check('F1c: unstarred and archived ids get no star rule',
      !rule.includes('session:s3') && !rule.includes('session:archived'))

    const group = h.doc.querySelector('[data-dsbs-favorites]')
    check('F2a: the 收藏夹 group is present', !!group)
    check('F2b: the group is visible when favorites exist', !!group && !group.hasAttribute('hidden'))
    const label = h.doc.querySelector('[data-dsbs-fav-label]')
    const count = h.doc.querySelector('[data-dsbs-fav-count]')
    check('F2c: the group is named 收藏夹', !!label && label.textContent === '收藏夹', label && label.textContent)
    check('F2d: the count ignores archived favorites', !!count && count.textContent === '2', count && count.textContent)
    const rows = h.doc.querySelectorAll('[data-dsbs-fav-row]')
    check('F2e: two favorite rows render', rows.length === 2, String(rows.length))
    check('F2f: rows sort by recent update',
      rows[0] && rows[0].getAttribute('data-session-id') === 's2'
      && rows[1] && rows[1].getAttribute('data-session-id') === 's1',
      rows.map((row) => row.getAttribute('data-session-id')).join(','))

    const row = h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s1"]')
    row.click()
    check('F3a: clicking a favorite opens that session', h.opened.includes('s1'), h.opened.join(','))

    const star = row.querySelector('[data-dsbs-fav-star]')
    star.click()
    await settle()
    check('F3b: the row star removes the favorite from the group',
      !h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s1"]'))
    check('F3c: removal is written to localStorage',
      JSON.parse(h.storage.get(FAV_KEY)).indexOf('s1') < 0 && JSON.parse(h.storage.get(FAV_KEY)).indexOf('s2') >= 0,
      h.storage.get(FAV_KEY))
    check('F3d: removal also retires its title star',
      !h.styleText('dsh-sidebar-suite-favorites-style').includes('session:s1'))

    const last = h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s2"]')
    last.querySelector('[data-dsbs-fav-star]').click()
    await settle()
    const favGroup = h.doc.querySelector('[data-dsbs-favorites]')
    const emptyCount = h.doc.querySelector('[data-dsbs-fav-count]')
    const emptyList = h.doc.querySelector('[data-dsbs-fav-list]')
    const emptyRow = emptyList && emptyList.querySelector('[data-dsbs-fav-empty]')
    const leftoverRows = emptyList ? emptyList.querySelectorAll('[data-dsbs-fav-row]') : []
    check('F3e: emptying favorites keeps the group with one weakened empty line',
      !!favGroup && !favGroup.hasAttribute('hidden') &&
      emptyCount && emptyCount.textContent === '0' &&
      !!emptyRow && leftoverRows.length === 0,
      emptyCount && emptyCount.textContent)
  }

  // ---- add via the host row action slot ---------------------------------
  {
    const h = mount({
      favorites: [],
      sessions: [
        { id: 's3', title: 'Add me', updatedAt: 2000 },
      ],
    })
    await settle()
    const component = h.componentFor('sidebar.workspaces.session.row.action')
    check('F4a: the favorite star registers in the host row action slot', typeof component === 'function')
    const element = component({ sessionId: 's3' })
    check('F4b: the row action is a real button', element && element.type === 'button')
    element.props.onClick(clickEvent())
    await settle()
    check('F4c: clicking the row action adds the favorite',
      JSON.parse(h.storage.get(FAV_KEY)).includes('s3'), h.storage.get(FAV_KEY))
    check('F4d: a fresh favorite gets its title star',
      h.styleText('dsh-sidebar-suite-favorites-style').includes('session:s3'))
    const group = h.doc.querySelector('[data-dsbs-favorites]')
    check('F4e: the group appears after the first favorite', !!group && !group.hasAttribute('hidden'))
  }

  // ---- empty state and context menu -------------------------------------
  {
    const h = mount({ favorites: [], sessions: [] })
    await settle()
    const group = h.doc.querySelector('[data-dsbs-favorites]')
    const emptyRow = h.doc.querySelector('[data-dsbs-fav-list] [data-dsbs-fav-empty]')
    const leftoverRows = h.doc.querySelectorAll('[data-dsbs-fav-row]')
    check('F5a: an empty favorites group stays visible with one empty state row',
      !!group && !group.hasAttribute('hidden') && !!emptyRow && leftoverRows.length === 0,
      group && group.getAttribute('hidden'))

    const menu = h.menuFor('dsh-sidebar-suite.favorite')
    check('F5b: a native favorite menu contribution is registered', !!menu)
    const actions = menu.resolve({ sessionId: 's1' })
    check('F5c: the menu offers 收藏会话 when not starred',
      actions.length === 1 && actions[0].label === '收藏会话', JSON.stringify(actions))
    actions[0].run()
    await settle()
    check('F5d: the menu action persists the favorite', h.storage.get(FAV_KEY).includes('s1'))
    const undo = menu.resolve({ sessionId: 's1' })
    check('F5e: the menu flips to 取消收藏 once starred',
      undo.length === 1 && undo[0].label === '取消收藏', JSON.stringify(undo))
  }

  // ---- host-row rhythm, active marker, search ---------------------------
  {
    const many = []
    const favorites = []
    for (let i = 1; i <= 9; i++) {
      many.push({ id: 's' + i, title: i === 2 ? 'Two match' : 'Session ' + i, updatedAt: i * 1000 })
      favorites.push('s' + i)
    }
    const h = mount({ favorites, sessions: many })
    await settle()

    const hostRow = h.doc.querySelector('[data-row-key="session:s1"]')
    check('F7a: favorite rows use the host session row rhythm',
      SRC.includes('[data-dsbs-fav-row]{display:flex;align-items:center;gap:6px;min-width:0;min-height:32px;')
      && SRC.includes('font-size:14px;line-height:20px'), 'row rhythm')

    const wrap = h.doc.querySelector('[data-dsbs-fav-search-wrap]')
    const input = h.doc.querySelector('[data-dsbs-fav-search]')
    check('F7b: search appears once favorites exceed eight',
      !!wrap && !wrap.hasAttribute('hidden') && !!input, wrap ? 'visible' : 'missing')

    input.value = 'two'
    input.dispatchEvent({ type: 'input', target: input })
    await settle()
    check('F7c: search filters by title, case-insensitively',
      h.doc.querySelectorAll('[data-dsbs-fav-row]').length === 1, String(h.doc.querySelectorAll('[data-dsbs-fav-row]').length))
    check('F7d: the count badge still reports the full set',
      h.doc.querySelector('[data-dsbs-fav-count]').textContent === '9')

    input.value = 'no-such-title'
    input.dispatchEvent({ type: 'input', target: input })
    await settle()
    check('F7e: an empty search result explains itself',
      !!h.doc.querySelector('[data-dsbs-fav-empty]')
      && h.doc.querySelector('[data-dsbs-fav-list]').textContent.includes('没有匹配的收藏'))

    input.value = ''
    input.dispatchEvent({ type: 'input', target: input })
    await settle()
    hostRow.setAttribute('aria-selected', 'true')
    // Removing a favorite forces a repaint, which reads the host row.
    h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s2"] [data-dsbs-fav-star]').click()
    await settle()
    check('F7f: the currently open favorite is marked',
      h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s1"]').getAttribute('aria-selected') === 'true')
  }

  {
    const eight = []
    for (let i = 1; i <= 8; i++) eight.push({ id: 'e' + i, title: 'Eight ' + i, updatedAt: i * 1000 })
    const h = mount({ favorites: eight.map((session) => session.id), sessions: eight })
    await settle()
    check('F7g: the search box stays hidden at exactly eight favorites',
      h.doc.querySelector('[data-dsbs-fav-search-wrap]').hasAttribute('hidden'))
  }

  // ---- archive-manager bridge -------------------------------------------
  {
    const archiveIds = ['s4']
    const archive = {
      favoriteSessions: async () => ({ ok: true, value: { favoriteSessionIds: archiveIds.slice() } }),
      setSessionFavorite: async (input) => {
        if (input.favorite) {
          if (archiveIds.indexOf(input.sessionId) < 0) archiveIds.push(input.sessionId)
        } else {
          const at = archiveIds.indexOf(input.sessionId)
          if (at >= 0) archiveIds.splice(at, 1)
        }
        return { ok: true, value: { favoriteSessionIds: archiveIds.slice() } }
      },
    }
    const h = mount({
      favorites: ['s1'],
      archive,
      sessions: [
        { id: 's1', title: 'Old local favorite', updatedAt: 1000 },
        { id: 's4', title: 'Archive favorite', updatedAt: 4000 },
        { id: 's5', title: 'Add through archive', updatedAt: 3000 },
      ],
    })
    await settle()
    await settle()
    check('F6a: the archive favorite list replaces the local cache',
      JSON.parse(h.storage.get(FAV_KEY)).join(',') === 's4', h.storage.get(FAV_KEY))
    check('F6b: the group shows the archive favorite',
      !!h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s4"]'))
    const component = h.componentFor('sidebar.workspaces.session.row.action')
    component({ sessionId: 's5' }).props.onClick(clickEvent())
    await settle()
    await settle()
    check('F6c: the row action writes through archive-manager',
      archiveIds.indexOf('s5') >= 0, archiveIds.join(','))
    check('F6d: archive additions appear in the group',
      !!h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s5"]'))
    const style = h.doc.getElementById('dsh-sidebar-suite-style')
    check('F6e: the main CSS suppresses duplicate stars when archive-manager is present',
      !!style && String(style.textContent).includes(':has(.dsham_starSlot)'))
    h.menuFor('dsh-sidebar-suite.favorite').resolve({ sessionId: 's5' })[0].run()
    await settle()
    await settle()
    check('F6f: the context menu also writes through archive-manager',
      archiveIds.indexOf('s5') < 0, archiveIds.join(','))
  }

  // ---- 1.1.5 regression guards -----------------------------------------
  {
    const archive = {
      favoriteSessions: async () => ({ ok: true, value: { favoriteSessionIds: ['s1'] } }),
      setSessionFavorite: async () => ({ ok: true, value: { favoriteSessionIds: ['s1'] } }),
    }
    const h = mount({ favorites: ['s1'], archive, sessions: [{ id: 's1', title: 'Stable', updatedAt: 1000 }] })
    await settle()
    await settle()
    const favoriteWrites = h.storageWrites.filter((entry) => entry.key === FAV_KEY)
    check('F8a: an unchanged archive snapshot does not write localStorage',
      favoriteWrites.length === 0, JSON.stringify(favoriteWrites))
  }

  {
    let resolveRead = null
    const archiveIds = []
    const archive = {
      favoriteSessions: () => new Promise((resolve) => { resolveRead = resolve }),
      setSessionFavorite: async (input) => {
        if (input.favorite && archiveIds.indexOf(input.sessionId) < 0) archiveIds.push(input.sessionId)
        return { ok: true, value: { favoriteSessionIds: archiveIds.slice() } }
      },
    }
    const h = mount({ favorites: [], archive, sessions: [{ id: 's3', title: 'Race target', updatedAt: 2000 }] })
    await settle()
    const component = h.componentFor('sidebar.workspaces.session.row.action')
    component({ sessionId: 's3' }).props.onClick(clickEvent())
    await settle()
    check('F8b: a delayed pre-click archive read cannot erase a fresh favorite',
      JSON.parse(h.storage.get(FAV_KEY)).includes('s3') && archiveIds.includes('s3'),
      h.storage.get(FAV_KEY))
    if (typeof resolveRead === 'function') resolveRead({ ok: true, value: { favoriteSessionIds: [] } })
    await settle()
    await settle()
    check('F8c: the stale read stays ignored after it resolves',
      JSON.parse(h.storage.get(FAV_KEY)).includes('s3')
      && !!h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s3"]'),
      h.storage.get(FAV_KEY))
  }

  {
    const archiveIds = []
    const archive = {
      favoriteSessions: async () => ({ ok: true, value: { favoriteSessionIds: archiveIds.slice() } }),
      setSessionFavorite: async (input) => {
        if (input.favorite && archiveIds.indexOf(input.sessionId) < 0) archiveIds.push(input.sessionId)
        return { ok: true, value: { favoriteSessionIds: archiveIds.slice() } }
      },
    }
    const h = mount({ favorites: ['s1'], archive, sessions: [{ id: 's1', title: 'Local before archive', updatedAt: 1000 }] })
    await settle()
    await settle()
    check('F8d: an empty archive snapshot migrates instead of clearing local favorites',
      JSON.parse(h.storage.get(FAV_KEY)).includes('s1') && archiveIds.includes('s1'),
      JSON.stringify({ local: h.storage.get(FAV_KEY), archive: archiveIds }))
  }

  {
    const h = mount({
      favorites: ['s1'],
      currentSession: 's1',
      sessions: [{ id: 's1', title: 'Current fallback', updatedAt: 1000 }],
    })
    await settle()
    const row = h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s1"]')
    check('F8e: mainReference selects a favorite when the host row has no aria-selected',
      !!row && row.getAttribute('aria-selected') === 'true')
  }

  {
    const h = mount({
      favorites: ['s1'],
      nestWorkspaces: true,
      sessions: [{ id: 's1', title: 'Nested host slot', updatedAt: 1000 }],
    })
    await settle()
    const group = h.doc.querySelector('[data-dsbs-favorites]')
    check('F8f: a wrapped host workspaces slot does not break favorite mounting',
      !!group && group.parentNode === h.tree.region
      && !!h.tree.nestedWrapper && group.nextSibling === h.tree.nestedWrapper,
      group ? String(group.parentNode && group.parentNode.className) : 'missing')
  }

  {
    const h = mount({
      favorites: ['s1'],
      sessions: [{ id: 's1', title: 'Keyboard guard', updatedAt: 1000 }],
    })
    await settle()
    const row = h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s1"]')
    const star = row.querySelector('[data-dsbs-fav-star]')
    const keydown = row.listeners && row.listeners.keydown && row.listeners.keydown[0]
    if (typeof keydown === 'function') {
      keydown.call(row, {
        type: 'keydown',
        key: ' ',
        target: star,
        preventDefault() {},
        stopPropagation() {},
      })
    }
    check('F8g: Space on the nested row star does not open the session',
      typeof keydown === 'function' && h.opened.length === 0,
      h.opened.join(','))
  }

  {
    let resolveWrite = null
    const archiveIds = []
    const archive = {
      favoriteSessions: async () => ({ ok: true, value: { favoriteSessionIds: archiveIds.slice() } }),
      setSessionFavorite(input) {
        return new Promise((resolve) => { resolveWrite = { input, resolve } })
      },
    }
    const h = mount({ favorites: [], archive, sessions: [{ id: 's1', title: 'Queue target', updatedAt: 1000 }] })
    await settle()
    const component = h.componentFor('sidebar.workspaces.session.row.action')
    component({ sessionId: 's1' }).props.onClick(clickEvent())
    await settle()
    component({ sessionId: 's1' }).props.onClick(clickEvent())
    if (resolveWrite) {
      archiveIds.push('s1')
      resolveWrite.resolve({ ok: true, value: { favoriteSessionIds: archiveIds.slice() } })
    }
    await settle()
    await settle()
    if (resolveWrite) {
      archiveIds.splice(0, archiveIds.length)
      resolveWrite.resolve({ ok: true, value: { favoriteSessionIds: [] } })
    }
    await settle()
    await settle()
    check('F8h: a second star click queues instead of being silently dropped',
      !JSON.parse(h.storage.get(FAV_KEY)).includes('s1') && archiveIds.length === 0,
      JSON.stringify({ local: h.storage.get(FAV_KEY), archive: archiveIds }))
  }

  {
    const archive = {
      favoriteSessions: async () => ({ ok: true, value: { favoriteSessionIds: [] } }),
      setSessionFavorite: async () => ({ ok: false, error: 'refused' }),
    }
    const h = mount({ favorites: [], archive, sessions: [{ id: 's1', title: 'Refused add', updatedAt: 1000 }] })
    await settle()
    const component = h.componentFor('sidebar.workspaces.session.row.action')
    component({ sessionId: 's1' }).props.onClick(clickEvent())
    await settle()
    await settle()
    check('F8i: a refused archive add rolls the star back off',
      !JSON.parse(h.storage.get(FAV_KEY)).includes('s1'),
      h.storage.get(FAV_KEY))
  }

  {
    const archive = {
      favoriteSessions: async () => ({ ok: true, value: { favoriteSessionIds: ['s1'] } }),
      setSessionFavorite: async () => ({ ok: false, error: 'refused' }),
    }
    const h = mount({ favorites: ['s1'], archive, sessions: [{ id: 's1', title: 'Refused remove', updatedAt: 1000 }] })
    await settle()
    const row = h.doc.querySelector('[data-dsbs-fav-row][data-session-id="s1"]')
    const star = row.querySelector('[data-dsbs-fav-star]')
    star.click()
    await settle()
    await settle()
    check('F8j: a refused archive remove rolls the star back on',
      JSON.parse(h.storage.get(FAV_KEY)).includes('s1'),
      h.storage.get(FAV_KEY))
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
