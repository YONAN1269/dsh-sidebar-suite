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
 *   2. a 0600 JSON file under `~/.dsh/dsh-sidebar-suite/` when no credential
 *      provider is available
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
 */
export function createWebLoginHost(initialCtx) {
  let hostCtx = initialCtx || null
  let writeChain = Promise.resolve()

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

  async function readFileStore() {
    try {
      const raw = await readFile(storePath(), 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed || parsed.version !== STORE_VERSION || typeof parsed.pages !== 'object' || parsed.pages === null) {
        return emptyFile()
      }
      return parsed
    } catch (error) {
      void error
      return emptyFile()
    }
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
    await rm(file, { force: true })
    await rename(tmp, file)
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

  async function readCredentials(page) {
    const provider = credentialsOf()
    if (!provider) return { available: false, found: false }
    try {
      const record = await provider.readRecord(webLoginCredentialKey(page))
      if (!record || record.kind !== 'grant') return { available: true, found: false }
      const payload = record.payload
      if (!payload || payload.version !== STORE_VERSION) return { available: true, found: false }
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

  async function readPage(page) {
    state.reads += 1
    const credentials = await readCredentials(page)
    if (credentials.found) {
      state.source = 'credentials'
      return { ok: true, found: true, entries: credentials.entries, savedAt: credentials.savedAt, source: 'credentials' }
    }
    const file = await readFileStore()
    const slot = file.pages && file.pages[page]
    if (!slot || slot.version !== STORE_VERSION) {
      state.source = credentials.available ? 'credentials' : 'file'
      return { ok: true, found: false, source: credentials.available ? 'credentials' : 'file' }
    }
    const normalized = normalizeWebLoginEntries(slot.entries)
    if (!normalized.ok) {
      state.source = 'file'
      return { ok: true, found: false, source: 'file' }
    }
    state.source = 'file'
    return {
      ok: true,
      found: true,
      entries: normalized.entries,
      savedAt: typeof slot.savedAt === 'string' ? slot.savedAt : '',
      source: 'file',
    }
  }

  async function savePage(page, rawEntries) {
    const normalized = normalizeWebLoginEntries(rawEntries)
    if (!normalized.ok) return { ok: false, error: normalized.error }
    const savedAt = new Date().toISOString()
    const payload = { version: STORE_VERSION, page, entries: normalized.entries, savedAt }

    const provider = credentialsOf()
    if (provider && typeof provider.modifyRecord === 'function') {
      try {
        await provider.modifyRecord(webLoginCredentialKey(page), async () => ({ kind: 'grant', payload }))
        // A stale file copy would resurrect an older login if the credential
        // provider ever disappears, so a successful encrypted write retires it.
        await enqueue(async () => {
          const file = await readFileStore()
          if (file.pages && file.pages[page]) {
            delete file.pages[page]
            await writeFileStore(file)
          }
        })
        state.writes += 1
        state.source = 'credentials'
        return { ok: true, savedAt, source: 'credentials', count: Object.keys(normalized.entries).length }
      } catch (error) {
        state.degraded = `credentials write failed: ${errorMessage(error)}`
        // fall through to the file store
      }
    }

    try {
      await enqueue(async () => {
        const file = await readFileStore()
        file.pages = file.pages && typeof file.pages === 'object' ? file.pages : {}
        file.pages[page] = { version: STORE_VERSION, entries: normalized.entries, savedAt }
        await writeFileStore(file)
      })
      state.writes += 1
      state.source = 'file'
      return { ok: true, savedAt, source: 'file', count: Object.keys(normalized.entries).length }
    } catch (error) {
      state.degraded = `file write failed: ${errorMessage(error)}`
      return { ok: false, error: 'could not store the login snapshot' }
    }
  }

  async function clearPage(page) {
    const provider = credentialsOf()
    if (provider && typeof provider.deleteRecord === 'function') {
      try {
        await provider.deleteRecord(webLoginCredentialKey(page))
      } catch (error) {
        state.degraded = `credentials delete failed: ${errorMessage(error)}`
      }
    }
    try {
      await enqueue(async () => {
        const file = await readFileStore()
        if (file.pages && file.pages[page]) {
          delete file.pages[page]
          await writeFileStore(file)
        }
      })
    } catch (error) {
      state.degraded = `file clear failed: ${errorMessage(error)}`
      return { ok: false, error: 'could not clear the login snapshot' }
    }
    state.clears += 1
    return { ok: true }
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

  async function bodyOf(request) {
    const raw = await request.text()
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
      const parsed = await bodyOf(request)
      if (!parsed.ok) return json({ ok: false, error: 'invalid JSON body' }, 400)
      const page = parsed.body.page
      if (!isWebLoginPage(page)) return json({ ok: false, error: 'unknown page' }, 400)
      const result = await savePage(page, parsed.body.entries)
      return json(result, result.ok ? 200 : 400)
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
          fetch: (request) => handler(request),
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
