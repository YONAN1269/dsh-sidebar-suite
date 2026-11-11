# 更新日志 / Changelog

> 版本号以 npm registry **实际发布记录**为准（当前：`0.0.0-stage`、`0.1.3`、`0.2.4`、`0.2.5`、`0.2.6`、`0.2.7`、`0.2.8`、`0.2.9`、`0.3.0`、`0.4.0`、`0.4.1`）。
> ⚠️ **`0.3.0` 已弃用 / deprecated**：它会让 DSH 卡在 `Loading plugins…` 且主窗口不显示（见 0.4.0 章节「修复启动死循环」）。请升级到 `0.4.1` 或更高版本。`0.3.0` hangs DSH on the loading screen; upgrade to 0.4.1 or later.
> `0.2.0`、`0.2.1`、`0.2.2`、`0.2.3` 是开发过程中的本地迭代号，**从未单独发布**；它们的功能一次性随 `0.2.4` 上线，所以在下面合并记录。
>
> Versions mirror the npm registry. `0.2.0`–`0.2.3` were local iteration numbers that were never published on their own; all of their features shipped together in `0.2.4`.

---

## 未发布 / Unreleased — 折叠分组时控制栏不再跳到列表下方（2026-11-12）

> ⚠️ **npm 上的 `0.4.1` 不含这个修复。** 以下改动目前只在本地仓库与本机 `link:` 开发版里；外部用户要等下一个发布版本。The published 0.4.1 does not contain this fix yet.

- **问题**：在布局 A 下点右侧那两个「收起扩展 / 收起工作区」箭头后，控制栏会从侧栏上方**跳到列表下方**。展开时又回到上方，来回跳，交互很别扭。The layout toolbar jumped below the list whenever a group was folded.
- **根因**：宿主折叠时会把 `nav.panelList` 与工作区容器**重挂到深一层的分组容器**里。`resolveSidebar()` 原本把「恰好包含 nav 的那一层」当 `root`，于是 `root` 在展开 / 折叠两种状态下不是同一个元素；`ensureBar()` 发现控制栏不在新 `root` 里，就把它搬进那个更深的容器（旧的兜底分支还会直接 `appendChild` 到末尾）。Folding re-parents the host panels one level deeper; the resolver picked that layer as the root, so the bar was moved into it.
- **修法**：`root` 固定为**最外层的 `scrollArea` 滚动容器**（只匹配 `scrollArea` 这个语义后缀，不硬编码 CSS-module 哈希前缀），它在各种折叠状态下都是同一个元素；控制栏恒为该 `root` 的第一个子节点，正常重绘**完全不改动 DOM**（不会重演 0.3.0 的观察器自激）。另外给控制栏 / 页签条 / 插件面板加 `order:-30/-20/-10`，即便宿主又重排了面板，这三块也始终占据最前面的视觉行；`order` 在旧版 flex 侧栏里同样生效且顺序不变。The root is pinned to the outer scroll container, the bar is always its first child, and negative `order` keeps all three injected boxes above the host panels.
- **三方插件面板的兜底**：`root` 上移到滚动容器后，宿主面板不再是它的直接子节点，`placeTabPanel()` 原来的 `appendChild` 会把插件页丢到整列末尾；现在改为紧跟在页签条 / 控制栏之后。A plugin page now stays directly under the header instead of falling to the bottom.
- **验证**：新增 `tests/test_035.mjs`（19 项），用真实 `lib/client.js` 复现「宿主把 nav 与工作区重挂进 wrapper」这一变化。**把代码临时回退到 0.4.1 跑同一套测试，6 项行为断言失败**（`bar` 被搬进 `wrapper`、索引 `0 → -1`），修复后全过；另含 20 次观察器驱动重绘不新增节点、不改变控制栏位置。`npm test` 扩为 13 套。

---

## 0.4.1 — 适配 DSH 0.2.2-rc.2 的网格侧栏 / Fit the rc.2 grid sidebar（2026-11-12）

**这次改了客户端样式表（`lib/client.js`）**，所以**升级后要托盘退出 DSH 再重开一次**；刷新 / 热重载不算。This release changes the injected stylesheet; quit DSH from the tray and reopen once after upgrading.

