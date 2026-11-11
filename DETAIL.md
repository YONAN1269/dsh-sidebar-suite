# 侧栏布局大师 · Sidebar Suite

> **中文**：**这是一款专门针对改进 DSH 左侧栏体验的插件。** 左侧栏里「扩展」和「工作区」永远在抢同一块高度；装了几个插件之后，找一个入口要滚半天；项目一多，扩展就被挤没。它只解决这一处，但要把它做到**既强实用、又好看**：三种布局一键切换、**默认布局就在本页最上方**、会话列表默认全部展开、临时会话默认在退出 DSH 时删除（每天定时清理默认关，可在本页开启）；界面全程沿用宿主原生配色、圆角与间距，不另起一套皮肤。
>
> **English**: **This is a plugin dedicated to improving the DSH sidebar experience.** The panels group and the workspaces group fight for the same vertical space; once you install a few plugins, finding anything means scrolling; add more projects and the panels vanish entirely. It fixes only that one surface, but fixes it properly — **seriously practical and native-looking**: three layouts in one click, the **startup-default picker at the very top of this page**, an always-expanded session list, temp sessions deleted when DSH quits by default (daily cleanup off unless enabled), and a UI built entirely from the host's own colours, radii and spacing instead of a custom skin.

---

## 三种布局 / Three layouts

| 模式 / Mode | 中文 | English |
| --- | --- | --- |
| `a` 折叠 / Fold | 两组各自收起，想留哪块留哪块。 | Each group folds independently — keep exactly what you need. |
| `b` 标签页 / Toggle (**默认 / default**) | 两组共用一栏，用顶部按钮互斥切换，侧栏再长也不打架。 | Both groups share one space; the bar swaps between them. The sidebar stays short. |
| `c` 浮层 / Overlay | 工作区常驻，扩展以浮层盖在上面，随时展开/收起。 | Workspaces stay put; panels open as a floating layer you can show or hide. |

每张布局卡片都画了示意图，选中的那张标着「当前默认 / Current」。点一下就通过官方配置层写入，**立刻生效、下次启动照旧**。
Each card draws a small diagram of its layout, and the selected one is marked as the current default. A click writes through the official config layer — **effective immediately and on every future launch**.

## 这是一款什么插件 / What this plugin is

**定位 / Focus**：只做左侧栏。不改会话内容、不换模型、不做独立面板、不接云端服务 —— 把「找得到、切得快、看着顺」这一件事做透。
**In one line**: this is a **sidebar-experience plugin**, and nothing else. It does not touch your conversations, swap models, add a floating dashboard or call a server; it makes the one strip on the left findable, fast and calm.

### 强实用性 / Seriously practical

- **设置项置顶 / Settings first** — 图形化设置被提到详情页最上方，长说明、版本信息、组件列表都排在它后面；打开页面第一眼就能改启动默认布局。The graphical defaults are pinned above the long description, version info and component list.
- **会话与默认分离 / Session ≠ default** — 侧栏上临时换布局只影响本次会话，不写盘；只有详情页的设置会改默认值。Switching from the sidebar bar is session-only; only this page changes the startup default.
- **零侵入 / Zero rewrites** — 只往 `<html>` 上写属性、加一条控制栏，绝不重构宿主 DOM，React 重绘后自动重新挂载，也不影响 `dsh-deepseek-chat` 这类别的插件。Only `<html>` attributes and one control bar; the host's markup is never restructured, everything re-resolves after React rebuilds, and other sidebar plugins keep working.
- **会话不用再点「展开其余」/ No more "Show N more"** — 会话列表默认全部展开，折叠按钮也不再显示；按宿主自己的按钮展开、不改宿主 DOM。`EXPAND_ALL_SESSIONS=off` 可恢复原样。Every session is shown and the host's overflow control is hidden, driven through the host's own button; `EXPAND_ALL_SESSIONS=off` restores DSH's folding.
- **临时会话 / Temporary session** — 点「临时」在左侧栏开一个**真正的 DSH 会话**（原生窗口、当前模型与工具链、可并行多任务），**默认在退出 DSH 时删除**；**每天定时清理默认关**，需要时在本页开启并设时间；两个开关都在本页顶部，改完立即生效。Opens a real DSH session in the sidebar with the native window and current model/toolchain; it is **deleted when DSH quits by default**, while the **optional daily cleanup is off by default** — both switches live at the top of this page.
- **反馈有确定入口 / Feedback that reaches someone** — 详情页底部三个按钮：复制报告（自动带上版本、系统、布局、最近错误）、预填的 GitHub Issue、插件市场规定的评论区。Three channels at the bottom of this page, with version, OS, layout and last error already filled in.
- **不联网 / Offline** — 收款码随插件打包由宿主本地提供，配置只落在本机 profile。The QR ships with the bundle and is served locally; config stays in your profile.
- **中英双语 / Bilingual** — 界面文案、详情内容、设置说明全部中英对照。UI labels, this document and the settings copy are all bilingual.

