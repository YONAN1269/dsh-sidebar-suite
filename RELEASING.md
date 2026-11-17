# 发布指南 / Releasing

**当前状态（0.7.2 起）：已在用 npm trusted publishing（OIDC），无需任何长期 token。** 迁移在 0.7.1 首次验证成功（GitHub Actions run #43970615040，npm 包带 provenance 徽章）。本页「一次性配置」部分保留作存档，**日常发布只需下面「日常发布」三节**。

## 日常发布（当前流程）

npmjs.com 上已登记 Trusted Publisher（`YONAN1269` / `dsh-sidebar-suite` / `release.yml`，environment 空，权限 `npm publish`），状态 **Valid**。推一个 `v*` tag 即触发 GitHub Actions 用 OIDC 免 token 发布到 npm，并自动创建带 tgz 附件的 GitHub Release。

1. **三处版本号一起 bump**（否则推了新 tag 但 `npm publish` 因「版本已存在」403；test_030 校验 package.json 与 client.js 一致）：
   - `package.json` → `"version": "X.Y.Z"`
   - `lib/client.js` → `var VERSION = 'X.Y.Z'`
   - `CHANGELOG.md` → 顶部版本列表加 `X.Y.Z`，并新增一节
2. **提交后打 tag 并推送**（tag 名必须等于新版本号，release.yml 会校验一致）：
   ```bash
   npm test                       # 全绿才能发
   npm run check                  # 语法 + tarball 清单
   git add -A && git commit -m "Release X.Y.Z: ..."
   git tag -a vX.Y.Z -m "Release X.Y.Z"
   git push origin main && git push origin vX.Y.Z
   ```
3. **看 GitHub 仓库 Actions 页**的 Release 工作流。成功标志：全部 step success；npm 包页面出现 **provenance** 徽章；`npm audit signatures` 能验证；Release 带 `dsh-sidebar-suite-X.Y.Z.tgz`。

> 注意：npm publish 成功后 registry 可能延迟几十秒~几分钟才落地（`/latest` 端点 CDN 还会再滞后）。**不要重复 publish**（会 409 staged version），轮询 `curl -s https://registry.npmjs.org/dsh-sidebar-suite/latest` 等待即可。

## 一次性配置（已完成，存档）

### 迁移前提（2026-11-16 核对）

- npm CLI ≥ **11.5.1**，Node ≥ **22.14.0**（`.github/workflows/release.yml` 已固定并升级 npm）。
- `package.json` 的 `repository.url` 与 GitHub 仓库大小写完全一致：`git+https://github.com/YONAN1269/dsh-sidebar-suite.git`。
- 发布在 GitHub 托管 runner（`ubuntu-latest`）。
- 工作流 `permissions` 含 `id-token: write`、`contents: write`，且任何地方都不设 `NODE_AUTH_TOKEN` / `NPM_TOKEN`（设了哪怕是空串，npm 就不会走 OIDC）。
- 包 Settings → Trusted Publisher：**GitHub Actions**，`YONAN1269` / `dsh-sidebar-suite` / `release.yml`，environment 空，权限勾 `npm publish`。提交时经 2FA（security key）验证，状态 Pending validation → **Valid**。
  - 坑：配置页登录后才可见；保存时不校验字段是否匹配（写错只在发布时报）；实际页面比文档多了 Label 字段；表单「Cannot be changed later」，写错只能删了重建。
  - 新配置必须 2 天内成功发布一次，否则过期——0.7.1 已完成这次验证。

### 可选：彻底锁门（尚未执行）

npmjs.com → 包 → Settings → Publishing access 改选「Require 2FA and disallow bypass 2FA tokens」，并撤销旧的 bypass-2FA token。现在发版走 Actions OIDC，已不依赖本机 token，可以随时锁。**执行前确认**没有任何本地流程仍需旧 token。

## 排错

| 现象 | 原因 |
| --- | --- |
| `ENEEDAUTH` / fallback 到要 token | 无 `id-token: write`，或 npm < 11.5.1，或 workflow 文件名与 npm 配置不符 |
| `404 Not Found - PUT` | trusted publisher 未配置 / environment 不匹配 / 旧配置已过期 |
| `E422 ... repository.url` | package.json 仓库地址与 GitHub 不一致（大小写敏感） |
| 工作流里仍用了 token | env 里残留 `NODE_AUTH_TOKEN`（哪怕空串也算）|
| 403 `Cannot publish over previously staged version` | 上一次 publish 还在异步 staged；等待，勿重发 |
| tag 名与 package.json 版本不符 | release.yml 的守卫步骤会 fail；tag 名必须等于新版本号 |

## 参考

- npm 官方：docs.npmjs.com/trusted-publishers
- npm provenance：docs.npmjs.com/generating-provenance-statements（最后更新 2026-05-04）
