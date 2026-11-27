# 更新日志 / Changelog

> 版本号以 npm registry **实际发布记录**为准（当前：`0.0.0-stage`、`0.1.3`、`0.2.4`、`0.2.5`、`0.2.6`、`0.2.7`、`0.2.8`、`0.2.9`、`0.3.0`、`0.4.0`、`0.4.1`、`0.5.0`、`0.5.1`、`0.6.0`、`0.6.1`、`0.7.0`、`0.7.1`、`0.7.2`、`0.7.3`、`0.7.4`、`0.7.5`、`0.8.0`、`0.8.1`、`0.8.2`、`0.8.3`、`0.8.4`、`0.8.5`、`0.8.6`、`0.8.7`、`0.8.8`、`0.8.9`、`0.8.10`、`0.8.11`、`1.1.0`、`1.1.2`、`1.1.3`、`1.1.4`、`1.1.5`）。
> `1.0.0` 是本地稳定版基线，未单独上架 npm；它的契约与兜底改动随本次 `1.1.0` 一起发布。
> `1.1.1` 因 npm registry 的幽灵 staged 版本槽被占用（`npm stage list` 查不到该 stage，但发布返回 `409 Cannot publish over previously staged version "1.1.1"`）未实际上架；`1.1.2` 是同一批代码的正式发布号。
> ⚠️ **`0.3.0` 已弃用 / deprecated**：它会让 DSH 卡在 `Loading plugins…` 且主窗口不显示（见 0.4.0 章节「修复启动死循环」）。请升级到 `0.5.0` 或更高版本。`0.3.0` hangs DSH on the loading screen; upgrade to 0.5.0 or later.
> `0.2.0`、`0.2.1`、`0.2.2`、`0.2.3` 是开发过程中的本地迭代号，**从未单独发布**；它们的功能一次性随 `0.2.4` 上线，所以在下面合并记录。
>
> Versions mirror the npm registry. `0.2.0`–`0.2.3` were local iteration numbers that were never published on their own; all of their features shipped together in `0.2.4`.

---

## 1.1.5 — 会话收藏 + 更新检查 + 窗口置前自测（2026-11-27 发布）

这版加了侧栏收藏，另有两个详情页小改进；不改三页布局、临时会话和回收站，登录侧只做快照恢复 / 退出重试的生命周期补强。

- **会话收藏**：会话行悬浮时多一颗星，右键菜单多「收藏会话 / 取消收藏」；收藏后标题前显示金色 ★，列表顶部出现可折叠的「收藏夹」分组（带数量，按最近更新倒序，已归档会话不进组）。收藏夹行高 / 字号 / 缩进对齐宿主会话行，当前打开的收藏会高亮；收藏超过 8 条时出现搜索框，按标题实时过滤。收藏状态存在当前 profile 的 renderer `localStorage`，重启和多个窗口都保留；与 `@michengai/dsh-archive-manager` 共用它的收藏集合，archive-manager 的星存在时自动隐藏本插件的星和行内按钮，不叠两颗星。
- **检查更新**：详情页标题旁新增按钮，打开详情页时自动查一次 npm 最新版本，显示「当前 / 最新 / 已是最新」；有新版本时出现「复制更新命令」，复制内容为 `dsh plugin --profile desktop add dsh-sidebar-suite`。Host 半只向 `registry.npmjs.org` 读取版本号，不带任何本机信息；成功结果缓存 10 分钟，失败缓存 1 分钟，断网只显示一行状态，不弹错误。
- **窗口置前自测**：`focusOnLaunch` 开关旁新增「立即试一次」。点一下直接走 `POST /api/dsh-sidebar-suite.focus-window`，在开关下面显示成功 / 失败 / 当前系统不支持；打开开关时也自动试一次，不必等到下次启动。
- **测试**：新增 `tests/test_068.mjs`（48 条断言）覆盖标题星规则、收藏夹分组出现/隐藏/计数/排序、行高字号对齐、当前收藏高亮、搜索阈值与过滤、点行打开、点星移除、行内按钮、右键菜单、archive-manager 接管与回写、防双星规则，以及 archive 刷新竞态、空快照迁移、失败回滚、双击排队、wrapped workspaces 挂载、`mainReference` 兜底和键盘隔离；`test_067` 12 条 update host 断言；`test_063` 新增 A11a–A11e、A1h–A1k（拒绝 tab 写入后的界面与配置回滚，含“成功写入成为新回滚目标”）和 A12a–A12e（设置页首读 503 后由下一次轮询恢复）；`test_030` 与 `test_031` 新增旧 disposer / 旧 `tabContext.close()` 不得删除同 id 新页签的回归；`test_064` 新增 H14–H19（52 条）覆盖登录快照的失败回退、tombstone、坏文件隔离和 save/clear 时序；`test_065` 新增 R1–R4（恢复失败重试）、C8/C9（清除失败后再次清除）与 C10/C11（reload 失败与 `-2` 处理），第三批后共 36 条；同批按新口径同步调整断言的还有 `test_023`、`test_024`、`test_029`、`test_036`、`test_043`、`test_046`。`npm test` 46 个套件全绿，`npm run check` 通过。
- **审阅后的加固**：收藏侧把 archive 写入串行化、用 mutation version 丢弃过期刷新、空 archive 首读改为迁移本地收藏、失败只回滚本次点击；localStorage 只在成员真正变化时写。登录快照侧按 `savedAt` 统一比较 credential 与文件副本，clear 先写 tombstone 再删 credential，删不掉时写 credential tombstone，不能删就明确返回失败；文件写入改为先写临时文件再原子替换，坏 JSON 隔离为 `.corrupt-*`，不再先删后改名。
- **异步生命周期补强（1.1.5 第二批）**：
  - **tab 写入回滚**：`toggleTab()` 先画新布局再排队写配置，原 `setField()` 的 `previous` 取到的是乐观新值，Host 连续拒绝时会把界面回滚到“未保存的新布局”。现在单独记录最后一次确认成功的 tab（带写入序号，慢成功不覆盖新值），失败恢复到已确认值；`test_063` A1h–A1k 断言 `data-dsbs-tab` 与配置存储都回到旧值。
  - **网页登录快照**：`restored` 不再在发请求前置位；首次 load 失败会保留重试（最多 3 次、5 秒间隔），面板重挂会重置页级状态；清除失败保留 `clearPending`，下一次登录页轮询会再试，且旧清除不会误删新登录。`test_065` R1–R4、C8/C9 覆盖两条失败注入。顺带补了 `reload()` 的 rejection / loading 处理，`did-fail-load` 不再吞掉 `-2`。
  - **设置页首读**：2.5 秒轮询不再被 `loaded` 永久挡死，首读 503 后下一次 tick 继续读，并加单飞锁防止叠加请求；`test_063` A12a–A12e 验证首次失败、下一次轮询恢复。
  - **第三方页签所有权**：`unregisterTab(id, expectedRecord)` 校验当前记录；旧 disposer / 旧 `tabContext.close()` 只作用于自己注册的那条记录，热重载后不会删掉同 id 的新页签。`test_030` 与 `test_031` 覆盖两种旧句柄。
- **审阅后的第三批补强（2026-11-26）**：
  - **退出登录跨重启**：`clearPending` 原本只在 renderer 内存里，Host 路由未注册 / 超时后若用户直接退出 DSH，下一次启动仍会注回旧快照。现在发起 clear 前按页面写 `dsh-sidebar-suite:web-login-clear:chat|api`，启动 / 重挂时恢复该标记；有 pending 时 `restoreWebLogin()` 不恢复，capture 在任意路由都会重试 clear；clear 成功或新登录 save 成功才删除标记。`test_065` 新增 C12–C17（跨 runtime 重启用例与“新登录覆盖旧登出”）。
  - **窗口置前**：`window-focus-host.mjs` 不再把 `WScript.Shell.AppActivate` 的布尔值当成成功依据；`AppActivate` 后必须重新读 `GetForegroundWindow()`，仍不是目标 hwnd 时走 `SwitchToThisWindow`，等待 150ms 再复查，只有真实前台等于目标窗口才返回 `ok:true`。`test_066` 新增 F12 防止回到旧分支。
  - **设置页请求**：临时会话列表加载统一用 `tempListSeq` + `tempListInFlight` 串行化，慢 Host 下 2.5 秒轮询不会叠 list 请求，旧响应也不能覆盖新列表；普通诊断读取补 10 秒超时，并与 Recheck 共用一条 in-flight 请求。`test_063` 新增 A12f–A12h（慢 list 不叠加、悬挂诊断会武装 10 秒 watchdog）。
  - **临时会话计数**：track 明确失败时按剩余 id 重算 `tempCountKnown`；track 结果不确定但保留 id 时也同步计数，TEMP 徽标与 tooltip 不再互相矛盾。`test_058` 新增 C3。
  - **真机冷启动**：先让 WorkBuddy 占前台，再冷启动 DSH；窗口正常出现且最终前台句柄为 `3742160`（标题 `哪款AI实时语音翻译最好 — DeepSeek Harness`），新脚本没有出现“返回成功但窗口仍在后面”的假成功。
  - **回归**：`test_063` 65 条、`test_065` 36 条、`test_058` 17 条、`test_066` 13 条；`npm test` 46 个套件全绿，`npm run check` 通过；tarball 文件数与体积见下文「1.1.5 审阅后修复」末尾的实测数字。

### 1.1.5 审阅后修复

- **清除已保存登录按钮**：两个网页面板头部新增「清除已保存登录」按钮，两步确认后复用已有 `web-login-clear` 路由；此前只能在网页内主动登出来才会触发清除。本机没有已保存的登录时提示「本机没有已保存的登录。」，不再误报已清除。
- **更新命令说明**：「复制更新命令」旁补充说明——安装后需完全退出并重新打开 DSH 才生效；命令里的 `desktop` 要换成自己正在用的 profile。
- **更新检查加固**：Host 半请求不跟随重定向、限制响应体大小；版本比较区分预发布版。同时修复真机上「检查更新」必然返回 HTTP 400 的问题：`update-check` 路由注册时漏了 `requestBody: 'buffered'`，连接桥把这条 GET 当成流式路由挂上请求体，`Request` 在处理函数执行前就被拒绝；现与其余路由同形。超时保持 `AbortController` + `setTimeout`——在当前宿主上 `AbortSignal.timeout()` 会让请求立即中止。
- **请求体上限（413）**：登录快照保存请求体上限 128KB，临时会话配置请求体上限 16KB，超限返回 413。
- **回收站修剪时机**：`GET` 回收站列表不再触发修剪；修剪改由启动引导与定时调度执行，契约「GET 无副作用」由此成立。
- **发布脚本收敛**：`publish.bat` 只做本地 pack；发布统一走 GitHub Actions OIDC，不再引导创建长期 token。
- **测试运行器**：`npm test` 改为零依赖逐文件 runner，一个文件失败不中断其余套件。
- **渲染端修复**：网页面板 `reload()` 被中止（`ERR_ABORTED` / `-3`）或面板已释放后的迟到失败不再刷成错误态；更新检查与「立即试一次」的回调在设置页卸载后不再写状态；强制与非强制诊断请求不再共用一个在途锁；「立即试一次」不再跟着配置服务的可用性一起禁用；归档收藏监听的 180ms 定时器在卸载时清除；同一收藏在写入在途时反复点击只合并为一次后续写入，不再堆到队列上限后丢弃。
- **归档收藏桥接**：`@michengai/dsh-archive-manager` 的 `favoriteSessions()` / `setSessionFavorite()` 实际返回裸状态对象 `{ favoriteSessionIds }`，旧实现只认包装形状，桥接从未生效、一直静默回退到本地收藏。现兼容裸对象 / 包装对象 / 包装数组 / 裸数组，识别不了的形状走本地回退并输出一条带前缀的 warn。
- **界面细节**：页面切换 pill 按钮 20px → 22px、字号 10px → 10.5px；收藏夹全空时保留一行弱化的「暂无收藏」而不是整组隐藏；收藏夹标题行的星标与行内星标对齐，折叠箭头移到行尾计数右侧；设置页内联的 pill、数字输入、卡片与按钮补统一的禁用态和键盘焦点环；网页面板副标题对齐到 11px、底色跟随宿主 token、系统开启「减弱动效」时关闭加载脉冲；第三方页签条右端加渐隐提示。
- **测试与 CI**：新增 `tests/test_070.mjs`–`tests/test_080.mjs` 共 11 个套件，覆盖 `lib/index.js` 启动装配（单 Host 加载失败不影响其余）、窗口置前的超时 / 执行失败 / 非 JSON 输出分支、更新检查的非 200 / 坏 JSON / 超时 / 并发合并 / 失败缓存分支、登录快照 27 组双存储裁决、两个独立进程间的「清除失败后重启不恢复旧登录」、调度与退出钩子、设置页三条状态转移链路；19 个会启动 Host 的测试套件不再在 `%TEMP%` 留下测试目录（根因是 Host 的进程退出钩子在测试清理之后又把配置写了回来），runner 逐套件报告临时目录泄漏数。CI 的语法检查与打包必需清单补上三个 Host 文件。新增 `scripts/coverage.mjs`（零依赖覆盖率度量，不接进默认 `npm test`）。
- **文档**：使用说明补「三段式页面切换与登录快照」一节，头部版本号更正，配置表计数更正为 11 个键；右键菜单补「打开会话目录」；`docs/CONTRACT-1.0.md` 补 `focusOnLaunch`、1.1.x 追加的 5 条内部路由与收藏存储键；locale 描述去掉过时的「9 项」计数，英文描述改为英文在前；README / DETAIL 注明宿主凭据服务不可用时快照以明文落盘。
- **实测**：`npm test` 62 套件 / 1,949 条断言全绿，临时目录 0 新增；`npm run check` 退出码 0；`npm pack --dry-run` 26 个文件 / 约 644 kB。
- **登录快照不再明文回退（CH-06）**：宿主凭据服务不可用或写入失败时，保存路由不再把登录条目落进本机明文 JSON，只写一条「已清除」墓碑防止旧凭据复活；`web-login-save` 以 200 返回枚举原因 `credentials-unavailable`，网页面板如实提示本次登录状态不会保留，下次启动也不会注回旧登录。
- **「全部保留」两步确认（PD-13）**：详情页「全部保留」第一次点击只进入准备态并提示「再点一次确认」，5 秒内第二次点击才发起批量转正；切换到别的动作或超时自动解除，路由与响应形状不变，只影响当前这一批临时会话。
- **星标与折叠箭头改为 CSS mask 图标（UI-02）**：收藏夹星标、收藏行星标、会话行收藏开关、折叠箭头全部由文本字形改为 CSS mask 图标；金色星标仍是金色，折叠箭头热区 16×20，颜色跟随主题不变。
- **路由入口新增来源复核（CH-01）**：四个 Host 路由入口按 Origin 复核请求来源——无 `Origin` 放行、`dsh-app://app` 放行，其它 Origin 返回 403 `{ok:false,error:'cross-origin request'}`；这层只是兜底，不替代宿主传输层既有的五道关卡。
- **schema 回退收敛当前 profile（CH-09）**：配置 schema 解析回退不再遍历 `~/.dsh/profiles` 下其它 profile 目录，无关 profile 的 `node_modules` 不会再被拉进解析链，本机多目录布局也不再影响本插件启动。
- **第三方页签图标写入点固化为信任边界（CE-10）**：全插件唯一的 `innerHTML` 写入点（第三方页签图标）保持原行为，注释固化为信任边界；不扩大写入面，也不改动其它渲染路径。