### 美观性 / Looks native

- **不另起一套皮肤 / No custom skin** — 颜色、边框、文字层级全部取宿主的设计变量（`--dsw-alias-*`），深色 / 浅色主题自动跟随，侧栏里不会出现一块「外来的」色块。Colours, borders and text levels come from the host's own design tokens, so light and dark themes both look native.
- **视觉重量对齐 / Same visual weight** — 0.2.9 起控制栏换成 **28×26 的图标按钮 + 16px 矢量图标**：三个布局装进一枚圆角胶囊（选中项白底 + 1px 投影），动作按钮用 1px 竖线分隔。图标是 CSS mask（`currentColor` 上色），所以跟着宿主主题走；窄侧栏只留图标，宽于 300px 时动作按钮把文字长回来。Since 0.2.9 the bar is 28×26 icon buttons with 16 px vector glyphs: the three layouts share a rounded pill (active = light fill + 1 px shadow), and a 1 px divider separates the action buttons. The glyphs are CSS masks painted in `currentColor`, so they follow the host theme; icon-only when narrow, labelled again past 300 px.
- **看得懂的示意图 / Diagrams, not words** — 三张布局卡各画一个 36×24 的迷你侧栏示意，选中的那张标「当前默认」，不用读说明也能分辨。Each layout card draws a 36×24 mini sidebar and marks the current default.
- **不遮挡、不闪烁 / No jumps** — 隐藏分组用 `display:none` + `aria-hidden` + `inert`，切换是纯 CSS 显隐，不卸载重建节点；浮层用 10px 圆角和柔和阴影盖在工作区上方，不把内容挤走。Pure-CSS show/hide, no unmounting; the overlay uses a 10 px radius and a soft shadow.
- **标记不破坏行高 / Unobtrusive badges** — 「临时」标签由 CSS `::after` 画在会话行上，不插入新节点，行高、缩进、悬停态跟原生会话完全一致。The TEMP badge is a CSS pseudo-element, so rows keep their native height, indent and hover state.
- **克制 / Restrained** — 没有弹窗、没有引导蒙层、没有独立设置窗口；新增内容只收在侧栏顶部一排按钮和本页原有的卡片里。No popups, no onboarding overlay, no separate settings window.

## 支持作者 / Support the author

如果这个插件让你每天少滚几次侧栏，欢迎请作者喝杯咖啡 —— **完全自愿，无任何回报承诺，也没有付费墙**。
If this plugin saves you a few scrolls every day, you can buy the author a coffee. **Entirely voluntary, no rewards promised, no paywall.**

![微信支付收款码 / WeChat Pay QR code](assets/wechat-pay.jpg)

**微信支付 / WeChat Pay** — 打开微信「扫一扫」即可 / open WeChat → Scan.
作者本机另外把同一个码登记进了 **dsh-tip-jar 打赏罐**；那份注册表属于本机配置，**不随本插件分发**。
The author also registers the same QR locally in the **dsh-tip-jar** sponsor centre; that registry is **not shipped with this bundle**.