> ⚠️ **npm 上的 `0.4.0` 不含这个修复。** 如果你在 DSH `0.2.2-rc.2` 上看到布局按钮压住「工作区」标题，请升级到 `0.4.1`。The published 0.4.0 does not contain this fix; upgrade to 0.4.1 if the layout buttons overlap the "Workspaces" heading on DSH 0.2.2-rc.2.

- **修正下面 0.4.0 章节里「rc.2 运行时零改动」的结论**：DOM 契约（类名、`data-slot`、节点顺序）确实没变，但**布局容器变了** —— rc.2 把 `div.wtg9ga_scrollArea` 从纵向 flex 改成了 CSS Grid（真机实测列宽 `4px 264px 6px`），并把宿主的面板显式钉在第 2 列。当时只验了节点是否注入，没验几何，所以漏掉了这一层。The class names were unchanged, but the host switched its sidebar root from a flex column to a grid.
- **修复控制栏压住「工作区」标题** — 插件注入的控制栏 / 页签条 / 插件面板用默认 `grid-column:auto` 落进只有 4px 宽的第 1 列，按钮溢出后盖到宿主「工作区」标题上，右侧还留下一条孤零零的竖分隔线。现在三者统一 `grid-column:1/-1` 独占整行，并把 grid 的 4px / 6px 装饰列还原成左右内边距，与宿主「新会话」按钮对齐。`grid-column` 在旧版 flex 侧栏里是惰性属性，老宿主不受影响。Spanning every column gives each injected header its own full-width row; the property is inert on older flex roots.
- **验证** — CDP 真机 14 项验收全通过：控制栏从 4px 恢复到 274px、`scrollWidth === clientWidth`、布局按钮与「工作区」标题的重叠面积为 0、注册第三方 tab 后页签条与面板都是全宽、dispose 后无残留、root 子节点顺序不变。`tests/test_034.mjs` 扩为 20 项，新增源码与运行时样式表断言，防止以后有人删掉这条规则。全套测试与 `npm run check` 全绿。

---

## 0.4.0 — 临时会话可以「转正」或「立即删除」/ Promote or delete a temp session（2026-11-11）

**这次改了运行时代码**（`lib/client.js` 与宿主半 `lib/temp-session-host.mjs`），所以**升级后要托盘退出 DSH 再重开一次**。This release touches both halves; quit DSH from the tray and reopen once after upgrading.

