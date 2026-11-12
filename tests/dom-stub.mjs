// A hand-written DOM, shared by the rendering suites.
//
// Why not jsdom: the bundle only touches a dozen DOM methods, and keeping the
// suite dependency-free means CI can run it with a bare `node`. The stub
// implements exactly the surface in use — the selector engine supports the
// subset the bundle actually queries (tag, [attr], [attr="v"], [attr*="v"],
// [attr^="v"], descendant combinator, comma lists).
//
// Extracted from test_031 in 0.4.0 when the temp-session row menu needed the
// same fixture. Nothing here knows about this plugin's behaviour.

// ---------------------------------------------------------------- selectors
export function splitTop(selector, separator) {
  const out = []
  let depth = 0
  let quote = ''
  let current = ''
  for (const ch of selector) {
    if (quote) {
      current += ch
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue }
    if (ch === '[') depth += 1
    if (ch === ']') depth -= 1
    if (ch === separator && depth === 0) { out.push(current); current = ''; continue }
    current += ch
  }
  out.push(current)
  return out.map((part) => part.trim()).filter(Boolean)
}

export function parseCompound(compound) {
  const match = /^([a-zA-Z][\w-]*|\*)?/.exec(compound)
  const tag = match && match[1] && match[1] !== '*' ? match[1].toUpperCase() : null
  const attrs = []
  const rest = compound.slice(match ? match[0].length : 0)
  const re = /\[([^\]=^$*]+)(?:([\]=^$*]+)"([^"]*)")?\]/g
  let found
  while ((found = re.exec(rest))) {
    attrs.push({ name: found[1].trim(), op: found[2] || null, value: found[3] })
  }
  return { tag, attrs }
}

export function matchCompound(el, compound) {
  const { tag, attrs } = parseCompound(compound)
  if (tag && el.tagName !== tag) return false
  for (const attr of attrs) {
    const value = el.getAttribute(attr.name)
    if (value == null) return false
    if (attr.op == null) continue
    const wanted = attr.value
    if (attr.op === '=') { if (value !== wanted) return false }
    else if (attr.op === '*=') { if (value.indexOf(wanted) < 0) return false }
    else if (attr.op === '^=') { if (value.indexOf(wanted) !== 0) return false }
    else if (attr.op === '$=') { if (!value.endsWith(wanted)) return false }
  }
  return true
}

export function matchSelector(el, selector) {
  for (const group of splitTop(selector, ',')) {
    const parts = splitTop(group, ' ')
    if (!matchCompound(el, parts[parts.length - 1])) continue
    let index = parts.length - 2
    let node = el.parentNode
    while (index >= 0) {
      if (!node || node.tagName === '#DOCUMENT') break
      if (matchCompound(node, parts[index])) index -= 1
      node = node.parentNode
    }
    if (index < 0) return true
  }
  return false
}

// ---------------------------------------------------------------- fake DOM
function makeStyle() {
  return {
    cssText: '',
    setProperty(name, value) { this[name] = value },
    getPropertyValue(name) { return this[name] || '' },
    removeProperty(name) { delete this[name] },
  }
}

