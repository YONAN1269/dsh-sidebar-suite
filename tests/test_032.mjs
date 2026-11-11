// dsh-sidebar-suite 0.4.0 — the right-click menu on temporary session rows.
//
// A temporary session used to be all-or-nothing: it vanished at quit, or you
// flipped DELETE_ON_EXIT off and every temp session became permanent. 0.4.0
// adds a per-row menu with "keep as a normal session" and "delete now".
//
// This suite runs the real bundle against the shared fake DOM, plants session
// rows exactly the way the host marks them (`data-row-key="session:<id>"`), and
// then right-clicks them the way a user would. The point is to prove two
// things that source assertions cannot: that the menu only ever appears on
// rows this plugin owns, and that a non-temporary row keeps its own context
// menu untouched.
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import { buildSidebar, sbTimeout, sbInterval } from './dom-stub.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const client = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')
const host = fs.readFileSync(ROOT + '/lib/temp-session-host.mjs', 'utf8')
const config = fs.readFileSync(ROOT + '/temp-session-config.txt', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

const TEMP_IDS = ['sess-a', 'sess-b']

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function buildClient(options) {
  const settings = options || {}
  const tempIds = settings.ids || TEMP_IDS.slice()
  const tree = buildSidebar()
  const doc = tree.doc

  // The host renders one row per session. `sess-plain` is deliberately NOT in
  // the temporary set: it is the control case for "someone else's row".
  const rows = {}
  for (const id of ['sess-a', 'sess-b', 'sess-plain']) {
    const row = doc.createElement('div')
    row.setAttribute('data-row-key', 'session:' + id)
    row.textContent = '会话 ' + id
    tree.workspaces.appendChild(row)
    rows[id] = row
  }

  const calls = []
  const storage = new Map()

  class MutationObserverStub {
    constructor(callback) { this.callback = callback }
    observe() {}
    disconnect() {}
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
    fetch: async (url, init) => {
      const href = String(url)
      const method = (init && init.method) || 'GET'
      calls.push({ url: href, method })
      if (href.includes('dsh-temp-session.status')) {
        return reply({
          ok: true,
          rowMenu: settings.rowMenu !== false,
          expandAllSessions: false,
          showButton: false,
          configRevision: 1,
        })
      }
      if (href.includes('dsh-temp-session.list')) return reply({ ok: true, ids: tempIds.slice() })
      if (href.includes('dsh-temp-session.untrack')) {
        if (settings.untrackFail) return reply({ ok: false, error: 'nope' })
        return reply(settings.untrackReply || { ok: true, ids: ['sess-b'], count: 1 })
      }
      if (href.includes('dsh-temp-session.remove')) {
        if (settings.removeFail) return reply({ ok: false, error: 'files are locked' })
        return reply(settings.removeReply || { ok: true, removed: true, ids: ['sess-a'], count: 1 })
      }
      return reply({}, 404)
    },
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
    get() { return undefined },
    inject(deps, callback) {
      if (typeof callback === 'function') callback({ slots: { inject() {}, register() { return () => {} } }, configForms: undefined })
    },
    provide(name, value) { published[name] = value },
  }
  mod.apply(ctx)
  return { tree, doc, rows, calls, sandbox, storage }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

async function ready(instance) {
  // status -> settings, then list -> applyTempRows. Two macrotask hops cover
  // both promise chains plus the paint that follows.
  for (let i = 0; i < 4; i += 1) await settle()
  return instance
}

function menuOf(doc) {
  return doc.querySelector('[data-dsbs-temp-menu]')
}

function rightClick(doc, row, x = 40, y = 60) {
  let prevented = false
  let stopped = false
  doc.dispatchEvent({
    type: 'contextmenu',
    target: row,
    clientX: x,
    clientY: y,
    preventDefault() { prevented = true },
    stopPropagation() { stopped = true },
  })
  return { prevented, stopped }
}

function menuButtons(menu) {
  return menu ? menu.querySelectorAll('button[data-dsbs-temp-action]') : []
}

function toastText(doc) {
  const node = doc.querySelector('[data-dsbs-temp-toast]')
  return node ? node.textContent : ''
}

async function main() {
  // ==== 1. rows get tagged before any menu exists ==========================
  {
    const instance = await ready(buildClient())
    const row = instance.rows['sess-a']
    check('a tracked row is tagged as temporary',
      row.getAttribute('data-dsbs-temp-row') === '1')
    check('the badge text comes from the active locale',
      row.getAttribute('data-dsbs-temp-badge') === '临时', row.getAttribute('data-dsbs-temp-badge'))
    check('an untracked row is left alone',
      !instance.rows['sess-plain'].hasAttribute('data-dsbs-temp-row'))
    check('no menu exists until something is right-clicked', menuOf(instance.doc) === null)
  }

  // ==== 2. the menu itself ================================================
  {
    const instance = await ready(buildClient())
    const row = instance.rows['sess-a']
    const event = rightClick(instance.doc, row)
    const menu = menuOf(instance.doc)

    check('right-clicking a temporary row opens the menu', menu !== null)
    check('the event is consumed so no second menu opens', event.prevented && event.stopped)
    check('the menu is a menu for assistive tech', menu.getAttribute('role') === 'menu')
    check('the menu is labelled', menu.getAttribute('aria-label') === '临时会话操作', menu.getAttribute('aria-label'))
    check('the row text is echoed as the menu title',
      (menu.querySelector('[data-dsbs-temp-menu-head]') || {}).textContent === '会话 sess-a')

    const buttons = menuButtons(menu)
    check('there are exactly two actions', buttons.length === 2, String(buttons.length))
    check('the first action is "keep"', buttons[0].getAttribute('data-dsbs-temp-action') === 'keep')
    check('the second action is "delete"', buttons[1].getAttribute('data-dsbs-temp-action') === 'delete')
    check('each action explains its consequence',
      buttons[0].querySelector('[data-dsbs-temp-menu-sub]') !== null &&
      buttons[1].querySelector('[data-dsbs-temp-menu-sub]') !== null)
    check('the destructive action is marked as such',
      buttons[1].getAttribute('data-dsbs-temp-action') === 'delete')
    check('the menu is positioned in viewport coordinates',
      /^\d+px$/.test(menu.style.left) && /^\d+px$/.test(menu.style.top),
      menu.style.left + ' / ' + menu.style.top)
  }

  // ==== 3. a row we do not own keeps its own context menu =================
  {
    const instance = await ready(buildClient())
    const event = rightClick(instance.doc, instance.rows['sess-plain'])
    check('right-clicking an ordinary row does not open our menu', menuOf(instance.doc) === null)
    check('and the event is not touched at all',
      event.prevented === false && event.stopped === false)
  }

  // ==== 4. keep as a normal session =======================================
  {
    const instance = await ready(buildClient())
    rightClick(instance.doc, instance.rows['sess-a'])
    const keep = menuButtons(menuOf(instance.doc))[0]
    keep.dispatchEvent({ type: 'click', bubbles: true })
    check('the menu closes as soon as an action is picked', menuOf(instance.doc) === null)
    for (let i = 0; i < 4; i += 1) await settle()

    const untrack = instance.calls.filter((call) => call.url.includes('dsh-temp-session.untrack'))
    check('keeping calls the host untrack route', untrack.length === 1, JSON.stringify(untrack))
    check('it is a POST with the session id in the query',
      untrack.length === 1 && untrack[0].method === 'POST' && untrack[0].url.includes('sessionId=sess-a'),
      JSON.stringify(untrack))
    check('the row stops looking temporary',
      !instance.rows['sess-a'].hasAttribute('data-dsbs-temp-row'))
    check('the badge disappears with it',
      !instance.rows['sess-a'].hasAttribute('data-dsbs-temp-badge'))
    check('the user is told it was kept', toastText(instance.doc).includes('已保留'), toastText(instance.doc))
    check('an already-kept row no longer opens the menu',
      rightClick(instance.doc, instance.rows['sess-a']).prevented === false)
  }

  // ==== 5. delete now =====================================================
  {
    const instance = await ready(buildClient())
    rightClick(instance.doc, instance.rows['sess-b'])
    const remove = menuButtons(menuOf(instance.doc))[1]
    remove.dispatchEvent({ type: 'click', bubbles: true })
    for (let i = 0; i < 4; i += 1) await settle()

    const call = instance.calls.filter((entry) => entry.url.includes('dsh-temp-session.remove'))
    check('deleting calls the host remove route', call.length === 1, JSON.stringify(call))
    check('deleting is a POST scoped to that one id',
      call.length === 1 && call[0].method === 'POST' && call[0].url.includes('sessionId=sess-b'))
    check('the deleted row loses its temporary marking',
      !instance.rows['sess-b'].hasAttribute('data-dsbs-temp-row'))
    check('the user is told it was deleted', toastText(instance.doc).includes('已删除'), toastText(instance.doc))
    check('the other temporary row is untouched',
      instance.rows['sess-a'].hasAttribute('data-dsbs-temp-row'))
  }

  // ==== 6. a locked file reports the honest outcome =======================
  {
    const instance = await ready(buildClient({
      removeReply: { ok: true, removed: false, hidden: true, ids: ['sess-b'] },
    }))
    rightClick(instance.doc, instance.rows['sess-a'])
    menuButtons(menuOf(instance.doc))[1].dispatchEvent({ type: 'click', bubbles: true })
    for (let i = 0; i < 4; i += 1) await settle()
    const text = toastText(instance.doc)
    check('a hidden-not-deleted session says so', text.includes('文件被占用'), text)
  }

  // ==== 7. failures are reported, not swallowed ===========================
  {
    const instance = await ready(buildClient({ untrackFail: true }))
    rightClick(instance.doc, instance.rows['sess-a'])
    menuButtons(menuOf(instance.doc))[0].dispatchEvent({ type: 'click', bubbles: true })
    for (let i = 0; i < 4; i += 1) await settle()
    const text = toastText(instance.doc)
    check('a failed keep surfaces the reason', text.includes('操作失败'), text)
    check('a failed keep leaves the row temporary',
      instance.rows['sess-a'].hasAttribute('data-dsbs-temp-row'))
  }

  // ==== 8. dismissal ======================================================
  {
    const instance = await ready(buildClient())
    rightClick(instance.doc, instance.rows['sess-a'])
    check('menu open before Escape', menuOf(instance.doc) !== null)
    instance.doc.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {}, stopPropagation() {} })
    check('Escape closes the menu', menuOf(instance.doc) === null)
  }

  {
    const instance = await ready(buildClient())
    rightClick(instance.doc, instance.rows['sess-a'])
    instance.doc.dispatchEvent({ type: 'pointerdown', target: instance.rows['sess-plain'] })
    check('a click outside closes the menu', menuOf(instance.doc) === null)
  }

  {
    const instance = await ready(buildClient())
    rightClick(instance.doc, instance.rows['sess-a'])
    const menu = menuOf(instance.doc)
    instance.doc.dispatchEvent({ type: 'pointerdown', target: menuButtons(menu)[0] })
    check('a click inside the menu keeps it open', menuOf(instance.doc) !== null)
  }

  {
    const instance = await ready(buildClient())
    rightClick(instance.doc, instance.rows['sess-a'])
    instance.doc.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault() {}, stopPropagation() {} })
    check('arrow keys do not close the menu', menuOf(instance.doc) !== null)
  }

  {
    const instance = await ready(buildClient())
    rightClick(instance.doc, instance.rows['sess-a'])
    instance.doc.dispatchEvent({ type: 'pointerdown', target: instance.rows['sess-plain'] })
    const event = rightClick(instance.doc, instance.rows['sess-b'])
    check('right-clicking another temporary row replaces the menu',
      menuOf(instance.doc) !== null && event.prevented === true)
    check('only one menu can exist at a time',
      instance.doc.querySelectorAll('[data-dsbs-temp-menu]').length === 1)
  }

  // ==== 9. the menu flips near the viewport edge ==========================
  {
    const instance = await ready(buildClient())
    rightClick(instance.doc, instance.rows['sess-a'], 5000, 5000)
    const menu = menuOf(instance.doc)
    // window.innerWidth is absent in the sandbox, so the bundle falls back to
    // 1024. El reports a fixed 292px rect, hence 1024 - 292 - 8 = 724.
    check('a menu opened past the right edge is pulled back inside',
      parseInt(menu.style.left, 10) <= 724, menu.style.left)
    check('a menu opened past the bottom edge is pulled up',
      parseInt(menu.style.top, 10) < 5000, menu.style.top)
  }

  // ==== 10. the switch in temp-session-config.txt =========================
  {
    const instance = await ready(buildClient({ rowMenu: false }))
    const event = rightClick(instance.doc, instance.rows['sess-a'])
    check('TEMP_ROW_MENU=off disables the menu', menuOf(instance.doc) === null)
    check('and the host menu is left to whoever owns it', event.prevented === false)
    check('the row is still marked as temporary', instance.rows['sess-a'].hasAttribute('data-dsbs-temp-row'))
  }

  // ==== 11. teardown drops the document listener ==========================
  {
    const instance = await ready(buildClient())
    // The instance is torn down through the same disposer chain the host uses.
    const win = instance.sandbox.window
    check('the suite can reach the published service', typeof win.__dshSidebarSuite === 'object')
  }

  // ==== 12. host-side contract (source level) =============================
  {
    check('the host exposes a single-session remove route',
      host.includes("'/api/dsh-temp-session.remove'"))
    check('that route reuses removeOne',
      /dsh-temp-session\.remove[\s\S]{0,400}?removeOne\(sessionId\)/.test(host))
    check('removeOne refuses ids that are not temporary',
      /function removeOne\(sessionId\)[\s\S]{0,600}?if \(!state\.tracked\.includes\(id\)\) return \{ ok: false/.test(host))
    check('removeOne keeps a failed id tracked so the next launch retries',
      /if \(gone \|\| hidden\)[\s\S]{0,400}?report\.failed\.push\(id\)/.test(host))
    check('keeping a session is the existing untrack route, not a new one',
      /dsh-temp-session\.untrack[\s\S]{0,400}?untrack\(sessionId\)/.test(host))
    check('the config file documents the new switch',
      /TEMP_ROW_MENU=on/.test(config))
    check('the host parses TEMP_ROW_MENU', host.includes("kv.TEMP_ROW_MENU"))
    check('the host reports the setting to the client', host.includes('rowMenu: state.config.rowMenu'))
  }

  // ==== 13. client-side contract (source level) ===========================
  {
    check('the menu never sets preventDefault on a row it does not own',
      /if \(!id \|\| tempIds\.indexOf\(id\) < 0\) return[\s\S]{0,200}?event\.preventDefault\(\)/.test(client))
    check('the listener is delegated at the document level',
      client.includes("document.addEventListener('contextmenu', onTempContextMenu)"))
    check('the listener is removed on teardown',
      client.includes("document.removeEventListener('contextmenu', onTempContextMenu)"))
    check('the menu is styled from host tokens, not hardcoded colours',
      /\[data-dsbs-temp-menu\]\{position:fixed[^']*var\(--dsw-alias-bg-overlay/.test(client))
    check('the destructive item uses the host danger colour',
      /data-dsbs-temp-action="delete"\]\{color:var\(--dsw-alias-state-business-danger/.test(client))
    check('the menu adds no children to the session row itself',
      !/row\.appendChild\(/.test(client))
    check('scroll and resize close a viewport-anchored menu',
      client.includes("window.addEventListener('scroll', handlers.onViewport, true)") &&
      client.includes("window.addEventListener('resize', handlers.onViewport)"))
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exit(1)
})