- **发布后兼容性复核（2026-11-12，运行时零改动）** — DSH 升级到 `0.2.2-rc.2` 后，用 CDP 连真机复核：`sidebarSuite` 服务正常发布（`0.4.0`）、`[data-slot="sidebar.workspaces"]` 与 `nav.wtg9ga_panelList` 仍能解析出 `div.wtg9ga_scrollArea`、控制栏 / 页签条 /「临时」按钮全部注入、第三方 tab 可注册并懒挂载、订阅通知正常、`/api/dsh-temp-session.status` 返回 200 且 9 项配置齐全、root 子节点顺序多次采样不变。**新版 DSH 没有改这些半稳定约定，因此不需要改客户端代码。** 新增 `tests/test_034.mjs`（15 项）把宿主 DOM 契约固化下来，`tests/dom-stub.mjs` 的假侧栏改用 rc.2 实测类名，`npm test` 扩为 12 套。Post-release verification on DSH 0.2.2-rc.2: the host markup contract is unchanged, no runtime fix was needed, and a new regression suite now pins it.
- **⛔ 修复启动死循环（严重，0.3.0 起就有）** — 0.3.0 的页签条插在控制栏与宿主「扩展」面板之间，但 `ensureBar()` 仍要求控制栏的 `nextSibling` 就是那个面板，于是每次 `paint()` 把控制栏搬一次、`ensureTabStrip()` 又搬回来；root 的 childList 变化触发插件自己的 `MutationObserver` → `scheduleSync()` → `paint()`，微任务队列永不排空。表现是**渲染进程 100%、主窗口隐藏、停在 `Loading plugins…`，整个 DSH 打不开**。修复后位置判断改成「顺序在前」而不是「紧邻」，`ensureTabStrip()` 同理；并加了一道「同一宏任务内最多 16 次 sync」的熔断，将来任何重绘自激也不会再把应用锁死。三种布局、以及插件页签接管侧栏的场景都做了真机验收（窗口正常、CDP 秒回、root 子节点顺序 4 次采样不变、8 秒内各进程 CPU 增量 ≤ 0.17s）。**`0.3.0` 已在 npm 标记弃用，请升级到 0.4.0。** The 0.3.0 tab strip sat between the control bar and the panels nav while `ensureBar()` still demanded adjacency, so every repaint moved the bar and fired the plugin's own observer — an endless microtask loop that hid the window on "Loading plugins…". Position checks now compare order instead of adjacency, plus a per-macrotask sync cap. The published 0.3.0 is affected and has been deprecated on npm.
- **测试** — 新增 `tests/test_033.mjs`（13 项）：让 DOM 桩真的把 `MutationObserver` 回调投递回来，一次普通的宿主 DOM 变化就会复现自激。修复前 6 项失败（撞上 200 次变更上限，三种布局全部中招），修复后每次重绘 0 次 root 变更、节点顺序不变。`npm test` 链扩为 11 套。A new suite delivers observer callbacks the way a browser does; the old code spins past a 200-mutation cap, the fixed code settles on zero mutations.
- **右键临时会话行，弹出「保留为正式会话 / 立即删除」** — 之前临时会话是「要么全删，要么全留」：想留下某一个，只能去把 `DELETE_ON_EXIT` 关掉，结果**所有**临时会话都变成永久。现在单个会话可以就地处理。Right-clicking a temporary row now offers both options, so one session no longer forces a global setting.
- **只接管临时会话那一行** — 右键普通会话行时插件**完全不碰事件**（不 `preventDefault`、不 `stopPropagation`），宿主或别的插件的右键菜单照常工作。The handler never touches rows it does not own.
- **「保留为正式会话」后端零改动** — 走的是 0.2.0 就有的 `POST /api/dsh-temp-session.untrack`，只是过去没有入口。Promotion reuses the existing untrack route.
- **「立即删除」新增一个路由** — `POST /api/dsh-temp-session.remove?sessionId=…`，复用 `purgeAll` 的删除与兜底：先删目录，确认真的没了；文件被占用就先从列表隐藏（`archiveSession`），下次启动再删；**删不掉就仍然留在 tracked 里**，保证下次启动会重试，而不是悄悄变成一个点不开的幽灵。A new single-id route reuses the same delete/hide/retry ladder as the bulk cleanup.
- **这条路由只接受「临时会话」** — 命中 `state.tracked` 之外的 id 直接拒绝，且在任何文件操作之前拒绝。它能从页面调到，所以绝不能变成「按 id 删任意会话」的接口。It refuses anything outside the tracked set, before touching the filesystem.
- **菜单本身** — 顶部一行是被右键那一行的标题（截断 48 字，因为会话标题由宿主拥有），下面两个动作各带一句后果说明；靠近视口右/下边缘会自动翻转回界内；`Esc` 关闭并把焦点还给那一行、方向键在两项间移动、点菜单外 / 滚动 / 改窗口大小都会关掉。The menu echoes the row title, explains each consequence, flips near viewport edges, and closes on Esc, outside click, scroll or resize.
- **`TEMP_ROW_MENU=on` 新开关** — 万一和别的插件抢右键菜单，把它改成 `off` 即可（详情页也有同一个开关，不用手改文件）。A new switch, also exposed on the detail page, in case another plugin owns the context menu.
- **测试** — 新增 `tests/test_032.mjs`（60 项）：跑真实 `lib/client.js`，按宿主的方式造出 `data-row-key="session:<id>"` 行，然后像用户那样右键、点动作、按 Esc、点外部；覆盖「非临时行完全不被拦截」「保留后属性消失」「删除后调用正确的路由」「文件被占用时提示隐藏而非删除」「失败不吞掉」以及尺寸翻转。顺手把 DOM 桩抽成 `tests/dom-stub.mjs`，由 `test_031` 与 `test_032` 共用（`test_031` 仍是 53 项）。`npm test` 链扩为 10 套。One new suite drives the real bundle against fabricated session rows and clicks through the menu; the fake DOM is now shared by both rendering suites.

---

## 0.3.0 — 第三方插件可以注册自己的页签 / Third-party tabs（2026-11-11）

**这次改了运行时代码**（`lib/client.js`），所以**升级后要托盘退出 DSH 再重开一次**。This release touches `lib/client.js`; quit DSH from the tray and reopen once after upgrading.

