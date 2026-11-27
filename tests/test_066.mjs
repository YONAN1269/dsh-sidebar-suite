// 1.1.3 — window focus host: route shape and guarded execution.
//
// The Win32 call itself is exercised on the real desktop, not here: a test must
// never steal focus or depend on which window is in front. These checks pin the
// contract around it — one POST route, Windows-only degradation, and a target
// PID that cannot be supplied by the request.
import fs from 'node:fs'
import { createWindowFocusHost } from '../lib/window-focus-host.mjs'

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

function fakeCtx() {
  const registered = []
  const routes = new Set()
  return {
    registered,
    get(name) {
      if (name !== 'connection') return null
      return {
        fetch: {
          register(route) {
            if (routes.has(route.path)) throw new Error('connection: exact Fetch route "' + route.path + '" is already registered')
            routes.add(route.path)
            registered.push(route)
          },
        },
      }
    },
  }
}

async function post(route, body) {
  return route.fetch(new Request('http://localhost' + route.path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  }))
}

async function main() {
  const seenArgs = []
  const host = createWindowFocusHost(null, {
    platform: 'linux',
    focusImpl: async (...args) => {
      seenArgs.push(args)
      return { ok: true, pid: 999 }
    },
  })
  const ctx = fakeCtx()
  check('F1: one route is registered', host.register(ctx) === 1 && ctx.registered.length === 1)
  const route = ctx.registered[0]
  check('F2: the route is the documented path', route.path === '/api/dsh-sidebar-suite.focus-window')
  check('F3: POST only', Array.isArray(route.methods) && route.methods.length === 1 && route.methods[0] === 'POST')
  check('F4: request body is buffered by the host', route.requestBody === 'buffered')

  const unsupported = await post(route, { pid: 12345 })
  const body = await unsupported.json()
  check('F5: non-Windows is a clean unsupported answer, not an exec attempt',
    unsupported.status === 503 && body.ok === false && body.unsupported === true && body.reason === 'windows-only',
    JSON.stringify(body))
  check('F6: a non-Windows request never reaches the focus implementation',
    seenArgs.length === 0, JSON.stringify(seenArgs))
  check('F7: attempts are counted once', host.state.attempts === 1, String(host.state.attempts))

  const windows = createWindowFocusHost(null, {
    platform: 'win32',
    focusImpl: async (...args) => {
      seenArgs.push(args)
      return { ok: true, pid: 42, window: 524734 }
    },
  })
  const wctx = fakeCtx()
  windows.register(wctx)
  const ok = await post(wctx.registered[0], {})
  const okBody = await ok.json()
  check('F8: a successful focus reports ok and the window handle',
    ok.status === 200 && okBody.ok === true && okBody.pid === 42 && okBody.window === 524734,
    JSON.stringify(okBody))
  check('F8b: the focus implementation is called without request data',
    seenArgs.length === 1 && seenArgs[0].length === 0, JSON.stringify(seenArgs))

  const refused = createWindowFocusHost(null, {
    platform: 'win32',
    focusImpl: async () => ({ ok: false, reason: 'foreground-refused', pid: 42 }),
  })
  const rctx = fakeCtx()
  refused.register(rctx)
  const bad = await post(rctx.registered[0], {})
  const badBody = await bad.json()
  check('F9: a refused foreground is a 503 with a named reason',
    bad.status === 503 && badBody.ok === false && badBody.reason === 'foreground-refused',
    JSON.stringify(badBody))

  const twice = createWindowFocusHost(null, { platform: 'linux', focusImpl: async () => ({ ok: true }) })
  const tctx = fakeCtx()
  check('F10: re-register treats an already-mounted route as success',
    twice.register(tctx) === 1 && twice.register(tctx) === 1)
  check('F11: the route path is exposed for diagnostics',
    twice.routePath === '/api/dsh-sidebar-suite.focus-window')

  // The Win32 script itself cannot run in a unit test without stealing focus.
  // Pin the failure it just fixed: AppActivate's boolean must not short-circuit
  // the real GetForegroundWindow() check, and a failed check must fall through
  // to SwitchToThisWindow + a delayed re-read.
  const focusSource = fs.readFileSync(new URL('../lib/window-focus-host.mjs', import.meta.url), 'utf8')
  check('F12: success requires the real foreground window, not AppActivate',
    !focusSource.includes('or $activated') &&
    focusSource.includes('Start-Sleep -Milliseconds 150') &&
    /SwitchToThisWindow\(\$hwnd, \$true\)[\s\S]*GetForegroundWindow\(\)/.test(focusSource),
    focusSource.slice(focusSource.indexOf('$finalForeground'), focusSource.indexOf('Write-Output (\'{\"ok\":false')))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main()
