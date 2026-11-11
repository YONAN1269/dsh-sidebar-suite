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
// All layout state lives in attributes on <html>, and the host's markup is
// never restructured or moved: this plugin only ADDS one control bar as a
// direct child of the sidebar root, one Temp button as a sibling of the host's
// New Session button, and (on demand) a temporary-chat dialog + scrim on body.
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-suite',
  factory(require) {
    'use strict'

    var ENTRY = 'dsh-sidebar-suite'
    // Reported to tab consumers so they can feature-detect. Kept in lockstep
    // with package.json by tests/test_030.mjs.
    var VERSION = '0.3.0'
    var NS = 'sidebar-suite'
    var LS_KEY = 'dsh-sidebar-suite:state'
    // Where the third-party tab choice lives. Kept out of LS_KEY on purpose:
    // the config form describes the sidebar, this describes the user's
    // current position inside it, and the two have different lifetimes.
    var TAB_STORE_KEY = 'dsh-sidebar-suite:active-tab'
    var STYLE_ID = 'dsh-sidebar-suite-style'
    // Where feedback goes. A plugin bundle cannot open a mail client or post a
    // form without a server, so the entry point assembles a ready-to-send
    // report and offers the three channels that need no backend:
    //   1. a pre-filled GitHub issue in THIS repository (the desktop shell opens
    //      http(s) links in the system browser — app.asar lib/main.js
    //      setWindowOpenHandler),
    //   2. the marketplace's own comment thread. dsh-market keys every plugin's
    //      thread on `plugin:<owner/repo>` inside the public catalog repo
    //      (verified in dshmarket/client/client.js: GISCUS.repo, commentsTerm).
    //      It is the feedback entry the plugin market actually defines, so the
    //      detail page links to it instead of inventing a fourth channel,
    //   3. copy to clipboard, for anyone who does not use GitHub.
    var FEEDBACK_REPO = 'https://github.com/YONAN1269/dsh-sidebar-suite'
    var FEEDBACK_DRAFT_KEY = 'dsh-sidebar-suite:feedback-draft'
    var FEEDBACK_MARKET_TERM = 'plugin:YONAN1269/dsh-sidebar-suite'
    var FEEDBACK_MARKET_URL = 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/discussions'
      + '?discussions_q=' + encodeURIComponent('"' + FEEDBACK_MARKET_TERM + '"')
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
        'tab.ext': 'Panels',
        'tab.ws': 'Workspaces',
        'tabs.label': 'Sidebar pages',
        'tabs.own': 'This page is provided by {name}.',
        'pop.open': 'Open panels',
        'pop.close': 'Close panels',
        'pop.hint': 'Open or close the panels overlay.',
        'settings.title': 'Default layout on startup',
        'settings.help': 'Pick the layout DSH starts with. This writes the plugin config; switching from the sidebar bar is session-only.',
        'settings.unavailable': 'The config service is unavailable right now, so the default cannot be changed here.',
        'settings.current': 'Current default',
        'temp.label': 'Temp',
        'temp.hint': 'Open a temporary session: a real DSH session in this sidebar that is deleted when you quit.',
        'temp.creating': 'Creating…',
        'temp.created': 'Temporary session ready. It lives in the sidebar and is deleted when you quit DSH.',
        'temp.noNative': 'This DSH build did not expose its session navigation service.',
        'temp.failed': 'Could not create the temporary session: ',
        'temp.feedbackHint': 'Report it on the plugin detail page.',
        'temp.restartHint': 'Fully quit DSH (tray icon → Quit) and reopen it — a hot reload does not reload the plugin host.',
        'temp.badge': 'TEMP',
        'policy.title': 'Temporary session cleanup',
        'policy.help': 'Choose when temporary sessions are removed. Defaults: delete on quit = on, daily cleanup = off. Saved to the plugin settings file and applied immediately — no restart.',
        'policy.onQuit': 'Delete when DSH quits',
        'policy.schedule': 'Clean up every day at',
        'policy.on': 'On',
        'policy.off': 'Off',
        'policy.note': 'A session in use right now is skipped and retried 5 minutes later.',
        'policy.saving': 'Saving…',
        'policy.saved': 'Saved',
        'policy.failed': 'Could not save: ',
        'policy.loading': 'Loading current settings…',
        'policy.unavailable': 'Cleanup settings are unavailable — the plugin host did not answer. Fully quit DSH and reopen it.',
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
        'tab.ext': '扩展',
        'tab.ws': '工作区',
        'tabs.label': '侧栏页签',
        'tabs.own': '这一页由 {name} 提供。',
        'pop.open': '展开扩展',
        'pop.close': '收起扩展',
        'pop.hint': '打开或收起扩展浮层。',
        'settings.title': '启动时的默认布局',
        'settings.help': '选择 DSH 启动时使用的布局。这里会写入插件配置；在侧栏上临时切换不会改动它。',
        'settings.unavailable': '配置服务暂时不可用，无法在这里修改默认布局。',
        'settings.current': '当前默认',
        'temp.label': '临时',
        'temp.hint': '开一个临时会话：就是左侧栏里的真实会话，退出 DSH 时删除。',
        'temp.creating': '正在创建…',
        'temp.created': '临时会话已就绪：它在左侧栏里，退出 DSH 时自动删除。',
        'temp.noNative': '当前 DSH 版本没有暴露会话导航服务。',
        'temp.failed': '创建临时会话失败：',
        'temp.feedbackHint': '可在插件详情页反馈。',
        'temp.restartHint': '请从托盘图标彻底退出 DSH 再打开 —— 热重载不会重载插件后端。',
        'temp.badge': '临时',
        'policy.title': '临时会话自动删除',
        'policy.help': '决定临时会话什么时候被清掉。默认：退出 DSH 时删除=开，每天定时清理=关。写入插件设置文件，改完立即生效，不用重启。',
        'policy.onQuit': '退出 DSH 时删除',
        'policy.schedule': '每天定时清理，时间',
        'policy.on': '开',
        'policy.off': '关',
        'policy.note': '正在使用的那个会话会跳过，5 分钟后再试一次。',
        'policy.saving': '保存中…',
        'policy.saved': '已保存',
        'policy.failed': '保存失败：',
        'policy.loading': '正在读取当前设置…',
        'policy.unavailable': '读取不到清理设置 —— 插件后端没有响应。请从托盘彻底退出 DSH 再打开。',
      },
    }

    // The plugin detail page must read well in both languages regardless of
    // the UI locale, so the settings copy is deliberately bilingual in both
    // dictionaries. The long detail document (DETAIL.md) does the same.
    var BILINGUAL_SETTINGS = {
      // Pinned at the top of the plugin detail page: the one-line positioning
      // statement. The Host renders locale/meta.description above the sections,
      // but the settings card is lifted to order:-1, so without this line the
      // first thing a reader sees would be a control with no context.
      // Also pinned: the cleanup defaults, disclosed on the settings card.
      // The catalog maintainer asked for this after PR #13993 was merged.
      'policy.help': '决定临时会话什么时候被清掉。默认：退出 DSH 时删除=开，每天定时清理=关；两个开关互不影响，改完立即生效，不用重启。 / Choose when temporary sessions are removed. Defaults: delete on quit = on, daily cleanup = off; the two switches are independent and apply immediately — no restart.',
      'settings.intro': '一款专门针对改进 DSH 左侧栏体验的插件 —— 强实用性 + 美观性：沿用宿主原生观感，不另起一套皮肤。 / A plugin dedicated to the DSH sidebar experience — seriously practical and good-looking, built from native host design tokens.',
      'settings.title': '启动时的默认布局 · Default layout on startup',
      'settings.help': '选择 DSH 启动时使用的布局，这里会写入插件配置；在侧栏上临时切换只影响本次会话。 / Pick the layout DSH starts with — this writes the plugin config, while switching from the sidebar bar stays session-only.',
      'settings.unavailable': '配置服务暂时不可用，无法在这里修改默认布局。 / The config service is unavailable right now, so the default cannot be changed here.',
      'settings.current': '当前默认 / Current',
      'settings.support': '喜欢这个插件？请作者喝杯咖啡 · Enjoy it? Buy me a coffee',
      'settings.supportHint': '完全自愿，无任何回报承诺。用微信扫一扫即可；「设置 → 支持贡献者」里也登记了同一个码。 / Purely voluntary, no rewards promised. Scan with WeChat Pay; the same QR is registered under Settings → Support contributors.',
      'settings.qrAlt': '微信支付收款码 / WeChat Pay QR',
      // 0.2.8 — every remaining config key becomes a switch on this page.
      'options.title': '侧栏与临时会话 · Sidebar & temp session options',
      'options.help': '每一项都会写入 temp-session-config.txt。也可以直接用记事本改那个文件，保存后约 3 秒自动生效，不用重启 DSH；两边是同一个文件，不会打架。 / Every switch writes temp-session-config.txt. You can also edit that file in Notepad — saves apply in about 3 seconds, no restart. Both paths share one file so they never disagree.',
      'options.showButton': '显示「临时」按钮 / Show the Temp button',
      'options.inChatMode': 'CHAT 官网模式 / In CHAT mode',
      'options.chatHide': '隐藏按钮 / Hide',
      'options.chatShow': '照常显示 / Show',
      'options.buttonStyle': '按钮摆法 / Button layout',
      'options.stylePair': '并排 / Pair',
      'options.styleOwn': '独占一行 / Own row',
      'options.expandAll': '会话默认全展开 / Always expand sessions',
      'options.expandHint': '关掉后恢复 DSH 原来的折叠行为；已经展开的列表要切换一次工作区才会收回去。 / Turning it off restores host folding; already-expanded groups collapse after you switch workspaces once.',
      'options.maxKept': '最多保留 / Keep at most',
      'options.maxKeptHint': '个临时会话（1–200） / temp sessions (1–200)',
      'options.purge': '立即清理临时会话 / Clean up now',
      'options.purging': '清理中… / Cleaning…',
      'options.purged': '已清理 / Removed ',
      'options.purgeFailed': '清理失败 / Cleanup failed: ',
      'options.rev': '设置版本 / Settings rev',
      'feedback.title': '反馈 · Feedback',
      'feedback.help': '遇到问题，或者想要某个功能？写在下面，然后选一个入口。 / Hit a bug or want a feature? Write it below, then pick a channel.',
      'feedback.placeholder': '例如：点了「临时」之后，侧栏没有出现新会话…… / e.g. clicking Temp adds no session to the sidebar…',
      'feedback.copy': '复制反馈内容 / Copy report',
      'feedback.issue': '在 GitHub 提 issue / Open an issue',
      'feedback.market': '插件市场评论区 / Marketplace comments',
      'feedback.working': '正在准备… / Preparing…',
      'feedback.copied': '已复制，粘贴发送即可 / Copied — paste and send',
      'feedback.issueOpened': '已在浏览器打开 / Opened in your browser',
      'feedback.failed': '复制被浏览器拒绝了，请手动选中再复制 / The browser blocked the copy — select and copy manually',
      'feedback.hint': '报告会自动带上版本、系统、布局和最近一次错误，不用再补一遍环境信息。 / The report already includes your version, OS, layout and last error.',
      'feedback.where': '作者在哪收到：issue 进本仓库的 Issues（仓库所有者默认会收到通知）；市场评论进 awesome-dsh-plugin 仓库的 Discussions（作者需要 watch 那条讨论）；「复制反馈内容」不会自动发送，粘到微信 / QQ / 邮件都行。 / Where the author sees it: issues land in this repo (the owner is normally notified); marketplace comments land in the awesome-dsh-plugin Discussions (the author must watch that thread); copied text is never sent automatically — paste it anywhere you can reach me.',
      'feedback.marketHint': '市场评论区如果显示「没有匹配的讨论」，说明还没人留言：回 DSH 的插件市场，找到 dsh-sidebar-suite 卡片点「评论」，第一条留言会自动建帖。 / If GitHub says there are no matching discussions yet, open the plugin market in DSH, find the dsh-sidebar-suite card and press "评论 / Comments" — the first comment creates that thread.',
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
      // Feedback box (0.2.3). The element itself is styled inline so it still
      // looks right if this stylesheet is ever blocked; these three rules only
      // cover what inline styles cannot express.
      '[data-plugin-detail="dsh-sidebar-suite"] [data-dsbs-feedback]{width:100%;box-sizing:border-box}',
      '[data-plugin-detail="dsh-sidebar-suite"] [data-dsbs-feedback] textarea::placeholder{color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.75))}',
      '[data-plugin-detail="dsh-sidebar-suite"] [data-dsbs-feedback] textarea:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,currentColor);outline-offset:1px}',
      // ---- always-expanded session list (0.2.4) -----------------------
      // The host workspace browser renders one overflow button per group as
      // <button data-row-key="overflow:<group>"> when its 5-row watermark
      // hides the rest (verified in @deepseek-ai/dsh-client-ui-workspace:
      // "sessions.expand" / "展开其余 {n} 个会话"). We drive that button until
      // every group is expanded, then hide it: with all sessions visible the
      // "收起" half of the control is pointless too. Only active while the
      // config says on, so EXPAND_ALL_SESSIONS=off restores the host's UI.
      'html[data-dsbs-expand-all="true"] button[data-row-key^="overflow:"]{display:none!important}',
      // ---- temporary chat (0.1.7) --------------------------------------
      // The Temp button sits on the same row as the host's "New Session"
      // button. Host markup is never moved: we add one sibling and pull it back
      // onto the previous row with a negative margin, so the net flow height is
      // zero and every following sidebar group keeps its original position.
      // The whole two-button row only applies in HARNESS mode. dsh-deepseek-chat
      // swaps the sidebar for its own website navigation in CHAT mode, where
      // shrinking "new chat" would break the host's own layout, so every rule
      // here is gated on html:not([data-dsbs-chat-mode]).
      'html:not([data-dsbs-chat-mode]) [data-dsbs-newchat] button[class*="newSession"]{height:34px!important;width:calc(100% - 92px)!important;min-width:0!important;flex:0 0 auto!important;margin:0 0 10px!important;font-size:12px!important;line-height:20px!important}',
      'html:not([data-dsbs-chat-mode]) [data-dsbs-newchat] button[class*="newSession"] > span[class*="newSessionShortcut"]{display:none!important}',
      // Escape hatch for layouts that fight the two-button row (e.g. another
      // plugin's header row above the sidebar). TEMP_BUTTON_STYLE=own puts the
      // Temp button on its own full-width row and leaves New Session untouched.
      'html[data-dsbs-temp-style="own"] [data-dsbs-newchat] button[class*="newSession"]{height:38px!important;width:auto!important;font-size:14px!important;line-height:22px!important;margin:0 calc(var(--dsh-sidebar-paint-inset,3px) + 1px) 10px!important}',
      'html[data-dsbs-temp-style="own"] [data-dsbs-newchat] > [data-dsbs-temp-slot]{width:auto!important;align-self:stretch!important;margin:0 calc(var(--dsh-sidebar-paint-inset,3px) + 1px) 10px!important}',
      'html[data-dsbs-temp-style="own"] [data-dsbs-temp-slot] > [data-dsbs-btn="temp"]{width:auto!important;height:32px!important;text-align:center!important}',
      // The Temp button is never a direct child of the sidebar root: it sits in
      // its own <div>. dsh-deepseek-chat walks that root and requires exactly
      // ONE direct <button> child (the host's New Session); a second one makes
      // its sidebar adapter bail out and it paints the "当前侧栏不兼容" notice
      // above the CHAT / HARNESS switcher. The wrapper keeps that count at one.
      '[data-dsbs-newchat] > [data-dsbs-temp-slot]{display:flex;flex:none;align-self:flex-end;box-sizing:border-box;margin:-44px 4px 10px 0;width:80px;z-index:2}',
      '[data-dsbs-temp-slot][hidden]{display:none!important}',
      '[data-dsbs-temp-slot] > [data-dsbs-btn="temp"]{appearance:none;-webkit-appearance:none;box-sizing:border-box;width:100%;height:34px;flex:none;border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-button-elevated-fill,transparent);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px;font-weight:500;line-height:20px;cursor:pointer;user-select:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:6px 8px}',
      '[data-dsbs-temp-slot] > [data-dsbs-btn="temp"]:hover{background:var(--dsw-alias-button-floating-hover,var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12)))}',
      '[data-dsbs-temp-slot] > [data-dsbs-btn="temp"]:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,currentColor);outline-offset:1px}',
      '[data-dsbs-temp-slot] > [data-dsbs-btn="temp"][hidden]{display:none!important}',
      // dsh-deepseek-chat is in CHAT (official website) mode: its sidebar and
      // its own "new chat" button own that space, so the Temp button steps
      // aside instead of fighting it. Switchable via temp-session-config.txt.
      'html[data-dsbs-chat-mode] [data-dsbs-temp-slot]{display:none!important}',
      // In the collapsed rail there is no horizontal room for two buttons.
      'html[data-dsbs-temp-solo="true"] [data-dsbs-temp-slot]{display:none!important}',
      'html[data-dsbs-temp-solo="true"]:not([data-dsbs-chat-mode]) [data-dsbs-newchat] button[class*="newSession"]{width:auto!important;height:38px!important;font-size:14px!important;line-height:22px!important;margin:0 calc(var(--dsh-sidebar-paint-inset,3px) + 1px) 10px!important}',
      // A temporary session is a NORMAL DSH session, so its sidebar row is the
      // host's own row. Nothing is added to the DOM: we tag the row and let CSS
      // draw the badge, which survives every React re-render of the list.
      '[data-row-key^="session:"][data-dsbs-temp-row]::after{content:attr(data-dsbs-temp-badge);margin-left:6px;flex:none;box-sizing:border-box;padding:0 5px;border:1px solid currentColor;border-radius:5px;font-size:10px;line-height:14px;font-weight:500;white-space:nowrap;opacity:.6}',
      // The collapsed rail has no room for a word; the row keeps its own look.
      'html[data-dsbs-rail="true"] [data-dsbs-temp-row]::after{display:none}',
      '[data-dsbs-temp-toast]{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9500;max-width:min(560px,calc(100vw - 40px));box-sizing:border-box;padding:9px 14px;border-radius:10px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base,#1f1f1f));color:var(--dsw-alias-label-primary,inherit);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));box-shadow:0 12px 34px rgba(0,0,0,.34);font:inherit;font-size:12px;line-height:1.6;word-break:break-word}',
      '[data-dsbs-temp-toast][data-dsbs-temp-toast-error="true"]{color:var(--dsw-alias-state-business-danger,#d9534f);border-color:rgba(217,83,79,.45)}',
      // ---- sidebar polish (0.2.9) --------------------------------------
      // The three layout modes are mutually exclusive, so they share one
      // segmented pill; the buttons that belong to the chosen layout sit on
      // the far side of a divider, which keeps "pick a layout" and "act on
      // it" visually distinct in a 280px column.
      //
      // Glyphs are CSS masks, not <svg> children: makeButton() owns a plain
      // text node that relabel() rewrites (an inline <svg> would be wiped),
      // and the test stubs have no createElementNS. A mask also paints in
      // currentColor, so the icons follow the host theme on their own.
      '[data-dsbs-bar]{display:flex;align-items:center;gap:6px;min-height:30px;flex-wrap:nowrap}',
      '[data-dsbs-seg]{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:9px;flex:none;background:color-mix(in srgb,currentColor 11%,transparent)}',
      '[data-dsbs-bar] button[data-dsbs-glyph]{position:relative;display:flex;align-items:center;justify-content:center;width:28px;height:26px;min-width:0;padding:0!important;border:0;border-radius:7px;font-size:0!important;line-height:0!important;background:transparent;color:inherit;cursor:pointer;transition:background-color .14s ease,opacity .14s ease}',
      '[data-dsbs-bar] button[data-dsbs-glyph]:not([aria-pressed="true"]):hover{background:color-mix(in srgb,currentColor 12%,transparent)}',
      '[data-dsbs-seg] button[aria-pressed="true"]{background:color-mix(in srgb,currentColor 20%,transparent);box-shadow:0 1px 2px rgba(0,0,0,.22)}',
      '[data-dsbs-seg] button[aria-pressed="false"]{opacity:.70}',
      '[data-dsbs-seg] button[aria-pressed="false"]:hover{opacity:.9;background:color-mix(in srgb,currentColor 9%,transparent)}',
      '[data-dsbs-bar] button[data-dsbs-glyph]::before{content:"";position:absolute;inset:0;margin:auto;width:16px;height:16px;background:currentColor;opacity:.88;-webkit-mask-image:var(--dsbs-icon);-webkit-mask-size:16px 16px;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;mask-image:var(--dsbs-icon);mask-size:16px 16px;mask-position:center;mask-repeat:no-repeat}',
      // a — one column of stacked rows
      '[data-dsbs-bar] [data-dsbs-glyph="a"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Crect x=%222.5%22 y=%222.5%22 width=%2211%22 height=%2211%22 rx=%222.5%22/%3E%3Cpath d=%22M5.5 6.5h5M5.5 9.5h3%22/%3E%3C/svg%3E")}',
      // b — one column split down the middle
      '[data-dsbs-bar] [data-dsbs-glyph="b"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Crect x=%222.5%22 y=%222.5%22 width=%2211%22 height=%2211%22 rx=%222.5%22/%3E%3Cpath d=%22M8 3v10%22/%3E%3C/svg%3E")}',
      // c — a panel floating above the column
      '[data-dsbs-bar] [data-dsbs-glyph="c"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Crect x=%222.5%22 y=%226.5%22 width=%229%22 height=%227%22 rx=%221.8%22/%3E%3Cpath d=%22M7.2 6.5V4.4a1.6 1.6 0 011.6-1.6h3.1a1.6 1.6 0 011.6 1.6v3.9%22/%3E%3C/svg%3E")}',
      // fold — collapse one list (single chevron)
      '[data-dsbs-bar] [data-dsbs-glyph="fold"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M3 3.5h10M8 6v6M5.6 9.6L8 12l2.4-2.4%22/%3E%3C/svg%3E")}',
      // fold all — two chevrons, so the two fold buttons never look alike
      '[data-dsbs-bar] [data-dsbs-glyph="fold2"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M3 3h10M5.6 6.4L8 8.8l2.4-2.4M5.6 10.2L8 12.6l2.4-2.4%22/%3E%3C/svg%3E")}',
      // swap — trade the two tabs
      '[data-dsbs-bar] [data-dsbs-glyph="swap"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M2.5 5.5h9.5M9.5 3.2l2.5 2.3-2.5 2.3%22/%3E%3Cpath d=%22M13.5 10.5H4M6.5 8.2l-2.5 2.3 2.5 2.3%22/%3E%3C/svg%3E")}',
      // pop — detach the panel
      '[data-dsbs-bar] [data-dsbs-glyph="pop"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Crect x=%222.5%22 y=%222.5%22 width=%228%22 height=%228%22 rx=%221.8%22/%3E%3Cpath d=%22M9.5 13.5h3.5v-3.5M13 13l-4-4%22/%3E%3C/svg%3E")}',
      // cycle — walk the three layouts in order
      '[data-dsbs-bar] [data-dsbs-glyph="quick"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M13.4 7A5.5 5.5 0 004 4.2M2.6 9A5.5 5.5 0 0012 11.8%22/%3E%3Cpath d=%22M12.6 1.8v3h-3M3.4 14.2v-3h3%22/%3E%3C/svg%3E")}',
      // The divider keeps the action buttons apart from the mode pill; it
      // rides along to the right edge so the row never looks lopsided.
      '[data-dsbs-bar]>span{margin-left:auto;margin-right:4px;height:16px;width:1px;opacity:.26;background:currentColor;flex:none}',
      '[data-dsbs-bar]>span[hidden]{display:none!important}',
      // Wide column: the action buttons win their words back (the mode pill
      // stays iconic — its three options are read as one control). Only the
      // direct children grow, so the pill is untouched.
      'html:not([data-dsbs-narrow="true"]) [data-dsbs-bar]>button[data-dsbs-glyph]{width:auto!important;min-width:max-content!important;max-width:none!important;box-sizing:border-box;white-space:nowrap;padding:0 11px 0 31px!important;font-size:12px!important;line-height:1!important;justify-content:flex-start}',
      'html:not([data-dsbs-narrow="true"]) [data-dsbs-bar]>button[data-dsbs-glyph]::before{inset:auto;left:9px;top:50%;margin:0;transform:translateY(-50%)}',
      // Host session rows: a 2px accent rail on the active row, drawn with an
      // inset shadow so no box changes size, plus a soft transition. Both are
      // read-only decoration on the host's own markup.
      '[data-row-key^="session:"]{transition:background-color .13s ease,box-shadow .13s ease,color .13s ease;font-variant-numeric:tabular-nums}',
      '[data-row-key^="session:"][aria-selected="true"]{box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary,#4d6bfe))!important}',
      'html[data-dsbs-rail="true"] [data-row-key^="session:"][aria-selected="true"]{box-shadow:none!important}',

      // ---- third-party page strip (0.3.0) ------------------------------
      // The strip only exists while at least one plugin registered a tab, so a
      // stock profile never sees it. Everything inherits currentColor, which
      // is what keeps it legible in both host themes without a palette here.
      '[data-dsbs-tabs]{display:flex;align-items:center;gap:2px;padding:3px 4px 0;flex:none;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}',
      '[data-dsbs-tabs][hidden]{display:none!important}',
      '[data-dsbs-tabs]::-webkit-scrollbar{display:none}',
      '[data-dsbs-tabs] button{position:relative;display:inline-flex;align-items:center;gap:5px;flex:none;min-width:0;max-width:150px;padding:4px 9px;border:0;border-radius:7px 7px 0 0;background:transparent;color:inherit;font:inherit;font-size:11px;line-height:1.3;opacity:.6;cursor:pointer;white-space:nowrap;transition:opacity .14s ease,background-color .14s ease}',
      '[data-dsbs-tabs] button:hover{opacity:.92;background:color-mix(in srgb,currentColor 8%,transparent)}',
      '[data-dsbs-tabs] button[aria-selected="true"]{opacity:1;font-weight:600;background:color-mix(in srgb,currentColor 12%,transparent);box-shadow:inset 0 -2px 0 var(--dsw-alias-state-business-primary,currentColor)}',
      '[data-dsbs-tablabel]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '[data-dsbs-tabicon]{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none}',
      '[data-dsbs-tabicon] svg{width:14px;height:14px;display:block;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}',
      '[data-dsbs-tabicon-text]{font-size:12px;line-height:1}',
      '[data-dsbs-tabbadge]{flex:none;min-width:15px;padding:0 4px;border-radius:7px;font-size:10px;line-height:15px;text-align:center;background:color-mix(in srgb,currentColor 16%,transparent);font-variant-numeric:tabular-nums}',
      // The tab's own container inherits the column the two groups gave up.
      '[data-dsbs-tabpanel]{display:none;flex:1 1 auto;min-height:0;min-width:0;overflow:auto;flex-direction:column}',
      '[data-dsbs-tabpanel][data-dsbs-visible="true"]{display:flex}',
      'html[data-dsbs-ptab="true"] nav[data-dsbs-ext]{display:none!important}',
      'html[data-dsbs-ptab="true"] div:has(> [data-slot="sidebar.workspaces"]){display:none!important}',
      // Narrow: icon-only pages, the same rule the control bar follows. A tab
      // without an icon keeps its label instead of becoming an empty box.
      'html[data-dsbs-narrow="true"] [data-dsbs-tabs] button{max-width:64px;padding:4px 6px}',
      'html[data-dsbs-narrow="true"] [data-dsbs-tabs] button[data-dsbs-hasicon] [data-dsbs-tablabel]{display:none}',
      'html[data-dsbs-narrow="true"] [data-dsbs-tabs] button[data-dsbs-hasicon] [data-dsbs-tabbadge]{display:none}',
      'html[data-dsbs-rail="true"] [data-dsbs-tabs]{padding:2px 2px 0}',
      'html[data-dsbs-rail="true"] [data-dsbs-tabs] button{max-width:40px;padding:4px 5px}',
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
      // Third-party tab titles may arrive as `{ zh, en }`; resolving them needs
      // the same detector the dictionaries use, not a second guess.
      t.langName = function () {
        return lang
      }
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
        // 0.3.0 — third-party tabs. `activeTab` holds a registered id (or null
        // for the built-in groups); `tabPanels` caches one live container per
        // tab so a mount callback runs once and its disposer stays reachable.
        activeTab: readActiveTab(),
        seenTabs: Object.create(null),
        tabStrip: null,
        tabPanels: Object.create(null),
        tabSignature: '',
      }

      // The public surface other plugins see. Everything here is either a
      // function declaration (hoisted, so the object can be built before the
      // implementations read below) or a getter that touches live state only
      // when called.
      var sidebarService = {
        version: VERSION,
        // Returns its own disposer, which is exactly what `ctx.effect(() => …)`
        // wants, so a consumer never has to remember to unregister.
        registerTab: function (descriptor) {
          return registerTab(descriptor)
        },
        unregisterTab: function (id) {
          return unregisterTab(id)
        },
        getTabs: function () {
          return tabSnapshot()
        },
        activateTab: function (id) {
          return activateTab(id)
        },
        getActiveTab: function () {
          return runtime.activeTab && findTab(runtime.activeTab) ? runtime.activeTab : null
        },
        // A consumer can follow the strip instead of polling it: called with
        // (tabs, reason, activeId) whenever the list or the selection changes.
        subscribe: function (listener) {
          if (typeof listener !== 'function') return function () {}
          tabListeners.push(listener)
          var off = false
          return function () {
            if (off) return
            off = true
            var at = tabListeners.indexOf(listener)
            if (at >= 0) tabListeners.splice(at, 1)
          }
        },
        // Reading the current shape lets a consumer align with the layout
        // instead of sniffing classes off <html>.
        getLayout: function () {
          return {
            mode: config.values.mode,
            tab: config.values.tab,
            activeTab: runtime.activeTab,
            narrow: runtime.narrow === true,
            rail: runtime.rail === true,
          }
        },
      }

      // Publish the service once the slot system is live.
      //
      // Two dead ends measured against this client context, both of which take
      // the whole sidebar down:
      //   * ctx.provide() directly inside apply() stalls the plugin loader on
      //     "Loading plugins..." forever;
      //   * a static `inject: ['slots']` never activates, so apply() never runs.
      // Publishing from inside a dependency callback is the shape that works.
      function publishService() {
        try {
          if (typeof ctx.provide === 'function') ctx.provide('sidebarSuite', sidebarService)
        } catch (error) {
          try {
            console.warn('[dsh-sidebar-suite] could not publish the sidebarSuite service:', error)
          } catch (inner) {
            void inner
          }
        }
      }
      if (typeof ctx.inject === 'function') {
        try {
          ctx.inject(['slots'], function () { publishService() })
        } catch (error) {
          publishService()
        }
      } else {
        publishService()
      }
      // One window handle for the same object. Not a second API: it exists so a
      // consumer can reach the service from a plain browser context (and so the
      // release checks can drive the strip over CDP).
      try {
        window.__dshSidebarSuite = sidebarService
      } catch (error) {
        void error
      }

      var manualCleanups = []
      var tempButton = null
      var tempSlot = null // wrapper that keeps the root's top-level <button> count at one
      var tempNewChatHost = null
      var tempChatPolicy = 'hide' // TEMP_IN_CHAT_MODE in temp-session-config.txt
      // 0.2.8 hot reload: these are re-applied whenever the config file changes.
      var tempShowButton = true
      var tempConfigRevision = null
      var configPollPending = false
      var tempChatGuard = null
      var tempIds = [] // session ids the Host half will delete on quit
      var tempBusy = false
      var tempToastTimer = 0

      // 0.2.4 — always-expanded session list. `expandAllKnown` gates the
      // clicker until the Host half has answered (or clearly cannot answer),
      // so EXPAND_ALL_SESSIONS=off is never briefly overridden by the default.
      var expandAll = true
      var expandAllKnown = false
      var expandCooldown = Object.create(null)
      var expandRounds = 0
      var expandTimer = 0
      var expandGateTimer = 0

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

      // ---- temporary sessions (0.2.0) -----------------------------------
      // A temporary session IS a real DSH session. It is created through the
      // host's own navigation service — the exact call the native "New Session"
      // button makes — so it appears in the left sidebar, uses the native
      // conversation window, keeps its own model selection and tool loop, and
      // can be switched away from like any other task.
      //
      // Only deletion is ours. Verified in app.asar: DSH has no session-delete
      // API (its own UI action is archive/hide), so the Host half records the
      // ids and removes the session directories from disk at quit and again on
      // the next launch. Nothing is kept "in memory only" any more.

      function tempUrl(path) {
        try { return new URL(path, document.baseURI).href } catch (error) { void error; return path }
      }

      // Surface the real failure: a 404 here means the Host half never mounted
      // its /api routes (usually DSH was hot-reloaded, not restarted).
      function tempCall(path, options) {
        var init = { credentials: 'same-origin', cache: 'no-store' }
        if (options && options.method) init.method = options.method
        if (options && options.body !== undefined) {
          init.body = options.body
          init.headers = { 'content-type': 'application/json' }
        }
        return fetch(tempUrl(path), init)
          .then(function (response) {
            return response.text().then(function (body) {
              var detail = (body || '').replace(/\s+/g, ' ').slice(0, 180)
              if (!response.ok) throw new Error('HTTP ' + response.status + (detail ? ' · ' + detail : ''))
              try { return JSON.parse(body) } catch (error) {
                throw new Error('non-JSON response · ' + detail)
              }
            })
          })
          .catch(function (error) {
            if (error instanceof TypeError) throw new Error('network error · ' + String(error.message))
            throw error
          })
      }

      function toast(text, isError) {
        var node = null
        try { node = document.querySelector('[data-dsbs-temp-toast]') } catch (error) { void error }
        if (!node) {
          node = document.createElement('div')
          node.setAttribute('data-dsbs-temp-toast', '')
          node.setAttribute('role', 'status')
          document.body.appendChild(node)
        }
        node.setAttribute('data-dsbs-temp-toast-error', isError ? 'true' : 'false')
        node.textContent = text
        clearTimeout(tempToastTimer)
        tempToastTimer = setTimeout(function () {
          try { if (node.parentNode) node.parentNode.removeChild(node) } catch (error) { void error }
        }, isError ? 10000 : 3500)
      }

      // `uiWorkspace` is the client service the sidebar itself uses for "New
      // Session" (dsh-client-ui-workspace). Read through ctx.get() so a host
      // build without it leaves the three sidebar layouts untouched.
      function uiWorkspace() {
        try {
          if (typeof ctx.get !== 'function') return null
          return ctx.get('uiWorkspace') || null
        } catch (error) {
          void error
          return null
        }
      }

      function listOf(store) {
        try {
          var snap = store && typeof store.getSnapshot === 'function' ? store.getSnapshot() : null
          return snap || null
        } catch (error) {
          void error
          return null
        }
      }

      /** Same workspace the native button would pick: current, else the first. */
      function newSessionWorkspace(ui) {
        try {
          var snap = listOf(ui.workspaces && ui.workspaces.list)
          var items = (snap && snap.items) || []
          var current = null
          try { current = ui.mainReference && ui.mainReference.sessionId } catch (error) { void error }
          if (current) {
            for (var i = 0; i < items.length; i++) {
              if ((items[i].sessionIds || []).indexOf(current) >= 0) return items[i].workspaceId
            }
          }
          if (items.length > 0) return items[0].workspaceId
        } catch (error) {
          void error
        }
        return undefined
      }

      function knownSessionIds(ui) {
        try {
          var snap = listOf(ui.sessions && ui.sessions.list)
          return (snap && snap.ids ? snap.ids.slice() : [])
        } catch (error) {
          void error
          return []
        }
      }

      /** Fallback for builds without createNamed: watch the list for a new id. */
      function waitForNewSession(ui, before) {
        return new Promise(function (resolve) {
          var tries = 0
          var tick = function () {
            var ids = knownSessionIds(ui)
            for (var i = 0; i < ids.length; i++) {
              if (before.indexOf(ids[i]) < 0) { resolve(ids[i]); return }
            }
            tries += 1
            if (tries > 50) { resolve(''); return }
            setTimeout(tick, 100)
          }
          tick()
        })
      }

      function createTempSession() {
        if (tempBusy) return
        var ui = uiWorkspace()
        if (!ui) {
          toast(t('temp.noNative') + ' ' + t('temp.restartHint'), true)
          return
        }
        tempBusy = true
        if (tempButton) {
          tempButton.disabled = true
          tempButton.textContent = t('temp.creating')
        }
        var workspaceId = newSessionWorkspace(ui)
        var before = knownSessionIds(ui)
        Promise.resolve()
          .then(function () {
            // No workspace yet (fresh install, nothing opened): let the host's
            // own button logic decide, then read the id it settles on.
            if (typeof ui.createNamed === 'function' && workspaceId !== undefined) {
              return ui.createNamed({ workspaceId: workspaceId })
            }
            if (typeof ui.startSession === 'function') {
              ui.startSession(workspaceId)
              return waitForNewSession(ui, before)
            }
            throw new Error('uiWorkspace.createNamed / startSession missing')
          })
          .then(function (id) {
            if (!id) throw new Error('the host returned no session id')
            try {
              if (typeof ui.openSession === 'function') ui.openSession(id)
            } catch (error) {
              void error
            }
            if (tempIds.indexOf(id) < 0) tempIds.push(id)
            applyTempRows()
            return tempCall('api/dsh-temp-session.track?sessionId=' + encodeURIComponent(id), { method: 'POST' })
          })
          .then(function (data) {
            if (!data || data.ok !== true) throw new Error((data && data.error) || 'tracking failed')
            toast(t('temp.created'), false)
          })
          .catch(function (error) {
            toast(t('temp.failed') + String((error && error.message) || error) + ' · ' + t('temp.restartHint') + ' ' + t('temp.feedbackHint'), true)
          })
          .then(function () {
            tempBusy = false
            if (tempButton) {
              tempButton.disabled = false
              tempButton.textContent = t('temp.label')
            }
          })
      }

      /** Tag every sidebar row whose session id is in the temporary set. */
      function applyTempRows() {
        var rows = null
        try { rows = document.querySelectorAll('[data-row-key^="session:"]') } catch (error) {
          void error
          return
        }
        if (!rows) return
        var badge = t('temp.badge') || 'TEMP'
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i]
          var key = row.getAttribute('data-row-key') || ''
          var id = key.slice('session:'.length)
          if (tempIds.indexOf(id) >= 0) {
            if (row.getAttribute('data-dsbs-temp-row') !== '1') row.setAttribute('data-dsbs-temp-row', '1')
            if (row.getAttribute('data-dsbs-temp-badge') !== badge) row.setAttribute('data-dsbs-temp-badge', badge)
          } else if (row.hasAttribute('data-dsbs-temp-row')) {
            row.removeAttribute('data-dsbs-temp-row')
            row.removeAttribute('data-dsbs-temp-badge')
          }
        }
      }

      function refreshTempIds() {
        return tempCall('api/dsh-temp-session.list')
          .then(function (data) {
            if (data && Array.isArray(data.ids)) {
              tempIds = data.ids.slice()
              applyTempRows()
            }
          })
          .catch(function (error) { void error })
      }

      // ---- Temp button beside the host's "New Session" button (0.1.6) ----
      // The button is a plain sibling of the host button, never a replacement
      // or a moved node: React keeps owning its own DOM and we only add ours.
      function makeTempButton() {
        var button = document.createElement('button')
        button.type = 'button'
        button.setAttribute('data-dsbs-btn', 'temp')
        button.textContent = t('temp.label')
        button.title = t('temp.hint')
        button.addEventListener('click', function (event) {
          event.preventDefault()
          event.stopPropagation()
          createTempSession()
        })
        return button
      }

      function makeTempSlot() {
        var slot = document.createElement('div')
        slot.setAttribute('data-dsbs-temp-slot', '')
        return slot
      }

      // 0.2.8: the config can change while DSH is running, so visibility is
      // re-applied on every paint instead of being a one-way boot-time hide.
      function applyTempButtonVisibility() {
        var hidden = !tempShowButton
        if (tempButton) {
          if (hidden) tempButton.setAttribute('hidden', '')
          else tempButton.removeAttribute('hidden')
        }
        if (tempSlot) {
          if (hidden) tempSlot.setAttribute('hidden', '')
          else tempSlot.removeAttribute('hidden')
        }
      }

      function hideTempButton() {
        tempShowButton = false
        applyTempButtonVisibility()
      }

      function placeTempButton() {
        if (!tempButton) tempButton = makeTempButton()
        if (!tempSlot) tempSlot = makeTempSlot()
        ensureChatGuard()
        var native = null
        try { native = document.querySelector('button[class*="newSession"]') } catch (error) { void error }
        if (!native || !native.parentNode) return false
        var host = native.parentNode
        // The host's "New Session" button is a direct child of the sidebar root,
        // and dsh-deepseek-chat validates that root: it needs exactly one direct
        // <button> child. Adding a second one there makes its sidebar adapter
        // give up and show "当前侧栏不兼容：顶部新会话仍使用 HARNESS". Our button
        // therefore lives inside [data-dsbs-temp-slot], which the adapter ignores.
        if (tempButton.parentNode !== tempSlot) tempSlot.appendChild(tempButton)
        if (tempSlot.parentNode !== host) host.insertBefore(tempSlot, native.nextSibling)
        if (host !== tempNewChatHost) {
          if (tempNewChatHost) tempNewChatHost.removeAttribute('data-dsbs-newchat')
          tempNewChatHost = host
          host.setAttribute('data-dsbs-newchat', '')
        }
        var width = 0
        try { width = host.getBoundingClientRect().width } catch (error) { void error }
        var fixed = false
        try { fixed = !!(window.getComputedStyle && window.getComputedStyle(native).position === 'fixed') } catch (error) { void error }
        // The collapsed rail has no horizontal room for a second button.
        setFlag(html, 'data-dsbs-temp-solo', fixed || runtime.rail === true || (width > 0 && width < 170))
        var label = t('temp.label')
        if (tempButton.textContent !== label) tempButton.textContent = label
        var hint = t('temp.hint')
        if (tempButton.title !== hint) tempButton.title = hint
        applyTempButtonVisibility()
        return true
      }

      var tempStatusLoaded = false
      var tempStatusTries = 0
      var tempStatusPending = false

      /** Publish the CSS flag only when the setting is known and enabled. */
      function applyExpandFlag() {
        setFlag(html, 'data-dsbs-expand-all', expandAllKnown && expandAll)
      }

      /** Apply a Host status payload to the running sidebar. No restart. */
      function applyTempSettings(data) {
        if (runtime.disposed) return
        tempShowButton = !data || data.showButton !== false
        applyTempButtonVisibility()
        if (data && data.chatModePolicy) tempChatPolicy = String(data.chatModePolicy)
        if (data && data.buttonStyle) setFlag(html, 'data-dsbs-temp-style', String(data.buttonStyle) === 'own')
        // Older Host halves (<= 0.2.3) do not send this key; default to on.
        expandAll = !data || data.expandAllSessions !== false
        expandAllKnown = true
        applyExpandFlag()
        syncChatMode()
        expandAllSessions()
        scheduleSync()
      }

      function rememberConfigRevision(data) {
        if (data && typeof data.configRevision === 'number') tempConfigRevision = data.configRevision
      }

      /**
       * The host keeps five session rows per workspace and renders one overflow
       * button for the rest: <button data-row-key="overflow:<group>">.
       * Pressing it raises that group's watermark by five (or to Infinity on
       * the last batch) and flips aria-expanded to true once nothing is hidden.
       * React owns that state, so the honest way to expand is to press the host
       * button — never to rewrite or fake host DOM.
       *
       * A short cooldown per group prevents the same button from being pressed
       * twice before React re-renders (the second press would collapse it).
       */
      function expandAllSessions() {
        if (runtime.disposed || !expandAllKnown || !expandAll) return
        var buttons = null
        try {
          buttons = document.querySelectorAll('button[data-row-key^="overflow:"]')
        } catch (error) {
          void error
          return
        }
        if (!buttons || !buttons.length) {
          expandRounds = 0
          return
        }
        var now = Date.now()
        var clicked = 0
        for (var i = 0; i < buttons.length; i++) {
          var button = buttons[i]
          if (!button || button.getAttribute('aria-expanded') === 'true') continue
          var key = button.getAttribute('data-row-key') || ('row-' + i)
          if (now - (expandCooldown[key] || 0) < 120) continue
          expandCooldown[key] = now
          try {
            button.click()
            clicked += 1
          } catch (error) {
            void error
          }
        }
        if (clicked === 0 || expandRounds >= 40) {
          expandRounds = 0
          return
        }
        expandRounds += 1
        if (expandTimer) return
        expandTimer = setTimeout(function () {
          expandTimer = 0
          expandAllSessions()
        }, 150)
      }

      function loadTempStatus() {
        if (tempStatusLoaded || tempStatusPending) return
        if (tempStatusTries >= 3) {
          // The Host half never answered. Fall back to the file's default
          // rather than leaving the session list half-folded forever.
          if (!expandAllKnown) {
            expandAllKnown = true
            applyExpandFlag()
            scheduleSync()
          }
          return
        }
        tempStatusTries += 1
        tempStatusPending = true
        // A hanging request must not leave the session list folded forever.
        // Two seconds is well below the first heartbeat after a cold start.
        if (!expandGateTimer) {
          expandGateTimer = setTimeout(function () {
            expandGateTimer = 0
            if (expandAllKnown) return
            expandAllKnown = true
            expandAll = true
            applyExpandFlag()
            scheduleSync()
          }, 2000)
        }
        tempCall('api/dsh-temp-session.status').then(function (data) {
          tempStatusPending = false
          tempStatusLoaded = true
          if (expandGateTimer) { clearTimeout(expandGateTimer); expandGateTimer = 0 }
          rememberConfigRevision(data)
          applyTempSettings(data)
          refreshTempIds()
        }).catch(function (error) {
          void error
          tempStatusPending = false
          if (expandGateTimer) { clearTimeout(expandGateTimer); expandGateTimer = 0 }
          if (!expandAllKnown) {
            expandAllKnown = true
            expandAll = true
            applyExpandFlag()
            scheduleSync()
          }
        })
      }

      // ---- coexistence with dsh-deepseek-chat (CHAT / HARNESS switcher) ----
      // That plugin swaps the sidebar and the whole main area for DeepSeek's
      // official website when the user is in CHAT mode. Its "new chat" button
      // shares the same row as the host's "New Session" button, so a second
      // button there (ours) both breaks its layout and offers a harness model
      // call in a screen that is not a harness session. We detect its DOM and
      // step aside; the flag lives on <html> so the CSS above can gate on it.
      function chatModeActive() {
        try {
          if (document.querySelector('[data-dsh-chat-content],[data-dsh-chat-layout]')) return true
        } catch (error) {
          void error
        }
        return false
      }

      function syncChatMode() {
        if (runtime.disposed) return
        var active = tempChatPolicy !== 'show' && chatModeActive()
        setFlag(html, 'data-dsbs-chat-mode', active)
      }

      function ensureChatGuard() {
        if (tempChatGuard !== null || runtime.disposed) return
        tempChatGuard = setInterval(syncChatMode, 1500)
      }

      // 0.2.9: the three layouts are one segmented pill (they are mutually
      // exclusive), and the actions that belong to the chosen layout sit after
      // a divider. Glyphs are CSS pseudo elements, so makeButton() keeps owning
      // the plain text node that relabel() rewrites.
      function buildBar() {
        var bar = document.createElement('div')
        bar.setAttribute('data-dsbs-bar', '')
        bar.setAttribute('role', 'toolbar')

        var seg = document.createElement('div')
        seg.setAttribute('data-dsbs-seg', '')
        seg.setAttribute('role', 'group')
        seg.setAttribute('aria-label', t('bar.label'))

        var i
        for (i = 0; i < MODES.length; i++) {
          var mode = MODES[i]
          var modeButton = makeButton('mode-' + mode, 'mode.' + mode, 'mode.' + mode + '.hint', (function (value) {
            return function () { setMode(value) }
          })(mode))
          modeButton.setAttribute('data-dsbs-glyph', mode === 'a' ? 'a' : mode === 'b' ? 'b' : 'c')
          seg.appendChild(modeButton)
        }
        bar.appendChild(seg)

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
        foldExt.setAttribute('data-dsbs-glyph', 'fold')
        // Two fold buttons sit side by side in layout a, so they must not
        // share a glyph — a single chevron vs. a double one is the only cue
        // available once the labels collapse to icons.
        foldWs.setAttribute('data-dsbs-glyph', 'fold2')
        tabSwap.setAttribute('data-dsbs-glyph', 'swap')
        pop.setAttribute('data-dsbs-glyph', 'pop')
        quick.setAttribute('data-dsbs-glyph', 'quick')
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

      // ---- third-party tabs (0.3.0) --------------------------------------
      // Another plugin cannot reach into this bundle, so the whole feature is
      // one service object handed to the client context (`ctx.provide` at the
      // bottom of this file). The contract is deliberately DOM-shaped rather
      // than React-shaped: a consumer receives a plain container and paints
      // into it, which works for every plugin no matter how it was built.
      //
      // Deliberately absent: any way for a tab to restructure the sidebar.
      // A tab owns its own container and nothing else.
      var TAB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/
      var tabRecords = []
      var tabListeners = []
      var tabSeq = 0

      function readActiveTab() {
        try {
          var raw = localStorage.getItem(TAB_STORE_KEY)
          return typeof raw === 'string' && raw ? raw : null
        } catch (error) {
          return null
        }
      }

      function writeActiveTab(id) {
        try {
          if (id) localStorage.setItem(TAB_STORE_KEY, id)
          else localStorage.removeItem(TAB_STORE_KEY)
        } catch (error) {
          void error
        }
      }

      function findTab(id) {
        for (var i = 0; i < tabRecords.length; i++) {
          if (tabRecords[i].id === id) return tabRecords[i]
        }
        return null
      }

      // `title` may be a plain string or `{ zh, en }`. Resolving it here keeps
      // the two languages in one descriptor instead of making every consumer
      // read the locale itself.
      function tabTitle(record) {
        var title = record.title
        if (title && typeof title === 'object') {
          var zh = typeof title.zh === 'string' ? title.zh : ''
          var en = typeof title.en === 'string' ? title.en : ''
          var preferred = t.langName() === 'zh' ? zh || en : en || zh
          return preferred || record.id
        }
        return typeof title === 'string' && title ? title : record.id
      }

      function tabSnapshot() {
        var out = []
        for (var i = 0; i < tabRecords.length; i++) {
          var record = tabRecords[i]
          out.push({
            id: record.id,
            title: tabTitle(record),
            icon: record.icon,
            order: record.order,
            badge: record.badge,
            hidden: record.hidden,
            owner: record.owner,
          })
        }
        return out
      }

      function notifyTabs(reason) {
        if (!tabListeners.length) return
        var list = tabSnapshot()
        var active = runtime.activeTab
        for (var i = 0; i < tabListeners.length; i++) {
          try {
            tabListeners[i](list, reason, active)
          } catch (error) {
            void error
          }
        }
      }

      function tabContext(record) {
        return {
          id: record.id,
          t: function (key) {
            return t(key)
          },
          lang: function () {
            return t.langName()
          },
          // Lets a consumer close its own tab once the user is done with it,
          // rather than leaving a dead page in the strip.
          close: function () {
            if (runtime.activeTab === record.id) activateTab(null)
          },
        }
      }

      function createTabPanel(record) {
        var panel = document.createElement('div')
        panel.setAttribute('data-dsbs-tabpanel', record.id)
        panel.setAttribute('role', 'tabpanel')
        panel.setAttribute('aria-label', tabTitle(record))
        panel.setAttribute('data-dsbs-visible', 'false')
        var entry = { el: panel, cleanup: null, record: record, mounted: false }
        runtime.tabPanels[record.id] = entry
        return entry
      }

      // Mounting is deferred until the first activation: a tab that is never
      // opened should cost nothing, and a container that is still `display:
      // none` has no geometry to measure.
      function mountTabPanel(entry) {
        if (!entry || entry.mounted) return
        entry.mounted = true
        var record = entry.record
        if (typeof record.mount !== 'function') return
        try {
          var result = record.mount(entry.el, tabContext(record))
          if (typeof result === 'function') entry.cleanup = result
          else if (result && typeof result.dispose === 'function') {
            entry.cleanup = function () {
              result.dispose()
            }
          }
        } catch (error) {
          // A broken consumer must never take the sidebar down with it: the
          // failure is reported inside its own tab and logged once.
          try {
            entry.el.textContent = '[dsh-sidebar-suite] tab "' + record.id + '" failed to mount: '
              + (error && error.message ? error.message : String(error))
          } catch (inner) {
            void inner
          }
          try {
            console.error('[dsh-sidebar-suite] tab mount failed:', record.id, error)
          } catch (inner) {
            void inner
          }
        }
      }

      function disposeTabPanel(id) {
        var entry = runtime.tabPanels[id]
        if (!entry) return
        delete runtime.tabPanels[id]
        try {
          if (typeof entry.cleanup === 'function') entry.cleanup()
        } catch (error) {
          void error
        }
        try {
          if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el)
        } catch (error) {
          void error
        }
      }

      function disposeAllTabPanels() {
        var ids = []
        for (var id in runtime.tabPanels) ids.push(id)
        for (var i = 0; i < ids.length; i++) disposeTabPanel(ids[i])
      }

      function unregisterTab(id) {
        var record = findTab(id)
        if (!record) return false
        tabRecords.splice(tabRecords.indexOf(record), 1)
        disposeTabPanel(id)
        if (runtime.activeTab === id) {
          runtime.activeTab = null
          writeActiveTab(null)
        }
        notifyTabs('unregister')
        scheduleSync()
        return true
      }

      function registerTab(descriptor) {
        if (!descriptor || typeof descriptor !== 'object') {
          throw new TypeError('[dsh-sidebar-suite] registerTab(descriptor) needs an object')
        }
        var id = String(descriptor.id == null ? '' : descriptor.id).trim()
        if (!TAB_ID_RE.test(id)) {
          throw new TypeError('[dsh-sidebar-suite] registerTab: id must match ' + TAB_ID_RE + ', got "' + id + '"')
        }
        if (id === 'ext' || id === 'ws') {
          throw new TypeError('[dsh-sidebar-suite] registerTab: "' + id + '" is reserved for a built-in group')
        }
        var mount = descriptor.mount || descriptor.render
        if (typeof mount !== 'function') {
          throw new TypeError('[dsh-sidebar-suite] registerTab: "' + id + '" needs mount(container) or render(container)')
        }
        var record = {
          id: id,
          title: descriptor.title,
          icon: typeof descriptor.icon === 'string' ? descriptor.icon : null,
          order: typeof descriptor.order === 'number' && isFinite(descriptor.order) ? descriptor.order : 100,
          badge: descriptor.badge == null ? null : descriptor.badge,
          hidden: descriptor.hidden === true,
          mount: mount,
          owner: descriptor.owner == null ? null : String(descriptor.owner),
          seq: (tabSeq += 1),
        }
        // Re-registering the same id is exactly what a hot client reload looks
        // like, so it replaces in place instead of stacking a duplicate page.
        var previous = findTab(id)
        if (previous) {
          disposeTabPanel(id)
          tabRecords.splice(tabRecords.indexOf(previous), 1)
        }
        tabRecords.push(record)
        runtime.seenTabs[id] = true
        notifyTabs('register')
        scheduleSync()
        var disposed = false
        return function disposeTab() {
          if (disposed) return
          disposed = true
          unregisterTab(id)
        }
      }

      // Built-in groups only appear as pages in layout b. Layout a folds the
      // two groups independently and layout c floats the panels, so a page
      // switcher for them there would contradict what those layouts mean --
      // third-party tabs still work in all three.
      function tabEntries() {
        var out = []
        var showBuiltin = config.values.mode === 'b' && !!runtime.nav
        if (showBuiltin) {
          out.push({ id: 'ext', builtin: true, title: t('tab.ext'), icon: null, order: -20, badge: null })
          out.push({ id: 'ws', builtin: true, title: t('tab.ws'), icon: null, order: -10, badge: null })
        }
        for (var i = 0; i < tabRecords.length; i++) {
          var record = tabRecords[i]
          if (record.hidden === true) continue
          out.push({
            id: record.id,
            builtin: false,
            title: tabTitle(record),
            icon: record.icon,
            order: record.order,
            seq: record.seq,
            badge: record.badge,
          })
        }
        out.sort(function (left, right) {
          if (left.builtin !== right.builtin) return left.builtin ? -1 : 1
          if (left.order !== right.order) return left.order - right.order
          return (left.seq || 0) - (right.seq || 0)
        })
        return out
      }

      function ensureTabStrip(fx) {
        var strip = runtime.tabStrip
        if (strip && strip.parentNode !== fx.root) {
          try {
            strip.parentNode.removeChild(strip)
          } catch (error) {
            void error
          }
          strip = null
        }
        if (!strip) {
          strip = document.createElement('div')
          strip.setAttribute('data-dsbs-tabs', '')
          strip.setAttribute('role', 'tablist')
          strip.setAttribute('aria-label', t('tabs.label'))
          runtime.tabStrip = strip
        }
        // Sits under the control bar so the two read as one header. The
        // anchor matters: the host rebuilds the groups, never the bar.
        if (strip.parentNode === fx.root && runtime.bar && strip.previousSibling === runtime.bar) return strip
        var anchor = runtime.bar ? runtime.bar.nextSibling : (fx.nav || fx.regionArea)
        if (anchor && anchor.parentNode === fx.root && anchor !== strip) fx.root.insertBefore(strip, anchor)
        else if (strip.parentNode !== fx.root) fx.root.appendChild(strip)
        return strip
      }

      function buildTabButton(entry, selected) {
        var button = document.createElement('button')
        button.setAttribute('type', 'button')
        button.setAttribute('data-dsbs-tabid', entry.id)
        button.setAttribute('role', 'tab')
        button.setAttribute('aria-selected', selected ? 'true' : 'false')
        button.setAttribute('title', entry.title)
        if (selected) button.setAttribute('data-dsbs-selected', 'true')
        if (entry.builtin) button.setAttribute('data-dsbs-builtin', entry.id)

        if (typeof entry.icon === 'string' && entry.icon) {
          var glyph = document.createElement('span')
          glyph.setAttribute('data-dsbs-tabicon', '')
          glyph.setAttribute('aria-hidden', 'true')
          button.setAttribute('data-dsbs-hasicon', '')
          if (entry.icon.charAt(0) === '<') {
            // A consumer-supplied mark. Plugins already run arbitrary code in
            // this page, so this grants nothing new -- but the icon still gets
            // its own element so the label stays a text node.
            glyph.innerHTML = entry.icon
          } else {
            glyph.textContent = entry.icon
            glyph.setAttribute('data-dsbs-tabicon-text', '')
          }
          button.appendChild(glyph)
        }

        var label = document.createElement('span')
        label.setAttribute('data-dsbs-tablabel', '')
        label.textContent = entry.title
        button.appendChild(label)

        if (entry.badge != null && entry.badge !== '') {
          var badge = document.createElement('span')
          badge.setAttribute('data-dsbs-tabbadge', '')
          badge.textContent = String(entry.badge)
          button.appendChild(badge)
        }

        button.addEventListener('click', function () {
          if (entry.builtin) {
            // Built-ins drive the existing group switcher, so a click keeps
            // meaning what the same click meant before 0.3.0.
            runtime.activeTab = null
            writeActiveTab(null)
            setField('tab', entry.id)
          } else {
            activateTab(entry.id)
          }
        })
        return button
      }

      function renderTabStrip() {
        var strip = runtime.tabStrip
        if (!strip) return
        var entries = tabEntries()
        var hasPlugin = false
        for (var p = 0; p < entries.length; p++) {
          if (!entries[p].builtin) hasPlugin = true
        }
        // Nothing registered: stay out of the way entirely, so a profile with
        // no tab consumers looks exactly like 0.2.x.
        if (!hasPlugin) {
          strip.setAttribute('hidden', '')
          runtime.tabSignature = ''
          return
        }
        strip.removeAttribute('hidden')

        var activePlugin = runtime.activeTab && findTab(runtime.activeTab) ? runtime.activeTab : null
        var signature = (activePlugin || '-') + '|' + config.values.mode + '|' + config.values.tab + '|'
        for (var s = 0; s < entries.length; s++) {
          signature += entries[s].id + ':' + entries[s].title + ':' + entries[s].icon + ':' + entries[s].badge + ';'
        }
        if (signature === runtime.tabSignature) return
        runtime.tabSignature = signature

        while (strip.firstChild) strip.removeChild(strip.firstChild)
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i]
          var selected = entry.builtin
            ? (!activePlugin && config.values.tab === entry.id)
            : (activePlugin === entry.id)
          strip.appendChild(buildTabButton(entry, selected))
        }
      }

      function placeTabPanel(panel, fx) {
        if (panel.parentNode === fx.root) return
        var anchor = fx.nav || fx.regionArea
        if (anchor && anchor.parentNode === fx.root) fx.root.insertBefore(panel, anchor)
        else fx.root.appendChild(panel)
      }

      function syncTabPanels(fx, activeId) {
        var i
        // The container is created the first time its tab owns the column, not
        // at registration: a tab that is never opened should cost nothing, and
        // a display:none container has no geometry to measure anyway.
        if (activeId && !runtime.tabPanels[activeId]) {
          var owning = findTab(activeId)
          if (owning) createTabPanel(owning)
        }
        // Panels that are no longer registered are gone already; the ones that
        // remain are shown only while they own the column.
        for (var id in runtime.tabPanels) {
          var entry = runtime.tabPanels[id]
          if (!entry || !entry.el) continue
          if (id === activeId) {
            placeTabPanel(entry.el, fx)
            entry.el.setAttribute('data-dsbs-visible', 'true')
            entry.el.removeAttribute('aria-hidden')
            if (!entry.mounted) mountTabPanel(entry)
          } else {
            entry.el.setAttribute('data-dsbs-visible', 'false')
            entry.el.setAttribute('aria-hidden', 'true')
          }
        }
        void i
      }

      function activateTab(id) {
        if (id != null && id !== '' && !findTab(id)) return false
        var next = id == null || id === '' ? null : String(id)
        // Clicking the tab that already owns the column returns to the groups,
        // which is the only way back out of a tab in layouts a and c.
        if (next && runtime.activeTab === next) next = null
        runtime.activeTab = next
        writeActiveTab(next)
        notifyTabs('active')
        scheduleSync()
        return true
      }

      function barButton(key) {
        if (key === 'temp') return tempButton
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
        ensureTabStrip(fx)
        renderTabStrip()
        placeTempButton()
        applyTempButtonVisibility()
        loadTempStatus()
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
        // A registered tab owning the column outranks every layout rule: the
        // two groups step aside and the tab's own container takes the space.
        var pluginTab = null
        if (runtime.activeTab) {
          if (findTab(runtime.activeTab)) {
            pluginTab = runtime.activeTab
          } else if (runtime.seenTabs[runtime.activeTab]) {
            // It registered once and is gone now: its owner unloaded while the
            // page was open. Fall back instead of leaving an empty column with
            // no way out of it.
            runtime.activeTab = null
            writeActiveTab(null)
            notifyTabs('orphan')
          }
          // Not seen yet: another plugin may still be registering during
          // startup, so the stored id is kept and retried on the next paint.
        }
        setFlag(html, 'data-dsbs-ptab', !!pluginTab)
        if (pluginTab) {
          extHidden = true
          wsHidden = true
        } else if (state.mode === 'a') {
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
        syncTabPanels(fx, pluginTab)
        // The strip is the only affordance that survives a hidden bar, so it
        // is repainted on every sync rather than only when its content changed.
        if (runtime.tabStrip && pluginTab) {
          var selectedTab = runtime.tabStrip.querySelector('[data-dsbs-tabid="' + pluginTab + '"]')
          if (selectedTab) selectedTab.setAttribute('aria-selected', 'true')
        }

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
        // Both are idempotent: the status call stops after one answer, and the
        // expand clicker skips groups that are already fully shown.
        loadTempStatus()
        expandAllSessions()
        var fx = resolveSidebar()
        measureRail(fx)
        paint()
        syncChatMode()
        applyTempRows()
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

          // ---- temporary-session cleanup policy -------------------------
          // The Host half owns this: it is the only side that can delete files,
          // and the values live in temp-session-config.txt rather than in the
          // plugin config the cards above write. So this section talks to
          // /api/dsh-temp-session.config and never touches configForms — one
          // source of truth, no "settings page and file disagree" state.
          var policyState = ReactLib.useState(null)
          var policy = policyState[0]
          var setPolicy = policyState[1]
          var saveState = ReactLib.useState('')
          var saveStatus = saveState[0]
          var setSaveStatus = saveState[1]
          // '' | 'busy' | a result line for the manual cleanup button.
          var purgeState = ReactLib.useState('')
          var purgeStatus = purgeState[0]
          var setPurgeStatus = purgeState[1]

          // ---- feedback -------------------------------------------------
          // A plugin bundle has no server to post to, and no mail client it can
          // trust. So this block builds a complete report out of facts the Host
          // half already knows (version, OS, layout, button mode, route count,
          // last error) and then offers three channels that need nothing:
          // the clipboard, a pre-filled GitHub issue, and the plugin market's
          // own comment thread. DSH itself has no plugin-feedback field in its
          // manifest (verified in app.asar: no bugs/feedback handling in the
          // plugin-manager client); dsh-market is the surface that defines one.
          // The desktop shell opens http(s) links in the system browser
          // (app.asar lib/main.js attaches setWindowOpenHandler to the main
          // window), so an <a>-style jump works; because that handler answers
          // "deny" after handing the URL to the OS, `window.open` returns null
          // even on success — so the return value must never be read as "failed".
          var noteState = ReactLib.useState(readDraft())
          var note = noteState[0]
          var setNote = noteState[1]
          var fbState = ReactLib.useState('')
          var fbStatus = fbState[0]
          var setFbStatus = fbState[1]

          function readDraft() {
            try {
              return String(window.localStorage.getItem(FEEDBACK_DRAFT_KEY) || '')
            } catch (error) {
              void error
              return ''
            }
          }

          function updateNote(value) {
            setNote(value)
            try {
              if (value) window.localStorage.setItem(FEEDBACK_DRAFT_KEY, value)
              else window.localStorage.removeItem(FEEDBACK_DRAFT_KEY)
            } catch (error) {
              void error
            }
          }

          function legacyCopy(text) {
            var area = document.createElement('textarea')
            area.value = text
            area.setAttribute('readonly', '')
            area.style.position = 'fixed'
            area.style.top = '-1000px'
            area.style.opacity = '0'
            document.body.appendChild(area)
            try {
              area.select()
              var done = typeof document.execCommand === 'function' && document.execCommand('copy')
              if (!done) throw new Error('copy blocked')
            } finally {
              try { if (area.parentNode) area.parentNode.removeChild(area) } catch (error) { void error }
            }
          }

          function copyText(text) {
            var clip = typeof navigator !== 'undefined' ? navigator.clipboard : null
            if (clip && typeof clip.writeText === 'function') {
              return clip.writeText(text).catch(function () { legacyCopy(text) })
            }
            try {
              legacyCopy(text)
              return Promise.resolve()
            } catch (error) {
              return Promise.reject(error)
            }
          }

          // One status call is enough for a whole session of editing: version
          // and OS do not change while the page is open.
          var diagCache = null
          function loadDiagnostics() {
            if (diagCache) return Promise.resolve(diagCache)
            return tempCall('api/dsh-temp-session.status').then(function (data) {
              if (data && data.ok === true) diagCache = data
              return diagCache
            }).catch(function () {
              return null
            })
          }

          function reportText(diag) {
            var env = (diag && diag.env) || {}
            var purge = diag && diag.lastPurge
            var lines = []
            lines.push('### What happened')
            lines.push((note || '').trim() || '(no description)')
            lines.push('')
            lines.push('### Environment')
            lines.push('- plugin: ' + (env.plugin || '?') + ' · default layout: ' + readDefaultMode())
            lines.push('- dsh desktop: ' + (env.dshClient || '?')
              + ' · node ' + (env.node || '?')
              + (env.electron ? ' · electron ' + env.electron : ''))
            lines.push('- system: ' + ([env.platform, env.os, env.arch].filter(Boolean).join(' ') || '?'))
            lines.push('- temp button: ' + ((diag && diag.buttonStyle) || '?')
              + ' · tracked: ' + (diag ? diag.tempCount : '?')
              + ' · routes: ' + ((diag && diag.routes && diag.routes.registered) || 0)
              + ' · quit-cleanup: ' + (diag && diag.deleteOnExit === false ? 'off' : 'on')
              + (diag && diag.scheduleDelete ? ' · daily ' + diag.scheduleTime : ''))
            if (purge) {
              lines.push('- last cleanup: ' + purge.reason + ' @ ' + purge.at
                + ' → removed ' + purge.removed + '/' + purge.tried)
            }
            if (diag && diag.lastError) lines.push('- last error: ' + diag.lastError)
            return lines.join('\n')
          }

          function issueUrl(text) {
            var title = (note || '').trim().split('\n')[0].trim().slice(0, 80)
            if (!title) title = 'dsh-sidebar-suite feedback'
            var head = FEEDBACK_REPO + '/issues/new?title=' + encodeURIComponent(title) + '&body='
            // Long URLs are rejected by the OS handler and by GitHub. Trim the
            // description first — the environment block is what makes a report
            // actionable, and it is short.
            var limit = 6500
            var body = text
            var encoded = encodeURIComponent(body)
            while (body.length > 0 && head.length + encoded.length > limit) {
              body = text.slice(0, Math.max(0, body.length - 240)) + '\n…(truncated)'
              encoded = encodeURIComponent(body)
            }
            return head + encoded
          }

          function flashFeedback(kind) {
            setFbStatus(kind)
            try {
              window.setTimeout(function () {
                setFbStatus(function (previous) { return previous === kind ? '' : previous })
              }, 3200)
            } catch (error) {
              void error
            }
          }

          function copyReport() {
            setFbStatus('working')
            loadDiagnostics()
              .then(function (diag) { return copyText(reportText(diag)) })
              .then(function () { flashFeedback('copied') })
              .catch(function () { setFbStatus('failed') })
          }

          function openIssue() {
            setFbStatus('working')
            loadDiagnostics()
              .then(function (diag) {
                try {
                  window.open(issueUrl(reportText(diag)), '_blank')
                } catch (error) {
                  void error
                }
                flashFeedback('issueOpened')
              })
              .catch(function () { setFbStatus('failed') })
          }

          // The plugin market (dsh-market) defines its own feedback entry: one
          // GitHub Discussion per plugin, keyed on `plugin:<owner/repo>` in the
          // public catalog repository. No diagnostics are needed — the note is
          // typed there directly — so this is a plain link to that exact thread.
          function openMarket() {
            try {
              window.open(FEEDBACK_MARKET_URL, '_blank')
            } catch (error) {
              void error
            }
            flashFeedback('issueOpened')
          }

          function adoptPolicy(data, fallbackTime) {
            var kept = Number(data && data.maxKept)
            setPolicy({
              deleteOnExit: data.deleteOnExit !== false,
              scheduleDelete: data.scheduleDelete === true,
              scheduleTime: typeof data.scheduleTime === 'string' && data.scheduleTime
                ? data.scheduleTime
                : (fallbackTime || '03:00'),
              // 0.2.8 — the remaining config keys, all editable on this page.
              showButton: data.showButton !== false,
              inChatMode: data.inChatMode === 'show' ? 'show' : 'hide',
              buttonStyle: data.buttonStyle === 'own' ? 'own' : 'pair',
              expandAllSessions: data.expandAllSessions !== false,
              maxKept: kept > 0 ? Math.min(Math.round(kept), 200) : 20,
              configRevision: typeof data.configRevision === 'number' ? data.configRevision : null,
              configFile: typeof data.configFile === 'string' ? data.configFile : '',
            })
          }

          ReactLib.useEffect(function () {
            var stopped = false
            var loaded = false
            var revision = null
            function read(first) {
              tempCall('api/dsh-temp-session.config')
                .then(function (data) {
                  if (stopped) return
                  if (!data || data.ok !== true) {
                    if (first) setPolicy(false)
                    return
                  }
                  loaded = true
                  var rev = typeof data.configRevision === 'number' ? data.configRevision : null
                  // Only re-render on a real change. Re-rendering on every tick
                  // would fight a user who is halfway through typing a time.
                  if (first || rev === null || rev !== revision) {
                    revision = rev
                    adoptPolicy(data)
                  }
                })
                .catch(function () {
                  if (!stopped && first) setPolicy(false)
                })
            }
            read(true)
            // 0.2.8: a save in Notepad is picked up here within ~2.5 seconds.
            var timer = null
            if (typeof window.setInterval === 'function') {
              timer = window.setInterval(function () {
                if (stopped || !loaded) return
                if (typeof document.hidden === 'boolean' && document.hidden) return
                read(false)
              }, 2500)
            }
            return function () {
              stopped = true
              if (timer !== null && typeof window.clearInterval === 'function') window.clearInterval(timer)
            }
          }, [])

          function persist(patch) {
            if (!policy || policy === false) return
            setPolicy(assign({}, policy, patch))
            setSaveStatus('saving')
            tempCall('api/dsh-temp-session.config', { method: 'POST', body: JSON.stringify(patch) })
              .then(function (data) {
                if (!data || data.ok !== true) throw new Error((data && data.error) || 'save failed')
                adoptPolicy(data, patch.scheduleTime)
                setSaveStatus('saved')
                // Fade the confirmation out; a later failure must not be wiped.
                try {
                  window.setTimeout(function () {
                    setSaveStatus(function (previous) { return previous === 'saved' ? '' : previous })
                  }, 2400)
                } catch (error) {
                  void error
                }
              })
              .catch(function (error) {
                setSaveStatus(t('policy.failed') + String((error && error.message) || error))
              })
          }

          function purgeNow() {
            if (purgeStatus === 'busy') return
            setPurgeStatus('busy')
            tempCall('api/dsh-temp-session.purge', { method: 'POST' })
              .then(function (data) {
                if (!data || data.ok !== true) throw new Error((data && data.error) || 'purge failed')
                var n = typeof data.removed === 'number' ? data.removed : 0
                setPurgeStatus(t('options.purged') + n)
              })
              .catch(function (error) {
                setPurgeStatus(t('options.purgeFailed') + String((error && error.message) || error))
              })
          }

          var available = !!configController()
          var policyReady = !!(policy && policy !== false)
          var dim = { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-secondary,inherit)' }
          var pillBase = {
            font: 'inherit', fontSize: '11px', lineHeight: '16px', padding: '2px 10px',
            minWidth: '46px', borderRadius: '999px', cursor: 'pointer',
            border: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3))',
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary,inherit)'
          }
          var pillOn = {
            borderColor: 'var(--dsw-alias-label-primary,currentColor)',
            background: 'var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.22))',
            color: 'var(--dsw-alias-label-primary,inherit)'
          }
          function policyRow(label, active, onToggle, extra) {
            return h('div', {
              key: label,
              style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
            },
              h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary,inherit)' } }, label),
              h('button', {
                type: 'button',
                'aria-pressed': active ? 'true' : 'false',
                disabled: !policyReady,
                onClick: function () { onToggle(!active) },
                style: assign({}, pillBase, active ? pillOn : {})
              }, active ? t('policy.on') : t('policy.off')),
              extra || null
            )
          }
          function optionRow(label, value, choices, onPick) {
            return h('div', {
              key: label,
              style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
            },
              h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary,inherit)' } }, label),
              h('div', { style: { display: 'flex', gap: '4px' } },
                choices.map(function (choice) {
                  var active = value === choice.value
                  return h('button', {
                    key: choice.value, type: 'button',
                    'aria-pressed': active ? 'true' : 'false',
                    disabled: !policyReady,
                    onClick: function () { onPick(choice.value) },
                    style: assign({}, pillBase, { minWidth: '0' }, active ? pillOn : {})
                  }, choice.label)
                })
              )
            )
          }
          var cardBase = {
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '5px',
            flex: '1 1 140px', minWidth: '140px', maxWidth: '230px', padding: '10px',
            borderRadius: '10px', font: 'inherit', textAlign: 'left', cursor: 'pointer',
            color: 'var(--dsw-alias-label-primary,inherit)',
            border: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3))',
            background: 'transparent'
          }
          return h('div', { 'data-dsbs-config': ENTRY, style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            h('div', { 'data-dsbs-intro': ENTRY, style: {
              fontSize: '11px', lineHeight: '16px',
              color: 'var(--dsw-alias-label-secondary,inherit)'
            } }, t('settings.intro')),
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
            h('div', { 'data-dsbs-options': ENTRY, style: {
              display: 'flex', flexDirection: 'column', gap: '8px',
              paddingTop: '12px', marginTop: '2px',
              borderTop: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))'
            } },
              h('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--dsw-alias-label-primary,inherit)' } }, t('options.title')),
              h('div', { style: dim }, t('options.help')),
              policy === null
                ? h('div', { style: dim }, t('policy.loading'))
                : policy === false
                  ? h('div', { style: dim }, t('policy.unavailable'))
                  : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                    policyRow(t('options.showButton'), policy.showButton === true, function (next) {
                      persist({ showButton: next })
                    }),
                    optionRow(t('options.inChatMode'), policy.inChatMode, [
                      { value: 'hide', label: t('options.chatHide') },
                      { value: 'show', label: t('options.chatShow') },
                    ], function (next) { persist({ inChatMode: next }) }),
                    optionRow(t('options.buttonStyle'), policy.buttonStyle, [
                      { value: 'pair', label: t('options.stylePair') },
                      { value: 'own', label: t('options.styleOwn') },
                    ], function (next) { persist({ buttonStyle: next }) }),
                    policyRow(t('options.expandAll'), policy.expandAllSessions === true, function (next) {
                      persist({ expandAllSessions: next })
                    }),
                    h('div', { style: dim }, t('options.expandHint')),
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                      h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary,inherit)' } }, t('options.maxKept')),
                      h('input', {
                        type: 'number', min: 1, max: 200, step: 1,
                        value: String(policy.maxKept),
                        disabled: !policyReady,
                        'aria-label': t('options.maxKept'),
                        onChange: function (event) {
                          var raw = event && event.target ? event.target.value : ''
                          var n = Number(raw)
                          if (!(n > 0)) return
                          persist({ maxKept: Math.min(Math.round(n), 200) })
                        },
                        style: {
                          font: 'inherit', fontSize: '12px', padding: '1px 6px', width: '64px',
                          borderRadius: '6px', color: 'var(--dsw-alias-label-primary,inherit)',
                          background: 'transparent',
                          border: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3))'
                        }
                      }),
                      h('span', { style: dim }, t('options.maxKeptHint'))
                    ),
                    h('div', { style: dim },
                      t('options.rev') + ' ' + (policy.configRevision === null ? '-' : policy.configRevision) +
                      (policy.configFile ? ' · ' + policy.configFile : ''))
                  )
            ),
            h('div', { 'data-dsbs-temp-policy': ENTRY, style: {
              display: 'flex', flexDirection: 'column', gap: '8px',
              paddingTop: '12px', marginTop: '2px',
              borderTop: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))'
            } },
              h('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--dsw-alias-label-primary,inherit)' } }, t('policy.title')),
              h('div', { style: dim }, t('policy.help')),
              policy === null
                ? h('div', { style: dim }, t('policy.loading'))
                : policy === false
                  ? h('div', { style: dim }, t('policy.unavailable'))
                  : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                    policyRow(t('policy.onQuit'), policy.deleteOnExit === true, function (next) {
                      persist({ deleteOnExit: next })
                    }),
                    policyRow(t('policy.schedule'), policy.scheduleDelete === true, function (next) {
                      persist({ scheduleDelete: next })
                    }, h('input', {
                      type: 'time',
                      value: policy.scheduleTime,
                      step: 60,
                      'aria-label': t('policy.schedule'),
                      onChange: function (event) {
                        var value = event && event.target ? event.target.value : ''
                        if (!value) return
                        persist({ scheduleTime: value })
                      },
                      style: {
                        font: 'inherit', fontSize: '12px', padding: '1px 6px',
                        borderRadius: '6px', color: 'var(--dsw-alias-label-primary,inherit)',
                        background: 'transparent',
                        opacity: policy.scheduleDelete ? '1' : '0.55',
                        border: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3))'
                      }
                    })),
                    h('div', { style: dim }, t('policy.note')),
                    saveStatus
                      ? h('div', {
                        style: {
                          fontSize: '11px', lineHeight: '16px',
                          color: saveStatus === 'saved'
                            ? 'var(--dsw-alias-label-secondary,inherit)'
                            : saveStatus === 'saving'
                              ? 'var(--dsw-alias-label-tertiary,inherit)'
                              : 'var(--dsw-alias-text-error,#e5484d)'
                        }
                      }, saveStatus === 'saving' ? t('policy.saving') : saveStatus === 'saved' ? t('policy.saved') : saveStatus)
                      : null,
                    h('div', {
                      style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '2px' }
                    },
                      h('button', {
                        type: 'button',
                        disabled: !policyReady || purgeStatus === 'busy',
                        onClick: purgeNow,
                        style: assign({}, pillBase, { minWidth: '0' })
                      }, purgeStatus === 'busy' ? t('options.purging') : t('options.purge')),
                      purgeStatus && purgeStatus !== 'busy'
                        ? h('span', { style: dim }, purgeStatus)
                        : null
                    )
                  )
            ),
            h('div', { 'data-dsbs-feedback': ENTRY, style: {
              display: 'flex', flexDirection: 'column', gap: '8px',
              paddingTop: '12px', marginTop: '2px',
              borderTop: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))'
            } },
              h('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--dsw-alias-label-primary,inherit)' } }, t('feedback.title')),
              h('div', { style: dim }, t('feedback.help')),
              h('textarea', {
                'data-dsbs-feedback-note': '',
                value: note,
                rows: 2,
                maxLength: 4000,
                placeholder: t('feedback.placeholder'),
                'aria-label': t('feedback.title'),
                onChange: function (event) {
                  updateNote(event && event.target ? String(event.target.value || '') : '')
                },
                style: {
                  width: '100%', boxSizing: 'border-box', resize: 'vertical',
                  minHeight: '44px', maxHeight: '160px',
                  padding: '6px 8px', borderRadius: '8px',
                  font: 'inherit', fontSize: '12px', lineHeight: '18px',
                  color: 'var(--dsw-alias-label-primary,inherit)',
                  background: 'transparent',
                  border: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3))'
                }
              }),
              h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
                h('button', {
                  type: 'button',
                  'data-dsbs-feedback-copy': '',
                  disabled: fbStatus === 'working',
                  onClick: copyReport,
                  style: assign({}, pillBase, { minWidth: '0', padding: '4px 12px' })
                }, fbStatus === 'copied'
                  ? t('feedback.copied')
                  : fbStatus === 'working'
                    ? t('feedback.working')
                    : t('feedback.copy')),
                h('button', {
                  type: 'button',
                  'data-dsbs-feedback-issue': '',
                  disabled: fbStatus === 'working',
                  onClick: openIssue,
                  style: assign({}, pillBase, { minWidth: '0', padding: '4px 12px' })
                }, fbStatus === 'issueOpened' ? t('feedback.issueOpened') : t('feedback.issue')),
                h('button', {
                  type: 'button',
                  'data-dsbs-feedback-market': '',
                  onClick: openMarket,
                  style: assign({}, pillBase, { minWidth: '0', padding: '4px 12px' })
                }, t('feedback.market')),
                fbStatus === 'failed'
                  ? h('span', { style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-text-error,#e5484d)' } }, t('feedback.failed'))
                  : null
              ),
              h('div', { style: dim }, t('feedback.hint')),
              h('div', { style: dim }, t('feedback.where')),
              h('div', { style: dim }, t('feedback.marketHint'))
            ),
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

      effect(function () {
        // 0.2.8 hot reload. The Host stamps the config file and bumps a
        // monotone revision; one cheap status poll is enough to notice a save
        // in Notepad and re-apply every sidebar setting in place. Old Host
        // halves have no revision field — those are simply left on boot values.
        var timer = setInterval(function () {
          if (runtime.disposed || configPollPending) return
          if (typeof document.hidden === 'boolean' && document.hidden) return
          configPollPending = true
          tempCall('api/dsh-temp-session.status')
            .then(function (data) {
              configPollPending = false
              if (runtime.disposed || !data || data.ok !== true) return
              if (typeof data.configRevision !== 'number') return
              if (data.configRevision === tempConfigRevision) return
              rememberConfigRevision(data)
              applyTempSettings(data)
            })
            .catch(function () { configPollPending = false })
        }, 3000)
        if (timer && typeof timer.unref === 'function') timer.unref()
        return function () { clearInterval(timer) }
      }, 'sidebar-suite: config hot reload')

      var teardown = null
      effect(function () {
        teardown = function () {
          if (runtime.disposed) return
          runtime.disposed = true
          try {
            clearTimeout(tempToastTimer)
            var toastNode = document.querySelector('[data-dsbs-temp-toast]')
            if (toastNode && toastNode.parentNode) toastNode.parentNode.removeChild(toastNode)
          } catch (error) {
            void error
          }
          try {
            var tagged = document.querySelectorAll('[data-dsbs-temp-row]')
            for (var t = 0; t < tagged.length; t++) {
              tagged[t].removeAttribute('data-dsbs-temp-row')
              tagged[t].removeAttribute('data-dsbs-temp-badge')
            }
          } catch (error) {
            void error
          }
          try {
            if (tempSlot && tempSlot.parentNode) tempSlot.parentNode.removeChild(tempSlot)
            else if (tempButton && tempButton.parentNode) tempButton.parentNode.removeChild(tempButton)
            tempButton = null
            tempSlot = null
          } catch (error) {
            void error
          }
          try {
            if (tempNewChatHost) tempNewChatHost.removeAttribute('data-dsbs-newchat')
            tempNewChatHost = null
          } catch (error) {
            void error
          }
          try {
            if (tempChatGuard !== null) clearInterval(tempChatGuard)
            tempChatGuard = null
          } catch (error) {
            void error
          }
          try {
            setFlag(html, 'data-dsbs-chat-mode', false)
          } catch (error) {
            void error
          }
          try {
            clearTimeout(expandTimer)
            clearTimeout(expandGateTimer)
            expandTimer = 0
            expandGateTimer = 0
            expandAllKnown = false
            expandRounds = 0
            expandCooldown = Object.create(null)
            html.removeAttribute('data-dsbs-expand-all')
          } catch (error) {
            void error
          }
          try {
            if (runtime.bar && runtime.bar.parentNode) runtime.bar.parentNode.removeChild(runtime.bar)
          } catch (error) {
            void error
          }
          try {
            // Unmount every live tab first: a consumer's disposer may still
            // touch its container, so removing the DOM afterwards is safer
            // than yanking it out from under a cleanup callback.
            disposeAllTabPanels()
            if (runtime.tabStrip && runtime.tabStrip.parentNode) runtime.tabStrip.parentNode.removeChild(runtime.tabStrip)
          } catch (error) {
            void error
          }
          try {
            runtime.tabStrip = null
            runtime.tabSignature = ''
            tabListeners.length = 0
            tabRecords.length = 0
          } catch (error) {
            void error
          }
          try {
            if (window[OWNER_KEY] === owner) delete window[OWNER_KEY]
          } catch (error) {
            void error
          }
          try {
            // Only drop the handle if it is still ours: a newer generation may
            // already have replaced it, and that one must keep working.
            if (window.__dshSidebarSuite === sidebarService) delete window.__dshSidebarSuite
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
            'data-dsbs-temp-solo',
            'data-dsbs-temp-style',
            'data-dsbs-ptab',
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

