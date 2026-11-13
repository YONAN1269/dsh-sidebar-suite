# 更新日志 / Changelog

> 版本号以 npm registry **实际发布记录**为准（当前：`0.0.0-stage`、`0.1.3`、`0.2.4`、`0.2.5`、`0.2.6`、`0.2.7`、`0.2.8`、`0.2.9`、`0.3.0`、`0.4.0`、`0.4.1`、`0.5.0`、`0.5.1`）。
> ⚠️ **`0.3.0` 已弃用 / deprecated**：它会让 DSH 卡在 `Loading plugins…` 且主窗口不显示（见 0.4.0 章节「修复启动死循环」）。请升级到 `0.5.0` 或更高版本。`0.3.0` hangs DSH on the loading screen; upgrade to 0.5.0 or later.
> `0.2.0`、`0.2.1`、`0.2.2`、`0.2.3` 是开发过程中的本地迭代号，**从未单独发布**；它们的功能一次性随 `0.2.4` 上线，所以在下面合并记录。
>
> Versions mirror the npm registry. `0.2.0`–`0.2.3` were local iteration numbers that were never published on their own; all of their features shipped together in `0.2.4`.

---

## 未发布 / Unreleased

### 市场截图换成实拍 / Storefront screenshots are now real captures

`screenshots.json` 原本指向 `assets/screenshots/screenshot-1~3.png`，那三张是 `0.2.5` 时期的示意图，**里面画的还是 `0.5.0` 已经删掉的「折叠」布局**，跟插件现在的样子对不上。现在改为指向 `assets/real-screenshots/` 下三张真实运行截图：浮层布局、标签页布局、控制栏特写（会话标题与账号名已打码）。

- 旧的三张示意图已删除，历史留在 git 里；`package.json` 的 `files` 白名单从 `assets/screenshots/*.png` 换成 `assets/real-screenshots/*.png`。
- 体积变小：新三张合计 257 KB，原来三张 514 KB；`npm pack` 仍是 **21 个文件**，包体从约 700 KB 降到 **450 KB**。
- 现有页面不受影响：dsh.so 的详情页目前没有截图区块，这个字段是为以后接入截图的市场客户端和收录流程准备的。`screenshots.json` 的路径与文件保持一致，谁读都不会拿到 404。The field is inert today; it now points at images that actually match the current UI instead of a removed mode.

---

## 0.5.1 — 删除临时会话前先校验路径（2026-11-13）

**这次只动宿主侧（`lib/temp-session-host.mjs`）的删除路径判断**，所以**升级后要从托盘彻底退出 DSH 再重开一次**才能用上新代码。This patch only touches the host-side delete path; quit DSH from the tray and reopen once after upgrading.

> 起因是收录后收到的一条建议：删除临时会话前应当拒绝 `./..` 这类标识，并确认目标确实在会话目录内。核对后发现这不是加固建议，而是**已经存在的漏洞**，0.5.0 及更早版本都会中招。Reported after listing: reject `.`/`..` identifiers and confirm the target sits inside the sessions directory. It turned out to be a live bug, not a hardening nice-to-have.

### 安全问题 / The bug

- **`normalizeId` 的字符类允许点**：`/^[A-Za-z0-9._:-]+$/` 放行 `.`、`..`、`a..b`。随后 `join(root, workspace, '..')` 在路径层折叠成**工作区目录本身**，`rm -r` 就删掉了该工作区下的**全部会话**。
- **真正的触发面不是网页，而是存储文件**：`?sessionId=..` 这条路由要求 id 在临时集合里（`not a temporary session`），单靠它删不掉东西；但 `temp-sessions.json` 是明文 JSON，一旦里面出现 `..`（手改、旧版本写坏、别的工具写错），**启动清理和退出清理会照单全收**，每个工作区被删一遍。The store file, not the route, is the real attack surface.
- **实测确认**：新增的 `tests/test_037.mjs` 在已发布的 `0.5.0` 包上跑，16 项里 **8 项失败**，其中「启动清理保留 ws-a / ws-b 的普通会话」两条直接失败——两个工作区的会话目录全被删掉；换成 0.5.1 全过。

### 修法 / What changed

