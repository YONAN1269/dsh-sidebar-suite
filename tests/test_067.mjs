// 1.1.5 — update-check host: one read-only npm lookup, cached, no request data.
import { createUpdateHost, compareVersions } from '../lib/update-host.mjs'

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

async function get(route) {
  return route.fetch(new Request('http://localhost' + route.path, { method: 'GET' }))
}

async function main() {
  check('U1: dotted versions compare numerically', compareVersions('1.1.10', '1.1.4') > 0 && compareVersions('1.1.4', '1.1.4') === 0 && compareVersions('1.1.4', '1.1.5') < 0)
  check('U2: invalid versions do not claim an update', compareVersions('not-a-version', '1.1.4') === 0)

  const calls = []
  const host = createUpdateHost(null, {
    currentVersion: '1.1.4',
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ version: '1.1.5' }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
  const ctx = fakeCtx()
  check('U3: one route is registered', host.register(ctx) === 1 && ctx.registered.length === 1)
  const route = ctx.registered[0]
  check('U4: route path is the documented one', route.path === '/api/dsh-sidebar-suite.update-check')
  check('U5: it is a GET route', Array.isArray(route.methods) && route.methods.length === 1 && route.methods[0] === 'GET')

  const first = await get(route)
  const firstBody = await first.json()
  check('U6: a newer npm version is reported as an update',
    first.status === 200 && firstBody.ok === true && firstBody.current === '1.1.4' && firstBody.latest === '1.1.5' && firstBody.updateAvailable === true,
    JSON.stringify(firstBody))
  check('U7: the lookup goes to the public registry, not a user-supplied URL',
    calls.length === 1 && calls[0].url === 'https://registry.npmjs.org/dsh-sidebar-suite/latest',
    JSON.stringify(calls.map((c) => c.url)))

  const second = await get(route)
  const secondBody = await second.json()
  check('U8: the second open is served from cache',
    calls.length === 1 && secondBody.ok === true && secondBody.cached === true,
    'calls=' + calls.length + ' body=' + JSON.stringify(secondBody))

  const same = createUpdateHost(null, {
    currentVersion: '1.1.4',
    fetchImpl: async () => new Response(JSON.stringify({ version: '1.1.4' }), { status: 200 }),
  })
  const sameCtx = fakeCtx()
  same.register(sameCtx)
  const sameBody = await (await get(sameCtx.registered[0])).json()
  check('U9: the same version is not an update', sameBody.ok === true && sameBody.updateAvailable === false, JSON.stringify(sameBody))

  const offline = createUpdateHost(null, {
    currentVersion: '1.1.4',
    fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND') },
  })
  const offlineCtx = fakeCtx()
  offline.register(offlineCtx)
  const offlineResponse = await get(offlineCtx.registered[0])
  const offlineBody = await offlineResponse.json()
  check('U10: a network failure is a clean 200 answer, not a thrown route',
    offlineResponse.status === 200 && offlineBody.ok === false && offlineBody.reason === 'network',
    JSON.stringify(offlineBody))

  const twice = createUpdateHost(null, { currentVersion: '1.1.4', fetchImpl: async () => new Response(JSON.stringify({ version: '1.1.4' }), { status: 200 }) })
  const tctx = fakeCtx()
  check('U11: re-register treats an already-mounted route as success', twice.register(tctx) === 1 && twice.register(tctx) === 1)
  check('U12: the route path is exposed for diagnostics', twice.routePath === '/api/dsh-sidebar-suite.update-check')

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main()
