# scripts/ 开发工具

这里的文件**不会**进 npm 发布包（`package.json` 的 `files` 不包含 `scripts/`）。

## smoke-l5.mjs — 发布前冒烟

复刻 dsh.so 的 L5 三步，在**你自己的机器**上跑，不用等站点给结论：

| 步骤 | 对应站点检查 | 做法 |
| --- | --- | --- |
| L5.1 | `L5.1_INSTALL_PASSED_SANDBOXED` | 在一个**临时 DSH_HOME** 里 `dsh plugin --profile web add <包>` |
| L5.2 | `L5.2_WEB_BOOT_READY` | 启动 `dsh --profile web --port 0 --no-open`，等它打印监听地址 |
| L5.3 | `L5.3_HTTP_SERVED` | 对那个地址发一次 HTTP 请求，2xx/3xx 算通过 |

```bash
npm run smoke                                  # 测当前目录（还没发布的代码）
node scripts/smoke-l5.mjs dsh-sidebar-suite@0.5.1   # 测 npm 上已发布的版本
node scripts/smoke-l5.mjs --keep                # 跑完保留临时目录和日志
```

选项：`--cli <dsh.cmd|安装目录>`、`--install-timeout`、`--boot-timeout`、`--http-timeout`（秒）。

### 几个要点

- **完全隔离**：临时目录作为 `DSH_HOME`，不读写你正在用的 `~/.dsh`，跑完就删（失败时保留并打印路径）。
- **不碰 `.cmd` 的引号**：直接读 `dsh.cmd`，把它里面的 `%~dp0` 相对路径还原成 exe + `cli.js`，用参数数组启动。走 `cmd /c` 的话，含中文或空格的路径会被引号规则搞坏。
- **`cli.js` 在 `app.asar` 里**，Node 的 `existsSync` 看不见归档内部条目，所以校验的是 exe + `app.asar` 本体是否存在。
- **退出码**：全过 `0`，任一失败 `1`，环境问题（找不到 dsh 等）`2`。可以直接串进 CI。
- **杀进程树**：Electron 会 fork 子进程，收尾用 `taskkill /T /F`，否则临时目录删不掉。

### 它能证明什么，不能证明什么

能证明：包在你的真实环境里**装得上、起得来、有响应**——也就是「代码本身有没有致命的启动问题」。

不能证明：站点的 L5 一定过。站点跑的是 Windows ACL 沙盒 + 它自己的 dsh 版本，环境和你的桌面不同。

实例（2026-11-13 实测）：dsh.so 判 `0.1.3` 和 `0.2.9` 的 L5 失败（`插件目录树加载失败` / `boot failed`），但这两个版本在本脚本下 **3/3 全过**。所以站点那两条是沙盒环境的假阴性，不是代码问题。反过来，如果本地就挂了，站点大概率也挂，且你能立刻看到失败日志。