## 1.1.4 — 启动置前前台锁修复 + 会话全展开收紧（2026-11-26）

1.1.3 的 Host 路由能恢复被隐藏 / 最小化的窗口，但启动时 PowerShell 是后台进程，`SetForegroundWindow` 会被 Windows 的前台锁拒绝；`WScript.Shell.AppActivate` 也不保证返回 true。结果就是窗口已经可见，却仍被全屏的豆包盖着。

- Host 脚本在置前阶段临时 `AttachThreadInput` 到当前前台线程，配合 `BringWindowToTop` + `SetForegroundWindow`，完成后解除附加；若仍未到前台，再用 `SwitchToThisWindow`（Alt-Tab 同款）兜底。
- 返回值改成按**实际 `GetForegroundWindow()` 是否等于目标窗口**判定，而不是只看 `AppActivate` 的布尔值；失败时带 `foreground` 句柄方便排查。
- 真机重启验证：主窗口句柄 `2491840`，启动后前台窗口为 `梯子搭建 — DeepSeek Harness`（PID `75644`），不再需要手动 Alt-Tab。
- `npm test` 45 个套件全绿；`test_066` 12 条断言、`test_063` A9a–A9f 均不变；`npm run check` 通过。

### 同批修正：会话全展开在「收起/展开」瞬间的死角（2026-11-26 实测发现）

真机用 CDP（`--remote-debugging-port=9333`）连运行中的 0.2.3 桌面版，通过宿主自己的「视图选项」切三种分组，读出两个事实：

- **功能边界**：`EXPAND_ALL_SESSIONS` 只作用于**已展开的分组**的水位线，管不到「分组折叠」。同一批会话：单列表 10/10 行、0 个溢出按钮；按工作区 / 按工作区树都是 8/10，差的 2 条躺在折叠的「DS Bot」组里（点开组头立刻变 10）。
- **瞬态死角**：把 8 条的组折叠再展开，`t+250 ms` 时只渲染 5 条，按钮文字「展开其余 3 个会话」、`aria-expanded=false`，但被插件 CSS 无条件 `display:none` —— 用户在那 0.6 秒里既少 3 条又没有入口；`t+850 ms` 插件驱动点完才变 8/8。**修复**：隐藏规则加 `[aria-expanded="true"]` 门槛，只在真正全展开后藏「收起」，未展开窗口把宿主按钮还给用户；驱动失灵时也能优雅退化。
- **文档口径**：README / 使用说明 / DETAIL 的「会话列表默认全部展开」改成「已展开的分组不再折成 5 条；折叠的分组保持折叠（状态属宿主 `dsh.workspace.view.v5`）」，并附上上述实测数据。
- **测试**：`tests/test_024.mjs` 断言改为新的带门槛选择器，并新增「带 `aria-expanded="true"` 门槛」「不得存在无条件隐藏变体」两条，防止将来被改回去。

### 同批修正：⇄ 连点越点越慢（2026-11-26 用户反馈）

反馈原话是「快速多次点击会响应很慢」。按代码链路拆开，侧栏那枚 ⇄ 不是纯 UI 开关：`setField('tab')` → 宿主串行写队列（整份 `cordis.patch.yml` 重写 + revision 广播）→ 客户端 `sync()` + `paint()`。而 `paint()` 每次都要全文扫 `data-dsbs-bar` / `data-dsbs-pages` 残留节点、做 `[class*="logoRow"]` 属性子串扫描、重建整条标签条、`getBoundingClientRect()/getComputedStyle()` 强制同步布局、再把 `expandAllSessions()` 跑一遍（`EXPAND_ALL_SESSIONS=on` 时会逐组点宿主按钮），切组时 `setGroupHidden()` 还 `dispatchEvent(new Event('resize'))` 广播给所有插件；写成功后宿主把新配置推回来，订阅回调再触发第二轮完整重绘。于是 N 次连点 ≈ 2N 轮全量重绘 + N 次写盘排队，点得越快排得越长。

- **视图先走窄路径**：新增 `applyTabView()`，只写 `data-dsbs-tab`、两个分组的 `aria-hidden/inert`、标签条选中态与按钮标签；`setField('tab')` 命中它就不再 `scheduleSync()`。`paint()` 与它共用 `groupVisibility()` 一条可见性规则，避免两处漂移。
- **写盘合并**：⇄ 改为 `toggleTab()`——点击帧内乐观切组，写盘按 300ms 窗口合并（首次立即写，其余折叠成一次尾随写，永远落最新值）；卸载前 flush。`setField` 原有的 refused → 400ms 重试与「只回滚最新写入」逻辑不变。
- **回声不再全量重绘**：`syncFromController()` 返回 `layoutFree`，宿主推回的配置若与上次 `paint()` 落的 `mode/showQuickSwitch` 一致（`adoptValues` 只带 mode / showQuickSwitch / tab，剩下的只可能是 tab），订阅回调走 `applyTabView()` 而不是 `scheduleSync()`。
- **全展开不再跟着每次重绘跑**：`expandAllSessions()`（全文扫 `button[data-row-key^="overflow:"]`、每个折叠组点一次宿主按钮、每次点击都让 React 重渲染会话树）原来写在 `sync()` 里，模式切换 / 配置推送 / 部件 resize 这类与行无关的重绘都要付一次全表扫描。现在由 `rowsDirty` 闸门控制，只在**会话树变了**（MutationObserver / ResizeObserver）或**有分组刚由隐藏变可见**时跑；可见组那一路走 `scheduleExpandPass()` 延后 120ms，不占点击帧。初始装载、Host 状态到达、Host 无响应开闸这三处仍同步跑一次，`EXPAND_ALL_SESSIONS=off` 不受影响。
- **切组不再给全应用发假 resize**：`setGroupHidden()` 原来在分组重新可见时无条件 `dispatchEvent(new Event('resize'))`，等于替整个应用伪造一次窗口尺寸变化——所有监听 resize 的插件都重新测量，而屏幕上一个浮层都没有。现在只在**真有浮层**（`popOpen` / `railOpen`）时才发，并用 `requestAnimationFrame` 合并成每帧一次；普通换标签页 / 换布局不再发。
- **测试**：`test_063` 新增 A1e–A1g、A10a–A10d——6 次 40ms 连点最多只留一次前导 + 一次尾随写，落盘值 = 最后一次点击；模式切换的重绘不再触发会话列表扫描、但刚可见的分组随后仍会被展开；普通换标签页不发 resize、打开浮层仍恰好发一次。`test_036` 两条源码形状断言改成 `groupVisibility()` 口径，并新增 5 条。`npm test` 44 个套件全绿，`npm run check` 通过。

## 1.1.3 — 启动置前开关：DSH 窗口被全屏应用盖住时自动拉回（2026-11-26）

这次只加一个可选的窗口行为，不改布局、临时会话和登录逻辑。

- **问题**：DSH 主进程和窗口都活着，但被另一个最大化 / 全屏窗口盖住时，用户看不到侧栏，误以为 DSH 没启动；DSH 的 preload 只暴露 `fileActions`、浏览器 lease、快捷键、更新等能力，**没有 show / focus / restore 主窗口的 API**，客户端无法自己解决。
- **开关**：插件详情页「选项」区新增「窗口 / Window」小节，开关 `focusOnLaunch`，**默认关闭**，写入插件自己的配置表单（`configForms`），不混进 `temp-session-config.txt`。打开后只在**启动完成时**执行一次：恢复最小化窗口并置前，不在运行中反复抢焦点。
- **Host 路由**：新增 `POST /api/dsh-sidebar-suite.focus-window`，由 Host 半用 PowerShell + Win32（`ShowWindow(SW_RESTORE/SW_SHOW)`、`SetForegroundWindow`，`WScript.Shell.AppActivate` 兜底）完成客户端做不到的动作。目标 PID 只取 Host 进程的父进程链，**请求体不能指定 PID**；8 秒超时，失败返回 `{ok:false,reason}`，不阻塞插件。
- **跨平台**：非 Windows 直接返回 `{ok:false,unsupported:true,reason:"windows-only"}`；不执行外部命令。
- **实测**：用户机器上 DSH 主窗口句柄 `524734`、进程 `1840`，被全屏窗口覆盖时调用脚本返回 `{"ok":true,"pid":1840,"window":524734}`，前台窗口切回 `DeepSeek Harness`。
- **测试**：新增 `tests/test_066.mjs`（12 条断言）覆盖路由注册、POST-only、跨平台降级、PID 不来自请求、成功/拒绝返回；`tests/test_063.mjs` 增加 A9a–A9f，覆盖开关渲染、写入 `focusOnLaunch`、启动时只执行一次。`npm test` 45 个套件全绿。
- `lib/client.js` 的 `VERSION` 与 `package.json` 同步到 1.1.3；`files` 与 `check` 脚本纳入 `lib/window-focus-host.mjs`。

## 1.1.2 — 修复登录快照恢复：空 token 包装被误判成已登录（2026-11-25）

这次只修登录持久化，不新增功能、不改公开契约。

- **根因**：DeepSeek 登出页仍然会在 `localStorage.userToken` 里留下 `{"value":null,"__version":"0"}`（实测 30 字节）。1.1.0 的 `hasWebToken` 只检查“键名匹配且值非空”，把这个空包装当成有效 token，于是 `restoreWebLogin` 认定“页面已有更新的 token”，直接跳过快照注入；重启 DSH 后两个页面当然继续停在扫码页。排查时用户 `.credentials.yaml` 里 `dsh-sidebar-suite/web-login-chat|api` 记录和 token 都在，说明保存链路正常，问题在恢复判断。
- **修复**：`hasWebToken` 现在解析 DeepSeek 的 value 包装，只把非空的 `value` 字符串（或直接 JWT）视为有效；`{"value":null}`、`{"value":""}`、`null`、`undefined` 都不再阻止恢复。
- **同时加固捕获**：页面存活期间每 1.5 秒轮询一次，并在 `did-navigate` / `dom-ready` / `did-finish-load` 立即抓取；不再依赖扫码登录是否触发导航。只快照 `userToken`、`__appKit_userInfo`、`deepseek-device-id:*` 等登录键，不把页面缓存塞进快照；host 侧排序也把 `userToken` 放在 64 键预算最前面。
- **实测**：完整退出 DSH 后重开，Chat 直接进入“你好，我能帮什么忙吗？”，API 直接进入 `/usage` 并显示账号与用量，两边均不再要求扫码；新快照 `savedAt` 也在打开页面后自动刷新。新增 `tests/test_065.mjs`（22 条断言），覆盖空包装 token、噪声 localStorage、轮询捕获与文件兜底；`npm test` 44 个套件全绿。
- `lib/client.js` 的 `VERSION` 与 `package.json` 同步到 1.1.2。

## 1.1.0 — 三段式页面切换：对话 / DeepSeek Chat / API（2026-11-25）

侧栏顶部品牌行右侧新增一个紧凑的 `对话 · Chat · API` 三段开关，塞进 `deepseek HARNESS` 字标与展开按钮之间的空档，不额外占一整行高度；开关可见时字标缩到 78%，隐藏后恢复。它用来切换**主内容区**（左侧栏右边那块 Conversation 所在的大区域），不是 DSH 右侧栏：右侧栏没有“对话”页签类型，硬塞会变成第二套导航。

- **三个页面都是宿主自己的 `main` 面板**：`dsbs-deepseek-chat` / `dsbs-deepseek-api` 通过 `ctx.slots.inject('main')` 注册，`ctx.layout.selectPanel(id)` 切换；`对话` 调 `selectPanel(null)` 回到当前会话。点会话、开 Plugins 等宿主导航会自然切回对话，开关跟随 `panelInfo` 高亮，不跟宿主抢方向。
- **网页不是 iframe**：`chat.deepseek.com` 与 `platform.deepseek.com` 都返回 `frame-ancestors 'none'`，无法嵌入。两个页面内嵌 DSH 桌面端的原生 `webview`，通过 `window.dshDesktop.browser.acquire(storageKey)` 取得 lease 与 partition，地址先固定为 `about:blank#<lease>` 以通过主进程 `will-attach-webview` 的校验；元素挂载后再 `loadURL()` 到真实站点（与 `dsh-deepseek-chat` 的做法一致），`about:blank` 的 `dom-ready` 不算页面就绪。
- **登录状态保持**：guest partition 是进程内存级的，跨应用重启必丢。插件把网页 localStorage 里的小体积登录键值（单值 ≤16KB、总计 ≤64KB、最多 64 键）快照到 `ctx.credentials` 的 `dsh-sidebar-suite/web-login-chat|api` grant record；没有 credentials provider 时回落到 `~/.dsh/dsh-sidebar-suite/web-login.json`（0600）。每次运行每页只恢复一次：`dom-ready` 后读快照，若当前没有 token 就注入并 `reload()`；登录成功后延迟抓取，检测到主动登出则清除。**只镜像 localStorage，不保存 cookie**，所以 API 控制台若使用 HttpOnly cookie 会话，跨重启仍可能要重登。
- **新宿主路由 3 条**：`/api/dsh-sidebar-suite.web-login-load|save|clear`，写队列串行化，错误信息不泄露 token。**必须彻底退出 DSH 再打开**才会注册；只热重载客户端不够。
- **显示条件**：桌面版 + 宽侧栏 + 无第三方页签占列 + `dsh-deepseek-chat` 不在 CHAT 模式。折叠图标条、窄栏、网页版（无 `window.dshDesktop.browser`）整行隐藏；主面板尚未注册时行隐藏并禁用，不画“点了没反应”的按钮。
- **修复（实机反馈）**：首版在 React effect 里直接 `loadURL()`，Electron 报 `The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.`。改为等 `about:blank` 的 `dom-ready`，或 `getURL()` 已可读（事件早于 effect 触发）时再导航；同时把加载遮罩的 `hidden` 从空字符串改成布尔值，避免页面已 `ready` 但“正在连接 DeepSeek…”盖住真实网页。
- **修复**：页面条初版按 `nextElementSibling` 紧贴布局条插入，和页签条/窄栏菜单的注入器互相搬节点，触发 observer 反馈循环（`test_033` 抓到 124 次根节点变更）。改为**插在控制条内部（`data-dsbs-seg` 之后、分隔线之前），只插一次，已挂载就不再移动**；顺序由插入位置决定，不再依赖 CSS `order`。随后按实机反馈把整条独立行收进控制条同一行，减少约 30px 垂直占用；最终版再移到品牌行，控制条恢复成纯布局胶囊。
- **品牌行收口**：按 `[class*="logoRow"]` 语义后缀定位宿主品牌行（不硬编码 CSS-module 哈希），把页面条插在品牌与 `[data-sidebar-toggle]` 之间；可见期间给品牌元素加 `zoom:.78`，隐藏时摘掉。`test_064` 与新布局同步，`test_032` 的“行内不塞子节点”守卫仍然通过。
- **测试**：新增 `tests/test_064.mjs`（46 条断言），覆盖三按钮 DOM/aria、点击调用 `selectPanel`、`panelInfo` 外部同步、第三方页签隐藏、无桌面桥隐藏、品牌行落位、快照校验与 credential 存取；`npm test` 全绿（43 个套件）。
- `lib/client.js` 的 `VERSION` 与 `package.json` 同步到 1.1.0；`files` 与 `check` 脚本纳入 `lib/web-login-host.mjs`。