- **侧栏变成可插拔的页容器** — 客户端通过 `ctx.provide('sidebarSuite', …)` 发布一个服务，别的插件 `inject = ['sidebarSuite']` 之后就能 `registerTab({ id, title, icon, order, mount })` 把自己的界面挂进侧栏。The sidebar is now a pluggable page container: a `sidebarSuite` service is published on the client context, and any plugin injecting it can register its own page.
- **给的是普通 DOM 容器，不是 React 组件** — `mount(container, tab)` 拿到一个空 `<div>`，原生 DOM / React / canvas 都行，消费方不必和本插件的框架版本对齐。Consumers get a plain container, so any stack works and no React version has to line up.
- **懒挂载 + 自带清理** — `mount` 只在页签第一次被打开时执行；返回的清理函数在页签移除、消费方卸载、DSH 退出时都会调用。`registerTab` 返回自己的 dispose 函数，正好能直接塞进 `ctx.effect`。Mount runs on first activation, and the returned disposer plugs straight into `ctx.effect`.
- **同 id 重注册 = 原地替换** — 客户端热重载会重复注册，替换保证不会叠出两个同名页签，且旧页签的清理函数先跑。Re-registering an id replaces in place, which is what a hot reload needs.
- **失败只烂在自己那一页** — `mount` 抛异常时错误写进它自己的容器并 `console.error` 一次，侧栏其余部分照常工作。A throwing consumer is contained inside its own page.
- **页签条按布局出现** — 布局 B 下是 `[扩展][工作区][插件页…]` 并排；布局 A / C 下只有插件页进条（内置两组仍由原按钮控制，那两种布局不是页签模型）。**一个消费方都没有时这排页签是 `hidden` 的，不占高度**，看到的和 0.2.9 完全一样。Layout B lists the built-in groups alongside the plugin pages; layouts A and C list plugin pages only. With no consumers the strip is `hidden`: zero height, no visual change from 0.2.9.
- **选中态是宿主主题色** — 当前页签底部一条 2px 强调色（`--dsw-alias-state-business-primary`），跟随工作区主题；窄侧栏（< 300px）自动只留图标，没给图标的页签保留文字而不是变成空白方块。The active page carries a 2 px accent underline in the workspace's theme colour; narrow columns go icon-only, and a tab without an icon keeps its label.
- **选中哪一页跟着侧栏走** — 存 `localStorage["dsh-sidebar-suite:active-tab"]`，不写插件配置；再点一次当前页签退回原来的组。The selection lives in its own storage key, and re-clicking the active page returns to the groups.
- **点了内置页签也会通知订阅者** — 布局 B 下点「扩展 / 工作区」等于把这一列从插件页手里拿走，`subscribe` 现在会像其它切换一样发出 `('active', null)`；反过来，在两个内置组之间来回切是静默的，不会假装有插件页移动。没有这一条，靠订阅停表 / 停轮询 / 停画布的消费方会以为自己还挂在屏幕上。A click on a built-in page notifies subscribers exactly like any other switch; moving between two built-ins stays silent.
- **测试** — 新增两套：`tests/test_030.mjs` 在 vm 沙箱里按消费方的方式调服务（注册、列表、激活、订阅、注销、重复注册、非法入参，外加渲染与样式的源码契约、文档与版本联动，70 项）；`tests/test_031.mjs` 自己搭了一个符合宿主契约的侧栏 DOM，跑真实 `lib/client.js`，然后像用户那样点页签、再点一次退回、切布局 A/C、注销、点内置页签看通知（53 项，含「连续 60 次重绘不新增节点」的防抖动断言——`paint()` 每次插入节点的话，它自己装的 `MutationObserver` 会把它重新触发成死循环）。`npm test` 链扩为 9 套。Two new suites: one drives the service the way a consumer would, the other runs the real bundle against a synthetic host sidebar and clicks through it, including a repaint-loop guard.

---

## 0.2.9 — 布局栏重做 + 视觉精修 / Toolbar rebuilt as a segmented control（2026-11-11）

**这次改了运行时代码**（`lib/client.js`），所以**升级后要托盘退出 DSH 再重开一次**。This release touches `lib/client.js`; quit DSH from the tray and reopen once after upgrading.

