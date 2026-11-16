# 发布指南 / Releasing

两种发布方式并存。**当前（0.7.0）仍用方式 A**；方式 B 是一次性迁移，迁移完成后改用 B，可彻底摆脱长期 token。

## 方式 A：本机 token 发布（现在在用）

前提：本机已 `npm login`（当前账号 `yonan1269`），且 token 有效。

```bat
:: 在仓库根目录，Git Bash 或 cmd 均可
npm test                              :: 先跑全套回归，必须全绿
npm pack --dry-run                    :: 核对 tarball 文件清单
npm version patch                     :: 或 minor/major；会自动改 package.json 并打 tag
npm publish --access public           :: bypass-2FA token 可直接发；普通 token 会要 OTP
git push --follow-tags                :: 推代码和新 tag
```

`publish.bat` 是老的交交互式脚本（菜单里的 `[5]` 走 OTP、`[6]` 写入 bypass token），仍然可用。

## 方式 B：npm trusted publishing（推荐，迁移指南）

用 GitHub 签发的短期 OIDC token 换发版权，不再有长期 token 泄露/轮换问题，自动带 provenance。npm 官方宣布 **bypass-2FA 的 token 在 2027 年 1 月起不能用于直接发布**——所以这次迁移是必须的，只是不必赶在 0.7.0 当天。

### 迁移前提（已核对，2026-11-16）

- npm CLI ≥ **11.5.1**，Node ≥ **22.14.0**（`.github/workflows/release.yml` 里已固定并升级 npm）。
- `package.json` 的 `repository.url` 必须与 GitHub 仓库大小写完全一致。当前值 `git+https://github.com/YONAN1269/dsh-sidebar-suite.git` ✓。
- 发布在 **GitHub 托管 runner** 上（工作流用 `ubuntu-latest` ✓）。
- 工作流 `permissions` 含 `id-token: write`，且**任何地方都不设置 `NODE_AUTH_TOKEN` / `NPM_TOKEN`**。设了（哪怕是空串）npm 就不会走 OIDC。

### 第 1 步：在 npmjs.com 注册 trusted publisher（需你本人登录操作）

> 说明：配置页在登录后才可见，我无法代替你点。以下字段来自 npm 官方文档（docs.npmjs.com/trusted-publishers）与 2026 年多份实操记录交叉核对；请以你实际看到的页面为准。

1. 打开 `https://www.npmjs.com/package/dsh-sidebar-suite`，进 **Settings → Trusted publishing**。
2. 新增连接，选 **GitHub Actions**，填写：
   - **Organization / User**：`YONAN1269`
   - **Repository**：`dsh-sidebar-suite`（不带 owner 前缀、不带 `.git`）
   - **Workflow filename**：`release.yml`（只填文件名，含扩展名，不带 `.github/workflows/` 路径）
   - **Environment**：留空（工作流没有声明 environment）
3. 保存。⚠️ 两个坑：npm 保存时**不校验**字段是否匹配，写错只在发布时才报；新配置必须**在 2 天内成功发布一次**，否则过期——所以把第 1 步和第 3 步连着做。

### 第 2 步：启用发布工作流

`.github/workflows/release.yml` 已经写好但当前是 inert 的——它只在 `v*` tag 推送时触发。注册好 trusted publisher 后无需额外开关，推 tag 即生效。

### 第 3 步：用一次 tag 发布验证（2 天内）

⚠️ **必须先 bump 版本号**：`release.yml` 里的 `npm publish` 用的是 `package.json` 的 version。如果还是刚发过的 `0.7.0`，会因「版本已存在」403 失败。三处版本要一起改（test_030 会校验 package.json 与 client.js 一致）：

1. `package.json` → `"version": "0.7.1"`
2. `lib/client.js` → `var VERSION = '0.7.1'`
3. `CHANGELOG.md` → 顶部版本列表加 `0.7.1`，并新增一节

然后提交、打 tag、推送（tag 名必须与新版本号对应）：

```bash
npm test                       # 全绿才能发
git add -A && git commit -m "Release 0.7.1: validate trusted publishing"
git tag -a v0.7.1 -m "Release 0.7.1"
git push origin main --follow-tags
```

到 GitHub 仓库 **Actions** 页看 Release 工作流。成功标志：npm 包页面出现 **provenance** 徽章，且 `npm audit signatures` 能验证。

> 发布工作流已修好两个必修点：`permissions.contents: write`（gh-release 建 Release 需要）、真正生成 tgz 附件（`npm pack`，dry-run 不落盘）。

### 第 4 步：确认后锁门

1. npmjs.com → 包 → Settings，开启 **require 2FA**，并视情况关闭 token 发布。
2. 撤销旧的 bypass-2FA token（`npmjs.com → Access Tokens`）。
3. 不要在撤销旧 token 前删 secret——先确认 tokenless 发布真的成功。

## 排错

| 现象 | 原因 |
| --- | --- |
| `ENEEDAUTH` / fallback 到要 token | 无 `id-token: write`，或 npm < 11.5.1，或 workflow 文件名与 npm 配置不符 |
| `404 Not Found - PUT` | trusted publisher 未配置 / environment 不匹配 / 旧 token 过期 |
| `E422 ... repository.url` | package.json 仓库地址与 GitHub 不一致（大小写敏感） |
| 工作流里仍用了 token | env 里残留 `NODE_AUTH_TOKEN`（哪怕空串也算）|
| 配置几天后失效 | 新配置 2 天内没成功发布过 |

## 参考

- npm 官方：docs.npmjs.com/trusted-publishers
- npm provenance：docs.npmjs.com/generating-provenance-statements（最后更新 2026-05-04）