## 1.0.0 — 稳态契约版：为未知宿主兜底，并把承诺写死（2026-11-24）

第一个正式大版本，**不加新功能**。0.8.x 已经把功能面做满，这一版把「稳」做实、说清、卖得出去：面对未来认不出的宿主时优雅退让、逐条复核交互路径、首次公开稳定性契约。`lib/client.js` 的 `VERSION` 与 `package.json` 同步到 1.0.0。

### M1 · 宿主防御性适配

DSH 0.3.0 至今未发布（本机与官方 releases 最新都是 `0.2.3-alpha.2`），所以这里不是对着一个不存在的版本改代码，而是把 68 处宿主依赖点（`client.js` 59 / `temp-session-host.mjs` 8 / `index.js` 5）按风险分级，把「硬依赖」变成「先探测、再使用、失败有退路」：

- **新增文件内适配层**：`hostRead`（深层只读，任一步抛错返回兜底）、`hostCall`（仅当确实是函数才调用，统一返回 `{ok,value,error}`，并用 `fn.apply(service,…)` **保留方法接收者**）、`featureDetect`（纯能力探测）、`degrade`（统一降级出口：只隐藏我方控件、日志只打一次、记录原因）。
- **`hostResolve()` 成为唯一解析入口**：`paint` / `sync` / `readHealth` 三处调用都显式处理「找不到侧栏」——不再挂控制栏、不注册观察器、让宿主按官方默认原样显示。宿主节点**永不隐藏**（有断言守着）。
- **`index.js`**：`apply` 加一次性降级日志；`inject = ['connection']` 是刻意的硬依赖，一字未动并补注释固化理由。
- **`temp-session-host.mjs`**：`register` 在 `connection.fetch` 缺失/注册失败时记录 `degraded` 原因并在 `status()` 暴露；DSH home 路径解析失败时兜底，不抛。
- **`engines.dsh` 本次不动**：仍是 `">=0.2.2-rc.1 <0.3.0-0 || >=0.2.3-0 <0.3.0-0"`，**不放行 0.3.0**。等 0.3 真发布并稳定一段时间后再单独评估全面切换。
- QA 复核抓到一处隐患并已修：`nativeMenuActive` 早期实现把宿主方法取出来裸调、丢了 `this`，在依赖接收者的宿主上会让右键菜单退化；改用 `hostCall` 后与改造前的 `source.getSnapshot()` 完全等价，并有专门的 `this` 依赖测试守着。

### M2 · 交互死角审计（A1–A8）

按「交互五约束」逐条复核八条路径：三布局切换、浮层开关、窄栏菜单、临时会话右键菜单、arm-then-confirm、第三方页签返程、反馈/诊断、会话默认全展开。**结论：八项均确认正常，未发现需要修的缺陷，因此产品代码零改动**——不为凑数制造改动。所有结论都用真实 `lib/client.js` bundle + DOM stub 在 VM 里驱动得出（`tests/test_063.mjs`，35 条断言），不靠读源码下结论、不靠截图。

### M3 · 稳定性契约

- 首次发布 [docs/CONTRACT-1.0.md](docs/CONTRACT-1.0.md)：明确「公开接口」只有四类——配置键、`sidebarSuite` 服务、`/api/dsh-temp-session.*` 路由、`<html>` 上的状态属性子集；其余内部 DOM/类名/内部 `data-dsbs-*` **不承诺**。1.x 内删改任一承诺项 = 破坏性变更，只会出现在 2.0。
- [docs/UPGRADE-1.0.md](docs/UPGRADE-1.0.md)：从 0.8.x 升级**不用改任何配置**；旧 `mode: a` 自动按 `n` 读取；附退回旧版的方法。

### M4 · 市场卡位（审计结论，未新增素材）

逐项核对后**没有需要改的素材**，不做为凑数的改动：

- **图标**：现有紫渐变圆角底 + 白色侧栏/列表线条，语义清晰，16–32px 仍可辨认，不重画。
- **卖点**：`package.json` 与 `locale` 的 `meta.description` 已经写明定位（三种布局、会话全展开、临时会话默认退出即删、定时清理默认关）与两个设计目标，中英逐字一致，受 `test_025` 守着，不动。
- **打赏合规**：README / DETAIL / 使用说明三处均已写明「完全自愿、无任何回报承诺、没有付费墙」，无付费解锁表述。
- **截图**：`assets/real-screenshots/` 下三张（浮层 / 标签页 / 控制栏特写）与当前 UI 一致，保留。
- **窄栏截图：取消。** 核对宿主 `AppFrame.tsx:188`：`collapsedWidth = drawer || darwin || windowsTitlebar ? 0 : 56` —— **Windows 桌面版折叠后侧栏宽度是 0，不存在 56px 图标条**，只有 Web 版和 macOS 版才有。拿一张多数用户（Windows 桌面）根本看不到的窄栏图当卖点会误导，所以不做，而不是硬造一张示意图。

### M5 · 反馈闭环

- 仓库此前**一个 Issue 模板都没有**，点「新建 issue」是一张空白框，用户只能自己猜该写什么。现在加了三个文件（`.github/ISSUE_TEMPLATE/`）：
  - `bug_report.yml`：问题描述、复现步骤、期望行为、**粘「复制反馈内容」的专用多行框**、出问题时的布局下拉、两条提交前自查。
  - `feature_request.yml`：开头先说清「只管左侧栏」的边界（会话内容、模型切换、独立面板、云服务通常不在范围内），再问「你当时在做什么 / 现在是什么样 / 希望变成什么样」，最后一条必勾「这是关于左侧栏的建议」。
  - `config.yml`：关掉空白 issue（`blank_issues_enabled: false`），把「用法问题」导到 Discussions、把「市场评论区」导到 `awesome-dsh-plugin` 那条讨论——与 README/DETAIL 已写明的分工完全一致，不新增第五个入口。
- 两个模板都把「先去详情页点『复制反馈内容』」放在第一屏：报告已经带版本、系统、布局、最近错误，能省掉一整轮「你是什么环境」的往返。
- 纯配置改动，不含运行时代码，打包文件数不变（仍是 23）。

验证：`npm test` **41 个文件 1308 项全绿**（新增 `tests/test_062.mjs` 32 项宿主降级、`tests/test_063.mjs` 35 项交互审计）；`npm run compat` 契约矩阵 **54/54**；`npm run check` 打包 23 文件。变异对照逐条先红后绿（去掉降级日志 → 6 红；丢掉方法接收者 → E1 红；把布局钉死为 `b` → 2 红；给宿主节点加 `hidden` → 2 红），均断言失败、进程不崩。

## 0.8.11 — 第二轮审阅：堵掉插件页的死路、补齐键盘与文案（2026-11-24）

又是一轮「UI 交互 / bug / 可用性 / DSH 规范」四线审阅，接着 0.8.10 往下查，六处都改在真能被用户碰到的路径上。**没有新功能**，`lib/client.js` 的 `VERSION` 与 `package.json` 同步到 0.8.11。

- **插件页在原生分组主机上变成死路（高）**：0.7.4 起 rc.2+ 宿主自己有「更多」菜单，我们把重复的页签条藏了；但公开的 `activateTab()` 仍可被消费方调用，一旦调用，`paint()` 会隐藏控制栏、`data-dsbs-ptab` 又隐藏窄栏菜单、页签条本身也藏着 —— 用户站在一张插件页上，**三个出口同时消失**。现在只要插件页还占着这一列，就破例把页签条留作返程入口（点当前页签即退回会话列表）；没有活动页签时照旧让位给宿主原生分组，不造第二个重复入口。
- **窄栏单选组方向键无效（中）**：折叠后的布局菜单标了 `role="radiogroup"` / `role="radio"`，却没有 roving tabindex，三个选项都是独立 Tab 停靠点、方向键一概没反应 —— 和 0.8.10 刚修好的主栏页签条是两个标准、两套行为。按 APG 单选组补上：只有选中项是 `tabindex=0`，`←/→/↑/↓/Home/End` 移焦点并即时应用布局（radio 的约定就是方向键即选中），仍从按钮自身的 click 路径关闭面板。
- **失败回滚会覆盖更新的 tab 选择（中）**：`setField()` 的 `mutate()` 被宿主以「版本冲突」拒绝两次后回滚，但如果这 0.8 秒里用户又点了一次、后一次写入已经成功，旧请求醒来时会把自己那份过期的 `previous` 写回去，界面跳到一个谁也没选的页签。给每次写入加单调递增序号，只有「仍是最后一次写入」的那次才允许回滚；失败提示仍点名控件。
- **创建临时会话时两条错误提示抢 20 秒（中）**：`track` POST 自带 20s 看门狗，创建流程外层也曾是固定 20s —— 同一时刻两个定时器都响，一次失败弹两条互相矛盾的话。外层改成 `WRITE_TIMEOUT_MS + 3000`，让带真实状态的请求分支先收尾，外层只兜「请求还没发出去就卡住」的情况。
- **中文提示里混着英文「N active」（中）**：`temp.countSuffix` 只定义在英文字典，中文界面回退时把英文那半也显示了。给中文字典补上自己的「· 当前 N 个临时会话」。
- **两处文档与实物不符（低）**：`DETAIL.md` 的 `engines.dsh` 还写着旧的单区间（0.8.7 已是双区间，且第二段对 0.2.3-alpha.2 是必需的），顺带把这层 semver 原因写明白；`README.md` 与 `package.json` 里的「全部 9 项配置」在 0.8.0 加了本地回收站、配置键涨到 11 个后就没再对过，改成不随键数过时的「全部配置键」。

验证：`npm test` 39 个文件 **1241 项全绿**（新增 `tests/test_061.mjs` 24 项）。六组变异逐条先红后绿：撤掉插件页的返程页签 → 1 红；去掉 roving tabindex → 2 红；去掉写入序号守卫 → 1 红；看门狗改回裸 20000 → 1 红；删掉中文 `countSuffix` → 2 红；文档改回旧文案 → 2 红。改动同步更新了 `test_030` / `test_046` 锁的旧条件、以及 `test_056` / `test_058` 锁的旧英文提示断言。

## 0.8.10 — 审阅收口：控制条对齐、页签键盘、英文标题（2026-11-24）

这一版全部来自一次「UI 交互 / 可用性 / DSH 规范」三线审阅，**没有新功能**。六处都小，但每一处都是用户看得见、或者键盘摸得到的。

- **控制条左边缘与宿主按钮差 4px（真机量出来的）**：控制栏挂在 `scrollRegion` 里，那一层的左边界就是侧栏的 8px 内边距；而宿主自己的行（上面「新会话」、下面每个会话行）都套着 `margin:0 calc(var(--dsh-sidebar-paint-inset) + 1px) …`，等于再往里 4px。控制栏没写 inline margin，于是胶囊比「新会话」按钮靠左 4px、又比下面的会话行靠右 4px —— 一条本该笔直的竖线折了一下。现在控制栏镜像宿主那行的同一个 `margin-inline` 表达式（带 `3px` 字面回退），宿主以后调 inset 会自动跟随。真机对照：改前胶囊左缘 36px、按钮 46px；改后两者都是 46px（250% 缩放，同一窗口同一时刻）。
- **打开「循环切换」后分隔线跑到列中间**：`[data-dsbs-bar]>span` 靠 `margin-left:auto` 顶到右缘，而 `quick` 按钮自己也带了一个 `margin-left:auto`。两个 auto 会平分剩余空间，于是竖线停在半空、按钮孤零零贴在右边。去掉 `quick` 那个，推的工作仍归分隔线。
- **页签条只能用鼠标点**：`role="tablist"` 但每个页签都是独立的 Tab 停靠点，方向键完全没反应 —— 键盘用户要走完整条侧栏才能越过它。按 APG 的 tabs 模式补上 roving tabindex（只有选中项 `tabindex="0"`，其余 `-1`）和 `←/→/Home/End` 移动焦点，采用**手动激活**（回车/空格才打开）：每个页签第一次打开都要挂载消费方的 React 页面，方向键划过三个页签不该把三个页面都挂一遍。
- **失败提示用的是 `role="status"`**：polite 区域会排队等读屏器念完手上那句，而错误提示 10 秒后就自动消失 —— 念到时可能已经不在屏幕上了。错误改成 `role="alert"` + `aria-live="assertive"`，成功提示仍留在 polite。
- **英文 locale 里是中文标题**：`locale/en.json` 和 `zh.json` 曾经逐字节相同，英文界面里插件卡上写着「侧栏布局大师」。按宿主自己的做法（`dsh-session-log-export`：zh 写中文标题、en 写英文）把 en 的 `meta.title` 改成 `Sidebar Suite`。双语那一行 `description` 是刻意设计（两份保持一致，`test_025` 守着），不动。
- **创建临时会话的收尾只有一个分支**：`.catch(...).then(releaseTempBusy)` —— 如果 catch 里自己抛了（toast 碰到宿主刚拆掉的 DOM），按钮会一直置灰到 20 秒看门狗。现在成功和异常两条路都释放。

顺带修：`CHANGELOG` 里 **0.8.8 的段落标题在 0.8.9 那次插入时被吞掉了**，整段挂在了 0.8.9 名下，已补回。

验证：`npm test` 38 个文件 **1293 项全绿**（新增 `tests/test_060.mjs` 26 项）；`npm run compat` 契约矩阵 54/54；`npm run check` 打包 21 个文件。变异对照六组，逐条红过再改回：撤掉 inline margin → 2 红；给 `quick` 加回 `margin-left:auto` → 1 红；不再初始化 roving tabindex → 3 红；错误提示退回 `role="status"` → 1 红；英文标题改回中文 → 1 红；收尾只留成功分支 → 1 红。

**审阅里看过但决定不改的**（写在这里省得下次重新怀疑）：① `engines.dsh` 的 `>=0.2.2-rc.1 <0.3.0-0 || >=0.2.3-0 <0.3.0-0` 看着重复，其实第二段是必需的 —— npm 的 semver 对带预发布的版本要求「同一 major.minor.patch 上也有预发布比较符」，`0.2.3-alpha.2` 只满足第二段（`test_058` 已固化）；② 「会话默认全展开」打开后宿主那半个「收起」被一起藏掉，用户不能单独折叠某组 —— 这是该设置的定义，不是 bug，关掉设置即恢复；③ 控制栏右侧那颗动作图标在宽栏里仍靠右，中间留白，属于工具条的常规布局，没有动。

