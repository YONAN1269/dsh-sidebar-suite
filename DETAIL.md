# 侧栏布局大师 · Sidebar Suite

> **中文**：左侧栏里「扩展」和「工作区」永远在抢同一块高度。装了几插件之后，找一个入口要滚半天；项目一多，扩展就被挤没。这个插件把它们理顺成三种布局，一键切换，而且**默认布局就在本页最上方**，打开详情页第一眼就能改。
>
> **English**: The panels group and the workspaces group fight for the same vertical space in the DSH sidebar. Once you install a few plugins, finding anything means scrolling; add more projects and the panels vanish entirely. Sidebar Suite gives you three clean layouts, switches them in one click, and puts the **startup-default picker at the very top of this page** — no scrolling, no YAML editing.

---

## 三种布局 / Three layouts

| 模式 / Mode | 中文 | English |
| --- | --- | --- |
| `a` 折叠 / Fold | 两组各自收起，想留哪块留哪块。 | Each group folds independently — keep exactly what you need. |
| `b` 标签页 / Toggle (**默认 / default**) | 两组共用一栏，用顶部按钮互斥切换，侧栏再长也不打架。 | Both groups share one space; the bar swaps between them. The sidebar stays short. |
| `c` 浮层 / Overlay | 工作区常驻，扩展以浮层盖在上面，随时展开/收起。 | Workspaces stay put; panels open as a floating layer you can show or hide. |

每张布局卡片都画了示意图，选中的那张标着「当前默认 / Current」。点一下就通过官方配置层写入，**立刻生效、下次启动照旧**。
Each card draws a small diagram of its layout, and the selected one is marked as the current default. A click writes through the official config layer — **effective immediately and on every future launch**.

## 为什么好用 / Why you'll like it

- **设置项置顶 / Settings first** — 图形化设置被提到详情页最上方，长说明、版本信息、组件列表都排在它后面。The graphical defaults are pinned above the long description, version info and component list.
- **会话与默认分离 / Session ≠ default** — 侧栏上临时换布局只影响本次会话，不写盘；只有详情页的设置会改默认值。Switching from the sidebar bar is session-only; only this page changes the startup default.
- **零侵入 / Zero rewrites** — 只往 `<html>` 上写属性、加一条控制栏，绝不重构宿主 DOM，React 重绘后自动重新挂载。Only `<html>` attributes and one control bar; the host's markup is never restructured, and everything re-resolves after React rebuilds.
- **中英双语 / Bilingual** — 界面文案、详情内容、设置说明全部中英对照。UI labels, this document and the settings copy are all bilingual.
- **不联网 / Offline** — 收款码随插件打包由宿主本地提供，配置只落在本机 profile。The QR ships with the bundle and is served locally; config stays in your profile.

## 支持作者 / Support the author

如果这个插件让你每天少滚几次侧栏，欢迎请作者喝杯咖啡 —— **完全自愿，无任何回报承诺，也没有付费墙**。
If this plugin saves you a few scrolls every day, you can buy the author a coffee. **Entirely voluntary, no rewards promised, no paywall.**

![微信支付收款码 / WeChat Pay QR code](assets/wechat-pay.jpg)

**微信支付 / WeChat Pay** — 打开微信「扫一扫」即可 / open WeChat → Scan.
作者本机另外把同一个码登记进了 **dsh-tip-jar 打赏罐**；那份注册表属于本机配置，**不随本插件分发**。
The author also registers the same QR locally in the **dsh-tip-jar** sponsor centre; that registry is **not shipped with this bundle**.

---

## 控制栏在哪 / Where the controls are

侧栏顶部一排文字按钮：`折叠 · 标签页 · 浮层 │ 显示工作区 / 展开扩展 · 换布局`。
A single row of text buttons sits at the top of the sidebar. `换布局 / Cycle` is hidden below 300 px and can be turned off with `showQuickSwitch: false`.

## 安装与生效 / Install & apply

```sh
dsh plugin --profile desktop add dsh-sidebar-suite
```

本地开发可把包名换成本目录路径或 `.tgz` 安装包。已在 **DSH 0.2.2-rc.1（desktop profile）** 验证。
For local development, point the same command at this folder or a packed `.tgz`. Tested on **DSH 0.2.2-rc.1 (desktop profile)**.

**客户端代码不会热重载 / the client half is not hot-reloaded** — 安装或改动文件后请完全退出并重新打开 DSH / fully quit and reopen DSH after installing or editing files.

> 组合包自带的 `cordis.patch.yml` 会自动挂载，不要再往 profile 的 `cordis.patch.yml` 里加同名行，否则会加载两次。
> The bundle patch mounts the plugin automatically; do not add a manual mount line or it loads twice.

## 已知限制 / Known limits

- `[data-slot="sidebar.workspaces"]` 与 `panelList` 是宿主的半稳定约定；若宿主改版，插件会退化成「有控制栏但无效果」而不是抛错。These host markup contracts are semi-stable; a host change degrades gracefully instead of throwing.
- 浮层定位依赖 `:has()`，需要 Chromium 内核（DSH 桌面端即是）。Overlay positioning uses `:has()`, so it needs a Chromium-based client.
- 标签页模式会整块隐藏工作区区域，里面的其它入口也一并隐藏 —— 这是「一组一栏」的刻意设计。Toggle mode hides the whole workspaces region, including anything else the host renders inside it.