---

## 反馈 / Feedback

插件详情页最下面有一块「反馈 · Feedback」：写一句描述，然后选三个按钮之一 ——「复制反馈内容」把「描述 + 环境」整段放进剪贴板；「在 GitHub 提 issue」打开一个**已填好标题和正文**的 issue 页面；「插件市场评论区」打开 `dsh-market` 规定的那条插件讨论。
The plugin detail page ends with a **Feedback** box: describe the problem, then **Copy report**, **Open an issue** (pre-filled), or **Marketplace comments** — the discussion thread the plugin market defines for this plugin.

DSH 宿主没有第三方插件的反馈字段（插件管理详情页不读 `bugs`）；`package.json` 的 `bugs.url` 是 npm 标准字段，只给工具/网页用。市场这一侧由 `dsh-market` 规定：每个插件一条 GitHub Discussion，落在公开目录仓库 `awesome-dsh-plugin/awesome-dsh-plugin`，标题带 `plugin:YONAN1269/dsh-sidebar-suite`。所以本插件直接接了这条，而不是再自造第四个入口。
DSH itself defines no feedback field for third-party bundles; the market's `dsh-market` does: one GitHub Discussion per plugin in the public catalog repository, keyed on `plugin:<owner/repo>`.

自动带上的环境信息：插件版本（读自 `package.json`）、DSH 桌面客户端版本、Node / Electron、操作系统与位数、当前默认布局、临时按钮模式、临时会话数、后端路由条数、最近一次清理结果、最近一次错误。
The report always carries: plugin version (read from `package.json`, so it cannot drift from the code you run), desktop client version, Node / Electron, OS and arch, current layout, Temp-button mode, tracked session count, registered route count, the last cleanup result and the last error.