## 0.8.9 — 临时会话不再被宿主的失效预设挡住；悬停时那颗 Ctrl+N 收掉（2026-11-23）

两处都来自 0.8.7 的真机反馈。

- **修 1：点「临时」弹「创建临时会话失败：session create failed: agent-preset/not-found: Unknown agent preset: ops-ptc」**。查下来不是本插件的问题，但确实是本插件能给用户绕开的坑：DSH 在建会话**之前**先解析 Agent 预设 —— 显式传了 `agentPreset` 就用它，否则用注册表里的 `selectedDefault`。而 `selectedDefault` 只是 profile 里的一个字符串，**提供该预设的插件被卸载/没加载起来时它不会跟着消失**。这台机器上 `dsh-ops` 被清过，`ops-ptc` 却还写在 `profiles/desktop/cordis.patch.yml` 里，于是这个 profile 下**任何**新建会话都会失败，宿主自己的「新会话」按钮同样如此（`agent-preset/not-found` 由 `@deepseek-ai/dsh-agent-preset-registry` 的 `resolve()` 抛出，发生在 `agents.createSession` 之前）。
  - 现在的做法：新建临时会话时**继承当前主栏会话的预设**（读会话列表快照的 `byId[id].projectionValues.agentPreset`，与宿主自己的会话行同源），把它显式传给 `createNamed`。你停在「标准模式」的会话里点「临时」，建出来的就是「标准模式」，不再取决于那个孤儿字符串。读不到（没有当前会话、快照没有该字段、或不是字符串）就照旧传 `{ workspaceId }`，让宿主自己决定 —— 旧行为原样保留。
  - 真的一个能用的预设都继承不到时，提示换成能执行的：直接点名「默认代理预设「ops-ptc」已经不存在」，并说明宿主的「新会话」按钮一样会失败、这不是插件的问题，以及两条出路（在设置里换一个存在的预设 / 重装提供它的插件）。不再把宿主的 `session create failed: …` 原文丢给用户。
- **修 2：悬停「新会话」时浮在接缝上的 `Ctrl + N`**。宿主把快捷键提示写死为 `opacity:0`、`:hover`/`:focus-visible` 时淡入，同时给标题加一层 `:has(+.newSessionShortcut)` 的渐隐遮罩腾位置 —— 这套假设按钮独占整行。0.6.0 起我们的「临时」按钮占了同一行右侧 80px，那颗提示就正好压在两个按钮的接缝上，看着像从「临时」那边飘出来的。
  - 现在在 seat 模式（`data-dsbs-temp-mode="slot"`）下把该 span 隐藏；快捷键本身是全局按键处理，不受影响，只是不再画这行字。
  - 顺带还原标题的渐隐：`display:none` 不会让 `:has(+…)` 失配，遮罩仍会生效、标题尾部白掉 16px 却什么也不露出来，所以 hover / focus-visible 两态各补一条把 `mask-image` 与 `overflow` 还原。旧版 dom 模式那条规则本来就在，保持不动；`TEMP_BUTTON_STYLE=own`（按钮独立成行、不挤占宿主按钮）也不隐藏。

验证：`npm test` 37 个文件 **1267 项全绿**（新增 `tests/test_059.mjs` 20 项，`test_038` 新增 4 项）；`npm run compat` 契约矩阵 **54/54**。变异对照：去掉 `agentPreset` 透传 → 1 红；让 `missingPresetName` 不再匹配错误码 → 3 红；去掉 `typeof preset === 'string'` 守卫 → 1 红；把 seat 模式的隐藏规则改成 `display:block` → `test_038` 2 红。每项改回后全绿。



## 0.8.8 — 两轮审阅：更正两处失真的文档，把宿主 CLI 的坑写清楚（2026-11-23）

这一版**没有功能改动**（`lib/client.js` 只动了版本号）。两轮审阅把 0.8.7 的每条新路径都对回了宿主源码、又在已安装的 0.2.3-alpha.2 上实点了一遍，结论是功能没问题；要修的是三处「说的和做的不一样」。

