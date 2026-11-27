// CH-09 — schema 回退只收敛当前 profile，不再枚举其它 profile 目录。
//
// 旧实现会 readdir `~/.dsh/profiles` 与 `~/profiles` 下的所有 profile，把每个
// 目录都当成 schema 候选基目录。这会把无关 profile 的 node_modules 拉进解析链，
// 也让本插件的 schema 解析依赖本机其它目录的布局。本套件锁定：
//   1. 源码里不再出现任何 readdir 枚举，也不再拼接 profiles 目录；
//   2. 保留 DSH_PROFILE_DIR 环境变量、从插件文件路径向上攀爬、从 cwd 向上攀爬
//      三条回退，以及 existsSync / createRequire / import 三层探测；
//   3. 模块在离线环境（解析不到 schemastery）下仍能正常加载并 apply。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOME = mkdtempSync(join(tmpdir(), 'dsbs-081-'))
process.env.DSH_HOME = HOME

const indexSrc = readFileSync(ROOT + '/lib/index.js', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

function makeCtx() {
  const registered = []
  const ctx = {
    registered,
    get(name) {
      if (name !== 'connection') return null
      return { fetch: { register(spec) { registered.push(spec) } } }
    },
    logger: { debug() {}, warn() {}, info() {}, error() {} },
  }
  return { ctx, registered }
}

async function main() {
  // ---- 1. 源码级：不再枚举其它 profile -----------------------------------
  check('CH09: index.js 不再导入 readdirSync', !/readdirSync/.test(indexSrc))
  check('CH09: index.js 不再出现 readdir 调用', !/\breaddir\b/.test(indexSrc))
  check('CH09: 不再拼接 .dsh/profiles 或 ~/profiles 目录',
    !indexSrc.includes("'.dsh', 'profiles'")
    && !indexSrc.includes("'profiles'")
    && !indexSrc.includes("join(home, 'profiles')"))
  check('CH09: 不再遍历 HOME/USERPROFILE 收集候选目录',
    !/USERPROFILE|homedir\(/.test(indexSrc))

  // ---- 2. 源码级：三条保留回退与三层探测仍在 -----------------------------
  check('CH09: 保留 DSH_PROFILE_DIR 环境变量回退', indexSrc.includes('DSH_PROFILE_DIR'))
  check('CH09: 保留从插件自身路径向上攀爬',
    indexSrc.includes('fileURLToPath(import.meta.url)') && indexSrc.includes('climb('))
  check('CH09: 保留从 process.cwd() 向上攀爬', indexSrc.includes('process.cwd()'))
  check('CH09: 保留 existsSync 入口探测', indexSrc.includes('existsSync('))
  check('CH09: 保留 createRequire 三层回退', indexSrc.includes('createRequire('))
  check('CH09: 保留动态 import 第三层回退', indexSrc.includes("await import(pathToFileURL(entry)"))

  // ---- 3. 模块在离线环境下仍可加载并 apply，schema 解析失败不打断启动 ----
  const index = await import(pathToFileURL(ROOT + '/lib/index.js').href)
  check('CH09: apply 与 inject 导出存在',
    typeof index.apply === 'function' && Array.isArray(index.inject),
    typeof index.apply + ' / ' + typeof index.inject)

  const { ctx, registered } = makeCtx()
  await index.apply(ctx)
  check('CH09: apply 后全部 Host 路由仍正常注册',
    registered.length === 19, String(registered.length))

  // 离线环境解析不到 schemastery 时 Config 为 undefined，插件仍能启动；
  // 这与基线行为一致，回退链路本身没有被破坏。
  check('CH09: 解析不到 schema 时模块不抛错、apply 不中断',
    Array.isArray(registered) && registered.length === 19)

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(() => {
  // Detach the temp host's real exit quit hook before deleting the fixture dir.
  process.removeAllListeners('exit')
  try { rmSync(HOME, { recursive: true, force: true }) }
  catch (error) { console.error('CLEANUP_FAIL ' + HOME + ' ' + error.code + ' ' + error.message) }
})
