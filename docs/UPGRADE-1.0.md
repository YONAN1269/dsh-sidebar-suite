# 从 0.8.x 升级到 1.0.0 / Upgrading to 1.0.0

> 一句话：**不用改任何配置**。装上新版、完全退出 DSH、重新打开即可。
> Short version: **nothing to reconfigure** — install, fully quit DSH, reopen.

---

## 1. 这个版本改了什么（对你意味着什么）

1.0.0 **没有新功能**，是把「稳」做实：

- 面对**认不出的未来宿主**（比如将来某天的 DSH 0.3）时，插件会**优雅退让**（收起自己的控件，让宿主按官方默认显示），而不是把侧栏弄崩或白屏。
- 交互路径逐条复核过，没有发现需要修的缺陷。
- 首次发布**稳定性契约**（见 [CONTRACT-1.0.md](CONTRACT-1.0.md)）：1.x 系列内不改配置键、不改 `sidebarSuite` 服务、不改临时会话路由。

对你的日常使用：**看不出区别**，只是以后升级 DSH 更不容易出问题。

---

## 2. 升级步骤（照做即可）

### 方式 A：从 npm 升级（推荐）

1. 打开终端（Windows 用「PowerShell」或「命令提示符」都行）。
2. 先**完全退出 DSH**：右键任务栏图标 → 退出；或在任务管理器里确认没有 `DeepSeek Harness` 进程。
3. 执行：

   ```sh
   dsh plugin --profile desktop add dsh-sidebar-suite@1.0.0
   ```

4. 重新打开 DSH。
5. 确认生效：侧栏顶部能看到三个布局按钮（标签页 / 浮层 / 官方默认）。能看见就成功了。

### 方式 B：离线安装包

1. 到 [Releases](https://github.com/YONAN1269/dsh-sidebar-suite/releases) 下载 `dsh-sidebar-suite-1.0.0.tgz`。
2. 完全退出 DSH。
3. 执行（把路径换成你实际下载的位置）：

   ```sh
   dsh plugin --profile desktop add "C:\Users\你的用户名\Downloads\dsh-sidebar-suite-1.0.0.tgz"
   ```

4. 重新打开 DSH。

---

## 3. 需要你检查的只有一件事

如果你**很久以前**手工在 profile 里配过布局，检查一下这个文件：

```
C:\Users\你的用户名\.dsh\profiles\desktop\cordis.patch.yml
```

找 `- id: dsh-sidebar-suite` 下面的 `mode:`：

| 你看到的值 | 要不要改 | 说明 |
| --- | --- | --- |
| `b` / `c` / `n` | 不用改 | 正常 |
| `a` | **不用改** | 0.5.0 就移除了这个布局，1.0.0 会自动按 `n`（官方默认）打开，不会报错 |
| 没有 `mode` 这一行 | 不用改 | 默认就是 `b`（标签页） |

除此之外**没有其它要改的**。临时会话的配置（`~\.dsh\dsh-sidebar-suite\temp-session-config.txt`）原样沿用，回收站里的内容也保留。

---

## 4. 万一想退回旧版

1. 完全退出 DSH。
2. 执行：

   ```sh
   dsh plugin --profile desktop add dsh-sidebar-suite@0.8.11
   ```

3. 重新打开 DSH。

退回后配置依然可用（1.0.0 没有删改任何配置键）。

---

## 5. 遇到问题

三个反馈入口任选（详见 README「反馈」一节）：

- 插件详情页底部「反馈」框 → 复制内容 → 粘到 Issue 或 Discussions；
- 直接 [新建 Issue](https://github.com/YONAN1269/dsh-sidebar-suite/issues/new/choose)；
- 插件市场的评论区。

反馈报告会自动带上版本、系统、布局和最近一次错误，省掉「你是什么环境」这轮往返。