- **第一轮（逐行 + 契约复核）**：`nativeMenus` / `nativeMenuActive` / `openNativeTempMenu` / `onTempContextMenu` 的三条分支 / `mountTempRowMenu` 双模式挂载 / `createTempSession` 的计数刷新，逐条对照 `dsh-client-ui-context-menu` 源码确认：`open()` 内部同步调 `registry.resolve()`、`resolve` 收到的是 `target.value`（所以 `target.sessionId` 的写法是对的）、`active` 与 `targetSource` 成对清空（不存在读到陈旧非空值的窗口）、宿主的 `document` 级 `contextmenu` 监听器先于我们注册、且会先 `close()` 一次（所以我们读到 `active === null` 再自己开，语义正确）。**未发现功能缺陷。**
- **第二轮（真机实点）**：在**已安装的** 0.2.3-alpha.2（`D:\program\harness`，更新器已把 `app.asar` 解包成 `resources/app`）+ 隔离 `DSH_HOME` 上逐项点过：临时会话创建、tooltip 计数、「临时」角标、右键原生菜单（宿主置顶/重命名/标为未读/分叉 + 本插件「保留为正式会话 / 立即删除」同一张）、菜单里保留后角标消失、详情页开关与「当前临时会话」列表按钮、三种布局切换。**全部正常。**
- **更正 1：0.2.3-alpha.2 的打包布局**。0.8.7 写的是「退回 `resources/app.asar`」——那是**安装包**的形态；桌面更新器装完会把它解包成 `resources/app/`（本机留下的 `resources/app.asar.purge-20261123-1842.bak` 就是被改名的旧包）。所以同一个版本在真实机器上两种布局都会出现，`scripts/smoke-l5.mjs` 本来就两种都认，错的是 README / DETAIL / CHANGELOG / `test_047` 里的说法，全部按事实改写。
- **更正 2：「宿主销毁 `contextMenus` 后右键静默失效」不成立**。读源码后确认：`MenuRegistry.resolve()` 在销毁后抛 `Menu registry is disposed`，而 `open()` 内部是同步 `resolve`，异常会抛进我们的 `try/catch`，于是照常落到自有 DOM 菜单（两项都在）。DETAIL 的「已知限制」按这个事实重写，只保留真正的盲区：宿主保留服务却把 `session` 目标的贡献全撤掉时，弹层会打开但没有任何项。
- **工具：冒烟脚本认出宿主自己的 CLI 路径 bug**。解包布局下 `dsh-desktop-host/lib/cli.js` 把 runtime 算成 `resources/app/runtime`（真实位置是 `resources/runtime`），任何 `dsh plugin …` 都会在安装前就 `MODULE_NOT_FOUND`。`npm run smoke` 以前只会甩一串堆栈，现在先打印一段明确解释（并标注「← 宿主 CLI 路径问题」），不再让人误以为是插件装不上。
- **使用说明新增 Q6**：命令行装插件报 `Cannot find module …resources\app\runtime\…` 怎么办 —— 用应用内「插件 → 添加插件」（主进程启动时显式传了正确的 runtime 路径），不要在 `resources\app\` 下自建 `runtime` 去凑。

验证：`npm test` 36 个文件 **1243 项全绿**；`npm run compat` 契约矩阵 **54/54**；`npm run check` 打包 21 个文件。真机上的逐项结果见上面第二轮。

## 0.8.7 — 适配 DSH 0.2.3-alpha.2：右键菜单在会话行上重新可用（2026-11-23）

nightly 渠道的 0.2.3-alpha.2 已经下到本机更新器里（今天 15:23）。把那个安装包解包到临时目录、用隔离 `DSH_HOME` 当真实宿主跑了一遍：大部分功能没坏，**两处必须修**，其中一处是「注册成功但界面根本不弹」的静默失效。

- **右键菜单在 0.2.3-alpha.2 上无声消失（真机发现）**：宿主保留了 `contextMenus` 服务和 `session` 目标的全部内置项，`register()` 也照样成功，**但会话行不再绑定右键手势** —— 于是 0.8.6 注册完就把自有菜单卸掉，右键什么也不弹，「保留为正式会话 / 立即删除」没有任何入口（详情页「当前临时会话」里还在，但侧栏这条完全没了）。现在监听器在两种模式下都常驻，右键时先读 `contextMenus.active`：宿主已经开了就放行；没开就用同一个 `session` 目标调 `contextMenus.open(target, point)`，让宿主的置顶/重命名/标为未读/分叉与本插件两项**出现在同一张原生菜单**里；`open` 不可用或抛错才退回自有 DOM 菜单。普通会话行依旧完全不碰。
- **新建临时会话后按钮 tooltip 计数不动（真机发现）**：计数只有两个写入点 —— 启动时的 status 回包、以及「保留/删除」后的 id 列表回包。新建成功只弹了 toast，没更新计数，于是提示里一直写「0 active」，刷新页面才变 1。现在 track 成功后同步 `tempCountKnown`，由随后必然执行的 `releaseTempBusy()` 统一重绘（这里不再自己调 `scheduleSync()`：那一刻 `pending` 已置位，多调一次会排在微任务队列里造成整栏重绘两次）。
- **三轮审阅补的三处**：① 键盘手势（ContextMenu 键 / Shift+F10）触发的 `contextmenu` 坐标是 0,0，照抄会把菜单钉在窗口左上角 —— 现在 0,0 时改用行的 `getBoundingClientRect()` 定位，宿主自己的 trigger 也是这么做的；取点逻辑抽成一个函数，自有 DOM 菜单一起修好（这条在 0.4.0 起就存在，只是没人用键盘试过）。② 合成 target 的 `displayTitle` 改为优先取会话列表快照的 `byId[id].displayTitle`（宿主行传的 `row.title` 就是它），取不到才退回行文本 —— 否则下游读 `displayTitle` 的地方会看到「标题 + 相对时间」。③ 补一条已知限制：宿主若把整个 `contextMenus` 插件销毁（不是降级），本插件不做活性探测，右键会静默失效，与宿主自身所有菜单一致。
- **契约矩阵新增 0.2.3-alpha.2 画像**：`tests/test_047.mjs` 从五个画像变六个，显式断言 rc.3/rc.4/rc.5/0.2.3 客户端契约同形；打包布局的两种形态（`resources/app.asar` 归档、更新器解包后的 `resources/app/`）都由 smoke 的启动器探测覆盖 —— 0.8.7 当时写的「0.2.3 = app.asar」只对了安装包那一半，运行中的 nightly 会被更新器解包，见 0.8.8。
- **宿主侧其余变动已核对，均不影响本插件**：`sidebar.panel.trailing` 是新增官方插槽（面板行尾计数），本插件不占用；侧栏滚动条从 JS 计时改成 CSS 过渡；`theme-presenter` 新增对 `document.head` 的 `MutationObserver`，而本插件样式节点只在挂载/热重载时插一次，不形成反馈环；`schemastery` 3.19→3.20-alpha.1、`cordis` 4.1→4.2-alpha.1，本插件只用到 schema 声明，用法未变。
- **真机逐项验证（解包的 0.2.3-alpha.2 + 隔离 `DSH_HOME`，不碰用户现有 0.2.2-rc.5）**：三种布局切换（标签页 ↔ 显示工作区/显示扩展、浮层、官方默认）、临时会话创建与「临时」角标、计数即时更新、右键原生菜单里的「保留为正式会话」生效、详情页九个开关与配置文件热写（改 `EXPAND_ALL_SESSIONS` 立即落盘）、56px 图标条菜单 + Esc 关闭并回焦、宽栏后菜单自动消失。
- 验证：`npm test` 36 个文件 **1243 项全绿**；`npm run compat` 契约矩阵 **54/54**；L5 冒烟在 **0.2.2-rc.5** 与 **0.2.3-alpha.2** 上各 **3/3 通过**（装得上→起得来→HTTP 303）。新增/改写的断言都做过变异对照：去掉计数刷新 → C2 红；恢复「原生模式早退」 → B2/B3/B4/B7 红；去掉 `active` 探测 → B6 红；把 `preventDefault` 提到归属判断之前 → 三条红；去掉坐标回落 → B10/B11 红；去掉快照取标题 → B3b 红。每项改回后全绿，红都是 FAIL + 非零退出。

## 0.8.6 — 真机修复：布局/页签写入不再「保存失败： tab」（2026-11-21）

真机（DSH 0.2.2-rc.5）点击「显示工作区 / 显示扩展」偶发红色 toast「**保存失败： tab**」。逐层追到宿主源码后的结论与修复：

- **根因在插件客户端，不在宿主**。写入链路是 `setField('tab')` → `configForms` 控制器 `mutate(ops, expectedRevision)` → 宿主 Remote `settings.mutate` → `@deepseek-ai/dsh-settings` 的 `write()`。旧代码在点击时**先读快照 revision 再显式传入**，而宿主自己的 `setField()` 合同是 **expectedRevision 可省略**——控制器会在**串行写队列内部**解析最新 revision（`expectedRevision ?? pendingRevision ?? snapshot`）。预读的 revision 一旦落在队列里前一个写入之后（比如上一次点击刚成功、宿主已把 revision +1），Host 就按 `SETTINGS_CONFLICT` 拒绝；真机时间线吻合：profile patch 里 `tab` 已是上一次成功写入的值，紧接着的下一次写入被拒。
- **宿主客户端层把拒绝原因丢掉了**（`mutate` 只返回 boolean，`SETTINGS_CONFLICT` 的 "expected/actual" 到不了调用方），所以 toast 只能显示裸字段名 "tab"。修复后 toast 说人话：「保存失败：扩展/工作区切换 · 宿主拒绝了这次写入（常见原因是保存时机冲突）……」，并新增 `field.tab` / `field.mode` / `policy.conflictHint` 双语词条。
- **写入不再预读 revision**（`setField` 与详情页 `writeDefaultMode` 同步修改）：revision 由宿主写队列解析，排队写在彼此之后不再互相踩踏。
- **失败自动原地重试一次**：`false` 返回已经触发宿主侧 `recover()` 重读，400ms 后的第二次写入落在新鲜 revision 上；只有**第二次**仍被拒才回滚 + toast。重试窗口内不回滚、不弹错，避免「看起来保存失败但实际马上成功」的错觉。
- 回滚与诚实语义不变：第二次仍失败时值回滚、toast 说明「值已回滚，稍等一拍再点通常就能成功」。
- 宿主侧行为核对（`dsh-client-ui-settings/src/client/config-form.ts`、`dsh-api-settings-controller/lib/index.js`、`dsh-settings/lib/index.js`）：`mutate` 的 false 只来自 Host 拒绝或控制器销毁；`SETTINGS_CONFLICT` 是唯一与我们预读 revision 相关的拒绝类。`volatile` 校验、路径校验与 patch 落盘逻辑均未改动。
- **声明宿主版本要求**：`package.json` 新增 `engines: { node: ">=20", dsh: ">=0.2.2-rc.1 <0.3.0-0" }`。核实过宿主 v0.2.1-alpha.3 起 `engines.dsh` 是安装与 profile 启动的**强制**兼容检查（缺省才回退 peer 规则）；区间用带预发布比较器的写法，宿主自带 semver 实测：0.2.2-rc.1→rc.5、0.2.2-rc.6、0.2.2、0.2.3 匹配，0.2.1 及更早、0.2.3-rc.1、0.3.0（含预发布）拒绝——精确覆盖已验证范围并挡住未验证的未来版本。README/DETAIL/使用说明同步声明，并撤掉「刻意不声明 `engines.dsh`」的过时说法（当时的顾虑——普通范围误判预发布——用预发布比较器即可正确表达；生态内 session-guard / mnemon / context 均已如此声明）。
- 回归：`tests/test_043.mjs` 新增 4 条源码守卫（revision 不再预读、重试存在、toast 带控件名、`writeDefaultMode` 同合同）。`npm test` 全绿、`npm run check` 通过。

---

## 0.8.5 — 快赢包：一键全保留、清理过程可见、请求可取消、测试抗行尾（2026-11-21）

审阅后的第一批功能增量，全部小而独立，四个动作合为一个版本。

- **详情页「当前临时会话」区新增「全部保留」**：一个按钮把当前所有临时会话一次性转为正式会话。宿主新增 `POST /api/dsh-temp-session.keep-all`（第 14 条路由），**单次 store 写入**——客户端循环逐个 untrack 意味着 N 次原子替换写盘，在 OneDrive 目录上肉眼可见地慢。列表为空时按钮自动退场，对空列表是幂等 no-op；目录不动（保留 ≠ 删除）。健康自检的必需路由清单同步到 14 条。
- **清理策略区显示「上次清理」与「下次定时清理」**：`lastPurge` 和 `schedule.nextRunAt` 两个字段状态载荷里一直有，页面却只把它们塞进反馈报告——退出 DSH 时到底删了几个、定时清理几点触发，从此在界面上直接可见。上次清理按既有口径合并 `removed + zombies`（对用户都等于「没了」）；点「立即清理」后报告**立即**刷新该行，不等轮询；改定时设置后 POST 响应自带新的 scheduler 状态，同样即时采纳。
- **超时请求真正取消**：`tempCall` 的看门狗以前只是「不再等」，底层 fetch 继续挂着——宿主卡死时超时请求会堆积。现在 `timeoutMs` 存在时挂上 `AbortController`，超时即 abort（无该平台 API 时自动降级为原行为）。链路下方已有 catch 吸收迟到的拒绝，不会产生 unhandled rejection。
- **测试源码正则抗行尾**：`tests/test_032.mjs` 一条源码守卫正则写死 `\n`，在 `core.autocrlf=true` 的检出上做一次 stash/checkout 就会假红（本次开发中实际踩到）。改为 `\r?\n` 并注明原因；复查全部测试，其余 `\n` 均在 `\s*\n\s*`（本就兼容）或普通字符串里。

回归：`tests/test_057.mjs` 21 项（真机路由驱动 keep-all：promoted 计数、目录存活、幂等 no-op、store 落盘；详情页按钮/两行信息渲染与交互；purge 报告即时刷新；abort 源码守卫）；`tests/test_020.mjs` 路由数 13→14 并补 keep-all 功能断言；`tests/test_045.mjs` / `tests/test_056.mjs` 的 status 夹具同步 14 条路由。`npm test` 35 个文件全绿；`npm run check` 通过。

---

## 0.8.4 — 全面审阅修复：乐观回滚、详情页管理当前临时会话、工具提示与文案（2026-11-21）

对整份代码再做一轮审阅后的修复与小步重规划。四条缺陷修复，两个功能增量，全部带回归（`tests/test_056.mjs`）。

### 缺陷修复

- **详情页设置保存失败不再「假保存」**（`lib/client.js` `persist()`）：开关的乐观更新在 POST 失败时只显示错误行，界面值停留在未保存状态——而 2.5 秒轮询只在配置版本号变化时才纠正，保存失败不推版本号，所以这个假值会一直挂着。0.7.4 已在 `setField()` / `writeDefaultMode()` 修过同类问题，这条路径漏了；现在失败即回滚到改动前快照。
- **「最近删除」计数行不再中英混排**：`共 N 条 · 12 MB` 里的量词「条」是硬编码，英文界面同样显示。改为双语词条 `trash.countUnit`。
- **插件后端重启后 TEMP 徽标自愈**：配置热重载轮询发现版本号变化（后端重启/热重载的信号）时只重放设置、不重读临时会话 id 列表，徽标会停留在旧后端的列表上直到刷新页面。现在一并 `refreshTempIds()`。
- **控制栏悬停提示降噪**：整条控制栏的 `title` 原本永远等于它的 aria-label（「侧栏布局」），鼠标扫过任何位置都弹同一个零信息提示。现在只在降级到 localStorage 模式时保留提示（「设置仅保存在本机」这条才有信息量）；顺带删除了从未被任何 CSS/JS 消费的 `data-dsbs-quick` 属性。

### 功能与交互

- **详情页新增「当前临时会话」区**：此前活跃的临时会话只能在侧栏里找到行、右键管理，而「最近删除」反而有整页管理界面——生命周期缺了「现在」这一页。新增区块列出所有临时会话（标题来自会话投影缓存，缺缓存退回 id），每条可**保留为正式会话 / 立即删除**（删除沿用回收站的「点两次确认」），并显示共 N 条 · 上限 M。宿主 `list` 路由新增 `?titles=1` 可选返回标题与 `maxKept`（侧栏轮询不带参，仍是轻量 ids）；页面以 ids-only 轮询侦测变化，集合变了才重读标题。侧栏与详情页共用同一批 `untrack` / `remove` 路由，两个入口行为一致。
- **「临时」按钮提示带实时数量**：悬停提示末尾追加「· N active / N 个临时会话」（数量来自宿主状态/列表，未知时不追加），点之前就能知道现在压着几个临时会话。
- **配置文件路径一键复制**：选项区底部的 `temp-session-config.txt` 完整路径从纯文本改为按钮，点击复制并闪现「已复制」——想去记事本里手改的用户不用再手动圈选一段换行过的长路径。

回归：`tests/test_056.mjs` 47 项，覆盖保存失败回滚（乐观先生效、失败后精确回滚并报错）、`?titles=1` 响应形状与缺缓存退化、计数行不再含裸「条」、路径按钮与复制反馈、Temp 提示数量随动作实时变化、删除的两步确认。`npm test` 34 个文件 **1122 项全绿**；`npm run check` 通过；`npm run compat` 契约矩阵 46/46。

---

## 0.8.3 — 窄栏入口：侧栏收成图标条时只留一枚菜单（2026-11-21）

侧栏被折叠到 56px 时，整条控制栏和「临时」按钮都会消失，布局三选一没有任何入口。这个版本只做一件事：留一枚图标按钮，弹一个小面板把被宽度挤掉的操作接回来。

- **新增 `[data-dsbs-rail-menu]`**（`lib/client.js`）：`<100px` 时控制栏整条隐藏，面板里是三种布局（复用 `setMode()`，仍为会话级）+ 新建临时会话（复用 `createTempSession()`）；`100–170px` 时控制栏还在、只有「临时」座位被藏掉，面板只放临时会话一项，不重复布局按钮。宽栏、插件页签占列时都不出现。
- **平台差异说明（重要）**：按宿主 0.2.2-rc.5 源码核对，展开态可拖 **264–420px**（`columns.ts` 的 `SIDEBAR_MIN/SIDEBAR_MAX`，宿主不画可见把手，只有 8px 光标区）；折叠时**浏览器版 / macOS 版是 56px 图标条**（本菜单生效），**Windows 桌面版是 0px**（`AppFrame.tsx:188` 对 `windowsTitlebar` 取 0，整条侧栏消失，本菜单不会出现）。100–170px 仅在浏览器抽屉（视口 <768、窗口约 150–220px）里可能出现，保留它是为了不让「临时座位被藏、又没有入口」变成死状态。
- **交互**：点按钮开面板并聚焦第一行；选中布局后立即关闭；Esc 关闭并回焦按钮；点外侧关闭；创建在途时该行置灰显示「正在创建…」，此时再点不会假装成功。折叠/拉宽离开窄栏会自动关掉面板，不留下固定定位的浮层。
- **真实宿主实测发现并修掉两处（离线测试查不出）**：① 打开时先进面板，但面板在下一帧才取消 `hidden`，`focus()` 打在 `display:none` 的后代上是空操作——现在先显示并定位再聚焦；② 面板 212px 三等分会把「官方默认」挤成两行，改成 **236px + `white-space:nowrap`**。
- **可访问性**：面板原本是 `role="menu"` + `menuitemradio`，但没有实现方向键，还用了 `menuitemradio` 不合法的 `aria-pressed`。改为 `role="dialog"`（触发按钮 `aria-haspopup="dialog"`）+ `radiogroup`/`radio` + `aria-checked`；语言切换时面板 `aria-label` 同步。
- **文档**：`使用说明.md` 3.2 写清拖拽的真实操作（贴住侧栏与聊天区之间那条线，264–420px）与两平台折叠后的差异；5.3 的「宽度约小于 170px」错误说法改正；`README.md` / `DETAIL.md` 中英同步，并附宿主常量与文件行号。
- 验证：`npm test` 33 个文件 **1144 项全绿**（`tests/test_055.mjs` 56 项）；`npm run compat` 契约 46/46；**用本机 DSH 安装目录跑 L5 冒烟 3/3 通过**（隔离 `DSH_HOME`，装得上 → 起得来 → HTTP 有响应）；另在真实 web 宿主里逐项点过（56px 出按钮、打开面板、选「浮层」立即生效、Esc 回焦、外侧点击关闭、展开到 280px 后按钮消失）。新增断言都做过对照：旧文档/旧 CSS/旧 ARIA 上分别 FAIL，修完转绿。

## 0.8.2 — 可靠性兜底：写操作不再卡死（2026-11-20）

0.8.1 发布后做的第一轮可靠性审阅。只修「点了没反应 / 点完出不来 / 提示缺失」，没有新增产品功能，也没有改变侧栏边界。

- **写操作与挂起读取都加 20 秒看门狗**。此前只有 `status` 有超时：Host 重启或代理卡住时，track / untrack / remove / config / purge / trash 这 6 个 POST 可能永不返回，purge 和回收站按钮会永久禁用，右键菜单则连失败 toast 都不弹。现在 6 个 POST 加 3 个挂起 GET（config 首读、trash 读取、配置热轮询）都走同一预算；正常慢请求不受影响，晚到的成功不会覆盖已显示的超时。
- **busy 态有可见文字**。回收站按钮此前只会变灰，页脚把 `busy` 显式排除在文字之外；现在执行中显示「处理中… / Working…」，按钮仍保持禁用。顺手删掉 3 条零引用的死文案 key，统一成一条 `trash.working`。
- **超时不等于失败**。新增统一 `opError()`：普通网络/HTTP 错误照旧报原因；看门狗超时则明确提示「后端可能仍在处理，先刷新核对结果再决定是否重试」，避免用户重复执行不可幂等的清理或删除。
- **文档跟上代码**。`DETAIL.md` 不再说删除后「静默跳过」：删除/保留/清理/恢复成功后已主动调用 `uiWorkspace().sessions.reload/refresh/reloadSessions/invalidate`，宿主没有这些 API 时插件也会同步摘掉自己的临时行标记。
- 回归：`tests/test_054.mjs` 新增 23 项断言，用永不 settle 的 fetch stub 和记录型假定时器打 20 秒看门狗；5 组变异实验每组都红得干净，逐组恢复后全绿。`npm test` 32 个文件全绿，`npm run check` 通过，`npm run compat` 契约 46/46、L5 因本机未探测到 DSH 记 SKIP（不算通过）。

## 0.8.1 — 回收站审阅：修掉「以为能恢复、其实没了」（2026-11-20）

0.8.0 发布后当天做了一次逐行审阅，下面五条都是**用一次性 `DSH_HOME` 实测复现**再修掉的，每条都有对应断言（`tests/test_050.mjs`，33 项）和变异对照实验。

- **大会话不再被静默永久删除**（数据）。旧逻辑里字节上限对最新条目同样生效：删一个 210MB 的临时会话，它被 park 进回收站后**同一次调用内**就被 prune 判死，而 `purge` 仍返回 `removed: 1`、界面显示「已清理」。现在最新一条豁免体积上限（超 200MB 也保留，且只保留它），旧条目照旧从最旧开始清。
- **批量删除只扫一次回收站**（性能）。旧逻辑每 park 一条就 prune 一次，而 prune 会对每条条目递归统计体积：回收站 8000 个文件时，清 5 个会话要 **2681ms**（空回收站 133ms），退出路径是同步的，20 个会话会卡住关窗。现在 `purgeSync` / `purgeAll` 传 `prune: false`，整批结束后只 prune 一次（实测 1 次）。
- **体积改为落盘缓存**。park 时把 `bytes` 写进 `meta.json`，列表和 prune 直接读它，不再每次列出都递归走一遍会话文件（8000 文件从 531ms 降到读 20 个小 JSON）。0.8.0 留下的旧条目没有 `bytes`，仍自动回落实测。
- **回收站里两个不可逆按钮改为二次确认**：「彻底删除」「清空」第一次点击只把按钮变成「确认彻底删除？」，再点一次才执行，5 秒自动取消。此前它们和「恢复」是两个一模一样的小胶囊紧挨着，而整个功能的存在理由就是防误点。
- **关掉「删除后保留」不再形成死状态**：旧版把整块列表连同「清空」一起隐藏，盘上那几百 MB 只能等过期。现在列表和清空始终在，只多一行说明「之后删除即彻底移除」；在详情页拨动开关后，回收站区块也会立即重新读取（此前要重进页面）。
- **文案纠正**：右键菜单的「把这个会话从磁盘删掉，无法恢复」改成「移到本机回收站，可在『最近删除』里恢复」；清理提示按开关分叉成「已移入最近删除 N」/「已清理 N」；`temp.menu.deleted` 改为「已移到最近删除」。
- 小修：`trash-empty` 分开报告 `removed` / `failed`（锁住的条目不再说「已清空」）；回收站路由会先热读配置（手改 `KEEP_DELETED=off` 后不再返回旧值）；健康徽章的必需路由从 9 条扩到 13 条（4 条 trash 路由全挂不会再显示 3/3 全绿）；`cp` 成功但原目录删不干净时保留回收站副本，不再连副本一起删掉。
- 文档：README 配置表补 `KEEP_DELETED` / `KEEP_DELETED_DAYS`；DETAIL 的「全部 9 项」改为 11 项；四处「默认在退出 DSH 时删除」补上「数据会在本机回收站留 7 天」。
- 回归：`npm test` 28 个文件全绿（976 → 1010 项），`npm run check` 通过，`npm run compat` 契约 46 + L5 3/3。变异实验 8 组，每组只让对应断言变红：撤掉最新条目豁免 → A1 四条红；恢复逐条 prune → A3 一条红；取消体积缓存 → A2 一条红；取消二次确认 → B1 两条红；恢复「关闭即隐藏列表」→ B3 两条红；去掉配置热读 → A6 一条红；去掉开关后的重读 → B4 一条红；清理提示退回旧文案 → `test_023` 两条红。

### 0.8.1 第二轮审阅（同上版本，未单独发布）

修完第一轮之后又回头审了一遍，下面六条是剩下的问题，同样都先写红断言再改实现（`tests/test_051.mjs`，44 项）：

- **重试不再造出第二条条目**（会让人卡住的那条）。`rename` 失败走 `cp+rm` 时，如果 `rm` 只删了一半就失败，旧逻辑保留完整副本并报「稍后重试」——但原目录是「半删且仍在」状态：再删一次会生成**一条同 id 的新条目**（时间戳不同），而用户去恢复又会撞上「同名会话已存在」被拒。现在 park 会按 `(会话 id, 工作区)` 找回自己上一次建的条目，把剩下的文件**合并**进去再删原目录；同步（退出）与异步两条路径都改了。条目沿用旧 key（key 只是个标识，没有东西解析它），但 `deletedAt` 从这次重试重新算——沿用旧期限会让一条刚删的数据在几小时后过期。恢复被拒时额外返回 `code: 'target-exists'` 和**那个目录的绝对路径**，界面上直接显示，用户知道该把谁挪走。
- **回收站列表不再只有 UUID**。park 时从宿主的投影缓存里取出这条会话自己的标题（先剥掉每条都一样的 `Today is <date>.` 前缀、压成一行、截到 80 字），写进 `meta.json`；列表以标题为主、`id · 工作区 · 时间 · 大小` 为辅。没有缓存（旧条目、被清理过）时退回显示 id，不报错。
- **上限和总量都摆出来**。`GET trash` 现在返回 `caps`（20 条 / 200MB）和 `totalBytes`，页脚显示「共 N 条 · 占用 X · 上限 20 条 · 200.0 MB」，并加一句「超出时从最旧的清，最新一条不受体积限制」。20 条上限此前是**静默**淘汰，用户只看到条目莫名消失。
- **超过单条上限的条目会自报家门**。单条 >200MB 的条目带 `oversize: true`，列表里多一行「超过单条体积上限，仍保留到期满」——这是「宁可占盘也不删掉」的取舍，现在写在界面上而不是只写在文档里。
- **确认态不再残留**：arm 之后会多出一个明确的「取消」按钮（点它不发任何请求）；任何其它回收站操作（恢复、清空、另一行的删除）都会立即解除 arm。此前 arm 只靠 5 秒超时自愈，中途点了别的行，那个「确认彻底删除？」还挂在那儿，下一次误点就直接执行。
- **`meta.bytes` 是普通 JSON，手改能绕过体积上限——这条不改，写进文档**。列表刻意读缓存值而不是每次递归走盘（实测 8000 文件从 531ms 降到读 20 个小 JSON），要发现「被手改过」就得重新走一遍盘，正好抵消掉这个优化。回收站就在用户自己的用户目录里，手改属于自担风险；`DETAIL.md` 里已写明。
- 回归：`npm test` 29 个文件全绿（1010 → 1054 项），`npm run check` 通过。变异实验 13 组，每组只红对应断言：关掉条目复用 → A1 六条红（含退出路径两条）；关掉标题抓取 → A2 四条红；路由去掉 `caps` → A3 两条红；`oversize` 恒 false → A4 一条红；恢复拒绝丢掉 code/路径 → A5 两条红；meta 不写标题 → A2 五条红；删掉「取消」按钮 → B2 两条红；动作不再解除 arm → B3 一条红；列表改回显示 id → B1 一条红；页脚去掉 caps → B4 一条红；复用沿用旧期限 → A1 / A6 各一条红；恢复拒绝不再解释 → B7 一条红；caps 无守卫直接渲染 → B6 一条红。
- 代价（实测，一次性 `DSH_HOME`，本机）：退出路径为 20 个会话抓标题会多花约 80ms（157ms → 241ms，三个样本取中位数；缓存约 40KB/条）。这是同步阻塞路径，量级可接受，但如果以后有人抱怨退出变慢，先量这里。

### 0.8.1 第四轮审阅（同上版本，未单独发布）

又独立审了一遍，同样先写红断言、再改实现（`tests/test_052.mjs` 4 项、`tests/test_053.mjs` 7 项）：

- **体积淘汰改成连续截断**。旧循环遇到放不下的条目只是跳过它，然后继续收下后面更小、但更旧的条目。实测一次删除序列（最新 10MB、第二新 300MB、另两条各 1MB）后留下的是「最新 + 两个最旧」，而刚删的 300MB 被永久清掉——与文档承诺的「从最旧开始清」正好相反。现在一旦某条放不下，它和所有更旧的条目一起清掉；最新一条仍豁免体积上限。
- **退出路径真的用上手改的天数**。`purgeOnExit` 的注释说同步重读会带上 `KEEP_DELETED_DAYS`，代码却只传了 `KEEP_DELETED`；临退出前把 7 天改成 1 天，3 天前的过期条目仍按旧窗口算，要多活一次启动。现在两个值一起进同步 purge。
- **没有临时会话时也跑保留清理**。`purgeSync` 在 `tracked` 为空时直接返回，整个跳过 retention——那些只在别处清过临时会话的机器，过期条目能一直躺在盘上。现在早退前也 prune 一次。
- **改保留天数后列表立即刷新**。拨开关会重读回收站，改天数只写盘不重读，行上仍显示旧期限直到重进页面。现在两者都触发重读。
- **计数与并发的小修**：prune 删除失败时仍把该条目计入 `kept/bytes`（它确实在盘上、仍可恢复）；`trash-empty` 在列目录与删除之间若条目已被别的动作拿走，不再虚报一条「已清空」；`GET /trash` 的注释改为如实说明它会应用时间/条数保留（此前自称 read-only，与实际行为冲突）。文档同时写清「单条超 200MB 只在它仍是最新一条时保留」。
- 回归：`npm test` 31 个文件全绿（1054 → 1065 项），`npm run check` 通过。变异实验 5 组，每组只红对应断言：撤掉连续截断 → A1 两条红；退出路径不传天数 → A1 一条红；空 tracked 早退不 prune → A2 一条红；prune 忽略同步覆盖 → A1 一条红；天数改动不刷新 → B1 一条红。

**已知边界（未修）**：恢复成功后若删不掉空的回收站目录（文件被占用），会留下一行 `data/` 已被移走、但条目目录还在的幽灵记录，点恢复报「has no data」，只能用「彻底删除」清掉。本机无法用黑盒可靠模拟这个删除失败（只读属性挡不住 Windows 的 `rm`），所以没有自动化断言。真遇到时直接在「最近删除」里彻底删除那一行即可，数据没有丢失。

## 0.8.0 — 删掉的临时会话可以捡回来（2026-11-20）

- **删除改为「先移入本机回收站」，误删可在详情页恢复**。此前删除是 `rm -rf`（`temp-session-host.mjs` 的 `removeSession` / `removeSessionSync`），没有回收站也没有副本——这是本插件唯一不可逆、且会丢掉用户数据的动作，而丢了会话的人不会来提 issue，他们会直接卸载。现在删除时把会话目录**移动**（同卷 rename，跨卷回落 copy+remove）到 `DSH 数据目录/dsh-sidebar-suite/trash/<时间戳>-<会话id>/`，带 `meta.json`（id、workspace、删除时间、原因）与 `data/`。
- **默认开、默认保留 7 天**，可在详情页或 `temp-session-config.txt` 改：`KEEP_DELETED=on` / `KEEP_DELETED_DAYS=7`（1–365）。硬上限 20 条 / 200MB，超出的从最旧开始清；到期条目在下次启动或打开详情页时自动清掉。关掉即回到 0.7.x 的「直接删除」。
- **详情页新增「最近删除」区**：列出条目（会话 id · 工作区、删除时间、占用大小），可**恢复**、**彻底删除**、**清空**。恢复后的会话回到原工作区、内容逐字节一致，并**变成普通会话**（不再算临时，不会在下次退出时又被删）。
- **语义诚实**：「临时」仍然是「退出就消失」，这一项只让误删可以撤销；恢复出来的是普通会话，界面上写明了。`poll`/文案不会声称「已彻底删除」却留着副本。
- 安全边界：恢复路径单独用 `restoreTarget()` 校验（不复用删除用的 `safeSessionDir`——那个要求目标已存在，恢复时恰恰不存在）；`meta.json` 是被用户可写的普通文件，其中 `workspace` 为 `..`、或 key 里带路径穿越，一律拒绝；目标已存在同名会话时拒绝恢复并保留条目。删除失败**不会**降级成永久删除（返回 0，调用方按「还在，稍后重试」处理）。
- 路由：新增 `trash`（GET）/ `trash-restore` / `trash-delete` / `trash-empty`（均 POST），共 13 条。
- 回归：`tests/test_049.mjs` 26 项（备份落盘、内容一致、恢复后不再被追踪、开关关闭走直删、过期清理、`..` 与穿越 key 拒绝、目标已存在拒绝、清空）。做了两组对照实验：把异步删除分支改成永不备份 → 11 条精确变红；把过期判断改成 `if (false)` → 2 条精确变红；恢复后全绿。更新 `test_020`（路由数 9→13）、`test_022`（路由数、模板新增两个键）、`test_045`（状态断言不再按 useState 下标，改为按载荷特征查找）。
- 验证：`npm test` 24 个文件全绿、`npm run check` 通过。

## 0.7.5 — 让复制的反馈自带落点（2026-11-19）

- **「复制反馈内容」不再「复制完不知道发给谁」**：此前报告自动带上版本、系统、布局、最近错误，却没有任何收件地址，文案只说「粘到任何能联系到我的地方」——而作者事实上只在 GitHub 收反馈，形成死状态。现在报告末尾附 `https://github.com/YONAN1269/dsh-sidebar-suite/discussions` 和 issue 地址；`feedback.where` 文案同步改成明确的两条落点。用的是仓库已开启的 Discussions（实测 `has_discussions: true`、主页 200），不引入新入口，三个按钮语义不变。`test_023` 新增 3 条断言（报告含 Discussions 地址、含 issue 地址、文案给出落点），并做了删行变红的对照实验。
- 同步更新 README / 使用说明 / DETAIL 三份文档里「复制反馈内容」的落点说明；版本号 bump 到 0.7.5。
- **新增宿主兼容巡检一键脚本** `npm run compat`：把已有的契约矩阵（`test_047`）和 L5 冒烟串起来，DSH 每次出新 rc / 改 CLI 打包布局时跑一次即可知道插件是否还兼容。绿 = 契约与启动链路都没退化；红 = 明确指出挂在哪一条；本机无 DSH 时 L5 记 SKIP（不算通过也不误报失败）。`--matrix-only` 可只跑不需宿主的契约矩阵。脚本只编排、不复制断言，避免巡检逻辑与被测逻辑漂移；已做改坏 rc.5 打包值的对照实验（精确变红 → 恢复转绿）。工具脚本不进 npm 发布包。
- 验证：`npm test` 全绿、`npm run check` 通过、L5 冒烟 3/3（`--cli D:/program/harness`）；`npm run compat` 完整模式与 `--matrix-only` 均通过。

