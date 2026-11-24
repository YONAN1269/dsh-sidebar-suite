# 1.0 稳定性契约 / Stability Contract

> 自 **1.0.0** 起，这个插件对自己的公开接口做出承诺：**在 1.x 系列内不做破坏性变更**。
> Starting with **1.0.0**, this plugin makes a promise about its public surface: **no breaking changes within the 1.x line.**

本文件是承诺的唯一出处。README / DETAIL 只是摘要，遇到分歧以本文为准。
This file is the single source of truth. README/DETAIL summarise it; if they ever disagree, this file wins.

---

## 1. 什么算「公开接口」

只有下面四类属于承诺范围。其它一切（内部函数名、内部 `data-dsbs-*` 属性、DOM 结构、CSS 类名、日志文案）**都不承诺**，随时可能为修 bug 或改样式而调整。

Only these four categories are covered. Everything else — internal function names, internal `data-dsbs-*` markers, DOM structure, CSS class names, log wording — is **not** covered and may change at any time.

| # | 公开接口 | 说明 |
| --- | --- | --- |
| 1 | **配置键**（profile `cordis.patch.yml` 与 `temp-session-config.txt`） | 见 §2 |
| 2 | **`sidebarSuite` 服务**（供其它插件调用） | 见 §3 |
| 3 | **宿主 `/api/dsh-temp-session.*` 路由** | 见 §4 |
| 4 | **`<html>` 上的状态属性**（仅列出的一小组） | 见 §5 |

---

## 2. 配置键 / Config keys

### 2.1 profile 配置（`cordis.patch.yml` 的 `config:`）

| 键 | 取值 | 含义 |
| --- | --- | --- |
| `mode` | `b` / `c` / `n` | 启动默认布局：标签页 / 浮层 / 官方默认。旧值 `a` 会自动按 `n` 读取 |
| `tab` | `ext` / `ws` | 标签页布局下先显示哪一组 |
| `showQuickSwitch` | `true` / `false` | 是否在控制栏显示「换布局」按钮（默认 `false`） |

### 2.2 临时会话配置（`~/.dsh/dsh-sidebar-suite/temp-session-config.txt`，11 个键）

`SHOW_TEMP_BUTTON`、`TEMP_IN_CHAT_MODE`、`TEMP_BUTTON_STYLE`、`EXPAND_ALL_SESSIONS`、`TEMP_ROW_MENU`、`DELETE_ON_EXIT`、`SCHEDULE_DELETE`、`SCHEDULE_TIME`、`MAX_KEPT`、`KEEP_DELETED`、`KEEP_DELETED_DAYS`

这些键的**名字与含义**在 1.x 内不变；新增键会在文档中标注默认值，不影响旧文件。

**承诺**：1.x 内删除或重命名任一配置键，视为破坏性变更，只会出现在 2.0。
Removing or renaming any config key in 1.x would be a breaking change and will only happen in 2.0.

---

## 3. `sidebarSuite` 服务 / The service

通过 `ctx.inject(['slots'])` 之后由本插件 `ctx.provide('sidebarSuite', …)` 发布。方法签名与语义在 1.x 内不变：

| 成员 | 签名 | 语义 |
| --- | --- | --- |
| `version` | `string` | 插件版本号 |
| `registerTab` | `(descriptor) => dispose` | 注册一个页签，返回自己的注销函数（可直接交给 `ctx.effect`） |
| `unregisterTab` | `(id) => void` | 注销指定页签 |
| `getTabs` | `() => Tab[]` | 当前已注册页签的快照 |
| `activateTab` | `(id) => void` | 切到某个页签（`null` 表示退回内建分组） |
| `getActiveTab` | `() => string \| null` | 当前活动页签 id，没有则 `null` |
| `subscribe` | `(listener) => dispose` | 订阅页签列表/选中变化，返回注销函数 |
| `getLayout` | `() => { mode, tab, activeTab, narrow, rail }` | 当前布局形状 |

**承诺**：1.x 内可以**新增**方法或给返回值**新增**字段（向后兼容），但不会删除已有方法、不会改变已有参数/返回字段的含义。
In 1.x we may **add** methods or **add** fields to return values, but never remove a method or change the meaning of an existing parameter or field.

> 页签只在第一次被打开时才执行 `mount`（懒挂载）；`mount` 抛错只影响它自己那一页。消费方永远只拿到发给它的容器，不能移动或重构宿主 DOM。

