# 侧栏布局大师 · Sidebar Suite

[![npm downloads](https://img.shields.io/npm/dm/dsh-sidebar-suite)](https://www.npmjs.com/package/dsh-sidebar-suite) [![GitHub Release downloads](https://img.shields.io/github/downloads/YONAN1269/dsh-sidebar-suite/total?label=GitHub%20Release%20downloads)](https://github.com/YONAN1269/dsh-sidebar-suite/releases)

> 两个数字不是一回事：左边是 **npm 近 30 天安装量**；右边是 **GitHub Release 附件的下载总数** —— GitHub 只统计这个，`git clone` 和 npm 安装都不计入。附件是 2026-11-10 才补齐的，所以右边从 0 开始，每有一次真实下载才 +1。
> The left badge counts npm installs (last 30 days); the right one counts downloads of **attached release files only** — clones and npm installs are not included. Assets were first attached on 2026-11-10, so that number starts at zero.

> 让左侧栏从「抢地盘」变成「听你的」。标签页 / 浮层 / 官方默认三种布局、一键切换、零改动宿主结构，默认布局在插件详情页顶部直接改。
> Tame the DSH sidebar: three layouts, one click, zero DOM rewrites — set your startup default right at the top of the plugin page.

**中文**：DSH 左侧栏把「扩展面板」和「工作区」堆在同一列，互相抢高度。本项目提供两种改写方案（标签页 / 浮层）与一个随时可退回的「官方默认」，并带来一个中英双语、带图形化设置的详情页。
**English**: The panels group and the workspaces group compete for the same vertical space. This bundle offers three layouts for them and ships a bilingual detail page with a graphical settings picker.

详情页长文档见 [DETAIL.md](DETAIL.md)（中英双语 / bilingual, 含收款码 / includes the payment QR）。
The full detail document is [DETAIL.md](DETAIL.md).

**一步步照着用**：[使用说明.md](使用说明.md) —— 安装、布局说明、临时会话、配置文件逐行说明、常见故障与反馈，中英双语随包附带（0.2.5 起）。
**Step-by-step guide**: [使用说明.md](使用说明.md) — install, layouts, temp sessions, every config line, troubleshooting and feedback; shipped inside the npm package since 0.2.5.

## 这是一款什么插件 / What this plugin is

**这是一款专门针对改进 DSH 左侧栏体验的插件。** 不碰会话内容、不换模型、不做独立面板、不接云端服务 —— 只把左侧栏「找得到、切得快、看着顺」这一件事做透。
**This is a plugin dedicated to improving the DSH sidebar experience.** It touches nothing but the left strip: no model swapping, no extra dashboard, no server calls.

| 设计取向 / Design goal | 落在哪 / What it means |
| --- | --- |
| **强实用性 / Seriously practical** | 三种布局（含官方默认）一键切换、默认布局在详情页顶部直接改、会话列表默认全展开（不用再点「展开其余」）、「临时」开真会话且**默认在退出 DSH 时删除**（`DELETE_ON_EXIT=on`；**每天定时清理默认关**，需要时在详情页开启并设时间）、**临时会话可右键「保留为正式会话」或「立即删除」**（0.4.0）、详情页三种反馈入口 |
| **美观性 / Looks native** | 颜色与层级全取宿主设计变量、深浅主题自动跟随；细字号控制栏、迷你布局示意图、「临时」用 CSS 标签不破坏行高；不重构宿主 DOM、不弹窗、不另起一套皮肤 |

完整的「强实用性 / 美观性」逐条说明见 [DETAIL.md](DETAIL.md) 的「这是一款什么插件」一节。
The point-by-point list of both design goals is in the "What this plugin is" section of [DETAIL.md](DETAIL.md).

## 反馈 / Feedback

遇到问题、想加功能，或者只是觉得哪块不好用，都欢迎。**四个入口，任选一个**：

| 想做什么 | 去哪 |
| --- | --- |
| 报一个问题 / 提一个想法 | [新建 issue](https://github.com/YONAN1269/dsh-sidebar-suite/issues/new/choose)（作者默认能收到） |
| 聊用法、问问题、看别人怎么用 | [Discussions](https://github.com/YONAN1269/dsh-sidebar-suite/discussions) |
| **在插件市场里留言** | [本插件的市场评论区](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/discussions?discussions_q=%22plugin%3AYONAN1269%2Fdsh-sidebar-suite%22) —— `dsh-market` 给每个插件规定的反馈入口，插件卡片上的「评论」打开的就是这一条 |
| 不想开 GitHub，或者网速不好 | **插件详情页最下面的「反馈」框**：写一句 → 点「复制反馈内容」→ 粘到任何能联系到我的地方 |

详情页的「反馈」框有三个按钮：**复制反馈内容**、**在 GitHub 提 issue**、**插件市场评论区**。报告会自动打包 **插件版本、DSH 客户端版本、系统、当前布局、临时按钮模式、临时会话数、后端路由数、最近一次清理结果、最近一次错误**，省掉「你是什么环境」这一轮往返。

> DSH 宿主本身**没有**给第三方插件规定反馈字段（核对过 `app.asar` 的插件管理详情页：不读取 `bugs`、也没有反馈按钮）；`package.json` 里的 `bugs.url` 是 npm 的标准字段，只给工具/网页用。真正由「插件市场」规定的是 `dsh-market` 的评论区，所以本插件把它接进了详情页，而不是再自造一个入口。

### 作者在哪收到 / Where the author sees it

| 用户点了什么 | 反馈落在哪 | 作者怎么收到 |
| --- | --- | --- |
| 在 GitHub 提 issue | `YONAN1269/dsh-sidebar-suite` → [Issues](https://github.com/YONAN1269/dsh-sidebar-suite/issues) | GitHub 官方说明「By default, you also automatically watch all repositories that you create and are owned by your personal account」，仓库所有者默认会收到通知。确认入口：仓库页右上角 `Watch` → `All Activity`（或 `Custom` 勾上 `Issues`）；统一看 [github.com/notifications](https://github.com/notifications) |
| 插件市场评论区 | `awesome-dsh-plugin/awesome-dsh-plugin` → Discussions，标题带 `plugin:YONAN1269/dsh-sidebar-suite` | **不在本仓库**，作者需要 watch 那个仓库或那条讨论才会收到通知。giscus 官方：「If a matching discussion cannot be found, the giscus bot will automatically create a discussion the first time someone leaves a comment or reaction.」 |
| 复制反馈内容 | 只进剪贴板 | **不会自动发送**，用户粘到微信 / QQ / 邮件才算送达 |

**第一次还没有讨论时**：上面那条市场评论区的搜索页会显示「There are no matching discussions.」。这是正常的 —— 回 DSH 的插件市场，找到 `dsh-sidebar-suite` 卡片点「评论」，giscus 会在第一条留言时自动建帖（官方原文：「If a matching discussion cannot be found, the giscus bot will automatically create a discussion the first time someone leaves a comment or reaction.」）。详情页的按钮指向的正是市场自己用的那条链接。

> Report a bug, request a feature, or just say something feels off. Use **Issues** for bugs, **Discussions** for questions, **marketplace comments** for the channel the plugin market actually defines, or the **Feedback** box on the plugin detail page, which packs your version, OS, layout and last error into copyable text.

## 布局 / Layouts

| 模式 / Mode | 中文 | English |
| --- | --- | --- |
| `b` 标签页 / Toggle（默认 / default） | 两组共用一栏，标签互斥切换。 | The groups share one space; the bar switches between them. |
| `c` 浮层 / Overlay | 工作区常驻，扩展以浮层展开。 | Workspaces stay put; panels open as an overlay. |
| `n` 官方默认 / Default | 两组都常驻，插件对布局零干预。 | Both groups stay visible — the official sidebar, with no override at all. |

> **0.5.0 移除了旧的 `a` 折叠布局**：两个独立开关能造出「空白侧栏」和「与 DSH 原生一模一样」两种无效状态，其余两态又已被 `b` 完全覆盖。旧配置里的 `mode: a` 会自动按 `n` 打开，无需手动改；`getLayout().mode` 现在只返回 `b` / `c` / `n`。The folded layout was removed in 0.5.0; old `a` configs now open in Default.

## 默认模式 / Default mode

`config.mode`（profile 的 `cordis.patch.yml`）是**启动默认**。在侧栏控制栏上临时切换只影响本次会话，不写盘、不进 `localStorage`；下次启动回到配置里的默认值。
`config.mode` in the profile patch is the **startup default**. Choosing a layout from the control bar is session-only: it is deliberately not persisted, so the next launch returns to the configured default.

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- id: dsh-sidebar-suite
  config:
    mode: b            # a = fold, b = tabs, c = overlay
    showQuickSwitch: false
```

在**插件详情页顶部的图形化设置**里改 `mode` 会通过官方 `configForms` 控制器写入，立刻成为新的启动默认，无需改文件、无需重启。其它字段（`tab`、`foldExt`、`foldWs`、`showQuickSwitch`）仍按控制栏的操作正常持久化。
Changing `mode` in the **graphical settings card pinned at the top of the plugin page** writes through the host `configForms` controller, so it becomes the startup default immediately — no file editing, no restart. The other fields still persist from the bar.

## 图形化设置页 / Graphical settings page

组合包注册了 `plugins.bundle.config` 这个 keyed slot（key = 包名），因此打开 **插件 → dsh-sidebar-suite** 会在详情页看到三张布局卡片。宿主把 `configForms` 传进来，卡片读写同一个控制器；设置区通过 `order:-1` 被提到详情页所有分区的最上方，并且只在 `[data-plugin-detail="dsh-sidebar-suite"]` 范围内生效，不会影响别的插件。
The bundle registers the `plugins.bundle.config` keyed slot. The settings section is lifted above every other detail section with `order:-1`, scoped to this bundle's own detail page only.

React 与 slots 服务都是可选依赖：任一不可用时跳过注册，侧栏控制栏照常工作。
React and the slots service are optional; if either is missing, registration is skipped and the sidebar bar keeps working.

## 收款码 / Payment QR

![微信支付收款码 / WeChat Pay QR](assets/wechat-pay.jpg)

微信「扫一扫」即可，**完全自愿、无任何回报承诺**。作者本机另外用 `dsh-tip-jar` 登记了同一个码；那份注册表属于本机配置，**不随本插件分发**。
Scan with WeChat Pay — **purely voluntary, no rewards promised**. The author also registers the same QR locally via `dsh-tip-jar`; that local registry is **not shipped with this bundle**.

## 控制栏 / Where the controls are

侧栏顶部是一条**分段控件**：三个互斥布局（标签页 / 浮层 / 官方默认）装在同一枚灰色胶囊里，选中的那个是白底高亮；右侧隔一道竖线是当前布局专用的动作按钮（换标签页、浮出面板）。0.2.9 起全部换成矢量图标，窄侧栏只留图标（悬停有文字提示），侧栏宽于 300px 时动作按钮把文字长回来。**官方默认下没有动作按钮，但胶囊始终保留** —— 否则把 `showQuickSwitch` 关掉的用户就切不回来了。
The toolbar is one segmented control: the three mutually exclusive layouts share a single pill with the active one highlighted, and the buttons that act on the chosen layout sit on the far side of a divider. Since 0.2.9 the icons are real vectors — icon-only in a narrow column (with tooltips), and the action buttons grow their labels back once the column passes 300 px. The official default has no action buttons, but the pill always stays visible so there is a way back.

`换布局 / Cycle` 默认不出现，可用 `showQuickSwitch: true` 打开；它和其余动作按钮一起走同一套图标。
`Cycle` stays hidden unless `showQuickSwitch: true`; it uses the same icon set as the other action buttons.

## 第三方插件接入：注册自己的页签 / Third-party tabs（0.3.0）

别的插件可以往侧栏注册一页自己的界面。客户端会拿到一个 `sidebarSuite` 服务：

Any other plugin can put its own page in the sidebar through one client service.

```js
// 在消费方插件里 / in the consumer plugin
export const inject = ['sidebarSuite']

export function apply(ctx) {
  ctx.effect(() => ctx.sidebarSuite.registerTab({
    id: 'my-plugin',                            // 必填，[A-Za-z0-9._-]，≤48 字符
    title: { zh: '我的面板', en: 'My panel' },   // 必填，或直接给字符串
    icon: '<svg viewBox="0 0 16 16">…</svg>',   // 可选，也可以是一个 emoji
    order: 100,                                 // 可选，越小越靠左，默认 100
    mount(container, tab) {                     // 必填（别名 render）
      container.textContent = 'hello'
      return () => { /* 清理 */ }                // 可选：移除/卸载时调用
    },
  }))
}
```

- `mount` 拿到的是**一个空的普通 `<div>`**，原生 DOM、React、canvas 都行，不要求你用哪套框架。
- **首次点开才调用 `mount`**：没被打开过的页签不执行任何代码。
- 返回的清理函数在页签被移除、消费方插件卸载、DSH 退出这三种情况下都会执行。
- `registerTab` 返回它自己的 dispose 函数，所以 `ctx.effect(() => api.registerTab(...))` 就是完整写法，不用自己记着取消。
- 同一个 id 重复注册 = **热重载**，会原地替换而不是叠出两个页签。

页签出现在哪儿 / Where the page shows up：

| 布局 | 表现 |
|---|---|
| B 标签页 | 和控制栏下面那排「扩展 / 工作区」并排 |
| C 浮层、N 官方默认 | 只有插件页签进条；内置两组仍由宿主自己显示（这两种布局不是"页签"模型） |
| 没人注册 | 这排页签**完全不出现**，界面和 0.2.x 一模一样 |

选中哪一页记在 `localStorage["dsh-sidebar-suite:active-tab"]`；**再点一次当前页签就退回原来的组**（布局 C / 官方默认下这是唯一的退出口）。

服务其余方法：`unregisterTab(id)`、`getTabs()`、`activateTab(id)`、`getActiveTab()`、`subscribe(fn)`（`fn(tabs, reason, activeId)`）、`getLayout()`。

`reason` 的取值是 `register` / `unregister` / `active` / `orphan`。**点内置页签（布局 B 下的「扩展 / 工作区」）也算一次 `active`**（`activeId` 为 `null`），所以靠订阅停表、停轮询、停动画的代码不需要为内置页签另写一套判断；反过来，在两个内置组之间切换是静默的。

> 边界是刻意的：一个页签只拥有发给它的那个容器，没有能力移动或重构侧栏，也不能覆盖宿主自己的界面。
> A tab owns its container and nothing else — it cannot restructure the sidebar.

## 实现要点 / How it works

- 所有持久状态写在 `<html>` 属性上：`data-dsbs-mode`、`data-dsbs-tab`、`data-dsbs-fold-ext`、`data-dsbs-fold-ws`、`data-dsbs-pop`、`data-dsbs-quick`、`data-dsbs-rail`、`data-dsbs-narrow`。CSS 负责显隐，插件不重构宿主 DOM。All state lives in `<html>` attributes; CSS owns visibility.
- 每次 sync 都重新解析 `[data-slot="sidebar.workspaces"]` 与 `nav.panelList`，因为 React 会在切换会话时重建侧栏。Both host nodes are resolved on every sync, never cached.
- 隐藏的组用 `display:none` + `aria-hidden` + `inert`，不卸载；组内菜单先收到 `Escape`，恢复时派发 `resize` 供浮层重新测量。Hidden groups are not unmounted; open menus get an `Escape` first and a `resize` is dispatched on restore.
- 同一页面重复 apply 时只有第一个实例持有控制栏；旧客户端留下的 `[data-dsbs-bar]` 会在下次 sync 被清掉。Only one run owns the bar; stale bars from older client generations are removed.
- 官方配置服务不可用时降级到 `localStorage["dsh-sidebar-suite:state"]`，并在控制栏提示。Falls back to `localStorage` when the config service is unavailable.

## 安装 / Install

从 npm 安装 / Install from npm:

```sh
dsh plugin --profile desktop add dsh-sidebar-suite
```

本地开发时也可以把命令里的包名换成本目录路径，或 `pnpm pack` 产出的 `.tgz`。
For local development, point the same command at this folder or a packed `.tgz` instead.

**离线安装包 / Offline archives**：[GitHub Releases](https://github.com/YONAN1269/dsh-sidebar-suite/releases) 的每个版本都附一个 `.zip` 源码包和一个 `.tgz` npm 安装包。把 `.tgz` 下到本机后执行 `dsh plugin --profile desktop add <本地 .tgz 的完整路径>` 就能离线安装；Release 页面会显示每个附件真实的下载次数。
Every release ships a `.zip` source archive and an npm `.tgz`; point the install command at the downloaded `.tgz` for an offline install. GitHub counts downloads of these attached files.

**已在 DSH 0.2.2-rc.2（desktop profile）真机验证 / Tested on DSH 0.2.2-rc.2 (desktop profile).**
2026-11-12 用 CDP 连上真机复核：服务发布、`[data-slot="sidebar.workspaces"]` 与 `nav.wtg9ga_panelList` 解析、控制栏 / 页签条 /「临时」按钮注入、第三方 tab 注册与懒挂载、Host 配置路由返回 200、root 子节点顺序稳定 —— **DOM 契约未变**。但 rc.2 把侧栏根节点从纵向 flex 换成了 CSS Grid（三列 `4px 264px 6px`、四行，且宿主面板被钉在 `grid-row:2` 与 `grid-row:4`），只验节点是否注入、不验几何就会漏掉布局问题：**0.4.1** 让注入节点 `grid-column:1/-1` 独占整行（修好按钮压住「工作区」标题）；**未发布的 0.4.2** 进一步把控制栏 / 页签条移出 grid、放进父级 `scrollRegion` flex 列，否则它们会被自动排到隐式行、显示在整列列表下方。`0.2.2-rc.1` 也兼容（旧 flex 根上这套定位同样成立），但已是旧版本。Verified against a live 0.2.2-rc.2 renderer: the markup contract is unchanged, but the host pins its panels to explicit grid rows, so injected header boxes must live in the flex wrapper above the grid.
本包刻意不声明 `engines.dsh`：当前 DSH 是预发布版，semver 默认规则会把常规版本范围误判为不兼容。
This bundle deliberately omits `engines.dsh`: DSH is currently a prerelease, and semver's default rules would reject any ordinary range.

组合包 patch 会自动挂载，**不要**再往 profile 的 `cordis.patch.yml` 加同名行，否则加载两次。
The bundle patch mounts the plugin; do not also add a manual mount line.

升级插件包后请完全退出并重新打开 DSH（客户端代码不热重载）；但 0.2.8 起**改配置文件或在详情页改设置都不用重启**，约 3 秒自动生效。
The client half is not hot-reloaded — fully quit and reopen DSH after installing or editing files.

## 已知限制 / Known limits

- `[data-slot="sidebar.workspaces"]` 与 `panelList` 是半稳定宿主约定，变动时插件降级而不抛错。These host contracts are semi-stable; changes degrade gracefully.
- 浮层定位依赖 `:has()`，需要 Chromium 内核。Overlay positioning needs `:has()` (Chromium-based client).
- 标签页模式整块隐藏工作区区域，区域内其它入口也一并隐藏，这是刻意的「一组一栏」设计。官方默认则相反：两组都不隐藏。Toggle hides the whole workspaces region, which is intentional; the official default hides neither group.

## 会话列表默认全部展开 / Always-expanded session list（0.2.4）

DSH 自己的会话列表每个工作区只先显示 5 条，剩下的折叠成「**展开其余 N 个会话**」按钮。装了本插件之后这个折叠已经没有意义，所以默认：

- 每次侧栏刷新都把每个工作区的会话**全部展开**：按宿主自己的按钮走，不改宿主 DOM。
- 「展开其余 N 个会话」／「收起」按钮**整块隐藏**。
- 想恢复 DSH 原来的折叠：在详情页关掉「会话默认全展开」开关即可；或把 `temp-session-config.txt` 的 **`EXPAND_ALL_SESSIONS=on` 改成 `off`**，保存后约 3 秒生效（已展开的列表要切换一次工作区才会收回去）。

依据（在 `app.asar` 里逐字核对过 `@deepseek-ai/dsh-client-ui-workspace/lib/client.js`）：文案 `sessions.expand` = `展开其余 {n} 个会话`，按钮是 `<button data-row-key="overflow:<group>">`，点一次把该组水位线抬高 5 条，全部显示后 `aria-expanded` 变为 `true` 且文案变成「收起」。

> The host folds session lists after five rows. This plugin presses the host's own overflow button until nothing is hidden, then hides that control entirely. Use the detail-page switch (or set `EXPAND_ALL_SESSIONS=off` in `temp-session-config.txt`) to restore DSH's folding. Both hot-reload in seconds, no restart.

## 临时会话 / Temporary session（0.2.0）

点「**临时**」= **在左侧栏里开一个真正的 DSH 会话**。

- **它就在左侧栏里**，和别的会话并排，可以随时切走做别的事、再切回来（多任务）。
- **用的是 DSH 原生会话窗口**：原生消息流、原生输入框、原生的工具调用/文件读写/命令执行，模型就是你当前在 DSH 里选的那个。插件不再自己画窗口，也不再自己调模型。
- 唯一的区别是**退出 DSH 时它会被删掉**。行首会有一个「**临时**」小标签，方便你一眼认出来。

### 右键：保留为正式会话 / 立即删除（0.4.0）

**在侧栏里右键任何一个带「临时」标签的会话行**，会弹出一个两项菜单：

| 选项 | 结果 |
|---|---|
| **保留为正式会话** | 它从此不算临时 —— 退出 DSH 不会删、定时清理不会碰，和普通会话完全一样 |
| **立即删除** | 当场删掉这个会话的磁盘文件，不用等退出（不可恢复） |

出现的时机与边界：

- **只对临时会话行生效**。右键普通会话时插件**完全不碰那个事件**，宿主或别的插件的右键菜单照常弹出。
- 菜单第一行是那一行的标题（太长会截断），每个选项下面有一句后果说明，避免误点「立即删除」。
- `Esc` 关闭、方向键切换、`Enter` 执行；点菜单外面、滚动、改变窗口大小都会关掉。
- 靠近屏幕右边缘或底边缘时会自动往回收，不会被切掉。

**想关掉它**：详情页的「临时会话右键菜单」开关，或把 `TEMP_ROW_MENU` 改成 `off`。如果哪天有别的插件也想接管右键，用这个开关把位置让出去即可。

> 「删不掉」时不会假装成功：文件被别的进程占用时，先把这行从列表里隐藏，并提示「下次启动再删」，而不是留一个点不开的幽灵会话。
> If a file is locked, the row is hidden and retried next launch instead of pretending the delete worked.

### 它是怎么被删掉的（说清楚，不夸大）

DSH **没有公开的「删除会话」接口**（我核对过 `app.asar`：`session/create`、`session/rename`、`workspace/archiveSession` 都有，就是没有 delete；官方界面上的「归档」只是把会话从列表里藏起来，文件还在磁盘上）。所以删除是插件自己做的，两道保险：

1. **退出时**：进程退出事件里同步删掉会话目录（`~/.dsh/sessions/<项目>/<会话ID>/`）。
2. **下次启动时**：再扫一遍上次的记录，把没删干净的补删。这是保底，所以即使用任务管理器强杀 DSH，下次打开也会清掉。

被删掉的会话在 DSH 的搜索索引里也会同步消失（`dsh-session-query-sqlite` 会按磁盘上实际存在的会话重建索引）。

**说人话的边界**：在退出之前，这个会话和普通会话一样是写在磁盘上的（否则就没法用原生窗口、也没法中途切换）。如果你要的是「连磁盘都不许写」，那只有 0.1.x 的纯内存方案能做的，代价是不在侧栏、不能多任务——你这次要的正好相反。

### 删除时机：详情页直接设（0.2.2）

插件详情页（**插件 → dsh-sidebar-suite → 最上面那张卡**）的「临时会话自动删除」区块可以图形化设置，两个开关互相独立：

- **退出 DSH 时删除**（默认开）
- **每天定时清理**（默认关）+ 一个时间选择框（`HH:MM`，本机时间，例如 `03:00`）。DSH 一直开着、几天不关，也不会越积越多。

改动**立即生效，不用重启**：卡片把值写回 `temp-session-config.txt`（只替换等号右边的值，注释和顺序原样保留），后端随即重排定时器。

**正在使用的会话不会被误删**：定时清理会跳过最近 3 分钟内有写入的会话（打开着的会话一直在写转写文件），5 分钟后再试一次。退出时的删除不受这个保护影响 —— 退出本来就是你要求清理。

### 全部设置图形化 + 配置热重载（0.2.8）

详情页最上面那张卡现在能改**全部 9 项**配置，不用再碰文本：

| 设置 | 对应键 |
| --- | --- |
| 显示「临时」按钮 | `SHOW_TEMP_BUTTON` |
| CHAT 官网模式：隐藏 / 显示 | `TEMP_IN_CHAT_MODE` |
| 按钮摆法：并排 / 独占一行 | `TEMP_BUTTON_STYLE` |
| 会话默认全展开 | `EXPAND_ALL_SESSIONS` |
| 临时会话右键菜单 | `TEMP_ROW_MENU` |
| 退出 DSH 时删除 | `DELETE_ON_EXIT` |
| 每天定时清理 + 时间 | `SCHEDULE_DELETE` / `SCHEDULE_TIME` |
| 最多保留几个 | `MAX_KEPT` |
| 立即清理临时会话 | 手动触发 `purge` |

两条路写的是同一个文件：详情页开关按行替换（注释、空行、顺序原样保留），Host 半用 `mtime + size` 感知外部改动并递增 `configRevision`；客户端每 2.5–3 秒轮询一次，看到新版本就原地重应用。所以**记事本改完保存，约 3 秒自动生效，不用重启 DSH**；反过来 UI 保存前也会先重新读文件，不会把刚手改的其它行覆盖掉。卡片底部会显示当前的「设置版本」号，方便确认有没有生效。

> 仍然需要重启的只有一件事：**升级插件包本身**（`lib/` 里的客户端代码不会热重载）。
> The only thing that still needs a restart is upgrading the plugin package itself.

### 配置（记事本可改）

`temp-session-config.txt`，只改等号右边，保存后**约 3 秒自动生效，不用重启**；详情页的开关写的是同一个文件。

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `SHOW_TEMP_BUTTON` | `on` | 是否显示「临时」按钮 |
| `TEMP_IN_CHAT_MODE` | `hide` | 装了 `dsh-deepseek-chat` 时，处于 CHAT 官网模式要不要显示按钮 |
| `TEMP_BUTTON_STYLE` | `pair` | `pair` = 和「新会话」并排；`own` = 单独占一行，完全不动「新会话」（`0.6.0` 起真正生效） |
| `EXPAND_ALL_SESSIONS` | `on` | 会话列表全部展开并隐藏「展开其余 N 个会话」；`off` = 恢复宿主折叠 |
| `TEMP_ROW_MENU` | `on` | 右键临时会话是否弹出「保留为正式会话 / 立即删除」；`off` = 不接管右键 |
| `DELETE_ON_EXIT` | `on` | 退出时删除；改 `off` 就不再删，临时会话等于普通会话 |
| `SCHEDULE_DELETE` | `off` | 每天定时清理；`on` = 到点把临时会话删掉 |
| `SCHEDULE_TIME` | `03:00` | 定时清理的时间（24 小时制 `HH:MM`，本机时间） |
| `MAX_KEPT` | `20` | 最多同时保留几个临时会话，超了先删最早的 |

### 和 dsh-deepseek-chat（CHAT / HARNESS 切换）的冲突，三个方案

那个插件在 **CHAT 官网模式**下会把侧栏和主区域换成 DeepSeek 官网网页，并且自己在侧栏顶部加了一行 CHAT/HARNESS 切换。

**0.2.0 撞到过一个真实的坑（0.2.1 已修）**：它接管侧栏之前会先「认」一遍侧栏的结构 —— 要求侧栏根节点下**正好只有 1 个 `<button>`**（就是「新会话」那一个）。0.2.0 把「临时」按钮直接插在「新会话」旁边，根节点下就成了 2 个 `<button>`，它认不出来，于是：

- 在切换器下面弹一句「**当前侧栏不兼容：顶部新会话仍使用 HARNESS**」；
- 不再接管顶部的新会话按钮。

0.2.1 的改法：「临时」按钮不直接站在根节点下，而是装进自己的一层 `<div data-dsbs-temp-slot>` 里。根节点下的 `<button>` 依旧只有 1 个，那个插件正常识别，提示消失，CHAT / HARNESS 照常切换。

万一日后还有别的插件也来数根节点的按钮，按下面三档走：

1. **默认：自动让开（推荐）**。检测到它在 CHAT 模式，插件就给 `<html>` 打标记：隐藏「临时」按钮，并把所有缩窄「新会话」的 CSS 全部失效，那一行完整还给官网侧栏；切回 HARNESS 自动恢复。
2. **还是挤**：把 `TEMP_BUTTON_STYLE` 改成 `own`。这时「临时」按钮自己单独占一行，**完全不改「新会话」的宽度和高度**，零侵入，和任何改侧栏顶部的插件都不会抢位置。
   > `0.6.0` 之前这个选项其实是失效的：宿主一直在下发 `own`，客户端却把标记写成了布尔值，样式规则等的是 `own` 这个字符串，两者对不上，所以切过去没反应。现在修好了；`0.6.0` 起并排模式也不再改宿主的宽度，只是排在它旁边。
3. **最省心**：如果你基本不用 CHAT 官网模式，直接在插件管理里把 `dsh-deepseek-chat` 关掉。

另外要说明：**CHAT 官网模式和 HARNESS 是两条链路**（一个是 DeepSeek 网页账号，一个是 DSH 本地会话）。临时会话现在是 DSH 会话，所以在 CHAT 模式下它本来就该让位——这不是 bug，是两个东西不该同时占同一块地方。

### 历史修复（现在都不需要了）

0.1.5 的「没识别出文本块」、0.1.6 的「没有模型」、0.1.7 的 `HTTP 404 · not found`，根因都出在「插件自己调宿主模型、自己注册路由」这条路上。0.2.0 不再自己调模型（临时会话直接用原生会话的模型与工具），路由也只剩「记录/删除」这一件事，那一整类问题随之消失。