## 0.7.4 — DSH 0.2.2 rc.1–rc.5 适配与发布前审阅修复（2026-11-19）

承接 screenshot 里列的 5 条完善方向（第 1 条自检徽标已在 0.7.3 完成），完成 2–5 条，并经两轮发布前审阅修复。已在 **DSH 0.2.2-rc.5** 真机与 L5 冒烟验证。回归见 `tests/test_046.mjs`（27 项）、`tests/test_047.mjs`（25 项）、`tests/test_048.mjs`（12 项）与更新后的 `test_020` / `test_022` / `test_030` / `test_032`。

- **会话右键菜单接入宿主统一扩展**：rc.1 起宿主提供 `ctx.contextMenus.register()`，会话行右键由它接管（并 `stopPropagation()`），原 DOM `contextmenu` 监听在 rc.1+ 根本收不到事件。现在所有宿主上注册一条 `target: 'session'` 的原生菜单贡献，`resolve()` 只对临时会话行返回动作；旧宿主（无该服务）自动保留原 DOM 菜单作回退。keep/delete/openDir 三个动作由 `tempMenuActions()` 单点定义，两条路径不再各写一份。
- **新增「打开会话目录」动作**：宿主侧新增只读 `/api/dsh-temp-session.paths` 路由（只返回被跟踪会话的绝对路径，复用现有安全路径守卫）；客户端用宿主公开 Remote `remote.session.openWorkspacePath({ action: 'reveal' })` 在资源管理器里显示目录，失败或不可用时退回复制路径到剪贴板并给出提示，不再出现「点了没反应」。
- **自建页签条让位给宿主原生收纳**：rc.2 起宿主用 `sidebar.panellist.actions` 提供原生「更多」入口，与自建 strip 语义重叠。检测到该能力时隐藏自建 strip、清掉可能残留的 active tab（避免「面板还在、却没有任何页签能点出去」的死状态），并在 `registerTab()` 里给消费方一次性迁移提示；API 保留兼容，旧宿主行为不变。
- **宿主契约从人工 CDP 验证改成可重复测试矩阵**：`tests/test_047.mjs` 用表驱动的 rc.1 / rc.2 / rc.3 / rc.5 四个宿主画像驱动真实 bundle，逐项断言侧栏解析、控制栏归属、会话插槽注册与原生菜单注册是否与宿主能力一致；新增画像只需加一行，不需要再连 CDP。
- **健康徽标补充策略信息**：详情自检里新增两行只读信息——当前右键菜单走原生还是 DOM 回退、页签条走自建还是宿主收纳；这两行不计入 `n/3` 契约通过数，也不会把徽标变红。

### 发布前审阅发现的缺陷（同日修复，随 0.7.4 发布）