- **布局栏改成图标分段控件** — 三个互斥布局（折叠 / 标签页 / 浮层）装进同一枚圆角胶囊，选中的那个白底 + 1px 投影；当前布局专用的动作按钮隔一道竖线排在右侧。原来是一排文字按钮，宽窄都不好看。The three mutually exclusive layouts now share one rounded pill (active = light fill + 1 px shadow), with the layout-specific action buttons on the far side of a divider.
- **图标是矢量，不是拼出来的色块** — 8 个图标（布局 ×3、折叠、全部折叠、换标签页、浮出、换布局）全部改成 CSS `mask-image` 内联 SVG，用 `currentColor` 上色，所以深浅主题自动跟随，放大也不糊。原先用两个伪元素拼边框，22×8 的盒子里根本画不完整。All eight glyphs are inline-SVG masks painted in `currentColor`, so they follow the host theme and stay sharp; the old pseudo-element shapes could not fit the 22×8 box they were given.
- **修掉 0.2.8 的塌陷** — 上一版 `line-height:0` + `padding:4px 5px` 把按钮压成 **22×8**，图标被裁成几根线，右侧按钮还被挤出可视区。现在按钮固定 **28×26**、图标 16px、`padding:0`，实测在 280px 侧栏里间距正确。The 0.2.8 bar collapsed to 22×8 with clipped glyphs; buttons are now 28×26 with 16 px icons and zero padding.
- **两个折叠按钮不再长得一样** — 布局 A 下「展开扩展」和「展开工作区」并排，原来共用同一个下箭头图标，只能靠悬停提示区分。现在前者单箭头、后者双箭头。In layout A the two fold buttons sat side by side with an identical glyph; they now use a single vs. double chevron.
- **「换布局」按钮终于有图标** — 该按钮此前没有任何 glyph，开了 `showQuickSwitch` 会显示一个空白按钮。The cycle button had no glyph at all and rendered blank when enabled.
- **窄 / 宽自适应** — 窄侧栏（< 300px）只留图标、悬停显示文字；拖宽后动作按钮把文字长回来（`min-width:max-content` —— 这里不能靠 `flex:none`，宿主的按钮样式会把它压回 48px）。Icon-only below 300 px with tooltips; action buttons regain their labels when the column widens.
- **会话行** — 选中行加一条 2px 内嵌强调色竖条（取宿主 `--dsw-alias-state-business-primary`，跟着工作区主题色走），并给行加 `tabular-nums` 让时间列数字等宽。只在选中态、且不在折叠图标条里生效。The active row gets a 2 px inset accent rail in the workspace's own theme colour, and rows use tabular numerals so the time column stops jittering.
- **测试** — 新增 `tests/test_029.mjs`（源码契约：分段结构、8 个图标定义与按钮属性、尺寸、窄宽规则、强调条、版本与文档），`npm test` 链扩为 7 套。

---

## 0.2.8 — 设置全图形化 + 配置热重载 / Graphical settings & hot reload（2026-11-11）

**这次改了运行时代码**（`lib/client.js`、`lib/temp-session-host.mjs`），所以**升级后要托盘退出 DSH 再重开一次**；但从此以后改任何设置都不用再重启。

- **8 项设置全部有开关** — 详情页新增「侧栏与临时会话」卡：`SHOW_TEMP_BUTTON`、`TEMP_IN_CHAT_MODE`、`TEMP_BUTTON_STYLE`、`EXPAND_ALL_SESSIONS`、`MAX_KEPT` 做成开关 / 选项按钮 / 数字框；原有的 `DELETE_ON_EXIT`、`SCHEDULE_DELETE`、`SCHEDULE_TIME` 保持。另加「立即清理临时会话」按钮，直连已有的 `purge` 路由。Every config key now has a control; a manual purge button was added.
- **改文件免重启** — Host 半在 `status` / `config` / `probe` 请求时用 `mtime + size` 感知 `temp-session-config.txt` 的外部改动，重解析、重排定时清理计划、递增 `configRevision`；Client 半每 2.5–3 秒轮询，版本变化才原地重应用（按钮显隐、摆法、CHAT 兼容、会话全展开）。约 3 秒生效。No `fs.watch`: editors save by rename and a watcher would keep the host alive.
- **不再覆盖手改** — `saveConfig()` 写盘前先重新读文件，UI 改一项不会把用户刚在记事本里改的其它项冲掉（新增回归断言）。
- **文档口径统一** — 配置文件头、`README.md`、`DETAIL.md`、`使用说明.md`、locale 简介里所有「改文件必须彻底退出重开」的旧说明全部改为「约 3 秒自动生效，不用重启」；只有**升级插件包本身**和改 `cordis.patch.yml` 仍需重启。配置文件头仍保持 3 行，所以文档里的行号全部继续有效。
- **测试** — 新增 `tests/test_028.mjs`（真实 Host 半的热重载 / 防覆盖 / 路由 / 源码契约），`tests/test_023.mjs` 追加 0.2.8 详情页渲染与点击断言；`npm test` 链扩为 6 套。

