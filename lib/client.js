// dsh-sidebar-suite — Client half.
//
// The DSH left sidebar stacks two groups in one column: the panels group
// (`nav` with a `panelList` class) and the workspaces group
// (`[data-slot="sidebar.workspaces"]` inside its own region). They compete for
// the same vertical space, so this plugin offers three layouts for them:
//
//   b  the groups share one space and the control bar switches between them
//   c  the workspaces stay put and the panels open as an overlay
//   n  official default: both groups stay visible, no override at all
//
// 0.5.0 removed the old `a` (independent folding). Its four toggle states
// included an empty sidebar and a state identical to the official default,
// while the two useful states were already covered by `b`. Profiles that still
// hold `mode: a` are normalized to `n` on read, never written back.
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
    var VERSION = '1.1.5'
    var NS = 'sidebar-suite'
    var LS_KEY = 'dsh-sidebar-suite:state'
    // 1.1.5 — session favorites stay on this device. The key is separate from
    // the layout state because a layout is a preference and a favorite is user
    // content: clearing one must never clear the other.
    var FAVORITES_KEY = 'dsh-sidebar-suite:favorites.v1'
    var FAVORITES_COLLAPSED_KEY = 'dsh-sidebar-suite:favorites-collapsed'
    var FAVORITES_SEARCH_MIN = 8
    var FAVORITES_STYLE_ID = 'dsh-sidebar-suite-favorites-style'
    // 1.1.5 — favorites bridge tuning, pulled out of the inline literals so
    // the queue size, read window and listener debounce read as one set.
    var FAVORITE_QUEUE_MAX = 16
    var FAVORITE_ARCHIVE_READ_WINDOW_MS = 2000
    var FAVORITE_ARCHIVE_RECHECK_MS = 180
    // Web-login pacing constants live beside the web-login state block below:
    // that block is sliced and eval'd standalone by the login-snapshot tests,
    // so its bindings must travel with the block instead of this top scope.
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
    // The copy channel needs no pre-filled URL click. Its report now ends with
    // this exact destination — previously a copied report carried environment
    // data but no address, so the user could not tell where the author reads it.
    var FEEDBACK_DISCUSSIONS_URL = FEEDBACK_REPO + '/discussions'
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

    // 0.7.3: `showQuickSwitch` now actually defaults to false, which is what
    // README/DETAIL have documented since 0.2.9 ("Cycle is off by default").
    // The code had shipped `true` since 0.1.3, so the redundant Cycle button —
    // it only steps through the same three layouts the segmented pill already
    // exposes — appeared for everyone. Off by default keeps the bar honest:
    // one control per action.
    var DEFAULTS = { mode: 'b', showQuickSwitch: false, tab: 'ext' }
    // 0.5.0: the folded layout `a` is gone. Its id survives only as a read
    // alias so old profiles migrate to a visually equivalent layout.
    var MODES = ['b', 'c', 'n']
    var LEGACY_MODES = { a: 'n' }

    // 1.1.0 — the three pages the sidebar bar can show in the main column.
    // `agent` is not a registered panel: selecting null always means "let the
    // host render the current conversation". The other two are live `main`
    // panels registered further down. Their ids are stable across reloads.
    var PAGES = ['agent', 'chat', 'api']
    var PAGE_DEFS = {
      chat: {
        id: 'dsbs-deepseek-chat',
        url: 'https://chat.deepseek.com/',
        titleKey: 'page.chat.title',
        subKey: 'page.chat.sub',
        storageKey: 'dsh-sidebar-suite:web:chat',
        loginKey: 'chat',
      },
      api: {
        id: 'dsbs-deepseek-api',
        url: 'https://platform.deepseek.com/',
        titleKey: 'page.api.title',
        subKey: 'page.api.sub',
        storageKey: 'dsh-sidebar-suite:web:api',
        loginKey: 'api',
      },
    }
    var WEB_LOGIN_API = 'api/dsh-sidebar-suite.web-login'

    var DICTS = {
      en: {
        'bar.label': 'Sidebar layout',
        'bar.local': 'Settings are stored on this device only (the official config layer is unavailable).',
        // 1.1.0 — the three-page switch above the layout pill.
        'pages.label': 'Right panel page',
        'page.agent': 'Agent',
        'page.agent.hint': 'Back to the current agent conversation.',
        'page.chat': 'Chat',
        'page.chat.hint': 'Open DeepSeek’s free web chat in the right-hand area. Log in once; the login is kept on this device.',
        'page.api': 'API',
        'page.api.hint': 'Open the DeepSeek API console in the right-hand area. Log in once; the login is kept on this device.',
        'page.chat.title': 'DeepSeek Chat',
        'page.chat.sub': 'Official web chat · login kept locally',
        'page.api.title': 'DeepSeek API',
        'page.api.sub': 'API console · login kept locally',
        'page.loading': 'Connecting to DeepSeek…',
        'page.desktopOnly': 'This page needs the DSH desktop app.',
        'page.guestFailed': 'Could not open the embedded page.',
        'page.retry': 'Retry',
        'page.reload': 'Reload',
        'page.external': 'Open in browser',
        'page.loginNote': 'Log in on this page once. DSH stores the login on this device only.',
        'page.notReady': 'The page switch is not ready on this DSH build.',
        'page.deleteFailed': 'Could not clear the saved login.',
        'page.statusReady': 'Embedded page',
        'page.clearLogin': 'Clear saved login',
        'page.clearLoginConfirm': 'Confirm clear?',
        'page.clearLoginOk': 'Saved login cleared.',
        'page.clearLoginEmpty': 'No saved login on this device.',
        'page.clearLoginFail': 'Could not clear the saved login.',
        'page.credentialsUnavailable': 'The credential service is unavailable, so this login will not be kept on this device.',
        'mode.b': 'Toggle',
        'mode.b.hint': 'The two groups share one space; choose which one is shown.',
        'mode.c': 'Overlay',
        'mode.c.hint': 'Workspaces stay visible; panels open as an overlay.',
        'mode.n': 'Default',
        'mode.n.hint': 'Both groups stay visible — the official sidebar, with no layout override.',
        'quick.label': 'Cycle',
        'quick.hint': 'Cycle the sidebar layout.',
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
        // 0.8.3 — the only control left when the column collapses to a rail.
        'rail.menu.label': 'Sidebar menu',
        'rail.menu.hint': 'Switch layout or open a temporary session in a narrow sidebar.',
        'rail.menu.hintTemp': 'The Temp button does not fit at this width; open a temporary session here.',
        'rail.layout': 'Layout · pick one',
        'rail.sessionOnly': 'This session only',
        'rail.newTemp': 'New temporary session',
        'rail.hint': 'Press Esc or click outside to close.',
        'settings.title': 'Default layout on startup',
        'settings.help': 'Pick the layout DSH starts with. This writes the plugin config; switching from the sidebar bar is session-only. The Fold layout was removed in 0.5.0; profiles still set to a now open in Default.',
        'settings.unavailable': 'The config service is unavailable right now, so the default cannot be changed here.',
        'settings.current': 'Current default',
        'temp.label': 'Temp',
        'temp.hint': 'Open a temporary session: a real DSH session in this sidebar that is deleted when you quit.',
        // 0.8.4: the Temp button's tooltip ends with the live count, so the
        // button says what it will cost before it is clicked.
        'temp.countSuffix': ' · {n} active',
        'temp.creating': 'Creating…',
        'temp.created': 'Temporary session ready. It lives in the sidebar and is deleted when you quit DSH.',
        'temp.noNative': 'This DSH build did not expose its session navigation service.',
        'temp.failed': 'Could not create the temporary session: ',
        // 0.8.9: the host resolves its Agent preset before it creates anything,
        // and `selectedDefault` in the profile outlives the plugin that declared
        // the preset. When that string goes stale EVERY new session fails, the
        // host's own button included — so say that instead of echoing a
        // "session create failed: ..." chain that reads like our bug.
        'temp.presetMissing': 'DSH cannot create any session right now: its default agent preset "{name}" no longer exists (the plugin that declared it is missing or failed to load). The host\'s own New-session button fails the same way — this is not this plugin. Pick a preset that still exists in DSH settings, or reinstall the plugin that provided this one.',
        'temp.trackFailed': 'The session was created, but could not be registered as temporary — it will NOT be deleted when you quit DSH. ',
        'temp.trackUncertain': 'The session was created, but the temporary flag could not be confirmed — check the session before quitting DSH. ',
        'temp.timeout': 'Timed out creating the temporary session — the plugin host did not answer. Try again in a moment.',
        'temp.feedbackHint': 'Report it on the plugin detail page.',
        'temp.restartHint': 'Fully quit DSH (tray icon → Quit) and reopen it — a hot reload does not reload the plugin host.',
        'temp.badge': 'TEMP',
        'temp.menu.label': 'Temporary session actions',
        'temp.menu.keep': 'Keep as a normal session',
        'temp.menu.keep.hint': 'It will no longer be deleted when DSH quits.',
        'temp.menu.delete': 'Delete now',
        'temp.menu.delete.hint': 'Moves this session into the local trash; restore it from "Recently deleted" on this plugin page. Not uploaded anywhere.',
        'temp.menu.openDir': 'Open session folder',
        'temp.menu.openDir.hint': 'Shows the session log folder in your file manager.',
        'temp.menu.openDir.missing': 'The session folder is no longer on disk.',
        'temp.menu.openDir.copied': 'Folder path copied to clipboard — paste it into File Explorer.',
        'temp.menu.openDir.copyFailed': 'Could not copy the folder path automatically. Copy it manually: ',
        'temp.menu.kept': 'Kept as a normal session — it now survives quitting DSH.',
        'temp.menu.deleted': 'Temporary session moved to the trash.',
        'temp.menu.hidden': 'Files were locked, so the row was hidden instead. Deletion is retried next launch.',
        'temp.menu.failed': 'Action failed: ',
        // 1.1.5 — session favorites. The group is an additional, always-on
        // view; the star is the only marker inside the host's own rows.
        'fav.group': 'Favorites',
        'fav.group.hint': 'Starred sessions stay collected at the top.',
        'fav.collapse': 'Collapse favorites',
        'fav.expand': 'Expand favorites',
        'fav.add': 'Add to favorites',
        'fav.remove': 'Remove from favorites',
        'fav.search': 'Search favorites',
        'fav.searchEmpty': 'No favorite matches that search.',
        'fav.emptyAll': 'No favorites yet.',
        'fav.menu.label': 'Session favorites',
        'fav.failed': 'Could not update favorites: ',
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
        // 1.1.0 — 布局切换条上方的三段式页面开关。
        'pages.label': '右侧页面',
        'page.agent': '对话',
        'page.agent.hint': '回到当前 Agent 对话。',
        'page.chat': 'Chat',
        'page.chat.hint': '在右侧区域打开 DeepSeek 官网免费对话。登录一次后保存在本机。',
        'page.api': 'API',
        'page.api.hint': '在右侧区域打开 DeepSeek API 控制台。登录一次后保存在本机。',
        'page.chat.title': 'DeepSeek Chat',
        'page.chat.sub': '官网网页 · 登录状态保存在本机',
        'page.api.title': 'DeepSeek API',
        'page.api.sub': 'API 控制台 · 登录状态保存在本机',
        'page.loading': '正在连接 DeepSeek…',
        'page.desktopOnly': '此页面需要在 DSH 桌面版中使用。',
        'page.guestFailed': '无法打开内嵌网页。',
        'page.retry': '重试',
        'page.reload': '刷新',
        'page.external': '在浏览器打开',
        'page.loginNote': '请在此页面登录一次。DSH 只把登录状态保存在本机。',
        'page.notReady': '当前 DSH 版本还不支持页面切换。',
        'page.deleteFailed': '清除本机登录状态失败。',
        'page.statusReady': '内嵌网页',
        'page.clearLogin': '清除已保存登录',
        'page.clearLoginConfirm': '确认清除？',
        'page.clearLoginOk': '已清除本机登录状态。',
        'page.clearLoginEmpty': '本机没有已保存的登录。',
        'page.clearLoginFail': '清除本机登录状态失败。',
        'page.credentialsUnavailable': '凭据服务不可用，本次登录状态不会保存在本机。',
        'mode.b': '标签页',
        'mode.b.hint': '两组共用一栏，用标签页切换显示。',
        'mode.c': '浮层',
        'mode.c.hint': '工作区常驻，扩展以浮层展开。',
        'mode.n': '官方默认',
        'mode.n.hint': '两组都常驻，插件不改动侧栏布局。',
        'quick.label': '换布局',
        'quick.hint': '循环切换侧栏布局。',
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
        // 0.8.3 — 侧栏收成一条时唯一保留的入口，不是宽栏按钮的副本。
        'rail.menu.label': '侧栏菜单',
        'rail.menu.hint': '侧栏很窄时，在这里切换布局或新建临时会话。',
        'rail.menu.hintTemp': '这个宽度放不下「临时」按钮，在这里新建临时会话。',
        'rail.layout': '布局 · 三选一',
        'rail.sessionOnly': '仅本次会话有效',
        'rail.newTemp': '新建临时会话',
        'rail.hint': '按 Esc 或点击外侧关闭。',
        'settings.title': '启动时的默认布局',
        'settings.help': '选择 DSH 启动时使用的布局。这里会写入插件配置；在侧栏上临时切换不会改动它。0.5.0 起旧的「折叠」布局已移除，配置里仍写 a 的会自动切到「官方默认」。',
        'settings.unavailable': '配置服务暂时不可用，无法在这里修改默认布局。',
        'settings.current': '当前默认',
        'temp.label': '临时',
        'temp.hint': '开一个临时会话：就是左侧栏里的真实会话，退出 DSH 时删除。',
        // 0.8.11 — this key existed only in en, so the zh tooltip fell back
        // to " · N active" in the Chinese UI.
        'temp.countSuffix': ' · 当前 {n} 个临时会话',
        'temp.creating': '正在创建…',
        'temp.created': '临时会话已就绪：它在左侧栏里，退出 DSH 时自动删除。',
        'temp.noNative': '当前 DSH 版本没有暴露会话导航服务。',
        'temp.failed': '创建临时会话失败：',
        'temp.presetMissing': 'DSH 现在建不了任何会话：它的默认代理预设「{name}」已经不存在（提供这个预设的插件没装、或没加载起来）。宿主的「新会话」按钮也一样会失败，不是这个插件的问题。请在 DSH 设置里把默认预设换成还存在的一个，或重装提供它的插件。',
        'temp.trackFailed': '会话已创建，但未能登记为临时会话 —— 退出 DSH 时不会删除它。',
        'temp.trackUncertain': '会话已创建，但没能确认「临时」标记是否生效 —— 退出 DSH 前请复核这个会话。',
        'temp.timeout': '创建临时会话超时 —— 插件后端没有响应，请稍后再试。',
        'temp.feedbackHint': '可在插件详情页反馈。',
        'temp.restartHint': '请从托盘图标彻底退出 DSH 再打开 —— 热重载不会重载插件后端。',
        'temp.badge': '临时',
        'temp.menu.label': '临时会话操作',
        'temp.menu.keep': '保留为正式会话',
        'temp.menu.keep.hint': '退出 DSH 时不再删除它。',
        'temp.menu.delete': '立即删除',
        'temp.menu.delete.hint': '把这个会话移到本机回收站，可在本插件详情页的「最近删除」里恢复（不上传）。',
        'temp.menu.openDir': '打开会话目录',
        'temp.menu.openDir.hint': '在文件管理器里显示这个会话的日志目录。',
        'temp.menu.openDir.missing': '这个会话的目录已经不在磁盘上了。',
        'temp.menu.openDir.copied': '目录路径已复制 —— 粘贴到资源管理器地址栏即可打开。',
        'temp.menu.openDir.copyFailed': '无法自动复制目录路径，请手动复制：',
        'temp.menu.kept': '已保留为正式会话：退出 DSH 时不会再删除它。',
        'temp.menu.deleted': '临时会话已移到最近删除。',
        'temp.menu.hidden': '文件被占用，已先把它从列表里隐藏，下次启动再删。',
        'temp.menu.failed': '操作失败：',
        // 1.1.5 — 会话收藏：标题前的星标 + 侧栏顶部的「收藏夹」分组。
        'fav.group': '收藏夹',
        'fav.group.hint': '把标星的会话集中放在最上面。',
        'fav.collapse': '收起收藏夹',
        'fav.expand': '展开收藏夹',
        'fav.add': '收藏会话',
        'fav.remove': '取消收藏',
        'fav.search': '搜索收藏',
        'fav.searchEmpty': '没有匹配的收藏。',
        'fav.emptyAll': '暂无收藏。',
        'fav.menu.label': '会话收藏',
        'fav.failed': '收藏操作失败：',
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
      // 0.8.5 — the cleanup's past and future, from fields the status payload
      // always carried but the page never showed.
      'policy.lastPurge': '上次清理 · Last cleanup: ',
      'policy.lastPurgeNone': '还没有清理记录 · No cleanup has run yet',
      'policy.nextRun': '下次定时清理 · Next scheduled cleanup: ',
      'policy.nextRunOff': '未开启 · off',
      // 0.8.6 — a refused write names the control and explains the likely
      // cause, instead of surfacing a bare config key like "tab".
      'field.tab': '扩展/工作区切换 · the panels-workspaces switch',
      'field.mode': '默认布局 · the default layout',
      'policy.conflictHint': '宿主拒绝了这次写入（常见原因是保存时机冲突），已自动重试一次仍被拒；值已回滚，稍等一拍再点通常就能成功。 / the host refused this write (often a save-timing conflict); one in-place retry already failed and the value was rolled back — clicking again after a beat usually works.',
      'settings.intro': '一款专门针对改进 DSH 左侧栏体验的插件 —— 强实用性 + 美观性：沿用宿主原生观感，不另起一套皮肤。 / A plugin dedicated to the DSH sidebar experience — seriously practical and good-looking, built from native host design tokens.',
      'settings.title': '启动时的默认布局 · Default layout on startup',
      'settings.help': '选择 DSH 启动时使用的布局，这里会写入插件配置；在侧栏上临时切换只影响本次会话。0.5.0 起旧的「折叠」布局已移除，配置文件里仍写着 a 的会自动切到「官方默认」。 / Pick the layout DSH starts with — this writes the plugin config, while switching from the sidebar bar stays session-only. The Fold layout was removed in 0.5.0; profiles still set to a now open in Default.',
      'settings.unavailable': '配置服务暂时不可用，无法在这里修改默认布局。 / The config service is unavailable right now, so the default cannot be changed here.',
      'settings.current': '当前默认 / Current',
      'settings.support': '喜欢这个插件？请作者喝杯咖啡 · Enjoy it? Buy me a coffee',
      'settings.supportHint': '完全自愿，无任何回报承诺。用微信扫一扫即可；「设置 → 支持贡献者」里也登记了同一个码。 / Purely voluntary, no rewards promised. Scan with WeChat Pay; the same QR is registered under Settings → Support contributors.',
      'settings.qrAlt': '微信支付收款码 / WeChat Pay QR',
      // 0.7.4 — host version / contract self-check badge on the detail page.
      'health.label': '宿主 / 契约 · Host / checks',
      'health.expand': '展开运行自检 / Expand health details',
      'health.collapse': '收起运行自检 / Collapse health details',
      'health.title': '运行自检 · Health check',
      'health.dsh': 'DSH 版本 · DSH version',
      'health.plugin': '插件版本 · Plugin version',
      'health.unknown': '未知 · Unknown',
      'health.sidebar': '侧栏结构 · Sidebar structure',
      'health.sidebar.ok': '已识别 · Detected',
      'health.sidebar.fail': '未识别，布局可能异常 · Not detected, layout may be broken',
      'health.slot': '会话按钮插槽 · Session action slot',
      'health.slot.ok': '官方插槽 · Native slot',
      'health.slot.fallback': '旧版兼容路径 · Legacy fallback',
      'health.slot.pending': '尚未挂载 · Not mounted yet',
      'health.api': '私有接口 · Private API',
      'health.api.ok': '正常 · OK',
      'health.api.fail': '不可用 · Unavailable',
      'health.api.pending': '检测中… · Checking…',
      'health.recheck': '重新检测 · Recheck',
      'health.legend': '绿=正常；黄=兼容路径，功能仍可用；红=异常。 / Green = OK; yellow = compatibility path, still working; red = broken.',
      'health.hint': '红色时先点「重新检测」；仍然失败就到下面「反馈」复制报告，里面已带上版本和最近一次错误。 / If red, press Recheck first; if it stays red, copy a report from Feedback below — it already carries the version and last error.',
      'health.menu': '会话右键菜单 · Row context menu',
      'health.menu.ok': '宿主统一菜单 · Native menu extension',
      'health.menu.fallback': 'DOM 回退菜单 · DOM fallback',
      'health.tabs': '页签条 · Tab strip',
      'health.tabs.own': '自建页签（有消费方） · Self-hosted (consumers active)',
      'health.tabs.native': '宿主原生收纳可用 · Host native entry grouping available',
      'health.tabs.idle': '无第三方页签 · No third-party tabs',
      // 0.2.8 — every remaining config key becomes a switch on this page.
      'options.title': '侧栏与临时会话 · Sidebar & temp session options',
      'options.help': '每一项都会写入 DSH 数据目录里的 temp-session-config.txt（0.6.1 起，升级插件不会覆盖）。也可以直接用记事本改那个文件，保存后约 3 秒自动生效，不用重启 DSH；两边是同一个文件，不会打架，完整路径显示在下面。 / Every switch writes temp-session-config.txt in the DSH data directory (since 0.6.1, upgrades never overwrite it). You can also edit that file in Notepad — saves apply in about 3 seconds, no restart. Both paths share one file so they never disagree; the full path is shown below.',
      // 1.1.3 — this one is not a temp-session policy: it is stored in the
      // plugin's own config form, so the hint below says where it applies.
      'options.windowTitle': '窗口 / Window',
      'options.focusWindow': '启动时把 DSH 拉到前台 / Bring DSH forward on launch',
      'options.focusOn': '已开启 / On',
      'options.focusOff': '已关闭 / Off',
      'options.focusHint': '仅 Windows，默认关闭。打开后，DSH 启动完成时会把主窗口从后台恢复并置前一次；运行中不会反复抢焦点。 / Windows only, off by default. When on, DSH restores and brings its main window forward once after launch; it never steals focus repeatedly while running.',
      'options.focusTest': '立即试一次 / Test now',
      'options.focusTesting': '测试中… / Testing…',
      'options.focusTestOk': '已置前 / Brought forward',
      'options.focusTestFail': '置前失败 / Failed to bring forward: ',
      'options.focusUnsupported': '当前系统不支持（仅 Windows） / Not supported on this OS (Windows only)',
      'options.focusTestHint': '不用重启，点一下就能知道当前窗口能不能被拉到前台。 / No restart needed — click to check whether the window can be brought forward now.',
      'options.updateCheck': '检查更新 / Check updates',
      'options.updateChecking': '检查中… / Checking…',
      'options.updateAvailable': '有新版本 / Update available',
      'options.updateNone': '已是最新 / Up to date',
      'options.updateFailed': '检查失败 / Update check failed',
      'options.updateCurrent': '当前 / Current',
      'options.updateLatest': '最新 / Latest',
      'options.updateCopy': '复制更新命令 / Copy update command',
      'options.updateCopied': '命令已复制 / Command copied',
      'options.updateNote': '安装后需完全退出并重新打开 DSH 才生效；命令里的 desktop 要换成你正在用的 profile。 / After installing, fully quit and reopen DSH for it to take effect; replace `desktop` in the command with the profile you are using.',
      'options.updateHint': '仅向 npm 查询版本号，不上传本机信息。 / Queries npm for the version number only; no local data is uploaded.',
      'options.showButton': '显示「临时」按钮 / Show the Temp button',
      'options.inChatMode': 'CHAT 官网模式 / In CHAT mode',
      'options.chatHide': '隐藏按钮 / Hide',
      'options.chatShow': '照常显示 / Show',
      'options.buttonStyle': '按钮摆法 / Button layout',
      'options.stylePair': '并排 / Pair',
      'options.styleOwn': '独占一行 / Own row',
      'options.expandAll': '会话默认全展开 / Always expand sessions',
      'options.expandHint': '关掉后恢复 DSH 原来的折叠行为；已经展开的列表要切换一次工作区才会收回去。 / Turning it off restores host folding; already-expanded groups collapse after you switch workspaces once.',
      'options.rowMenu': '临时会话右键菜单 / Right-click menu on temp sessions',
      'options.rowMenuHint': '右键临时会话可「保留为正式会话」或「立即删除」。若和别的插件抢右键菜单，关掉这一项即可。 / Right-clicking a temp session offers "keep as normal" or "delete now". Turn this off if another plugin owns the context menu.',
      'options.maxKept': '最多保留 / Keep at most',
      'options.maxKeptHint': '个临时会话（1–200） / temp sessions (1–200)',
      'options.keepDeleted': '删除后保留可恢复 / Keep deleted (recoverable)',
      'options.keepDeletedHint': '天（1–365）。删除的会话先移到本机回收站，这段时间内可恢复；过期或超过 20 个 / 200MB 自动清掉。关闭后恢复「直接删除」。 / days (1–365). Deleted sessions go to a local trash first and can be restored in that window; older or beyond 20 items / 200 MB is cleared. Off restores straight deletion.',
      'trash.title': '最近删除 / Recently deleted',
      'trash.help': '这里只保存本机删掉的临时会话，不会上传。恢复后它变成普通会话，不再算「临时」。 / Only sessions deleted on this machine are kept here — nothing is uploaded. A restored session becomes a normal session again.',
      // 0.8.4 — the active side of the same lifecycle: what is temporary RIGHT
      // NOW, with the same keep/delete actions the row menu offers. The detail
      // page used to manage only the aftermath (trash) while the live list was
      // reachable solely by hunting rows in the sidebar.
      'tempList.title': '当前临时会话 · Active temporary sessions',
      'tempList.help': '这些会话在退出 DSH 时会被删除（策略见下一节）。在这里可以保留或立即删除，和会话行右键菜单是同一批动作。 / These sessions are deleted when DSH quits (policy below). Keep or delete them here — the same actions the session row\'s right-click menu offers.',
      'tempList.none': '现在没有临时会话。 / No temporary sessions right now.',
      'tempList.keep': '保留为正式会话 / Keep',
      'tempList.delete': '立即删除 / Delete now',
      'tempList.confirm': '确认删除？ / Really delete?',
      'tempList.kept': '已保留为正式会话：退出 DSH 时不会再删除。 / Kept — it now survives quitting DSH.',
      'tempList.deleted': '已移入最近删除，可在下方恢复。 / Moved to Recently deleted below — restorable there.',
      // 0.8.5 — one call promotes the whole list; the row-by-row path stays.
      'tempList.keepAll': '全部保留 / Keep all',
      'tempList.keptAll': '已全部保留为正式会话。 / All kept as normal sessions.',
      'tempList.keepAllConfirm': '再点一次确认全部保留；5 秒后自动取消。 / Click again to confirm keeping all; this cancels itself in 5s.',
      'trash.empty': '清空 / Empty',
      'trash.working': '处理中… / Working…',
      'trash.emptied': '已清空 / Emptied: ',
      'trash.restore': '恢复 / Restore',
      'trash.restored': '已恢复，回到会话列表 / Restored to your session list',
      'trash.delete': '彻底删除 / Delete',
      // 0.8.1: the two irreversible buttons in this section ask twice.
      'trash.confirm.delete': '确认彻底删除？ / Really delete?',
      'trash.confirm.empty': '确认清空？ / Really empty?',
      'trash.confirmHint': '再点一次才会执行，5 秒后自动取消。 / Click again to confirm; this cancels itself in 5s.',
      'trash.cancel': '取消 / Cancel',
      'trash.emptyFailed': '部分未清掉 / Some items could not be removed: ',
      'trash.none': '还没有删除过临时会话。 / Nothing deleted yet.',
      'trash.off': '「删除后保留」已关闭，之后删除即彻底移除；下面这些还没过期，仍可恢复或清空。 / Keep-deleted is off, so future deletions are permanent. The items below are still restorable until they expire.',
      'trash.loading': '正在读取… / Loading…',
      'trash.failed': '操作失败 / Failed: ',
      // 0.8.2: a watchdog timeout is "unknown outcome", not a failed write.
      'op.timeout': '操作超时，后端可能仍在处理；请先刷新核对结果，再决定是否重试，以免重复执行。 / Timed out — the host may still be applying it. Refresh and check the result before retrying, to avoid doing it twice.',
      'trash.count': '共 / total: ',
      // 0.8.4: the count lines used to hard-code the CJK measure word, so the
      // English UI read "total: 3 条 · 12 MB".
      'trash.countUnit': '条 / items',
      'trash.days': '天 / days',
      // 0.8.1: the retention caps come from the Host instead of being implied.
      'trash.caps': '上限 / cap: ',
      'trash.capsNote': '（超出时从最旧的清，最新一条不受体积限制） / (oldest go first; the newest is exempt from the size cap)',
      'trash.oversize': '超过单条体积上限，仍保留到过期 / over the size cap — kept until it expires',
      'trash.restoreBlocked': '同名会话目录还在，先把这里的副本移走再恢复 / a session with this id still exists on disk: ',
      'options.purge': '立即清理临时会话 / Clean up now',
      'options.purging': '清理中… / Cleaning…',
      'options.purged': '已清理 / Removed ',
      // 0.8.1: with the trash on, "cleanup" no longer means gone for good.
      'options.purgedTrash': '已移入最近删除 / Moved to Recently deleted: ',
      'options.purgeFailed': '清理失败 / Cleanup failed: ',
      'options.rev': '设置版本 / Settings rev',
      // 0.8.4: the config path is a button — clicking copies it, so a user who
      // wants to open it in Notepad no longer selects the text by hand.
      'options.copyPath': '点击复制配置文件路径 / Click to copy the config file path',
      'options.copied': '路径已复制 / Path copied',
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
      'feedback.where': '作者在哪收到：issue 进本仓库的 Issues（仓库所有者默认会收到通知）；市场评论进 awesome-dsh-plugin 仓库的 Discussions（作者需要 watch 那条讨论）；「复制反馈内容」不会自动发送，但报告末尾已附上这两个地址，粘到 github.com/YONAN1269/dsh-sidebar-suite/discussions 新建讨论，或粘进 issue 即可送达。 / Where the author sees it: issues land in this repo (the owner is normally notified); marketplace comments land in the awesome-dsh-plugin Discussions (the author must watch that thread); copied text is never sent automatically, but the report ends with both addresses — paste it into a new discussion at github.com/YONAN1269/dsh-sidebar-suite/discussions or into an issue to reach me.',
      'feedback.marketHint': '市场评论区如果显示「没有匹配的讨论」，说明还没人留言：回 DSH 的插件市场，找到 dsh-sidebar-suite 卡片点「评论」，第一条留言会自动建帖。 / If GitHub says there are no matching discussions yet, open the plugin market in DSH, find the dsh-sidebar-suite card and press "评论 / Comments" — the first comment creates that thread.',
    }
    for (var lang in DICTS) {
      if (!Object.prototype.hasOwnProperty.call(DICTS, lang)) continue
      for (var key in BILINGUAL_SETTINGS) {
        if (Object.prototype.hasOwnProperty.call(BILINGUAL_SETTINGS, key)) DICTS[lang][key] = BILINGUAL_SETTINGS[key]
      }
    }

    var CSS = [
      // 0.8.10 — the bar is injected into scrollRegion, whose own left edge is the
      // sidebar's 8px padding, while every host row (the New-session row above
      // it, the session rows below) sits a further `paint-inset + 1px` in. With
      // no inline margin the pill hung 4px left of the New-session button and
      // 4px right of the rows under it — a visible kink in an otherwise straight
      // gutter. Mirror the host row's own margin expression instead of a
      // hard-coded number, so a host that changes its inset carries us with it
      // (measured on 0.2.3-alpha.2: pill 36px, button 46px at 250% scaling).
      '[data-dsbs-bar]{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:2px 0 6px;margin:0 calc(var(--dsh-sidebar-paint-inset,3px) + 1px);flex:none;min-width:0}',
      '[data-dsbs-bar] [hidden]{display:none!important}',
      // 0.7.3: the bar itself carries `display:flex` from the two rules below,
      // and an author declaration always beats the UA sheet's
      // `[hidden]{display:none}`. Without this rule `bar.setAttribute('hidden')`
      // (used when a consumer tab owns the column) was a no-op.
      '[data-dsbs-bar][hidden]{display:none!important}',
      '[data-dsbs-sep]{width:1px;height:12px;flex:none;border-radius:1px;margin:0 1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.3))}',
      '[data-dsbs-bar] button{appearance:none;-webkit-appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:11px;line-height:15px;padding:2px 6px;border-radius:6px;cursor:pointer;user-select:none;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}',
      '[data-dsbs-bar] button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,inherit)}',
      '[data-dsbs-bar] button[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.22));color:var(--dsw-alias-label-primary,inherit);font-weight:500}',
      '[data-dsbs-bar] button:focus-visible{outline:2px solid var(--dsw-alias-label-primary,currentColor);outline-offset:1px}',
      // 0.8.10: no `margin-left:auto` here. The divider already owns the auto
      // margin that pushes the action group to the right edge; a second one on
      // Cycle split the free space between the two, so turning Cycle on left the
      // divider stranded mid-column with Cycle alone at the far right.
      '[data-dsbs-bar] button[data-dsbs-btn="quick"]{color:var(--dsw-alias-label-tertiary,inherit);padding:2px 6px}',
      'html[data-dsbs-narrow="true"] [data-dsbs-btn="quick"]{display:none}',
      'html[data-dsbs-rail="true"] [data-dsbs-bar]{display:none}',
      // 0.8.3 — when the bar is gone, ONE control remains. It lives outside
      // [data-dsbs-bar] on purpose: hiding the bar must not hide the way back.
      // The panel holds only actions that were hidden by the rail, never a
      // third copy of the wide-layout buttons.
      '[data-dsbs-rail-menu]{display:none;position:relative;flex:none;align-items:center;justify-content:center;padding:6px 5px 0}',
      'html[data-dsbs-rail="true"] [data-dsbs-rail-menu],html[data-dsbs-railmenu="true"] [data-dsbs-rail-menu]{display:flex}',
      '[data-dsbs-rail-menu][hidden]{display:none!important}',
      'html[data-dsbs-ptab="true"] [data-dsbs-rail-menu]{display:none!important}',
      // Icon only: 4 CJK glyphs (12 latin characters) do not fit a 28px box and
      // would print over the mask. The accessible name comes from aria-label.
      '[data-dsbs-rail-menu] > button{appearance:none;-webkit-appearance:none;position:relative;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:28px;height:26px;padding:0;font-size:0;line-height:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.4));border-radius:7px;background:var(--dsw-alias-bg-subtle,rgba(127,127,127,.08));color:var(--dsw-alias-label-primary,inherit);cursor:pointer}',
      '[data-dsbs-rail-menu] > button::before{content:"";position:absolute;inset:0;margin:auto;width:15px;height:15px;background:currentColor;-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22%3E%3Cpath d=%22M3 4h10M3 8h10M3 12h10%22/%3E%3C/svg%3E");-webkit-mask-size:15px 15px;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;mask-image:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22%3E%3Cpath d=%22M3 4h10M3 8h10M3 12h10%22/%3E%3C/svg%3E");mask-size:15px 15px;mask-position:center;mask-repeat:no-repeat}',
      '[data-dsbs-rail-menu] > button[aria-expanded="true"]{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary,#4d6bfe));background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.22))}',
      '[data-dsbs-rail-menu] > button:focus-visible{outline:2px solid var(--dsw-alias-label-primary,currentColor);outline-offset:1px}',
      '[data-dsbs-rail-panel]{position:fixed;z-index:9500;box-sizing:border-box;width:236px;max-width:calc(100vw - 16px);padding:10px;display:flex;flex-direction:column;gap:8px;border-radius:10px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base,#fff));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));box-shadow:0 12px 32px rgba(0,0,0,.24);color:var(--dsw-alias-label-primary,inherit)}',
      '[data-dsbs-rail-panel][hidden]{display:none!important}',
      // The panel re-uses itself across two widths: below 100px it carries the
      // layouts, between 100 and 170px only the Temp action. Sections that do
      // not apply are removed with `hidden`, so the rule has to win over the
      // display values set on them below.
      '[data-dsbs-rail-panel] > *[hidden]{display:none!important}',
      '[data-dsbs-rail-head]{display:flex;justify-content:space-between;align-items:baseline;gap:6px;font-size:12px;font-weight:500}',
      '[data-dsbs-rail-head] span{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}',
      '[data-dsbs-rail-panel] button{appearance:none;-webkit-appearance:none;box-sizing:border-box;border:1px solid transparent;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1.4;cursor:pointer;padding:5px 7px}',
      '[data-dsbs-rail-panel] [data-dsbs-rail-mode]{flex:1;display:flex;align-items:center;justify-content:center;min-height:27px;white-space:nowrap}',
      '[data-dsbs-rail-panel] [data-dsbs-rail-modes]{display:flex;gap:3px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-subtle,rgba(127,127,127,.08))}',
      '[data-dsbs-rail-panel] [data-dsbs-rail-mode][aria-checked="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.2));border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35));font-weight:500}',
      '[data-dsbs-rail-panel] [data-dsbs-rail-temp]{width:100%;text-align:left;border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}',
      '[data-dsbs-rail-panel] [data-dsbs-rail-temp]:hover,[data-dsbs-rail-panel] [data-dsbs-rail-mode]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      '[data-dsbs-rail-panel] button:focus-visible{outline:2px solid var(--dsw-alias-label-primary,currentColor);outline-offset:-1px}',
      '[data-dsbs-rail-foot]{font-size:11px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}',
      // b — the two groups are mutually exclusive
      'html[data-dsbs-mode="b"][data-dsbs-tab="ext"] div:has(> [data-slot="sidebar.workspaces"]){display:none}',
      'html[data-dsbs-mode="b"][data-dsbs-tab="ws"] nav[data-dsbs-ext]{display:none}',
      // n — official default: deliberately NO rule. The point of this layout
      // is that neither group is hidden; do not add a display declaration for
      // data-dsbs-mode="n" here or in the runtime state machine below.
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
      // Unified disabled look for our own settings/webpage controls. Scoped to
      // plugin containers so host controls elsewhere on the detail page keep
      // their own disabled styling. Element-level selectors (button/input plus
      // the [disabled] attribute) outrank the host's component-class disabled
      // rules (e.g. `.selector:disabled`, `.input:disabled`, `.trigger:disabled`
      // in the unpacked `@deepseek-ai/*` bundles); none of those host rules
      // carry `!important`, so no plugin-side `!important` is needed. The
      // schedule-time input used to fade itself with an inline `opacity:.55`,
      // which a stylesheet rule could not override; that inline fade was
      // removed and now rides this shared rule.
      '[data-dsbs-config] button[disabled],[data-dsbs-config] input[disabled],[data-dsbs-webpage-actions] button[disabled]{opacity:.4;cursor:default}',
      // The pills, layout cards and number inputs above are inline-styled, so
      // the :focus-visible pseudo cannot live on the element itself. Reuse the
      // same --dsw-focus-ring-* tokens as the temp-slot button instead of a new
      // outline color.
      '[data-dsbs-config] button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,currentColor);outline-offset:1px}',
      '[data-dsbs-config] input[type="number"]:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,currentColor);outline-offset:1px}',
      // ---- always-expanded session list (0.2.4) -----------------------
      // The host workspace browser renders one overflow button per group as
      // <button data-row-key="overflow:<group>"> when its 5-row watermark
      // hides the rest (verified in @deepseek-ai/dsh-client-ui-workspace:
      // "sessions.expand" / "展开其余 {n} 个会话"). We drive that button until
      // every group is expanded, then hide it: with all sessions visible the
      // "收起" half of the control is pointless too. Only active while the
      // config says on, so EXPAND_ALL_SESSIONS=off restores the host's UI.
      //
      // 1.1.4: the hide is gated on `aria-expanded="true"`. The host renders
      // the button whenever its 5-row watermark hides content — including the
      // first ~600 ms after a group is (re)expanded, before this plugin has
      // pressed it. Hiding unconditionally left the user looking at 5 of 8
      // rows with the only "展开其余" affordance invisible (measured on the
      // 0.2.3 desktop build via CDP: t+250 ms → 5/8 rows, button
      // aria-expanded=false and display:none; t+850 ms → 8/8). Gating keeps
      // "收起" hidden once the group is fully open and hands the host button
      // back during the window where it is still the user's way in.
      'html[data-dsbs-expand-all="true"] button[data-row-key^="overflow:"][aria-expanded="true"]{display:none!important}',
      // ---- temporary chat (0.1.7; host seat since 0.6.0) ----------------
      // DSH 0.2.2-rc.3 declares `sidebar.session.action`: a hoc layer the host
      // renders *inside* its own New-session row. We register an occupant that
      // owns one empty seat and mount the button into that seat, so the row's
      // flex layout, the wide/rail switch and the collapse fade all come from
      // the host instead of a negative-margin trick. Hosts that never declared
      // the slot fall back to the <= rc.2 path, gated on
      // html[data-dsbs-temp-mode="dom"].
      // Both rows only exist in HARNESS mode: dsh-deepseek-chat swaps the
      // sidebar for its own website navigation in CHAT mode, so every rule
      // here is gated on html:not([data-dsbs-chat-mode]).
      // Seat geometry: the host button keeps its own width, the row's `gap`
      // spaces the two controls.
      'html[data-dsbs-temp-mode="slot"] [data-dsbs-temp-slot]{display:flex;flex:0 0 auto;align-items:center;box-sizing:border-box;width:80px;min-width:0;z-index:2}',
      'html[data-dsbs-temp-mode="slot"] [data-dsbs-temp-slot] > [data-dsbs-btn="temp"]{height:38px}',
      // TEMP_BUTTON_STYLE=own: the host row wraps, our seat takes a whole line.
      'html[data-dsbs-temp-mode="slot"][data-dsbs-temp-style="own"] [data-dsbs-newchat]{flex-wrap:wrap}',
      'html[data-dsbs-temp-mode="slot"][data-dsbs-temp-style="own"] [data-dsbs-temp-slot]{flex:0 0 100%;width:auto}',
      'html[data-dsbs-temp-mode="slot"][data-dsbs-temp-style="own"] [data-dsbs-temp-slot] > [data-dsbs-btn="temp"]{height:32px}',
      // Legacy (<= DSH 0.2.2-rc.2): no seat exists, so we add one sibling and
      // pull it back onto the previous row with a negative margin, keeping the
      // net flow height at zero and every following group in place.
      'html[data-dsbs-temp-mode="dom"]:not([data-dsbs-chat-mode]) [data-dsbs-newchat] button[class*="newSession"]{height:34px!important;width:calc(100% - 92px)!important;min-width:0!important;flex:0 0 auto!important;margin:0 0 10px!important;font-size:12px!important;line-height:20px!important}',
      'html[data-dsbs-temp-mode="dom"]:not([data-dsbs-chat-mode]) [data-dsbs-newchat] button[class*="newSession"] > span[class*="newSessionShortcut"]{display:none!important}',
      // 0.8.9: same chip, seat mode. The host keeps the shortcut hidden
      // (`opacity:0`) and slides it in on `:hover`/`:focus-visible` while the
      // label fades under a mask. That trade assumes the button owns the whole
      // row; with our 80px seat beside it the chip lands right on the seam
      // between the two buttons, so hovering "New session" paints "Ctrl + N"
      // over the gap as if it belonged to the Temp button. The shortcut itself
      // still works (the key handler is global, not in this span) — only the
      // hint is dropped, and only while our button shares the row.
      'html[data-dsbs-temp-mode="slot"]:not([data-dsbs-chat-mode]) [data-dsbs-newchat] button[class*="newSession"] > span[class*="newSessionShortcut"]{display:none!important}',
      // ...and the label keeps its last pixels. The fade above is written as
      // `:has(+.newSessionShortcut)`, so hiding the chip leaves the match true
      // and the label would end in a 16px gradient for nothing. Only on hover
      // and only the two declarations the host adds there.
      'html[data-dsbs-temp-mode="slot"]:not([data-dsbs-chat-mode]) [data-dsbs-newchat] button[class*="newSession"]:hover > span[class*="newSessionLabelMask"]{overflow:visible!important;mask-image:none!important}',
      'html[data-dsbs-temp-mode="slot"]:not([data-dsbs-chat-mode]) [data-dsbs-newchat] button[class*="newSession"]:focus-visible > span[class*="newSessionLabelMask"]{overflow:visible!important;mask-image:none!important}',
      // Escape hatch for layouts that fight the two-button row (e.g. another
      // plugin's header row above the sidebar). TEMP_BUTTON_STYLE=own puts the
      // Temp button on its own full-width row and leaves New Session untouched.
      'html[data-dsbs-temp-mode="dom"][data-dsbs-temp-style="own"] [data-dsbs-newchat] button[class*="newSession"]{height:38px!important;width:auto!important;font-size:14px!important;line-height:22px!important;margin:0 calc(var(--dsh-sidebar-paint-inset,3px) + 1px) 10px!important}',
      'html[data-dsbs-temp-mode="dom"][data-dsbs-temp-style="own"] [data-dsbs-newchat] > [data-dsbs-temp-slot]{width:auto!important;align-self:stretch!important;margin:0 calc(var(--dsh-sidebar-paint-inset,3px) + 1px) 10px!important}',
      'html[data-dsbs-temp-mode="dom"][data-dsbs-temp-style="own"] [data-dsbs-temp-slot] > [data-dsbs-btn="temp"]{width:auto!important;height:32px!important;text-align:center!important}',
      // In the legacy path the Temp button is never a direct child of the
      // sidebar root: it sits in its own <div>. dsh-deepseek-chat walks that
      // root and requires exactly ONE direct <button> child (the host's New
      // Session); a second one makes its sidebar adapter bail out and it paints
      // the "当前侧栏不兼容" notice above the CHAT / HARNESS switcher.
      'html[data-dsbs-temp-mode="dom"] [data-dsbs-newchat] > [data-dsbs-temp-slot]{display:flex;flex:none;align-self:flex-end;box-sizing:border-box;margin:-44px 4px 10px 0;width:80px;z-index:2}',
      '[data-dsbs-temp-slot][hidden]{display:none!important}',
      // The on/off switch also lives on <html>: in slot mode React owns the seat
      // element, and a re-render can drop an attribute we set on it directly.
      'html[data-dsbs-temp-off="true"] [data-dsbs-temp-slot]{display:none!important}',
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
      'html[data-dsbs-temp-mode="dom"][data-dsbs-temp-solo="true"]:not([data-dsbs-chat-mode]) [data-dsbs-newchat] button[class*="newSession"]{width:auto!important;height:38px!important;font-size:14px!important;line-height:22px!important;margin:0 calc(var(--dsh-sidebar-paint-inset,3px) + 1px) 10px!important}',
      // ---- per-row menu on temporary sessions (0.4.0) -------------------
      // Right-clicking a temporary row offers "keep as normal" and "delete
      // now". Styled from host tokens like every other surface here; the row
      // itself gains no children, so React re-renders cannot wipe it.
      '[data-dsbs-temp-menu]{position:fixed;z-index:9400;min-width:196px;max-width:min(280px,calc(100vw - 16px));box-sizing:border-box;padding:4px;display:flex;flex-direction:column;gap:1px;border-radius:10px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base,#1f1f1f));color:var(--dsw-alias-label-primary,inherit);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));box-shadow:0 12px 32px rgba(0,0,0,.32)}',
      '[data-dsbs-temp-menu][hidden]{display:none!important}',
      '[data-dsbs-temp-menu-head]{padding:4px 8px 6px;margin-bottom:2px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '[data-dsbs-temp-menu] button{appearance:none;-webkit-appearance:none;display:block;width:100%;box-sizing:border-box;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1.45;text-align:left;padding:6px 8px;border-radius:7px;cursor:pointer;white-space:normal}',
      '[data-dsbs-temp-menu] button:hover,[data-dsbs-temp-menu] button:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));outline:none}',
      '[data-dsbs-temp-menu] button:focus-visible{outline:2px solid var(--dsw-alias-label-primary,currentColor);outline-offset:-2px}',
      '[data-dsbs-temp-menu] button[data-dsbs-temp-action="delete"]{color:var(--dsw-alias-state-business-danger,#d9534f)}',
      '[data-dsbs-temp-menu-sub]{display:block;font-size:10px;line-height:1.4;opacity:.68}',
      'html[data-dsbs-temp-menu="false"] [data-dsbs-temp-menu]{display:none!important}',
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
      // n — official default: both stacked groups stay visible
      '[data-dsbs-bar] [data-dsbs-glyph="n"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Crect x=%222.5%22 y=%222.5%22 width=%2211%22 height=%2211%22 rx=%222.5%22/%3E%3Cpath d=%22M5.5 6.5h5M5.5 9.5h3%22/%3E%3C/svg%3E")}',
      // b — one column split down the middle
      '[data-dsbs-bar] [data-dsbs-glyph="b"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Crect x=%222.5%22 y=%222.5%22 width=%2211%22 height=%2211%22 rx=%222.5%22/%3E%3Cpath d=%22M8 3v10%22/%3E%3C/svg%3E")}',
      // c — a panel floating above the column
      '[data-dsbs-bar] [data-dsbs-glyph="c"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Crect x=%222.5%22 y=%226.5%22 width=%229%22 height=%227%22 rx=%221.8%22/%3E%3Cpath d=%22M7.2 6.5V4.4a1.6 1.6 0 011.6-1.6h3.1a1.6 1.6 0 011.6 1.6v3.9%22/%3E%3C/svg%3E")}',
      // swap — trade the two tabs
      '[data-dsbs-bar] [data-dsbs-glyph="swap"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M2.5 5.5h9.5M9.5 3.2l2.5 2.3-2.5 2.3%22/%3E%3Cpath d=%22M13.5 10.5H4M6.5 8.2l-2.5 2.3 2.5 2.3%22/%3E%3C/svg%3E")}',
      // pop — detach the panel
      '[data-dsbs-bar] [data-dsbs-glyph="pop"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Crect x=%222.5%22 y=%222.5%22 width=%228%22 height=%228%22 rx=%221.8%22/%3E%3Cpath d=%22M9.5 13.5h3.5v-3.5M13 13l-4-4%22/%3E%3C/svg%3E")}',
      // cycle — walk the three layouts in order
      // 0.7.3: the Cycle glyph used to be a pair of curved arrows, which read
      // almost identically to the straight swap arrows next to it once the
      // column narrows to icons only. A four-quadrant layout mark says
      // "change the arrangement" without borrowing the swap vocabulary.
      '[data-dsbs-bar] [data-dsbs-glyph="quick"]{--dsbs-icon:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.4%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Crect x=%222.6%22 y=%222.6%22 width=%224.7%22 height=%224.7%22 rx=%221.3%22/%3E%3Crect x=%228.7%22 y=%222.6%22 width=%224.7%22 height=%224.7%22 rx=%221.3%22/%3E%3Crect x=%222.6%22 y=%228.7%22 width=%224.7%22 height=%224.7%22 rx=%221.3%22/%3E%3Crect x=%228.7%22 y=%228.7%22 width=%224.7%22 height=%224.7%22 rx=%221.3%22/%3E%3C/svg%3E")}',
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

      // ---- three-page switch (1.1.0) -----------------------------------
      // A compact pill in the sidebar logo row, to the right of the brand.
      // The logo is zoomed down a little while it is visible so the three
      // labels fit in the space the full wordmark would otherwise occupy.
      '[data-dsbs-pages]{display:inline-flex;align-items:center;gap:1px;box-sizing:border-box;margin:0 0 0 2px;padding:1px;border-radius:8px;background:color-mix(in srgb,currentColor 8%,transparent);flex:0 0 auto;min-width:0;max-width:52%;height:24px}',
      '[data-dsbs-pages][hidden]{display:none!important}',
      '[data-dsbs-pages] button{appearance:none;-webkit-appearance:none;flex:1 1 auto;box-sizing:border-box;min-width:0;height:22px;margin:0;padding:0 5px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:10.5px;font-weight:400;line-height:22px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;transition:background-color .14s ease,opacity .14s ease}',
      '[data-dsbs-pages] button:hover{background:color-mix(in srgb,currentColor 8%,transparent);color:var(--dsw-alias-label-primary,inherit)}',
      '[data-dsbs-pages] button[aria-pressed="true"]{background:color-mix(in srgb,currentColor 20%,transparent);color:var(--dsw-alias-label-primary,inherit);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.22)}',
      '[data-dsbs-pages] button[aria-pressed="false"]{opacity:.72}',
      '[data-dsbs-pages] button:focus-visible{outline:2px solid var(--dsw-alias-label-primary,currentColor);outline-offset:1px}',
      '[data-dsbs-pages] button:disabled{opacity:.34;cursor:default;background:transparent}',
      'html[data-dsbs-rail="true"] [data-dsbs-pages]{display:none!important}',
      'html[data-dsbs-ptab="true"] [data-dsbs-pages]{display:none!important}',
      'html[data-dsbs-chat-mode] [data-dsbs-pages]{display:none!important}',
      // Only while the page pill is actually in the logo row; removing it
      // restores the full-size wordmark.
      '[data-dsbs-brand="compact"]{zoom:.78}',

      // ---- embedded DeepSeek pages (1.1.0) -----------------------------
      // Registered as host `main` panels, so the shell, the right sidebar and
      // every navigation shortcut keep working exactly as they do on the
      // Plugins page. Only the panel body belongs to this stylesheet.
      '[data-dsbs-webpage]{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,inherit)}',
      '[data-dsbs-webpage-head]{display:flex;align-items:center;gap:8px;box-sizing:border-box;flex:none;min-height:36px;padding:4px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.24));background:var(--dsw-alias-bg-subtle,rgba(127,127,127,.06))}',
      '[data-dsbs-webpage-title]{display:flex;align-items:baseline;gap:8px;flex:1 1 auto;min-width:0}',
      '[data-dsbs-webpage-title] strong{flex:none;font-size:12px;font-weight:600;line-height:18px;white-space:nowrap}',
      '[data-dsbs-webpage-title] span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}',
      '[data-dsbs-webpage-actions]{display:flex;align-items:center;gap:4px;flex:none}',
      '[data-dsbs-webpage-actions] button{appearance:none;-webkit-appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:11px;line-height:16px;padding:2px 8px;cursor:pointer;white-space:nowrap}',
      '[data-dsbs-webpage-actions] button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      '[data-dsbs-webpage-actions] button:focus-visible{outline:2px solid var(--dsw-alias-label-primary,currentColor);outline-offset:1px}',
      '[data-dsbs-webpage-body]{position:relative;display:flex;flex:1 1 auto;min-height:0;background:var(--dsw-alias-bg-base,#fff)}',
      '[data-dsbs-webpage-body] webview{display:flex;flex:1 1 auto;width:100%;height:100%;border:0;background:var(--dsw-alias-bg-base,#fff)}',
      '[data-dsbs-webpage-status]{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;box-sizing:border-box;padding:24px;text-align:center;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,inherit)}',
      '[data-dsbs-webpage-status][hidden]{display:none!important}',
      '[data-dsbs-webpage-status] strong{font-size:13px;font-weight:600;line-height:1.5}',
      '[data-dsbs-webpage-status] p{max-width:420px;margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,inherit)}',
      '[data-dsbs-webpage-status] button{appearance:none;-webkit-appearance:none;margin-top:2px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));border-radius:8px;background:var(--dsw-alias-button-elevated-fill,transparent);color:inherit;font:inherit;font-size:12px;line-height:18px;padding:5px 12px;cursor:pointer}',
      '[data-dsbs-webpage-status] button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      // CH-06: credentials-unavailable note floats above the webview, centered
      // at the bottom; gold warns without the danger red reserved for errors.
      '[data-dsbs-webpage-cred-unavailable]{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:3;max-width:min(520px,calc(100% - 32px));box-sizing:border-box;margin:0;padding:7px 12px;border-radius:9px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base,#1f1f1f));color:var(--dsw-alias-state-business-warning,#e8b931);border:1px solid rgba(232,185,49,.4);font:inherit;font-size:12px;line-height:1.5;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.28)}',
      '[data-dsbs-webpage-pulse]{width:26px;height:26px;border-radius:50%;background:color-mix(in srgb,currentColor 10%,transparent);box-shadow:0 0 0 0 color-mix(in srgb,currentColor 22%,transparent);animation:dsbs-web-pulse 1.8s ease-out infinite}',
      '@keyframes dsbs-web-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,currentColor 22%,transparent)}70%{box-shadow:0 0 0 12px transparent}100%{box-shadow:0 0 0 0 transparent}}',
      // Honor reduced-motion: the status pulse is decorative, so it stops
      // instead of animating for users who opted out of motion.
      '@media (prefers-reduced-motion: reduce){[data-dsbs-webpage-pulse]{animation:none}}',

      // ---- third-party page strip (0.3.0) ------------------------------
      // The strip only exists while at least one plugin registered a tab, so a
      // stock profile never sees it. Everything inherits currentColor, which
      // is what keeps it legible in both host themes without a palette here.
      '[data-dsbs-tabs]{display:flex;align-items:center;gap:2px;padding:3px 4px 0;flex:none;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 10px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 10px),transparent)}',
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

      // ---- grid-based sidebar roots (DSH 0.2.2-rc.2) --------------------
      // rc.2 makes div.scrollArea a CSS grid with three explicit columns
      // (4px | 1fr | 6px) AND four explicit rows: nav.panelList is pinned to
      // grid-row 2, div.regionArea to grid-row 4. 0.4.1 only spanned the
      // columns, which fixed the 4px squeeze but still left every injected
      // child auto-placed in a new implicit row AFTER both host panels -- the
      // control bar appeared below the whole list. `order` cannot override an
      // explicit grid-row, so the bar and tab strip now live OUTSIDE the grid
      // (in the flex column div.scrollRegion). Only a third-party tab page is
      // still a grid item; it keeps the full-width span and the 4px/6px
      // padding that gives the two decorative columns back.
      '[data-dsbs-tabpanel]{grid-column:1/-1;min-width:0;max-width:100%;box-sizing:border-box;padding-left:4px;padding-right:6px}',
      '[data-dsbs-bar],[data-dsbs-tabs]{min-width:0;max-width:100%;box-sizing:border-box;flex:none}',
      // In the flex header host DOM order already is visual order. These are a
      // belt-and-braces guard for a future host that grids that wrapper too:
      // the injected header still precedes the scrolling viewport.
      '[data-dsbs-bar]{order:-30}',
      '[data-dsbs-tabs]{order:-20}',
      '[data-dsbs-tabpanel]{order:-10}',

      // ---- 1.1.5 session favorites -------------------------------------
      // The group lives INSIDE the host's workspaces region (before the
      // registered slot), so the host's own hide rules take it with them and
      // it scrolls with the session list. It has no absolute positioning.
      '[data-dsbs-favorites]{display:flex;flex-direction:column;gap:1px;margin:0 calc(var(--dsh-sidebar-paint-inset,3px) + 1px) 2px;flex:none;min-width:0}',
      '[data-dsbs-favorites][hidden]{display:none!important}',
      'html[data-dsbs-mode="b"][data-dsbs-tab="ext"] [data-dsbs-favorites]{display:none!important}',
      'html[data-dsbs-ptab="true"] [data-dsbs-favorites]{display:none!important}',
      'html[data-dsbs-rail="true"] [data-dsbs-favorites]{display:none!important}',
      // x-alignment with the row star: the row keeps its own padding-left 8px
      // x-alignment with the row star: the row keeps its own padding-left 8px
      // and the row star is the first flow child, so its left edge sits 8px
      // inside the row box. The head mark keeps the same 8px offset (x=20) to
      // line up with it. The left padding band is only 8px wide (box edge 12
      // -> content edge 20), which cannot hold a 16x16 chevron hit box, so the
      // chevron returns to the flex flow and is ordered to the right side next
      // to the count badge. The mark stays the first flow child and the
      // favorites row itself is not moved (its indent is locked by the host
      // session-row alignment).
      '[data-dsbs-fav-head]{display:flex;align-items:center;gap:6px;width:100%;min-height:32px;box-sizing:border-box;padding:0 8px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:14px;line-height:20px;border-radius:var(--dsw-radius-md,8px);cursor:pointer;text-align:left}',
      '[data-dsbs-fav-head]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,inherit)}',
      '[data-dsbs-fav-head]:focus-visible{outline:2px solid var(--dsw-alias-label-primary,currentColor);outline-offset:1px}',
      // UI-02: fav icons are CSS masks, the same contract as the control bar
      // glyphs: the DOM carries only a data attribute, the mask paints in
      // currentColor, and there is no text glyph or inline <svg>. The test
      // stubs have no createElementNS, and a mask follows the host theme on
      // its own. Filled / outline star and right / down chevron are swapped
      // by toggling the --dsbs-icon variable on the element.
      ':root{--dsbs-fav-star:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22%23000%22%3E%3Cpath d=%22M8 1.6l1.85 3.75 4.15.6-3 2.93.71 4.14L8 11.07 4.29 13.02l.71-4.14-3-2.93 4.15-.6z%22/%3E%3C/svg%3E");--dsbs-fav-star-outline:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.3%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M8 1.6l1.85 3.75 4.15.6-3 2.93.71 4.14L8 11.07 4.29 13.02l.71-4.14-3-2.93 4.15-.6z%22/%3E%3C/svg%3E");--dsbs-fav-chevron-right:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M6 3.5l4.5 4.5L6 12.5%22/%3E%3C/svg%3E");--dsbs-fav-chevron-down:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M3.5 6l4.5 4.5L12.5 6%22/%3E%3C/svg%3E")}',
      // Chevron sits to the right of the count badge (order:4), clear of the
      // mark/label. Hit box 16x20 keeps a 16x16 tappable area; collapsed and
      // expanded arrows are centered in the same box and swapped by attribute.
      '[data-dsbs-fav-head] [data-dsbs-fav-chevron]{order:4;display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:20px;box-sizing:border-box;padding:0 3px;color:var(--dsw-alias-label-tertiary,inherit);--dsbs-icon:var(--dsbs-fav-chevron-down)}',
      '[data-dsbs-fav-head] [data-dsbs-fav-chevron][data-dsbs-fav-collapsed="true"]{--dsbs-icon:var(--dsbs-fav-chevron-right)}',
      '[data-dsbs-fav-head] [data-dsbs-fav-chevron]::before{content:"";display:block;width:16px;height:16px;background:currentColor;-webkit-mask-image:var(--dsbs-icon);mask-image:var(--dsbs-icon);-webkit-mask-size:16px 16px;mask-size:16px 16px;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;mask-position:center;mask-repeat:no-repeat}',
      // Star color: no `--dsw-alias-*` gold/star token is referenced anywhere
      // else in this bundle, so the hard-coded gold stays rather than inventing
      // a token name the host does not provide. The mark box matches the row
      // star below so the two stars line up on the same baseline.
      '[data-dsbs-fav-head] [data-dsbs-fav-mark]{order:1;display:inline-flex;align-items:center;justify-content:center;flex:none;width:18px;height:20px;color:var(--dsw-alias-state-business-warning,#e8b931);margin-right:1px;--dsbs-icon:var(--dsbs-fav-star)}',
      '[data-dsbs-fav-head] [data-dsbs-fav-mark]::before{content:"";display:block;width:15px;height:15px;background:currentColor;-webkit-mask-image:var(--dsbs-icon);mask-image:var(--dsbs-icon);-webkit-mask-size:15px 15px;mask-size:15px 15px;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;mask-position:center;mask-repeat:no-repeat}',
      '[data-dsbs-fav-head] [data-dsbs-fav-label]{order:2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '[data-dsbs-fav-head] [data-dsbs-fav-count]{order:3;margin-left:auto;flex:none;min-width:14px;padding:0 4px;border-radius:7px;background:color-mix(in srgb,currentColor 12%,transparent);font-size:10px;line-height:16px;text-align:center;font-variant-numeric:tabular-nums}',
      '[data-dsbs-fav-search-wrap]{display:block;padding:2px 8px 4px}',
      '[data-dsbs-fav-search-wrap][hidden]{display:none!important}',
      '[data-dsbs-fav-search]{box-sizing:border-box;width:100%;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.25));border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px;line-height:18px;outline:none}',
      '[data-dsbs-fav-search]:focus{border-color:var(--dsw-alias-state-business-primary,#3b82f6)}',
      '[data-dsbs-fav-search]::placeholder{color:var(--dsw-alias-label-tertiary,inherit)}',
      '[data-dsbs-fav-list]{display:flex;flex-direction:column;gap:1px;padding:0 0 1px}',
      '[data-dsbs-fav-list][hidden]{display:none!important}',
      '[data-dsbs-fav-row]{display:flex;align-items:center;gap:6px;min-width:0;min-height:32px;box-sizing:border-box;padding:0 8px;border-radius:var(--dsw-radius-md,8px);cursor:pointer;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary,inherit)}',
      '[data-dsbs-fav-row]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}',
      '[data-dsbs-fav-row][aria-selected="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.2))}',
      '[data-dsbs-fav-row]:focus-visible{outline:2px solid var(--dsw-alias-label-primary,currentColor);outline-offset:-1px}',
      '[data-dsbs-fav-row] [data-dsbs-fav-star]{display:inline-flex;align-items:center;justify-content:center;flex:none;width:18px;height:20px;padding:0;border:0;background:transparent;color:var(--dsw-alias-state-business-warning,#e8b931);font:inherit;cursor:pointer;border-radius:4px;--dsbs-icon:var(--dsbs-fav-star)}',
      '[data-dsbs-fav-row] [data-dsbs-fav-star]::before{content:"";display:block;width:15px;height:15px;background:currentColor;-webkit-mask-image:var(--dsbs-icon);mask-image:var(--dsbs-icon);-webkit-mask-size:15px 15px;mask-size:15px 15px;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;mask-position:center;mask-repeat:no-repeat}',
      '[data-dsbs-fav-row] [data-dsbs-fav-star]:hover{background:color-mix(in srgb,currentColor 18%,transparent)}',
      '[data-dsbs-fav-row] [data-dsbs-fav-title]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '[data-dsbs-fav-row] [data-dsbs-fav-time]{flex:none;color:var(--dsw-alias-label-tertiary,inherit);font-size:10px;line-height:16px;font-variant-numeric:tabular-nums}',
      '[data-dsbs-fav-empty]{padding:4px 8px 6px;color:var(--dsw-alias-label-tertiary,inherit);font-size:12px;line-height:18px}',
      // The host title is a MarqueeText span. A generated rule adds the star
      // before the text; a row that already has archive-manager's own star slot
      // hides ours, so the two plugins do not stack two stars on one title.
      '[data-row-key^="session:"]:has(.dsham_starSlot) span[class*="title"]::before{display:none!important}',
      // Host-row favorite toggle: outline star when off, gold filled star when
      // on. The mask swaps via aria-pressed; color follows the CSS custom props.
      '[data-dsbs-fav-action]{display:inline-flex;align-items:center;justify-content:center;flex:none;width:18px;height:20px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.7));font:inherit;cursor:pointer;border-radius:4px;--dsbs-icon:var(--dsbs-fav-star-outline)}',
      '[data-dsbs-fav-action][aria-pressed="true"]{color:var(--dsw-alias-state-business-warning,#e8b931);--dsbs-icon:var(--dsbs-fav-star)}',
      '[data-dsbs-fav-action]::before{content:"";display:block;width:15px;height:15px;background:currentColor;-webkit-mask-image:var(--dsbs-icon);mask-image:var(--dsbs-icon);-webkit-mask-size:15px 15px;mask-size:15px 15px;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;mask-position:center;mask-repeat:no-repeat}',
      '[data-row-key^="session:"]:has(.dsham_starSlot) [data-dsbs-fav-action]{display:none!important}',
    ].join('\n')

    // 1.0.0 M1 — host adaptation layer.
    //
    // A future host (shape unknown by design) must never take the sidebar down:
    // every read of a host object goes through one of these helpers, and every
    // failure funnels into `degrade()`. They live in this factory closure on
    // purpose — a client bundle cannot import a separate .mjs file.
    //
    // Slot names the bundle talks to, collected in one place so an unknown host
    // that renames a slot has one spot to audit. The three literal call sites
    // further down stay verbatim: tests/test_038 + test_046 pin those exact
    // strings as the public slot contract, so the constants document the set
    // while the literals remain the shipped calls.
    var KNOWN_SLOTS = {
      workspaces: 'sidebar.workspaces',
      sessionAction: 'sidebar.session.action',
      panelActions: 'sidebar.panellist.actions',
      config: 'plugins.bundle.config',
    }
    // Process-wide degradation ledger. `runtime` is re-pointed on every apply
    // (the owner token guarantees only the newest run stays alive); `logged`
    // survives hot reload so one broken host is reported once, not per cycle.
    var HOST_ADAPT = {
      runtime: null,
      logged: Object.create(null),
      hideControls: null,
    }

    /**
     * Deep, read-only access to a host value. Never throws: a missing step, a
     * getter that throws, or a callable that throws all return `fallback`.
     * A function at the end of the path is invoked WITHOUT a receiver, so a
     * caller whose host getter reads `this` must use hostCall() instead.
     * `null` is preserved because the row-menu probe distinguishes it from
     * "unavailable" (test_058 B2/B6).
     */
    function hostRead(obj, path, fallback) {
      var parts = Array.isArray(path) ? path.slice() : String(path == null ? '' : path).split('.')
      var current = obj
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] === '') continue
        try {
          if (current == null) return fallback
          current = current[parts[i]]
        } catch (error) {
          return fallback
        }
      }
      try {
        if (typeof current === 'function') current = current()
      } catch (error) {
        return fallback
      }
      return current === undefined ? fallback : current
    }

    /**
     * Call a host capability only when it is really a function, with a uniform
     * {ok, value, error} result. No caller ever has to wrap the call itself.
     */
    function hostCall(service, method, args) {
      var fn = null
      try {
        if (service) fn = service[method]
      } catch (error) {
        return { ok: false, value: undefined, error: error }
      }
      if (typeof fn !== 'function') {
        return { ok: false, value: undefined, error: 'unavailable: ' + method }
      }
      try {
        return { ok: true, value: fn.apply(service, args || []), error: null }
      } catch (error) {
        return { ok: false, value: undefined, error: error }
      }
    }

    /** Pure feature probe: no call, no throw, just a boolean. */
    function featureDetect(service, method) {
      if (!service) return false
      try {
        return typeof service[method] === 'function'
      } catch (error) {
        return false
      }
    }

    /**
     * Unified degradation exit. Records the reason on the live runtime, logs
     * once per (scope, reason), and hides our own controls when the layout is
     * unusable — never the host's DOM. Core layout behaviour is kept whenever
     * a sidebar node exists and only the probed service is missing.
     */
    function degrade(reason, scope) {
      var where = scope || 'global'
      var key = where + ':' + reason
      try {
        var live = HOST_ADAPT.runtime
        if (live) {
          if (!live.degraded) live.degraded = []
          if (live.degraded.indexOf(key) < 0) live.degraded.push(key)
        }
      } catch (error) {
        void error
      }
      try {
        if (!HOST_ADAPT.logged[key]) {
          HOST_ADAPT.logged[key] = true
          if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
            console.warn('[dsh-sidebar-suite] degraded: ' + key)
          }
        }
      } catch (error) {
        void error
      }
      try {
        if (typeof HOST_ADAPT.hideControls === 'function') HOST_ADAPT.hideControls(where)
      } catch (error) {
        void error
      }
    }

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
    function resolveSidebarImpl() {
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

      // DSH 0.2.2-rc.2 renders (see the host's SidebarRoot.tsx):
      //   div.scrollRegion   flex column, never rebuilt by React
      //     > div.scrollArea CSS grid, 4 explicit rows
      //         > nav.panelList   pinned to grid-row 2
      //         > div.regionArea pinned to grid-row 4
      // A child injected into scrollArea without its own grid-row is
      // auto-placed into a NEW implicit row AFTER both host panels, so the
      // control bar shows up under the whole list. `order` cannot beat an
      // explicit grid-row -- that is why the 0.4.2 `order` attempt failed.
      // The reliable place for our header is scrollRegion, the flex column
      // that owns scrollArea: DOM order is visual order there in BOTH the
      // grid (expanded) and flex-column (rail) states, and nothing re-parents
      // that wrapper when a group is folded. Semantic class suffixes only;
      // the generated CSS-module hash prefix must never be hard-coded.
      var scrollArea = null
      var scan = root
      while (scan && scan !== document.body && scan !== document.documentElement) {
        if (scan.tagName === 'DIV' && /scrollArea/.test(String(scan.className || ''))) {
          scrollArea = scan
          break
        }
        scan = scan.parentElement
      }
      // Keep `root` pinned to the outer scrolling container even when a fold
      // puts the nav one level deeper; popover geometry and the observer use it.
      if (scrollArea && scrollArea !== root && scrollArea.contains(workspaces)
        && (!nav || scrollArea.contains(nav))) {
        root = scrollArea
      }
      var headerHost = null
      if (scrollArea && scrollArea.parentElement
        && /scrollRegion/.test(String(scrollArea.parentElement.className || ''))) {
        headerHost = scrollArea.parentElement
      }
      // Pre-rc.2 hosts have no grid. With no headerHost the old flex root is
      // still correct and the `order` rules keep the header in front there.
      return {
        root: root, scrollArea: scrollArea, headerHost: headerHost,
        nav: nav, regionArea: regionArea, workspaces: workspaces
      }
    }

    // 1.0.0 M1 — the only public resolver. Even a host whose querySelector (or
    // any DOM walk) throws lands here, is recorded once, and yields null so the
    // callers degrade instead of crashing. The implementation keeps its old
    // name so the "one resolver" source contract in test_047 still holds.
    function resolveSidebar() {
      try {
        return resolveSidebarImpl()
      } catch (error) {
        void error
        degrade('sidebar-resolve-failed', 'layout')
        return null
      }
    }

    // 1.0.0 M1 — single, intentionally named gate used by every caller.
    var hostResolve = resolveSidebar

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

    // 0.5.0: `a` (independent folding) was removed. A profile that still has
    // `mode: a` must not silently land on a different-looking layout, so every
    // read maps it to the official default. The alias is never written back,
    // never rendered as a button and never returned by getLayout().
    function normalizeMode(raw) {
      var mode = LEGACY_MODES[raw] || raw
      return MODES.indexOf(mode) >= 0 ? mode : DEFAULTS.mode
    }

    function adoptValues(raw) {
      var out = assign({}, DEFAULTS)
      if (!raw || typeof raw !== 'object') return out
      out.mode = normalizeMode(raw.mode)
      if (typeof raw.showQuickSwitch === 'boolean') out.showQuickSwitch = raw.showQuickSwitch
      if (raw.tab === 'ext' || raw.tab === 'ws') out.tab = raw.tab
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
      // The tab that the profile (or the local fallback) last accepted. The
      // ⇄ action paints its next value immediately, so config.values.tab is
      // already the new value by the time setField() runs; a refused write
      // must roll back to this confirmed value, not to the optimistic one.
      var tabConfirmed = DEFAULTS.tab
      // A write sequence makes the confirmation monotonic: a slow successful
      // write must never overwrite the tab confirmed by a newer one.
      var tabConfirmedSeq = 0
      // 1.1.3 — one-shot guard for the "bring DSH forward" preference. The
      // config form can push several times per launch; only the first push is
      // allowed to touch the window.
      var focusApplied = false
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
        // 0.8.3 — the collapsed rail's only control. Kept in runtime (not a
        // DOM flag) so the 1.5s paint heartbeat cannot lose an open panel.
        railOpen: false,
        railMenu: null,
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
        // 1.1.0 — three-page switch. `page` is one of PAGES or 'other' when a
        // different plugin's global panel owns the main column. `layout` is
        // the host service used to select ours; the page node stays null until
        // the host shape is known.
        page: 'agent',
        pageBar: null,
        pageReady: false,
        pageSupported: null,
        pageLayout: null,
        pageUnsubscribe: null,
        pagePanelDisposer: null,
        // 1.0.0 M1: filled by degrade(); diagnostics and tests can read it.
        degraded: [],
      }

      // 1.1.5 — favorites are a small user-owned set, so it is kept outside
      // `config.values`: the layout form must not rewrite them and a corrupted
      // layout must not take the stars with it. Subscribers are React row
      // actions; the DOM group repaints itself from the same array.
      var favoriteIds = readFavoriteIds()
      var favoriteSubscribers = []
      var favoriteGroup = null
      var favoriteSignature = ''
      var favoriteQuery = ''
      var favoriteCollapsed = readFavoriteCollapsed()
      var favoriteArchiveLoading = false
      var favoriteArchiveLastRead = 0
      var favoriteArchiveListener = null
      var favoriteArchiveTimer = null
      var favoriteActionDisposer = null
      // 1.1.5 -- archive-manager is an optional bridge, not an always-ready
      // database. `ready` means at least one non-empty snapshot was accepted;
      // `holdLocal` keeps a newly migrated local set alive until the bridge
      // proves it has caught up. Both are intentionally per-run: a restart
      // without archive-manager must not inherit a stale "archive owns this"
      // decision.
      var favoriteArchiveReady = false
      var favoriteArchiveHoldLocal = false
      var favoriteArchiveMigrationPending = false
      // Every local mutation gets a monotonically increasing generation. A
      // refresh captures the generation, pending count, and migration flag when
      // it starts; if any of them moved by the time it resolves, the snapshot
      // is stale and must not overwrite the user's click.
      var favoriteMutationVersion = 0
      var favoritePendingIds = Object.create(null)
      var favoritePendingCount = 0
      // A second star click while an archive write is in flight used to be a
      // silent no-op. Queue a short burst so a double-click (star then unstar)
      // ends in the state the user actually clicked.
      var favoriteActionQueue = []
      renderFavoriteStyle()

      // 1.0.0 M1 — bind the degradation ledger to this run. On an unusable
      // layout we hide ONLY our own controls and let DSH draw its official
      // default column; the host's nodes are never touched.
      HOST_ADAPT.runtime = runtime
      HOST_ADAPT.hideControls = function (scope) {
        if (scope !== 'layout') return
        var controls = [runtime.bar, runtime.pageBar, runtime.tabStrip, runtime.railMenu]
        for (var i = 0; i < controls.length; i++) {
          var control = controls[i]
          if (!control) continue
          try { control.setAttribute('hidden', '') } catch (error) { void error }
        }
        // A leftover !important rule would hide both host groups on the next
        // successful paint; clear it on the way out (same guard paint() uses).
        try { setFlag(html, 'data-dsbs-ptab', false) } catch (error) { void error }
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
            // 0.5.0: 'b' (toggle), 'c' (overlay), 'n' (official default).
            // 'a' no longer exists; old configs are normalized on read.
            mode: config.values.mode,
            tab: config.values.tab,
            // 0.7.3: same filter as getActiveTab(). Reporting a stored-but-not-
            // registered id made a consumer believe it owned the column while
            // both groups were actually showing.
            activeTab: runtime.activeTab && findTab(runtime.activeTab) ? runtime.activeTab : null,
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
      // The element the button lives in: the host-declared seat in slot mode, or
      // our own wrapper in the legacy sibling path.
      var tempSlot = null
      // 0.6.0 — DSH 0.2.2-rc.3 declares `sidebar.session.action`, a hoc layer
      // rendered inside the host's New-session row. 'slot' means we mounted into
      // it; 'dom' is the <= rc.2 sibling path for hosts that never declared it.
      var tempSlotMode = ''
      var tempSlotWide = null // last `wide` the seat occupant saw (false = 56px rail)
      var tempSeatDisposer = null
      // 0.7.4: the slot registration used to swallow its error entirely, so the
      // detail-page self-check could only say "unavailable" with no reason.
      var tempSeatError = ''
      var tempNewChatHost = null
      var tempChatPolicy = 'hide' // TEMP_IN_CHAT_MODE in temp-session-config.txt
      // 0.2.8 hot reload: these are re-applied whenever the config file changes.
      var tempShowButton = true
      var tempConfigRevision = null
      var configPollPending = false
      var tempChatGuard = null
      var tempIds = [] // session ids the Host half will delete on quit
      // 0.8.4: last count reported by the Host (-1 = unknown). The Temp
      // button's tooltip ends with it so the cost of a click is visible first.
      var tempCountKnown = -1
      // 0.4.0 — per-row menu. `tempMenuEnabled` mirrors TEMP_ROW_MENU and is the
      // escape hatch if another plugin wants the context menu on these rows.
      var tempMenuEnabled = true
      // 0.7.4 — rc.1+ exposes ctx.contextMenus.register(); when available the
      // row actions move into the host menu and the DOM menu is kept only as a
      // fallback for older hosts. Tracking the mode makes the health badge honest.
      var tempMenuMode = 'dom'
      var tempMenuError = ''
      // 0.8.7: the host's shared-popup service, kept so a right-click can read
      // whether the host actually opened it. Registering a contribution is not
      // proof that any gesture opens the popup (0.2.3-alpha.2 keeps the service
      // and the contributions but dropped the row gesture).
      var nativeMenus = null
      var nativeTabsAvailable = false // host has `sidebar.panellist.actions` (rc.2+)
      var remoteSession = null // injected `remote.session` service for reveal
      var tempRowMenu = null
      var tempMenuRow = null
      var tempMenuDismiss = null
      var tempBusy = false
      // 0.7.3: guards against a host that accepts the request but never answers.
      // Without it the button stays disabled and every later click returns
      // silently — "clicked and nothing happens, forever".
      var tempWatchdog = 0
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
      // 1.1.4 — the expand pass (a whole-document scan plus one host click per
      // collapsed group) used to run inside every sync(). A repaint caused by
      // nothing but a mode switch, a config push or a widget resize therefore
      // paid for a full session-list sweep and re-rendered the tree. It only
      // has work to do when the tree changed or a hidden group was just
      // revealed, so those events set this flag and one consumer clears it.
      var rowsDirty = true
      var expandSoonTimer = 0
      var overlayRemeasureRaf = 0

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
      // 0.8.2: every side-effecting call gets the same watchdog budget. Without
      // it a hung Host leaves the caller's busy flag set forever.
      var WRITE_TIMEOUT_MS = 20000

      function tempCall(path, options) {
        var init = { credentials: 'same-origin', cache: 'no-store' }
        if (options && options.method) init.method = options.method
        if (options && options.body !== undefined) {
          init.body = options.body
          init.headers = { 'content-type': 'application/json' }
        }
        // 0.8.5: the watchdog used to only stop WAITING — the hung request kept
        // running and, on a dead host, timed-out calls piled up. Aborting the
        // fetch for real releases it; the rejection is absorbed by the chain
        // below because the outer promise has already settled.
        var controller = null
        if (options && options.timeoutMs > 0 && typeof AbortController === 'function') {
          controller = new AbortController()
          init.signal = controller.signal
        }
        var request = fetch(tempUrl(path), init)
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

        // 0.7.4 (unreleased): the host can accept a request and never answer
        // (restart, hung proxy). Without a watchdog, loadTempStatus() kept
        // tempStatusPending=true forever and every later heartbeat skipped it.
        // Race the request against a timer so the caller's catch always fires
        // and the existing backoff can retry. Since 0.8.5 the timer also
        // aborts the underlying fetch where the platform offers it.
        var timeoutMs = options && options.timeoutMs
        if (!(timeoutMs > 0)) return request
        return new Promise(function (resolve, reject) {
          var settled = false
          var timer = setTimeout(function () {
            if (settled) return
            settled = true
            try { if (controller) controller.abort() } catch (error) { void error }
            var error = new Error('request timeout after ' + timeoutMs + 'ms')
            error.timedOut = true
            reject(error)
          }, timeoutMs)
          request.then(function (value) {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(value)
          }, function (error) {
            if (settled) return
            settled = true
            clearTimeout(timer)
            reject(error)
          })
        })
      }

      /** One phrasing for failed side effects, including watchdog timeouts. */
      function opError(prefix, error) {
        var message = String((error && error.message) || error)
        return t(prefix) + message + (error && error.timedOut ? t('op.timeout') : '')
      }

      /** Human name for a config field, so a refused write names the control. */
      var FIELD_LABELS = { tab: 'field.tab', mode: 'field.mode' }
      function fieldLabel(field) {
        var key = FIELD_LABELS[field]
        return key ? t(key) : field
      }

      function toast(text, isError) {
        var node = null
        try { node = document.querySelector('[data-dsbs-temp-toast]') } catch (error) { void error }
        if (!node) {
          node = document.createElement('div')
          node.setAttribute('data-dsbs-temp-toast', '')
          document.body.appendChild(node)
        }
        // 0.8.10 — an error is not "status". A polite live region waits for
        // whatever the screen reader is already saying, so a failure that
        // disappears in ten seconds could easily be announced after it is gone.
        // Errors are assertive/alert; confirmations stay polite.
        node.setAttribute('role', isError ? 'alert' : 'status')
        node.setAttribute('aria-live', isError ? 'assertive' : 'polite')
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
          degrade('ctx-get-failed', 'services')
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

      /**
       * 0.8.9 — the Agent preset the conversation in the main column runs under.
       *
       * Host side, `sessions.create` hands the request to `agents.createSession`,
       * which resolves the preset **before** it creates anything: an explicit
       * `agentPreset`, else the registry's `selectedDefault`. That default is a
       * bare string in the profile, and it survives the plugin that declared the
       * preset being uninstalled — so it can name something that no longer
       * exists, and then *every* new session dies with `agent-preset/not-found`
       * (the host's own New-session button included). Passing the preset of the
       * session we are sitting in makes Temp create what the neighbour session
       * actually is, instead of depending on that orphaned string. Empty string
       * means "let the host decide", which is the old behaviour.
       */
      function currentAgentPreset(ui) {
        try {
          var current = null
          try { current = ui.mainReference && ui.mainReference.sessionId } catch (error) { void error }
          if (!current) return ''
          var snap = listOf(ui.sessions && ui.sessions.list)
          var summary = snap && snap.byId ? snap.byId[current] : null
          var preset = summary && summary.projectionValues ? summary.projectionValues.agentPreset : ''
          return typeof preset === 'string' ? preset : ''
        } catch (error) {
          return ''
        }
      }

      /**
       * 0.8.9 — the preset name out of a host rejection, or ''.
       *
       * The message arrives wrapped ("session create failed: agent-preset/
       * not-found: Unknown agent preset: ops-ptc ..."), so the error code is the
       * only stable part; the words after it are free text from the host.
       */
      function missingPresetName(error) {
        var text = String((error && error.message) || error || '')
        var match = /agent-preset\/not-found[\s\S]*?Unknown agent preset:\s*([^\s"'`]+)/i.exec(text)
        return match ? match[1] : ''
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

      // ---- 1.1.5 session favorites ---------------------------------------
      // Why a separate store: the host has no favorite concept (it only pins
      // and archives), and archive-manager keeps its favorites in its own
      // host-side storage domain. A renderer-local list is enough for the
      // star/group and survives DSH restarts; when archive-manager's public
      // `remote.workspaceRegistry.favoriteSessions` bridge is present we reuse
      // that list instead, so the two plugins never show two different answers.

      function normalizeFavoriteIds(value) {
        var out = []
        var source = Array.isArray(value) ? value : []
        for (var i = 0; i < source.length; i++) {
          var id = source[i]
          if (typeof id !== 'string' || id === '') continue
          if (out.indexOf(id) >= 0) continue
          out.push(id)
        }
        return out
      }

      function readFavoriteIds() {
        try {
          var raw = window.localStorage.getItem(FAVORITES_KEY)
          if (!raw) return []
          var parsed = JSON.parse(raw)
          return normalizeFavoriteIds(Array.isArray(parsed) ? parsed : parsed && parsed.ids)
        } catch (error) {
          void error
          return []
        }
      }

      function readFavoriteCollapsed() {
        try {
          return window.localStorage.getItem(FAVORITES_COLLAPSED_KEY) === '1'
        } catch (error) {
          void error
          return false
        }
      }

      function persistFavoriteIds(ids) {
        try {
          window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids))
        } catch (error) {
          void error
        }
      }

      /** Membership comparison, not order comparison. */
      function sameFavoriteSet(left, right) {
        if (!left || !right || left.length !== right.length) return false
        var seen = Object.create(null)
        for (var i = 0; i < left.length; i++) seen[left[i]] = true
        for (var j = 0; j < right.length; j++) {
          if (!seen[right[j]]) return false
        }
        return true
      }

      function persistFavoriteCollapsed() {
        try {
          window.localStorage.setItem(FAVORITES_COLLAPSED_KEY, favoriteCollapsed ? '1' : '0')
        } catch (error) {
          void error
        }
      }

      function isFavorite(id) {
        return !!id && favoriteIds.indexOf(id) >= 0
      }

      function subscribeFavoriteChanges(listener) {
        if (typeof listener !== 'function') return function () {}
        favoriteSubscribers.push(listener)
        var off = false
        return function () {
          if (off) return
          off = true
          var i = favoriteSubscribers.indexOf(listener)
          if (i >= 0) favoriteSubscribers.splice(i, 1)
        }
      }

      function notifyFavoriteChanges() {
        for (var i = favoriteSubscribers.length - 1; i >= 0; i--) {
          try {
            favoriteSubscribers[i]()
          } catch (error) {
            void error
          }
        }
      }

      /**
       * The Host-side archive manager (when installed) exposes this service on
       * the client. Its two methods are already the source of truth for that
       * plugin's own stars and filter, so using them here is what keeps a
       * session starred in one place starred in the other.
       */
      function archiveFavoriteRegistry() {
        try {
          var registry = safeGet(ctx, 'remote.workspaceRegistry')
          if (!registry) return null
          if (typeof registry.favoriteSessions !== 'function') return null
          if (typeof registry.setSessionFavorite !== 'function') return null
          return registry
        } catch (error) {
          void error
          return null
        }
      }

      function adoptFavoriteIds(next, options) {
        var opts = options || {}
        var normalized = normalizeFavoriteIds(next)
        if (sameFavoriteSet(favoriteIds, normalized)) return false
        favoriteIds = normalized
        if (opts.persist !== false) persistFavoriteIds(favoriteIds)
        applyFavoriteState()
        return true
      }

      function favoritePendingBegin(id) {
        if (!id || favoritePendingIds[id]) return false
        favoritePendingIds[id] = true
        favoritePendingCount += 1
        return true
      }

      function favoritePendingEnd(id) {
        if (!id || !favoritePendingIds[id]) return
        delete favoritePendingIds[id]
        favoritePendingCount = Math.max(0, favoritePendingCount - 1)
      }

      function applyFavoriteState() {
        if (runtime.disposed) return
        renderFavoriteStyle()
        paintFavoriteGroup()
        notifyFavoriteChanges()
      }

      function cssAttributeValue(value) {
        return String(value)
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\r/g, '\\d ')
          .replace(/\n/g, '\\a ')
          // Form feed and the NUL byte would otherwise reach the generated
          // attribute selector raw; escape them like the other control chars.
          .replace(/\f/g, '\\f ')
          .replace(/\0/g, '\\0 ')
      }

      /**
       * A generated rule per favorite id, not a class on each row: React
       * re-renders the row title and would drop an attribute we painted there,
       * while a selector keyed on the host's own `data-row-key` survives it.
       */
      function renderFavoriteStyle() {
        if (!document || !document.createElement) return
        var style = document.getElementById(FAVORITES_STYLE_ID)
        if (!style) {
          style = document.createElement('style')
          style.id = FAVORITES_STYLE_ID
          style.setAttribute('data-plugin', ENTRY)
          ;(document.head || document.documentElement).appendChild(style)
        }
        var rules = []
        for (var i = 0; i < favoriteIds.length; i++) {
          var id = cssAttributeValue(favoriteIds[i])
          rules.push(
            '[data-row-key="session:' + id + '"] span[class*="title"]::before{'
            + 'content:"";display:inline-block;width:15px;height:15px;margin-right:6px;vertical-align:-2px;'
            + 'background:var(--dsw-alias-state-business-warning,#e8b931);'
            + '-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22%23000%22%3E%3Cpath d=%22M8 1.6l1.85 3.75 4.15.6-3 2.93.71 4.14L8 11.07 4.29 13.02l.71-4.14-3-2.93 4.15-.6z%22/%3E%3C/svg%3E");'
            + 'mask-image:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22%23000%22%3E%3Cpath d=%22M8 1.6l1.85 3.75 4.15.6-3 2.93.71 4.14L8 11.07 4.29 13.02l.71-4.14-3-2.93 4.15-.6z%22/%3E%3C/svg%3E");'
            + '-webkit-mask-size:15px 15px;mask-size:15px 15px;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;mask-position:center;mask-repeat:no-repeat}'
          )
        }
        style.textContent = rules.join('\n')
      }

      function favoriteRows() {
        var ui = uiWorkspace()
        var sessions = listOf(ui && ui.sessions && ui.sessions.list)
        var workspaces = listOf(ui && ui.workspaces && ui.workspaces.list)
        var archived = {}
        var archivedIds = workspaces && workspaces.archivedSessionIds
        if (Array.isArray(archivedIds)) {
          for (var a = 0; a < archivedIds.length; a++) archived[archivedIds[a]] = true
        }
        var rows = []
        var rendered = renderedSessionRowMap()
        var currentId = null
        try { currentId = ui && ui.mainReference && ui.mainReference.sessionId } catch (error) { void error }
        for (var i = 0; i < favoriteIds.length; i++) {
          var id = favoriteIds[i]
          if (archived[id]) continue
          var summary = sessions && sessions.byId ? sessions.byId[id] : null
          var title = summary && (summary.displayTitle || summary.title)
          var updatedAt = summary && summary.updatedAt
          var hostRow = rendered[id] || null
          var selected = !!(hostRow && hostRow.getAttribute('aria-selected') === 'true')
          if (!selected && currentId === id) selected = true
          if (!title) {
            // A stale local id or a host that has not published the list yet:
            // the rendered row is a better label than a UUID.
            var titleNode = hostRow ? hostRow.querySelector('span[class*="title"]') : null
            title = titleNode ? String(titleNode.textContent || '').trim() : ''
          }
          if (!title) continue
          rows.push({ id: id, title: title, updatedAt: typeof updatedAt === 'number' ? updatedAt : 0, selected: selected })
        }
        rows.sort(function (left, right) { return right.updatedAt - left.updatedAt })
        return rows
      }

      function renderedSessionRowMap() {
        var map = Object.create(null)
        if (!document || typeof document.querySelectorAll !== 'function') return map
        try {
          var rows = document.querySelectorAll('[data-row-key]')
          for (var i = 0; i < rows.length; i++) {
            var key = rows[i].getAttribute('data-row-key') || ''
            if (key.indexOf('session:') === 0) map[key.slice(8)] = rows[i]
          }
        } catch (error) {
          void error
        }
        return map
      }

      function findHostSessionRow(id) {
        if (!document || typeof document.querySelectorAll !== 'function') return null
        try {
          var rows = document.querySelectorAll('[data-row-key]')
          for (var i = 0; i < rows.length; i++) {
            if (rows[i].getAttribute('data-row-key') === 'session:' + id) return rows[i]
          }
        } catch (error) {
          void error
        }
        return null
      }

      function openFavoriteSession(id) {
        var ui = uiWorkspace()
        try {
          if (ui && typeof ui.openSession === 'function') {
            ui.openSession(id)
            markFavoriteSelection(id)
            return
          }
        } catch (error) {
          void error
        }
        var row = findHostSessionRow(id)
        if (row && typeof row.click === 'function') {
          row.click()
          markFavoriteSelection(id)
        }
      }

      // Paint the clicked favorite as current immediately; the host's own
      // aria-selected catches up on the next snapshot/paint.
      function markFavoriteSelection(id) {
        if (!favoriteGroup || !id) return
        var rows = favoriteGroup.querySelectorAll('[data-dsbs-fav-row]')
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].getAttribute('data-session-id') === id) rows[i].setAttribute('aria-selected', 'true')
          else rows[i].removeAttribute('aria-selected')
        }
      }

      function favoriteTimeLabel(updatedAt) {
        if (typeof updatedAt !== 'number' || updatedAt <= 0) return ''
        var date = new Date(updatedAt)
        if (isNaN(date.getTime())) return ''
        var now = new Date()
        if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
          return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
        }
        return String(date.getMonth() + 1) + '/' + String(date.getDate())
      }

      function createFavoriteEmpty() {
        var empty = document.createElement('div')
        empty.setAttribute('data-dsbs-fav-empty', '')
        empty.textContent = t('fav.searchEmpty')
        return empty
      }

      function createFavoriteRow(info) {
        var favRow = document.createElement('div')
        favRow.setAttribute('data-dsbs-fav-row', '')
        favRow.setAttribute('data-session-id', info.id)
        favRow.setAttribute('role', 'treeitem')
        if (info.selected) favRow.setAttribute('aria-selected', 'true')
        favRow.setAttribute('tabindex', '0')
        favRow.setAttribute('title', info.title)
        favRow.setAttribute('aria-label', info.title)
        favRow.addEventListener('click', function (event) {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
          openFavoriteSession(info.id)
        })
        favRow.addEventListener('keydown', function (event) {
          if (!event) return
          // The star is a nested button. Let it handle its own Enter/Space;
          // otherwise the keydown bubbles here and opens the session instead.
          if (event.target && event.target !== favRow) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          if (typeof event.preventDefault === 'function') event.preventDefault()
          if (typeof event.stopPropagation === 'function') event.stopPropagation()
          openFavoriteSession(info.id)
        })

        var star = document.createElement('button')
        star.type = 'button'
        star.setAttribute('data-dsbs-fav-star', '')
        star.setAttribute('aria-label', t('fav.remove'))
        star.setAttribute('title', t('fav.remove'))
        star.addEventListener('click', function (event) {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
          if (event && typeof event.preventDefault === 'function') event.preventDefault()
          toggleFavorite(info.id, false)
        })
        favRow.appendChild(star)

        var title = document.createElement('span')
        title.setAttribute('data-dsbs-fav-title', '')
        title.textContent = info.title
        favRow.appendChild(title)

        var time = document.createElement('span')
        time.setAttribute('data-dsbs-fav-time', '')
        time.textContent = favoriteTimeLabel(info.updatedAt)
        if (!time.textContent) time.setAttribute('hidden', '')
        favRow.appendChild(time)
        return favRow
      }

      function favoriteGroupHead() {
        var head = document.createElement('button')
        head.type = 'button'
        head.setAttribute('data-dsbs-fav-head', '')
        head.setAttribute('data-dsbs-fav-toggle', '')
        head.addEventListener('click', function () {
          favoriteCollapsed = !favoriteCollapsed
          persistFavoriteCollapsed()
          paintFavoriteGroup()
        })
        var chevron = document.createElement('span')
        chevron.setAttribute('data-dsbs-fav-chevron', '')
        chevron.setAttribute('data-dsbs-fav-collapsed', favoriteCollapsed ? 'true' : 'false')
        chevron.setAttribute('aria-hidden', 'true')
        head.appendChild(chevron)
        var star = document.createElement('span')
        star.setAttribute('data-dsbs-fav-mark', '')
        star.setAttribute('aria-hidden', 'true')
        head.appendChild(star)
        var label = document.createElement('span')
        label.setAttribute('data-dsbs-fav-label', '')
        head.appendChild(label)
        var count = document.createElement('span')
        count.setAttribute('data-dsbs-fav-count', '')
        head.appendChild(count)
        return head
      }

      function favoriteSearchBox() {
        var wrap = document.createElement('div')
        wrap.setAttribute('data-dsbs-fav-search-wrap', '')
        wrap.setAttribute('hidden', '')
        var input = document.createElement('input')
        input.type = 'search'
        input.setAttribute('data-dsbs-fav-search', '')
        input.setAttribute('aria-label', t('fav.search'))
        input.setAttribute('placeholder', t('fav.search'))
        input.setAttribute('autocomplete', 'off')
        input.setAttribute('spellcheck', 'false')
        input.value = favoriteQuery
        input.addEventListener('input', function (event) {
          var next = event && event.target ? String(event.target.value || '') : ''
          if (next === favoriteQuery) return
          favoriteQuery = next
          favoriteSignature = ''
          paintFavoriteGroup()
        })
        wrap.appendChild(input)
        return wrap
      }

      function ensureFavoriteGroup() {
        if (favoriteGroup && favoriteGroup.parentNode) return favoriteGroup
        var group = document.createElement('div')
        group.setAttribute('data-dsbs-favorites', '')
        group.setAttribute('role', 'group')
        group.appendChild(favoriteGroupHead())
        group.appendChild(favoriteSearchBox())
        var list = document.createElement('div')
        list.setAttribute('data-dsbs-fav-list', '')
        list.setAttribute('role', 'group')
        group.appendChild(list)
        favoriteGroup = group
        favoriteSignature = ''
        return group
      }

      function paintFavoriteGroup() {
        if (runtime.disposed) return
        var region = runtime.regionArea
        // The resolver can return the slot's immediate wrapper as regionArea.
        // Mount next to the real host region child instead, otherwise the
        // favorites group inherits the wrapper's padding and can be clipped.
        if (region && runtime.root) {
          var top = region
          while (top.parentNode && top.parentNode !== runtime.root) top = top.parentNode
          if (top.parentNode === runtime.root && top !== runtime.nav) region = top
        }
        var workspaces = null
        try {
          workspaces = document.querySelector('[data-slot="sidebar.workspaces"]')
        } catch (error) {
          void error
        }
        if (!region || !workspaces) {
          if (favoriteGroup && favoriteGroup.parentNode) favoriteGroup.parentNode.removeChild(favoriteGroup)
          favoriteGroup = null
          favoriteSignature = ''
          return
        }
        var group = ensureFavoriteGroup()
        if (!group) return
        // Keep it immediately before the host's registered slot. A host update
        // may wrap the slot in one more element; insert before the wrapper that
        // is actually a child of the region instead of calling
        // insertBefore(group, workspaces) across a parent boundary.
        var anchor = workspaces
        while (anchor && anchor.parentNode && anchor.parentNode !== region) anchor = anchor.parentNode
        if (anchor && anchor.parentNode === region) {
          if (group.parentNode !== region || group.nextSibling !== anchor) {
            try {
              region.insertBefore(group, anchor)
            } catch (error) {
              void error
              try {
                if (group.parentNode !== region) region.appendChild(group)
              } catch (appendError) {
                void appendError
              }
            }
          }
        } else if (group.parentNode !== region) {
          try {
            region.appendChild(group)
          } catch (error) {
            void error
          }
        }
        var rows = favoriteRows()
        var searchWrap = group.querySelector('[data-dsbs-fav-search-wrap]')
        var searchInput = group.querySelector('[data-dsbs-fav-search]')
        if (rows.length === 0) {
          if (favoriteQuery) {
            favoriteQuery = ''
            if (searchInput) searchInput.value = ''
          }
          favoriteSignature = ''
          // Emptying the list too keeps a hidden group from carrying a stale
          // count or row for screen readers and for the next re-show.
          var emptyHead = group.querySelector('[data-dsbs-fav-head]')
          var emptyCount = emptyHead && emptyHead.querySelector('[data-dsbs-fav-count]')
          var emptyList = group.querySelector('[data-dsbs-fav-list]')
          if (favoriteIds.length === 0) {
            // No favorites at all: keep the group visible with one weakened
            // empty line. A search miss with favorites still present hides
            // the group, as before.
            group.removeAttribute('hidden')
            if (searchWrap) searchWrap.setAttribute('hidden', '')
            if (emptyHead) {
              var emptyLabel = emptyHead.querySelector('[data-dsbs-fav-label]')
              if (emptyLabel) emptyLabel.textContent = t('fav.group')
            }
            if (emptyCount) emptyCount.textContent = '0'
            if (emptyList) {
              while (emptyList.firstChild) emptyList.removeChild(emptyList.firstChild)
              var allEmpty = document.createElement('div')
              allEmpty.setAttribute('data-dsbs-fav-empty', '')
              allEmpty.textContent = t('fav.emptyAll')
              emptyList.appendChild(allEmpty)
            }
            return
          }
          group.setAttribute('hidden', '')
          if (searchWrap) searchWrap.setAttribute('hidden', '')
          if (emptyCount) emptyCount.textContent = '0'
          if (emptyList) while (emptyList.firstChild) emptyList.removeChild(emptyList.firstChild)
          return
        }
        group.removeAttribute('hidden')
        var head = group.querySelector('[data-dsbs-fav-head]')
        var list = group.querySelector('[data-dsbs-fav-list]')
        if (!head || !list) return
        var label = head.querySelector('[data-dsbs-fav-label]')
        var count = head.querySelector('[data-dsbs-fav-count]')
        var chevron = head.querySelector('[data-dsbs-fav-chevron]')
        if (label) label.textContent = t('fav.group')
        if (count) count.textContent = String(rows.length)
        if (chevron) chevron.setAttribute('data-dsbs-fav-collapsed', favoriteCollapsed ? 'true' : 'false')
        head.setAttribute('aria-expanded', favoriteCollapsed ? 'false' : 'true')
        head.setAttribute('aria-label', favoriteCollapsed ? t('fav.expand') : t('fav.collapse'))
        head.setAttribute('title', t('fav.group.hint'))
        var showSearch = rows.length > FAVORITES_SEARCH_MIN
        if (!showSearch && favoriteQuery) {
          favoriteQuery = ''
          if (searchInput) searchInput.value = ''
        }
        if (searchWrap) {
          if (showSearch && !favoriteCollapsed) searchWrap.removeAttribute('hidden')
          else searchWrap.setAttribute('hidden', '')
        }
        if (searchInput && document.activeElement !== searchInput) searchInput.value = favoriteQuery
        if (favoriteCollapsed) list.setAttribute('hidden', '')
        else list.removeAttribute('hidden')

        var needle = favoriteQuery.trim().toLowerCase()
        var visible = []
        for (var v = 0; v < rows.length; v++) {
          if (!needle || String(rows[v].title || '').toLowerCase().indexOf(needle) >= 0) visible.push(rows[v])
        }
        var signature = favoriteQuery + '\u0002'
          + rows.map(function (row) {
            return row.id + '|' + row.title + '|' + row.updatedAt + '|' + (row.selected ? '1' : '0')
          }).join('\u0001')
        if (signature === favoriteSignature) return
        favoriteSignature = signature
        while (list.firstChild) list.removeChild(list.firstChild)
        if (visible.length === 0) {
          list.appendChild(createFavoriteEmpty())
          return
        }
        for (var i = 0; i < visible.length; i++) list.appendChild(createFavoriteRow(visible[i]))
      }

      function readArchiveFavoriteIds(result) {
        var warnUnrecognized = function (reason) {
          try { console.warn('[dsh-sidebar-suite] unrecognized archive favorite snapshot: ' + reason) } catch (error) { void error }
        }
        var pick = function (value) {
          if (!value || typeof value !== 'object') return null
          if (Array.isArray(value.favoriteSessionIds)) return value.favoriteSessionIds
          if (Array.isArray(value)) return value
          return null
        }
        try {
          if (result == null) return null
          // Explicit refusal is a recognized answer, not a bad shape.
          if (typeof result === 'object' && result.ok === false) return null
          var ids = null
          if (Array.isArray(result)) {
            ids = result
          } else if (typeof result === 'object') {
            // Real archive-manager resolves favoriteSessions() to the bare
            // state shape { favoriteSessionIds: string[] }; older/bridged
            // builds wrap it as { ok: true, value: { favoriteSessionIds } }
            // or { ok: true, value: [] }. Accept all three.
            ids = pick(result)
            if (ids === null && result.value !== undefined) ids = pick(result.value)
          }
          if (ids === null) {
            warnUnrecognized('shape not recognized')
            return null
          }
          return ids
        } catch (error) {
          warnUnrecognized(String((error && error.message) || error))
          return null
        }
      }

      /**
       * A first archive read can legitimately be empty: the bridge may still be
       * indexing, or the user installed archive-manager after already starring
       * sessions here. Do not treat that as "clear my local set". Migrate the
       * local ids once, keep them on screen while the bridge catches up, and
       * only let an empty snapshot clear them after a non-empty snapshot has
       * proved the bridge is ready.
       */
      function migrateLocalFavorites(ids) {
        if (favoriteArchiveMigrationPending) return
        var registry = archiveFavoriteRegistry()
        if (!registry || !ids || ids.length === 0) return
        favoriteArchiveMigrationPending = true
        var index = 0
        var step = function () {
          if (index >= ids.length) return Promise.resolve(true)
          var id = ids[index]
          index += 1
          // Promise.resolve(...) still throws synchronously if the bridge
          // method itself throws. Defer the call so the outer catch always
          // clears favoriteArchiveMigrationPending.
          return Promise.resolve().then(function () {
            return registry.setSessionFavorite({ sessionId: id, favorite: true })
          }).then(function (result) {
            if (result && result.ok === false) return false
            return step()
          })
        }
        step().then(function (ok) {
          favoriteArchiveMigrationPending = false
          // Until a non-empty archive snapshot arrives, local remains the
          // fallback. This also keeps a failed partial migration from letting
          // the next empty poll wipe the only copy the user still has.
          favoriteArchiveHoldLocal = true
          favoriteArchiveLastRead = 0
          if (!ok) favoriteArchiveReady = false
        }).catch(function (error) {
          void error
          favoriteArchiveMigrationPending = false
          favoriteArchiveHoldLocal = true
          favoriteArchiveLastRead = 0
          favoriteArchiveReady = false
        })
      }

      function adoptArchiveFavoriteIds(ids) {
        if (ids === null) return
        if (ids.length === 0) {
          if (favoriteIds.length > 0 && !favoriteArchiveReady) {
            if (!favoriteArchiveMigrationPending && !favoriteArchiveHoldLocal) migrateLocalFavorites(favoriteIds.slice())
            return
          }
          if (favoriteArchiveHoldLocal) return
          favoriteArchiveReady = true
          adoptFavoriteIds([])
          return
        }
        favoriteArchiveReady = true
        favoriteArchiveHoldLocal = false
        adoptFavoriteIds(ids)
      }

      function refreshArchiveFavorites(force) {
        var registry = archiveFavoriteRegistry()
        if (!registry) return false
        var now = Date.now()
        if (!force && now - favoriteArchiveLastRead < FAVORITE_ARCHIVE_READ_WINDOW_MS) return true
        if (favoriteArchiveLoading) return true
        favoriteArchiveLastRead = now
        favoriteArchiveLoading = true
        // Capture the state at request time. A click or a migration that starts
        // while this read is in flight makes the answer stale even if its
        // JSON is otherwise valid.
        var versionAtStart = favoriteMutationVersion
        var pendingAtStart = favoritePendingCount
        var migratingAtStart = favoriteArchiveMigrationPending
        var finish = function () { favoriteArchiveLoading = false }
        try {
          Promise.resolve(registry.favoriteSessions()).then(function (result) {
            var ids = readArchiveFavoriteIds(result)
            if (ids === null || runtime.disposed) return
            if (versionAtStart !== favoriteMutationVersion) return
            if (pendingAtStart > 0 || favoritePendingCount > 0) return
            if (migratingAtStart || favoriteArchiveMigrationPending) return
            adoptArchiveFavoriteIds(ids)
          }).catch(function (error) {
            void error
          }).then(finish, finish)
        } catch (error) {
          finish()
        }
        return true
      }

      /** Apply one id to the current list, preserving any other change. */
      function localFavoriteIntent(id, wanted) {
        var next = normalizeFavoriteIds(readFavoriteIds())
        var at = next.indexOf(id)
        if (wanted && at < 0) next.push(id)
        if (!wanted && at >= 0) next.splice(at, 1)
        adoptFavoriteIds(next)
      }

      /**
       * Cross-window serialization where the platform offers Web Locks. Two
       * windows toggling different ids used to read the same old array and the
       * later write silently discarded the earlier one.
       */
      function commitLocalFavorite(id, wanted) {
        var locks = null
        try { locks = window && window.navigator && window.navigator.locks } catch (error) { void error }
        if (locks && typeof locks.request === 'function') {
          var started = false
          try {
            Promise.resolve(locks.request('dsh-sidebar-suite:favorites', { mode: 'exclusive' }, function () {
              started = true
              localFavoriteIntent(id, wanted)
              return true
            })).catch(function (error) {
              void error
              if (!started) localFavoriteIntent(id, wanted)
            })
            return
          } catch (error) {
            void error
          }
        }
        localFavoriteIntent(id, wanted)
      }

      function rollbackFavoriteIntent(id, before) {
        var next = favoriteIds.slice()
        var at = next.indexOf(id)
        var had = before.indexOf(id) >= 0
        // Restore the pre-click state, not the inverse of the click. The old
        // conditions removed an id that was already absent and left an
        // optimistic add in place after a failed archive write.
        if (had && at < 0) next.push(id)
        if (!had && at >= 0) next.splice(at, 1)
        adoptFavoriteIds(next)
      }

      function drainFavoriteQueue() {
        if (favoritePendingCount > 0) return
        var next = favoriteActionQueue.shift()
        if (next) toggleFavorite(next.id, next.wanted)
      }

      function toggleFavorite(id, force) {
        if (!id) return
        var wanted = typeof force === 'boolean' ? force : !isFavorite(id)
        var registry = archiveFavoriteRegistry()
        if (registry) {
          // One archive mutation at a time. The bridge is the authority here;
          // letting two optimistic writes race produces an older full-list
          // response overwriting the newer one. A second toggle on the same
          // id while the first is still in flight updates the queued intent
          // instead of stacking duplicates; the queue still caps itself.
          if (favoritePendingCount > 0) {
            var queuedEntry = null
            for (var qi = 0; qi < favoriteActionQueue.length; qi++) {
              if (favoriteActionQueue[qi].id === id) { queuedEntry = favoriteActionQueue[qi]; break }
            }
            if (queuedEntry) queuedEntry.wanted = wanted
            else if (favoriteActionQueue.length < FAVORITE_QUEUE_MAX) {
              favoriteActionQueue.push({ id: id, wanted: wanted })
            }
            return
          }
          if (!favoritePendingBegin(id)) return
          var before = favoriteIds.slice()
          favoriteMutationVersion += 1
          var optimistic = before.slice()
          var at = optimistic.indexOf(id)
          if (wanted && at < 0) optimistic.push(id)
          if (!wanted && at >= 0) optimistic.splice(at, 1)
          adoptFavoriteIds(optimistic)
          var finish = function () { favoritePendingEnd(id); drainFavoriteQueue() }
          try {
            Promise.resolve(registry.setSessionFavorite({ sessionId: id, favorite: wanted })).then(function (result) {
              if (result && result.ok === false) {
                var refused = result.error && (result.error.message || result.error)
                throw new Error(String(refused || 'favorite refused'))
              }
              var ids = readArchiveFavoriteIds(result)
              if (ids !== null) adoptFavoriteIds(ids)
              // Older archive builds answer without a value; the optimistic
              // state already matches what we asked for, so leave it.
            }).catch(function (error) {
              rollbackFavoriteIntent(id, before)
              toast(t('fav.failed') + String((error && error.message) || error || ''), true)
            }).then(finish, finish)
          } catch (error) {
            finish()
            rollbackFavoriteIntent(id, before)
            toast(t('fav.failed') + String((error && error.message) || error || ''), true)
          }
          return
        }
        favoriteMutationVersion += 1
        commitLocalFavorite(id, wanted)
      }

      // A star click inside archive-manager mutates its own store; a light
      // document-level listener pulls that answer back into the group without
      // adding a second polling timer to the sidebar heartbeat.
      function watchArchiveFavorites() {
        if (favoriteArchiveListener || !document || typeof document.addEventListener !== 'function') return
        favoriteArchiveListener = function (event) {
          var target = event && event.target
          if (!target || typeof target.closest !== 'function') return
          try {
            if (target.closest('.dsham_rowStar') || target.closest('[data-dsham-favorited]')) {
              // Hold the debounce handle so teardown can clear a timer that
              // would otherwise fire into a disposed sidebar.
              favoriteArchiveTimer = setTimeout(function () {
                favoriteArchiveTimer = null
                refreshArchiveFavorites(true)
              }, FAVORITE_ARCHIVE_RECHECK_MS)
            }
          } catch (error) {
            void error
          }
        }
        document.addEventListener('click', favoriteArchiveListener, true)
      }

      // ---- end session favorites ----------------------------------------

      /** Fallback for builds without createNamed: watch the list for a new id. */
      function waitForNewSession(ui, before) {
        return new Promise(function (resolve) {
          var tries = 0
          var newOnes = function () {
            var ids = knownSessionIds(ui)
            var added = []
            for (var i = 0; i < ids.length; i++) {
              if (before.indexOf(ids[i]) < 0) added.push(ids[i])
            }
            return added
          }
          var tick = function () {
            var added = newOnes()
            if (added.length > 0) { resolve(added[0]); return }
            tries += 1
            if (tries > 50) {
              // 0.7.3: 5 s is a heuristic, not a verdict. `startSession` may well
              // have created the session and just not published it to the list
              // yet (slow disk, first-run mkdir). Re-read once more before
              // calling it a failure: reporting "could not create" for a session
              // that exists leaves a permanent conversation the user believes
              // was never made.
              var late = newOnes()
              resolve(late.length === 1 ? late[0] : '')
              return
            }
            setTimeout(tick, 100)
          }
          tick()
        })
      }

      function createTempSession() {
        if (tempBusy) return
        var ui = uiWorkspace()
        if (!ui) {
          // Existing visible feedback stays; the ledger only records why this
          // host cannot create a session (no dead "clicked, nothing happened").
          degrade('uiworkspace-missing', 'temp')
          toast(t('temp.noNative') + ' ' + t('temp.restartHint'), true)
          return
        }
        tempBusy = true
        // The rail panel mirrors this flag, and the heartbeat is 1.5s away.
        scheduleSync()
        var createdId = '' // 0.7.3 (#2): id of the session we actually opened
        if (tempButton) {
          tempButton.disabled = true
          tempButton.textContent = t('temp.creating')
        }
        var releaseTempBusy = function () {
          tempBusy = false
          scheduleSync()
          if (tempWatchdog) {
            try { clearTimeout(tempWatchdog) } catch (error) { void error }
            tempWatchdog = 0
          }
          if (tempButton) {
            tempButton.disabled = false
            tempButton.textContent = t('temp.label')
          }
        }
        if (tempWatchdog) {
          try { clearTimeout(tempWatchdog) } catch (error) { void error }
          tempWatchdog = 0
        }
        // 0.8.11 — the track POST has its own 20s watchdog. When both fired
        // at the same deadline the request's catch and this timer raced to
        // toast, so one creation produced two different error messages. Give
        // the request first refusal: it reports `trackUncertain` with the real
        // state; this timer only catches a hang before any request was sent.
        tempWatchdog = setTimeout(function () {
          if (!tempBusy) return
          releaseTempBusy()
          toast(t('temp.timeout'), true)
        }, WRITE_TIMEOUT_MS + 3000)
        var workspaceId = newSessionWorkspace(ui)
        // 0.8.9: inherit the current conversation's preset (see
        // currentAgentPreset for why the host default cannot be trusted).
        var agentPreset = currentAgentPreset(ui)
        var before = knownSessionIds(ui)
        Promise.resolve()
          .then(function () {
            // No workspace yet (fresh install, nothing opened): let the host's
            // own button logic decide, then read the id it settles on.
            if (typeof ui.createNamed === 'function' && workspaceId !== undefined) {
              return ui.createNamed(agentPreset ? { workspaceId: workspaceId, agentPreset: agentPreset } : { workspaceId: workspaceId })
            }
            if (typeof ui.startSession === 'function') {
              ui.startSession(workspaceId)
              return waitForNewSession(ui, before)
            }
            throw new Error('uiWorkspace.createNamed / startSession missing')
          })
          .then(function (id) {
            if (!id) throw new Error('the host returned no session id')
            createdId = id
            // 0.7.3: a consumer tab owns the column, so opening a session while
            // one is active would create a conversation the user cannot see
            // (its row lives in the two groups that tab is hiding). Hand the
            // column back before opening.
            if (runtime.activeTab) activateTab(null)
            try {
              if (typeof ui.openSession === 'function') ui.openSession(id)
            } catch (error) {
              void error
            }
            if (tempIds.indexOf(id) < 0) tempIds.push(id)
            applyTempRows()
            return tempCall('api/dsh-temp-session.track?sessionId=' + encodeURIComponent(id), { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS })
          })
          .then(function (data) {
            if (!data || data.ok !== true) {
              var err = new Error((data && data.error) || 'tracking failed')
              err.trackFailed = true
              throw err
            }
            // 0.8.7: the counter had only two writers — the status payload at
            // startup and the id-list replies after a keep/delete. A brand new
            // temp session moved neither, so the tooltip kept saying "0 active"
            // until the page was reloaded, right after a toast said it worked.
            // No explicit scheduleSync here: releaseTempBusy() always runs and
            // already asks for one paint, and two in a row means two full
            // sidebar rebuilds for a single click.
            tempCountKnown = tempIds.length
            toast(t('temp.created'), false)
          })
          .catch(function (error) {
            // 0.7.3 (#2): once we have an id the session exists, so the only
            // open question is whether the host recorded it as temporary.
            //   - host answered ok:false -> it definitely did NOT record the
            //     id, so a TEMP badge would be a lie; drop it.
            //   - the request itself failed (host restarting, timeout) -> we
            //     cannot know. Keep the badge: a session wrongly believed
            //     temporary is recoverable, one wrongly believed permanent is
            //     deleted for good. Say "unconfirmed" instead of claiming the
            //     creation failed.
            if (createdId) {
              if (error && error.trackFailed) {
                tempIds = tempIds.filter(function (item) { return item !== createdId })
                applyTempRows()
                // The Host explicitly did not record this id; the tooltip must
                // describe the remaining tracked set, not the pre-create count.
                tempCountKnown = tempIds.length
                toast(t('temp.trackFailed') + t('temp.restartHint') + ' ' + t('temp.feedbackHint'), true)
              } else {
                // The request failed, but the id is still kept as a best-effort
                // temporary session. Keep the visible count in step with that
                // decision; otherwise TEMP badges and the tooltip disagree
                // until the next status poll.
                tempCountKnown = tempIds.length
                toast(t('temp.trackUncertain') + String((error && error.message) || error) + ' · ' + t('temp.restartHint') + ' ' + t('temp.feedbackHint'), true)
              }
              return
            }
            // 0.8.9: a stale Agent preset in the host's profile is not a
            // per-session failure — nothing can be created until it is fixed.
            // Name the preset and say whose problem it is, instead of the
            // "session create failed: agent-preset/not-found: ..." chain.
            var stalePreset = missingPresetName(error)
            if (stalePreset) {
              toast(String(t('temp.presetMissing')).split('{name}').join(stalePreset), true)
              return
            }
            toast(t('temp.failed') + String((error && error.message) || error) + ' · ' + t('temp.restartHint') + ' ' + t('temp.feedbackHint'), true)
          })
          .then(function () {
            // 0.8.10: both arms release. If the catch above throws (a toast path
            // touching a DOM the host just tore down), the old success-only
            // continuation left `tempBusy` set and the button disabled for the
            // full 20s watchdog — a create that had already finished reading as
            // "still creating".
            releaseTempBusy()
          }, releaseTempBusy)
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

      // ---- per-row menu on temporary rows (0.4.0) -----------------------
      // A temporary session used to be all-or-nothing: either it vanished at
      // quit, or you turned DELETE_ON_EXIT off and every temp session became a
      // normal one. Now a single row can be promoted ("keep as a normal
      // session") or deleted on the spot.
      //
      // Both actions already existed on the Host half — `untrack` and the new
      // `remove` route — so this is purely a missing entrance. It never touches
      // rows that are not temporary: no preventDefault, no stopPropagation, the
      // host's own context menu keeps working everywhere else.

      /** Nearest ancestor carrying data-row-key="session:<id>". */
      function tempRowOf(node) {
        var el = node
        var guard = 0
        while (el && el !== document && guard < 60) {
          guard += 1
          var key = el.getAttribute ? el.getAttribute('data-row-key') : ''
          if (key && key.indexOf('session:') === 0) return el
          el = el.parentNode
        }
        return null
      }

      function tempMenuButtons() {
        var out = []
        if (!tempRowMenu) return out
        var list = null
        try { list = tempRowMenu.querySelectorAll('button[data-dsbs-temp-action]') } catch (error) { void error }
        if (!list) return out
        for (var i = 0; i < list.length; i++) out.push(list[i])
        return out
      }

      function closeTempMenu(restoreFocus) {
        if (!tempRowMenu) return false
        var row = tempMenuRow
        try { if (tempRowMenu.parentNode) tempRowMenu.parentNode.removeChild(tempRowMenu) } catch (error) { void error }
        tempRowMenu = null
        tempMenuRow = null
        detachTempMenuDismiss()
        if (restoreFocus && row && typeof row.focus === 'function') {
          try { row.focus() } catch (error) { void error }
        }
        return true
      }

      function detachTempMenuDismiss() {
        var handlers = tempMenuDismiss
        if (!handlers) return
        tempMenuDismiss = null
        try { document.removeEventListener('pointerdown', handlers.onDown, true) } catch (error) { void error }
        try { document.removeEventListener('keydown', handlers.onKey, true) } catch (error) { void error }
        try { window.removeEventListener('resize', handlers.onViewport) } catch (error) { void error }
        try { window.removeEventListener('scroll', handlers.onViewport, true) } catch (error) { void error }
      }

      function attachTempMenuDismiss() {
        if (tempMenuDismiss) return
        var handlers = {
          onDown: function (event) {
            if (!tempRowMenu) return
            var target = event && event.target
            if (target && tempRowMenu.contains && tempRowMenu.contains(target)) return
            closeTempMenu(false)
          },
          onKey: function (event) {
            if (!tempRowMenu || !event) return
            var key = event.key
            if (key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              closeTempMenu(true)
              return
            }
            if (key === 'Tab') { closeTempMenu(false); return }
            if (key !== 'ArrowDown' && key !== 'ArrowUp') return
            var buttons = tempMenuButtons()
            if (!buttons.length) return
            event.preventDefault()
            var active = document.activeElement
            var at = buttons.indexOf(active)
            var next
            if (key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % buttons.length
            else next = at <= 0 ? buttons.length - 1 : at - 1
            try { buttons[next].focus() } catch (error) { void error }
          },
          // The menu is positioned in viewport coordinates, so any scroll or
          // resize would leave it floating next to the wrong row.
          onViewport: function () { closeTempMenu(false) },
        }
        tempMenuDismiss = handlers
        try { document.addEventListener('pointerdown', handlers.onDown, true) } catch (error) { void error }
        try { document.addEventListener('keydown', handlers.onKey, true) } catch (error) { void error }
        try { window.addEventListener('resize', handlers.onViewport) } catch (error) { void error }
        try { window.addEventListener('scroll', handlers.onViewport, true) } catch (error) { void error }
      }

      function makeTempMenuItem(action, labelKey, hintKey, onClick) {
        var button = document.createElement('button')
        button.type = 'button'
        button.setAttribute('role', 'menuitem')
        button.setAttribute('data-dsbs-temp-action', action)
        var label = document.createElement('span')
        label.textContent = t(labelKey)
        button.appendChild(label)
        var hint = t(hintKey)
        if (hint) {
          var sub = document.createElement('span')
          sub.setAttribute('data-dsbs-temp-menu-sub', '')
          sub.textContent = hint
          button.appendChild(sub)
        }
        button.addEventListener('click', function (event) {
          if (event) {
            event.preventDefault()
            event.stopPropagation()
          }
          closeTempMenu(false)
          onClick()
        })
        return button
      }

      /**
       * 0.7.4 — one definition of the row actions, shared by the native context
       * menu contribution and the DOM fallback. Any new action goes here once,
       * so the two paths can never drift apart.
       * Returns [{ id, label, hint?, danger?, run }].
       */
      function tempMenuActions(id) {
        if (!id || tempIds.indexOf(id) < 0 || !tempMenuEnabled) return []
        return [
          { id: 'keep', labelKey: 'temp.menu.keep', hintKey: 'temp.menu.keep.hint', label: t('temp.menu.keep'), run: function () { keepTempSession(id) } },
          { id: 'delete', labelKey: 'temp.menu.delete', hintKey: 'temp.menu.delete.hint', label: t('temp.menu.delete'), danger: true, run: function () { deleteTempSession(id) } },
          { id: 'openDir', labelKey: 'temp.menu.openDir', hintKey: 'temp.menu.openDir.hint', label: t('temp.menu.openDir'), run: function () { openSessionFolder(id) } },
        ]
      }

      /**
       * Copy a path without assuming the async Clipboard API is present.
       * Returns true/false, or a Promise<boolean> when the clipboard call is
       * asynchronous — callers must wait before claiming the copy succeeded.
       */
      function copyText(value) {
        var text = String(value == null ? '' : value)
        try {
          if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            var result = navigator.clipboard.writeText(text)
            if (result && typeof result.then === 'function') {
              return result.then(function () { return true }).catch(function () { return legacyCopy(text) })
            }
            return true
          }
        } catch (error) { void error }
        return legacyCopy(text)
      }

      function legacyCopy(text) {
        try {
          var input = document.createElement('textarea')
          input.value = text
          input.setAttribute('readonly', '')
          input.style.position = 'fixed'
          input.style.opacity = '0'
          document.body.appendChild(input)
          input.select()
          var ok = document.execCommand && document.execCommand('copy')
          document.body.removeChild(input)
          return ok === true
        } catch (error) {
          void error
          return false
        }
      }

      /**
       * Reveal the session's log folder through the host's public remote API.
       * If the host cannot open the path, fall back to copying it so the user
       * still has a working next step (no dead "clicked, nothing happened").
       */
      function openSessionFolder(id) {
        tempCall('api/dsh-temp-session.paths?sessionId=' + encodeURIComponent(id))
          .then(function (data) {
            if (!data || data.ok !== true) throw new Error((data && data.error) || 'path lookup failed')
            var paths = Array.isArray(data.paths) ? data.paths : []
            if (!paths.length) {
              toast(t('temp.menu.openDir.missing'), true)
              return
            }
            var target = paths[0]
            // Never claim "copied" unless the copy actually succeeded —
            // otherwise the fallback is another dead end for the user.
            var showCopyResult = function (ok) {
              if (ok === true) toast(t('temp.menu.openDir.copied'), false)
              else toast(t('temp.menu.openDir.copyFailed') + ' ' + target, true)
            }
            var fallback = function () {
              var copied = copyText(target)
              if (copied && typeof copied.then === 'function') {
                copied.then(showCopyResult).catch(function () { showCopyResult(false) })
              } else {
                showCopyResult(copied === true)
              }
            }
            var remote = remoteSession
            if (!remote || typeof remote.openWorkspacePath !== 'function') {
              fallback()
              return
            }
            // The host's Remote declares cancellation for this method and
            // dereferences signal.aborted; omitting it makes the call fail.
            var signal
            try {
              signal = typeof AbortController === 'function' ? new AbortController().signal : undefined
            } catch (error) {
              void error
            }
            var opened
            try {
              opened = remote.openWorkspacePath({ path: target, action: 'reveal' }, signal)
            } catch (error) {
              opened = null
            }
            if (opened && typeof opened.then === 'function') {
              opened.then(function (result) {
                if (result && result.ok === true) return
                fallback()
              }).catch(fallback)
            } else if (opened && opened.ok === true) {
              return
            } else {
              fallback()
            }
          })
          .catch(function (error) {
            toast(opError('temp.menu.failed', error), true)
          })
      }

      function openTempMenu(row, id, x, y) {
        closeTempMenu(false)
        var menu = document.createElement('div')
        menu.setAttribute('data-dsbs-temp-menu', '')
        menu.setAttribute('role', 'menu')
        menu.setAttribute('aria-label', t('temp.menu.label'))
        // The row's own text is the only title available (the host owns the
        // session list), and it is what the user just pointed at.
        var text = (row.textContent || '').replace(/\s+/g, ' ').trim()
        if (text) {
          var head = document.createElement('div')
          head.setAttribute('data-dsbs-temp-menu-head', '')
          head.textContent = text.length > 48 ? text.slice(0, 48) + '…' : text
          menu.appendChild(head)
        }
        var actions = tempMenuActions(id)
        for (var a = 0; a < actions.length; a++) {
          (function (action) {
            menu.appendChild(makeTempMenuItem(action.id, action.labelKey || ('temp.menu.' + action.id), action.hintKey || '', action.run))
          })(actions[a])
        }
        document.body.appendChild(menu)

        // Measure first, then flip near the viewport edges. Both reads are
        // wrapped: a detached or unmeasured node must not break the menu.
        var width = 0
        var height = 0
        try {
          var rect = menu.getBoundingClientRect ? menu.getBoundingClientRect() : null
          width = (rect && rect.width) || menu.offsetWidth || 0
          height = (rect && rect.height) || menu.offsetHeight || 0
        } catch (error) { void error }
        if (!width) width = 220
        if (!height) height = 96
        var vw = window.innerWidth || 1024
        var vh = window.innerHeight || 768
        var left = Number.isFinite(x) ? x : 0
        var top = Number.isFinite(y) ? y : 0
        if (left + width > vw - 8) left = Math.max(8, vw - width - 8)
        if (top + height > vh - 8) top = Math.max(8, vh - height - 8)
        menu.style.left = Math.round(left) + 'px'
        menu.style.top = Math.round(top) + 'px'

        tempRowMenu = menu
        tempMenuRow = row
        attachTempMenuDismiss()
        var buttons = tempMenuButtons()
        if (buttons.length) {
          try { buttons[0].focus() } catch (error) { void error }
        }
      }

      /** Promote one session: it stops being temporary, nothing is deleted. */
      function keepTempSession(id) {
        tempCall('api/dsh-temp-session.untrack?sessionId=' + encodeURIComponent(id), { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS })
          .then(function (data) {
            if (!data || data.ok !== true) throw new Error((data && data.error) || 'untrack failed')
            applyTempIdList(data.ids, id)
            toast(t('temp.menu.kept'), false)
            scheduleSync()
          })
          .catch(function (error) {
            toast(opError('temp.menu.failed', error), true)
          })
      }

      /** Delete one session now, with the same fallback `purgeAll` uses. */
      function deleteTempSession(id) {
        tempCall('api/dsh-temp-session.remove?sessionId=' + encodeURIComponent(id), { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS })
          .then(function (data) {
            if (!data || data.ok !== true) throw new Error((data && data.error) || 'delete failed')
            applyTempIdList(data.ids, id)
            toast(t(data.hidden ? 'temp.menu.hidden' : 'temp.menu.deleted'), false)
            refreshHostSessions()
            scheduleSync()
          })
          .catch(function (error) {
            toast(opError('temp.menu.failed', error), true)
          })
      }

      /** Adopt the id list the Host returned, or just drop the one id. */
      function applyTempIdList(ids, removedId) {
        if (Array.isArray(ids)) {
          tempIds = ids.slice()
          // 0.8.4: keep the tooltip count on the same source of truth.
          tempCountKnown = tempIds.length
        } else {
          tempIds = tempIds.filter(function (item) { return item !== removedId })
          if (tempCountKnown >= 0 && tempCountKnown > tempIds.length) tempCountKnown = tempIds.length
        }
        applyTempRows()
        if (tempRowMenu && tempMenuRow) {
          var key = tempMenuRow.getAttribute('data-row-key') || ''
          if (tempIds.indexOf(key.slice('session:'.length)) < 0) closeTempMenu(false)
        }
      }

      /**
       * Ask the host's own session list to re-read. There is no documented API
       * for this, so every common name is tried and failure is silent: a row
       * that outlives its files disappears on the next list refresh anyway.
       */
      function refreshHostSessions() {
        try {
          var ui = uiWorkspace()
          var sessions = ui && ui.sessions
          var names = ['reload', 'refresh', 'reloadSessions', 'invalidate']
          for (var i = 0; i < names.length; i++) {
            if (sessions && typeof sessions[names[i]] === 'function') {
              sessions[names[i]]()
              return true
            }
          }
        } catch (error) {
          void error
        }
        return false
      }

      function onTempContextMenu(event) {
        if (runtime.disposed || !tempMenuEnabled || !event) return
        var row = tempRowOf(event.target)
        if (!row) return
        var key = row.getAttribute('data-row-key') || ''
        var id = key.slice('session:'.length)
        // Not one of ours: leave the event completely alone so the host (or
        // whichever plugin owns that row) still gets its own menu.
        if (!id || tempIds.indexOf(id) < 0) return
        // 0.8.7 — a successful registration used to be the whole story: the
        // host's own row opened the shared popup, our two actions came along.
        // DSH 0.2.3-alpha.2 still accepts the contribution but no longer
        // binds the gesture on session rows, so nothing opened and the two
        // actions had no entrance at all. Read the popup instead of trusting
        // the registration, and open it here when the click opened nothing.
        var point = tempMenuPoint(event, row)
        if (tempMenuMode === 'native') {
          var opened = nativeMenuActive()
          if (opened !== null && opened !== undefined) return
          event.preventDefault()
          event.stopPropagation()
          if (openNativeTempMenu(row, id, point)) return
          openTempMenu(row, id, point.x, point.y)
          return
        }
        event.preventDefault()
        event.stopPropagation()
        openTempMenu(row, id, point.x, point.y)
      }

      /**
       * Where the menu should open. A keyboard gesture (the ContextMenu key or
       * Shift+F10) reports a `contextmenu` with no coordinates — 0,0 — and
       * taking that literally pinned the menu to the window's top-left corner,
       * far from the row the user was standing on. The host's own trigger
       * answers the same event with the row's box; do the same.
       */
      function tempMenuPoint(event, row) {
        var x = typeof event.clientX === 'number' && isFinite(event.clientX) ? event.clientX : 0
        var y = typeof event.clientY === 'number' && isFinite(event.clientY) ? event.clientY : 0
        if (x !== 0 || y !== 0) return { x: x, y: y }
        try {
          var rect = row && typeof row.getBoundingClientRect === 'function' ? row.getBoundingClientRect() : null
          if (rect && isFinite(rect.left) && isFinite(rect.bottom)) return { x: rect.left, y: rect.bottom }
        } catch (error) { void error }
        return { x: x, y: y }
      }

      /**
       * The target the host's shared popup currently shows, or undefined when
       * the service exposes nothing readable. `null` means "the host has no
       * popup open right now", which is the case this client has to fill.
       */
      function nativeMenuActive() {
        var source = nativeMenus && nativeMenus.active
        if (!source) return undefined
        // Three host shapes, one guarded path: snapshot getter, plain getter,
        // or a callable. hostCall() applies the method to `source`, preserving
        // the receiver the pre-adaptation `source.getSnapshot()` had; a getter
        // that throws simply falls through to the next shape.
        var snapshot = hostCall(source, 'getSnapshot', [])
        if (snapshot.ok && snapshot.value !== undefined) return snapshot.value
        var plain = hostCall(source, 'get', [])
        if (plain.ok && plain.value !== undefined) return plain.value
        if (typeof source === 'function') {
          var called = hostCall({ invoke: source }, 'invoke')
          if (called.ok) return called.value
        }
        return undefined
      }

      /**
       * Ask the host to open its shared popup for this session. The session
       * target is the same one the host's own rows use, so its items and ours
       * arrive in one menu. False means the call is unavailable or refused —
       * the caller then shows the DOM menu instead of nothing.
       */
      function openNativeTempMenu(row, id, point) {
        if (!featureDetect(nativeMenus, 'open')) return false
        var title = tempSessionTitle(id)
        if (!title) {
          // Last resort: the row's own text, the title our DOM menu shows too.
          try { title = (row.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) } catch (error) { void error }
        }
        // hostCall keeps a throwing host API from escaping into the click
        // handler; the caller falls back to our DOM menu on any failure.
        var opened = hostCall(nativeMenus, 'open', [
          { kind: 'session', value: { sessionId: id, displayTitle: title } },
          { x: point.x, y: point.y },
        ])
        if (opened.ok) return true
        degrade('native-menu-open-failed', 'menus')
        return false
      }

      /**
       * The title the host's own rows hand to the menu (`row.title`), read from
       * the same store: a synthetic target should not look different from a
       * native one to anything downstream that reads `displayTitle`.
       */
      function tempSessionTitle(id) {
        try {
          var ui = uiWorkspace()
          var snap = listOf(ui && ui.sessions && ui.sessions.list)
          var entry = snap && snap.byId ? snap.byId[id] : null
          var title = entry && entry.displayTitle
          if (typeof title === 'string' && title) return title.slice(0, 120)
        } catch (error) { void error }
        return ''
      }

      var tempMenuUnmount = null
      function mountTempRowMenu() {
        // 0.8.7: mounted in BOTH modes. In native mode the listener only
        // decides whether the host opened its popup and opens it otherwise, so
        // a host that registers the contribution but never wires the gesture
        // still reaches our actions.
        if (tempMenuUnmount) return
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
        document.addEventListener('contextmenu', onTempContextMenu)
        tempMenuUnmount = function () {
          try { document.removeEventListener('contextmenu', onTempContextMenu) } catch (error) { void error }
          closeTempMenu(false)
          nativeMenus = null
        }
      }

      function applyTempMenuSetting(data) {
        var next = !data || data.rowMenu !== false
        if (next === tempMenuEnabled) return
        tempMenuEnabled = next
        if (!next) closeTempMenu(false)
      }

      function refreshTempIds() {
        return tempCall('api/dsh-temp-session.list')
          .then(function (data) {
            if (data && Array.isArray(data.ids)) {
              tempIds = data.ids.slice()
              // 0.8.4: same source the tooltip count reads. The paint that
              // carried the previous count may already have happened (this
              // answer arrives after it), so ask for one more.
              if (tempCountKnown !== tempIds.length) {
                tempCountKnown = tempIds.length
                scheduleSync()
              }
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
        setFlag(html, 'data-dsbs-temp-off', hidden)
      }

      function hideTempButton() {
        tempShowButton = false
        applyTempButtonVisibility()
      }

      /**
       * The row the host renders our seat in. The seat is a child of the slot
       * outlet (`[data-slot="sidebar.session.action"]`, display:contents), whose
       * parent is the New-session row — that row is the flex container we may
       * need to let wrap in `own` mode. No `closest()`: it walks one level at a
       * time so the DOM stub can run the same code.
       */
      function tempSeatRow(seat) {
        var parent = seat.parentElement
        if (!parent) return null
        var isOutlet = false
        try { isOutlet = typeof parent.hasAttribute === 'function' && parent.hasAttribute('data-slot') } catch (error) { void error }
        if (isOutlet && parent.parentElement) return parent.parentElement
        return parent
      }

      function placeTempButton() {
        if (!tempButton) tempButton = makeTempButton()
        ensureChatGuard()
        // 0.6.0: prefer the seat the host renders for us inside its own row.
        var seat = null
        try { seat = document.querySelector('[data-dsbs-temp-anchor]') } catch (error) { void error }
        var native = null
        try { native = document.querySelector('button[class*="newSession"]') } catch (error) { void error }
        var mode = seat ? 'slot' : (native && native.parentNode ? 'dom' : '')
        if (!mode) return false
        var host = mode === 'slot' ? tempSeatRow(seat) : native.parentNode
        if (!host) return false

        // The host can gain or lose the slot across an upgrade or a chat-mode
        // swap. Tear the other path's node down first so exactly one button
        // ever exists, then publish the mode for the CSS.
        if (mode !== tempSlotMode) {
          if (tempSlot && tempSlot.parentNode && tempSlot !== seat) tempSlot.parentNode.removeChild(tempSlot)
          tempSlot = null
          if (tempButton.parentNode) tempButton.parentNode.removeChild(tempButton)
          tempSlotMode = mode
          if (html) html.setAttribute('data-dsbs-temp-mode', mode)
        }

        if (mode === 'slot') {
          // Empty by design: React owns this element, we only put a button in it.
          if (tempSlot !== seat) tempSlot = seat
          if (tempButton.parentNode !== tempSlot) tempSlot.appendChild(tempButton)
        } else {
          // The host's "New Session" button is a direct child of the sidebar
          // root, and dsh-deepseek-chat validates that root: it needs exactly
          // one direct <button> child. Adding a second one there makes its
          // sidebar adapter give up and show "当前侧栏不兼容：顶部新会话仍使用
          // HARNESS". Our button therefore lives inside [data-dsbs-temp-slot],
          // which the adapter ignores.
          if (!tempSlot) tempSlot = makeTempSlot()
          if (tempButton.parentNode !== tempSlot) tempSlot.appendChild(tempButton)
          if (tempSlot.parentNode !== host) host.insertBefore(tempSlot, native.nextSibling)
        }
        if (host !== tempNewChatHost) {
          if (tempNewChatHost) tempNewChatHost.removeAttribute('data-dsbs-newchat')
          tempNewChatHost = host
          host.setAttribute('data-dsbs-newchat', '')
        }
        // The collapsed rail has no horizontal room for a second button. In slot
        // mode the host states it directly through the occupant's `wide` prop;
        // measurement stays as the fallback (older hosts, or before first paint).
        var solo = tempSlotWide === false
        if (!solo) {
          var width = 0
          try { width = host.getBoundingClientRect().width } catch (error) { void error }
          var fixed = false
          try { fixed = !!(window.getComputedStyle && native && window.getComputedStyle(native).position === 'fixed') } catch (error) { void error }
          solo = fixed || runtime.rail === true || (width > 0 && width < 170)
        }
        setFlag(html, 'data-dsbs-temp-solo', solo)
        // 0.7.3: paint() runs on a 1.5 s heartbeat, so an unguarded relabel put
        // "临时" back on a button still disabled from an in-flight create —
        // looked like a broken button. Leave the transient label alone.
        if (!tempBusy) {
          var label = t('temp.label')
          if (tempButton.textContent !== label) tempButton.textContent = label
        }
        var hint = t('temp.hint')
        // 0.8.4: end the tooltip with the live count once the Host has answered
        // at least once. The suffix is bilingual, so it carries {n} twice —
        // replace every occurrence, not just the first.
        if (tempCountKnown >= 0) {
          hint += String(t('temp.countSuffix')).split('{n}').join(String(tempCountKnown))
        }
        if (tempButton.title !== hint) tempButton.title = hint
        applyTempButtonVisibility()
        return true
      }

      var tempStatusLoaded = false
      var tempStatusTries = 0
      var tempStatusPending = false
      // 0.7.4: last failure reason, surfaced by the detail-page self-check.
      var tempStatusError = ''
      // 0.7.2 (#4): backoff deadline for status retries. The old code gave up
      // forever after 3 failures, so a startup race (Host routes not registered
      // yet) left temp badges and the keep/delete menu dead for the whole page
      // session. Retries now continue with capped backoff until one succeeds.
      var tempStatusNextTry = 0

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
        // 0.6.0: the flag now carries the value the CSS reads. It used to be
        // written as a boolean ("true"), so every [data-dsbs-temp-style="own"]
        // rule was dead and TEMP_BUTTON_STYLE=own never applied.
        if (html && data && data.buttonStyle) {
          if (String(data.buttonStyle) === 'own') html.setAttribute('data-dsbs-temp-style', 'own')
          else html.removeAttribute('data-dsbs-temp-style')
        }
        // Older Host halves (<= 0.2.3) do not send this key; default to on.
        expandAll = !data || data.expandAllSessions !== false
        expandAllKnown = true
        applyExpandFlag()
        // 0.4.0 — same treatment: a Host without this key keeps the menu on.
        applyTempMenuSetting(data)
        syncChatMode()
        expandAllSessions()
        scheduleSync()
      }

      function rememberConfigRevision(data) {
        if (data && typeof data.configRevision === 'number') tempConfigRevision = data.configRevision
      }

      /**
       * 1.1.4 — request one expand pass off the current frame. Used where no
       * repaint is guaranteed to follow (a group just became visible, a tab
       * flip), so the deferred sweep replaces the synchronous one without
       * starving the "always expanded" promise. A pending sweep absorbs every
       * further request: the pass scans the whole list anyway.
       */
      function scheduleExpandPass(delay) {
        rowsDirty = true
        if (expandSoonTimer || runtime.disposed) return
        expandSoonTimer = setTimeout(function () {
          expandSoonTimer = 0
          if (runtime.disposed || !rowsDirty) return
          rowsDirty = false
          expandAllSessions()
        }, delay || 120)
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
        // 0.7.2 (#4): never abandon permanently. Honour the backoff deadline
        // between attempts, but a later heartbeat always gets another try —
        // the Host routes may simply not have been registered during the first
        // few seconds after a cold start or a hot reload.
        var nowMs = typeof Date !== 'undefined' && Date.now ? Date.now() : 0
        if (tempStatusTries > 0 && nowMs < tempStatusNextTry) return
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
            // 1.1.4 — the gate just opened: the sweep is dirty by definition.
            rowsDirty = true
            scheduleSync()
          }, 2000)
        }
        // 20s watchdog: a hung request must not freeze temp badges/menu for the
        // whole page session. The catch below clears `tempStatusPending` and
        // arms the capped backoff, so the next heartbeat can try again.
        tempCall('api/dsh-temp-session.status', { timeoutMs: 20000 }).then(function (data) {
          tempStatusPending = false
          tempStatusLoaded = true
          tempStatusError = ''
          // 0.8.4: the status payload carries the authoritative count.
          if (data && typeof data.tempCount === 'number') tempCountKnown = data.tempCount
          if (expandGateTimer) { clearTimeout(expandGateTimer); expandGateTimer = 0 }
          rememberConfigRevision(data)
          applyTempSettings(data)
          refreshTempIds()
        }).catch(function (error) {
          tempStatusError = String((error && error.message) || error || 'request failed')
          tempStatusPending = false
          // 0.7.2 (#4): capped exponential backoff — 1s, 2s, 4s … 15s. A later
          // heartbeat retries, so a transient Host race self-heals.
          var backoffMs = Math.min(1000 * Math.pow(2, tempStatusTries - 1), 15000)
          tempStatusNextTry = (typeof Date !== 'undefined' && Date.now ? Date.now() : 0) + backoffMs
          if (expandGateTimer) { clearTimeout(expandGateTimer); expandGateTimer = 0 }
          if (!expandAllKnown) {
            expandAllKnown = true
            expandAll = true
            applyExpandFlag()
            // 1.1.4 — an unreachable Host still opens the gate; the list has to
            // be swept once, or the default-on promise would silently do nothing.
            rowsDirty = true
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

      // The layouts are one segmented pill (mutually exclusive); the actions
      // belonging to the chosen layout sit after a divider. 0.5.0 removed the
      // two independent fold toggles, which could produce an empty sidebar.
      // The official default has no action at all, but the pill STAYS visible:
      // with showQuickSwitch off it is the only way back out of that layout.
      // Glyphs are CSS pseudo elements, so makeButton() keeps owning the plain
      // text node that relabel() rewrites.
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
          modeButton.setAttribute('data-dsbs-glyph', mode)
          seg.appendChild(modeButton)
        }
        bar.appendChild(seg)

        var separator = makeSeparator()
        bar.appendChild(separator)

        // 1.1.4 — a flip is a view change first and a profile write second:
        // toggleTab() moves the column inside the click frame and coalesces
        // the write, so ten quick clicks cost one YAML write instead of ten.
        var tabSwap = makeButton('tab-swap', 'tab.to.ws', 'tab.to.ws.hint', function () {
          toggleTab()
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
        tabSwap.setAttribute('data-dsbs-glyph', 'swap')
        pop.setAttribute('data-dsbs-glyph', 'pop')
        quick.setAttribute('data-dsbs-glyph', 'quick')
        bar.appendChild(tabSwap)
        bar.appendChild(pop)
        bar.appendChild(quick)

        // 0.7.3: `seg` and `quick` join the parts registry so a consumer tab
        // can hide every layout control at once (see paint) and so the divider
        // counts a visible Cycle button as a reason to exist.
        runtime.parts = { separator: separator, seg: seg, context: [tabSwap, pop, quick] }
        return bar
      }

      // A paint must be able to leave the tree exactly as it found it. Asking
      // for an exact neighbour is not enough: the 0.3.0 tab strip (and an
      // active plugin's panel) legitimately sit between the control bar and
      // the host's panels nav, so `bar.nextSibling === nav` can never be true
      // once those exist. Moving the bar on every paint mutates the observed
      // root, which fires the MutationObserver, which schedules another paint
      // -- a microtask loop that never returns to the event loop and hangs DSH
      // on "Loading plugins..." with the renderer at 100%. Compare ORDER, not
      // adjacency.
      function isBefore(node, reference) {
        if (!node || !reference || !node.parentNode || node.parentNode !== reference.parentNode) return false
        var list = node.parentNode.children
        var at = -1
        var before = -1
        for (var i = 0; i < list.length; i++) {
          if (list[i] === node) at = i
          if (list[i] === reference) before = i
        }
        return at >= 0 && before >= 0 && at < before
      }

      function ensureBar(fx) {
        // rc.2's scrollArea is a grid with explicitly pinned host rows, so the
        // bar lives one level up in scrollRegion (flex column). Targeting the
        // scrolling viewport as the anchor means "above the list" in every
        // fold state without ever becoming a grid item.
        var host = fx.headerHost || fx.root
        var anchor = (fx.scrollArea && fx.scrollArea.parentNode === host)
          ? fx.scrollArea : host.firstChild
        var bar = runtime.bar
        if (bar && bar.parentNode !== host) {
          try {
            if (bar.parentNode) bar.parentNode.removeChild(bar)
          } catch (error) {
            void error
          }
          bar = null
        }
        if (!bar) {
          bar = buildBar()
          runtime.bar = bar
        }
        // Compare ORDER, never adjacency: the tab strip sits between the bar
        // and the anchor in the steady state. Demanding `nextSibling ===
        // anchor` moved a node on every paint and hung DSH in 0.3.0.
        if (anchor === bar) return bar
        if (bar.parentNode === host && anchor && anchor.parentNode === host
          && isBefore(bar, anchor)) return bar
        host.insertBefore(bar, anchor)
        return bar
      }

      // ---- three-page switch (1.1.0) ----------------------------------
      // The pages are ordinary DSH `main` panels: selecting one uses the host's
      // own navigation, so clicking a session, opening Plugins, or pressing a
      // global shortcut behaves exactly as it does without this plugin.
      function desktopBrowser() {
        try {
          var desk = window.dshDesktop
          if (!desk || !desk.browser) return null
          if (typeof desk.browser.acquire !== 'function') return null
          return desk.browser
        } catch (error) {
          void error
          return null
        }
      }

      function hasDesktopPages() {
        return desktopBrowser() !== null
      }

      function buildPageBar() {
        var bar = document.createElement('div')
        bar.setAttribute('data-dsbs-pages', '')
        bar.setAttribute('role', 'group')
        bar.setAttribute('aria-label', t('pages.label'))

        for (var i = 0; i < PAGES.length; i++) {
          (function (pageId) {
            var button = document.createElement('button')
            button.type = 'button'
            button.setAttribute('data-dsbs-page', pageId)
            button.setAttribute('aria-pressed', 'false')
            button.textContent = t('page.' + pageId)
            button.title = t('page.' + pageId + '.hint')
            button.addEventListener('click', function () {
              setPage(pageId)
            })
            bar.appendChild(button)
          })(PAGES[i])
        }
        return bar
      }

      function sidebarLogoRow() {
        // CSS-module class names keep the readable `logoRow` semantic suffix;
        // match on that rather than an opaque build hash.
        var row = document.querySelector('[class*="logoRow"]')
        if (row) return row
        var toggle = document.querySelector('[data-sidebar-toggle]')
        if (!toggle || !toggle.parentNode) return null
        var parent = toggle.parentNode
        if (parent.querySelector && parent.querySelector('[aria-hidden="true"]')) return parent
        return null
      }

      function setBrandCompact(on) {
        var row = sidebarLogoRow()
        if (!row || !row.firstElementChild) return
        if (on && runtime.pageBar && runtime.pageBar.parentNode === row) {
          row.firstElementChild.setAttribute('data-dsbs-brand', 'compact')
        } else {
          row.firstElementChild.removeAttribute('data-dsbs-brand')
        }
      }

      function ensurePageBar(fx) {
        var bar = ensureBar(fx)
        if (!bar) return null
        var row = sidebarLogoRow()
        var host = row || bar
        var pageBar = runtime.pageBar
        if (pageBar && pageBar.parentNode === host) return pageBar
        if (pageBar && pageBar.parentNode) {
          try {
            pageBar.parentNode.removeChild(pageBar)
          } catch (error) {
            void error
          }
        }
        if (!pageBar) {
          pageBar = buildPageBar()
          runtime.pageBar = pageBar
        }
        if (row) {
          // Sit between the brand and the panel toggle, exactly in the empty
          // band the wordmark leaves behind.
          var toggle = row.querySelector('[data-sidebar-toggle]')
          if (toggle && toggle.parentNode === row) row.insertBefore(pageBar, toggle)
          else row.insertBefore(pageBar, null)
          setBrandCompact(true)
        } else {
          var anchor = runtime.parts && runtime.parts.separator
          if (anchor && anchor.parentNode === bar) bar.insertBefore(pageBar, anchor)
          else bar.appendChild(pageBar)
          setBrandCompact(false)
        }
        return pageBar
      }

      function relabelPageBar() {
        var pageBar = runtime.pageBar
        if (!pageBar) return
        var label = t('pages.label')
        if (pageBar.getAttribute('aria-label') !== label) pageBar.setAttribute('aria-label', label)
        var buttons = pageBar.querySelectorAll('button[data-dsbs-page]')
        for (var i = 0; i < buttons.length; i++) {
          var key = buttons[i].getAttribute('data-dsbs-page')
          var text = t('page.' + key)
          if (buttons[i].textContent !== text) buttons[i].textContent = text
          var hint = t('page.' + key + '.hint')
          if (buttons[i].title !== hint) buttons[i].title = hint
        }
      }

      function paintPageBar(state, pluginTab) {
        var pageBar = runtime.pageBar
        if (!pageBar) return
        var supported = hasDesktopPages()
        var ready = runtime.pageReady && runtime.pageLayout !== null
        var chatMode = false
        try {
          chatMode = html.getAttribute('data-dsbs-chat-mode') === 'true'
        } catch (error) {
          void error
        }
        // Hide every dead state: no desktop bridge, no registered panels, the
        // rail (no horizontal room), a third-party tab, or dsh-deepseek-chat's
        // own CHAT site where this sidebar is not ours anymore.
        if (!supported || !ready || runtime.rail || pluginTab || chatMode) {
          pageBar.setAttribute('hidden', '')
          setBrandCompact(false)
          return
        }
        pageBar.removeAttribute('hidden')
        setBrandCompact(true)
        var buttons = pageBar.querySelectorAll('button[data-dsbs-page]')
        for (var i = 0; i < buttons.length; i++) {
          var pageId = buttons[i].getAttribute('data-dsbs-page')
          var active = runtime.page === pageId
          buttons[i].setAttribute('aria-pressed', active ? 'true' : 'false')
          buttons[i].disabled = false
        }
        try {
          if (html.getAttribute('data-dsbs-page') !== runtime.page) html.setAttribute('data-dsbs-page', runtime.page)
        } catch (error) {
          void error
        }
        // A host that knows the desktop bridge but never mounts the main slot
        // gets an honest disabled row instead of buttons that do nothing.
        if (!ready) {
          for (var d = 0; d < buttons.length; d++) buttons[d].disabled = true
        }
      }

      function syncPageFromLayout() {
        if (runtime.disposed || !runtime.pageLayout) return
        var active = null
        try {
          var info = runtime.pageLayout.panelInfo
          if (info && typeof info.getSnapshot === 'function') {
            var snapshot = info.getSnapshot()
            active = snapshot && snapshot.activePanelId ? snapshot.activePanelId : null
          }
        } catch (error) {
          void error
          return
        }
        var next = 'agent'
        if (active === PAGE_DEFS.chat.id) next = 'chat'
        else if (active === PAGE_DEFS.api.id) next = 'api'
        else if (active) next = 'other'
        if (next === runtime.page) return
        runtime.page = next
        try {
          html.setAttribute('data-dsbs-page', next)
        } catch (error) {
          void error
        }
        scheduleSync()
      }

      function setPage(pageId) {
        if (PAGES.indexOf(pageId) < 0) return
        if (!runtime.pageReady || !runtime.pageLayout) {
          toast(t('page.notReady'), true)
          return
        }
        var previous = runtime.page
        var target = pageId === 'agent' ? null : PAGE_DEFS[pageId].id
        try {
          runtime.pageLayout.selectPanel(target)
        } catch (error) {
          void error
          toast(t('page.notReady'), true)
          return
        }
        runtime.page = pageId
        try {
          html.setAttribute('data-dsbs-page', pageId)
        } catch (inner) {
          void inner
        }
        if (previous !== pageId) scheduleSync()
      }

      // ---- embedded page login snapshots -------------------------------
      // The guest partition is throw-away by design, so the page's small
      // localStorage entries are mirrored through the plugin's own /api route.
      // Nothing is sent anywhere else; the host half prefers ctx.credentials.
      //
      // 1.1.5 — `restored` is a latch for a successful read only. A missing
      // host route or timeout used to latch it before the request even ran,
      // which made every later dom-ready/did-finish-load a no-op until DSH was
      // restarted. `epoch` invalidates timer callbacks and in-flight writes
      // from a guest that has already been released by a remount.
      //
      // A deliberate logout also has to survive a DSH restart. `clearPending`
      // alone is memory-only: if the host route was missing when the user
      // signed out, the old snapshot is still on disk and the next launch
      // would inject it before the retry gets a chance. The per-page flag in
      // the main window's localStorage makes the intent outlive the process.
      var WEB_LOGIN_CLEAR_KEY = 'dsh-sidebar-suite:web-login-clear'
      // Save and clear share one backoff window; the restore retry and the
      // capture poll have their own delays. Kept inside this block so the
      // standalone-sliced login state machine still sees these bindings.
      var WEB_LOGIN_RETRY_WINDOW_MS = 4000
      var WEB_LOGIN_RESTORE_RETRY_MS = 5000
      var WEB_LOGIN_CAPTURE_POLL_MS = 1500

      function webLoginClearKey(pageId) {
        return WEB_LOGIN_CLEAR_KEY + ':' + pageId
      }

      function readWebLoginClear(pageId) {
        try {
          return window.localStorage.getItem(webLoginClearKey(pageId)) === '1'
        } catch (error) {
          void error
          return false
        }
      }

      function writeWebLoginClear(pageId, pending) {
        try {
          if (pending) window.localStorage.setItem(webLoginClearKey(pageId), '1')
          else window.localStorage.removeItem(webLoginClearKey(pageId))
        } catch (error) {
          void error
        }
      }

      function newWebLoginState(pageId) {
        return {
          restored: false,
          restoring: false,
          restoreFailures: 0,
          restoreTimer: 0,
          signedIn: false,
          lastAttempt: 0,
          lastSaved: '',
          saveTimer: 0,
          clearPending: readWebLoginClear(pageId),
          lastClearAttempt: 0,
          clearInFlight: false,
          // CH-06: the host could not reach the credential store, so this login
          // is kept in memory only and must be called out on the panel.
          credentialsUnavailable: false,
          epoch: 0,
        }
      }
      var webLoginState = {
        chat: newWebLoginState('chat'),
        api: newWebLoginState('api'),
      }

      function resetWebLoginPage(pageId) {
        var state = webLoginState[pageId]
        if (!state) return
        state.epoch += 1
        state.restored = false
        state.restoring = false
        state.restoreFailures = 0
        if (state.restoreTimer) {
          try { clearTimeout(state.restoreTimer) } catch (error) { void error }
          state.restoreTimer = 0
        }
        if (state.saveTimer) {
          try { clearTimeout(state.saveTimer) } catch (error) { void error }
          state.saveTimer = 0
        }
        // A fresh guest must not mistake a transient empty read for a
        // deliberate sign-out. A pending clear survives, so a failed logout
        // still retries instead of resurrecting the old snapshot. Re-read the
        // persistent flag too: another window may have armed it while this
        // page was unmounted.
        state.clearPending = state.clearPending || readWebLoginClear(pageId)
        state.signedIn = false
        state.lastAttempt = 0
        state.lastSaved = ''
        state.lastClearAttempt = 0
        state.clearInFlight = false
        state.credentialsUnavailable = false
      }

      function webLoginCall(suffix, options) {
        return tempCall(WEB_LOGIN_API + suffix, options)
      }

      function loadWebLogin(pageId) {
        return webLoginCall('-load?page=' + encodeURIComponent(pageId), { timeoutMs: 6000 })
          .catch(function () { return { ok: false, found: false } })
      }

      // A page that stays on its sign-in route after a successful QR scan is
      // the normal DeepSeek case: the login happens through an API call and
      // React only swaps the visible screen. A did-finish-load handler runs
      // before that, so relying on navigation alone would never capture the
      // token. This function is therefore called by a short poll as well.
      function saveWebLogin(pageId, entries) {
        if (!entries || typeof entries !== 'object') return Promise.resolve(false)
        var state = webLoginState[pageId]
        var fingerprint
        try {
          fingerprint = JSON.stringify(entries)
        } catch (error) {
          void error
          return Promise.resolve(false)
        }
        if (fingerprint === state.lastSaved) return Promise.resolve(true)
        var now = Date.now()
        // A failing host route must not turn into a request every 1.5 seconds;
        // retry at most every four seconds while the page remains open.
        if (state.lastAttempt > 0 && now - state.lastAttempt < WEB_LOGIN_RETRY_WINDOW_MS) return Promise.resolve(false)
        state.lastAttempt = now
        var epoch = state.epoch
        return webLoginCall('-save', {
          method: 'POST',
          body: JSON.stringify({ page: pageId, entries: entries }),
          timeoutMs: 8000,
        }).then(function (data) {
          if (data && data.ok === true) {
            if (state.epoch === epoch) {
              state.lastSaved = fingerprint
              state.signedIn = true
              state.restored = true
              // A token captured after a failed logout means the user signed
              // back in; the pending clear must not delete this newer save.
              state.clearPending = false
              // The user signed back in after a failed logout; the old snapshot
              // is now superseded and the persistent logout intent must go too.
              writeWebLoginClear(pageId, false)
              // A later successful save supersedes the earlier unavailable call.
              state.credentialsUnavailable = false
            }
            return true
          }
          // CH-06: the host wrote a tombstone only because the credential
          // service was unavailable. Keep the in-memory session working, but
          // tell the panel this login will not survive a restart.
          if (state.epoch === epoch && data && data.reason === 'credentials-unavailable') {
            state.credentialsUnavailable = true
          }
          return false
        }).catch(function (error) {
          // A missing host route (plugin host not restarted yet) is expected;
          // never surface it over the page the user is reading.
          void error
          return false
        })
      }

      function clearWebLogin(pageId) {
        var state = webLoginState[pageId]
        var now = Date.now()
        // Retry at most every four seconds while the page remains on the
        // sign-in route. A successful clear ends the pending state; a failed
        // one stays latched so captureWebLogin() can try again.
        if (state.clearInFlight) return Promise.resolve(false)
        if (state.clearPending && state.lastClearAttempt > 0
          && now - state.lastClearAttempt < WEB_LOGIN_RETRY_WINDOW_MS) {
          return Promise.resolve(false)
        }
        state.clearPending = true
        // Persist BEFORE the request: if the host route is missing and the
        // user quits right after this attempt, the next launch must not restore
        // the old snapshot. The flag is removed only by a successful clear or
        // a newer save.
        writeWebLoginClear(pageId, true)
        state.clearInFlight = true
        state.lastClearAttempt = now
        state.signedIn = false
        state.restored = true
        state.lastSaved = ''
        state.lastAttempt = 0
        var epoch = state.epoch
        return webLoginCall('-clear', {
          method: 'POST',
          body: JSON.stringify({ page: pageId }),
          timeoutMs: 8000,
        }).then(function (data) {
          if (state.epoch === epoch) {
            state.clearInFlight = false
            if (data && data.ok === true) {
              state.clearPending = false
              state.lastSaved = ''
              writeWebLoginClear(pageId, false)
              // The host route reports `removed`: true when a saved login was
              // actually cleared, false when there was none on this device.
              // A missing field means an older host build — treat it as removed.
              state.lastClearRemoved = data.removed !== false
            }
          }
          return !!(data && data.ok === true)
        }).catch(function (error) {
          if (state.epoch === epoch) state.clearInFlight = false
          void error
          return false
        })
      }

      function frameEntries(frame) {
        if (!frame || typeof frame.executeJavaScript !== 'function') return Promise.resolve({})
        // Only the portable login keys, not the page's caches. DeepSeek keeps
        // its session in userToken (a small JSON wrapper), the user info beside
        // it, and the per-surface device id. Copying every localStorage key
        // would put these behind a cache key and could hit the host's 64-entry
        // limit before the token is reached.
        var code = '(function(){var o={};try{var r=/(?:^userToken$|^__appKit_userInfo$|^deepseek-device-id)|token|auth|passport|session[_-]?id/i;for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(!k||!r.test(k))continue;o[k]=localStorage.getItem(k)}}catch(e){}return JSON.stringify(o)})()'
        return Promise.resolve(frame.executeJavaScript(code, false))
          .then(function (value) {
            if (value && typeof value === 'object') return value
            try {
              var parsed = JSON.parse(String(value || '{}'))
              return parsed && typeof parsed === 'object' ? parsed : {}
            } catch (error) {
              void error
              return {}
            }
          })
          .catch(function () { return {} })
      }

      function applyFrameEntries(frame, entries) {
        if (!frame || typeof frame.executeJavaScript !== 'function') return Promise.resolve(false)
        var raw = JSON.stringify(JSON.stringify(entries || {}))
        var code = '(function(raw){try{var e=JSON.parse(raw);for(var k in e){if(Object.prototype.hasOwnProperty.call(e,k)){localStorage.setItem(k,e[k])}}return true}catch(err){return false}})(' + raw + ')'
        return Promise.resolve(frame.executeJavaScript(code, false)).catch(function () { return false })
      }

      // A token is the one value a signed-in DeepSeek page always keeps; a
      // device id alone is present before login, so it cannot be the signal.
      // DeepSeek wraps values as {"value":"…","__version":"0"}; the logged-out
      // page can still leave a non-empty wrapper with value null/empty behind.
      // Length alone would mistake that for a live login and skip the restore.
      function tokenText(value) {
        if (typeof value !== 'string') return ''
        var raw = value.trim()
        if (!raw || raw === 'null' || raw === 'undefined') return ''
        try {
          var parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            var inner = parsed.value
            if (typeof inner !== 'string') return ''
            raw = inner.trim()
          }
        } catch (error) {
          void error
        }
        if (!raw || raw === 'null' || raw === 'undefined') return ''
        return raw
      }

      function hasWebToken(entries) {
        if (!entries || typeof entries !== 'object') return false
        for (var key in entries) {
          if (!Object.prototype.hasOwnProperty.call(entries, key)) continue
          if (!/token|auth|passport|session[_-]?id/i.test(key)) continue
          if (tokenText(entries[key])) return true
        }
        return false
      }

      function isSignInUrl(url) {
        if (!url) return false
        try {
          return /\/sign[-_]?in|\/login|\/sign[-_]?up|\/register/i.test(new URL(url).pathname)
        } catch (error) {
          return /\/sign[-_]?in|\/login/i.test(String(url))
        }
      }

      function frameUrl(frame) {
        try {
          return frame && typeof frame.getURL === 'function' ? frame.getURL() : ''
        } catch (error) {
          return ''
        }
      }

      function restoreWebLogin(pageId, frame) {
        var state = webLoginState[pageId]
        if (!state || state.restored || state.restoring || state.clearPending) return
        var epoch = state.epoch
        state.restoring = true
        function retryLater() {
          state.restoring = false
          if (state.epoch !== epoch || state.restored || state.clearPending) return
          if (state.restoreFailures >= 3 || state.restoreTimer) return
          state.restoreFailures += 1
          // A host route that is not registered yet, or a timeout, is
          // transient. Retry three times while this guest is alive; a panel
          // remount resets the counter and tries again.
          state.restoreTimer = setTimeout(function () {
            state.restoreTimer = 0
            if (state.epoch !== epoch) return
            restoreWebLogin(pageId, frame)
          }, WEB_LOGIN_RESTORE_RETRY_MS)
        }
        loadWebLogin(pageId).then(function (data) {
          if (state.epoch !== epoch) return
          state.restoring = false
          if (!data || data.ok !== true) {
            retryLater()
            return
          }
          state.restoreFailures = 0
          // `found:false` is a complete answer: there is no snapshot to apply.
          // Only a failed request should keep the retry path alive.
          if (data.found !== true || !data.entries) {
            state.restored = true
            return
          }
          state.restored = true
          frameEntries(frame).then(function (current) {
            if (state.epoch !== epoch) return
            // A live token already in the page is newer than the snapshot;
            // applying the old one would rotate the user back a session.
            if (hasWebToken(current)) return
            applyFrameEntries(frame, data.entries).then(function (applied) {
              if (state.epoch !== epoch) return
              if (!applied) {
                state.restored = false
                retryLater()
                return
              }
              try { frame.reload() } catch (error) { void error }
            })
          })
        }).catch(function () {
          if (state.epoch !== epoch) return
          retryLater()
        })
      }

      function captureWebLogin(pageId, frame, immediate) {
        var state = webLoginState[pageId]
        if (!state || state.saveTimer) return
        state.saveTimer = setTimeout(function () {
          state.saveTimer = 0
          if (runtime.disposed) return
          // Hidden pages cannot change their login state; skipping the poll
          // avoids a guest executeJavaScript every 1.5 seconds in the
          // background.
          if (typeof document !== 'undefined' && document.hidden === true) return
          var url = frameUrl(frame)
          frameEntries(frame).then(function (entries) {
            if (hasWebToken(entries)) {
              // Save even while the route still looks like /sign_in: that is
              // exactly where DeepSeek leaves the page after a QR login.
              state.signedIn = true
              saveWebLogin(pageId, entries)
              return
            }
            // Logging out on purpose must not be undone by the next launch.
            // Only a deliberate sign-in route without a token clears the
            // snapshot; a transient empty read on a normal page does not.
            // A failed clear stays pending, so this branch retries it until
            // the host accepts the deletion instead of leaving the old
            // snapshot to be restored on the next launch. A pending logout is
            // retried on ANY route: after a failed clear the page may already
            // have been remounted on the normal URL, and waiting for /sign_in
            // would let the old snapshot survive until the next restart.
            if (state.clearPending || (isSignInUrl(url) && state.signedIn)) {
              state.signedIn = false
              clearWebLogin(pageId)
            }
          })
        }, immediate ? 0 : WEB_LOGIN_CAPTURE_POLL_MS)
      }

      function makeWebPagePanel(pageId) {
        var def = PAGE_DEFS[pageId]
        var h = React.createElement
        return function DeepSeekWebPage() {
          var attemptState = React.useState(0)
          var attempt = attemptState[0]
          var setAttempt = attemptState[1]
          var statusState = React.useState('loading')
          var status = statusState[0]
          var setStatus = statusState[1]
          var errorState = React.useState('')
          var errorText = errorState[0]
          var setError = errorState[1]
          var leaseState = React.useState(null)
          var lease = leaseState[0]
          var setLease = leaseState[1]
          var hostRef = React.useRef(null)
          var bootRef = React.useRef({ frame: null })
          // Two-step confirm for clearing the saved login; same arm-then-confirm
          // contract the trash rows use.
          var clearArmState = React.useState(false)
          var clearArm = clearArmState[0]
          var setClearArm = clearArmState[1]
          // CH-06: mirrors the machine's credentials-unavailable flag into React
          // so the panel can warn that this login will not be kept. The capture
          // poll re-syncs it; a later successful save clears it again.
          var credUnavailState = React.useState(!!(webLoginState[pageId] && webLoginState[pageId].credentialsUnavailable))
          var credUnavail = credUnavailState[0]
          var setCredUnavail = credUnavailState[1]

          function syncCredUnavail() {
            setCredUnavail(!!(webLoginState[pageId] && webLoginState[pageId].credentialsUnavailable))
          }

          React.useEffect(function () {
            var cancelled = false
            var held = null
            var browser = desktopBrowser()
            setStatus('loading')
            setError('')
            setLease(null)
            if (!browser) {
              setStatus('unsupported')
              return function () {}
            }
            browser.acquire(def.storageKey).then(function (guest) {
              if (cancelled) {
                try { browser.release(guest.lease) } catch (error) { void error }
                return
              }
              held = guest
              setLease(guest)
            }).catch(function (err) {
              if (cancelled) return
              setError(String((err && err.message) || err || 'guest acquire failed'))
              setStatus('error')
            })
            return function () {
              cancelled = true
              if (held && typeof browser.release === 'function') {
                try { browser.release(held.lease) } catch (error) { void error }
              }
            }
          }, [attempt])

          // The webview is created by React; every guest listener belongs to
          // this effect so a remount cannot leave a handler pointing at a dead
          // frame. `dom-ready` is the first moment executeJavaScript can run.
          React.useEffect(function () {
            if (!lease) return undefined
            // A remounted webview gets a fresh guest partition. Reset the
            // page-level login latch so a failed restore is tried again here
            // instead of requiring a full DSH restart.
            resetWebLoginPage(pageId)
            var host = hostRef.current
            var frame = host && typeof host.querySelector === 'function' ? host.querySelector('webview') : null
            if (!frame) return undefined
            bootRef.current.frame = frame
            var disposed = false
            var navigated = false
            var capturePoll = null

            // The guest is attached at about:blank#<lease>; the desktop shell
            // only approves that URL. Navigate it to the real site once the
            // element exists, exactly like dsh-deepseek-chat does.
            function frameUrl() {
              try { return String(frame.getURL() || '') } catch (error) { void error; return '' }
            }
            function isBlank() {
              var url = frameUrl()
              return !url || url.indexOf('about:blank') === 0
            }
            function navigate() {
              if (navigated) return
              navigated = true
              if (!isBlank()) return
              try {
                var pending = frame.loadURL(def.url)
                if (pending && typeof pending.catch === 'function') {
                  pending.catch(function (error) {
                    if (disposed) return
                    if (error && error.code === 'ERR_ABORTED') return
                    setError(String((error && error.message) || error || 'load failed'))
                    setStatus('error')
                  })
                }
              } catch (error) {
                if (disposed) return
                setError(String((error && error.message) || error || 'load failed'))
                setStatus('error')
              }
            }

            function onReady() {
              if (disposed) return
              // about:blank emits dom-ready first; loadURL() is not legal until
              // that event, which is exactly the error the first build showed.
              if (isBlank()) { navigate(); return }
              setStatus('ready')
              try { frame.focus() } catch (error) { void error }
              restoreWebLogin(pageId, frame)
              // Restore may skip because a token is already present in this
              // process; capture it now so a later restart has a snapshot.
              captureWebLogin(pageId, frame, true)
              syncCredUnavail()
            }
            function onFinish() {
              if (disposed || isBlank()) return
              setStatus('ready')
              // A host route that failed on dom-ready can come up by the time
              // the page finishes loading. restoreWebLogin() is idempotent and
              // latches only on success.
              restoreWebLogin(pageId, frame)
              captureWebLogin(pageId, frame, true)
              syncCredUnavail()
            }
            function onFail(event) {
              if (disposed) return
              if (event && event.isMainFrame === false) return
              // -3 is ERR_ABORTED (a redirect or a superseded navigation). -2
              // is a real failure and must not leave the old screen behind a
              // stale "ready" badge.
              if (event && event.errorCode === -3) return
              setError(String((event && (event.errorDescription || event.errorCode)) || 'load failed'))
              setStatus('error')
            }
            function onNavigate() {
              if (disposed || isBlank()) return
              captureWebLogin(pageId, frame, true)
              syncCredUnavail()
            }
            function onDidNavigate() {
              if (disposed || isBlank()) return
              captureWebLogin(pageId, frame)
              syncCredUnavail()
            }

            frame.addEventListener('dom-ready', onReady)
            frame.addEventListener('did-finish-load', onFinish)
            frame.addEventListener('did-fail-load', onFail)
            frame.addEventListener('did-navigate', onDidNavigate)
            frame.addEventListener('did-navigate-in-page', onNavigate)
            // DeepSeek's QR login does not always navigate. Poll while the page
            // is alive so the token written by the login response is captured
            // even when React swaps the screen in place.
            capturePoll = setInterval(function () {
              if (disposed || isBlank()) return
              captureWebLogin(pageId, frame, true)
              syncCredUnavail()
            }, WEB_LOGIN_CAPTURE_POLL_MS)
            // about:blank can emit dom-ready before this effect runs. If getURL()
            // already answers, the event is behind us; navigate now. If it throws
            // or returns empty, wait for onReady().
            try {
              if (String(frame.getURL() || '').length > 0) navigate()
            } catch (error) { void error }
            return function () {
              disposed = true
              if (capturePoll) {
                try { clearInterval(capturePoll) } catch (error) { void error }
                capturePoll = null
              }
              try { frame.removeEventListener('dom-ready', onReady) } catch (error) { void error }
              try { frame.removeEventListener('did-finish-load', onFinish) } catch (error) { void error }
              try { frame.removeEventListener('did-fail-load', onFail) } catch (error) { void error }
              try { frame.removeEventListener('did-navigate', onDidNavigate) } catch (error) { void error }
              try { frame.removeEventListener('did-navigate-in-page', onNavigate) } catch (error) { void error }
              bootRef.current.frame = null
              // Cancel the restore retry and the pending capture before the
              // guest is released; the next lease resets the same latch.
              resetWebLoginPage(pageId)
            }
          }, [lease])

          function reload() {
            var frame = bootRef.current.frame
            if (frame && typeof frame.reload === 'function') {
              setStatus('loading')
              setError('')
              try {
                var url = ''
                try { url = String(frame.getURL() || '') } catch (error) { void error }
                var pending
                if (!url || url.indexOf('about:blank') === 0) {
                  pending = frame.loadURL(def.url)
                } else {
                  pending = frame.reload()
                }
                // loadURL returns a promise in the desktop shell; an unhandled
                // rejection here used to leave the panel on its previous
                // screen with no way to tell that the reload had failed.
                if (pending && typeof pending.catch === 'function') {
                  pending.catch(function (error) {
                    // Aligned with navigate(): a rejection that arrives after
                    // the guest was released (bootRef.frame cleared in the
                    // effect cleanup) must not repaint the panel, and an
                    // aborted navigation (redirect / superseded reload,
                    // ERR_ABORTED or code -3) is not a real failure.
                    if (bootRef.current.frame == null) return
                    if (error && (error.code === 'ERR_ABORTED' || error.code === -3)) return
                    setError(String((error && error.message) || error || 'load failed'))
                    setStatus('error')
                  })
                }
                return
              } catch (error) {
                if (bootRef.current.frame == null) return
                setError(String((error && error.message) || error || 'load failed'))
                setStatus('error')
              }
            }
            // No live frame (a failed acquire): ask the effect for a new one.
            setAttempt(function (value) { return value + 1 })
          }

          function openExternal() {
            try {
              window.open(def.url, '_blank', 'noopener,noreferrer')
            } catch (error) {
              void error
            }
          }

          // Reuse the existing clearWebLogin exit-intent path (same
            // web-login-clear route, same pending-clear state) rather than a
            // second delete routine. The arm step guards against an accidental
            // click; the promise reports success or failure honestly.
          function clearSavedLogin() {
            if (!clearArm) {
              setClearArm(true)
              try {
                window.setTimeout(function () {
                  setClearArm(function (previous) { return previous ? false : previous })
                }, 5000)
              } catch (error) {
                void error
              }
              return
            }
            setClearArm(false)
            clearWebLogin(pageId).then(function (ok) {
              if (!ok) {
                toast(t('page.clearLoginFail'), true)
                return
              }
              // `removed === false`: the route found no saved login on this
              // device (tombstone only). Report that plainly instead of the
              // "cleared" success wording. A missing `removed` field (older
              // host) keeps the existing success wording.
              if (webLoginState[pageId].lastClearRemoved === false) {
                toast(t('page.clearLoginEmpty'))
              } else {
                toast(t('page.clearLoginOk'))
              }
            })
          }

          var header = h('header', { 'data-dsbs-webpage-head': '' },
            h('div', { 'data-dsbs-webpage-title': '' },
              h('strong', null, t(def.titleKey)),
              h('span', null, t(def.subKey))
            ),
            h('div', { 'data-dsbs-webpage-actions': '' },
              h('button', { type: 'button', onClick: reload, title: t('page.reload') }, t('page.reload')),
              h('button', { type: 'button', onClick: openExternal, title: t('page.external') }, t('page.external')),
              h('button', {
                type: 'button',
                'data-dsbs-webpage-clear-login': ENTRY,
                title: clearArm ? t('page.clearLoginConfirm') : t('page.clearLogin'),
                onClick: clearSavedLogin,
              }, clearArm ? t('page.clearLoginConfirm') : t('page.clearLogin'))
            )
          )

          var statusNode = h('div', {
            'data-dsbs-webpage-status': '',
            hidden: status === 'ready',
          },
            status === 'loading' ? h('div', { 'data-dsbs-webpage-pulse': '' }) : null,
            h('strong', null,
              status === 'unsupported'
                ? t('page.desktopOnly')
                : status === 'error'
                  ? t('page.guestFailed')
                  : t('page.loading')
            ),
            status === 'error' && errorText ? h('p', null, errorText) : null,
            status === 'unsupported' ? h('p', null, t('page.loginNote')) : null,
            status === 'unsupported' || status === 'error'
              ? h('button', {
                type: 'button',
                onClick: status === 'unsupported' ? openExternal : reload,
              }, status === 'unsupported' ? t('page.external') : t('page.retry'))
              : null
          )

          var body = h('div', { 'data-dsbs-webpage-body': '', ref: hostRef },
            lease
              ? h('webview', {
                key: lease.lease,
                name: lease.lease,
                partition: lease.partition,
                src: 'about:blank#' + lease.lease,
                allowpopups: '',
                'data-sidebar-browser-frame': 'webview',
                style: { width: '100%', height: '100%', border: 0, background: 'var(--dsw-alias-bg-base,#fff)' },
              })
              : null,
            statusNode,
            // CH-06: the credential store was unavailable on the latest save.
            // The in-memory session still works for this visit, but the login
            // will not be kept across a restart — say so on the panel itself.
            credUnavail
              ? h('p', { 'data-dsbs-webpage-cred-unavailable': '' }, t('page.credentialsUnavailable'))
              : null
          )

          return h('section', { 'data-dsbs-webpage': pageId }, header, body)
        }
      }

      // ---- collapsed rail menu (0.8.3) ----------------------------------
      // The rail hides the whole bar AND the Temp button. One control stays:
      // it is a sibling of the bar (never a child), so the rail CSS cannot
      // hide the way back. Its panel only re-hosts actions the rail removed;
      // a wide column shows the original buttons and never this control.
      function railTrigger() {
        return runtime.railMenu ? runtime.railMenu.querySelector('[data-dsbs-rail-trigger]') : null
      }

      function railPanel() {
        return runtime.railMenu ? runtime.railMenu.querySelector('[data-dsbs-rail-panel]') : null
      }

      /**
       * Which slice of the panel applies right now.
       *   'rail' — below 100px the bar itself is gone, so layouts AND the temp
       *            action have no other home.
       *   'temp' — 100 to 170px: the bar still shows the layout pills, but the
       *            Temp seat is hidden by `[data-dsbs-temp-solo]`. Offering the
       *            pills again here would be a second entry for the same thing,
       *            so this band carries the temp action only.
       *   ''     — nothing was taken away; no menu at all.
       *
       * What the host actually allows (0.2.2-rc.5): an expanded column drags
       * between 264 and 420, and collapsing gives 56px on browser/macOS but 0px
       * on the Windows desktop build (`data-windows-titlebar` => collapsedWidth
       * 0), so 'rail' is a web/macOS story. 'temp' only survives in the browser
       * drawer (viewport <768) when the window itself is ~150-220px wide; it is
       * kept because that case would otherwise hide the Temp seat with no entry.
       */
      function railMenuBand() {
        if (runtime.rail === true) return 'rail'
        if (!tempShowButton) return ''
        var solo = null
        var chat = null
        try { solo = html.getAttribute('data-dsbs-temp-solo') } catch (error) { void error }
        try { chat = html.getAttribute('data-dsbs-chat-mode') } catch (error) { void error }
        // Without a seat the plugin never rendered a Temp button at any width,
        // so there is nothing to replace — the CSS flag is the whole signal.
        if (solo === 'true' && chat !== 'true') return 'temp'
        return ''
      }

      /** The first actionable row the panel is actually showing. */
      function firstRailItem() {
        var panelNode = railPanel()
        if (!panelNode) return null
        var modes = panelNode.querySelector('[data-dsbs-rail-modes]')
        if (modes && !modes.hasAttribute('hidden')) {
          var first = modes.querySelector('[data-dsbs-rail-mode]')
          if (first && typeof first.focus === 'function') return first
        }
        var temp = panelNode.querySelector('[data-dsbs-rail-temp]')
        if (temp && !temp.hasAttribute('hidden') && typeof temp.focus === 'function') return temp
        return null
      }

      function setTextIfChanged(node, text) {
        if (!node) return
        // Rewriting unchanged text on every paint would drop focus from a row
        // reached with the keyboard, so only touch what actually changed.
        if (node.textContent !== text) node.textContent = text
      }

      /** Re-apply the dictionaries; `relabel()` cannot reach outside the bar. */
      function relabelRailMenu() {
        var menu = runtime.railMenu
        if (!menu) return
        var panelNode = menu.querySelector('[data-dsbs-rail-panel]')
        if (panelNode) {
          var panelLabel = t('rail.menu.label')
          if (panelNode.getAttribute('aria-label') !== panelLabel) panelNode.setAttribute('aria-label', panelLabel)
        }
        var trigger = railTrigger()
        if (trigger) {
          var label = t('rail.menu.label')
          if (trigger.getAttribute('aria-label') !== label) trigger.setAttribute('aria-label', label)
          setTextIfChanged(trigger, label)
        }
        var head = menu.querySelector('[data-dsbs-rail-head]')
        if (head) {
          var spans = head.querySelectorAll('span')
          setTextIfChanged(spans[0], t('rail.layout'))
          setTextIfChanged(spans[1], t('rail.sessionOnly'))
        }
        var modesBox = menu.querySelector('[data-dsbs-rail-modes]')
        if (modesBox) {
          var groupLabel = t('rail.layout')
          if (modesBox.getAttribute('aria-label') !== groupLabel) modesBox.setAttribute('aria-label', groupLabel)
          var buttons = modesBox.querySelectorAll('[data-dsbs-rail-mode]')
          for (var i = 0; i < buttons.length; i++) {
            var key = buttons[i].getAttribute('data-dsbs-rail-mode')
            setTextIfChanged(buttons[i], t('mode.' + key))
            var hint = t('mode.' + key + '.hint')
            if (buttons[i].title !== hint) buttons[i].title = hint
          }
        }
        var temp = menu.querySelector('[data-dsbs-rail-temp]')
        if (temp) {
          // Its label is owned by paintRailMenu (it has to switch between the
          // idle and the in-flight wording); only the hint belongs here.
          var tempHint = t('temp.hint')
          if (temp.title !== tempHint) temp.title = tempHint
        }
        setTextIfChanged(menu.querySelector('[data-dsbs-rail-foot]'), t('rail.hint'))
      }

      function closeRailMenu(returnFocus) {
        if (!runtime.railOpen) return
        runtime.railOpen = false
        if (returnFocus) {
          var trigger = railTrigger()
          if (trigger && typeof trigger.focus === 'function') trigger.focus()
        }
        scheduleSync()
      }

      function positionRailPanel() {
        var panelNode = railPanel()
        var trigger = railTrigger()
        if (!panelNode || !trigger) return
        try {
          var rect = trigger.getBoundingClientRect()
          if (!rect || !isFinite(rect.right) || !isFinite(rect.top)) return
          var vw = (window && window.innerWidth) || 1280
          var vh = (window && window.innerHeight) || 800
          var left = Math.round(rect.right + 6)
          var top = Math.round(rect.top - 4)
          var panelWidth = 236
          if (left + panelWidth > vw) left = Math.max(8, Math.round(vw - panelWidth))
          if (top + 190 > vh) top = Math.max(8, Math.round(vh - 190))
          if (top < 8) top = 8
          panelNode.style.left = left + 'px'
          panelNode.style.top = top + 'px'
        } catch (error) {
          void error
        }
      }

      function paintRailMenu(state, pluginTab) {
        var menu = runtime.railMenu
        if (!menu) return
        relabelRailMenu()
        var band = pluginTab === true ? '' : railMenuBand()
        var visible = band !== ''
        if (visible) menu.removeAttribute('hidden')
        else menu.setAttribute('hidden', '')
        // The menu is not inside [data-dsbs-bar], so the rail CSS alone cannot
        // decide its display in the 100-170px band; publish the verdict.
        setFlag(html, 'data-dsbs-railmenu', visible)
        if (!visible && runtime.railOpen) runtime.railOpen = false

        var layoutBand = band === 'rail'
        var head = menu.querySelector('[data-dsbs-rail-head]')
        if (head) {
          if (layoutBand) head.removeAttribute('hidden')
          else head.setAttribute('hidden', '')
        }
        var modesBox = menu.querySelector('[data-dsbs-rail-modes]')
        if (modesBox) {
          if (layoutBand) modesBox.removeAttribute('hidden')
          else modesBox.setAttribute('hidden', '')
        }
        var modes = menu.querySelectorAll('[data-dsbs-rail-mode]')
        for (var i = 0; i < modes.length; i++) {
          var checked = modes[i].getAttribute('data-dsbs-rail-mode') === state.mode
          modes[i].setAttribute('aria-checked', checked ? 'true' : 'false')
          // 0.8.11 — a radiogroup is one Tab stop, not three. Keep the
          // selected radio in the Tab order; arrows reach the other two.
          modes[i].setAttribute('tabindex', checked ? '0' : '-1')
        }
        var temp = menu.querySelector('[data-dsbs-rail-temp]')
        // TEMP_OFF hides the native Temp button too; do not resurrect it here.
        if (temp) {
          if (tempShowButton) temp.removeAttribute('hidden')
          else temp.setAttribute('hidden', '')
          // The wide Temp button disables itself and says so while a create is
          // in flight; this row has to do the same or the second click reads as
          // a no-op (the guard inside createTempSession swallows it silently).
          if (tempBusy) {
            temp.setAttribute('disabled', '')
            setTextIfChanged(temp, t('temp.creating'))
          } else {
            temp.removeAttribute('disabled')
            setTextIfChanged(temp, t('rail.newTemp'))
          }
        }
        var trigger = railTrigger()
        if (trigger) {
          trigger.setAttribute('aria-expanded', visible && runtime.railOpen ? 'true' : 'false')
          var hint = layoutBand ? t('rail.menu.hint') : t('rail.menu.hintTemp')
          if (trigger.title !== hint) trigger.title = hint
        }
        var panelNode = railPanel()
        if (panelNode) {
          if (visible && runtime.railOpen) {
            panelNode.removeAttribute('hidden')
            positionRailPanel()
          } else {
            panelNode.setAttribute('hidden', '')
          }
        }
      }

      function buildRailMenu() {
        var menu = document.createElement('div')
        menu.setAttribute('data-dsbs-rail-menu', '')
        menu.setAttribute('hidden', '')

        var trigger = document.createElement('button')
        trigger.type = 'button'
        trigger.setAttribute('data-dsbs-rail-trigger', '')
        trigger.setAttribute('data-dsbs-btn', 'rail-menu')
        trigger.setAttribute('data-dsbs-label', 'rail.menu.label')
        trigger.setAttribute('data-dsbs-hint', 'rail.menu.hint')
        trigger.setAttribute('aria-label', t('rail.menu.label'))
        trigger.setAttribute('aria-haspopup', 'dialog')
        trigger.setAttribute('aria-expanded', 'false')
        trigger.textContent = t('rail.menu.label')
        trigger.title = t('rail.menu.hint')
        trigger.addEventListener('click', function (event) {
          if (event) {
            event.preventDefault()
            event.stopPropagation()
          }
          runtime.railOpen = !runtime.railOpen
          if (runtime.railOpen) {
            // paint() is the only thing that unhides the panel, and it runs on
            // the next tick: a row inside a hidden panel cannot take focus, so
            // reveal and place the panel first or the focus() below is a no-op.
            var opening = railPanel()
            if (opening) {
              opening.removeAttribute('hidden')
              positionRailPanel()
            }
            var first = firstRailItem()
            if (first) first.focus()
          } else if (typeof trigger.focus === 'function') {
            // Focus went into the panel when it opened. Without this the button
            // that hides the panel is also the one that strands focus: the
            // browser drops it on <body> and the next Tab restarts at the top.
            trigger.focus()
          }
          scheduleSync()
        })
        menu.appendChild(trigger)

        var panelNode = document.createElement('div')
        panelNode.setAttribute('data-dsbs-rail-panel', '')
        // A role=menu would promise arrow-key navigation we do not implement,
        // and menuitemradio requires aria-checked, not aria-pressed. Dialog plus
        // a radio group is what this panel actually behaves like.
        panelNode.setAttribute('role', 'dialog')
        panelNode.setAttribute('aria-label', t('rail.menu.label'))
        panelNode.setAttribute('hidden', '')

        var head = document.createElement('div')
        head.setAttribute('data-dsbs-rail-head', '')
        var headLabel = document.createElement('span')
        headLabel.textContent = t('rail.layout')
        var sessionOnly = document.createElement('span')
        sessionOnly.textContent = t('rail.sessionOnly')
        head.appendChild(headLabel)
        head.appendChild(sessionOnly)
        panelNode.appendChild(head)

        var modes = document.createElement('div')
        modes.setAttribute('data-dsbs-rail-modes', '')
        modes.setAttribute('role', 'radiogroup')
        modes.setAttribute('aria-label', t('rail.layout'))
        for (var i = 0; i < MODES.length; i++) {
          var mode = MODES[i]
          var modeButton = document.createElement('button')
          modeButton.type = 'button'
          modeButton.setAttribute('role', 'radio')
          modeButton.setAttribute('data-dsbs-rail-mode', mode)
          modeButton.setAttribute('aria-checked', 'false')
          modeButton.textContent = t('mode.' + mode)
          modeButton.title = t('mode.' + mode + '.hint')
          modeButton.addEventListener('click', function (event) {
            if (event) {
              event.preventDefault()
              event.stopPropagation()
            }
            var value = this.getAttribute('data-dsbs-rail-mode')
            closeRailMenu(true)
            setMode(value)
          })
          modes.appendChild(modeButton)
        }
        // 0.8.11 — role=radiogroup without arrow keys is a promise the panel
        // cannot keep. ARIA radio groups are one Tab stop: arrows move focus
        // AND select, Home/End jump to the ends. The buttons' own click still
        // closes the panel, so the keyboard path applies the layout and closes
        // through the same code path a pointer click does.
        modes.addEventListener('keydown', function (event) {
          if (!event || !event.key) return
          var list = modes.querySelectorAll('[data-dsbs-rail-mode]')
          if (!list.length) return
          var at = -1
          for (var i = 0; i < list.length; i++) {
            if (list[i] === event.target || (event.target && list[i].contains && list[i].contains(event.target))) { at = i; break }
          }
          if (at < 0) return
          var next = -1
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (at + 1) % list.length
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (at - 1 + list.length) % list.length
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = list.length - 1
          else return
          try { event.preventDefault() } catch (error) { void error }
          if (typeof list[next].focus === 'function') list[next].focus()
          list[next].click()
        })
        panelNode.appendChild(modes)

        var temp = document.createElement('button')
        temp.type = 'button'
        temp.setAttribute('data-dsbs-rail-temp', '')
        temp.textContent = t('rail.newTemp')
        temp.title = t('temp.hint')
        temp.addEventListener('click', function (event) {
          if (event) {
            event.preventDefault()
            event.stopPropagation()
          }
          // Single path: the wide Temp button calls the same function, so the
          // rail panel is a relocation of that action, not a second feature.
          // A create already in flight owns the row; closing the panel here
          // would look like the click did something.
          if (tempBusy) return
          closeRailMenu(true)
          createTempSession()
        })
        panelNode.appendChild(temp)

        var foot = document.createElement('div')
        foot.setAttribute('data-dsbs-rail-foot', '')
        foot.textContent = t('rail.hint')
        panelNode.appendChild(foot)

        menu.appendChild(panelNode)
        return menu
      }

      function ensureRailMenu(fx) {
        var host = fx.headerHost || fx.root
        var menu = runtime.railMenu
        var bar = runtime.bar && runtime.bar.parentNode === host ? runtime.bar : null
        var strip = runtime.tabStrip && runtime.tabStrip.parentNode === host ? runtime.tabStrip : null
        // Sit AFTER the bar and the tab strip, never before them: both of
        // those injectors own the first positions and will move a node that
        // jumps ahead of them, which spins the observer feedback loop.
        var before = strip ? strip.nextSibling
          : (bar ? bar.nextSibling
            : ((fx.scrollArea && fx.scrollArea.parentNode === host) ? fx.scrollArea : host.firstChild))
        if (menu && menu.parentNode !== host) {
          try {
            if (menu.parentNode) menu.parentNode.removeChild(menu)
          } catch (error) {
            void error
          }
          menu = null
        }
        if (!menu) {
          menu = buildRailMenu()
          runtime.railMenu = menu
        }
        if (before === menu) return menu
        if (menu.parentNode === host) {
          // With a strip present the only steady place is directly AFTER it;
          // sitting between the bar and the strip makes ensureTabStrip move
          // the strip and the two injectors start fighting over the order.
          if (strip) {
            if (menu.previousSibling === strip) return menu
          } else if (before && before.parentNode === host && isBefore(menu, before)) {
            return menu
          } else if (!before && menu === host.lastChild) {
            return menu
          }
        }
        host.insertBefore(menu, before || null)
        return menu
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
          // 0.7.3: the body only acted when this tab happened to be the active
          // one, so a background consumer's close() did nothing at all and the
          // "dead page" stayed clickable. unregisterTab() also clears the active
          // id when it points here.
          close: function () {
            unregisterTab(record.id, record)
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

      function unregisterTab(id, expectedRecord) {
        var record = findTab(id)
        if (!record) return false
        // A stale disposer or tabContext.close() from an earlier registration
        // must not delete a newer record that owns the same id. Re-registering
        // an id is the normal hot-reload path, so the caller captures the
        // record it was created for and ownership is checked here.
        if (expectedRecord && record !== expectedRecord) return false
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

      var nativeTabWarned = false
      function registerTab(descriptor) {
        // 0.7.4 — on rc.2+ the host groups third-party entries natively via
        // `sidebar.panellist` / its "More" menu. Our own strip would be a second,
        // redundant entry point. Keep the API for compatibility but hide the
        // strip and tell the consumer once how to migrate.
        if (nativeTabsAvailable && !nativeTabWarned) {
          nativeTabWarned = true
          try {
            console.warn('[dsh-sidebar-suite] This DSH groups plugin entries natively (sidebar.panellist). '
              + 'registerTab() is kept for compatibility but its strip is hidden; register a '
              + 'sidebar.panellist entry instead.')
          } catch (error) { void error }
        }
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
          unregisterTab(id, record)
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
        // The strip shares the control bar's flex header host, staying out of
        // the grid for exactly the same reason.
        var host = fx.headerHost || fx.root
        var bar = runtime.bar
        // rc.2: all injected header boxes sit before the scrolling viewport.
        // Older flex roots have no scrollArea, so follow the bar directly.
        var anchor = (fx.scrollArea && fx.scrollArea.parentNode === host)
          ? fx.scrollArea
          : ((bar && bar.parentNode === host) ? bar.nextSibling : null)
        var strip = runtime.tabStrip
        if (strip && strip.parentNode !== host) {
          try {
            if (strip.parentNode) strip.parentNode.removeChild(strip)
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
          if (typeof strip.addEventListener === 'function') strip.addEventListener('keydown', onTabStripKeydown)
          runtime.tabStrip = strip
        }
        // Steady state: in this host, after the bar, before the scrolling
        // viewport. Order checks only -- exact adjacency spins the observer.
        var inPlace = strip.parentNode === host
          && (!bar || bar.parentNode !== host || isBefore(bar, strip))
          && (!anchor || anchor.parentNode !== host || isBefore(strip, anchor))
        if (inPlace || anchor === strip) return strip
        if (anchor && anchor.parentNode === host) host.insertBefore(strip, anchor)
        else host.appendChild(strip)
        return strip
      }

      function buildTabButton(entry, selected) {
        var button = document.createElement('button')
        button.setAttribute('type', 'button')
        button.setAttribute('data-dsbs-tabid', entry.id)
        button.setAttribute('role', 'tab')
        button.setAttribute('aria-selected', selected ? 'true' : 'false')
        // 0.7.3: `tabs.own` was defined since 0.3.0 but never rendered. A tab
        // with an owner now says who provides the page on hover, so landing on
        // an unfamiliar panel is not a guess.
        var tabOwner = !entry.builtin && entry.owner ? String(entry.owner) : ''
        button.setAttribute('title', tabOwner
          ? entry.title + ' · ' + String(t('tabs.own')).replace('{name}', tabOwner)
          : entry.title)
        if (selected) button.setAttribute('data-dsbs-selected', 'true')
        if (entry.builtin) button.setAttribute('data-dsbs-builtin', entry.id)

        if (typeof entry.icon === 'string' && entry.icon) {
          var glyph = document.createElement('span')
          glyph.setAttribute('data-dsbs-tabicon', '')
          glyph.setAttribute('aria-hidden', 'true')
          button.setAttribute('data-dsbs-hasicon', '')
          if (entry.icon.charAt(0) === '<') {
            // Trust boundary (CE-10): this is the only innerHTML /
            // insertAdjacentHTML / outerHTML write in the whole client bundle.
            // entry.icon is an inline SVG mark registered by a co-installed
            // plugin; plugins already run arbitrary code in this page, so the
            // markup grants no new privilege. The icon still gets its own
            // element so the tab label stays a plain text node. Do not widen
            // this sink to titles, descriptions or any other free-text field;
            // tests/test_084 pins the sink count and this boundary comment.
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
            var tookOver = runtime.activeTab !== null
            runtime.activeTab = null
            writeActiveTab(null)
            setField('tab', entry.id)
            // A click here takes the column away from a consumer tab exactly
            // like clicking another tab does, so subscribers hear about it the
            // same way. Without this a consumer that trusts `subscribe` would
            // keep believing it is still on screen.
            if (tookOver) notifyTabs('active')
          } else {
            activateTab(entry.id)
          }
        })
        return button
      }

      // ---- tab strip keyboard (0.8.10) ---------------------------------
      // `role="tablist"` without a roving tabindex is a promise the keyboard
      // cannot keep: every tab became its own Tab stop, and the arrow keys —
      // the way every tab strip is driven — did nothing. Follow the APG tabs
      // pattern with MANUAL activation: arrows move focus, Enter/Space (the
      // button's own click) opens the page. Automatic activation would be wrong
      // here: each tab mounts a consumer's React page, so arrowing past three
      // tabs must not mount three panels on the way.
      function tabButtons() {
        var list = []
        var strip = runtime.tabStrip
        if (!strip || !strip.children) return list
        for (var i = 0; i < strip.children.length; i++) {
          var child = strip.children[i]
          if (!child || typeof child.getAttribute !== 'function') continue
          if (child.getAttribute('role') === 'tab') list.push(child)
        }
        return list
      }

      /** Exactly one tab is in the Tab order; the rest are reachable by arrow. */
      function setRovingTabIndex(target) {
        var list = tabButtons()
        if (!list.length) return
        var chosen = target || null
        if (!chosen) {
          for (var i = 0; i < list.length; i++) {
            if (list[i].getAttribute('aria-selected') === 'true') { chosen = list[i]; break }
          }
        }
        if (!chosen) chosen = list[0]
        for (var j = 0; j < list.length; j++) {
          var index = list[j] === chosen ? '0' : '-1'
          if (list[j].getAttribute('tabindex') !== index) list[j].setAttribute('tabindex', index)
        }
      }

      function onTabStripKeydown(event) {
        if (!event || !event.key) return
        var list = tabButtons()
        if (!list.length) return
        var at = -1
        for (var i = 0; i < list.length; i++) {
          if (list[i] === event.target) { at = i; break }
        }
        if (at < 0) return
        var next = -1
        var key = event.key
        if (key === 'ArrowRight') next = (at + 1) % list.length
        else if (key === 'ArrowLeft') next = (at - 1 + list.length) % list.length
        else if (key === 'Home') next = 0
        else if (key === 'End') next = list.length - 1
        else return
        // The arrow keys must not scroll the sidebar list underneath.
        try { event.preventDefault() } catch (error) { void error }
        setRovingTabIndex(list[next])
        try { if (typeof list[next].focus === 'function') list[next].focus() } catch (error) { void error }
      }

      function renderTabStrip() {
        var strip = runtime.tabStrip
        if (!strip) return
        var entries = tabEntries()
        var hasPlugin = false
        for (var p = 0; p < entries.length; p++) {
          if (!entries[p].builtin) hasPlugin = true
        }
        // 0.7.4 — rc.2+ hosts provide their own "More" grouping for plugin
        // entries. Our strip is a second, semantically identical entry point,
        // so hide it on those hosts and let the host own the navigation.
        // `registerTab` stays public for compatibility; see its migration note.
        // 0.8.11 — but a consumer can still call the public activateTab() on
        // such a host. paint() hides the bar and the rail for a plugin page,
        // and if the strip is hidden too, nothing is left to click back to the
        // session list. Keep exactly that strip as the way back while a plugin
        // page owns the column; with no active page the host's own grouping
        // stays in charge and our strip stays hidden (no duplicate entry).
        var activePlugin = runtime.activeTab && findTab(runtime.activeTab) ? runtime.activeTab : null
        if (!hasPlugin || (nativeTabsAvailable && !activePlugin)) {
          strip.setAttribute('hidden', '')
          runtime.tabSignature = ''
          return
        }
        strip.removeAttribute('hidden')

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
        // Rebuilt from scratch, so the roving tabindex has to be re-seeded on
        // the selected tab; without it every button would land in the Tab order
        // again after any layout change.
        setRovingTabIndex(null)
      }

      function placeTabPanel(panel, fx) {
        if (panel.parentNode === fx.root) return
        var anchor = (fx.nav && fx.nav.parentNode === fx.root) ? fx.nav
          : ((fx.regionArea && fx.regionArea.parentNode === fx.root) ? fx.regionArea : null)
        if (anchor) {
          fx.root.insertBefore(panel, anchor)
          return
        }
        // With the root pinned to the outer scroll area the host panels are no
        // longer direct children, so the old `appendChild` fallback put the
        // plugin page after everything. Keep it directly under the header.
        var after = (runtime.tabStrip && runtime.tabStrip.parentNode === fx.root)
          ? runtime.tabStrip.nextSibling
          : ((runtime.bar && runtime.bar.parentNode === fx.root) ? runtime.bar.nextSibling : null)
        fx.root.insertBefore(panel, after)
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
        relabelPageBar()
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

      // 1.1.4 — one synthetic resize per frame, and only when something that
      // measures itself from geometry is actually on screen. It used to fire
      // unconditionally on every group that became visible, i.e. a fake
      // `resize` for the whole app: every other plugin listening to it
      // re-measured (and the host's own layout recalced) even when no overlay
      // was open. A plain tab flip has nothing to re-measure.
      function requestOverlayRemeasure() {
        if (!runtime.popOpen && !runtime.railOpen) return
        if (overlayRemeasureRaf) return
        var raf = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : function (fn) { return setTimeout(fn, 16) }
        overlayRemeasureRaf = raf(function () {
          overlayRemeasureRaf = 0
          if (runtime.disposed) return
          if (!runtime.popOpen && !runtime.railOpen) return
          try {
            window.dispatchEvent(new Event('resize'))
          } catch (error) {
            void error
          }
        })
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
          // 1.1.4: gated + frame-coalesced -- see requestOverlayRemeasure().
          requestOverlayRemeasure()
          // A group that just became visible may hold rows that were never
          // expanded; the sweep is deferred so the flip itself stays cheap.
          scheduleExpandPass()
        }
      }

      function positionPop(fx) {
        if (!fx || !fx.root || !runtime.bar) return
        // Only the overlay is positioned; skip the two rect reads otherwise so
        // the heartbeat stays cheap.
        if (config.values.mode !== 'c' || !runtime.popOpen) return
        try {
          // The overlay is position:absolute relative to scrollRegion (the
          // flex header host), not to scrollArea. With the bar now above the
          // grid, measuring against the grid would yield a negative offset
          // and clamp the popover on top of the control bar.
          var anchorRect = (fx.headerHost || fx.root).getBoundingClientRect()
          var barRect = runtime.bar.getBoundingClientRect()
          var top = Math.round(barRect.bottom - anchorRect.top + 4)
          if (!isFinite(top) || top < 0) top = 0
          fx.root.style.setProperty('--dsbs-pop-top', top + 'px')
        } catch (error) {
          void error
        }
      }

      // ---- which group owns the column: one rule, two callers -----------
      // A registered tab owning the column outranks every layout rule: the two
      // groups step aside and the tab's own container takes the space. Kept in
      // a single place because paint() and the tab fast path must never
      // disagree about it.
      function groupVisibility(state, hasExt, pluginTab) {
        if (pluginTab) return { ext: true, ws: true }
        if (state.mode === 'b') {
          // No panels: keep the workspaces visible rather than the empty half.
          return { ext: state.tab !== 'ext', ws: hasExt && state.tab === 'ext' }
        }
        if (state.mode === 'c') return { ext: !runtime.popOpen, ws: false }
        // n -- official default. No CSS rule hides either group, and no runtime
        // state may hide one either: both stay exactly as DSH drew them. A
        // registered plugin tab still takes the column (explicit consumer
        // action, not a layout override).
        return { ext: false, ws: false }
      }

      // ---- the ⇄ fast path (1.1.4) ---------------------------------------
      // A tab flip changes exactly three things: the flag every rule keys on,
      // which group is hidden, and which strip entry is selected. Everything
      // else paint() does -- mounting the bar and the page row, two whole-
      // document scans for stray nodes, temp-row badges, the expand-all pass --
      // is unrelated to the tab. Running all of it twice per click (once
      // optimistically, once when the host echoes the write) is what made
      // rapid clicking feel like a growing queue, so the flip gets this narrow
      // path instead. Returns false when the host sidebar cannot be resolved;
      // the caller then falls back to the full sync, which degrades properly.
      function applyTabView() {
        if (runtime.disposed) return false
        var state = config.values
        html.setAttribute('data-dsbs-tab', state.tab)
        var fx = hostResolve()
        if (!fx) return false
        runtime.root = fx.root
        runtime.nav = fx.nav
        runtime.regionArea = fx.regionArea
        if (fx.nav && !fx.nav.hasAttribute('data-dsbs-ext')) fx.nav.setAttribute('data-dsbs-ext', '')
        var pluginTab = runtime.activeTab && findTab(runtime.activeTab) ? runtime.activeTab : null
        var groups = groupVisibility(state, !!fx.nav, pluginTab)
        setGroupHidden(fx.nav, 'ext', groups.ext)
        setGroupHidden(fx.regionArea, 'ws', groups.ws)
        renderTabStrip()
        // The label states what the click will do, so it has to follow the flip
        // even when no full paint runs.
        var swap = barButton('tab-swap')
        if (swap) {
          swap.setAttribute('data-dsbs-label', state.tab === 'ext' ? 'tab.to.ws' : 'tab.to.ext')
          swap.setAttribute('data-dsbs-hint', state.tab === 'ext' ? 'tab.to.ws.hint' : 'tab.to.ext.hint')
        }
        return true
      }

      function paint() {
        if (runtime.disposed) return
        var state = config.values
        html.setAttribute('data-dsbs-mode', state.mode)
        html.setAttribute('data-dsbs-tab', state.tab)
        // 0.8.4: `data-dsbs-quick` used to be written here but no CSS or JS has
        // ever read it — the quick-switch button is toggled through setVisible().
        setFlag(html, 'data-dsbs-pop', runtime.popOpen && state.mode === 'c')
        setFlag(html, 'data-dsbs-rail', runtime.rail)

        var fx = hostResolve()
        runtime.root = fx ? fx.root : null
        runtime.nav = fx ? fx.nav : null
        runtime.regionArea = fx ? fx.regionArea : null
        if (!fx) {
          // 0.7.3: `data-dsbs-ptab` hides the host groups through !important CSS.
          // Bailing out with it still set made the *next* root render with both
          // groups hidden until the following paint — a blank sidebar for up to
          // one heartbeat after a chat/harness swap.
          if (runtime.railMenu) runtime.railMenu.setAttribute('hidden', '')
          // 1.0.0 M1: an unknown host may have renamed/removed our anchors. No
          // bar, no observers, no null-property reads — degrade once and let
          // the host show its official default sidebar unchanged. Keep this
          // BEFORE the flag/return pair: test_029 pins that exact source shape.
          degrade('sidebar-unresolved', 'layout')
          setFlag(html, 'data-dsbs-ptab', false)
          return
        }

        if (fx.nav && !fx.nav.hasAttribute('data-dsbs-ext')) fx.nav.setAttribute('data-dsbs-ext', '')
        ensureBar(fx)
        // Header order matters: the strip and rail menu claim their slots first,
        // then the page row goes to the very end of the header stack. Injecting
        // it before them put it between the bar and the strip, where the other
        // injectors had to keep moving nodes around it.
        ensureTabStrip(fx)
        ensureRailMenu(fx)
        ensurePageBar(fx)
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
        // A hot client reload can leave rows from an earlier run behind; they
        // look like duplicates and their click handlers point at a dead
        // runtime. Keep exactly the row this run owns.
        var strayPages = document.querySelectorAll('[data-dsbs-pages]')
        for (var sp = 0; sp < strayPages.length; sp++) {
          if (strayPages[sp] === runtime.pageBar) continue
          if (strayPages[sp].parentNode) strayPages[sp].parentNode.removeChild(strayPages[sp])
        }

        // With no panels to show, the buttons that act on that group are
        // pointless, and hiding the workspaces would leave an empty column.
        var hasExt = !!fx.nav
        var showTabs = state.mode === 'b'
        var showPop = state.mode === 'c'
        setVisible('tab-swap', showTabs && hasExt)
        setVisible('pop', showPop && hasExt)
        setVisible('quick', state.showQuickSwitch === true)

        // The label states what the click will do, so "展开扩展" and "收起扩展"
        // never coexist with a stale state.
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
            var part = parts.context[c]
            if (part.hasAttribute('hidden')) continue
            // 0.7.3: the narrow column hides Cycle through CSS (display:none),
            // not through the attribute, so counting it here left the divider
            // stranded at the right edge with nothing after it.
            if (runtime.narrow === true && part.getAttribute('data-dsbs-btn') === 'quick') continue
            visibleContext++
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
        if (popButton) {
          popButton.setAttribute('aria-expanded', runtime.popOpen && showPop ? 'true' : 'false')
        }
        if (runtime.bar) {
          // 0.8.4: the whole-bar tooltip used to repeat the aria-label on every
          // hover — zero information over an already-labelled toolbar. Keep it
          // only for the degraded local-fallback case, where the "stored on
          // this device" notice is the one thing hovering cannot otherwise see.
          var localNotice = config.local ? t('bar.local') : ''
          if (runtime.bar.title !== localNotice) runtime.bar.title = localNotice
          runtime.bar.setAttribute('aria-label', t('bar.label'))
        }

        // A registered tab owning the column outranks every layout rule: the
        // two groups step aside and the tab's own container takes the space.
        // groupVisibility() owns that rule now, because the ⇄ fast path needs
        // the same answer without running the rest of this paint.
        var pluginTab = null
        if (runtime.activeTab) {
          var activeRecord = findTab(runtime.activeTab)
          // 0.7.3: a tab marked `hidden` is excluded from the strip, so it can
          // neither be seen nor clicked away from. Letting it own the column
          // produced a real dead end: bar hidden, strip hidden (no visible
          // plugin tab), both groups hidden by CSS — nothing left to click. A
          // consumer that re-registers with hidden:true while the user is on
          // that page (loading, disconnected) would otherwise lock the sidebar,
          // and the id is persisted so it repeated on every launch.
          if (activeRecord && activeRecord.hidden !== true) {
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
        paintRailMenu(state, !!pluginTab)
        // 0.7.3: a consumer tab owns the whole column, so every layout control
        // is a dead button while it is open -- the mode pills would flip a
        // state nothing renders, and the actions would act on hidden groups.
        // Hide the bar outright rather than gutting it piece by piece: an
        // emptied flex row still takes its height and reads as a broken
        // toolbar. The tab strip stays: it is the only way back out.
        if (runtime.bar) {
          if (pluginTab) runtime.bar.setAttribute('hidden', '')
          else runtime.bar.removeAttribute('hidden')
        }
        var groups = groupVisibility(state, hasExt, pluginTab)
        setGroupHidden(fx.nav, 'ext', groups.ext)
        setGroupHidden(fx.regionArea, 'ws', groups.ws)
        syncTabPanels(fx, pluginTab)
        paintPageBar(state, pluginTab)
        // The strip is the only affordance that survives a hidden bar, so it
        // is repainted on every sync rather than only when its content changed.
        if (runtime.tabStrip && pluginTab) {
          var selectedTab = runtime.tabStrip.querySelector('[data-dsbs-tabid="' + pluginTab + '"]')
          if (selectedTab) selectedTab.setAttribute('aria-selected', 'true')
        }

        observeRoot(fx.root)
        positionPop(fx)
        // 1.1.4 — remember which layout fields this paint actually applied. A
        // later config push that agrees with them can change nothing but the
        // tab, so the subscription takes the narrow path instead of repainting.
        runtime.painted = { mode: state.mode, showQuickSwitch: state.showQuickSwitch }

        // 1.1.5 — favorites follow the same host rebuild as the rows. The
        // group is idempotently reinserted before the registered slot; the
        // generated star rules are already in their own style element.
        // A favorite-only failure must not take the rest of the sidebar paint
        // down with it.
        try { paintFavoriteGroup() } catch (error) { void error; degrade('favorite-paint-failed', 'favorites') }
        try { watchArchiveFavorites() } catch (error) { void error }
        try { refreshArchiveFavorites(false) } catch (error) { void error }
      }

      // ---- state changes ------------------------------------------------

      // ---- the ⇄ action: view first, profile second (1.1.4) --------------
      // It used to be a straight setField('tab') call, i.e. one profile write
      // (a full YAML rewrite plus a revision bump) and one complete paint per
      // click. Rapid clicking queued writes behind each other while the column
      // had already flipped, so the faster the button was clicked the further
      // the visible state ran ahead of the persisted one. Now the flip is
      // applied in the click frame and the write collapses to at most one per
      // TAB_WRITE_WINDOW_MS, always followed by a trailing write that carries
      // the newest value — the profile can never end up on a stale tab.
      var TAB_WRITE_WINDOW_MS = 300
      var tabWriteAt = 0
      var tabWriteTimer = null
      var tabWriteQueued = null

      function commitTab(value) {
        tabWriteAt = Date.now()
        setField('tab', value)
      }

      function toggleTab() {
        var next = config.values.tab === 'ext' ? 'ws' : 'ext'
        // The same value setField() would adopt, applied one microtask earlier
        // so the column flips before the event loop turns.
        config.values = assign({}, config.values, { tab: next })
        applyTabView()
        queueTabWrite(next)
      }

      function queueTabWrite(value) {
        // Without a host controller the write is a localStorage assignment:
        // there is nothing to protect and coalescing would only delay it.
        if (!config.controller) { commitTab(value); return }
        var now = Date.now()
        if (tabWriteTimer === null && now - tabWriteAt >= TAB_WRITE_WINDOW_MS) {
          commitTab(value)
          return
        }
        tabWriteQueued = value
        if (tabWriteTimer !== null) return
        var wait = TAB_WRITE_WINDOW_MS - (now - tabWriteAt)
        if (!(wait > 0)) wait = 0
        tabWriteTimer = setTimeout(function () {
          tabWriteTimer = null
          var queued = tabWriteQueued
          tabWriteQueued = null
          if (runtime.disposed || queued === null) return
          commitTab(queued)
        }, wait)
      }

      function setMode(mode) {
        if (MODES.indexOf(mode) < 0) return
        if (mode !== 'c' && runtime.popOpen) runtime.popOpen = false
        runtime.sessionMode = mode
        setField('mode', mode)
      }

      // 0.8.11 — two writes to one field can overlap: a refused retry of an
      // older click resolves after a newer click already landed. Rolling that
      // older request back would restore its stale `previous` over the newer,
      // accepted value. A write sequence makes the rollback conditional on
      // still being the newest write.
      var writeSeq = 0
      function setField(field, value) {
        var patch = {}
        patch[field] = value
        // 1.1.5 — tab is painted before the write is queued, so the value in
        // config.values is already the optimistic one. Roll back to the last
        // accepted tab instead, otherwise a refused write restores the very
        // value it failed to persist.
        var previous = field === 'tab' ? tabConfirmed : config.values[field]
        var rollbackPatch = {}
        rollbackPatch[field] = previous
        var seq = ++writeSeq
        config.values = assign({}, config.values, patch)
        function confirmWrite() {
          if (field !== 'tab') return
          if (seq < tabConfirmedSeq) return
          tabConfirmedSeq = seq
          tabConfirmed = value
        }

        // `mode` is the startup default: keep it out of both the config form
        // and localStorage, so an in-session pick lives only until reload.
        // The other fields (tab / folds) still persist as before.
        if (field !== 'mode') {
          if (config.controller && typeof config.controller.mutate === 'function') {
            var ops = [{ op: 'set', path: [field], value: value }]
            var failed = false
            var attempts = 0
            function fail(error) {
              if (failed) return
              failed = true
              // 0.7.4: the UI must never show the new value while mutate()
              // really failed. Restore memory and say so — with the control's
              // name, not a bare config key like "tab".
              // 0.8.11: only roll back if this is still the newest write. A
              // later click that already succeeded owns the current value;
              // overwriting it with this request's stale `previous` would put
              // the UI back on a tab nobody selected.
              if (seq === writeSeq) config.values = assign({}, config.values, rollbackPatch)
              toast(t('policy.failed') + fieldLabel(field) + ' · ' + t('policy.conflictHint'), true)
              scheduleSync()
            }
            function retryOrFail() {
              // 0.8.6: a `false` return already made the host-side controller
              // re-read (its recover()); one in-place retry then lands on the
              // fresh revision. Only a SECOND refusal toasts — the first one
              // used to surface as "保存失败: tab" on the real host whenever
              // another write had bumped the revision between read and write.
              if (attempts >= 2) { fail(); return }
              setTimeout(function () {
                if (!runtime.disposed) attempt()
              }, 400)
            }
            function attempt() {
              attempts += 1
              if (runtime.disposed) return
              var result
              try {
                // No expectedRevision: the host controller resolves the
                // revision inside its serialized write queue (its own
                // setField() contract), so a write queued behind another one
                // can no longer fail with a revision this click had read.
                result = config.controller.mutate(ops)
              } catch (error) {
                fail(error)
                return
              }
              if (result === false) { retryOrFail(); return }
              if (result && typeof result.then === 'function') {
                result.then(function (outcome) {
                  if (outcome === false || (outcome && outcome.ok === false)) retryOrFail()
                  else confirmWrite()
                }, fail)
              } else {
                confirmWrite()
              }
            }
            attempt()
          } else {
            var stored = assign({}, DEFAULTS, readLocal())
            stored[field] = value
            writeLocal(stored)
            config.local = true
            confirmWrite()
          }
        }
        // 1.1.4 — `tab` is a pure view flag: after the switch the only things
        // that differ are the html flag, which group is hidden and the selected
        // strip entry, and applyTabView() covers all three. Everything else a
        // full sync costs (bar mounting, whole-document scans, temp badges,
        // expand-all) is unrelated to the tab, so a tab write takes the narrow
        // path. Resolving the host sidebar fails -> fall through to the normal
        // sync, which degrades properly instead.
        if (field === 'tab' && applyTabView()) return
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
        // 0.8.3: an open rail panel belongs to the rail. Leaving it closes the
        // panel before paint, so no fixed overlay survives a widened column.
        if (!rail) runtime.railOpen = false
        runtime.rail = rail
        if (rail) {
          runtime.railSaved = {
            mode: config.values.mode,
            tab: config.values.tab,
          }
        } else if (runtime.railSaved) {
          // Leaving the rail restores what the user had before the column was
          // squeezed; the bar is not reachable while the rail is showing.
          // 0.7.3: but only when nothing else changed the layout meanwhile —
          // picking a layout in the plugin detail page while the rail is up
          // used to be silently reverted on expand, so the setting looked
          // broken.
          if (config.values.mode === runtime.railSaved.mode) {
            config.values = assign({}, config.values, runtime.railSaved)
          }
          runtime.railSaved = null
        }
      }

      var pending = false
      var syncStreak = 0
      var streakTimer = null
      var streakDeferred = false
      // Safety net for the observer feedback loop: a paint that mutates the
      // observed root chains MutationObserver -> scheduleSync -> paint in
      // microtasks forever, so the renderer never gets a turn and DSH hangs on
      // "Loading plugins...". A healthy startup needs only a handful of syncs
      // between two macrotasks. Cap the streak, yield once, then resume; this
      // cannot lose a state change, and it keeps unrelated future regressions
      // from taking the whole app down.
      function scheduleSync() {
        if (runtime.disposed || pending) return
        if (!streakTimer) {
          streakTimer = setTimeout(function () {
            streakTimer = null
            syncStreak = 0
            var again = streakDeferred
            streakDeferred = false
            if (again && !runtime.disposed) scheduleSync()
          }, 0)
        }
        if (syncStreak >= 16) {
          streakDeferred = true
          return
        }
        syncStreak += 1
        pending = true
        Promise.resolve().then(function () {
          pending = false
          if (!runtime.disposed) sync()
        })
      }

      function sync() {
        if (runtime.disposed) return
        // Both are idempotent: the status call stops after one answer, and the
        // expand clicker skips groups that are already fully shown. The clicker
        // is also the expensive half (a whole-document scan plus one host click
        // per collapsed group, and each click re-renders the tree), so it only
        // runs when the tree changed or a hidden group was just revealed --
        // see rowsDirty.
        loadTempStatus()
        if (rowsDirty) {
          rowsDirty = false
          expandAllSessions()
        }
        var fx = hostResolve()
        // 1.0.0 M1: explicit null handling on the second resolver caller.
        // paint() owns control mounting and observer registration; a null ref
        // makes it degrade and return. measureRail already tolerates null.
        if (!fx) degrade('sidebar-unresolved', 'layout')
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
            // 1.1.4 — a width change re-renders the rows (the host recalcs its
            // watermark), so it also dirties the expand pass.
            runtime.resizeObserver = new ResizeObserver(function () {
              rowsDirty = true
              scheduleSync()
            })
          }
          try {
            runtime.resizeObserver.observe(root)
          } catch (error) {
            void error
          }
        }
        if (typeof MutationObserver === 'function') {
          if (!runtime.mutationObserver) {
            // 1.1.4 — a render of the tree is exactly when the expand pass has
            // new rows to look at, so it is the flag's main source as well.
            runtime.mutationObserver = new MutationObserver(function () {
              rowsDirty = true
              scheduleSync()
            })
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
        if (!config.controller) return null
        var snapshot = null
        try {
          snapshot = config.controller.getSnapshot()
        } catch (error) {
          snapshot = null
        }
        if (!snapshot || typeof snapshot !== 'object') return null
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
        tabConfirmed = next.tab
        if (typeof writeSeq === 'number') tabConfirmedSeq = writeSeq
        config.local = false
        maybeFocusOnLaunch()
        // 1.1.4 — this push cannot need a full repaint when it agrees with the
        // layout fields the last paint applied: adoptValues() only ever carries
        // mode, showQuickSwitch and tab, and a mode or quick-switch change
        // shows up here as a mismatch. What is left is the tab, which
        // applyTabView() handles on its own. The caller decides; null means
        // "no usable snapshot", which is not a hint.
        var painted = runtime.painted
        return {
          layoutFree: !!painted
            && next.mode === painted.mode
            && next.showQuickSwitch === painted.showQuickSwitch,
        }
      }

      /**
       * 1.1.3 — the config form's `focusOnLaunch` switch. Read through the
       * controller rather than `config.values`, because adoptValues() is
       * deliberately limited to the layout fields and must not grow a
       * side-effecting key.
       */
      function readFocusOnLaunch() {
        var controller = configController()
        try {
          var snapshot = controller && controller.getSnapshot && controller.getSnapshot()
          var value = snapshot && snapshot.value
          return !!(value && value.focusOnLaunch === true)
        } catch (error) {
          return false
        }
      }

      function writeFocusOnLaunch(value, onRollback) {
        if (typeof value !== 'boolean') return false
        var controller = configController()
        if (!controller || typeof controller.mutate !== 'function') return false
        var failed = false
        function fail(error) {
          if (failed) return
          failed = true
          try { if (typeof onRollback === 'function') onRollback() } catch (inner) { void inner }
          toast(t('policy.failed') + t('options.focusWindow') + ' · ' + String((error && error.message) || t('policy.conflictHint')), true)
        }
        try {
          // No pre-captured revision: the host controller resolves the profile
          // revision inside its serialized write queue (same contract as setField).
          var result = controller.mutate([{ op: 'set', path: ['focusOnLaunch'], value: value }])
          if (result === false) { fail(); return false }
          if (result && typeof result.then === 'function') {
            result.then(function (outcome) {
              if (outcome === false || (outcome && outcome.ok === false)) fail()
            }, fail)
          }
        } catch (error) {
          fail(error)
          return false
        }
        return true
      }

      /**
       * Bring the main window forward once per launch. The route is Windows
       * only; on other platforms it answers `unsupported` and this stays quiet.
       * A renderer-side window.focus() is attempted first as a cheap fallback
       * for hosts that do not expose the route.
       */
      function maybeFocusOnLaunch() {
        if (focusApplied || !readFocusOnLaunch()) return
        focusApplied = true
        try {
          if (typeof window.focus === 'function') window.focus()
        } catch (error) {
          void error
        }
        tempCall('api/dsh-sidebar-suite.focus-window', { method: 'POST', timeoutMs: 8000 })
          .catch(function (error) { void error })
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
              // A push that only moves the tab (including the echo of our own
              // write) must not cost a full repaint: take the narrow path, and
              // fall back to a real sync when the host sidebar cannot be
              // resolved or a layout field really changed.
              var hint = syncFromController()
              if (hint && hint.layoutFree === true && applyTabView()) return
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
        tabConfirmed = config.values.tab
        if (typeof writeSeq === 'number') tabConfirmedSeq = writeSeq
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
          return normalizeMode(value && value.mode)
        } catch (error) {
          return DEFAULTS.mode
        }
      }

      function writeDefaultMode(mode) {
        if (MODES.indexOf(mode) < 0) return false
        var controller = configController()
        if (!controller || typeof controller.mutate !== 'function') return false
        var previousMode = config.values.mode
        var previousConfigMode = runtime.configMode
        var previousSessionMode = runtime.sessionMode
        var previousPopOpen = runtime.popOpen
        var failed = false
        function fail(error) {
          if (failed) return
          failed = true
          // Same defect class as setField(): adopting the new default before
          // mutate() settles used to leave the UI claiming a saved default
          // that the next launch did not have.
          config.values = assign({}, config.values, { mode: previousMode })
          runtime.configMode = previousConfigMode
          runtime.sessionMode = previousSessionMode
          runtime.popOpen = previousPopOpen
          toast(t('policy.failed') + fieldLabel('mode') + ' · ' + String((error && error.message) || t('policy.conflictHint')), true)
          scheduleSync()
        }
        try {
          // 0.8.6: same contract as setField — no pre-captured revision; the
          // host controller resolves it inside its serialized write queue.
          var result = controller.mutate([{ op: 'set', path: ['mode'], value: mode }])
          if (result === false) { fail(); return false }
          if (result && typeof result.then === 'function') {
            result.then(function (outcome) {
              if (outcome === false || (outcome && outcome.ok === false)) fail()
            }, fail)
          }
        } catch (error) {
          fail(error)
          return false
        }
        // The settings page and the sidebar share this client run, so adopt
        // the new default immediately; fail() rolls it back if persistence
        // later rejects.
        runtime.sessionMode = null
        runtime.configMode = mode
        config.values = assign({}, config.values, { mode: mode })
        if (runtime.popOpen && mode !== 'c') runtime.popOpen = false
        scheduleSync()
        return true
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
      // The seat DSH >= 0.2.2-rc.3 renders inside its New-session row
      // (`sidebar.session.action`, a hoc slot: the occupant receives the host's
      // own button as `children` and may wrap it). We hand the content back
      // untouched and add one empty <div> after it; the Temp button is mounted
      // into that div imperatively, so the config hot reload keeps working
      // without a React state bridge and React never touches children it did
      // not create. `wide === false` is the collapsed 56px rail.
      function makeSessionActionSeat(h, ReactLib) {
        function SessionActionSeat(props) {
          var wide = props && props.wide
          if (typeof wide === 'boolean') tempSlotWide = wide
          if (ReactLib && typeof ReactLib.useEffect === 'function') {
            // Re-place after every render: collapsing the sidebar or switching
            // chat mode re-renders the row and the button has to follow it.
            ReactLib.useEffect(function () { scheduleSync() })
          }
          var seat = h('div', { 'data-dsbs-temp-anchor': '', 'data-dsbs-temp-slot': '' })
          var children = props ? props.children : null
          if (ReactLib && ReactLib.Fragment) return h(ReactLib.Fragment, null, children, seat)
          return [children, seat]
        }
        return SessionActionSeat
      }

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
          if (mode === 'b') {
            return frame(null, box({ width: '60%', height: '4px' }), box({ width: '100%', height: '11px' }))
          }
          if (mode === 'n') {
            // Official default: two full-width rows, nothing hidden or overlaid.
            return frame(null, box({ width: '100%', height: '7px' }), box({ width: '100%', height: '7px' }))
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
          // 1.1.3 — the window switch lives in the plugin config (configForms),
          // not in temp-session-config.txt, because it is a host capability
          // preference rather than a cleanup policy.
          var focusState = ReactLib.useState(readFocusOnLaunch())
          var focusOnLaunch = focusState[0]
          var setFocusOnLaunch = focusState[1]
          // 1.1.5 — manual focus test. The switch is useful only if the host
          // can actually raise the window on this machine; this tells the user
          // immediately instead of waiting for the next launch.
          var focusTestState = ReactLib.useState('')
          var focusTest = focusTestState[0]
          var setFocusTest = focusTestState[1]
          // 1.1.5 — update check. `null` means "not checked yet"; an object
          // with `busy` means the request is in flight.
          var updateState = ReactLib.useState(null)
          var update = updateState[0]
          var setUpdate = updateState[1]
          var updateCopyState = ReactLib.useState('')
          var updateCopy = updateCopyState[0]
          var setUpdateCopy = updateCopyState[1]
          ReactLib.useEffect(function () {
            var controller = configController()
            if (!controller || typeof controller.subscribe !== 'function') return
            var off = null
            try {
              off = controller.subscribe(function () {
                setMode(readDefaultMode())
                setFocusOnLaunch(readFocusOnLaunch())
              })
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
          // 0.8.0 — local trash. `null` = still loading, so the section shows a
          // loading line instead of "nothing deleted" (a lie while unsynced).
          var trashState = ReactLib.useState(null)
          var trash = trashState[0]
          var setTrash = trashState[1]
          var trashStatusState = ReactLib.useState('')
          var trashStatus = trashStatusState[0]
          var setTrashStatus = trashStatusState[1]
          // 0.8.1: which row is armed for its second click. Empty = nothing
          // armed, so a single mis-click can no longer destroy the only copy.
          var trashConfirmState = ReactLib.useState('')
          var trashConfirm = trashConfirmState[0]
          var setTrashConfirm = trashConfirmState[1]
          // 0.8.4 — active temporary sessions. Same shape as the trash list:
          // null = still loading, false-ish ok = host unreachable. `tempArm`
          // reuses the trash's arm-then-confirm contract for the one action
          // that moves a session out of "deleted on quit".
          var tempListState = ReactLib.useState(null)
          var tempSessions = tempListState[0]
          var setTempSessions = tempListState[1]
          var tempListStatusState = ReactLib.useState('')
          var tempListStatus = tempListStatusState[0]
          var setTempListStatus = tempListStatusState[1]
          var tempArmState = ReactLib.useState('')
          var tempArm = tempArmState[0]
          var setTempArm = tempArmState[1]
          // PD-13: the bulk "keep all" action has the same arm-then-confirm
          // contract as the per-row delete; a stray click must not promote the
          // whole list in one hit.
          var keepAllArmState = ReactLib.useState(false)
          var keepAllArm = keepAllArmState[0]
          var setKeepAllArm = keepAllArmState[1]
          // The id list behind the loaded rows; the 2.5s poll re-fetches titles
          // only when this changes, so an open page tracks sessions created in
          // the sidebar without paying a title read every tick.
          var tempListIds = null
          // A slow host must not turn the 2.5s tick into overlapping list
          // requests. `tempListInFlight` also covers the initial load and
          // action-triggered reloads, not just the poll itself; the sequence
          // makes an older response unable to overwrite a newer list.
          var tempListInFlight = 0
          var tempListSeq = 0
          // The poll has its own latch because it can be skipped by the count
          // above while a manual load is still running.
          var tempPollInFlight = false
          // 0.8.4 — the config path row flashes this after a click copies it.
          var pathFlashState = ReactLib.useState('')
          var pathFlash = pathFlashState[0]
          var setPathFlash = pathFlashState[1]
          // 0.8.5 — what the cleanup really did and when it will run again.
          // Both fields already exist in the status payload; the page used to
          // carry them only inside the feedback report.
          var statusInfoState = ReactLib.useState(null)
          var statusInfo = statusInfoState[0]
          var setStatusInfo = statusInfoState[1]

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

          // ---- host / contract self-check (0.7.4) ------------------------
          // Reads the same status payload the feedback section already uses,
          // plus live DOM / slot facts — no new route and no state that can
          // drift away from what the sidebar is actually doing.
          var healthDiagState = ReactLib.useState(null)
          var healthDiag = healthDiagState[0]
          var setHealthDiag = healthDiagState[1]
          var healthOpenState = ReactLib.useState(false)
          var healthOpen = healthOpenState[0]
          var setHealthOpen = healthOpenState[1]
          // Shared by every async callback below: a response that lands after
          // the settings panel was torn down must not touch stale state. Same
          // guard pattern as the effect-local `alive` latch.
          var settingsAlive = true
          ReactLib.useEffect(function () {
            var alive = true
            loadDiagnostics().then(function (data) {
              if (alive) {
                setHealthDiag(data)
                // 0.8.5: the same payload feeds the cleanup-info lines.
                adoptStatusExtra(data)
              }
            })
            // 1.1.5: one read-only npm lookup when this settings page opens.
            // The host caches it for ten minutes, so reopening the page is cheap.
            checkForUpdate()
            return function () { alive = false; settingsAlive = false }
          }, [])

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

          /**
           * 1.1.5 — update check. The Host half does the npm lookup; the page
           * only displays the answer. A failure is shown as a small status line,
           * never as an error toast: being offline is not a plugin failure.
           */
          function checkForUpdate() {
            setUpdate({ busy: true })
            setUpdateCopy('')
            return tempCall('api/dsh-sidebar-suite.update-check', { timeoutMs: 8000 })
              .then(function (data) {
                if (!settingsAlive) return
                setUpdate(data && typeof data === 'object' ? data : { ok: false, detail: 'empty response' })
              })
              .catch(function (error) {
                if (!settingsAlive) return
                setUpdate({ ok: false, reason: 'request-failed', detail: String((error && error.message) || error) })
              })
          }

          function copyUpdateCommand() {
            var command = 'dsh plugin --profile desktop add dsh-sidebar-suite'
            copyText(command).then(function () {
              setUpdateCopy(t('options.updateCopied'))
              setTimeout(function () { setUpdateCopy('') }, 2400)
            }, function () {
              setUpdateCopy(t('feedback.failed'))
            })
          }

          /**
           * 1.1.5 — one manual focus attempt with a visible outcome. It uses the
           * same POST route as the startup path, but unlike startup it reports
           * unsupported/failed instead of staying silent.
           */
          function testFocusNow() {
            if (focusTest === 'busy') return
            setFocusTest('busy')
            try {
              if (typeof window.focus === 'function') window.focus()
            } catch (error) {
              void error
            }
            tempCall('api/dsh-sidebar-suite.focus-window', { method: 'POST', timeoutMs: 8000 })
              .then(function (data) {
                if (!settingsAlive) return
                if (data && data.ok === true) {
                  setFocusTest('ok')
                  toast(t('options.focusTestOk'))
                } else if (data && data.unsupported === true) {
                  setFocusTest('unsupported')
                  toast(t('options.focusUnsupported'), true)
                } else {
                  setFocusTest('fail')
                  toast(t('options.focusTestFail') + String((data && data.reason) || ''), true)
                }
              })
              .catch(function (error) {
                if (!settingsAlive) return
                setFocusTest('fail')
                toast(t('options.focusTestFail') + String((error && error.message) || error), true)
              })
          }

          // One status call is enough for a whole session of editing: version
          // and OS do not change while the page is open.
          var diagCache = null
          // The health card, the feedback report and the Recheck button all ask
          // for the same status. Share one in-flight read so a slow host cannot
          // stack requests; the ordinary read gets the same watchdog as force.
          var diagPending = null
          var diagPendingForce = false
          // 0.7.4: `force` backs the health badge's Recheck button. A forced
          // failure returns null instead of a stale cached report, so the badge
          // can honestly say "unavailable" right after a failed retry. The
          // feedback report's non-forced path is unchanged.
          function loadDiagnostics(force) {
            if (!force && diagCache) return Promise.resolve(diagCache)
            // Do not share one in-flight request across force boundaries: a
            // forced failure resolves null, while the ordinary caller still
            // expects the stale cached report.
            if (diagPending && diagPendingForce === !!force) return diagPending
            var request = tempCall('api/dsh-temp-session.status', { timeoutMs: 10000 })
              .then(function (data) {
                if (data && data.ok === true) diagCache = data
                if (force) return data && data.ok === true ? diagCache : null
                return diagCache
              })
              .catch(function () {
                return force ? null : diagCache
              })
            diagPendingForce = !!force
            diagPending = request.then(function (value) {
              diagPending = null
              diagPendingForce = false
              return value
            }, function (error) {
              diagPending = null
              diagPendingForce = false
              throw error
            })
            return diagPending
          }

          // 0.7.4 review: `lastError` reaches a PUBLIC issue URL via the
          // feedback buttons. Never paste an absolute local path there, even
          // if a future host error starts carrying one. The exact path stays
          // in the local toast returned by the remove route.
          function redactLocalPaths(text) {
            return String(text || '')
              .replace(/[A-Za-z]:\\[^\s"'<>|]+/g, '<path>')
              .replace(/\\\\[^\s"'<>|]+/g, '<path>')
              .replace(/(^|[\s(])\/[^\s"'<>|]+/g, '$1<path>')
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
            if (diag && diag.lastError) lines.push('- last error: ' + redactLocalPaths(diag.lastError))
            lines.push('')
            lines.push('### Where to send / 发送到哪里')
            lines.push('Discussions: ' + FEEDBACK_DISCUSSIONS_URL)
            lines.push('Or an issue: ' + FEEDBACK_REPO + '/issues/new')
            return lines.join('\n')
          }

          // 0.7.4: the three contracts the sidebar really depends on. All read
          // live, so a hot reload or host upgrade shows up on the next paint
          // instead of a stale "all good" badge.
          function healthColor(state) {
            if (state === 'ok') return 'var(--dsw-alias-text-success,#3aa76d)'
            if (state === 'fallback') return 'var(--dsw-alias-text-warning,#d9a441)'
            if (state === 'fail') return 'var(--dsw-alias-text-error,#e5484d)'
            if (state === 'info') return 'var(--dsw-alias-label-secondary,inherit)'
            return 'var(--dsw-alias-label-secondary,inherit)'
          }
          function readHealth() {
            var sidebar = null
            try {
              sidebar = hostResolve()
            } catch (error) {
              void error
              degrade('sidebar-read-failed', 'diagnostics')
            }
            var env = (healthDiag && healthDiag.env) || {}
            // A bare route COUNT is not a contract check: if register() threw
            // for the paths route, eight healthy routes still made the badge
            // green while "Open session folder" was dead. Verify the endpoints
            // this client actually calls — including the four trash routes, so a
            // half-registered host cannot show "3/3 healthy" over a dead
            // "Recently deleted" section.
            var REQUIRED_TEMP_ROUTES = [
              'status', 'list', 'config', 'track', 'untrack', 'keep-all',
              'remove', 'purge', 'probe', 'paths',
              'trash', 'trash-restore', 'trash-delete', 'trash-empty',
            ]
            var routeInfo = (healthDiag && healthDiag.routes) || {}
            var routePaths = Array.isArray(routeInfo.paths) ? routeInfo.paths : []
            var missingRoutes = REQUIRED_TEMP_ROUTES.filter(function (name) {
              return routePaths.indexOf('/api/dsh-temp-session.' + name) === -1
            })
            var apiOk = !!(healthDiag
              && routeInfo.registered >= REQUIRED_TEMP_ROUTES.length
              && (!Array.isArray(routeInfo.errors) || routeInfo.errors.length === 0)
              && missingRoutes.length === 0)
            var slotState = tempSlotMode === 'slot' ? 'ok'
              : (tempSlotMode === 'dom' ? 'fallback' : 'pending')
            var checks = [
              {
                key: 'sidebar', label: t('health.sidebar'),
                state: sidebar && sidebar.workspaces ? 'ok' : 'fail',
                detail: sidebar && sidebar.workspaces ? t('health.sidebar.ok') : t('health.sidebar.fail'),
              },
              {
                key: 'slot', label: t('health.slot'), state: slotState,
                detail: slotState === 'ok' ? t('health.slot.ok')
                  : slotState === 'fallback' ? t('health.slot.fallback')
                  : (tempSeatError || t('health.slot.pending')),
              },
            ]
            var apiState = apiOk ? 'ok' : (tempStatusError ? 'fail' : (healthDiag ? 'fail' : 'pending'))
            checks.push({
              key: 'api', label: t('health.api'), state: apiState,
              detail: apiOk ? t('health.api.ok')
                : apiState === 'pending' ? t('health.api.pending')
                : (missingRoutes.length ? t('health.api.fail') + ' — '
                  + missingRoutes.map(function (name) { return '/api/dsh-temp-session.' + name }).join(', ')
                  : redactLocalPaths(tempStatusError || (healthDiag && healthDiag.lastError) || t('health.api.fail'))),
            })
            // 0.7.4 — informational rows: which row-menu path and tab-strategy
            // this host ended up using. `info` never turns the badge red.
            checks.push({
              key: 'menu', label: t('health.menu'), state: 'info',
              detail: tempMenuMode === 'native' ? t('health.menu.ok')
                : (tempMenuError || t('health.menu.fallback')),
            })
            var tabRecords = tabSnapshot()
            checks.push({
              key: 'tabs', label: t('health.tabs'), state: 'info',
              detail: !tabRecords.length ? t('health.tabs.idle')
                : nativeTabsAvailable ? t('health.tabs.native') : t('health.tabs.own'),
            })
            var coreChecks = checks.filter(function (c) { return c.state !== 'info' })
            var okCount = coreChecks.filter(function (c) { return c.state === 'ok' }).length
            var worst = coreChecks.some(function (c) { return c.state === 'fail' }) ? 'fail'
              : (coreChecks.some(function (c) { return c.state === 'fallback' }) ? 'fallback'
              : (coreChecks.some(function (c) { return c.state === 'pending' }) ? 'pending' : 'ok'))
            return {
              version: env.dshClient || '',
              plugin: env.plugin || VERSION,
              checks: checks, okCount: okCount, total: coreChecks.length, worst: worst,
            }
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
              // Older Host halves have no rowMenu key; the menu ships on.
              rowMenu: data.rowMenu !== false,
              maxKept: kept > 0 ? Math.min(Math.round(kept), 200) : 20,
              // 0.8.0 — local trash. Older Host halves have no such keys; the
              // defaults match the host's, so a mixed install still renders.
              keepDeleted: data.keepDeleted !== false,
              keepDeletedDays: (function () {
                var days = Number(data && data.keepDeletedDays)
                return days > 0 ? Math.min(Math.round(days), 365) : 7
              })(),
              configRevision: typeof data.configRevision === 'number' ? data.configRevision : null,
              configFile: typeof data.configFile === 'string' ? data.configFile : '',
            })
          }

          ReactLib.useEffect(function () {
            var stopped = false
            var loaded = false
            var reading = false
            var revision = null
            function read(first) {
              // The 2.5s interval used to be gated behind a successful first
              // read: one transient failure stopped every later poll and only
              // leaving/re-entering the page could recover. A single-flight
              // guard keeps the retries from stacking instead.
              if (stopped || reading) return
              reading = true
              tempCall('api/dsh-temp-session.config', { timeoutMs: WRITE_TIMEOUT_MS })
                .then(function (data) {
                  reading = false
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
                  reading = false
                  if (!stopped && first) setPolicy(false)
                })
            }
            read(true)
            // 0.2.8: a save in Notepad is picked up here within ~2.5 seconds.
            var timer = null
            if (typeof window.setInterval === 'function') {
              timer = window.setInterval(function () {
                if (stopped) return
                if (typeof document.hidden === 'boolean' && document.hidden) return
                // Keep trying the initial read too; `loaded` only decides
                // whether the temp-session list has a policy to render with.
                read(false)
                if (!loaded) return
                // 0.8.4: keep the active-temp-session rows in step with
                // sessions created or deleted elsewhere while the page is open.
                pollTempSessions()
              }, 2500)
            }
            return function () {
              stopped = true
              if (timer !== null && typeof window.clearInterval === 'function') window.clearInterval(timer)
            }
          }, [])

          function persist(patch) {
            if (!policy || policy === false) return
            // 0.8.4: snapshot BEFORE the optimistic update. A rejected save used
            // to leave the switch showing the unsaved value forever — the 2.5s
            // poll only re-adopts when the file's revision moves, and a failed
            // save does not move it. setField()/writeDefaultMode() have rolled
            // back since 0.7.4; this path now follows the same contract.
            var previous = policy
            setPolicy(assign({}, policy, patch))
            setSaveStatus('saving')
            tempCall('api/dsh-temp-session.config', { method: 'POST', body: JSON.stringify(patch), timeoutMs: WRITE_TIMEOUT_MS })
              .then(function (data) {
                if (!data || data.ok !== true) throw new Error((data && data.error) || 'save failed')
                adoptPolicy(data, patch.scheduleTime)
                // 0.8.5: a schedule edit moves the next-run target; the POST
                // response carries the fresh scheduler status.
                adoptStatusExtra(data)
                setSaveStatus('saved')
                // 0.8.1: the trash section reads keepDeleted from its own
                // response, so toggling the switch here used to leave it showing
                // the old policy until the page was reopened.
                // 0.8.1 (fourth pass): the window is part of the same visible
                // list. Changing days used to persist correctly while the rows
                // kept showing the old deadline until the page was reopened.
                if (typeof patch.keepDeleted === 'boolean' || typeof patch.keepDeletedDays === 'number') loadTrash()
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
                setPolicy(previous)
                setSaveStatus(opError('policy.failed', error))
              })
          }

          function purgeNow() {
            if (purgeStatus === 'busy') return
            setPurgeStatus('busy')
            tempCall('api/dsh-temp-session.purge', { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS })
              .then(function (data) {
                if (!data || data.ok !== true) throw new Error((data && data.error) || 'purge failed')
                // 0.7.3: the host reports files-it-deleted (`removed`) and
                // ids-that-were-already-gone (`zombies`) separately. To the user
                // both mean "this temporary session is gone", so sum them.
                var n = (typeof data.removed === 'number' ? data.removed : 0) +
                  (typeof data.zombies === 'number' ? data.zombies : 0)
                // 0.8.1: with the trash on these sessions are recoverable, so
                // "Removed N" was a lie the detail page told right below its own
                // "Recently deleted" list.
                var trashed = !!(policy && policy.keepDeleted !== false)
                setPurgeStatus(t(trashed ? 'options.purgedTrash' : 'options.purged') + n)
                // 0.8.5: the report IS the last cleanup — the info line under
                // the policy switches must show it without waiting for a poll.
                adoptLastPurge(data)
                // 0.7.3 (#3): a manual purge deletes sessions and clears their
                // tracking ids on the host. Refresh the client id list and the
                // sidebar rows here, otherwise stale TEMP badges and keep/delete
                // menu entries linger until a full page reload.
                refreshTempIds()
                refreshHostSessions()
                scheduleSync()
                // 0.8.0: those sessions just moved into the trash; the list the
                // user is looking at must show them, not wait for a reload.
                loadTrash()
              })
              .catch(function (error) {
                setPurgeStatus(opError('options.purgeFailed', error))
              })
          }

          // ---- local trash (0.8.0) --------------------------------------
          // One loader + one action channel instead of four near-identical
          // handlers: every trash action returns the same shape, so the list is
          // re-read from the host after any of them and the UI can never show a
          // row the host has already dropped.
          function loadTrash() {
            return tempCall('api/dsh-temp-session.trash', { timeoutMs: WRITE_TIMEOUT_MS })
              .then(function (data) {
                if (!data || data.ok !== true) throw new Error((data && data.error) || 'trash failed')
                // Normalise here, once: every consumer below indexes `entries`,
                // and an older Host half (or a stub in a test) may omit it.
                setTrash({
                  ok: true,
                  keepDeleted: data.keepDeleted !== false,
                  keepDeletedDays: data.keepDeletedDays,
                  caps: data.caps && typeof data.caps === 'object' ? data.caps : null,
                  totalBytes: typeof data.totalBytes === 'number' ? data.totalBytes : null,
                  entries: Array.isArray(data.entries) ? data.entries : []
                })
                return data
              })
              .catch(function (error) {
                setTrash({ ok: false, entries: [], error: String((error && error.message) || error) })
                return null
              })
          }

          function trashAction(kind, key) {
            if (trashStatus === 'busy') return
            // 0.8.1: any real action disarms the row that was waiting for a
            // second click. Before this, arming a delete and then restoring
            // something else left the armed label sitting there, and the next
            // stray click on it went through.
            setTrashConfirm('')
            setTrashStatus('busy')
            var path = 'api/dsh-temp-session.' + kind
            var query = kind === 'trash-empty' ? '' : '?key=' + encodeURIComponent(key || '')
            tempCall(path + query, { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS })
              .then(function (data) {
                if (!data || data.ok !== true) {
                  var reason = String((data && data.error) || 'trash action failed')
                  // The Host refuses to restore onto an existing directory; the
                  // only way out is to move it, so name it.
                  if (data && data.code === 'target-exists' && data.target) {
                    reason = t('trash.restoreBlocked') + String(data.target)
                  }
                  throw new Error(reason)
                }
                return loadTrash().then(function () {
                  if (kind === 'trash-restore') {
                    // A restored session is a real session again: refresh the
                    // sidebar and the temp-id list, otherwise it appears only
                    // after the next full page load.
                    refreshTempIds()
                    refreshHostSessions()
                    scheduleSync()
                    setTrashStatus(t('trash.restored'))
                    return
                  }
                  if (kind === 'trash-empty') {
                    var n = typeof data.removed === 'number' ? data.removed : 0
                    var bad = typeof data.failed === 'number' ? data.failed : 0
                    if (bad > 0) setTrashStatus(t('trash.emptyFailed') + bad)
                    else setTrashStatus(t('trash.emptied') + n)
                    return
                  }
                  setTrashStatus('')
                })
              })
              .catch(function (error) {
                setTrashStatus(opError('trash.failed', error))
              })
          }

          /**
           * Arm-then-confirm for the two buttons that cannot be undone.
           *
           * This section's whole reason to exist is that a mis-click was
           * unrecoverable, and it put "Restore" and "Delete for good" in two
           * identical pills side by side. The first click only labels the button
           * "Really delete?", the second one does it; the arm expires by itself
           * so a user who changes their mind cannot come back later and trigger
           * it with one stray click.
           */
          function requestTrashAction(kind, key) {
            var token = kind + ':' + (key || '')
            if (trashConfirm !== token) {
              setTrashConfirm(token)
              setTrashStatus(t('trash.confirmHint'))
              try {
                window.setTimeout(function () {
                  setTrashConfirm(function (previous) { return previous === token ? '' : previous })
                  setTrashStatus(function (previous) {
                    return previous === t('trash.confirmHint') ? '' : previous
                  })
                }, 5000)
              } catch (error) {
                void error
              }
              return
            }
            setTrashConfirm('')
            trashAction(kind, key)
          }

          /** Drop a pending confirmation without doing anything. */
          function cancelTrashAction() {
            setTrashConfirm('')
            setTrashStatus('')
          }

          // ---- active temporary sessions (0.8.4) ------------------------
          // The lifecycle's missing page: the trash manages the aftermath, but
          // the live list was reachable only by right-clicking rows in the
          // sidebar. One loader + the same untrack/remove routes the row menu
          // uses, so both entrances stay behaviourally identical.
          function loadTempSessions() {
            var seq = ++tempListSeq
            tempListInFlight += 1
            return tempCall('api/dsh-temp-session.list?titles=1', { timeoutMs: WRITE_TIMEOUT_MS })
              .then(function (data) {
                // A newer list request has already started; this answer is
                // stale and must not repaint the rows.
                if (seq !== tempListSeq) return null
                if (!data || data.ok !== true) throw new Error((data && data.error) || 'list failed')
                var ids = Array.isArray(data.ids) ? data.ids : []
                tempListIds = ids
                // An older Host half without ?titles= support returns the bare
                // shape; fall back to id-only rows instead of an empty list.
                var entries = Array.isArray(data.entries) && data.entries.length > 0
                  ? data.entries
                  : ids.map(function (id) { return { id: id, title: '' } })
                setTempSessions({
                  ok: true,
                  entries: entries,
                  maxKept: typeof data.maxKept === 'number' ? data.maxKept : null,
                })
                return data
              })
              .catch(function (error) {
                if (seq === tempListSeq) {
                  setTempSessions({ ok: false, entries: [], error: String((error && error.message) || error) })
                }
                return null
              })
              .then(function (result) {
                if (tempListInFlight > 0) tempListInFlight -= 1
                return result
              })
          }

          /** Cheap ids-only probe; titles are re-read only when the set moved. */
          function pollTempSessions() {
            if (tempPollInFlight || tempListInFlight > 0) return Promise.resolve(null)
            tempPollInFlight = true
            var seq = ++tempListSeq
            return tempCall('api/dsh-temp-session.list', { timeoutMs: WRITE_TIMEOUT_MS })
              .then(function (data) {
                if (seq !== tempListSeq) return null
                if (!data || !Array.isArray(data.ids)) return null
                var ids = data.ids
                var same = tempListIds !== null && ids.length === tempListIds.length
                if (same) {
                  for (var i = 0; i < ids.length; i++) {
                    if (ids[i] !== tempListIds[i]) { same = false; break }
                  }
                }
                if (same) return null
                return loadTempSessions()
              })
              .catch(function (error) { void error; return null })
              .then(function (result) {
                tempPollInFlight = false
                return result
              })
          }

          function tempSessionAction(kind, id) {
            if (tempListStatus === 'busy') return
            setTempArm('')
            setKeepAllArm(false)
            setTempListStatus('busy')
            var path = (kind === 'keep' ? 'api/dsh-temp-session.untrack?sessionId=' : 'api/dsh-temp-session.remove?sessionId=')
              + encodeURIComponent(id)
            tempCall(path, { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS })
              .then(function (data) {
                if (!data || data.ok !== true) throw new Error((data && data.error) || 'action failed')
                // Same reconciliation the row menu does: the sidebar's badge
                // list follows the host's answer, not the local guess.
                applyTempIdList(data.ids, id)
                refreshTempIds()
                if (kind === 'keep') {
                  setTempListStatus(t('tempList.kept'))
                } else {
                  refreshHostSessions()
                  setTempListStatus(t('tempList.deleted'))
                  loadTrash()
                }
                scheduleSync()
                return loadTempSessions()
              })
              .catch(function (error) {
                setTempListStatus(opError('temp.menu.failed', error))
                return loadTempSessions()
              })
          }

          /** Arm-then-confirm, the same contract the trash rows use. */
          function requestTempAction(id) {
            if (tempArm !== id) {
              setTempArm(id)
              setKeepAllArm(false)
              setTempListStatus(t('trash.confirmHint'))
              try {
                window.setTimeout(function () {
                  setTempArm(function (previous) { return previous === id ? '' : previous })
                  setTempListStatus(function (previous) {
                    return previous === t('trash.confirmHint') ? '' : previous
                  })
                }, 5000)
              } catch (error) {
                void error
              }
              return
            }
            tempSessionAction('delete', id)
          }

          function cancelTempAction() {
            setTempArm('')
            setTempListStatus('')
          }

          /** 0.8.5 — promote the whole list in one host call. PD-13: the first
           *  click only arms the button; the second click within 5s sends the
           *  keep-all call, mirroring the per-row arm-then-confirm contract. */
          function keepAllTempSessions() {
            if (tempListStatus === 'busy') return
            if (!keepAllArm) {
              setKeepAllArm(true)
              setTempArm('')
              setTempListStatus(t('tempList.keepAllConfirm'))
              try {
                window.setTimeout(function () {
                  setKeepAllArm(function (previous) { return previous ? false : previous })
                  setTempListStatus(function (previous) {
                    return previous === t('tempList.keepAllConfirm') ? '' : previous
                  })
                }, 5000)
              } catch (error) {
                void error
              }
              return
            }
            setKeepAllArm(false)
            setTempArm('')
            setTempListStatus('busy')
            tempCall('api/dsh-temp-session.keep-all', { method: 'POST', timeoutMs: WRITE_TIMEOUT_MS })
              .then(function (data) {
                if (!data || data.ok !== true) throw new Error((data && data.error) || 'keep-all failed')
                applyTempIdList([], '')
                refreshTempIds()
                setTempListStatus(t('tempList.keptAll'))
                scheduleSync()
                return loadTempSessions()
              })
              .catch(function (error) {
                setTempListStatus(opError('temp.menu.failed', error))
                return loadTempSessions()
              })
          }

          /** Adopt the cleanup report + scheduler target from a status payload. */
          function adoptStatusExtra(data) {
            if (!data || typeof data !== 'object') return
            setStatusInfo(function (previous) {
              return {
                lastPurge: data.lastPurge || (previous && previous.lastPurge) || null,
                schedule: data.schedule || (previous && previous.schedule) || null,
              }
            })
          }

          /** A purge just ran on the host — show its report immediately. */
          function adoptLastPurge(report) {
            if (!report || typeof report !== 'object') return
            setStatusInfo(function (previous) {
              return { lastPurge: report, schedule: (previous && previous.schedule) || null }
            })
          }

          /** The config path row copies itself on click; flash the result. */
          function copyConfigPath() {
            if (!policy || policy === false || !policy.configFile) return
            Promise.resolve(copyText(policy.configFile)).then(function () {
              setPathFlash(t('options.copied'))
              try {
                window.setTimeout(function () {
                  setPathFlash(function (previous) { return previous === t('options.copied') ? '' : previous })
                }, 2400)
              } catch (error) {
                void error
              }
            }).catch(function () {
              setPathFlash(t('feedback.failed'))
            })
          }

          ReactLib.useEffect(function () {
            var alive = true
            loadTrash().then(function () { if (!alive) return null; return null })
            loadTempSessions()
            return function () { alive = false }
          }, [])

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
          // Trash rows are read at a glance: "how big" and "when" decide whether
          // to restore or drop, so both are formatted rather than raw numbers.
          function formatBytes(bytes) {
            var n = Number(bytes)
            if (!(n > 0)) return '0 B'
            if (n < 1024) return n + ' B'
            if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
            return (n / (1024 * 1024)).toFixed(1) + ' MB'
          }
          /**
           * Bytes held by the trash: the Host's own total when it sends one
           * (0.8.1), otherwise a local sum so an older Host half still shows
           * something sane instead of a blank.
           */
          function trashTotalBytes(trash) {
            if (!trash) return 0
            if (typeof trash.totalBytes === 'number') return trash.totalBytes
            var list = Array.isArray(trash.entries) ? trash.entries : []
            return list.reduce(function (total, entry) {
              return total + (Number(entry && entry.bytes) || 0)
            }, 0)
          }
          function formatWhen(value) {
            var at = Date.parse(value)
            if (!Number.isFinite(at)) return '-'
            try {
              return new Date(at).toLocaleString()
            } catch (error) {
              return new Date(at).toISOString()
            }
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
          function updateStateName() {
            if (update && update.busy) return 'checking'
            if (update && update.ok === true && update.latest) {
              return update.updateAvailable ? 'available' : 'current'
            }
            if (update && update.ok === false) return 'failed'
            return 'idle'
          }
          function updateLineText() {
            if (!update) return t('options.updateHint')
            if (update.busy) return t('options.updateChecking')
            if (update.ok === true && update.latest) {
              return t('options.updateCurrent') + ' ' + (update.current || '?') +
                ' · ' + t('options.updateLatest') + ' ' + update.latest +
                ' · ' + t(update.updateAvailable ? 'options.updateAvailable' : 'options.updateNone')
            }
            return t('options.updateFailed') + (update.detail ? ' · ' + String(update.detail) : '')
          }
          return h('div', { 'data-dsbs-config': ENTRY, style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            h('div', { 'data-dsbs-intro': ENTRY, style: {
              fontSize: '11px', lineHeight: '16px',
              color: 'var(--dsw-alias-label-secondary,inherit)'
            } }, t('settings.intro')),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
              h('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--dsw-alias-label-primary,inherit)' } }, t('settings.title')),
              (function () {
                var health = readHealth()
                return h('button', {
                  type: 'button',
                  'data-dsbs-health': ENTRY,
                  'data-dsbs-health-state': health.worst,
                  'aria-expanded': healthOpen ? 'true' : 'false',
                  title: t(healthOpen ? 'health.collapse' : 'health.expand'),
                  style: {
                    font: 'inherit', fontSize: '11px', lineHeight: '16px',
                    padding: '2px 9px', borderRadius: '999px', cursor: 'pointer',
                    border: '1px solid currentColor', background: 'transparent',
                    color: healthColor(health.worst), whiteSpace: 'nowrap',
                  },
                  onClick: function () { setHealthOpen(!healthOpen) }
                }, t('health.label') + ' · ' + (health.version || t('health.unknown')) + ' · ' + health.okCount + '/' + health.total)
              })(),
              (function () {
                var state = updateStateName()
                var label = t('options.updateCheck')
                if (state === 'checking') label = t('options.updateChecking')
                else if (state === 'available') label = t('options.updateAvailable')
                else if (state === 'current') label = t('options.updateNone')
                else if (state === 'failed') label = t('options.updateFailed')
                return h('button', {
                  type: 'button',
                  'data-dsbs-update-check': ENTRY,
                  'data-dsbs-update-state': state,
                  title: updateLineText(),
                  onClick: checkForUpdate,
                  style: {
                    font: 'inherit', fontSize: '11px', lineHeight: '16px',
                    padding: '2px 9px', borderRadius: '999px', cursor: 'pointer',
                    border: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3))',
                    background: 'transparent',
                    color: state === 'available'
                      ? 'var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary,currentColor))'
                      : 'var(--dsw-alias-label-secondary,inherit)',
                    whiteSpace: 'nowrap',
                  }
                }, label)
              })()
            ),
            update ? h('div', {
              'data-dsbs-update-line': ENTRY,
              style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
            },
              h('span', { style: dim }, updateLineText()),
              update.ok === true && update.latest && update.updateAvailable
                ? h('button', {
                  type: 'button',
                  'data-dsbs-update-copy': ENTRY,
                  onClick: copyUpdateCommand,
                  style: assign({}, pillBase, { minWidth: '0' })
                }, updateCopy || t('options.updateCopy'))
                : null
            ) : null,
            // The copied command assumes the default `desktop` profile and a
            // fresh DSH start; spell that out so a non-default profile does
            // not install into the wrong place or think the update failed.
            h('div', { 'data-dsbs-update-note': ENTRY, style: Object.assign({}, dim, { overflowWrap: 'anywhere' }) }, t('options.updateNote')),
            healthOpen ? (function () {
              var health = readHealth()
              return h('div', {
                'data-dsbs-health-detail': ENTRY,
                style: {
                  display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25))',
                }
              },
                h('div', { style: { fontSize: '12px', fontWeight: '600', color: 'var(--dsw-alias-label-primary,inherit)' } }, t('health.title')),
                h('div', { style: dim }, t('health.dsh') + ': ' + (health.version || t('health.unknown'))
                  + ' · ' + t('health.plugin') + ': ' + health.plugin),
                health.checks.map(function (c) {
                  return h('div', {
                    key: c.key,
                    style: { display: 'flex', gap: '6px', alignItems: 'baseline', fontSize: '11px', lineHeight: '16px' }
                  },
                    h('span', { style: { color: healthColor(c.state), fontWeight: '600' } },
                      c.state === 'ok' ? '\u25cf' : c.state === 'fallback' ? '\u25d0' : c.state === 'fail' ? '\u25cf' : c.state === 'info' ? '\u25cf' : '\u25cb'),
                    h('span', { style: { color: 'var(--dsw-alias-label-primary,inherit)', whiteSpace: 'nowrap' } }, c.label),
                    h('span', { style: { color: 'var(--dsw-alias-label-secondary,inherit)', minWidth: 0 } }, c.detail)
                  )
                }),
                h('div', { style: dim }, t('health.legend')),
                h('div', { style: dim }, t('health.hint')),
                h('button', {
                  type: 'button',
                  'data-dsbs-health-recheck': ENTRY,
                  style: assign({}, pillBase, { minWidth: '0', alignSelf: 'flex-start' }),
                  onClick: function () {
                    setHealthDiag(null)
                    loadDiagnostics(true).then(function (data) { setHealthDiag(data) })
                  }
                }, t('health.recheck'))
              )
            })() : null,
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
                    policyRow(t('options.rowMenu'), policy.rowMenu === true, function (next) {
                      persist({ rowMenu: next })
                    }),
                    h('div', { style: dim }, t('options.rowMenuHint')),
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                      h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary,inherit)' } }, t('options.maxKept')),
                      h('input', {
                        type: 'number', min: 1, max: 200, step: 1,
                        value: String(policy.maxKept),
                        disabled: !policyReady,
                        'aria-label': t('options.maxKept'),
                        onChange: function (event) {
                          var target = event && event.target ? event.target : null
                          var raw = target ? target.value : ''
                          var n = Number(raw)
                          if (!(n > 0)) {
                            // 0.7.3: ignoring the typed value silently left the
                            // field showing an unsaved number (0, or junk) while
                            // the store kept the old one. Put the real value back
                            // so the field never lies about what is saved.
                            if (target) target.value = String(policy.maxKept)
                            return
                          }
                          var clamped = Math.min(Math.round(n), 200)
                          if (target && clamped !== n) target.value = String(clamped)
                          persist({ maxKept: clamped })
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
                    // 0.8.0 — local trash. The day count sits next to the switch
                    // because they answer one question together ("undoable, for
                    // how long"), and it is disabled (not just faded) when the
                    // switch is off, so the field cannot promise something the
                    // host will not do.
                    policyRow(t('options.keepDeleted'), policy.keepDeleted === true, function (next) {
                      persist({ keepDeleted: next })
                    }, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px' } },
                      h('input', {
                        type: 'number', min: 1, max: 365, step: 1,
                        value: String(policy.keepDeletedDays),
                        disabled: !policyReady || policy.keepDeleted !== true,
                        'aria-label': t('options.keepDeleted'),
                        onChange: function (event) {
                          var target = event && event.target ? event.target : null
                          var n = Number(target ? target.value : '')
                          if (!(n > 0)) {
                            if (target) target.value = String(policy.keepDeletedDays)
                            return
                          }
                          var clamped = Math.min(Math.round(n), 365)
                          if (target && clamped !== n) target.value = String(clamped)
                          persist({ keepDeletedDays: clamped })
                        },
                        style: {
                          font: 'inherit', fontSize: '12px', padding: '1px 6px', width: '64px',
                          borderRadius: '6px', color: 'var(--dsw-alias-label-primary,inherit)',
                          background: 'transparent',
                          border: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3))'
                        }
                      }),
                      h('span', { style: dim }, t('trash.days'))
                    )),
                    h('div', { style: dim }, t('options.keepDeletedHint')),
                    h('div', { style: Object.assign({}, dim, { overflowWrap: 'anywhere' }) },
                      t('options.rev') + ' ' + (policy.configRevision === null ? '-' : policy.configRevision)),
                    // 0.8.4: the path is a button, not prose — opening the file
                    // in Notepad starts with copying it, and hand-selecting a
                    // long wrapped path is exactly the friction to remove.
                    policy && policy !== false && policy.configFile
                      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
                        h('button', {
                          type: 'button',
                          'data-dsbs-config-path': '',
                          title: t('options.copyPath'),
                          onClick: copyConfigPath,
                          style: {
                            font: 'inherit', fontSize: '11px', lineHeight: '16px',
                            padding: '2px 8px', borderRadius: '6px', cursor: 'pointer',
                            textAlign: 'left', overflowWrap: 'anywhere',
                            color: 'var(--dsw-alias-label-secondary,inherit)',
                            background: 'transparent',
                            border: '1px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.3))'
                          }
                        }, policy.configFile),
                        pathFlash ? h('span', { style: dim }, pathFlash) : null
                      )
                      : null
                  ),
              // 1.1.3 — window preference, stored in the plugin config form
              // (not temp-session-config.txt), so it is its own small block
              // after the cleanup policy switches.
              h('div', { 'data-dsbs-window': ENTRY, style: {
                display: 'flex', flexDirection: 'column', gap: '6px',
                paddingTop: '8px'
              } },
                h('div', { style: { fontSize: '12px', fontWeight: '600', color: 'var(--dsw-alias-label-primary,inherit)' } }, t('options.windowTitle')),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                  h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary,inherit)' } }, t('options.focusWindow')),
                  h('button', {
                    type: 'button',
                    'data-dsbs-focus-window': ENTRY,
                    'aria-pressed': focusOnLaunch ? 'true' : 'false',
                    disabled: !available,
                    onClick: function () {
                      var next = !focusOnLaunch
                      if (writeFocusOnLaunch(next, function () { setFocusOnLaunch(readFocusOnLaunch()) })) {
                        setFocusOnLaunch(next)
                        // Turning it on is the natural moment to prove the host
                        // can really do it; the button below repeats this later.
                        if (next) testFocusNow()
                        else setFocusTest('')
                      }
                    },
                    style: assign({}, pillBase, focusOnLaunch ? pillOn : {})
                  }, focusOnLaunch ? t('options.focusOn') : t('options.focusOff')),
                  h('button', {
                    type: 'button',
                    'data-dsbs-focus-test': ENTRY,
                    // The test only calls the focus-window route; it does not
                    // write the plugin config, so it must not follow the config
                    // service availability gate the toggle next to it uses.
                    disabled: focusTest === 'busy',
                    onClick: testFocusNow,
                    style: assign({}, pillBase, { minWidth: '0' })
                  }, focusTest === 'busy' ? t('options.focusTesting') : t('options.focusTest'))
                ),
                h('div', { style: dim }, t('options.focusHint')),
                focusTest && focusTest !== 'busy'
                  ? h('div', {
                    'data-dsbs-focus-result': focusTest,
                    style: Object.assign({}, dim, {
                      color: focusTest === 'ok'
                        ? 'var(--dsw-alias-text-success,#3aa76d)'
                        : 'var(--dsw-alias-text-error,#e5484d)'
                    })
                  }, focusTest === 'ok'
                    ? t('options.focusTestOk')
                    : focusTest === 'unsupported'
                      ? t('options.focusUnsupported')
                      : t('options.focusTestFail'))
                  : null
              )
            ),
            h('div', { 'data-dsbs-temp-list': ENTRY, style: {
              display: 'flex', flexDirection: 'column', gap: '8px',
              paddingTop: '12px', marginTop: '2px',
              borderTop: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))'
            } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                h('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--dsw-alias-label-primary,inherit)' } }, t('tempList.title')),
                // 0.8.5: the bulk escape hatch. It only exists while there is
                // something to keep — an empty section has no row to save.
                tempSessions && tempSessions.ok === true && (tempSessions.entries || []).length > 0
                  ? h('button', {
                    type: 'button',
                    'data-dsbs-keep-all': '',
                    'data-dsbs-keep-all-arm': keepAllArm ? 'true' : 'false',
                    disabled: tempListStatus === 'busy',
                    title: keepAllArm ? t('tempList.keepAllConfirm') : t('tempList.keepAll'),
                    onClick: keepAllTempSessions,
                    style: assign({}, pillBase, { minWidth: '0', marginLeft: 'auto' })
                  }, keepAllArm ? t('tempList.keepAllConfirm') : t('tempList.keepAll'))
                  : null
              ),
              h('div', { style: dim }, t('tempList.help')),
              tempSessions === null
                ? h('div', { style: dim }, t('trash.loading'))
                : tempSessions.ok === false
                  ? h('div', { style: dim }, t('trash.failed') + String(tempSessions.error || ''))
                  : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                    (tempSessions.entries || []).length === 0
                      ? h('div', { style: dim }, t('tempList.none'))
                      : tempSessions.entries.map(function (entry) {
                        var armed = tempArm === entry.id
                        // Same label rule as the trash rows: the host-captured
                        // title when present, the bare id otherwise.
                        var label = entry.title ? entry.title : entry.id
                        return h('div', {
                          key: entry.id,
                          style: {
                            display: 'flex', flexDirection: 'column', gap: '2px',
                            fontSize: '11px', lineHeight: '16px', padding: '6px 0',
                            borderTop: '1px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.2))'
                          }
                        },
                          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } },
                            h('span', {
                              style: {
                                color: 'var(--dsw-alias-label-primary,inherit)', fontWeight: '600',
                                overflowWrap: 'anywhere'
                              }
                            }, label),
                            h('span', { style: { display: 'inline-flex', gap: '4px', marginLeft: 'auto' } },
                              h('button', {
                                type: 'button',
                                disabled: tempListStatus === 'busy',
                                onClick: (function (id) {
                                  return function () { tempSessionAction('keep', id) }
                                })(entry.id),
                                style: assign({}, pillBase, { minWidth: '0' })
                              }, t('tempList.keep')),
                              armed
                                ? h('button', {
                                  type: 'button',
                                  disabled: tempListStatus === 'busy',
                                  onClick: (function (id) {
                                    return function () { requestTempAction(id) }
                                  })(entry.id),
                                  style: assign({}, pillBase, { minWidth: '0' }, pillOn, {
                                    color: 'var(--dsw-alias-state-business-danger,#d9534f)'
                                  })
                                }, t('tempList.confirm'))
                                : null,
                              armed
                                ? h('button', {
                                  type: 'button',
                                  onClick: cancelTempAction,
                                  style: assign({}, pillBase, { minWidth: '0' })
                                }, t('trash.cancel'))
                                : null,
                              armed
                                ? null
                                : h('button', {
                                  type: 'button',
                                  disabled: tempListStatus === 'busy',
                                  onClick: (function (id) {
                                    return function () { requestTempAction(id) }
                                  })(entry.id),
                                  style: assign({}, pillBase, { minWidth: '0' }, {
                                    color: 'var(--dsw-alias-state-business-danger,#d9534f)'
                                  })
                                }, t('tempList.delete'))
                            )
                          ),
                          entry.title && entry.title !== entry.id
                            ? h('div', { style: dim }, entry.id)
                            : null
                        )
                      }),
                    (tempSessions.entries || []).length > 0
                      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '2px' } },
                        h('span', { style: dim },
                          t('trash.count') + (tempSessions.entries || []).length + ' ' + t('trash.countUnit') +
                          (tempSessions.maxKept ? ' · ' + t('trash.caps') + tempSessions.maxKept + ' ' + t('trash.countUnit') : '')))
                      : null
                  ),
              tempListStatus && tempListStatus !== 'busy'
                ? h('div', { style: dim }, tempListStatus)
                : null
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
                      // 0.7.3: the faded look said "disabled" while the field
                      // still accepted edits and saved them, so the visual and
                      // the behaviour disagreed. Fade it *and* disable it.
                      disabled: policy.scheduleDelete !== true,
                      onChange: function (event) {
                        var value = event && event.target ? event.target.value : ''
                        if (!value) return
                        persist({ scheduleTime: value })
                      },
                      style: {
                        font: 'inherit', fontSize: '12px', padding: '1px 6px',
                        borderRadius: '6px', color: 'var(--dsw-alias-label-primary,inherit)',
                        background: 'transparent',
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
                    ),
                    // 0.8.5: what the last cleanup actually did, and when the
                    // daily one fires next — both were report-only until now.
                    h('div', {
                      'data-dsbs-last-purge': '',
                      style: Object.assign({}, dim, { overflowWrap: 'anywhere' })
                    }, (function () {
                      var purge = statusInfo && statusInfo.lastPurge
                      if (!purge) return t('policy.lastPurgeNone')
                      var n = (typeof purge.removed === 'number' ? purge.removed : 0) +
                        (typeof purge.zombies === 'number' ? purge.zombies : 0)
                      return t('policy.lastPurge') + n + '/' + (typeof purge.tried === 'number' ? purge.tried : 0) +
                        ' · ' + String(purge.reason || '') + ' @ ' + formatWhen(purge.at)
                    })()),
                    h('div', { 'data-dsbs-next-run': '', style: dim }, (function () {
                      var schedule = statusInfo && statusInfo.schedule
                      if (!schedule || schedule.enabled !== true || !schedule.nextRunAt) {
                        return t('policy.nextRun') + t('policy.nextRunOff')
                      }
                      return t('policy.nextRun') + formatWhen(schedule.nextRunAt)
                    })())
                  )
            ),
            h('div', { 'data-dsbs-trash': ENTRY, style: {
              display: 'flex', flexDirection: 'column', gap: '8px',
              paddingTop: '12px', marginTop: '2px',
              borderTop: '1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))'
            } },
              h('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--dsw-alias-label-primary,inherit)' } }, t('trash.title')),
              h('div', { style: dim }, t('trash.help')),
              trash === null
                ? h('div', { style: dim }, t('trash.loading'))
                : trash && trash.ok === false
                  ? h('div', { style: dim }, t('trash.failed') + String(trash.error || ''))
                  // 0.8.1: the list is shown even with the switch off. Hiding it
                  // left the entries on disk with no way to clear them until the
                  // retention window expired ("turn it off" took 200MB hostage).
                  : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                    trash && trash.keepDeleted === false
                      ? h('div', { style: dim }, t('trash.off'))
                      : null,
                    (trash.entries || []).length === 0
                      ? h('div', { style: dim }, t('trash.none'))
                      : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                        (trash.entries || []).map(function (entry) {
                          var armed = trashConfirm === 'trash-delete:' + entry.key
                          // 0.8.1: a label beats a UUID. The Host captures the
                          // session's own title when it parks it; an entry from
                          // before that (or one without a cache) falls back to
                          // the id, which stays visible either way.
                          var label = entry.title ? entry.title : entry.id
                          var metaLine = (entry.title ? entry.id + ' · ' : '') +
                            (entry.workspace ? entry.workspace + ' · ' : '') +
                            formatWhen(entry.deletedAt) + ' · ' + formatBytes(entry.bytes)
                          return h('div', {
                            key: entry.key,
                            style: {
                              display: 'flex', flexDirection: 'column', gap: '2px',
                              fontSize: '11px', lineHeight: '16px', padding: '6px 0',
                              borderTop: '1px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.2))'
                            }
                          },
                            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } },
                              h('span', {
                                style: {
                                  color: 'var(--dsw-alias-label-primary,inherit)', fontWeight: '600',
                                  overflowWrap: 'anywhere'
                                }
                              }, label),
                              h('span', { style: { display: 'inline-flex', gap: '4px', marginLeft: 'auto' } },
                                h('button', {
                                  type: 'button',
                                  disabled: trashStatus === 'busy',
                                  onClick: (function (key) {
                                    return function () { trashAction('trash-restore', key) }
                                  })(entry.key),
                                  style: assign({}, pillBase, { minWidth: '0' })
                                }, t('trash.restore')),
                                armed
                                  ? h('button', {
                                    type: 'button',
                                    disabled: trashStatus === 'busy',
                                    'data-dsbs-trash-armed': 'true',
                                    onClick: (function (key) {
                                      return function () { requestTrashAction('trash-delete', key) }
                                    })(entry.key),
                                    style: assign({}, pillBase, { minWidth: '0' }, pillOn)
                                  }, t('trash.confirm.delete'))
                                  : null,
                                armed
                                  ? h('button', {
                                    type: 'button',
                                    'data-dsbs-trash-cancel': '',
                                    onClick: cancelTrashAction,
                                    style: assign({}, pillBase, { minWidth: '0' })
                                  }, t('trash.cancel'))
                                  : null,
                                armed
                                  ? null
                                  : h('button', {
                                    type: 'button',
                                    disabled: trashStatus === 'busy',
                                    'data-dsbs-trash-armed': 'false',
                                    onClick: (function (key) {
                                      return function () { requestTrashAction('trash-delete', key) }
                                    })(entry.key),
                                    style: assign({}, pillBase, { minWidth: '0' })
                                  }, t('trash.delete'))
                              )
                            ),
                            h('div', { style: dim }, metaLine),
                            entry.oversize ? h('div', { style: dim }, t('trash.oversize')) : null
                          )
                        }),
                        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '2px' } },
                          trashConfirm === 'trash-empty:'
                            ? h('span', { style: { display: 'inline-flex', gap: '4px' } },
                              h('button', {
                                type: 'button',
                                disabled: trashStatus === 'busy',
                                'data-dsbs-trash-armed': 'true',
                                onClick: function () { requestTrashAction('trash-empty', '') },
                                style: assign({}, pillBase, { minWidth: '0' }, pillOn)
                              }, t('trash.confirm.empty')),
                              h('button', {
                                type: 'button',
                                'data-dsbs-trash-cancel': '',
                                onClick: cancelTrashAction,
                                style: assign({}, pillBase, { minWidth: '0' })
                              }, t('trash.cancel'))
                            )
                            : h('button', {
                              type: 'button',
                              disabled: trashStatus === 'busy',
                              'data-dsbs-trash-armed': 'false',
                              onClick: function () { requestTrashAction('trash-empty', '') },
                              style: assign({}, pillBase, { minWidth: '0' })
                            }, t('trash.empty')),
                          h('span', { style: dim },
                            t('trash.count') + (trash.entries || []).length + ' ' + t('trash.countUnit') + ' · ' +
                            formatBytes(trashTotalBytes(trash))),
                          trash.caps
                            ? h('span', { style: dim },
                              t('trash.caps') + trash.caps.entries + ' ' + t('trash.countUnit') + ' · ' + formatBytes(trash.caps.bytes))
                            : null
                        ),
                        trash.caps ? h('div', { style: dim }, t('trash.capsNote')) : null
                      )
                  ),
              trashStatus
                ? h('div', { style: dim }, trashStatus === 'busy' ? t('trash.working') : trashStatus)
                : null
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
                  disabled: fbStatus === 'working',
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

      // A star button in the host's Session row action strip. It is a real
      // slot occupant (not a DOM injection), so React owns the button and the
      // row's drag/hover behaviour stays intact. When archive-manager already
      // paints its own star slot, the CSS above hides this one.
      function makeFavoriteActionSeat(h, ReactLib) {
        function FavoriteAction(props) {
          var id = props && props.sessionId
          var setFavoriteTick = ReactLib.useState(0)[1]
          ReactLib.useEffect(function () {
            return subscribeFavoriteChanges(function () {
              // The setter forces a rerender; the value itself is not read.
              setFavoriteTick(function (value) { return value + 1 })
            })
          }, [])
          if (!id) return null
          var active = isFavorite(id)
          var label = active ? t('fav.remove') : t('fav.add')
          return h('button', {
            type: 'button',
            'data-dsbs-fav-action': id,
            'aria-label': label,
            'aria-pressed': active ? 'true' : 'false',
            title: label,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '18px',
              height: '18px',
              padding: '0',
              border: '0',
              background: 'transparent',
              cursor: 'pointer',
              borderRadius: '4px',
            },
            onMouseDown: function (event) { if (event && event.stopPropagation) event.stopPropagation() },
            onClick: function (event) {
              if (event && event.stopPropagation) event.stopPropagation()
              if (event && event.preventDefault) event.preventDefault()
              toggleFavorite(id)
            },
          })
        }
        return FavoriteAction
      }


      // Register only when React and the slots service are both available.
      // Any failure here is contained: the sidebar control bar is unaffected.
      if (React && React.createElement && React.useState && React.useEffect && typeof ctx.inject === 'function') {
        try {
          ctx.inject(['slots'], function (scope) {
            var slots = scope && scope.slots
            // 1.0.0 M1: capability probes replace bare typeof chains, so an
            // unknown host that dropped either method simply loses the config
            // page instead of throwing inside the inject callback.
            if (!featureDetect(slots, 'inject') || !featureDetect(slots, 'register')) {
              degrade('slots-service-missing', 'settings')
              return
            }
            try {
              slots.inject(KNOWN_SLOTS.config, function () {
                return slots.register({
                  name: 'plugins.bundle.config',
                  key: ENTRY,
                  order: 0,
                }, makeModePicker(React.createElement, React))
              })
            } catch (error) {
              void error
            }
            // 0.6.0: take the seat the host renders inside its New-session row.
            // Undeclared on hosts below 0.2.2-rc.3, where register() throws and
            // the legacy sibling path in placeTempButton() takes over.
            try {
              slots.inject('sidebar.session.action', function () {
                tempSeatError = ''
                tempSeatDisposer = slots.register({
                  name: 'sidebar.session.action',
                  id: 'temp-session',
                  order: 0,
                }, makeSessionActionSeat(React.createElement, React))
                scheduleSync()
                return tempSeatDisposer
              })
            } catch (error) {
              tempSeatError = String((error && error.message) || error || 'slot registration failed')
              // A host without this slot still gets the legacy sibling button;
              // record the reason once instead of silently losing the seat.
              degrade('session-slot-failed', 'temp')
            }
            // 1.1.5 — the star sits in the host's own row action strip. This
            // slot is a list declared by ui-workspace; a pre-1.1 host without
            // it simply keeps the context-menu path and the title star.
            try {
              slots.inject('sidebar.workspaces.session.row.action', function () {
                favoriteActionDisposer = slots.register({
                  name: 'sidebar.workspaces.session.row.action',
                  id: 'dsbs-favorite',
                  order: 20,
                }, makeFavoriteActionSeat(React.createElement, React))
                scheduleSync()
                return favoriteActionDisposer
              })
            } catch (error) {
              void error
            }
          })
        } catch (error) {
          void error
        }
      }

      // 1.1.0 — the two global page panels. Registered in the host's `main`
      // slot, exactly like the Plugins page: no shell rewrites, no fake
      // conversation, and clicking a session naturally returns to it.
      if (React && React.createElement && React.useState && React.useEffect && React.useRef && typeof ctx.inject === 'function') {
        try {
          var pageInjection = ctx.inject(['slots', 'layout'], function (scope) {
            var slots = scope && scope.slots
            var layout = scope && scope.layout
            if (!featureDetect(slots, 'inject') || !featureDetect(slots, 'register') || !layout) {
              degrade('pages-service-missing', 'pages')
              return
            }
            runtime.pageLayout = layout
            if (layout.panelInfo && typeof layout.panelInfo.subscribe === 'function') {
              try {
                var pageOff = layout.panelInfo.subscribe(syncPageFromLayout)
                if (typeof pageOff === 'function') {
                  runtime.pageUnsubscribe = pageOff
                  manualCleanups.push(pageOff)
                }
              } catch (error) {
                void error
              }
            }
            try { syncPageFromLayout() } catch (error) { void error }
            try {
              var pageSlotInjection = slots.inject('main', function () {
                if (runtime.disposed) return function () {}
                var disposers = []
                try {
                  disposers.push(slots.register({
                    name: 'main',
                    key: PAGE_DEFS.chat.id,
                    locale: NS,
                    inject: function () { return {} },
                  }, makeWebPagePanel('chat')))
                  disposers.push(slots.register({
                    name: 'main',
                    key: PAGE_DEFS.api.id,
                    locale: NS,
                    inject: function () { return {} },
                  }, makeWebPagePanel('api')))
                } catch (error) {
                  // A half-registered pair is a broken switch; retire both.
                  for (var d = 0; d < disposers.length; d++) {
                    try { disposers[d]() } catch (inner) { void inner }
                  }
                  degrade('page-panel-register-failed', 'pages')
                  runtime.pageReady = false
                  scheduleSync()
                  return function () {}
                }
                runtime.pageReady = true
                if (typeof pageSlotInjection === 'function') runtime.pagePanelDisposer = pageSlotInjection
                scheduleSync()
                return function () {
                  runtime.pageReady = false
                  runtime.pagePanelDisposer = null
                  // Never leave the main column pointing at a panel that no
                  // longer exists: the next paint can only render the host's
                  // Conversation, but the selection itself would be orphaned.
                  try {
                    var active = layout.panelInfo && layout.panelInfo.getSnapshot
                      ? layout.panelInfo.getSnapshot().activePanelId
                      : null
                    if (active === PAGE_DEFS.chat.id || active === PAGE_DEFS.api.id) layout.selectPanel(null)
                  } catch (error) {
                    void error
                  }
                  for (var i = 0; i < disposers.length; i++) {
                    try { disposers[i]() } catch (inner) { void inner }
                  }
                  disposers.length = 0
                  scheduleSync()
                }
              })
              if (typeof pageSlotInjection === 'function') {
                runtime.pagePanelDisposer = pageSlotInjection
                manualCleanups.push(pageSlotInjection)
              }
            } catch (error) {
              void error
              degrade('page-slot-injection-failed', 'pages')
            }
          })
          if (typeof pageInjection === 'function') manualCleanups.push(pageInjection)
        } catch (error) {
          void error
        }
      }

      // 0.7.4 — native row context menu (DSH 0.2.2-rc.1+) and the public remote
      // used by "Open session folder". Both are optional services: if the host
      // is older, the DOM menu stays as the fallback and the health badge says
      // so. Neither service is safe to read at apply() time on this client, so
      // both go through ctx.inject(), the shape already proven for `slots`.
      if (typeof ctx.inject === 'function') {
        try {
          ctx.inject(['contextMenus'], function (scope) {
            var menus = scope && scope.contextMenus
            if (!featureDetect(menus, 'register')) {
              degrade('context-menus-missing', 'menus')
              return
            }
            try {
              var registration = {
                id: ENTRY + '.temp-session',
                target: 'session',
                order: 400,
                resolve: function (target) {
                  var actions = target && target.sessionId ? tempMenuActions(target.sessionId) : []
                  return actions.map(function (action) {
                    return {
                      id: action.id,
                      label: action.label,
                      danger: action.danger === true,
                      run: action.run,
                    }
                  })
                },
              }
              // One idempotent disposer, owned by BOTH this run's teardown and
              // the host scope: a hot reload tears the old run down before a
              // second register, and the host rejects duplicate ids.
              var rawDisposer = menus.register(registration)
              var disposed = false
              var disposeMenu = function () {
                if (disposed) return
                disposed = true
                try {
                  if (typeof rawDisposer === 'function') rawDisposer()
                } catch (error) { void error }
              }
              manualCleanups.push(disposeMenu)
              if (typeof ctx.effect === 'function') {
                ctx.effect(function () { return disposeMenu }, ENTRY + ': row menu')
              }
              tempMenuMode = 'native'
              tempMenuError = ''
              // 0.8.7: keeping the service lets a right-click ask whether the
              // popup actually opened. The listener stays mounted: on a host
              // whose rows no longer bind the gesture it is the only thing
              // that can open the menu (see onTempContextMenu).
              nativeMenus = menus
              mountTempRowMenu()
              // 1.1.5 — a favorite entry for every session, not only temp
              // ones. The row star is the fast path; the menu is the fallback
              // on a host that never renders the action slot.
              try {
                var favoriteMenuRegistration = {
                  id: ENTRY + '.favorite',
                  target: 'session',
                  order: 520,
                  resolve: function (target) {
                    var id = target && target.sessionId
                    if (!id) return []
                    var active = isFavorite(id)
                    return [{
                      id: 'favorite',
                      label: active ? t('fav.remove') : t('fav.add'),
                      run: function () { toggleFavorite(id) },
                    }]
                  },
                }
                var favoriteMenuDisposer = menus.register(favoriteMenuRegistration)
                if (typeof favoriteMenuDisposer === 'function') manualCleanups.push(favoriteMenuDisposer)
              } catch (error) {
                void error
              }
            } catch (error) {
              tempMenuMode = 'dom'
              nativeMenus = null
              tempMenuError = String((error && error.message) || error || 'menu registration failed')
              mountTempRowMenu() // a failed native registration still leaves a menu
            }
          })
        } catch (error) {
          tempMenuError = String((error && error.message) || error || 'contextMenus unavailable')
        }
        try {
          ctx.inject(['remote.session'], function (scope) {
            var remote = scope && scope.remote && scope.remote.session
            if (featureDetect(remote, 'openWorkspacePath')) remoteSession = remote
            else degrade('remote-session-missing', 'paths')
          })
        } catch (error) {
          void error
        }
        // rc.2+ native "More" entry grouping: when the host provides it, our
        // own tab strip is redundant. The health badge reports this; the strip
        // is only suppressed when a native panel actually exists for a tab.
        try {
          ctx.inject(['slots'], function (scope) {
            var slots = scope && scope.slots
            if (!featureDetect(slots, 'entriesOfSlot')) {
              degrade('slot-probe-missing', 'slots')
              return
            }
            var checkNativeTabs = function () {
              var available = false
              try {
                // Literal slot name is the public contract pinned by test_046;
                // a host whose probe throws now degrades instead of killing the
                // subscription callback.
                available = slots.entriesOfSlot('sidebar.panellist.actions').length > 0
              } catch (error) {
                void error
                degrade('slot-probe-failed', 'slots')
              }
              if (available === nativeTabsAvailable) return
              nativeTabsAvailable = available
              if (!available) return
              // A tab left active by an older run would keep its panel on
              // screen with no visible tab to click back out — a dead state.
              if (runtime.activeTab) {
                runtime.activeTab = null
                writeActiveTab(null)
                disposeAllTabPanels()
                notifyTabs('active')
              }
              scheduleSync() // re-render the strip so it yields to native grouping
            }
            try {
              checkNativeTabs()
              // The slot may be populated after this plugin applies; a one-shot
              // snapshot would leave our redundant strip (and its dead state)
              // in place on an otherwise fully capable host.
              if (featureDetect(slots, 'subscribe')) {
                // Literal name is pinned by test_046; KNOWN_SLOTS.panelActions
                // documents the same name for the audit in §6.1 of the design.
                var unsubscribe = slots.subscribe('sidebar.panellist.actions', checkNativeTabs)
                if (typeof unsubscribe === 'function') manualCleanups.push(unsubscribe)
              }
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

      // A second DSH window is the same localStorage, so a star clicked there
      // lands here as one storage event. No BroadcastChannel or polling.
      effect(function () {
        if (!window || typeof window.addEventListener !== 'function') return
        var onStorage = function (event) {
          if (!event) return
          if (event.key === FAVORITES_KEY) {
            // Another window already committed this array; do not echo it
            // back to localStorage. During an archive mutation the local
            // optimistic state is the one the user just asked for.
            if (favoritePendingCount > 0) return
            // This is a real state change too: a refresh already in flight
            // captured the old generation and must not overwrite it.
            favoriteMutationVersion += 1
            adoptFavoriteIds(normalizeFavoriteIds(readFavoriteIds()), { persist: false })
          } else if (event.key === FAVORITES_COLLAPSED_KEY) {
            favoriteCollapsed = readFavoriteCollapsed()
            paintFavoriteGroup()
          }
        }
        window.addEventListener('storage', onStorage)
        return function () {
          try { window.removeEventListener('storage', onStorage) } catch (error) { void error }
        }
      }, 'sidebar-suite: favorites storage')

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
          var target = event.target
          // 0.8.3: the rail panel is fixed-positioned, so a click outside it
          // must close it explicitly — there is no host overlay to do that.
          if (runtime.railOpen) {
            var menu = runtime.railMenu
            if (!target || !menu || !menu.contains(target)) {
              runtime.railOpen = false
              scheduleSync()
            }
          }
          if (config.values.mode !== 'c' || !runtime.popOpen) return
          if (!target) return
          if (runtime.bar && runtime.bar.contains(target)) return
          if (runtime.nav && runtime.nav.contains(target)) return
          runtime.popOpen = false
          scheduleSync()
        }
        var onKeyDown = function (event) {
          if (event.key !== 'Escape') return
          if (runtime.railOpen) {
            // Same focus contract as the pop overlay: Esc returns to the trigger.
            closeRailMenu(true)
            return
          }
          if (!runtime.popOpen) return
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
        // 0.4.0 — right-click on a temporary row. One delegated listener on the
        // document, because the host recreates session rows on every list
        // refresh; per-row listeners would need re-binding after each render.
        mountTempRowMenu()
        return tempMenuUnmount
      }, 'sidebar-suite: temp row menu')

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
          tempCall('api/dsh-temp-session.status', { timeoutMs: WRITE_TIMEOUT_MS })
            .then(function (data) {
              configPollPending = false
              if (runtime.disposed || !data || data.ok !== true) return
              if (typeof data.configRevision !== 'number') return
              if (data.configRevision === tempConfigRevision) return
              rememberConfigRevision(data)
              applyTempSettings(data)
              // 0.8.4: a revision bump usually means the plugin host came back
              // (restart, hot reload). The tracked id list lives there, so the
              // TEMP badges must re-read it — applyTempSettings alone left the
              // badges describing the previous host's list until a page reload.
              refreshTempIds()
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
          // 1.1.4 — a flip made inside the coalescing window must still reach
          // the profile. Flush BEFORE the disposed flag goes up, because
          // setField()'s attempt() bails out once the run is over.
          try {
            if (tabWriteTimer !== null) clearTimeout(tabWriteTimer)
            tabWriteTimer = null
            if (tabWriteQueued !== null) {
              var pendingTab = tabWriteQueued
              tabWriteQueued = null
              commitTab(pendingTab)
            }
          } catch (error) {
            void error
          }
          runtime.disposed = true
          try {
            if (streakTimer) clearTimeout(streakTimer)
            streakTimer = null
            streakDeferred = false
          } catch (error) {
            void error
          }
          // 1.1.4 — the deferred expand sweep and the coalesced resize notice
          // belong to this run; a pending one must not fire into a torn-down
          // sidebar.
          try {
            if (expandSoonTimer) clearTimeout(expandSoonTimer)
            expandSoonTimer = 0
            rowsDirty = true
            overlayRemeasureRaf = 0
          } catch (error) {
            void error
          }
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
            if (typeof tempSeatDisposer === 'function') {
              try { tempSeatDisposer() } catch (error) { void error }
              tempSeatDisposer = null
            }
            if (tempButton && tempButton.parentNode) tempButton.parentNode.removeChild(tempButton)
            if (runtime.railMenu && runtime.railMenu.parentNode) runtime.railMenu.parentNode.removeChild(runtime.railMenu)
            runtime.railMenu = null
            runtime.railOpen = false
            // In slot mode the seat belongs to React: drop only our button above
            // and leave the element itself to the framework.
            if (tempSlotMode !== 'slot' && tempSlot && tempSlot.parentNode) tempSlot.parentNode.removeChild(tempSlot)
            tempButton = null
            tempSlot = null
            tempSlotMode = ''
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
            // 1.1.5 — the favorites group and its generated title-star rules
            // belong to this run. A hot reload must not leave a dead group
            // holding stale click handlers over the host's list.
            if (favoriteGroup && favoriteGroup.parentNode) favoriteGroup.parentNode.removeChild(favoriteGroup)
            favoriteGroup = null
            favoriteSignature = ''
            if (typeof favoriteActionDisposer === 'function') {
              try { favoriteActionDisposer() } catch (error) { void error }
              favoriteActionDisposer = null
            }
            if (favoriteArchiveListener && document && typeof document.removeEventListener === 'function') {
              document.removeEventListener('click', favoriteArchiveListener, true)
              favoriteArchiveListener = null
            }
            if (favoriteArchiveTimer) {
              try { clearTimeout(favoriteArchiveTimer) } catch (error) { void error }
              favoriteArchiveTimer = null
            }
            favoriteSubscribers.length = 0
            var favoriteStyle = document.getElementById(FAVORITES_STYLE_ID)
            if (favoriteStyle && favoriteStyle.parentNode) favoriteStyle.parentNode.removeChild(favoriteStyle)
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
            // 0.4.0 — the row menu lives in <body> and its document listeners
            // outlive the sidebar if they are not dropped explicitly.
            closeTempMenu(false)
            detachTempMenuDismiss()
            if (tempMenuUnmount) { tempMenuUnmount(); tempMenuUnmount = null }
            tempRowMenu = null
            tempMenuRow = null
          } catch (error) {
            void error
          }
          try {
            if (runtime.bar && runtime.bar.parentNode) runtime.bar.parentNode.removeChild(runtime.bar)
            if (runtime.pageBar && runtime.pageBar.parentNode) runtime.pageBar.parentNode.removeChild(runtime.pageBar)
            setBrandCompact(false)
            runtime.pageBar = null
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
            // Legacy flags from <= 0.4.1. Clear them if an older client run
            // left them behind; 0.5.0 never sets these itself.
            'data-dsbs-fold-ext',
            'data-dsbs-fold-ws',
            'data-dsbs-pop',
            'data-dsbs-quick',
            'data-dsbs-rail',
            'data-dsbs-railmenu',
            'data-dsbs-narrow',
            'data-dsbs-temp-solo',
            'data-dsbs-temp-style',
            'data-dsbs-temp-mode',
            'data-dsbs-temp-off',
            'data-dsbs-ptab',
            'data-dsbs-page',
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
          runtime.pageLayout = null
          runtime.pageReady = false
          runtime.pageUnsubscribe = null
          runtime.pagePanelDisposer = null
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