export class El {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase()
    this.ownerDocument = doc || null
    this.children = []
    this.parentNode = null
    this.attributes = {}
    this.style = makeStyle()
    this.className = ''
    this.id = ''
    this.listeners = {}
    this._text = ''
    this._html = ''
    this.offsetHeight = 0
    this.offsetWidth = 0
  }

  get parentElement() { return this.parentNode && this.parentNode.tagName === '#DOCUMENT' ? null : this.parentNode }
  get firstChild() { return this.children[0] || null }
  get lastChild() { return this.children[this.children.length - 1] || null }
  get nextSibling() {
    if (!this.parentNode) return null
    const list = this.parentNode.children
    const i = list.indexOf(this)
    return i >= 0 && i + 1 < list.length ? list[i + 1] : null
  }
  get previousSibling() {
    if (!this.parentNode) return null
    const list = this.parentNode.children
    const i = list.indexOf(this)
    return i > 0 ? list[i - 1] : null
  }

  get textContent() {
    if (this.children.length) return this.children.map((child) => child.textContent).join('')
    return this._text
  }
  set textContent(value) {
    this._text = String(value == null ? '' : value)
    for (const child of this.children) child.parentNode = null
    this.children = []
  }

  get innerHTML() { return this._html }
  set innerHTML(value) {
    this._html = String(value == null ? '' : value)
    if (this._html === '') {
      for (const child of this.children) child.parentNode = null
      this.children = []
    }
  }

  appendChild(child) {
    if (!child) return child
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.children.push(child)
    this._notify(child)
    return child
  }

  insertBefore(child, reference) {
    if (!child) return child
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    if (!reference) { this.children.push(child); this._notify(child); return child }
    const index = this.children.indexOf(reference)
    if (index < 0) this.children.push(child)
    else this.children.splice(index, 0, child)
    this._notify(child)
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) {
      this.children.splice(index, 1)
      child.parentNode = null
      this._notify(child)
    }
    return child
  }

  remove() { if (this.parentNode) this.parentNode.removeChild(this) }

  _notify(child) {
    if (this.ownerDocument && this.ownerDocument.__onMutation) this.ownerDocument.__onMutation(this, child)
  }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) {
    if (name === 'class') return this.className || null
    if (name === 'id') return this.id || null
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null
  }
  removeAttribute(name) { delete this.attributes[name] }
  hasAttribute(name) { return this.getAttribute(name) != null }

  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(handler)
  }
  removeEventListener(type, handler) {
    const list = this.listeners[type]
    if (!list) return
    const index = list.indexOf(handler)
    if (index >= 0) list.splice(index, 1)
  }
  dispatchEvent(event) {
    event.target = event.target || this
    event.currentTarget = this
    if (typeof event.preventDefault !== 'function') event.preventDefault = () => {}
    if (typeof event.stopPropagation !== 'function') event.stopPropagation = () => {}
    const list = (this.listeners[event.type] || []).slice()
    for (const handler of list) handler.call(this, event)
    return true
  }
  click() { this.dispatchEvent({ type: 'click', bubbles: true }) }
  focus() {}

  contains(node) {
    let current = node
    while (current) {
      if (current === this) return true
      current = current.parentNode
    }
    return false
  }

  closest(selector) {
    let node = this
    while (node && node.tagName !== '#DOCUMENT') {
      if (matchSelector(node, selector)) return node
      node = node.parentNode
    }
    return null
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 292, bottom: 600, width: 292, height: 600, x: 0, y: 0 }
  }

  querySelectorAll(selector) {
    const out = []
    const walk = (node) => {
      for (const child of node.children) {
        if (matchSelector(child, selector)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
}

export class Doc {
  constructor() {
    this.tagName = '#DOCUMENT'
    this.children = []
    this.parentNode = null
    this.listeners = {}
    this.documentElement = this._make('html')
    this.head = this._make('head')
    this.body = this._make('body')
    this.documentElement.appendChild(this.head)
    this.documentElement.appendChild(this.body)
    this.__onMutation = null
  }
  _make(tag) {
    const el = new El(tag, this)
    el.parentNode = this
    this.children.push(el)
    return el
  }
  createElement(tag) { return new El(tag, this) }
  appendChild(el) { el.parentNode = this; this.children.push(el); return el }
  removeChild(el) {
    const index = this.children.indexOf(el)
    if (index >= 0) this.children.splice(index, 1)
    el.parentNode = null
    return el
  }
  getElementById(id) {
    return this.documentElement.querySelector('[id="' + id + '"]')
  }
  querySelector(selector) { return this.documentElement.querySelector(selector) }
  querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector) }
  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(handler)
  }
  removeEventListener(type, handler) {
    const list = this.listeners[type]
    if (!list) return
    const index = list.indexOf(handler)
    if (index >= 0) list.splice(index, 1)
  }
  dispatchEvent(event) {
    for (const handler of (this.listeners[event.type] || []).slice()) handler(event)
    return true
  }
  getComputedStyle() { return { display: 'block', position: 'static' } }
}

// A DSH 0.2.2-rc.2 sidebar reduced to its contract. These class names were
// sampled from the live renderer over CDP on 2026-11-12 (root
// `wtg9ga_scrollArea`, panels `nav.wtg9ga_panelList`, workspaces wrapper
// `wtg9ga_regionArea`). The CSS-module prefix is opaque and changes between
// DSH builds; the client only matches the semantic `panelList` suffix plus
// `[data-slot="sidebar.workspaces"]`, so the suites must exercise the real
// shipped markup rather than an idealised `nav.panelList` that no longer exists.
// options.gridHost reproduces the real DSH 0.2.2-rc.2 tree (see the host's
// SidebarRoot.tsx): a flex `scrollRegion` owns a CSS-grid `scrollArea`, which
// pins nav.panelList to grid-row 2 and div.regionArea to grid-row 4. Tests that
// verify the plugin's header placement MUST opt in, otherwise they silently
// exercise the older flex-only root and miss the grid auto-placement bug.
export function buildSidebar(options = {}) {
  const doc = new Doc()
  const root = doc.createElement('div')
  root.setAttribute('data-dsbs-test-root', '')
  root.className = 'wtg9ga_scrollArea'
  const nav = doc.createElement('nav')
  nav.className = 'wtg9ga_panelList'
  nav.appendChild(doc.createElement('div'))
  const region = doc.createElement('div')
  region.className = 'wtg9ga_regionArea'
  const workspaces = doc.createElement('div')
  workspaces.setAttribute('data-slot', 'sidebar.workspaces')
  region.appendChild(workspaces)
  root.appendChild(nav)
  root.appendChild(region)

  let scrollRegion = null
  if (options.gridHost === true) {
    scrollRegion = doc.createElement('div')
    scrollRegion.className = 'wtg9ga_scrollRegion'
    scrollRegion.appendChild(root)
    doc.body.appendChild(scrollRegion)
  } else {
    doc.body.appendChild(root)
  }
  return { doc, root, nav, region, workspaces, scrollRegion, scrollArea: root }
}

// ---------------------------------------------------------------- timers
// The bundle keeps intervals alive for as long as it runs. Unref every timer
// the sandbox hands out, so a finished test lets the process exit on its own
// instead of lingering until the parent kills it.
export const unrefTimer = (timer) => {
  if (timer && typeof timer.unref === 'function') timer.unref()
  return timer
}
export const sbTimeout = (fn, ms, ...rest) => unrefTimer(setTimeout(fn, ms, ...rest))
export const sbInterval = (fn, ms, ...rest) => unrefTimer(setInterval(fn, ms, ...rest))