- **打开目录在真实宿主里会直接失败**：宿主 `openWorkspacePath` 的 Remote 声明了 cancellation，服务端会读 `signal.aborted`；原调用没传 signal，导致 reveal 必然失败、永远走「复制路径」兜底。现在传 `AbortController.signal`，与宿主官方插件一致（`lib/client.js`）。
- **复制失败却提示「路径已复制」**：异步剪贴板 API 的 Promise 结果原本被忽略，`copyText()` 永远返回成功。现在返回 `Promise<boolean>` 并等待结果；复制真的失败时把完整路径显示给用户，不再假报成功（`lib/client.js`）。
- **原生菜单启用后 DOM 回退没有关闭**：两套菜单可能对同一次右键同时响应，健康徽标却声称走原生。现在原生注册成功即拆掉 DOM 监听，两个入口都按 `tempMenuMode` 判定（`lib/client.js`）。
- **热重载时原生菜单没有注销**：disposer 原本只交给宿主 effect，旧 run 的 teardown 管不到它，第二次注册会因 id 重复而失败回退。现在同一个幂等 disposer 同时交给 teardown 与宿主作用域，重复 teardown 也不会误删新注册（`lib/client.js`）。
- **「打开目录」在链接工作区误报目录不存在**：链接目录被删除守卫拒绝，因此路径查询返回空数组、页面提示「目录已经不在磁盘上」，与删除提示给出的路径自相矛盾。现在路径接口在此场景下返回仅供展示/定位的准确路径（绝不喂给删除逻辑），并收紧链接判定：只有 realpath 真的离开 sessions 根才算这类情况，ACL/IO 错误仍走重试（`lib/temp-session-host.mjs`）。
- **页签让位只检测一次**：宿主若在插件 apply 之后才填充 `sidebar.panellist.actions`，自建 strip 会一直留着。现在订阅该 slot，出现原生收纳时即时隐藏并清掉残留选中页（`lib/client.js`）。
- **两条永远通过的假断言**：`test_046` 里 `check(..., () => true)` 已改成真实断言（原生模式进入健康详情、动作带 run 回调）；新增 `test_048.mjs`（12 项）直接调用真实路由处理器，覆盖普通/链接会话、未跟踪 id、四种遍历输入与只读方法，并实测 DOM 回退关闭、teardown 幂等、slot 延迟填充与复制失败提示。
- **L5 冒烟脚本认不出 rc.5 安装布局**：rc.5 把宿主 CLI 从 `resources/app.asar/...` 挪到真实的 `resources/app/...`，`scripts/smoke-l5.mjs` 只认旧路径，导致发布前自检误报「找不到 dsh 启动器」。现在两种布局都识别，`--cli` 传安装目录或 exe 均可；本机实测 DSH 0.2.2-rc.5 可完成启动与 HTTP 探测。
- **文档真机版本更新**：`README.md` / `DETAIL.md` / `使用说明.md` 的验证版本从 rc.3 更新为本机当前 rc.5，并明确 rc.5 只是解包布局变化、插件消费的侧栏 / 插槽 / 菜单 / Remote 契约未变。

### 第二轮审阅修复（随 0.7.4 发布）

- **反馈报告泄露本地绝对路径**：链接工作区的删除提示把完整路径写进了 `lastError`，而「复制报告 / 提 issue」会把它原样塞进公开 issue URL。现在 host 只把不带路径的原因写进 `lastError`（路径仍保留在本地 toast / 路由响应里），客户端再对反馈文本做一次绝对路径脱敏为 `<path>`；`test_023` 验证复制文本与 issue URL 都不再含本机路径。
- **健康徽标只看路由数量，会误报 3/3**：原来 `routes.registered > 0` 就算私有接口通过，9 条里任意一条注册失败仍显示绿灯。现在 status 返回实际注册的 `routes.paths`，客户端逐项核对 9 个必需端点，缺 `paths` 等路由会转红并列出缺哪条；`test_045` 用真实组件验证了缺路由时的 2/3 与明细。
- **契约矩阵覆盖不实**：`test_047` 原把 rc.5 写成与 rc.3 完全相同的画像，且 rc.1 也注入了它并不具备的 `remote.session`。现在补齐 rc.4 画像，明确 rc.3/rc.4/rc.5 客户端契约相同、差异只在 rc.5 的 `resources/app` 解包布局；rc.1 不再注入 Remote，并通过真实 DOM 回退验证「复制路径」而不是空动作；rc.2+ 则验证 reveal 调用确实带取消信号且不走剪贴板。rc.5 的解包差异由 smoke 工具断言覆盖。
- **继续替换快照式断言**：上一轮标记的 `setField` / `tempCall` 看门狗 / schedulerCtx 归属仍以源码快照为主；本轮新增的缺路由、脱敏、Remote/复制分支均改为驱动真实组件或真实路由处理器的行为测试。剩余快照断言已在 `test_045` / `test_047` 中明确标注为工具/源码守卫，不再冒充行为验证。

### 发布前终审（2026-11-19）

- 独立终审复查了 `setField` 回滚、`tempCall` 看门狗 settled 守卫、schedulerCtx 归属、saveStore 失败回滚、异步 `ctx.inject` 时序、打包白名单与版本号一致性：**未发现新的功能缺陷**，前两轮遗留项经读码确认逻辑正确，无需改动。
- 仅做发布规范化：`package.json` / `lib/client.js` 版本统一 bump 到 0.7.4，CHANGELOG 补发布章节；顺手修正 `test_046` 一条断言名实不符的文案。
- 打包白名单不含任何运行时凭据；文档中残留的 `%USERPROFILE%\...` 仅为标注本机源码目录、桌面修复脚本与历史备份目录的示例路径，非真实私密数据，保留。

## 0.7.3 — 审计修复与契约自检徽标（2026-11-18 追加）

本轮修可靠性缺陷，并在详情页新增一个自检徽标；未 bump 版本号、未打包、未发布。回归见 `tests/test_043.mjs`（22 项）、`tests/test_044.mjs`（20 项）、`tests/test_045.mjs`（26 项）与更新后的 `test_039`。

- **热重载后定时器脱离生命周期**：`bindSchedulerEffect()` 的一次性 `schedulerEffectBound` 守卫会把 effect 绑在旧 ctx 上；新 ctx 接管后，旧作用域的 disposer 反过来停掉新定时器，造成「插件已禁用却仍在每 30 秒删临时会话」。现在按 `schedulerCtx` 判定归属，只对当前 ctx 绑定，旧 cleanup 变成 no-op（`lib/temp-session-host.mjs`）。
- **status 请求永不返回导致临时功能整页失效**：`loadTempStatus()` 的 fetch 加了 20 秒看门狗；超时走既有退避重试，不再让 `tempStatusPending` 永久为 true（`lib/client.js`）。
- **配置写入失败却显示成功**：`setField()` 和详情卡的 `writeDefaultMode()` 在 `mutate()` 抛错、返回 false 或以 rejected promise 失败时，回滚内存值并弹出错误提示，不再出现「开关/默认布局看着生效、重启后回退」（`lib/client.js`）。

- **详情页新增「宿主版本 / 契约自检」徽标**：标题旁显示 DSH 桌面端版本（取自已有 status 接口，缺失显示 `?`）和 `通过数/3`，点开后逐项列出侧栏结构、会话按钮插槽、私有接口的状态与具体原因；红色时提供「重新检测」并指引到已有的反馈区。三态用文字 + 数字 + 颜色共同表达，避免只靠颜色分辨；尚未检测完不显示绿色，避免假成功。插槽注册与 status 请求原本吞掉的错误现在会记录并显示（`lib/client.js`）。
- **链接工作区里的临时会话永远删不掉（同轮后续修复）**：`indexSessionIds()` 会跟随 junction / 符号链接看到里面的会话，而删除守卫 `safeSessionDir()` 明确拒绝穿过链接删除——两条规则各自都对，合起来却是死状态：每次启动和每 30 秒定时都无限重试，页面点「删除」也没反应。现在**保留安全拒绝**（不放宽到 sessions 根目录之外），但准确识别这一种情况：停止重试、把 id 移出跟踪，并把可直接打开的具体路径返回给用户手动处理；手动删除、定时清理、退出清理三条路径行为一致（`lib/temp-session-host.mjs`）。

## 0.7.3 — 再排查：存储完整性、僵尸 id 与操作反馈（2026-11-17）

0.7.2 发布后继续深挖宿主端与客户端，修一组真实缺陷；功能面不变。回归见 `tests/test_042.mjs`（29 项）。

### 宿主端（`lib/temp-session-host.mjs`）
- **存储读失败不再静默清空** — 跟踪文件读取/解析失败（写盘中途崩溃产生的半截 JSON、瞬态文件锁）过去被当成「没有临时会话」，退出钩子直接跳过、下次成功写盘把原始记录覆盖掉，所有临时会话被永久保留。现在非 ENOENT 错误保留上一次已知良好的列表并上报；ENOENT（真首次运行）才置空。
- **原子写** — `saveStore()` 改为写同目录 `.tmp` 再 `rename` 覆盖，崩溃不会留下半截 JSON。`saveConfig` 仍保持行级写（保留注释）。
- **id 去重** — 加载时对 `sessions` 去重，避免重复 id 造成重复删除/虚假失败、并让 `maxKept` 计数虚高而误裁新会话。
- **僵尸 id 出队** — 目录确实已不存在的跟踪 id（上次崩溃删了文件但没写回 store、或被宿主归档）过去每次清理都报「失败」且永不移出，使计数虚高、`maxKept` 提前裁剪。现在按「磁盘上是否真的没有该会话」判定；仅在会话根目录可读、且没有任何同名条目（含被守卫拒绝的符号链接）时才当僵尸清除，读目录失败或被拒绝的链接仍保留待重试。
- **回滚以磁盘为准** — 写盘失败时重读文件：读成功就以文件为准（把调用前快照并上去会把并发 `untrack` 刚「保留」的 id 复活，退出时删掉用户刚救下的会话）；只有文件读不到才退回快照。Windows 对「路径被一个文件挡住」报的是 `ENOENT` 而不是 `ENOTDIR`，所以另用 `storeLoadOk` 记录「这次到底读到了没有」。
- **定时任务重读配置** — `schedulerTick()` 每次先 `refreshConfigIfChanged()`：没有网页轮询时，手改 `SCHEDULE_DELETE` 也能即时生效，不再用开机时的陈旧开关删会话（退出路径 0.7.2 已修）。
- **`probe` 等就绪** — `probe` 路由改为 `await ensureReady()`，冷启动后第一个诊断请求也能拿到已加载的会话列表。
- **`configRevision` 名副其实** — 重复 `register()`（热重载）不再无条件 +1，只在配置字段真正变化（或首次加载）时递增，避免轮询客户端空转重应用。

### 客户端（`lib/client.js`）
- **「立即清理」后刷新 UI** — 手动清理成功后重新拉取临时 id 列表并刷新会话行，已删会话的「临时」徽标与右键菜单不再残留到整页重载。
- **track 失败不再谎报** — 会话已创建但登记为临时失败时，回滚「临时」徽标并用准确文案说明「退出 DSH 时不会删除它」，不再显示自相矛盾的「创建失败」。
- **反馈按钮态一致** — 「市场评论」按钮在生成反馈的 `working` 态一并禁用，与相邻的「复制 / 提 issue」一致。
- **`showQuickSwitch` 默认值终于对上文档** — 代码自 0.1.3 起默认 `true`，而 README/DETAIL 从 0.2.9 起一直写「默认不出现」。现在默认 `false`：换布局按钮只是把胶囊里已有的三个布局按钮再循环一遍，属纯冗余入口，默认不再显示；想用的人设 `showQuickSwitch: true` 打开。已显式配置过的档案不受影响。
- **第三方页签不再「点了没反应」** — 别的插件占满整栏时，控制栏的布局胶囊和动作按钮改的是被该页遮住的分组，点了看不到任何变化。现在打开第三方页签时把它们一并隐藏，只留页签条作为出口；页签悬停时显示「这一页由 X 提供」（`tabs.own` 文案 0.3.0 就定义了却从没用上）。
- **窄栏图标可分辨** — 「换布局」的图标原本是两个环形箭头，列宽收窄到只剩图标时和「切分组」的直线交换箭头几乎分不出。改为四宫格布局标记，两个动作各有各的视觉词汇。
- **时间输入不再「看着禁用却能改」** — 关闭「每天定时清理」时，时间框只是变淡（`opacity .55`），却仍能编辑并保存，视觉与能力互相矛盾。现在真正 `disabled`。

### 同轮复审（存储写入与清理热点，`lib/temp-session-host.mjs`）
- **并发写不再互相踩塌** — 固定的 `.tmp` 文件名让两次并发保存的第二条 `rename` 必然 `ENOENT`，还会在数据目录里留下含全部会话 id 的残影。改为每次写用唯一名字（pid+序号）、`finally` 清理、`rename` 被拒（杀软扫描、OneDrive 占位）时回退直接写；退出路径的 `purgeSync` 也改成同步 `tmp+rename`，那是全流程里最容易被强杀打断的一次写。
- **读不出来的 store 不再被第一次写覆盖** — 启动时内存里还没有列表，损坏文件等同于「空」；随后的 `track` 把旧 id 全盖掉，那些会话从此永远不被清理。现在覆盖前先把原文件移到 `.corrupt` 留档。
- **一次清理只扫一遍目录** — 过去每个 id 都要全量 `readdir`（默认保留 20 个就是 400+ 次同步 fs 调用，OneDrive 上能感到卡顿）。改为整轮建一次索引、删除时增量更新；索引不可信（某工作区读不了）时回退逐次扫描。
- **符号链接工作区里的会话不再被当僵尸** — 工作区目录本身是 junction/symlink 时会被整段跳过，其下会话被判定「磁盘上已不存在」而静默丢掉跟踪。
- **僵尸与真删分开计数** — `removed` 只统计本次真正删掉文件的 id，僵尸记入新的 `zombies`；客户端把两者相加显示「已清理 N 个」，不再出现「删了 20 个」却一个字节都没动的情况。
- **只改无关设置不再推迟清理** — 定时清理因「会话正在使用」而计划 5 分钟后再试，此时动任何一个开关（或热重载插件）都会清掉这个计划，把它推到第二天。现在只有真正改了定时开关或时间才重置。
- **其他** — 会话 id 不再允许 `:`（NTFS 上那是「文件:流」分隔符）；`archiveSession` 返回 `false` 时不再谎报「已隐藏」；投影缓存只在真的删掉会话后才清理；开机清理跑完才置位，异常时下一个请求还能重试。

### 同轮复审（客户端交互与卡死状态）
- **创建临时会话不会再卡死按钮** — 宿主收了请求却不回（重启中、代理挂住）时按钮会永久禁用，之后每次点击都静默返回。加 20 秒看门狗，超时释放并提示。
- **慢机器上不会再把已建好的会话报成「创建失败」** — 旧宿主路径轮询 5 秒后直接判负，而会话其实已经建出来（结果既没登记为临时、又留下来成了普通会话）。超时前再取一次差集。
- **隐藏的页签不会再锁死侧栏** — 当前页签被消费方以 `hidden: true` 重注册时，控制栏、页签条、两个分组会一起消失，没有任何出口；而这个 id 存在 `localStorage` 里，每次启动都复现。现在 `hidden` 的页签不能占据整栏，直接按孤儿页签回退。
- **侧栏重建瞬间不再留一片空白** — 根节点解析不到时提前返回，`data-dsbs-ptab` 会残留，新根节点一出现两组就被 `!important` 遮住，直到下一次心跳。
- **窄栏不再留一根孤立竖线** — Cycle 在窄栏是被 CSS 隐藏的（不是 `hidden` 属性），分隔线仍以为右边有内容。
- **收起轨道展开时不再覆盖刚选的布局** — 在插件详情页选的布局会被「进入轨道前的快照」无条件盖回去，看起来像设置没生效。
- **其他** — 控制栏的 `hidden` 补上对应的 CSS 规则（bar 自带 `display:flex`，浏览器默认的 `[hidden]` 根本盖不住它）；`getLayout().activeTab` 与 `getActiveTab()` 口径一致；`tab.close()` 在非激活时也真的注销（原来什么也没做）；`maxKept` 填 0 或非法值时回填真实值，不再显示一个没保存的数字；停在插件页时创建临时会话会先交还整栏，否则新会话行被该页遮住。

