# 侧栏布局大师 · Sidebar Suite

> 让左侧栏从「抢地盘」变成「听你的」。三种布局、一键切换、零改动宿主结构，默认布局在插件详情页顶部直接改。
> Tame the DSH sidebar: three layouts, one click, zero DOM rewrites — set your startup default right at the top of the plugin page.

**中文**：DSH 左侧栏把「扩展面板」和「工作区」堆在同一列，互相抢高度。本项目提供三种布局解决这个问题，并带来一个中英双语、带图形化设置的详情页。
**English**: The panels group and the workspaces group compete for the same vertical space. This bundle offers three layouts for them and ships a bilingual detail page with a graphical settings picker.

详情页长文档见 [DETAIL.md](DETAIL.md)（中英双语 / bilingual, 含收款码 / includes the payment QR）。
The full detail document is [DETAIL.md](DETAIL.md).

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
