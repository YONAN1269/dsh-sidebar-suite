// CH-01 — 四个 Host 路由入口的来源复核（纵深防御）。
//
// 规则（与 lib 内局部函数一致）：
//   - 请求没有 Origin 头（宿主内部调用就是这种形态）→ 放行；
//   - Origin 等于 dsh-app://app → 放行；
//   - 其它 Origin → 403 { ok:false, error:'cross-origin request' }；
//   - request 缺失、headers 缺失或不是对象 → 按「无 Origin」处理，不得抛错。
//
// 本套件用桩 request 覆盖三种来源形态；web-login 与 temp-session 两个真 host
// 跑完整路由表，window-focus 与 update 各跑同类断言。不新建 lib 模块。
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { createWebLoginHost } from '../lib/web-login-host.mjs'
import { createTempSessionHost } from '../lib/temp-session-host.mjs'
import { createWindowFocusHost } from '../lib/window-focus-host.mjs'
import { createUpdateHost } from '../lib/update-host.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

function makeCtx() {
  const routes = new Map()
  const ctx = {
    routes,
    get(name) {
      if (name === 'connection') return { fetch: { register(spec) { routes.set(spec.path, spec) } } }
      return null
    },
    logger: { debug() {}, warn() {}, info() {}, error() {} },
  }
  return ctx
}

// 桩 request：origin 省略 = 无 headers；传 null = headers 显式缺失；
// 传对象 = 普通 headers 字典；传 'headers-object-string' 模拟 headers 不是对象。
function stubRequest(origin) {
  const base = { url: 'http://localhost/api/guard-probe' }
  if (origin === '__no-headers__') return base
  if (origin === '__null-headers__') return Object.assign(base, { headers: null })
  if (origin === '__bad-headers__') return Object.assign(base, { headers: 'not-an-object' })
  return Object.assign(base, { headers: { origin } })
}

async function readBody(res) {
  if (!res || typeof res.json !== 'function') return null
  try { return await res.json() } catch (error) { void error; return null }
}

function isBlocked(res, body) {
  return res && res.status === 403 && body && body.ok === false && body.error === 'cross-origin request'
}

async function probe(spec, request) {
  // 返回 { threw, status, body }：守卫层抛错本身就是失败。
  try {
    const res = await spec.fetch(request)
    return { threw: false, status: res && res.status, body: await readBody(res) }
  } catch (error) {
    return { threw: true, status: null, body: String(error && error.message || error) }
  }
}

