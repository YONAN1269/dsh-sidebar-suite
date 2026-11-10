# 更新日志 / Changelog

> 版本号以 npm registry **实际发布记录**为准（当前：`0.0.0-stage`、`0.1.3`、`0.2.4`、`0.2.5`、`0.2.6`、`0.2.7`）。
> `0.2.0`、`0.2.1`、`0.2.2`、`0.2.3` 是开发过程中的本地迭代号，**从未单独发布**；它们的功能一次性随 `0.2.4` 上线，所以在下面合并记录。
>
> Versions mirror the npm registry. `0.2.0`–`0.2.3` were local iteration numbers that were never published on their own; all of their features shipped together in `0.2.4`.

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