---

## 0.2.7 — 下载数据可见 / Download counts made visible（2026-11-10）

**纯文档改动**：`lib/` 三份脚本、`locale/` 与 0.2.6 逐字一致，没有运行时变化。Docs only, no runtime changes.

- **两个下载量徽章 / Two download badges** — README 顶部挂 npm 近 30 天安装量徽章与 GitHub Release 附件下载总数徽章，并写明两者统计口径不同（GitHub 只数附件下载，clone / npm 安装不算）。Both badges link to their source pages; the difference between the two counters is explained right below them.
- **跟进市场图标 PR / Followed up on the storefront PR** — `awesome-dsh-plugin` PR #14032 的两个检查（`Submission gate` / `check`）均已 success，已在 PR 里留言请维护者合并；该 PR 只加一行 `icon:`，描述逐字保留上游最新文案。目录措辞的补充 PR 等它合并后再开，避免同一文件两个 PR 冲突。
- **每个版本都带附件 / Assets for every release** — `v0.2.7` 同样附 `.zip` + `.tgz`，与 0.2.4–0.2.6 保持一致。

---

## 0.2.6 — 默认值披露 + 可下载 Release / Default-behaviour disclosure & downloadable releases（2026-11-10）

**同样没有改运行时逻辑**：只把「临时会话默认在退出 DSH 时删除；每天定时清理默认关」这件插件目录维护者在 PR #13993 复验后要求披露的事，写进所有用户看得到的地方，并给 GitHub Release 补上可下载附件。No runtime logic changed.

