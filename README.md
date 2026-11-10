# 侧栏布局大师 · Sidebar Suite

> 让左侧栏从「抢地盘」变成「听你的」。三种布局、一键切换、零改动宿主结构，默认布局在插件详情页顶部直接改。
> Tame the DSH sidebar: three layouts, one click, zero DOM rewrites — set your startup default right at the top of the plugin page.

**中文**：DSH 左侧栏把「扩展面板」和「工作区」堆在同一列，互相抢高度。本项目提供三种布局解决这个问题，并带来一个中英双语、带图形化设置的详情页。
**English**: The panels group and the workspaces group compete for the same vertical space. This bundle offers three layouts for them and ships a bilingual detail page with a graphical settings picker.

详情页长文档见 [DETAIL.md](DETAIL.md)（中英双语 / bilingual, 含收款码 / includes the payment QR）。
The full detail document is [DETAIL.md](DETAIL.md).

## 这是一款什么插件 / What this plugin is

**这是一款专门针对改进 DSH 左侧栏体验的插件。** 不碰会话内容、不换模型、不做独立面板、不接云端服务 —— 只把左侧栏「找得到、切得快、看着顺」这一件事做透。
**This is a plugin dedicated to improving the DSH sidebar experience.** It touches nothing but the left strip: no model swapping, no extra dashboard, no server calls.

| 设计取向 / Design goal | 落在哪 / What it means |
| --- | --- |
| **强实用性 / Seriously practical** | 三种布局一键切换、默认布局在详情页顶部直接改、会话列表默认全展开（不用再点「展开其余」）、「临时」开真会话且退出 / 每天定时自动删除、详情页三种反馈入口 |
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

## 三种布局 / Three layouts

| 模式 / Mode | 中文 | English |
| --- | --- | --- |
| `a` 折叠 / Fold | 两组各自收起。 | Each group folds on its own. |
| `b` 标签页 / Toggle（默认 / default） | 两组共用一栏，标签互斥切换。 | The groups share one space; the bar switches between them. |
| `c` 浮层 / Overlay | 工作区常驻，扩展以浮层展开。 | Workspaces stay put; panels open as an overlay. |

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

侧栏顶部一排文字按钮：`折叠 · 标签页 · 浮层 │ 显示工作区 / 展开扩展 · 换布局`。
`换布局 / Cycle` 在侧栏窄于 300px 时隐藏，可用 `showQuickSwitch: false` 彻底移除。
A single row of text buttons at the top of the sidebar. `Cycle` hides below 300 px and can be removed with `showQuickSwitch: false`.

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

**已在 DSH 0.2.2-rc.1（desktop profile）验证 / Tested on DSH 0.2.2-rc.1 (desktop profile).**
本包刻意不声明 `engines.dsh`：当前 DSH 是预发布版，semver 默认规则会把常规版本范围误判为不兼容。
This bundle deliberately omits `engines.dsh`: DSH is currently a prerelease, and semver's default rules would reject any ordinary range.

组合包 patch 会自动挂载，**不要**再往 profile 的 `cordis.patch.yml` 加同名行，否则加载两次。
The bundle patch mounts the plugin; do not also add a manual mount line.

客户端代码不热重载：安装或改动文件后请完全退出并重新打开 DSH。
The client half is not hot-reloaded — fully quit and reopen DSH after installing or editing files.

## 已知限制 / Known limits

- `[data-slot="sidebar.workspaces"]` 与 `panelList` 是半稳定宿主约定，变动时插件降级而不抛错。These host contracts are semi-stable; changes degrade gracefully.
- 浮层定位依赖 `:has()`，需要 Chromium 内核。Overlay positioning needs `:has()` (Chromium-based client).
- 标签页模式整块隐藏工作区区域，区域内其它入口也一并隐藏，这是刻意的「一组一栏」设计。Toggle hides the whole workspaces region, which is intentional.

## 会话列表默认全部展开 / Always-expanded session list（0.2.4）

DSH 自己的会话列表每个工作区只先显示 5 条，剩下的折叠成「**展开其余 N 个会话**」按钮。装了本插件之后这个折叠已经没有意义，所以默认：

- 每次侧栏刷新都把每个工作区的会话**全部展开**：按宿主自己的按钮走，不改宿主 DOM。
- 「展开其余 N 个会话」／「收起」按钮**整块隐藏**。
- 想恢复 DSH 原来的折叠：把 `temp-session-config.txt` 的 **`EXPAND_ALL_SESSIONS=on` 改成 `off`**，保存后彻底退出 DSH 再重开。

依据（在 `app.asar` 里逐字核对过 `@deepseek-ai/dsh-client-ui-workspace/lib/client.js`）：文案 `sessions.expand` = `展开其余 {n} 个会话`，按钮是 `<button data-row-key="overflow:<group>">`，点一次把该组水位线抬高 5 条，全部显示后 `aria-expanded` 变为 `true` 且文案变成「收起」。

> The host folds session lists after five rows. This plugin presses the host's own overflow button until nothing is hidden, then hides that control entirely. Set `EXPAND_ALL_SESSIONS=off` in `temp-session-config.txt` to restore DSH's folding.

## 临时会话 / Temporary session（0.2.0）

点「**临时**」= **在左侧栏里开一个真正的 DSH 会话**。

- **它就在左侧栏里**，和别的会话并排，可以随时切走做别的事、再切回来（多任务）。
- **用的是 DSH 原生会话窗口**：原生消息流、原生输入框、原生的工具调用/文件读写/命令执行，模型就是你当前在 DSH 里选的那个。插件不再自己画窗口，也不再自己调模型。
- 唯一的区别是**退出 DSH 时它会被删掉**。行首会有一个「**临时**」小标签，方便你一眼认出来。

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

### 配置（记事本可改）

`temp-session-config.txt`，只改等号右边，保存后**完全退出并重开 DSH** 生效。

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `SHOW_TEMP_BUTTON` | `on` | 是否显示「临时」按钮 |
| `TEMP_IN_CHAT_MODE` | `hide` | 装了 `dsh-deepseek-chat` 时，处于 CHAT 官网模式要不要显示按钮 |
| `TEMP_BUTTON_STYLE` | `pair` | `pair` = 和「新会话」并排；`own` = 单独占一行，完全不动「新会话」 |
| `EXPAND_ALL_SESSIONS` | `on` | 会话列表全部展开并隐藏「展开其余 N 个会话」；`off` = 恢复宿主折叠 |
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
3. **最省心**：如果你基本不用 CHAT 官网模式，直接在插件管理里把 `dsh-deepseek-chat` 关掉。

另外要说明：**CHAT 官网模式和 HARNESS 是两条链路**（一个是 DeepSeek 网页账号，一个是 DSH 本地会话）。临时会话现在是 DSH 会话，所以在 CHAT 模式下它本来就该让位——这不是 bug，是两个东西不该同时占同一块地方。

### 历史修复（现在都不需要了）

0.1.5 的「没识别出文本块」、0.1.6 的「没有模型」、0.1.7 的 `HTTP 404 · not found`，根因都出在「插件自己调宿主模型、自己注册路由」这条路上。0.2.0 不再自己调模型（临时会话直接用原生会话的模型与工具），路由也只剩「记录/删除」这一件事，那一整类问题随之消失。
