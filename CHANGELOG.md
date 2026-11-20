# 更新日志 / Changelog

> 版本号以 npm registry **实际发布记录**为准（当前：`0.0.0-stage`、`0.1.3`、`0.2.4`、`0.2.5`、`0.2.6`、`0.2.7`、`0.2.8`、`0.2.9`、`0.3.0`、`0.4.0`、`0.4.1`、`0.5.0`、`0.5.1`、`0.6.0`、`0.6.1`、`0.7.0`、`0.7.1`、`0.7.2`、`0.7.3`、`0.7.4`、`0.7.5`、`0.8.0`、`0.8.1`）。
> ⚠️ **`0.3.0` 已弃用 / deprecated**：它会让 DSH 卡在 `Loading plugins…` 且主窗口不显示（见 0.4.0 章节「修复启动死循环」）。请升级到 `0.5.0` 或更高版本。`0.3.0` hangs DSH on the loading screen; upgrade to 0.5.0 or later.
> `0.2.0`、`0.2.1`、`0.2.2`、`0.2.3` 是开发过程中的本地迭代号，**从未单独发布**；它们的功能一次性随 `0.2.4` 上线，所以在下面合并记录。
>
> Versions mirror the npm registry. `0.2.0`–`0.2.3` were local iteration numbers that were never published on their own; all of their features shipped together in `0.2.4`.

---

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
- 打包白名单不含任何运行时凭据；文档中的 `C:\Users\12691\...` 为标注给用户的 Windows 示例路径、非真实私密数据，保留。

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

README / DETAIL / 使用说明 里所有「配置文件在插件源码目录」的旧路径改为 `C:\Users\12691\.dsh\dsh-sidebar-suite\temp-session-config.txt`，并明确包内那份是只读模板；「二、文件都在哪」的表格拆成「实际配置」和「出厂模板」两行。详情页的说明文案同步。

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