### 文档与发布工程
- `RELEASING.md` 更新为「0.7.1 起已用 trusted publishing，日常发布=三处 bump+推 tag」；`release.yml` 增加 tag 名与 package.json 版本一致性守卫；`ci.yml` 的 tarball 清单检查纳入三个运行时脚本、配置模板与 patch；`test_030` 增加「CHANGELOG 必须有当前版本章节」断言，并修正一条名实不符的断言名。
- `README.md` / `DETAIL.md` 的真机验证版本 rc.2 → rc.3；`使用说明.md` 版本号 → v0.7.3，配置行号 38/53 → 45/60（与本文表格一致）。

## 0.7.2 — 再修四个「临时会话必删」漏洞（2026-11-17）

对 0.7.1 的跟进审阅又发现四处真实缺陷，都直接削弱「临时 = 退出即删 / 保留即永久」的承诺。本版功能面不变，只补可靠性。回归见 `tests/test_041.mjs`（17 项，含一次变异验证）。

- **退出删除忽略配置**：退出钩子原先无条件 `purgeSync`，`DELETE_ON_EXIT=off`（文档承诺"临时会话变普通会话"）形同虚设——用户以为留下的对话在退出时被删。改为 `purgeOnExit()` 退出时同步重读磁盘配置，off 则跳过；配置读不到时按默认 on 处理（安全方向）。
- **写盘失败被吞、路由仍报成功**：`saveStore()` 原只记 lastError 不返回失败，最典型后果是右键「保留为正式会话」后写盘失败、UI 报成功，下次启动却读回旧 id 把该会话删掉。现在写盘失败返回 false，purgeAll/removeOne/track/untrack 一律回滚内存态并返回 `ok:false` + 原因。
- **并发清理吞掉新会话**：`purgeAll()` 原用循环开始时的快照推导 `kept` 并整体覆盖 `state.tracked`，清理执行期间（有多次 await）新建的临时会话 id 会被抹掉、再也不会被清理。改为只从当前列表增量移除真正删掉的 id。
- **状态加载三次失败即永久放弃**：客户端 `loadTempStatus()` 原在 3 次失败后彻底停止，冷启动/热重载时的短暂竞态会让临时徽标和右键菜单整页失效。改为带 1s→15s 封顶退避的持续重试，直到成功。

---

## 0.7.1 — 启用 npm trusted publishing（2026-11-17）

纯发布工程版本，插件功能与 0.7.0 完全一致。目的：用一次真实发布验证 OIDC trusted publishing 链路，为 bypass-2FA token 在 2027-01 停用做准备。

- 在 npmjs.com 为 `dsh-sidebar-suite` 配置 GitHub Actions trusted publisher（`YONAN1269/dsh-sidebar-suite` / `release.yml`，允许 `npm publish`），账号开启 2FA。
- 修正 `.github/workflows/release.yml`：`contents: write`（gh-release 建 Release 需要）、发布前真正 `npm pack` 生成 tgz 附件、更新已启用注释。
- 修正 `RELEASING.md`：验证发布前必须先 bump 三处版本号，避免"版本已存在"403。
- 本次由 GitHub Actions 用 OIDC 免 token 发布，成功后包页应出现 provenance 徽章。

---

## 0.7.0 — 可靠性版本：补上「临时会话必删」承诺的三个漏洞（2026-11-16）

> 这是 0.6.1 代码审阅后的**契约版本**。核心能力面不变，重点是让「临时 = 退出即删」这句承诺在所有失败路径上都成立，并把变更接口收紧。同时准备好 npm trusted publishing 的迁移（凭据配置需作者本人完成，见 `RELEASING.md`）。**这次动的是宿主端 `lib/temp-session-host.mjs`，装完要从托盘彻底退出 DSH 再开一次才生效**（客户端只改了 `VERSION` 常量，无功能变化）。

### P1 — 单条删除遇到「文件被锁 + 已归档」不再永久残留

- `removeOne()` 原先把 `hidden`（只归档了行）也当成删除成功、把 id 移出 `temp-sessions.json`。结果右键「立即删除」遇到锁文件时，行从侧栏消失，但磁盘上的会话内容永远不再被清理 —— 直接违背「临时会话退出即删」。
- 现在只有 `gone`（目录真的删掉、确认为空）才移出跟踪；`hidden && !gone` 保留 id、计入 `failed`，下次启动继续重试，与 `purgeAll()` 一致。返回值新增 `retried: true`，客户端仍显示「文件被占用，下次启动再删」。`removeOne` 的隔离测试见 `tests/test_040.mjs`。

### P2 — 溢出裁剪与变更路由

- **MAX_KEPT 裁剪**（原来 `splice` 掉最旧的就删，无保护）：现在只把**最旧的 overflow 个**当候选，正在使用（`ACTIVE_WINDOW_MS`，与定时清理一致）的会话跳过、删除失败的保留 id 供下次重试；绝不会因为跳过旧会话而转去删更新的、仍被需要的会话。
- **变更类路由收成 POST-only**：`track` / `untrack` / `remove` / `purge` 不再接受 GET（原来 `['POST','GET']`），避免被图片标签、预取等 GET 触发删除。`status` / `list` / `config` / `probe` 的 GET 保留。

### P3 — 诊断与测试隔离

- `safeSessionDir()` 的 `realpath` / `lstat` 守卫在被 ACL、杀软或 OneDrive 占位目录挡住时，不再静默返回空串，而是把带错误码的原因写进 `lastError`（`ENOENT` 属正常 miss，不记）——失败报告现在能说明原因。
- `tests/test_020.mjs` 的 dsh-deepseek-chat 兼容检查改为**显式 opt-in**（设 `DSH_CHAT_CLIENT`），离线回归不再读取真实机器上的安装，避免受限环境下 `EPERM` 直接崩掉整套测试。
- 提交 0.6.x 遗留的 `lib/client.js:3257` 配置页长路径换行修复（`overflowWrap: 'anywhere'`）。

### 文档与发布工程

- `DETAIL.md` 新增「宿主兼容与契约表」：集中记录插件依赖的 DSH DOM/插槽约定、各自对应的 rc.2/rc.3 版本、以及改版时要搜的关键词 —— 宿主假设的唯一集中记录（取代原计划的运行时适配层拆分：那些字面量多在 CSS 字符串里、解析逻辑连贯，拆开风险大于收益）。
- README / 使用说明 的配置表标注包内 `temp-session-config.txt` 为唯一权威源；修正使用说明里过时的「v0.5.0 / DSH rc.2 当前最新」。
- 新增 `.github/workflows/release.yml`（npm trusted publishing / OIDC，**在 npmjs.com 注册 trusted publisher 前不生效**）与 `RELEASING.md`（网页配置步骤 + 切换清单）。bypass-2FA token 2027 年 1 月停用，迁移步骤已备好。

### 回归 / Tests

- 新增 `tests/test_040.mjs`（23 项）：POST-only 路由、P1 隐藏删除保留跟踪、溢出裁剪的活跃保护与失败保留、路径守卫错误可见、test_020 opt-in。全套 18 个测试文件（约 700+ 断言）绿灯。

## 0.6.1 — 采纳社区收录评审的两条建议（2026-11-13）

> 起因：[dsh-community-plugins PR #105](https://github.com/zhu1090093659/dsh-community-plugins/pull/105) 的 APPROVED 评审留了两条「后续版本可顺手做」的建议：把 `lib/temp-session-host.mjs` 的 `temp-session-config.txt` 迁到 `~/.dsh` 数据目录（避免升级覆盖），以及把定时清理挂到 `ctx.effect`。两条都做了。评审里写的 `/home/zcl/.dsh` 是维护者本机路径，通用规则就是 DSH 的 `~/.dsh`（可用 `DSH_HOME` 覆盖）。该 PR 已合并，社区索引条目不受影响。

**这次改的是宿主端 `lib/temp-session-host.mjs`，所以装完要从托盘彻底退出 DSH 再开一次才生效**（客户端这次没有功能性改动，只同步了一句说明文案）。

### 1. 配置文件搬出插件包

- 实际读写路径改为 `~/.dsh/dsh-sidebar-suite/temp-session-config.txt`，和跟踪库 `temp-sessions.json` 同目录；设了 `DSH_HOME` 就以它为准。
- 包内同名的 `temp-session-config.txt` 仍随 npm 包发布，但降级为**出厂模板**：只在数据目录还没有配置时读一次并复制过去，此后**再也不写**。详情页开关和记事本手改都只落数据目录那份。
- 因此 `pnpm add dsh-sidebar-suite@0.6.1` 这类升级不会再把手改的 9 个开关重置回默认值。⚠️ **一次性说明**：如果以前手改的是**包内**那个文件，包管理器在升级那一刻可能已经把它换成新模板，旧值救不回来 —— 在详情页把开关重设一次即可，从 0.6.1 起不会再丢。
- `status` / `config` / `probe` 新增 `configFile`（真实完整路径）、`configMigrated`、`configTemplate`；详情页底部显示的就是 `configFile`。

### 2. 定时清理交给宿主生命周期

- `register()` 改用 `bindSchedulerEffect(hostCtx)`：宿主提供 `ctx.effect` 时由它注册定时器，插件 dispose / 重新 apply 时通过返回的 disposer 调 `stopScheduler()`，不再留一个游离的 `setInterval`；重复 apply 不会叠加 effect。
- 不提供 `ctx.effect` 的旧宿主 / 测试替身自动退回原来的独立定时器，行为不变。`schedule.managed` 会标明当前用的是哪种。

### 回归 / Tests

- 新增 `tests/test_039.mjs`（33 项）：路径落在 DSH home、首次启动从模板播种、写入不碰包内文件、二次启动不覆盖用户值、切换 `DSH_HOME`、effect disposer 能停表、重复 apply 不叠加。
- `test_022` / `test_024` / `test_028` 改为在临时 `DSH_HOME` 里准备配置副本，不再改写工作副本；`package.json` 的 `test` 串加入 `test_039`。全套 `npm test` 与 `npm run check` 通过。

### 文档

README / DETAIL / 使用说明 里所有「配置文件在插件源码目录」的旧路径改为 `%USERPROFILE%\.dsh\dsh-sidebar-suite\temp-session-config.txt`，并明确包内那份是只读模板；「二、文件都在哪」的表格拆成「实际配置」和「出厂模板」两行。详情页的说明文案同步。

---

## 0.6.0 — 临时按钮改挂宿主官方插槽（2026-11-13）

**相对 `0.5.1` 只动客户端（`lib/client.js`），不需要从托盘退出 DSH**：装完后新开一个侧栏或刷新窗口就生效。**如果你是从 `0.5.0` 或更早升上来**，包里还带着 `0.5.1` 的宿主侧修复（删除临时会话前的路径校验），那一项仍然要从托盘彻底退出 DSH 再开一次才生效。Client-only relative to 0.5.1; upgrading from 0.5.0 or earlier still needs one tray restart for the host-side delete-path fix.

> 起因：DSH `0.2.2-rc.3` 给「新会话」这一行开了官方扩展位。我们原来那套「压窄新会话 → 用负边距把临时按钮拉回上一行」的做法，是按 rc.2 之前的宿主结构写的，继续留着就是每次宿主改 DOM 都要跟着修一次。0.6.0 把它换成官方插槽，同时修掉一个有失效的配置项。

### 宿主这次给的是什么 / What the host now offers

rc.3 的侧栏包声明了 `sidebar.session.action`，类型是 `hoc`：占用者能拿到宿主自己的「新会话」按钮（`children`）和 `{ wide }`（`false` = 56px 折叠轨道），可以包一层、并在旁边加自己的控件。同一版里「新会话」按钮外面多包了一层 `div.newSessionRow`（`display:flex; gap:6px`），按钮从 `flex:none` 改成 `flex:1 1 auto`。

We now register an occupant for that slot and mount the Temp button into the empty seat it renders, instead of shrinking the host button and pulling our sibling back with a negative margin.

### 改动 / Changes

1. **临时按钮改挂官方插槽**：注册 `sidebar.session.action` 占用者（`id: 'temp-session'`），返回「宿主按钮原样 + 一个空座位」，再把按钮挂进座位。宿主行自己的 flex、`gap`、折叠淡入动画、宽/窄切换全部接管，我们不再改宿主的宽度和边距。
2. **删掉两处脆弱 hack**：`width:calc(100% - 92px)`（压窄「新会话」）和 `margin:-44px`（把临时按钮拉回上一行）只在旧路径保留。
3. **旧宿主自动回退**：DSH < `0.2.2-rc.3` 没声明这个插槽，注册会抛错（已捕获），自动退回原来的「兄弟节点 + 负边距」路径，由 `html[data-dsbs-temp-mode="dom"]` 这批规则承担。**同一时刻只会存在一个临时按钮**，来回切也拆得干净。
4. **修复 `TEMP_BUTTON_STYLE=own` 从未生效**：宿主一直在下发 `buttonStyle: 'own'`，客户端却把标记写成布尔 `"true"`，而所有样式规则等的是 `[data-dsbs-temp-style="own"]`——两者永远对不上，所以这个"单独一行"的选项从 0.2.8 加进来起就是死的。现在标记写成 `own` 本身，并且改成让宿主行 `flex-wrap:wrap`、座位占满第二行，这才是 rc.3 结构下真正的一行。
5. **折叠判断改用宿主的 `wide`**：原来靠量宽度（`< 170px`）猜是不是折叠轨道，现在优先用插槽给的 `wide === false`，量宽度只作为旧宿主/首帧的兜底。
6. **隐藏开关也走 `<html>` 标记**：座位元素归 React 管，直接写在它身上的 `hidden` 可能在重渲染时被抹掉，所以 `SHOW_TEMP_BUTTON=off` 另外发一个 `data-dsbs-temp-off` 标记，样式以它为准。

### 回归 / Tests

新增 `tests/test_038.mjs`（28 项）盯住这次的结构契约：插槽注册带 `id`、挂载优先找座位、旧路径还在、`calc(100% - 92px)` 与 `-44px` 只允许出现在 dom 模式作用域里、own 标记必须是字面量 `own`。`tests/test_023.mjs` 的两条"只注册一个组件"断言随之改成两条注册（详情页卡片 + 新会话行座位）。

### 商店截图换成实拍 / Storefront screenshots are now real captures

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