async function main() {
  // ---- 1. web-login host：三条路由都过同一层守卫 -------------------------
  {
    const ctx = makeCtx()
    const host = createWebLoginHost(ctx)
    host.register(ctx)
    const load = ctx.routes.get('/api/dsh-sidebar-suite.web-login-load')
    check('CH01: web-login 路由已注册可供探测', !!load)
    if (load) {
      const cases = [
        ['无 Origin 头放行', stubRequest('__no-headers__'), false],
        ['Origin 为 dsh-app://app 放行', stubRequest('dsh-app://app'), false],
        ['Origin 为 https://evil.example 拒绝 403', stubRequest('https://evil.example'), true],
        ['headers 为 null 按无 Origin 放行', stubRequest('__null-headers__'), false],
        ['headers 不是对象按无 Origin 放行且不抛错', stubRequest('__bad-headers__'), false],
      ]
      for (const [label, request, expectBlock] of cases) {
        const out = await probe(load, request)
        check('CH01 web-login: ' + label,
          !out.threw && (isBlocked({ status: out.status }, out.body) === expectBlock),
          JSON.stringify(out))
      }
      // 真实 Request + Headers 实例，走 headers.get('origin') 分支。
      const evil = new Request('http://localhost/api/guard-probe', { headers: { origin: 'https://evil.example' } })
      const evilOut = await probe(load, evil)
      check('CH01 web-login: 真实 Request 的恶意 Origin 拒绝 403',
        !evilOut.threw && evilOut.status === 403 && evilOut.body && evilOut.body.error === 'cross-origin request',
        JSON.stringify(evilOut))
      const app = new Request('http://localhost/api/guard-probe', { headers: { origin: 'dsh-app://app' } })
      const appOut = await probe(load, app)
      check('CH01 web-login: 真实 Request 的自家 Origin 放行',
        !appOut.threw && !isBlocked({ status: appOut.status }, appOut.body), JSON.stringify(appOut))
    }
  }

  // ---- 2. temp-session host：14 条路由共用同一层守卫 ----------------------
  {
    const ctx = makeCtx()
    const host = createTempSessionHost(ctx)
    host.register(ctx)
    const status = ctx.routes.get('/api/dsh-temp-session.status')
    check('CH01: temp-session 路由已注册可供探测', !!status)
    if (status) {
      const cases = [
        ['无 Origin 头放行', stubRequest('__no-headers__'), false],
        ['Origin 为 dsh-app://app 放行', stubRequest('dsh-app://app'), false],
        ['Origin 为 https://evil.example 拒绝 403', stubRequest('https://evil.example'), true],
        ['headers 为 null 按无 Origin 放行', stubRequest('__null-headers__'), false],
        ['headers 不是对象按无 Origin 放行且不抛错', stubRequest('__bad-headers__'), false],
      ]
      for (const [label, request, expectBlock] of cases) {
        const out = await probe(status, request)
        check('CH01 temp-session: ' + label,
          !out.threw && (isBlocked({ status: out.status }, out.body) === expectBlock),
          JSON.stringify(out))
      }
    }
  }

  // ---- 3. window-focus host：同类断言 ------------------------------------
  {
    const ctx = makeCtx()
    const host = createWindowFocusHost(ctx)
    host.register(ctx)
    const route = [...ctx.routes.values()][0]
    check('CH01: window-focus 路由已注册可供探测', !!route)
    if (route) {
      const noOrigin = await probe(route, stubRequest('__no-headers__'))
      check('CH01 window-focus: 无 Origin 头放行', !noOrigin.threw && !isBlocked({ status: noOrigin.status }, noOrigin.body), JSON.stringify(noOrigin))
      const evil = await probe(route, stubRequest('https://evil.example'))
      check('CH01 window-focus: 恶意 Origin 拒绝 403',
        !evil.threw && evil.status === 403 && evil.body && evil.body.error === 'cross-origin request', JSON.stringify(evil))
      const badHeaders = await probe(route, stubRequest('__null-headers__'))
      check('CH01 window-focus: headers 缺失不抛错且放行', !badHeaders.threw && !isBlocked({ status: badHeaders.status }, badHeaders.body), JSON.stringify(badHeaders))
    }
  }

  // ---- 4. update host：同类断言 ------------------------------------------
  {
    const ctx = makeCtx()
    const host = createUpdateHost(ctx)
    host.register(ctx)
    const route = [...ctx.routes.values()][0]
    check('CH01: update 路由已注册可供探测', !!route)
    if (route) {
      const noOrigin = await probe(route, stubRequest('__no-headers__'))
      check('CH01 update: 无 Origin 头放行', !noOrigin.threw && !isBlocked({ status: noOrigin.status }, noOrigin.body), JSON.stringify(noOrigin))
      const evil = await probe(route, stubRequest('https://evil.example'))
      check('CH01 update: 恶意 Origin 拒绝 403',
        !evil.threw && evil.status === 403 && evil.body && evil.body.error === 'cross-origin request', JSON.stringify(evil))
      const badHeaders = await probe(route, stubRequest('__bad-headers__'))
      check('CH01 update: headers 不是对象不抛错且放行', !badHeaders.threw && !isBlocked({ status: badHeaders.status }, badHeaders.body), JSON.stringify(badHeaders))
    }
  }

  // ---- 5. 源码级：四个 host 各有局部守卫，未新建 lib 模块 ------------------
  const hosts = ['web-login-host.mjs', 'temp-session-host.mjs', 'window-focus-host.mjs', 'update-host.mjs']
  for (const file of hosts) {
    const src = readFileSync(ROOT + '/lib/' + file, 'utf8')
    check('CH01 ' + file + ': 含局部来源守卫函数', /function originAllowed\(request\)/.test(src) && /function originGuard\(request, handler\)/.test(src))
    check('CH01 ' + file + ': 403 响应体为 cross-origin request', src.includes("error: 'cross-origin request'"))
    check('CH01 ' + file + ': 自家 Origin 白名单为 dsh-app://app', src.includes("'dsh-app://app'"))
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
