// R-06 (TS-03) / CH-03 — update-check host regression.
//
// Driven through an injected fetchImpl and a controllable clock; no real npm
// registry request is made.
//
//   1. HTTP non-200            -> clean failure, reason network
//   2. bad JSON body           -> clean failure
//   3. AbortError (timeout)    -> reason timeout
//   4. two concurrent checks   -> only one fetch goes out
//   5. failed lookup cached 60s -> expired after the fail window, then refetched
//   6. fetch unavailable       -> degraded "unavailable" answer
//
// CH-03: redirect is forced to 'error', bodies are capped at 64KB, and the
// version comparison distinguishes prerelease suffixes.
import { createUpdateHost, compareVersions } from '../lib/update-host.mjs'

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

let tick = 1_700_000_000_000
const now = () => tick

function makeHost(overrides = {}) {
  const opts = Object.assign({ currentVersion: '1.1.5', now }, overrides)
  return createUpdateHost(null, opts)
}

function jsonResponse(version, status = 200) {
  return new Response(JSON.stringify({ version }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function main() {
  // ---- 1. HTTP non-200 ---------------------------------------------------
  {
    const host = makeHost({ fetchImpl: async () => new Response('{}', { status: 500 }) })
    const result = await host.checkVersion(false)
    check('R-06: a non-200 response is a clean failure',
      result.ok === false && result.reason === 'network', JSON.stringify(result))
  }

  // ---- 2. bad JSON -------------------------------------------------------
  {
    const host = makeHost({ fetchImpl: async () => new Response('this is not json', { status: 200 }) })
    const result = await host.checkVersion(false)
    check('R-06: a non-JSON body is a clean failure',
      result.ok === false, JSON.stringify(result))
  }

  // ---- 3. AbortError -> timeout -----------------------------------------
  {
    const host = makeHost({
      fetchImpl: async () => {
        throw Object.assign(new Error('aborted by timer'), { name: 'AbortError' })
      },
    })
    const result = await host.checkVersion(false)
    check('R-06: an abort is reported as timeout',
      result.ok === false && result.reason === 'timeout', JSON.stringify(result))
  }

  // ---- 4. concurrent checks share one in-flight fetch -------------------
  {
    let calls = 0
    const host = makeHost({
      fetchImpl: async () => {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return jsonResponse('1.1.6')
      },
    })
    const [first, second] = await Promise.all([host.checkVersion(false), host.checkVersion(false)])
    check('R-06: two concurrent checks issue one fetch', calls === 1, String(calls))
    check('R-06: both callers receive the same result',
      first.ok === true && second.ok === true && first.latest === second.latest,
      JSON.stringify({ first, second }))
  }

  // ---- 5. failure cached 60s, refetched after expiry ---------------------
  {
    let calls = 0
    const host = makeHost({
      fetchImpl: async () => {
        calls += 1
        throw new Error('getaddrinfo ENOTFOUND')
      },
    })
    const first = await host.checkVersion(false)
    check('R-06: first failure is recorded', first.ok === false && calls === 1, JSON.stringify(first))

    tick += 30 * 1000
    const second = await host.checkVersion(false)
    check('R-06: the failure is served from cache inside 60s',
      second.ok === false && second.cached === true && calls === 1,
      JSON.stringify({ second, calls }))

    tick += 31 * 1000
    const third = await host.checkVersion(false)
    check('R-06: the cached failure expires and refetches after 60s',
      third.ok === false && calls === 2, JSON.stringify({ third, calls }))
  }

  // ---- 6. fetch unavailable --------------------------------------------
  {
    const host = makeHost({ fetchImpl: null })
    const result = await host.checkVersion(false)
    check('R-06: no fetch degrades to an unavailable answer',
      result.ok === false && result.reason === 'unavailable', JSON.stringify(result))
  }

  // ---- CH-03: redirect: 'error' reaches the registry request ------------
  {
    const seen = []
    const host = makeHost({
      fetchImpl: async (url, init) => {
        seen.push({ url, init })
        return jsonResponse('1.1.6')
      },
    })
    await host.checkVersion(false)
    check('CH-03: the lookup forces redirect: error',
      seen.length === 1 && seen[0].init && seen[0].init.redirect === 'error',
      JSON.stringify(seen[0] && seen[0].init))
  }

  // ---- Route registration shape: buffered body, same as the working GET -
  // Missing `requestBody: 'buffered'` makes the connection bridge take the
  // streaming branch, attach a body to this GET Request, and throw before the
  // handler runs; the webserver then answers an empty-body 400.
  {
    const registered = []
    const ctx = {
      registered,
      get(name) {
        if (name !== 'connection') return null
        return { fetch: { register(spec) { registered.push(spec) } } }
      },
      logger: { debug() {}, warn() {}, info() {}, error() {} },
    }
    const host = makeHost({ fetchImpl: async () => jsonResponse('1.1.6') })
    const mounted = host.register(ctx)
    check('CH-03: the update-check route registers exactly once',
      mounted === 1 && registered.length === 1, String(mounted))
    const spec = registered[0]
    check('CH-03: the route shape matches the working buffered GET routes',
      spec.path === host.routePath && spec.methods.length === 1 && spec.methods[0] === 'GET'
        && spec.requestBody === 'buffered' && typeof spec.fetch === 'function',
      JSON.stringify(spec))
    const res = await spec.fetch(new Request('http://localhost' + host.routePath))
    const body = await res.json()
    check('CH-03: the registered handler answers through the dispatcher shape',
      res.status === 200 && body.ok === true && body.latest === '1.1.6',
      JSON.stringify(body))
  }

  // ---- CH-03: a non-200 fails once with a bounded body snippet in detail --
  {
    let calls = 0
    const body = JSON.stringify({ error: 'bad request from registry' })
    const host = makeHost({
      fetchImpl: async () => {
        calls += 1
        return new Response(body, { status: 400, headers: { 'content-type': 'application/json' } })
      },
    })
    const result = await host.checkVersion(false)
    check('CH-03: a non-200 fails on the single attempt with a body snippet',
      result.ok === false && result.reason === 'network' && calls === 1
        && typeof result.detail === 'string' && result.detail.indexOf('bad request from registry') >= 0,
      JSON.stringify(result))
  }

  // ---- CH-03: a 500 answer fails on the single attempt --------------------
  {
    let calls = 0
    const host = makeHost({
      fetchImpl: async () => { calls += 1; return new Response('x', { status: 500 }) },
    })
    const result = await host.checkVersion(false)
    check('CH-03: a 500 answer fails on the single attempt',
      result.ok === false && calls === 1, JSON.stringify(result))
  }

  // ---- CH-03: oversized body is refused before parsing -------------------
  {
    const big = 'x'.repeat(70 * 1024)
    const host = makeHost({ fetchImpl: async () => new Response(big, { status: 200 }) })
    const result = await host.checkVersion(false)
    check('CH-03: a body over 64KB fails cleanly', result.ok === false, JSON.stringify(result))
  }

  // ---- CH-03: prerelease-aware comparison -------------------------------
  check('CH-03: stable outranks the same-number prerelease',
    compareVersions('1.1.5', '1.1.5-alpha') > 0
      && compareVersions('1.1.5-alpha', '1.1.5') < 0,
    String(compareVersions('1.1.5', '1.1.5-alpha')))
  check('CH-03: stable and prerelease are no longer equal',
    compareVersions('1.1.5-alpha', '1.1.5') !== 0)
  check('CH-03: prerelease suffixes order alpha < beta',
    compareVersions('1.1.5-alpha', '1.1.5-beta') < 0)
  check('CH-03: identical prereleases compare equal',
    compareVersions('1.1.5-rc.1', '1.1.5-rc.1') === 0)
  check('CH-03: numeric cores still compare numerically',
    compareVersions('1.1.10', '1.1.4') > 0
      && compareVersions('1.1.4', '1.1.4') === 0
      && compareVersions('1.1.4', '1.1.5') < 0)
  check('CH-03: invalid versions do not claim an update',
    compareVersions('not-a-version', '1.1.4') === 0)

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
