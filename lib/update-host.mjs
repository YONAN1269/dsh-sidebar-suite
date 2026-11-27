/**
 * Update check host.
 *
 * The settings page asks npm for the latest published version. This lives in the
 * Host half, not the renderer, because the renderer's origin is the DSH app and
 * a cross-origin npm request would be subject to CORS. The route is read-only:
 * it sends no local data, carries no query parameters, and just returns the
 * version number npm reports.
 *
 * The result is cached briefly so opening the settings page repeatedly does not
 * hammer the registry. A failed lookup is cached for a much shorter time.
 */

import { readFileSync } from 'node:fs'

const ROUTE = '/api/dsh-sidebar-suite.update-check'
const REGISTRY_URL = 'https://registry.npmjs.org/dsh-sidebar-suite/latest'
const CACHE_MS = 10 * 60 * 1000
const FAIL_CACHE_MS = 60 * 1000
const FETCH_TIMEOUT_MS = 6000
/** Refuse a registry payload larger than this before it is parsed. */
const MAX_BODY_BYTES = 64 * 1024

function json(body, code = 200) {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function errorMessage(error) {
  return String((error && error.message) || error || 'unknown error')
}

// CH-01: 纵深防御，不替代宿主传输层。宿主内部调用不带 `Origin` 头，一律放行；
// 带 `Origin` 的请求只有本应用自身（`dsh-app://app`）放行，其它 Origin 视为
// 跨站请求拒绝。`request`/`headers` 缺失或 `headers` 不是对象时按「无 Origin」
// 处理，绝不让头读取把路由处理器打断。
function readOrigin(headers) {
  if (!headers || typeof headers !== 'object') return ''
  if (typeof headers.get === 'function') {
    const value = headers.get('origin')
    return typeof value === 'string' ? value : ''
  }
  const direct = headers.origin != null ? headers.origin : headers.Origin
  return typeof direct === 'string' ? direct : ''
}

function originAllowed(request) {
  const origin = readOrigin(request && request.headers)
  if (!origin) return true
  return origin === 'dsh-app://app'
}

function originGuard(request, handler) {
  if (!originAllowed(request)) return json({ ok: false, error: 'cross-origin request' }, 403)
  return handler(request)
}

/**
 * Short whitespace-collapsed body snippet from a failed response, for the
 * diagnostic detail. The body comes from the fixed registry origin only; it
 * carries no local paths, credentials, or request URL.
 */
async function failureSnippet(response) {
  try {
    const raw = await (response && typeof response.text === 'function' ? response.text() : '')
    return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  } catch (_error) {
    return ''
  }
}

/** The version shipped in package.json, so the answer cannot drift from the code. */
function readCurrentVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : ''
  } catch (error) {
    void error
    return ''
  }
}

/**
 * Compare dotted numeric versions without adding a semver dependency.
 *
 * Numeric core wins first; on a tie the prerelease suffix (-alpha, -rc.1 …)
 * is distinguished: a stable release outranks a prerelease of the same number,
 * and two prereleases are ordered by their suffix text.
 */
export function compareVersions(a, b) {
  const parse = (value) => {
    const text = String(value || '').trim().replace(/^v/i, '')
    const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(text)
    if (!match) return null
    return {
      core: [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)],
      // null = stable release; a string = prerelease suffix.
      pre: match[4] === undefined ? null : match[4],
    }
  }
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) return 0
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] > right.core[i]) return 1
    if (left.core[i] < right.core[i]) return -1
  }
  if (left.pre === null && right.pre === null) return 0
  if (left.pre === null) return 1
  if (right.pre === null) return -1
  if (left.pre === right.pre) return 0
  return left.pre < right.pre ? -1 : 1
}