- **对齐市场目录措辞 / Copy aligned with the catalog** — 目录 `data/plugins/YONAN1269__dsh-sidebar-suite.yml` 的中英描述已由维护者补上「默认在退出 DSH 时删除 / deleted when DSH exits (by default)」。本版把同一口径同步到 npm 简介、详情页头部简介（`locale/*.json`）、`DETAIL.md`、README、使用说明和详情页设置卡，不再用「退出 / 每天定时自动删除」这种容易被误读成两个开关都默认开的写法。The same default is now stated everywhere, including the settings card.
- **默认值一眼可见 / Defaults visible in the UI** — 设置卡说明直写「退出 DSH 时删除=开，每天定时清理=关 / delete on quit = on, daily cleanup = off」；`DETAIL.md` 新增「默认行为 / Defaults」段落，回归测试 `test_025` 加了断言防止以后写回去。
- **GitHub Release 补齐附件 / Downloadable release assets** — 此前 `v0.2.4` / `v0.2.5` 两个 Release 都是空附件，所以下载量一直是 0。现在每个 Release 都附 `.zip` 源码包与 npm 的 `.tgz` 安装包，Release 页面开始累计真实的附件下载次数。GitHub only counts downloads of attached assets — npm installs and clones do not show up there.
- **下载入口 / Where to download** — README 安装一节挂了 [Releases](https://github.com/YONAN1269/dsh-sidebar-suite/releases) 链接，说明 `.tgz` 可用 `dsh plugin --profile desktop add <本地路径>` 离线安装。

---

## 0.2.5 — 交付补齐 / Delivery polish（2026-11-10）

**没有改任何运行时代码**：`lib/` 下三份脚本与 0.2.4 逐字一致。这一版只补「用户拿不到 / 项目不可维护」的缺口。
No runtime changes — the three files in `lib/` are byte-for-byte identical to 0.2.4.

- **图文教程随包发布 / Guide ships in the package** — `使用说明.md`（400+ 行中英双语）加入 `package.json` 的 `files`，README 挂了链接。以前它只存在于作者本机，市场用户更新插件也看不到一个字。The 400+ line bilingual guide is now inside the npm tarball, linked from the README.
- **测试回仓 + CI / Tests in-repo + CI** — 5 套离线回归从临时工作区搬进 `tests/`，去掉硬编码绝对路径，任何机器都能跑；新增 `npm test` 一键入口和 GitHub Actions（push / PR 自动跑语法检查、JSON 解析、5 套回归、`npm pack --dry-run`）。The five offline regression suites now live in `tests/`, are machine-independent, and run on every push.
- **新文档 / New docs** — 本文件 `CHANGELOG.md`；补 `v0.2.4` / `v0.2.5` 标签与 GitHub Release。
- **市场卡片素材 / Storefront assets** — 新增 96px 方形 PNG 图标（`assets/icon-180.png`，市场规则拒收 SVG）、`screenshots.json` 与功能示意图，卡片不再回退到作者头像。A GitHub-hosted raster icon and declared screenshots (the listing refuses SVG).
- **清理 / Cleanup** — 删除本地 `dist/dsh-sidebar-suite-0.1.3.tgz` 旧构建产物（未被 Git 跟踪；npm 上的 0.1.3 历史版本随时可取回）。Removed the stale local 0.1.3 tarball.

---

## 0.2.4 — 左侧栏体验成型 / The sidebar experience（2026-11-10）

第一个包含全部 0.2.x 功能的公开发行版。The first public release containing all 0.2.x work.

### 临时会话 / Temporary session（本地迭代号 0.2.0–0.2.2）
- 点「**临时**」在左侧栏开一个**真正的 DSH 原生会话**（不再是自绘窗口），可并行多任务；会话窗口、模型、消息能力与新建会话完全一致。A real native DSH session instead of a self-drawn panel.
- 退出 DSH 时自动删除；也可在详情页改成**每天定时清理**并自设时间（`SCHEDULE_DELETE` / `SCHEDULE_TIME`）。Deleted on quit, or on a user-set daily schedule.
- 活跃会话按文件修改时间跳过，避免误删正在用的会话；删不掉的会归档隐藏，5 分钟后重试。Active sessions are skipped by mtime; stubborn ones are hidden and retried.

### 兼容性 / Compatibility（0.2.1）
- 与 `dsh-deepseek-chat` 共存：该插件要求侧栏根节点下只有 1 个顶层 `<button>`，于是把「临时」按钮装进 `data-dsbs-temp-slot`，不再触发「当前侧栏不兼容」。Wrapped the Temp button in a slot so the CHAT adapter still recognises the sidebar.

### 反馈 / Feedback（0.2.3–0.2.4）
- 详情页「反馈」框：**在 GitHub 提 issue**（预填标题正文）、**插件市场评论区**（`plugin:YONAN1269/dsh-sidebar-suite` 讨论）、**复制反馈内容**三选一；草稿存本地；报告自动带版本、DSH 客户端版本、系统、布局、路由数、最近一次错误。Three channels, draft persistence, automatic environment block.

### 会话列表 / Session list（0.2.4）
- 会话**默认全部展开**，并隐藏宿主的「展开其余 N 个会话 / 收起」按钮；通过宿主自己的按钮驱动，不改宿主 DOM。`EXPAND_ALL_SESSIONS=off` 可恢复原折叠。Always expanded, driven through the host's own overflow button.

### 定位与文案 / Positioning（0.2.4）
- 详情页头部简介（`locale/*.json`）、长篇介绍（`DETAIL.md`）、置顶设置卡、README 与 npm 简介统一声明：**这是一款专门针对改进 DSH 左侧栏体验的插件**，并逐条写明**强实用性**与**美观性**（沿用宿主 `--dsw-alias-*` 设计变量、深浅主题自动跟随、零 DOM 重构）。

---

## 0.1.3 — 首个公开发行版 / First public release（2026-11-06）

- 三种左侧栏布局（折叠 / 标签页 / 浮层），侧栏控制栏一键切换。Three switchable sidebar layouts.
- 插件详情页顶部直接设置**启动时的默认布局**，不用改 YAML、不用重启。Graphical startup-default picker.
- 中英双语界面与文档、微信收款码、离线不联网。Bilingual UI/docs, offline by design.
- 已提交插件目录收录 PR（awesome-dsh-plugin #12903，已合并）。Listed in the plugin directory.

## 0.0.0-stage

- 早期占位版本 / Initial placeholder published while scaffolding the package.
