// dsh-sidebar-suite — Client half.
//
// The DSH left sidebar stacks two groups in one column: the panels group
// (`nav` with a `panelList` class) and the workspaces group
// (`[data-slot="sidebar.workspaces"]` inside its own region). They compete for
// the same vertical space, so this plugin offers three layouts for them:
//
//   a  both groups fold independently
//   b  the groups share one space and the control bar switches between them
//   c  the workspaces stay put and the panels open as an overlay
//
// All state lives in attributes on <html>, the host's markup is never
// restructured, and the only node this plugin adds is one control bar inserted
// as a direct child of the sidebar root.
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-suite',
  factory(require) {
    'use strict'

    var ENTRY = 'dsh-sidebar-suite'
    var NS = 'sidebar-suite'
    var LS_KEY = 'dsh-sidebar-suite:state'
    var STYLE_ID = 'dsh-sidebar-suite-style'
    // The plugin detail page is a React surface. Load React defensively: if the
    // module loader does not hand us `require`, the sidebar still works and we
    // simply skip registering the graphical settings page.
    var React = null
    try {
      React = typeof require === 'function' ? require('react') : null
    } catch (error) {
      React = null
    }
    // A client bundle can be applied more than once in the same page (a hot
    // client reload after the plugin's files change, or a second Loader entry
    // for the same package). Both runs would insert a bar and fight over the
    // same <html> attributes, so the first live run owns the sidebar.
    var OWNER_KEY = '__dshSidebarSuiteOwner'

    var DEFAULTS = { mode: 'b', showQuickSwitch: true, tab: 'ext', foldExt: false, foldWs: false }
    var MODES = ['a', 'b', 'c']

    var DICTS = {
      en: {
        'bar.label': 'Sidebar layout',
        'bar.local': 'Settings are stored on this device only (the official config layer is unavailable).',
        'mode.a': 'Fold',
        'mode.a.hint': 'Each group folds on its own.',
        'mode.b': 'Toggle',
        'mode.b.hint': 'The two groups share one space; choose which one is shown.',
        'mode.c': 'Overlay',
        'mode.c.hint': 'Workspaces stay visible; panels open as an overlay.',
        'quick.label': 'Cycle',
        'quick.hint': 'Cycle the sidebar layout.',
        'fold.ext.collapse': 'Hide panels',
        'fold.ext.expand': 'Show panels',
        'fold.ext.hint': 'Hide or show the panels group.',
        'fold.ws.collapse': 'Hide workspaces',
        'fold.ws.expand': 'Show workspaces',
        'fold.ws.hint': 'Hide or show the workspaces group.',
        'tab.to.ext': 'Show panels',
        'tab.to.ext.hint': 'Switch the shared space to the panels group.',
        'tab.to.ws': 'Show workspaces',
        'tab.to.ws.hint': 'Switch the shared space to the workspaces group.',
        'pop.open': 'Open panels',
        'pop.close': 'Close panels',
        'pop.hint': 'Open or close the panels overlay.',
        'settings.title': 'Default layout on startup',
        'settings.help': 'Pick the layout DSH starts with. This writes the plugin config; switching from the sidebar bar is session-only.',
        'settings.unavailable': 'The config service is unavailable right now, so the default cannot be changed here.',
        'settings.current': 'Current default',
      },
      zh: {
        'bar.label': '侧栏布局',
        'bar.local': '设置仅保存在本机（官方配置层不可用）。',
        'mode.a': '折叠',
        'mode.a.hint': '两组各自收起。',
        'mode.b': '标签页',
        'mode.b.hint': '两组共用一栏，用标签页切换显示。',
        'mode.c': '浮层',
        'mode.c.hint': '工作区常驻，扩展以浮层展开。',
        'quick.label': '换布局',
        'quick.hint': '循环切换侧栏布局。',
        'fold.ext.collapse': '收起扩展',
        'fold.ext.expand': '展开扩展',
        'fold.ext.hint': '收起或展开扩展区。',
        'fold.ws.collapse': '收起工作区',
        'fold.ws.expand': '展开工作区',
        'fold.ws.hint': '收起或展开工作区。',
        'tab.to.ext': '显示扩展',
        'tab.to.ext.hint': '把共用的一栏切换到扩展区。',
        'tab.to.ws': '显示工作区',
        'tab.to.ws.hint': '把共用的一栏切换到工作区。',
        'pop.open': '展开扩展',
        'pop.close': '收起扩展',
        'pop.hint': '打开或收起扩展浮层。',
        'settings.title': '启动时的默认布局',
        'settings.help': '选择 DSH 启动时使用的布局。这里会写入插件配置；在侧栏上临时切换不会改动它。',
        'settings.unavailable': '配置服务暂时不可用，无法在这里修改默认布局。',
        'settings.current': '当前默认',
      },
    }

    // The plugin detail page must read well in both languages regardless of
    // the UI locale, so the settings copy is deliberately bilingual in both
    // dictionaries. The long detail document (DETAIL.md) does the same.
    var BILINGUAL_SETTINGS = {
      'settings.title': '启动时的默认布局 · Default layout on startup',
      'settings.help': '选择 DSH 启动时使用的布局，这里会写入插件配置；在侧栏上临时切换只影响本次会话。 / Pick the layout DSH starts with — this writes the plugin config, while switching from the sidebar bar stays session-only.',
      'settings.unavailable': '配置服务暂时不可用，无法在这里修改默认布局。 / The config service is unavailable right now, so the default cannot be changed here.',
      'settings.current': '当前默认 / Current',
      'settings.support': '喜欢这个插件？请作者喝杯咖啡 · Enjoy it? Buy me a coffee',
      'settings.supportHint': '完全自愿，无任何回报承诺。用微信扫一扫即可；「设置 → 支持贡献者」里也登记了同一个码。 / Purely voluntary, no rewards promised. Scan with WeChat Pay; the same QR is registered under Settings → Support contributors.',
      'settings.qrAlt': '微信支付收款码 / WeChat Pay QR',
    }
    for (var lang in DICTS) {
      if (!Object.prototype.hasOwnProperty.call(DICTS, lang)) continue
      for (var key in BILINGUAL_SETTINGS) {
        if (Object.prototype.hasOwnProperty.call(BILINGUAL_SETTINGS, key)) DICTS[lang][key] = BILINGUAL_SETTINGS[key]
      }
    }

    var CSS = [
      '[data-dsbs-bar]{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:2px 0 6px;flex:none;min-width:0}',
      '[data-dsbs-bar] [hidden]{display:none!important}',
      '[data-dsbs-sep]{width:1px;height:12px;flex:none;border-radius:1px;margin:0 1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.3))}',
      '[data-dsbs-bar] button{appearance:none;-webkit-appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:11px;line-height:15px;padding:2px 6px;border-radius:6px;cursor:pointer;user-select:none;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}',
      '[data-dsbs-bar] button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,inherit)}',
      '[data-dsbs-bar] button[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.22));color:var(--dsw-alias-label-primary,inherit);font-weight:500}',
      '[data-dsbs-bar] button:focus-visible{outline:2px solid var(--dsw-alias-label-primary,currentColor);outline-offset:1px}',
      '[data-dsbs-bar] button[data-dsbs-btn="quick"]{margin-left:auto;color:var(--dsw-alias-label-tertiary,inherit);padding:2px 6px}',
      'html[data-dsbs-narrow="true"] [data-dsbs-btn="quick"]{display:none}',
      'html[data-dsbs-rail="true"] [data-dsbs-bar]{display:none}',
      // a — each group folds on its own
      'html[data-dsbs-mode="a"][data-dsbs-fold-ext="true"] nav[data-dsbs-ext]{display:none}',
      'html[data-dsbs-mode="a"][data-dsbs-fold-ws="true"] div:has(> [data-slot="sidebar.workspaces"]){display:none}',
      // b — the two groups are mutually exclusive
      'html[data-dsbs-mode="b"][data-dsbs-tab="ext"] div:has(> [data-slot="sidebar.workspaces"]){display:none}',
      'html[data-dsbs-mode="b"][data-dsbs-tab="ws"] nav[data-dsbs-ext]{display:none}',
      // c — panels become an overlay above the workspaces
      'html[data-dsbs-mode="c"]:not([data-dsbs-pop="true"]) nav[data-dsbs-ext]{display:none}',
      'html[data-dsbs-mode="c"][data-dsbs-pop="true"] nav[data-dsbs-ext]{display:flex;flex-direction:column;gap:2px;position:absolute;z-index:60;left:4px;right:4px;top:var(--dsbs-pop-top,64px);max-height:60vh;overflow:auto;padding:6px;border-radius:10px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base,#fff));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));box-shadow:0 12px 32px rgba(0,0,0,.24)}',
      // the overlay needs a positioned containing block; the sidebar root is the
      // only element with the panels nav as a direct child
      'div:has(> nav[data-dsbs-ext]){position:relative}',
      // Plugin Manager detail page: `.detailSections` is already a column flex,
      // so `order:-1` lifts this bundle's configuration section above the long
      // detail document. Scoped by data-plugin-detail, no other bundle is hit.
      '[data-plugin-detail="dsh-sidebar-suite"] [data-plugin-config]{order:-1;box-sizing:border-box;padding:14px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));border-radius:12px;background:var(--dsw-alias-bg-subtle,rgba(127,127,127,.05))}',
      '[data-plugin-detail="dsh-sidebar-suite"] [data-dsbs-support]{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:2px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}',
      '[data-plugin-detail="dsh-sidebar-suite"] [data-dsbs-support] img{width:96px;height:96px;object-fit:contain;box-sizing:border-box;padding:4px;border-radius:8px;background:#fff;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}',
      '[data-plugin-detail="dsh-sidebar-suite"] [data-dsbs-support] [data-dsbs-support-text]{flex:1 1 200px;min-width:0;display:flex;flex-direction:column;gap:4px}',
    ].join('\n')

    function assign(target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i]
        if (!source || typeof source !== 'object') continue
        for (var key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key]
        }
      }
      return target
    }

    function safeGet(ctx, name) {
      if (!ctx) return undefined
      try {
        if (typeof ctx.get === 'function') return ctx.get(name)
      } catch (error) {
        void error
      }
      return undefined
    }

    function isExtNav(node) {
      return !!node && node.tagName === 'NAV' && /panelList/.test(node.className || '')
    }

    // Resolved on every sync: the sidebar is rebuilt by React on session
    // changes, so nothing here may be cached.
    function resolveSidebar() {
      if (typeof document === 'undefined') return null
      var workspaces = document.querySelector('[data-slot="sidebar.workspaces"]')
      if (!workspaces) return null
      var regionArea = workspaces.parentElement
      if (!regionArea) return null
      var node = regionArea
      var root = null
      var nav = null
      while (node && node !== document.body && node !== document.documentElement) {
        var children = node.children
        for (var i = 0; i < children.length; i++) {
          var child = children[i]
          if (child === regionArea) continue
          if (isExtNav(child)) {
            nav = child
            root = node
            break
          }
        }
        if (root) break
        node = node.parentElement
      }
      if (!root) {
        root = regionArea.parentElement
        if (!root) return null
        for (var j = 0; j < root.children.length; j++) {
          if (isExtNav(root.children[j])) {
            nav = root.children[j]
            break
          }
        }
      }
      return { root: root, nav: nav, regionArea: regionArea, workspaces: workspaces }
    }

    function readLocal() {
      try {
        var raw = localStorage.getItem(LS_KEY)
        if (!raw) return {}
        var parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch (error) {
        return {}
      }
    }

    function writeLocal(value) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(value))
      } catch (error) {
        void error
      }
    }

    function adoptValues(raw) {
      var out = assign({}, DEFAULTS)
      if (!raw || typeof raw !== 'object') return out
      if (MODES.indexOf(raw.mode) >= 0) out.mode = raw.mode
      if (typeof raw.showQuickSwitch === 'boolean') out.showQuickSwitch = raw.showQuickSwitch
      if (raw.tab === 'ext' || raw.tab === 'ws') out.tab = raw.tab
      if (typeof raw.foldExt === 'boolean') out.foldExt = raw.foldExt
      if (typeof raw.foldWs === 'boolean') out.foldWs = raw.foldWs
      return out
    }

    // The locale service merges dictionaries per namespace and keeps entries
    // registered by earlier client generations, so a bound translator can mix
    // stale and current strings (that is how a page ends up with Chinese modes
    // and English captions). The bar's own labels only need zh/en, so they are
    // resolved from the active locale id and this plugin's dictionaries.
    function detectLang(localeService) {
      var candidates = []
      try {
        if (localeService && typeof localeService.getSnapshot === 'function') {
          var snapshot = localeService.getSnapshot()
          if (snapshot && snapshot.active) candidates.push(snapshot.active)
        }
        if (localeService && typeof localeService.getLocale === 'function') {
          var active = localeService.getLocale()
          if (typeof active === 'string') candidates.push(active)
          else if (active && active.active) candidates.push(active.active)
        }
      } catch (error) {
        void error
      }
      try {
        candidates.push(document.documentElement.lang)
      } catch (error) {
        void error
      }
      try {
        candidates.push(navigator.language)
      } catch (error) {
        void error
      }
      for (var i = 0; i < candidates.length; i++) {
        if (/^zh/i.test(String(candidates[i] || ''))) return 'zh'
      }
      return 'en'
    }

    function createTranslator(localeService) {
      var lang = 'en'
      try {
        if (localeService && typeof localeService.register === 'function') {
          localeService.register(NS, DICTS)
        }
      } catch (error) {
        void error
      }
      function refresh() {
        lang = detectLang(localeService)
      }
      refresh()
      var t = function (key) {
        return DICTS[lang][key] || DICTS.en[key] || key
      }
      t.refresh = refresh
      return t
    }

    function apply(ctx) {
      if (typeof document === 'undefined' || typeof window === 'undefined') return

      // Claim the sidebar before touching the DOM. A second apply takes over
      // instead of stacking: the run that already owns the sidebar is torn down
      // first, so a hot reload swaps the bar in place and never leaves stale
      // buttons or html attributes behind.
      var owner = { alive: true, teardown: null }
      try {
        var current = window[OWNER_KEY]
        if (current && current.alive) {
          try {
            if (typeof current.teardown === 'function') current.teardown()
          } catch (error) {
            void error
          }
          current.alive = false
        }
        window[OWNER_KEY] = owner
      } catch (error) {
        void error
      }

      var html = document.documentElement
      var localeService = null
      try {
        localeService = ctx.locale
      } catch (error) {
        localeService = null
      }
      if (!localeService) localeService = safeGet(ctx, 'locale')
      var t = createTranslator(localeService)

      var config = { controller: null, values: assign({}, DEFAULTS), local: false }
      var runtime = {
        disposed: false,
        // `mode` in the profile is the startup default. Picking a layout from
        // the bar is session-only and must never rewrite the config form.
        sessionMode: null,
        configMode: null,
        bar: null,
        root: null,
        nav: null,
        regionArea: null,
        popOpen: false,
        rail: false,
        railSaved: null,
        hidden: { ext: false, ws: false },
        observedRoot: null,
        resizeObserver: null,
        mutationObserver: null,
        raf: 0,
      }

      var manualCleanups = []

      // Register a resource and its disposal through the host context when it
      // offers one; otherwise keep the disposer for the end of this run.
      function effect(fn, label) {
        var disposer = null
        try {
          if (typeof ctx.effect === 'function') {
            ctx.effect(fn, label)
            return
          }
        } catch (error) {
          void error
        }
        try {
          disposer = fn()
        } catch (error) {
          void error
        }
        if (typeof disposer === 'function') manualCleanups.push(disposer)
      }

      function setFlag(element, name, on) {
        if (!element) return
        if (on) element.setAttribute(name, 'true')
        else element.removeAttribute(name)
      }

      // ---- markup -------------------------------------------------------

      function makeButton(key, labelKey, hintKey, onClick) {
        var button = document.createElement('button')
        button.type = 'button'
        button.setAttribute('data-dsbs-btn', key)
        if (labelKey) button.setAttribute('data-dsbs-label', labelKey)
        if (hintKey) button.setAttribute('data-dsbs-hint', hintKey)
        if (labelKey) button.textContent = t(labelKey)
        if (hintKey) button.title = t(hintKey)
        button.addEventListener('click', function (event) {
          event.preventDefault()
          event.stopPropagation()
          onClick(event)
        })
        return button
      }

      function makeSeparator() {
        var separator = document.createElement('span')
        separator.setAttribute('data-dsbs-sep', '')
        separator.setAttribute('aria-hidden', 'true')
        return separator
      }

      // One row of plain text buttons, the shape the bar had in its first
      // version: the filled button is the chosen layout, and everything after
      // the divider names the action its click performs in that layout.
      function buildBar() {
        var bar = document.createElement('div')
        bar.setAttribute('data-dsbs-bar', '')
        bar.setAttribute('role', 'toolbar')

        var i
        for (i = 0; i < MODES.length; i++) {
          var mode = MODES[i]
          bar.appendChild(makeButton('mode-' + mode, 'mode.' + mode, 'mode.' + mode + '.hint', (function (value) {
            return function () { setMode(value) }
          })(mode)))
        }

        var separator = makeSeparator()
        bar.appendChild(separator)

        var foldExt = makeButton('fold-ext', 'fold.ext.collapse', 'fold.ext.hint', function () { setField('foldExt', !config.values.foldExt) })
        var foldWs = makeButton('fold-ws', 'fold.ws.collapse', 'fold.ws.hint', function () { setField('foldWs', !config.values.foldWs) })
        var tabSwap = makeButton('tab-swap', 'tab.to.ws', 'tab.to.ws.hint', function () {
          setField('tab', config.values.tab === 'ext' ? 'ws' : 'ext')
        })
        var pop = makeButton('pop', 'pop.open', 'pop.hint', function () {
          runtime.popOpen = !runtime.popOpen
          scheduleSync()
        })
        pop.setAttribute('aria-expanded', 'false')
        var quick = makeButton('quick', 'quick.label', 'quick.hint', function () {
          var index = MODES.indexOf(config.values.mode)
          setMode(MODES[(index + 1) % MODES.length])
        })

        bar.appendChild(foldExt)
        bar.appendChild(foldWs)
        bar.appendChild(tabSwap)
        bar.appendChild(pop)
        bar.appendChild(quick)

        runtime.parts = { separator: separator, context: [foldExt, foldWs, tabSwap, pop] }
        return bar
      }

      function ensureBar(fx) {
        var bar = runtime.bar
        if (bar && bar.parentNode !== fx.root) {
          try {
            bar.parentNode.removeChild(bar)
          } catch (error) {
            void error
          }
          bar = null
        }
        if (!bar) {
          bar = buildBar()
          runtime.bar = bar
        }
        var anchor = fx.nav || fx.regionArea
        if (anchor && anchor.parentNode === fx.root) {
          if (bar.nextSibling !== anchor) fx.root.insertBefore(bar, anchor)
        } else if (bar.parentNode !== fx.root) {
          fx.root.appendChild(bar)
        }
        return bar
      }

      function barButton(key) {
        if (!runtime.bar) return null
        return runtime.bar.querySelector('[data-dsbs-btn="' + key + '"]')
      }

      function setVisible(key, visible) {
        var button = barButton(key)
        if (!button) return
        if (visible) button.removeAttribute('hidden')
        else button.setAttribute('hidden', '')
      }

      function relabel() {
        if (!runtime.bar) return
        var nodes = runtime.bar.querySelectorAll('[data-dsbs-label]')
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i]
          var labelKey = node.getAttribute('data-dsbs-label')
          var hintKey = node.getAttribute('data-dsbs-hint')
          // Rewriting unchanged text on every sync would drop focus from a
          // button reached with the keyboard, so only touch what changed.
          if (labelKey) {
            var label = t(labelKey)
            if (node.textContent !== label) node.textContent = label
          }
          if (hintKey) {
            var hint = t(hintKey)
            if (node.title !== hint) node.title = hint
          }
        }
        var barLabel = t('bar.label')
        if (runtime.bar.getAttribute('aria-label') !== barLabel) {
          runtime.bar.setAttribute('aria-label', barLabel)
        }
      }

      // ---- visible state ------------------------------------------------

      function closeOpenOverlays(element) {
        try {
          var open = element.querySelector('dialog[open], [role="menu"][data-state="open"], [data-state="open"]')
          if (!open) return
          open.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        } catch (error) {
          void error
        }
      }

      function setGroupHidden(element, group, hidden) {
        if (!element) return
        var was = runtime.hidden[group] === true
        if (hidden) {
          if (!was) closeOpenOverlays(element)
          element.setAttribute('aria-hidden', 'true')
          element.setAttribute('inert', '')
        } else {
          element.removeAttribute('aria-hidden')
          element.removeAttribute('inert')
        }
        if (was === hidden) return
        runtime.hidden[group] = hidden
        if (!hidden) {
          // Panels and menus position themselves from measured geometry; they
          // were hidden while that was measured, so ask them to measure again.
          try {
            window.dispatchEvent(new Event('resize'))
          } catch (error) {
            void error
          }
        }
      }

      function positionPop(fx) {
        if (!fx || !fx.root || !runtime.bar) return
        // Only the overlay is positioned; skip the two rect reads otherwise so
        // the heartbeat stays cheap.
        if (config.values.mode !== 'c' || !runtime.popOpen) return
        try {
          var rootRect = fx.root.getBoundingClientRect()
          var barRect = runtime.bar.getBoundingClientRect()
          var top = Math.round(barRect.bottom - rootRect.top + 4)
          if (!isFinite(top) || top < 0) top = 0
          fx.root.style.setProperty('--dsbs-pop-top', top + 'px')
        } catch (error) {
          void error
        }
      }

      function paint() {
        if (runtime.disposed) return
        var state = config.values
        html.setAttribute('data-dsbs-mode', state.mode)
        html.setAttribute('data-dsbs-tab', state.tab)
        html.setAttribute('data-dsbs-quick', state.showQuickSwitch ? 'on' : 'off')
        setFlag(html, 'data-dsbs-fold-ext', state.foldExt === true)
        setFlag(html, 'data-dsbs-fold-ws', state.foldWs === true)
        setFlag(html, 'data-dsbs-pop', runtime.popOpen && state.mode === 'c')
        setFlag(html, 'data-dsbs-rail', runtime.rail)

        var fx = resolveSidebar()
        runtime.root = fx ? fx.root : null
        runtime.nav = fx ? fx.nav : null
        runtime.regionArea = fx ? fx.regionArea : null
        if (!fx) return

        if (fx.nav && !fx.nav.hasAttribute('data-dsbs-ext')) fx.nav.setAttribute('data-dsbs-ext', '')
        ensureBar(fx)
        // Bars left behind by an earlier client generation are dead weight and
        // read as a duplicated control; keep exactly one.
        var strayBars = document.querySelectorAll('[data-dsbs-bar]')
        for (var b = 0; b < strayBars.length; b++) {
          if (strayBars[b] === runtime.bar) continue
          if (strayBars[b].parentNode) strayBars[b].parentNode.removeChild(strayBars[b])
        }

        // With no panels to show, the buttons that act on that group are
        // pointless, and hiding the workspaces would leave an empty column.
        var hasExt = !!fx.nav
        var showFold = state.mode === 'a'
        var showTabs = state.mode === 'b'
        var showPop = state.mode === 'c'
        setVisible('fold-ext', showFold && hasExt)
        setVisible('fold-ws', showFold)
        setVisible('tab-swap', showTabs && hasExt)
        setVisible('pop', showPop && hasExt)
        setVisible('quick', state.showQuickSwitch === true)

        // The label states what the click will do, so "收起扩展" and "展开扩展"
        // never coexist with a stale state.
        var foldExtButton = barButton('fold-ext')
        if (foldExtButton) foldExtButton.setAttribute('data-dsbs-label', state.foldExt ? 'fold.ext.expand' : 'fold.ext.collapse')
        var foldWsButton = barButton('fold-ws')
        if (foldWsButton) foldWsButton.setAttribute('data-dsbs-label', state.foldWs ? 'fold.ws.expand' : 'fold.ws.collapse')
        var popButton = barButton('pop')
        if (popButton) popButton.setAttribute('data-dsbs-label', runtime.popOpen && showPop ? 'pop.close' : 'pop.open')
        var tabSwapButton = barButton('tab-swap')
        if (tabSwapButton) {
          tabSwapButton.setAttribute('data-dsbs-label', state.tab === 'ext' ? 'tab.to.ws' : 'tab.to.ext')
          tabSwapButton.setAttribute('data-dsbs-hint', state.tab === 'ext' ? 'tab.to.ws.hint' : 'tab.to.ext.hint')
        }

        // The divider only makes sense while at least one action button is
        // visible; an empty layout (no panels) can leave nothing after it.
        var parts = runtime.parts
        if (parts) {
          var visibleContext = 0
          for (var c = 0; c < parts.context.length; c++) {
            if (!parts.context[c].hasAttribute('hidden')) visibleContext++
          }
          if (visibleContext > 0) parts.separator.removeAttribute('hidden')
          else parts.separator.setAttribute('hidden', '')
        }

        relabel()

        var i
        for (i = 0; i < MODES.length; i++) {
          var modeButton = barButton('mode-' + MODES[i])
          if (modeButton) modeButton.setAttribute('aria-pressed', state.mode === MODES[i] ? 'true' : 'false')
        }
        if (foldExtButton) foldExtButton.setAttribute('aria-expanded', state.foldExt ? 'false' : 'true')
        if (foldWsButton) foldWsButton.setAttribute('aria-expanded', state.foldWs ? 'false' : 'true')
        if (popButton) {
          popButton.setAttribute('aria-expanded', runtime.popOpen && showPop ? 'true' : 'false')
        }
        if (runtime.bar) {
          runtime.bar.title = config.local ? t('bar.local') : t('bar.label')
          runtime.bar.setAttribute('aria-label', t('bar.label'))
        }

        var extHidden
        var wsHidden
        if (state.mode === 'a') {
          extHidden = state.foldExt === true
          wsHidden = state.foldWs === true
        } else if (state.mode === 'b') {
          extHidden = state.tab !== 'ext'
          // No panels: keep the workspaces visible rather than the empty half.
          wsHidden = hasExt && state.tab === 'ext'
        } else {
          extHidden = !runtime.popOpen
          wsHidden = false
        }
        setGroupHidden(fx.nav, 'ext', extHidden)
        setGroupHidden(fx.regionArea, 'ws', wsHidden)

        observeRoot(fx.root)
        positionPop(fx)
      }

      // ---- state changes ------------------------------------------------

      function setMode(mode) {
        if (MODES.indexOf(mode) < 0) return
        if (mode !== 'c' && runtime.popOpen) runtime.popOpen = false
        runtime.sessionMode = mode
        setField('mode', mode)
      }

      function setField(field, value) {
        var patch = {}
        patch[field] = value
        config.values = assign({}, config.values, patch)

        // `mode` is the startup default: keep it out of both the config form
        // and localStorage, so an in-session pick lives only until reload.
        // The other fields (tab / folds) still persist as before.
        if (field !== 'mode') {
          if (config.controller && typeof config.controller.mutate === 'function') {
            var revision
            try {
              var snapshot = config.controller.getSnapshot()
              revision = snapshot && snapshot.revision
            } catch (error) {
              revision = undefined
            }
            var ops = [{ op: 'set', path: [field], value: value }]
            try {
              var result = config.controller.mutate(ops, revision)
              if (result && typeof result.catch === 'function') result.catch(function () {})
            } catch (error) {
              void error
            }
          } else {
            var stored = assign({}, DEFAULTS, readLocal())
            stored[field] = value
            writeLocal(stored)
            config.local = true
          }
        }
        scheduleSync()
      }

      // ---- observation --------------------------------------------------

      function measureRail(fx) {
        var root = (fx && fx.root) || runtime.root
        if (!root) return
        var width = 0
        try {
          width = root.getBoundingClientRect().width
        } catch (error) {
          width = 0
        }
        var rail = width > 0 && width < 100
        // Below this width the bar cannot hold a full row once the cycle icon
        // is included, and a wrapped icon on its own line reads as debris.
        var narrow = width > 0 && width < 300
        if (narrow !== runtime.narrow) {
          runtime.narrow = narrow
          setFlag(html, 'data-dsbs-narrow', narrow)
        }
        if (rail === runtime.rail) return
        runtime.rail = rail
        if (rail) {
          runtime.railSaved = {
            mode: config.values.mode,
            tab: config.values.tab,
            foldExt: config.values.foldExt,
            foldWs: config.values.foldWs,
          }
        } else if (runtime.railSaved) {
          // Leaving the rail restores what the user had before the column was
          // squeezed; the bar is not reachable while the rail is showing.
          config.values = assign({}, config.values, runtime.railSaved)
          runtime.railSaved = null
        }
      }

      var pending = false
      function scheduleSync() {
        if (runtime.disposed || pending) return
        pending = true
        Promise.resolve().then(function () {
          pending = false
          if (!runtime.disposed) sync()
        })
      }

      function sync() {
        if (runtime.disposed) return
        var fx = resolveSidebar()
        measureRail(fx)
        paint()
      }

      function observeRoot(root) {
        if (!root || runtime.observedRoot === root) return
        if (runtime.resizeObserver) {
          try {
            runtime.resizeObserver.disconnect()
          } catch (error) {
            void error
          }
        }
        if (runtime.mutationObserver) {
          try {
            runtime.mutationObserver.disconnect()
          } catch (error) {
            void error
          }
        }
        runtime.observedRoot = root
        if (typeof ResizeObserver === 'function') {
          if (!runtime.resizeObserver) {
            runtime.resizeObserver = new ResizeObserver(function () { scheduleSync() })
          }
          try {
            runtime.resizeObserver.observe(root)
          } catch (error) {
            void error
          }
        }
        if (typeof MutationObserver === 'function') {
          if (!runtime.mutationObserver) {
            runtime.mutationObserver = new MutationObserver(function () { scheduleSync() })
          }
          try {
            // Only the root's own child list: React rebuilds the groups there,
            // and watching anything wider would turn every keystroke into work.
            runtime.mutationObserver.observe(root, { childList: true })
          } catch (error) {
            void error
          }
        }
      }

      // ---- configuration -------------------------------------------------

      function syncFromController() {
        if (!config.controller) return
        var snapshot = null
        try {
          snapshot = config.controller.getSnapshot()
        } catch (error) {
          snapshot = null
        }
        if (!snapshot || typeof snapshot !== 'object') return
        var next = adoptValues(snapshot.value)
        // The config form owns the startup default. A push caused by another
        // field must not undo the mode picked in this session; but a genuine
        // external change (settings page or cordis.patch.yml) wins and becomes
        // the new default for the next launch.
        if (runtime.configMode === null) {
          runtime.configMode = next.mode
        } else if (next.mode !== runtime.configMode) {
          runtime.configMode = next.mode
          runtime.sessionMode = null
        } else if (runtime.sessionMode) {
          next.mode = runtime.sessionMode
        }
        config.values = next
        config.local = false
      }

      function tryAdopt(service) {
        if (!service || typeof service.get !== 'function') return false
        if (config.controller) return true
        var controller = null
        try {
          controller = service.get(ENTRY)
        } catch (error) {
          controller = null
        }
        if (!controller) return false
        config.controller = controller
        config.local = false
        syncFromController()
        var off = null
        try {
          if (typeof controller.subscribe === 'function') {
            off = controller.subscribe(function () {
              syncFromController()
              scheduleSync()
            })
          }
        } catch (error) {
          void error
        }
        effect(function () {
          return function () {
            if (typeof off !== 'function') return
            try {
              off()
            } catch (error) {
              void error
            }
          }
        }, 'sidebar-suite: config subscription')
        scheduleSync()
        return true
      }

      function fallbackToLocal() {
        if (config.controller) return
        config.local = true
        config.values = adoptValues(readLocal())
        scheduleSync()
      }

      // ---- plugin detail page: graphical default-mode picker -------------

      function configController() {
        if (config.controller) return config.controller
        try {
          var service = safeGet(ctx, 'configForms')
          if (service && typeof service.get === 'function') return service.get(ENTRY)
        } catch (error) {
          void error
        }
        return null
      }

      function readDefaultMode() {
        var controller = configController()
        try {
          var snapshot = controller && controller.getSnapshot && controller.getSnapshot()
          var value = snapshot && snapshot.value
          return MODES.indexOf(value && value.mode) >= 0 ? value.mode : DEFAULTS.mode
        } catch (error) {
          return DEFAULTS.mode
        }
      }

      function writeDefaultMode(mode) {
        if (MODES.indexOf(mode) < 0) return false
        var controller = configController()
        if (!controller || typeof controller.mutate !== 'function') return false
        try {
          var snapshot = controller.getSnapshot && controller.getSnapshot()
          var result = controller.mutate(
            [{ op: 'set', path: ['mode'], value: mode }],
            snapshot && snapshot.revision
          )
          if (result && typeof result.catch === 'function') result.catch(function () {})
          // The settings page and the sidebar share this client run, so adopt
          // the new default immediately instead of waiting for a config push.
          runtime.sessionMode = null
          runtime.configMode = mode
          config.values = assign({}, config.values, { mode: mode })
          if (runtime.popOpen && mode !== 'c') runtime.popOpen = false
          scheduleSync()
          return true
        } catch (error) {
          return false
        }
      }

      // The Host serves images that sit beside a bundle's detail document.
      // This is the same URL the Plugin Manager's own markdown renderer uses,
      // so the small QR in the pinned settings card needs no base64 payload.
      function supportQrUrl() {
        try {
          if (typeof document === 'undefined' || !document.baseURI) return ''
          var query = 'bundle=' + encodeURIComponent(ENTRY) +
            '&document=' + encodeURIComponent('DETAIL.md') +
            '&path=' + encodeURIComponent('assets/wechat-qr.png')
          return new URL('api/plugin-manager/detail-file?' + query, document.baseURI).href
        } catch (error) {
          return ''
        }
      }

      // `plugins.bundle.config` is the keyed slot the Plugin Manager declares
      // for a bundle's own configuration page. The component reads and writes
      // the same configForms controller as the sidebar, so a click here becomes
      // the new startup default and the sidebar follows it immediately.
      function makeModePicker(h, ReactLib) {
        var box = function (extra) {
          return h('span', { style: assign({
            display: 'block', borderRadius: '2px',
            background: 'var(--dsw-alias-label-tertiary,rgba(127,127,127,.5))'
          }, extra || {}) })
        }
        var frame = function (extra, first, second) {
          return h('span', { style: assign({
            display: 'flex', flexDirection: 'column', width: '36px', height: '24px',
            padding: '2px', gap: '2px', boxSizing: 'border-box', position: 'relative',
            borderRadius: '4px',
            border: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3))'
          }, extra || {}) }, first || null, second || null)
        }
        function mini(mode) {
          if (mode === 'a') {
            return frame(null, box({ width: '100%', height: '7px' }), box({ width: '100%', height: '7px' }))
          }
          if (mode === 'b') {
            return frame(null, box({ width: '60%', height: '4px' }), box({ width: '100%', height: '11px' }))
          }
          return frame(null,
            box({ width: '100%', height: '100%', opacity: '0.35' }),
            box({
              position: 'absolute', left: '9px', top: '5px', width: '18px', height: '13px',
              background: 'var(--dsw-alias-label-primary,currentColor)', opacity: '0.85',
              boxShadow: '0 2px 6px rgba(0,0,0,.28)'
            })
          )
        }

        return function ModePicker() {
          var state = ReactLib.useState(readDefaultMode())
          var mode = state[0]
          var setMode = state[1]
          ReactLib.useEffect(function () {
            var controller = configController()
            if (!controller || typeof controller.subscribe !== 'function') return
            var off = null
            try {
              off = controller.subscribe(function () { setMode(readDefaultMode()) })
            } catch (error) {
              void error
            }
            return function () {
              try { if (typeof off === 'function') off() } catch (error) { void error }
            }
          }, [])

          var available = !!configController()
          var cardBase = {
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '5px',
            flex: '1 1 140px', minWidth: '140px', maxWidth: '230px', padding: '10px',
            borderRadius: '10px', font: 'inherit', textAlign: 'left', cursor: 'pointer',
            color: 'var(--dsw-alias-label-primary,inherit)',
            border: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3))',
            background: 'transparent'
          }
          return h('div', { 'data-dsbs-config': ENTRY, style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            h('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--dsw-alias-label-primary,inherit)' } }, t('settings.title')),
            h('div', { style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary,inherit)' } }, t('settings.help')),
            h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
              MODES.map(function (value) {
                var active = value === mode
                return h('button', {
                  key: value, type: 'button',
                  'aria-pressed': active ? 'true' : 'false',
                  title: t('mode.' + value + '.hint'),
                  disabled: !available,
                  style: assign({}, cardBase, active ? {
                    borderColor: 'var(--dsw-alias-label-primary,currentColor)',
                    background: 'var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.22))'
                  } : {}),
                  onClick: function () {
                    if (writeDefaultMode(value)) setMode(value)
                  }
                },
                  mini(value),
                  h('span', { style: { fontSize: '12px', fontWeight: active ? '600' : '400' } },
                    t('mode.' + value) + (active ? ' · ' + t('settings.current') : '')),
                  h('span', { style: { fontSize: '11px', lineHeight: '15px', color: 'var(--dsw-alias-label-secondary,inherit)' } },
                    t('mode.' + value + '.hint'))
                )
              })
            ),
            available ? null : h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary,inherit)' } }, t('settings.unavailable')),
            h('div', { 'data-dsbs-support': ENTRY },
              supportQrUrl() ? h('img', {
                src: supportQrUrl(),
                alt: t('settings.qrAlt'),
                onError: function (event) {
                  try { event.currentTarget.style.display = 'none' } catch (error) { void error }
                }
              }) : null,
              h('div', { 'data-dsbs-support-text': ENTRY },
                h('div', { style: { fontSize: '12px', fontWeight: '600', color: 'var(--dsw-alias-label-primary,inherit)' } }, t('settings.support')),
                h('div', { style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary,inherit)' } }, t('settings.supportHint'))
              )
            )
          )
        }
      }

      // Register only when React and the slots service are both available.
      // Any failure here is contained: the sidebar control bar is unaffected.
      if (React && React.createElement && React.useState && React.useEffect && typeof ctx.inject === 'function') {
        try {
          ctx.inject(['slots'], function (scope) {
            var slots = scope && scope.slots
            if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return
            try {
              slots.inject('plugins.bundle.config', function () {
                return slots.register({
                  name: 'plugins.bundle.config',
                  key: ENTRY,
                  order: 0,
                }, makeModePicker(React.createElement, React))
              })
            } catch (error) {
              void error
            }
          })
        } catch (error) {
          void error
        }
      }

      // ---- wiring -------------------------------------------------------

      effect(function () {
        var existing = document.getElementById(STYLE_ID)
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
        var style = document.createElement('style')
        style.id = STYLE_ID
        style.setAttribute('data-plugin', ENTRY)
        style.textContent = CSS
        ;(document.head || document.documentElement).appendChild(style)
        return function () {
          if (style.parentNode) style.parentNode.removeChild(style)
        }
      }, 'sidebar-suite: styles')

      effect(function () {
        if (!localeService || typeof localeService.subscribe !== 'function') return
        var off = localeService.subscribe(function () {
          t.refresh()
          relabel()
          scheduleSync()
        })
        return function () {
          try {
            off()
          } catch (error) {
            void error
          }
        }
      }, 'sidebar-suite: locale')

      effect(function () {
        var stopped = false
        var timer = null

        function attempt() {
          if (stopped) return true
          if (tryAdopt(safeGet(ctx, 'configForms'))) return true
          return false
        }

        try {
          if (typeof ctx.inject === 'function') {
            ctx.inject(['configForms'], function (scope) {
              if (stopped) return
              try {
                tryAdopt(scope && scope.configForms)
              } catch (error) {
                void error
              }
            })
          }
        } catch (error) {
          void error
        }

        if (attempt()) return function () { stopped = true }

        // The client's config service may come up after this plugin: retry for
        // ten seconds, then fall back to device-local storage.
        var tries = 0
        timer = setInterval(function () {
          tries += 1
          if (attempt() || tries > 40) {
            clearInterval(timer)
            timer = null
            if (!config.controller) fallbackToLocal()
          }
        }, 250)
        if (timer && typeof timer.unref === 'function') timer.unref()

        return function () {
          stopped = true
          if (timer) {
            clearInterval(timer)
            timer = null
          }
        }
      }, 'sidebar-suite: configuration')

      effect(function () {
        var onPointerDown = function (event) {
          if (config.values.mode !== 'c' || !runtime.popOpen) return
          var target = event.target
          if (!target) return
          if (runtime.bar && runtime.bar.contains(target)) return
          if (runtime.nav && runtime.nav.contains(target)) return
          runtime.popOpen = false
          scheduleSync()
        }
        var onKeyDown = function (event) {
          if (event.key !== 'Escape' || !runtime.popOpen) return
          runtime.popOpen = false
          // Esc must hand focus back to the trigger, or the next Tab starts
          // from wherever the pointer last landed.
          var trigger = barButton('pop')
          if (trigger && typeof trigger.focus === 'function') trigger.focus()
          scheduleSync()
        }
        var onResize = function () {
          scheduleSync()
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('resize', onResize)
        return function () {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('resize', onResize)
        }
      }, 'sidebar-suite: dismissal')

      effect(function () {
        // Safety net: the sidebar root is created and destroyed by the host, so
        // a root replacement is invisible to an observer that watches the old
        // root's children. A slow heartbeat re-resolves it (one query and one
        // rect read) and is skipped while the page is hidden.
        var timer = setInterval(function () {
          if (typeof document.hidden === 'boolean' && document.hidden) return
          sync()
        }, 1500)
        if (timer && typeof timer.unref === 'function') timer.unref()
        sync()
        return function () {
          clearInterval(timer)
        }
      }, 'sidebar-suite: sync')

      var teardown = null
      effect(function () {
        teardown = function () {
          if (runtime.disposed) return
          runtime.disposed = true
          try {
            if (runtime.bar && runtime.bar.parentNode) runtime.bar.parentNode.removeChild(runtime.bar)
          } catch (error) {
            void error
          }
          try {
            if (window[OWNER_KEY] === owner) delete window[OWNER_KEY]
          } catch (error) {
            void error
          }
          try {
            if (runtime.root) runtime.root.style.removeProperty('--dsbs-pop-top')
          } catch (error) {
            void error
          }
          try {
            if (runtime.nav) runtime.nav.removeAttribute('data-dsbs-ext')
          } catch (error) {
            void error
          }
          try {
            if (runtime.nav) {
              runtime.nav.removeAttribute('aria-hidden')
              runtime.nav.removeAttribute('inert')
            }
            if (runtime.regionArea) {
              runtime.regionArea.removeAttribute('aria-hidden')
              runtime.regionArea.removeAttribute('inert')
            }
          } catch (error) {
            void error
          }
          var attributes = [
            'data-dsbs-mode',
            'data-dsbs-tab',
            'data-dsbs-fold-ext',
            'data-dsbs-fold-ws',
            'data-dsbs-pop',
            'data-dsbs-quick',
            'data-dsbs-rail',
            'data-dsbs-narrow',
          ]
          for (var i = 0; i < attributes.length; i++) {
            html.removeAttribute(attributes[i])
          }
          try {
            if (runtime.resizeObserver) runtime.resizeObserver.disconnect()
            if (runtime.mutationObserver) runtime.mutationObserver.disconnect()
          } catch (error) {
            void error
          }
          runtime.bar = null
          runtime.root = null
          runtime.observedRoot = null
          for (var j = 0; j < manualCleanups.length; j++) {
            try {
              manualCleanups[j]()
            } catch (error) {
              void error
            }
          }
          manualCleanups.length = 0
        }
        return teardown
      }, 'sidebar-suite: teardown')
      owner.teardown = teardown
    }

    return { inject: ['locale'], apply: apply }
  },
})