export function createUpdateHost(initialCtx, options) {
  const opts = options && typeof options === 'object' ? options : {}
  let hostCtx = initialCtx || null
  const currentVersion = typeof opts.currentVersion === 'string'
    ? opts.currentVersion
    : readCurrentVersion()
  // An explicit `fetchImpl: null` means the host has no fetch at all; omitting
  // the option falls back to the global fetch, exactly as before.
  const fetchImpl = Object.prototype.hasOwnProperty.call(opts, 'fetchImpl') ? opts.fetchImpl : globalThis.fetch
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const cacheMs = Number.isFinite(opts.cacheMs) ? Math.max(0, opts.cacheMs) : CACHE_MS
  const failCacheMs = Number.isFinite(opts.failCacheMs) ? Math.max(0, opts.failCacheMs) : FAIL_CACHE_MS

  const state = {
    routes: { registered: 0, paths: [], errors: [] },
    degraded: null,
    checks: 0,
    lastResult: null,
  }

  let cache = null
  let inflight = null

  function setContext(next) {
    if (!next) return
    hostCtx = next
  }

  async function checkVersion(force) {
    if (!force && cache && now() - cache.at < (cache.ok ? cacheMs : failCacheMs)) {
      state.lastResult = Object.assign({}, cache.result, { cached: true })
      return state.lastResult
    }
    if (inflight) return inflight

    state.checks += 1
    const checkedAt = new Date(now()).toISOString()

    inflight = (async () => {
      if (typeof fetchImpl !== 'function') {
        const failed = {
          ok: false,
          current: currentVersion,
          reason: 'unavailable',
          detail: 'fetch is unavailable in this host',
          checkedAt,
        }
        cache = { at: now(), ok: false, result: failed }
        state.lastResult = failed
        return failed
      }

      let timer = null
      let controller = null
      try {
        if (typeof AbortController === 'function') {
          controller = new AbortController()
          timer = setTimeout(() => {
            try { controller.abort() } catch (error) { void error }
          }, FETCH_TIMEOUT_MS)
          if (typeof timer.unref === 'function') timer.unref()
        }
        // Keep this AbortController + setTimeout shape: in this host, replacing
        // it with `AbortSignal.timeout(...)` aborts within 0-1ms (verified on a
        // real isolated instance), so the lookup would always time out.
        const signal = controller ? controller.signal : undefined
        // Never follow a redirect: the registry URL is fixed, and a redirect
        // would hand the lookup to an unexpected origin.
        const response = await fetchImpl(REGISTRY_URL, {
          headers: { accept: 'application/vnd.npm.install-v1+json' },
          redirect: 'error',
          signal,
        })
        if (!response || !response.ok) {
          const snippet = await failureSnippet(response)
          const status = response && response.status ? response.status : '?'
          throw new Error('HTTP ' + String(status) + (snippet ? ' · ' + snippet : ''))
        }
        const declared = Number(response.headers && response.headers.get ? response.headers.get('content-length') : NaN)
        if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error('response body too large')
        const rawText = await response.text()
        if (Buffer.byteLength(rawText, 'utf8') > MAX_BODY_BYTES) throw new Error('response body too large')
        const data = JSON.parse(rawText)
        const latest = typeof data && typeof data.version === 'string' ? data.version.replace(/^v/i, '') : ''
        if (!latest) throw new Error('npm response has no version')
        const updateAvailable = compareVersions(latest, currentVersion) > 0
        const result = {
          ok: true,
          current: currentVersion,
          latest,
          updateAvailable,
          checkedAt,
        }
        cache = { at: now(), ok: true, result }
        state.lastResult = result
        return result
      } catch (error) {
        const result = {
          ok: false,
          current: currentVersion,
          reason: error && error.name === 'AbortError' ? 'timeout' : 'network',
          detail: errorMessage(error).slice(0, 160),
          checkedAt,
        }
        cache = { at: now(), ok: false, result }
        state.lastResult = result
        return result
      } finally {
        if (timer) clearTimeout(timer)
        inflight = null
      }
    })()

    return inflight
  }

  async function handle(request) {
    // Read-only and parameter-free: a cached answer is enough for a settings
    // page that may be opened many times in one session.
    void request
    const result = await checkVersion(false)
    try {
      hostCtx?.logger?.debug?.(`[dsh-sidebar-suite] update-check ${result.ok ? result.latest : result.reason}`)
    } catch (error) {
      void error
    }
    return json(result)
  }

  function register(ctx) {
    const target = ctx || hostCtx
    if (!target) return 0
    try {
      const connection = typeof target.get === 'function' ? target.get('connection') : null
      const registry = connection && connection.fetch
      if (!registry || typeof registry.register !== 'function') {
        state.degraded = 'connection.fetch unavailable'
        return 0
      }
      // `requestBody: 'buffered'` matches the working GET routes
      // (`web-login-load`, `dsh-temp-session.*`). Omitting it leaves the body
      // mode undefined; the connection bridge then takes the streaming branch,
      // attaches the request stream as a body to this GET Request, and the
      // Request constructor throws before the handler runs — the webserver
      // catches that and answers an empty-body 400.
      registry.register({
        path: ROUTE,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: (request) => originGuard(request, handle),
      })
      state.routes.registered = 1
      state.routes.paths = [ROUTE]
      return 1
    } catch (error) {
      const message = errorMessage(error)
      if (/already registered/i.test(message)) {
        state.routes.registered = 1
        state.routes.paths = [ROUTE]
        return 1
      }
      state.routes.errors.push(`${ROUTE}: ${message}`)
      state.degraded = `route registration failed: ${message}`
      return 0
    }
  }

  return {
    register,
    setContext,
    checkVersion,
    state,
    routePath: ROUTE,
    registryUrl: REGISTRY_URL,
  }
}