- 草稿存在浏览器本地 `localStorage` 的 `dsh-sidebar-suite:feedback-draft`，关掉页面再回来还在。 / The draft lives in `localStorage`, so closing the page does not lose it.
- 用不了 GitHub 就走剪贴板 —— 粘到任何能联系到作者的地方即可（**复制不会自动发送**）。 / No GitHub account? The clipboard path works with any channel; copied text is never sent automatically.
- **作者在哪收到 / Where the author sees it**：issue 进本仓库 [Issues](https://github.com/YONAN1269/dsh-sidebar-suite/issues)（仓库所有者默认自动 watch，会收到通知；也可在仓库页 `Watch` → `All Activity` 确认）；市场评论进 [目录仓库的 Discussions](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/discussions?discussions_q=%22plugin%3AYONAN1269%2Fdsh-sidebar-suite%22)（**不在本仓库**，作者需要 watch 那条讨论）；统一收件箱 [github.com/notifications](https://github.com/notifications)。
- 市场评论区第一次打开可能显示「There are no matching discussions.」——说明还没人留言；回 DSH 插件市场点该插件卡片的「评论」，第一条留言会自动建帖。 / If the marketplace thread is empty, press "评论 / Comments" on the plugin card inside the market — the first comment creates the discussion.
- 直接开网页：[Issues](https://github.com/YONAN1269/dsh-sidebar-suite/issues/new/choose)（问题）、[Discussions](https://github.com/YONAN1269/dsh-sidebar-suite/discussions)（用法讨论）。

---

## 控制栏在哪 / Where the controls are

侧栏顶部是一条分段控件：`[折叠 | 标签页 | 浮层] │ 动作按钮`。前三个互斥，装在同一枚胶囊里，选中的那个白底高亮；竖线右边是当前布局专用的动作按钮（展开/折叠扩展、显示工作区、换标签页、浮出面板）。
The toolbar is one segmented control: `[fold | tabs | overlay] │ actions`. The first three are mutually exclusive inside a single pill with the active one highlighted; right of the divider sit the buttons that act on the chosen layout.

`换布局 / Cycle` 默认不出现（`showQuickSwitch`），打开后和其它动作按钮共用同一套图标。`Cycle` is off by default and shares the icon set when enabled.

## 第三方页签 / Third-party tabs（0.3.0）

侧栏从 0.3.0 起是一个**可插拔的页容器**：别的插件通过 `ctx.sidebarSuite` 注册自己的页，用户点一下就能在你的界面和你自己的界面之间切换。

```js
export const inject = ['sidebarSuite']

export function apply(ctx) {
  ctx.effect(() => ctx.sidebarSuite.registerTab({
    id: 'my-plugin',
    title: { zh: '我的面板', en: 'My panel' },
    icon: '<svg viewBox="0 0 16 16">…</svg>',   // 或一个 emoji
    order: 100,
    mount(container, tab) {
      container.textContent = 'hello'
      return () => { /* 清理 */ }
    },
  }))
}
```

设计取舍 / Why it looks like this：

- **给 DOM 容器，不给 React 组件** — 消费方可以是任何技术栈写的插件，不必和本插件的 React 版本对齐。A plain container works for every consumer regardless of framework.
- **懒挂载** — `mount` 只在页签第一次被打开时执行，没打开过的页签不跑任何代码。Mount runs on first activation only.
- **`registerTab` 返回自己的 dispose** — 正好是 `ctx.effect` 要的形状，消费方不用自己维护注销；消费方卸载时页签自动消失。The returned disposer plugs straight into `ctx.effect`.
- **同 id 重注册 = 原地替换** — 客户端热重载会重复注册，替换能保证只有一个页签。Re-registering an id replaces in place, which is what a hot client reload needs.
- **失败只烂在自己那一页** — `mount` 抛异常时，错误写进它自己的容器并 `console.error` 一次，侧栏其余部分不受影响。A throwing consumer is contained inside its own page.
- **进不去的边界** — 页签只拿到发给它的容器，没有能力移动、覆盖或重构宿主 DOM。A tab owns its container and nothing else.

三种布局的差异 / Under the three layouts：

- B 标签页：`[扩展][工作区][你的页…]` 并排，都是页。
- A 折叠、C 浮层：**只有第三方页**进条；内置两组仍由原按钮控制，因为这两种布局不是页签模型。
- 没有任何第三方注册：页签条本身带 `hidden`，不占高度、不参与布局，看到的和 0.2.x 一模一样（只是多一个隐藏的空容器）。With no consumer the strip carries `hidden`: zero height, no layout impact — visually identical to 0.2.x.

选中态存 `localStorage["dsh-sidebar-suite:active-tab"]`，不写插件配置；再点当前页签退回原来的组。

## 安装与生效 / Install & apply

```sh
dsh plugin --profile desktop add dsh-sidebar-suite
```

本地开发可把包名换成本目录路径或 `.tgz` 安装包。已在 **DSH 0.2.2-rc.1（desktop profile）** 验证。
For local development, point the same command at this folder or a packed `.tgz`. Tested on **DSH 0.2.2-rc.1 (desktop profile)**.

**升级插件包后仍需重启 / Upgrading the plugin package still needs a restart** — 安装新版或改 `lib/` 下的代码后，请完全退出并重新打开 DSH（客户端代码不热重载）。**但改配置不用重启**：0.2.8 起 `temp-session-config.txt` 的改动、以及详情页的任何开关，都在约 3 秒内原地生效。 / Config edits are the exception: from 0.2.8 they hot-reload in place within seconds.

> 组合包自带的 `cordis.patch.yml` 会自动挂载，不要再往 profile 的 `cordis.patch.yml` 里加同名行，否则会加载两次。
> The bundle patch mounts the plugin automatically; do not add a manual mount line or it loads twice.

## 已知限制 / Known limits

- `[data-slot="sidebar.workspaces"]` 与 `panelList` 是宿主的半稳定约定；若宿主改版，插件会退化成「有控制栏但无效果」而不是抛错。These host markup contracts are semi-stable; a host change degrades gracefully instead of throwing.
- 浮层定位依赖 `:has()`，需要 Chromium 内核（DSH 桌面端即是）。Overlay positioning uses `:has()`, so it needs a Chromium-based client.
- 标签页模式会整块隐藏工作区区域，里面的其它入口也一并隐藏 —— 这是「一组一栏」的刻意设计。Toggle mode hides the whole workspaces region, including anything else the host renders inside it.

## 临时会话 / Temporary session（0.2.0）

> **默认行为 / Defaults**：`DELETE_ON_EXIT=on` —— 临时会话**默认在退出 DSH 时删除**；`SCHEDULE_DELETE=off` —— **每天定时清理默认关**，只有你在详情页打开它并设了时间才会按天清理。两项互不影响，可以同时开。
> **Defaults**: temp sessions are **deleted when DSH quits by default**; **daily cleanup is off by default** and only runs after you enable it and pick a time. The two switches are independent.

「临时」按钮创建的**是一个真正的 DSH 会话**，因此：在左侧栏可见、用原生会话窗口、继承当前模型和工具链、可以随意切换任务；只有「退出即删除」这一点是插件加的。

实现路径（全部在 `app.asar` 0.2.2-rc.1 上核实）：

- **创建**：Client 半调用 `ctx.get('uiWorkspace').createNamed({ workspaceId })` 再 `openSession(id)` —— 与宿主「新会话」按钮同一条链路（`dsh-client-ui-workspace` 的 `createInWorkspace` → `sessions.create` → `session/create`）。不传 `sessionId`，所以不会复用你已有的空白会话。
- **标记**：把会话 id POST 给 Host 半，写进 `~/.dsh/dsh-sidebar-suite/temp-sessions.json`；侧栏行按 `data-row-key="session:<id>"` 打 `data-dsbs-temp-row` 属性，用 CSS `::after` 画「临时」标签（只加属性、不加节点，React 重渲染不会弄丢）。
- **删除**：Host 半删 `~/.dsh/sessions/<项目>/<id>/` 与 `storages/session_projcache/sessions/session-<id>.json`。两道保险：`process.on('exit')` 同步删；下次启动时对残留 id 再删一遍。删除失败（文件被占用）才退回 `workspaceRegistry.archiveSession()` 先隐藏，并在下次启动重试。

**为什么必须自己删**：`dsh-api-remotes` 暴露了 `session/create`、`session/rename`、`workspace/archiveSession`、`workspace/unarchiveSession`，但**没有 session delete**；`dsh-session-query-sqlite` 只在自己内部 `DELETE FROM persisted_sessions`，那是索引维护，不是用户可用的删除。所以「官方删除」并不存在。

**为什么删除是安全的**：`dsh-session-query-sqlite` 的 `_reconcile()` 会拿「磁盘上实际存在的会话」和索引行对比，多出来的行直接 `persistentDeletes`，因此删目录之后搜索索引会自愈，不会留下点不开的幽灵会话。

配置：`SHOW_TEMP_BUTTON` / `TEMP_IN_CHAT_MODE` / `TEMP_BUTTON_STYLE` / `EXPAND_ALL_SESSIONS` / `DELETE_ON_EXIT` / `SCHEDULE_DELETE` / `SCHEDULE_TIME` / `MAX_KEPT` —— **全部 8 项都能在详情页设**，用记事本改等号右边也行，保存后约 3 秒自动生效，不用重启。

**详情页设置（0.2.2）**：插件详情页顶部卡片新增「临时会话自动删除」区块 —— 「退出 DSH 时删除」和「每天定时清理 + 时间」两个独立开关。它不走 `configForms`，而是 `GET/POST /api/dsh-temp-session.config` 交给 Host 半执行，因为**只有一个数据源**：`temp-session-config.txt`。Host 半按行替换（`KEY=value` 只换 `= ` 右边），注释、空行、键顺序原样保留，用户手写的内容不会丢；缺失的键追加到末尾。保存后立即 `restartScheduler()`，无需重启。

**全部设置图形化 + 热重载（0.2.8）**：详情页新增「侧栏与临时会话」卡，把剩下的 5 个键也做成开关 / 选项按钮 / 数字框，并加了一个「立即清理临时会话」按钮。至此 `temp-session-config.txt` 里**没有任何一项**需要用户手改文本。Host 半在每次 `status` / `config` / `probe` 请求时比对文件的 `mtime + size`，变化就重解析、重排定时清理计划、递增 `configRevision`；Client 半每 2.5–3 秒轮询一次，只在版本变化时原地重应用（按钮显隐、按钮摆法、CHAT 兼容策略、会话全展开）。`saveConfig()` 写盘前也会先重新读文件，避免 UI 的一次保存覆盖掉用户刚刚手改的其它行。不用 `fs.watch`，因为编辑器保存通常是「写临时文件再改名」，且监听器会拖住宿主进程。 / Every remaining key now has a control; a stamp-based reload makes both the switches and Notepad edits live within seconds, with no restart and no lost hand edits.

**定时清理（0.2.2）的实现要点**：

- 调度器是 `setInterval(30s)` + `computeNextRun(HH:MM)`，`timer.unref()` 保证它不会把宿主进程吊住；每次 apply/保存都先 `stopScheduler()` 再重建，避免重载后出现两个定时器。
- 触发时调用 `purgeAll('scheduled', { skipActiveMs: 3min })`：**最近 3 分钟内有写入的会话跳过**（打开着的会话会持续写转写文件），并把重试时间设到 5 分钟后（`scheduled-retry`），而不是干等到明天。
- 没有可靠的「这个会话是否打开」信号可以从 bundle 里读到，所以用文件 mtime 代替：这是有意保守的选择 —— 删掉一个正在打开的会话，宿主的窗口会指向一个已经不存在的目录。
- 退出删除（`DELETE_ON_EXIT`）不受 `skipActiveMs` 保护：退出本身就是用户要求清理，而且进程马上消失，没有「下次再说」的机会。
- 两个开关互相独立，可以同时开：白天不关 DSH 的人要「每晚 3 点清」，每天关机的人要「退出即清」。

**限制 / Limits**

- 退出前会话仍写在磁盘上（原生窗口的前提）。
- 强杀 DSH 时退出钩子来不及跑，残留会话在下一次启动时删除。
- 文件被占用导致删不掉时，先归档隐藏，下一次启动再删。
- CHAT 官网模式下临时按钮默认隐藏（那条链路是 DeepSeek 网页账号，和 DSH 会话不是一回事）；`TEMP_IN_CHAT_MODE=show` 可强显，`TEMP_BUTTON_STYLE=own` 可完全避开与侧栏顶部控件的抢位。

**侧栏顶部按钮的 DOM 约束（0.2.1）**：`dsh-deepseek-chat` 的侧栏适配器（`lib/client.js` 里的 `attachSidebarAdapter`）会从 `sidebar.brand.name` 插槽往上走五层，然后要求侧栏根节点下 `<button>` 子元素**恰好 1 个**（`controls()` 里的 `buttons.length === 1 && buttons[0] === row.nextElementSibling`）。0.2.0 把「临时」按钮作为根节点的第 2 个 `<button>` 插进去，适配器直接 `return null`，于是它在切换器下渲染「当前侧栏不兼容：顶部新会话仍使用 HARNESS」并且不再接管「新会话」。0.2.1 把按钮装进 `[data-dsbs-temp-slot]`（`<div>`），根节点的 `<button>` 计数回到 1，适配器恢复。回归测试见 `_probe/chat-compat.mjs`：它从插件 bundle 里抽出真实的 `attachSidebarAdapter` 跑一遍假 DOM。

Plain English: the Temp button now creates a real DSH session (sidebar entry, native conversation window, real tools and model) and deletes it on quit — synchronously from `process.on('exit')`, plus a sweep on the next launch for anything a hard kill left behind. DSH has no public session-delete API, so the plugin removes the session directory itself and the search index reconciles on its own.
