/**
 * Login snapshots for the two embedded DeepSeek pages.
 *
 * The DSH desktop browser guest keeps its cookies in a throw-away session
 * partition, so a website login disappears when the app quits. This module
 * stores the only part that is portable across runs — the page's small
 * `localStorage` values (`userToken`, `__appKit_userInfo`, device ids …) — and
 * hands them back so the page can restore itself at startup.
 *
 * Storage order:
 *   1. `ctx.credentials` (the DSH grant store: encrypted, owned by this plugin)
 *   2. a 0600 JSON file under `~/.dsh/dsh-sidebar-suite/` that only holds
 *      tombstones — login entries are never written to plaintext when the
 *      credential store is unavailable (CH-06).
 *
 * The payload is opaque to the credential seam, but it is still the user's
 * session: nothing here logs a value, and every route returns only the shape
 * the page itself wrote.
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Pages this host knows about. Anything else is a 400. */
export const WEB_LOGIN_PAGES = Object.freeze(['chat', 'api'])

const MAX_ENTRIES = 64
const MAX_KEY_LENGTH = 256
const MAX_VALUE_LENGTH = 16384
const MAX_TOTAL_LENGTH = 65536
/** The save route's raw JSON body cap. The stored snapshot itself stays 64KB. */
const MAX_SAVE_BODY_BYTES = 128 * 1024
const STORE_VERSION = 1
const CREDENTIAL_SCOPE = 'dsh-sidebar-suite'

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

export function isWebLoginPage(value) {
  return typeof value === 'string' && WEB_LOGIN_PAGES.includes(value)
}

/**
 * Validate and trim a page's storage map. Oversized values are dropped rather
 * than rejected: one big cache key must not cost the user their login token.
 * @param {unknown} input - whatever the page or an older record supplied.
 * @returns {{ ok: true, entries: Record<string, string> } | { ok: false, error: string }}
 */
export function normalizeWebLoginEntries(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'entries must be an object' }
  }
  const entries = Object.create(null)
  // Keep the session keys before any cache/auth-adjacent noise. The previous
  // insertion-order walk could fill the 64-entry budget before reaching
  // `userToken`, which is exactly the key a restore needs.
  const ranked = Object.entries(input).sort(([a], [b]) => {
    const rank = (key) => {
      if (key === 'userToken') return 0
      if (key === '__appKit_userInfo') return 1
      if (key.startsWith('deepseek-device-id')) return 2
      if (/token|auth|passport|session[_-]?id/i.test(key)) return 3
      return 4
    }
    return rank(a) - rank(b)
  })
  let count = 0
  let total = 0
  for (const [key, value] of ranked) {
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) continue
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_VALUE_LENGTH) continue
    total += key.length + value.length
    if (total > MAX_TOTAL_LENGTH) break
    if (count >= MAX_ENTRIES) break
    entries[key] = value
    count += 1
  }
  if (count === 0) return { ok: false, error: 'no usable entries' }
  return { ok: true, entries: { ...entries } }
}

/** The key this plugin owns inside the credential store. */
export function webLoginCredentialKey(page) {
  return `${CREDENTIAL_SCOPE}/web-login-${page}`
}

/**
 * @param {*} initialCtx - the Host context this plugin is applied to.
 * @param {object} [options] - test-only seams: `renameImpl(tmp, file)` replaces
 *   the atomic rename; omitting it keeps the real `node:fs/promises` rename.
 */
