// dsh-sidebar-suite 1.1.5 — release-sensitive-path guard.
//
// 随 npm 包发布的四个对外文档（使用说明.md / README.md / DETAIL.md /
// CHANGELOG.md）不得再写入开发者本机的绝对用户目录路径；示例路径统一用
// Windows 占位符 %USERPROFILE% 表示，读者把自己机器上的用户目录代入即可照做。
//
// 本测试只读文档正文，不加载 lib/、不跑 DOM 夹具，避免和并发改动互相干扰。
// 按既定决定：DSH 安装目录 `D:\program\harness` 原样保留；tests/test_023.mjs
// 里的夹具假路径不在本守卫范围内。
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// Relocatable: <repo>/tests -> <repo>. No machine-specific paths (CI-safe).
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

const DOCS = [
  '使用说明.md',
  'README.md',
  'DETAIL.md',
  'CHANGELOG.md',
]

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

const bodies = {}
for (const file of DOCS) {
  bodies[file] = fs.readFileSync(ROOT + '/' + file, 'utf8')
}

// 场景一：四个对外文档正文都不再出现本机 `C:\Users\` 绝对路径字面。
for (const file of DOCS) {
  const hit = bodies[file].match(/C:\\Users\\[^\n]*/)
  check('文档守卫：' + file + ' 不再出现 C:\\Users\\ 本机路径字面',
    !hit, hit && hit[0])
}

// 场景二：每个文档至少保留一处 %USERPROFILE% 示例路径。
for (const file of DOCS) {
  check('文档守卫：' + file + ' 至少含一处 %USERPROFILE% 示例路径',
    bodies[file].includes('%USERPROFILE%'))
}

// 场景三：占位符不能拼错——%USERPROFILE% 后面不得跟正斜杠混写成第三种写法。
for (const file of DOCS) {
  check('文档守卫：' + file + ' 的 %USERPROFILE% 路径未出现斜杠混写',
    !/%USERPROFILE%\s*\//.test(bodies[file]))
}

// 场景四：DSH 安装目录 `D:\program\harness` 按既定决定原样保留，
// 防止以后有人顺手把它和用户目录路径一起替换掉。
const allDocs = DOCS.map((f) => bodies[f]).join('\n')
check('文档守卫：DSH 安装目录 D:\\program\\harness 仍按原样保留',
  allDocs.includes('D:\\program\\harness'))

console.log('')
if (fail > 0) {
  console.log(pass + ' passed, ' + fail + ' failed')
  process.exitCode = 1
} else {
  console.log(pass + ' passed, 0 failed')
}