---

## 4. `/api/dsh-temp-session.*` 路由 / Routes

由宿主侧 `lib/temp-session-host.mjs` 注册，共 14 条：

| 路由 | 方法 | 用途 |
| --- | --- | --- |
| `.status` | GET | 状态与降级原因 |
| `.list` | GET | 当前临时会话列表 |
| `.probe` | GET | 自检 |
| `.paths` | GET | 展示用路径 |
| `.config` | GET / POST | 读写配置 |
| `.track` | POST | 登记一个临时会话 |
| `.untrack` | POST | 取消登记 |
| `.keep-all` | POST | 全部转正 |
| `.remove` | POST | 删除一个 |
| `.purge` | POST | 清理 |
| `.trash` | GET | 回收站列表 |
| `.trash-restore` | POST | 从回收站恢复 |
| `.trash-delete` | POST | 从回收站彻底删除 |
| `.trash-empty` | POST | 清空回收站 |

**承诺**：改状态的接口一律 **POST**（GET 绝不产生副作用）；响应统一形如 `{ ok: true, … }` 或 `{ ok: false, error }`。1.x 内不删除路由、不把 POST 改成 GET、不改变 `ok` 的形状。
State-changing routes are POST-only and always answer `{ ok, … }` / `{ ok: false, error }`; this shape holds through 1.x.

---

## 5. `<html>` 状态属性（承诺子集）/ State attributes

**只有下面这些**属于公开状态，供样式或其它插件对齐；其余 `data-dsbs-*`（如 `data-dsbs-btn`、`data-dsbs-seg`、`data-dsbs-rail-head` 等纯内部选择器）不在承诺内。

| 属性 | 取值 | 含义 |
| --- | --- | --- |
| `data-dsbs-mode` | `b` / `c` / `n` | 当前布局 |
| `data-dsbs-tab` | `ext` / `ws` | 标签页布局下当前组 |
| `data-dsbs-pop` | `true` | 浮层是否展开 |
| `data-dsbs-rail` | `true` | 是否处于窄栏图标态 |
| `data-dsbs-narrow` | `true` | 侧栏是否窄于 300px（图标/文字切换） |
| `data-dsbs-ptab` | `true` | 是否有插件页签正占用该列 |
| `data-dsbs-expand-all` | `true` | 会话默认全展开是否生效 |
| `data-dsbs-temp-mode` | `slot` / `dom` | 「临时」按钮走宿主插槽还是旧 DOM 路径 |

---

## 6. 版本规则 / Versioning

遵循语义化版本（SemVer）：

| 变更类型 | 版本位 | 例子 |
| --- | --- | --- |
| 破坏 §1–§5 任一承诺 | **2.0.0** | 删除配置键、改服务方法签名 |
| 新增向后兼容的能力 | **1.x.0**（minor） | 新服务方法、新配置键（带默认值） |
| 修 bug、改文案、改样式 | **1.x.y**（patch） | 不改接口 |

---

## 7. 宿主兼容范围 / Host compatibility

`engines.dsh = ">=0.2.2-rc.1 <0.3.0-0 || >=0.2.3-0 <0.3.0-0"`。

- 已验证：DSH `0.2.2-rc.1 → rc.5`（契约矩阵 54/54）、`rc.5` 真机、`0.2.3-alpha.2` 真机。
- **明确拒绝 `0.3.0`**：0.3.0 至今未发布，本插件不会对未验证的宿主宣称兼容。等 0.3 发布并稳定一段时间后，再单独评估放宽。
- 遇到未知宿主时，1.0.0 起会**优雅降级**（隐藏自己的控件、保留宿主原样），而不是把侧栏搞崩。

`0.3.0` is refused on purpose: it has not shipped, so nothing can be verified against it. Unknown host shapes now degrade gracefully instead of breaking the sidebar.

---

## 8. 不承诺的部分 / Explicitly out of scope

- 不承诺内部 DOM 结构与 CSS 类名（随时可能为修 bug 调整）。
- 不承诺 `<html>` 上未列出的 `data-dsbs-*` 内部属性。
- 不承诺日志/提示的**逐字文案**（会随语言与措辞优化而变）。
- 不承诺与其它第三方插件在 DOM 层面的相互行为（只保证通过 `sidebarSuite` 服务的协作）。
- 不承诺宿主本身的接口（那是 DSH 的事）。