export function createWebLoginHost(initialCtx, options) {
  const opts = options && typeof options === 'object' ? options : {}
  const renameImpl = typeof opts.renameImpl === 'function' ? opts.renameImpl : rename
  let hostCtx = initialCtx || null
  let writeChain = Promise.resolve()
  // Credential grants and file tombstones are two records for one decision.
  // Serializing only the file write is not enough: a concurrent save can
  // compute an older savedAt and then overwrite a newer clear tombstone.
  let operationChain = Promise.resolve()

  const state = {
    routes: { registered: 0, paths: [], errors: [] },
    degraded: null,
    reads: 0,
    writes: 0,
    clears: 0,
    source: null,
  }

  function setContext(next) {
    if (!next) return
    hostCtx = next
  }

  function credentialsOf() {
    try {
      const get = hostCtx && typeof hostCtx.get === 'function'
      const provider = get ? hostCtx.get('credentials') : null
      return provider && typeof provider.readRecord === 'function' ? provider : null
    } catch (error) {
      void error
      return null
    }
  }

  function storeDir() {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    return join(home, 'dsh-sidebar-suite')
  }

  function storePath() {
    return join(storeDir(), 'web-login.json')
  }

  function emptyFile() {
    return { version: STORE_VERSION, pages: {} }
  }

  async function quarantineFile() {
    const file = storePath()
    const corrupt = `${file}.corrupt-${process.pid}-${Date.now()}`
    try {
      await rename(file, corrupt)
    } catch (error) {
      // If the file disappeared or cannot be moved, there is nothing safe to
      // do here; callers still get an empty in-memory view.
      void error
    }
  }

  async function readFileStore() {
    let raw
    try {
      raw = await readFile(storePath(), 'utf8')
    } catch (error) {
      if (!error || error.code !== 'ENOENT') void error
      return emptyFile()
    }
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || parsed.version !== STORE_VERSION || typeof parsed.pages !== 'object' || parsed.pages === null) {
        throw new Error('invalid login snapshot store shape')
      }
      return parsed
    } catch (error) {
      // Keep the evidence and let the next save start from an empty store. The
      // old code returned `{}` and then overwrote the corrupt file, destroying
      // the only chance to inspect what went wrong.
      void error
      await quarantineFile()
      return emptyFile()
    }
  }

  /** Atomic replace; on a transient Windows sharing violation, retry briefly. */
  async function replaceFile(tmp, file) {
    let lastError = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await renameImpl(tmp, file)
        return
      } catch (error) {
        lastError = error
        const code = error && error.code
        if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') break
        await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
      }
    }
    throw lastError || new Error('could not replace the login snapshot file')
  }

  async function writeFileStore(next) {
    const dir = storeDir()
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const file = storePath()
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 })
    try {
      await chmod(tmp, 0o600)
    } catch (error) {
      void error
    }
    try {
      // Node's rename replaces an existing destination on this platform. The
      // previous rm-then-rename left a window where a crash lost the whole file.
      await replaceFile(tmp, file)
    } catch (error) {
      try { await rm(tmp, { force: true }) } catch (cleanupError) { void cleanupError }
      throw error
    }
    try {
      await chmod(file, 0o600)
    } catch (error) {
      void error
    }
  }

  function enqueue(task) {
    const run = writeChain.then(task, task)
    // Keep the chain alive even when a task rejects; the caller still sees
    // its own rejection through `run`.
    writeChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  function enqueueOperation(task) {
    const run = operationChain.then(task, task)
    operationChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function readCredentials(page) {
    const provider = credentialsOf()
    if (!provider) return { available: false, found: false }
    try {
      const record = await provider.readRecord(webLoginCredentialKey(page))
      if (!record || record.kind !== 'grant') return { available: true, found: false }
      const payload = record.payload
      if (!payload || payload.version !== STORE_VERSION) return { available: true, found: false }
      if (payload.cleared === true) {
        return {
          available: true,
          found: false,
          cleared: true,
          savedAt: typeof payload.savedAt === 'string' ? payload.savedAt : '',
        }
      }
      const normalized = normalizeWebLoginEntries(payload.entries)
      if (!normalized.ok) return { available: true, found: false, invalid: true }
      return {
        available: true,
        found: true,
        entries: normalized.entries,
        savedAt: typeof payload.savedAt === 'string' ? payload.savedAt : '',
      }
    } catch (error) {
      // An unavailable credential provider is a reason to fall back, not a
      // reason to lose the snapshot the file store may still hold.
      return { available: false, found: false, error: errorMessage(error) }
    }
  }

  function timestampOf(value) {
    const ts = Date.parse(String(value || ''))
    return Number.isFinite(ts) ? ts : 0
  }

  /** Keep every write strictly newer than both existing copies. */
  async function nextSavedAt(page) {
    let millis = Date.now()
    try {
      const credentials = await readCredentials(page)
      if (credentials && (credentials.found || credentials.cleared)) {
        millis = Math.max(millis, timestampOf(credentials.savedAt) + 1)
      }
    } catch (error) {
      void error
    }
    try {
      const file = await readFileStore()
      const slot = file.pages && file.pages[page]
      if (slot && slot.version === STORE_VERSION) {
        millis = Math.max(millis, timestampOf(slot.savedAt) + 1)
      }
    } catch (error) {
      void error
    }
    return new Date(millis).toISOString()
  }

  async function writeCredentialTombstone(provider, page, savedAt) {
    if (!provider || typeof provider.modifyRecord !== 'function') return false
    try {
      await provider.modifyRecord(webLoginCredentialKey(page), async () => ({
        kind: 'grant',
        payload: { version: STORE_VERSION, page, cleared: true, savedAt },
      }))
      return true
    } catch (error) {
      state.degraded = `credentials tombstone failed: ${errorMessage(error)}`
      return false
    }
  }

  async function readPage(page) {
    state.reads += 1
    // Read both sides instead of returning the credential immediately. The
    // old credential can still be present, and it must not win just because of
    // its storage location. Old plaintext file entries written by earlier
    // builds are still read here (they are removed by the clear route); new
    // saves never write such entries (CH-06).
    const [credentials, file] = await Promise.all([readCredentials(page), readFileStore()])
    const slot = file.pages && file.pages[page]
    const slotValid = !!slot && slot.version === STORE_VERSION
    const fileSavedAt = slotValid && typeof slot.savedAt === 'string' ? slot.savedAt : ''
    const fileTs = timestampOf(fileSavedAt)
    const credentialTs = timestampOf(credentials.savedAt)
    let fileEntries = null
    let fileCleared = false
    if (slotValid) {
      if (slot.cleared === true) {
        fileCleared = true
      } else {
        const normalized = normalizeWebLoginEntries(slot.entries)
        if (normalized.ok) fileEntries = normalized.entries
      }
    }

    if (credentials.found) {
      // A newer file entry wins over an older credential. A tombstone wins on
      // an equal timestamp so an undeletable old grant cannot resurrect a
      // deliberate sign-out.
      if (fileCleared && (!credentialTs || fileTs >= credentialTs)) {
        state.source = 'file'
        return { ok: true, found: false, source: 'file', cleared: true }
      }
      if (fileEntries && fileTs > credentialTs) {
        state.source = 'file'
        return { ok: true, found: true, entries: fileEntries, savedAt: fileSavedAt, source: 'file' }
      }
      state.source = 'credentials'
      return { ok: true, found: true, entries: credentials.entries, savedAt: credentials.savedAt, source: 'credentials' }
    }

    if (credentials.cleared) {
      // The credential tombstone is the newest deliberate state. Only a later
      // save (strictly newer timestamp) may restore the file copy; an older
      // file entry is exactly the stale login this clear was meant to remove.
      if (fileEntries && fileTs > credentialTs) {
        state.source = 'file'
        return { ok: true, found: true, entries: fileEntries, savedAt: fileSavedAt, source: 'file' }
      }
      state.source = 'credentials'
      return { ok: true, found: false, source: 'credentials', cleared: true }
    }

    if (fileCleared) {
      state.source = 'file'
      return { ok: true, found: false, source: 'file', cleared: true }
    }
    if (fileEntries) {
      state.source = 'file'
      return { ok: true, found: true, entries: fileEntries, savedAt: fileSavedAt, source: 'file' }
    }
    state.source = credentials.available ? 'credentials' : 'file'
    return { ok: true, found: false, source: credentials.available ? 'credentials' : 'file' }
  }

  async function savePage(page, rawEntries) {
    return enqueueOperation(() => savePageTransaction(page, rawEntries))
  }

  async function savePageTransaction(page, rawEntries) {
    const normalized = normalizeWebLoginEntries(rawEntries)
    if (!normalized.ok) return { ok: false, error: normalized.error }
    const savedAt = await nextSavedAt(page)
    const payload = { version: STORE_VERSION, page, entries: normalized.entries, savedAt }

    const provider = credentialsOf()
    if (provider && typeof provider.modifyRecord === 'function') {
      try {
        await provider.modifyRecord(webLoginCredentialKey(page), async () => ({ kind: 'grant', payload }))
        state.writes += 1
        state.source = 'credentials'
        // Retire the older file copy, but do not turn a cleanup failure into a
        // credential-write failure: readPage compares timestamps, so the
        // encrypted copy still wins. Retrying by falling through would write a
        // second new copy and hide the real source.
        try {
          await enqueue(async () => {
            const file = await readFileStore()
            if (file.pages && file.pages[page]) {
              delete file.pages[page]
              await writeFileStore(file)
            }
          })
        } catch (error) {
          state.degraded = `file retire failed: ${errorMessage(error)}`
        }
        return { ok: true, savedAt, source: 'credentials', count: Object.keys(normalized.entries).length }
      } catch (error) {
        state.degraded = `credentials write failed: ${errorMessage(error)}`
      }
    } else {
      state.degraded = 'credentials provider unavailable'
    }

    // CH-06: without a usable credential store the entries must never hit the
    // plaintext JSON file. Write only a file tombstone (strictly newer savedAt)
    // so the read path cannot resurrect an older grant; the failure is reported
    // as the enumerated reason `credentials-unavailable`.
    try {
      await enqueue(async () => {
        const file = await readFileStore()
        file.pages = file.pages && typeof file.pages === 'object' ? file.pages : {}
        file.pages[page] = { version: STORE_VERSION, cleared: true, savedAt }
        await writeFileStore(file)
      })
    } catch (error) {
      state.degraded = `credentials unavailable: file tombstone failed: ${errorMessage(error)}`
    }
    return { ok: false, reason: 'credentials-unavailable', savedAt }
  }

  async function clearPage(page) {
    return enqueueOperation(() => clearPageTransaction(page))
  }

  async function clearPageTransaction(page) {
    // Adjudicate the current state before touching anything. `removed` reports
    // whether a saved login actually existed here; the request merely running
    // (writing a tombstone) must not be mistaken for clearing one. The
    // intermediate is the same post-adjudication `found` readPage returns:
    // true means the credential grant and/or the file copy held usable entries.
    const before = await readPage(page)
    const hadLogin = before.found === true

    const savedAt = await nextSavedAt(page)
    // Write the tombstone before touching the credential. If it cannot be
    // written, stop: deleting the grant first would let the old file copy
    // resurrect the login on the next read.
    try {
      await enqueue(async () => {
        const file = await readFileStore()
        file.pages = file.pages && typeof file.pages === 'object' ? file.pages : {}
        file.pages[page] = { version: STORE_VERSION, cleared: true, savedAt }
        await writeFileStore(file)
      })
    } catch (error) {
      state.degraded = `file clear failed: ${errorMessage(error)}`
      return { ok: false, error: 'could not clear the login snapshot' }
    }

    const provider = credentialsOf()
    let credentialClear = true
    if (provider) {
      let deleted = false
      if (typeof provider.deleteRecord === 'function') {
        try {
          await provider.deleteRecord(webLoginCredentialKey(page))
          deleted = true
        } catch (error) {
          state.degraded = `credentials delete failed: ${errorMessage(error)}`
        }
      }
      if (!deleted) credentialClear = await writeCredentialTombstone(provider, page, savedAt)
    }
    if (!credentialClear) {
      // The file tombstone still masks the old grant in readPage, but the
      // encrypted token is not actually gone. Do not report a clean success.
      return {
        ok: false,
        error: 'could not remove the encrypted login record',
        savedAt,
        maskedByFile: true,
      }
    }
    state.clears += 1
    // `removed` only describes the pre-clear state; failure responses below
    // keep their original shape and never carry this field.
    return { ok: true, savedAt, removed: hadLogin }
  }

  function pageFrom(request) {
    try {
      const url = new URL(request.url, 'http://localhost')
      return url.searchParams.get('page') || ''
    } catch (error) {
      void error
      return ''
    }
  }

  async function bodyOf(request, maxBytes) {
    const raw = await request.text()
    const limit = Number.isFinite(maxBytes) ? maxBytes : Infinity
    if (Buffer.byteLength(raw || '', 'utf8') > limit) return { ok: false, tooLarge: true }
    if (!raw || raw.trim().length === 0) return { ok: true, body: {} }
    try {
      const body = JSON.parse(raw)
      if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false }
      return { ok: true, body }
    } catch (error) {
      void error
      return { ok: false }
    }
  }

  const routes = [
    ['/api/dsh-sidebar-suite.web-login-load', ['GET'], async (request) => {
      const page = pageFrom(request)
      if (!isWebLoginPage(page)) return json({ ok: false, error: 'unknown page' }, 400)
      const result = await readPage(page)
      return json(result)
    }],
    ['/api/dsh-sidebar-suite.web-login-save', ['POST'], async (request) => {
      const parsed = await bodyOf(request, MAX_SAVE_BODY_BYTES)
      if (!parsed.ok) return json(
        { ok: false, error: parsed.tooLarge ? 'request body too large' : 'invalid JSON body' },
        parsed.tooLarge ? 413 : 400,
      )
      const page = parsed.body.page
      if (!isWebLoginPage(page)) return json({ ok: false, error: 'unknown page' }, 400)
      const result = await savePage(page, parsed.body.entries)
      // `credentials-unavailable` is a deliberate 200 answer carrying an
      // enumerated reason; validation/store failures stay on the 400 path.
      return json(result, result.ok || result.reason === 'credentials-unavailable' ? 200 : 400)
    }],
    ['/api/dsh-sidebar-suite.web-login-clear', ['POST'], async (request) => {
      const parsed = await bodyOf(request)
      if (!parsed.ok) return json({ ok: false, error: 'invalid JSON body' }, 400)
      const page = parsed.body.page
      if (!isWebLoginPage(page)) return json({ ok: false, error: 'unknown page' }, 400)
      const result = await clearPage(page)
      return json(result, result.ok ? 200 : 500)
    }],
  ]

  function register(ctx) {
    const target = ctx || hostCtx
    if (!target) return 0
    let registered = 0
    for (const [path, methods, handler] of routes) {
      try {
        const connection = typeof target.get === 'function' ? target.get('connection') : null
        const registry = connection && connection.fetch
        if (!registry || typeof registry.register !== 'function') {
          state.degraded = 'connection.fetch unavailable'
          continue
        }
        registry.register({
          path,
          methods,
          requestBody: 'buffered',
          fetch: (request) => originGuard(request, handler),
        })
        if (!state.routes.paths.includes(path)) state.routes.paths.push(path)
        registered += 1
      } catch (error) {
        const message = errorMessage(error)
        if (/already registered/i.test(message)) {
          if (!state.routes.paths.includes(path)) state.routes.paths.push(path)
          registered += 1
        } else {
          state.routes.errors.push(`${path}: ${message}`)
          state.degraded = `route registration failed: ${message}`
        }
      }
    }
    state.routes.registered = registered
    state.routes.errors = state.routes.errors.slice(-6)
    return registered
  }

  return {
    register,
    setContext,
    state,
    readPage,
    savePage,
    clearPage,
    storePath,
    credentialsOf,
  }
}