- **id 层直接拒绝**：`isUnsafeId` 把 `.`、`..`、`...` 以及任何含 `..` 的字符串判为非法，`normalizeId` 先过这道再走字符类。正常 id 是 `session-<uuid>`，不需要点号连写，拒绝它们零成本。Reject dot-runs before building any path.
- **路径层再校验一次**（`safeSessionDir`）：目标必须是 `<sessions>/<工作区>/<id>` **正好两层**，`relative()` 不得以 `..` 开头；工作区名本身也不能含分隔符或 `..`；再用 `realpath` 确认解析后的真实路径仍在真实的 sessions 根内——这一条同时挡住大小写、短文件名、junction 之类的花样。
- **不跟随符号链接**：目标用 `lstat` 必须是真目录，symlink 一律跳过，避免 `rm -r` 顺着链接删到别处。
- **三处删除全部走同一个闸门**：`sessionDirsSync`（谁算「存在」）、`removeSession` / `removeSessionSync`（真删）现在都只接受 `safeSessionDir` 的返回值；`removeSession*` 对非法 id 直接返回 0，连投影缓存都不碰。
- **坏 id 不会被反复重试**：非法 id 在 `normalizeId` 阶段就被丢，`loadStore` 读出来即过滤，下次写回时从文件里消失。

### 验证 / Verification

- 新增 `tests/test_037.mjs`：7 种恶意 id（`..`、`.`、`%2e%2e`、`..%2f..`、`..%5c..`、`a..b`、`%2e`）必须被路由以 400 拒绝且不动磁盘；正常 id 仍能删；**投毒的存储文件不能让清理越界**；symlink 不被跟随。`npm test` 扩为 15 套全绿、`npm run check` 通过。
- `tests/test_036.mjs` 里两条写死 `0.5.0` 的版本断言改成「≥ 0.5.0」+「客户端 `VERSION` 与 package.json 一致」，否则每个补丁版都要改测试。

---

## 0.5.0 — 砍掉折叠布局、加入官方默认，并修好控制栏位置（2026-11-12）

**这次改了客户端样式表与布局状态机（`lib/client.js`）、配置 schema（`lib/index.js`）**，所以**升级后要从托盘彻底退出 DSH 再重开一次**；刷新 / 热重载不算。This release changes the injected stylesheet and the layout state machine; quit DSH from the tray and reopen once after upgrading.

> ⚠️ **破坏性变更 / Breaking**：`mode: a`（折叠）已移除，`getLayout().mode` 现在只返回 `b` / `c` / `n`，`Config.mode` 的合法值集合也变了，所以版本号跳到 `0.5.0`。旧配置里的 `mode: a` **不会报错、也不会变成另一个布局**：客户端每次读取都把它映射到新的「官方默认」`n`；`lib/index.js` 的 schema 仍保留 `a` 作为只读别名，只为让老 profile 通过校验。The removed `a` value is normalized to `n` on read.

### 布局精简 / Fewer, clearer layouts

- **砍掉第一种布局 `a` 折叠** — 它用两个独立开关控制两组，能产生 4 种状态：两组都收起 = 空白侧栏（死状态）、两组都展开 = 与 DSH 原生一模一样（「点了等于没点」），剩下「只留一组」两态又已被 `b` 标签页完全覆盖。它没有任何「有用且独有」的状态，却额外带来一套与互斥胶囊语义冲突的双开关、以及窄侧栏里只能靠单/双箭头区分的两个图标。前两轮反馈的「按钮跑到列表下方」「展开合起来回跳」也都出在这套折叠按钮上。Removed: its four toggle states held two dead states and two states already covered by layout `b`.
- **新增第三种布局 `n` 官方默认（放在胶囊最后）** — 两组都常驻，插件对布局**零干预**：既不写 CSS 隐藏规则，运行时也不隐藏任何一组。想看回 DSH 原本的侧栏，一个按钮就能退回去。Added as the last pill option: both groups stay exactly as the host drew them, with no CSS or runtime override.
- **官方默认下工具条不会消失** — 该布局没有任何动作按钮（竖线与右侧按钮自动隐藏），但**布局胶囊始终保留**。这对 `showQuickSwitch: false` 的用户尤其重要：循环按钮本来就不显示，若连胶囊一起藏掉就只剩「去详情页改配置」一条退路，等于「进去了出不来」。The pill stays visible so there is always a way back.
- **三种布局的新顺序**：`b` 标签页 → `c` 浮层 → `n` 官方默认。出厂默认仍是 `b`（插件本就是为了消除抢高度），`n` 作为随时可退回的兜底。
- **控件与字典一并清理** — 删掉 `fold-ext` / `fold-ws` 两个按钮、`fold` / `fold2` 两个图标、`data-dsbs-fold-*` 两个 html 标志、4 组中英字典键，以及 `foldExt` / `foldWs` 两个运行时状态；详情页示意图改成「两组并排常驻」。teardown 仍会清理旧版本可能残留的那两个 html 属性。
- **对三方插件的影响** — `getLayout()` 的 `mode` 取值集合变化（见上）。消费方本来就不该写 `if (layout.mode === 'a')`；`registerTab()` 拿到的容器与懒挂载行为不变，官方默认下插件页被激活时仍按既定规则接管整列（那是消费方的显式动作，不是布局覆盖）。
- **验证** — 新增 `tests/test_036.mjs`：`MODES` 顺序、无死状态、官方默认下两组都不隐藏、胶囊始终可见、动作按钮与竖线隐藏、`mode: a` → `n` 的迁移，以及「点胶囊能切回来」这条防困死断言。受影响的历史测试（`test_025` / `029` / `031` / `033`）同步更新，`npm test` 扩为 14 套。

### 顺带修好的控制栏位置（原计划的 0.4.2）

- **问题**：布局工具条（三个布局图标 + 收起箭头）出现在**整个插件列表的下方**；点右侧「收起扩展 / 收起工作区」箭头后位置还会变，展开与合起时上下跳，交互很别扭。The layout toolbar sat below the whole panel list and jumped around when a group was folded.
- **更正上一次的判断**：本条下面曾经写过「宿主折叠时把面板重挂到更深一层，`root` 变了所以控制栏被搬走」——**这个解释是错的**。解包 DSH `app.asar` 里的 `SidebarRoot.tsx` / `SidebarRoot.module.css` 后确认，宿主 JSX 结构固定，折叠分组并不会重挂 `scrollArea` 的两块面板。The earlier "re-parenting" explanation was wrong; the host JSX is stable.
- **真正的根因**：rc.2 的 `div.scrollArea` 是 CSS Grid，**四行** `grid-template-rows: 8px max-content 2px max-content`，宿主把 `nav.panelList` 显式钉在 `grid-row: 2`、`div.regionArea` 钉在 `grid-row: 4`。插件注入的节点没有指定行，只能被自动排到**隐式的新行（第 5 行及以后）**，也就是永远排在两个宿主面板之后。`0.4.1` 只补了 `grid-column:1/-1`（修好了 4px 挤压），没解决行；上一次尝试再加 `order:-30/-20/-10` 也无效 —— **`order` 无法覆盖宿主显式指定的 `grid-row`**。The host pins its panels to explicit grid rows, so unpositioned children are auto-placed after them; `order` cannot override an explicit row.
- **修法**：把控制栏与页签条**移出 grid**，放进它的父级 `div.scrollRegion`（始终是 flex 列，React 不会重建这一层）。在那里 DOM 顺序就是视觉顺序，展开（grid）与收起成图标条（宿主把 `scrollArea` 切成 flex 列）两种状态都一样。`resolveSidebar()` 新增 `scrollArea` / `headerHost` 两个解析结果，仍只匹配语义后缀、不硬编码 CSS-module 哈希。第三方 tab 的页面仍是 grid item，保留 `grid-column:1/-1` 与 4px/6px 内边距；浮层（布局 c）的定位基准同步从 `scrollArea` 改为 `scrollRegion`，否则会盖住工具条。The bar and tab strip now live in the flex header host; only a plugin page stays in the grid.
- **验证（这次是真机，不是猜）**：用独立 `--user-data-dir` 起了第二个 DSH 实例开了调试端口，**没有关闭或干扰用户正在用的窗口**。CDP 实测：`gridDisplay=grid`、`gridTemplateRows=8px 448px 2px 0px`、`navGridRow=2`、`regionGridRow=4`；修复后 `barParent=wtg9ga_scrollRegion`、`barIsGridItem=false`、工具条底边 172px 与 grid 顶边 172px 严丝合缝、`scrollRegion` 子节点顺序 `[BAR, TABS, scrollArea, scrollFade]`、`scrollArea` 里只剩宿主自己的两个面板并**未被污染**。截图确认工具条在「新会话」下方、插件列表上方，独占一行且无重叠。再依次点 `fold` / `fold2`、两组都隐藏、恢复，共 5 个状态采样，工具条父容器与 top/bottom **完全不变**。
- **回归测试**：`tests/dom-stub.mjs` 新增 `gridHost` 选项复刻真实的两层树；`tests/test_035.mjs` 重写为 23 项，专测「工具条不是 grid item、永远在滚动视口之前」；`tests/test_034.mjs` 的样式断言同步改为「只有第三方 tab 页面仍带 grid 规则」。**把 `lib/client.js` 临时回退到已发布的 0.4.1 跑同一套测试，12 项断言失败**（其中工具条被塞进 `scrollArea`、位置在列表之后），换回修复版全过。`npm test` 13 套全绿、`npm run check` 通过。

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
