// dsh-sidebar-suite 1.1.1 — login snapshot survive a restart.
//
// The 1.1.0 snapshot handler ran only on did-finish-load / did-navigate-in-page.
// DeepSeek's QR login can swap the screen through an API call without a
// navigation event, so the token was never captured and a restart asked for the
// QR again. These checks lock in the two fixes: poll the live page, and keep
// the session keys ahead of the page's localStorage caches.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import {
  createWebLoginHost,
  normalizeWebLoginEntries,
} from '../lib/web-login-host.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const client = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

// Run the real restore/clear state machine from client.js without a browser:
// the block is the same source, with fetch/frame/timer edges injected so the
// failure paths can be driven deterministically.
function makeLoginRuntime(options = {}) {
  const start = client.indexOf('var WEB_LOGIN_CLEAR_KEY')
  const end = client.indexOf('function makeWebPagePanel(pageId)')
  if (start < 0 || end <= start) throw new Error('web-login state block not found')
  const block = client.slice(start, end)
  const calls = { load: 0, save: 0, clear: 0 }
  const timers = []
  const storage = options.storage || new Map()
  let timerId = 0
  let now = 10000
  let loadFailures = options.loadFailures || 0
  let clearFailures = options.clearFailures || 0
  const frame = {
    url: 'https://chat.deepseek.com/',
    entries: {},
    reloads: 0,
    applied: 0,
    getURL() { return this.url },
    reload() { this.reloads += 1 },
    focus() {},
    executeJavaScript(code) {
      if (String(code).indexOf('localStorage.setItem') >= 0) {
        this.applied += 1
        return true
      }
      return JSON.stringify(this.entries)
    },
  }
  const runtime = { disposed: false }
  const documentStub = { hidden: false }
  const windowStub = {
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  }
  const setTimeoutStub = (fn, ms) => {
    timerId += 1
    timers.push({ id: timerId, fn, ms })
    return timerId
  }
  const clearTimeoutStub = (id) => {
    const index = timers.findIndex((timer) => timer.id === id)
    if (index >= 0) timers.splice(index, 1)
  }
  const dateStub = { now: () => now }
  const tempCall = (path) => {
    if (path.indexOf('-load') >= 0) {
      calls.load += 1
      if (loadFailures > 0) {
        loadFailures -= 1
        return Promise.resolve({ ok: false, found: false })
      }
      return Promise.resolve({ ok: true, found: true, entries: { userToken: 'snap-token' } })
    }
    if (path.indexOf('-clear') >= 0) {
      calls.clear += 1
      if (clearFailures > 0) {
        clearFailures -= 1
        return Promise.resolve({ ok: false })
      }
      return Promise.resolve({ ok: true })
    }
    if (path.indexOf('-save') >= 0) {
      calls.save += 1
      return Promise.resolve({ ok: true })
    }
    return Promise.resolve({ ok: false })
  }
  const factory = new Function(
    'WEB_LOGIN_API', 'tempCall', 'runtime', 'document', 'window', 'setTimeout', 'clearTimeout', 'Date',
    block + '\nreturn { webLoginState: webLoginState, restoreWebLogin: restoreWebLogin,'
      + ' clearWebLogin: clearWebLogin, captureWebLogin: captureWebLogin,'
      + ' resetWebLoginPage: resetWebLoginPage }',
  )
  const api = factory('api/dsh-sidebar-suite.web-login', tempCall, runtime, documentStub, windowStub,
    setTimeoutStub, clearTimeoutStub, dateStub)
  const flush = async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const runTimer = (ms) => {
    const index = timers.findIndex((timer) => timer.ms === ms)
    if (index < 0) return false
    const timer = timers.splice(index, 1)[0]
    timer.fn()
    return true
  }
  return {
    api, frame, calls, timers, storage, flush, runTimer,
    advance(ms) { now += ms },
  }
}

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

async function main() {
  // ---- 1. token survives a noisy localStorage map ---------------------
  {
    const noisy = {}
    for (let i = 0; i < 70; i += 1) noisy[`cache-entry-${i}`] = `value-${i}`
    noisy.userToken = '{"value":"session-token","__version":"0"}'
    noisy.__appKit_userInfo = '{"id":"user-1"}'
    noisy['deepseek-device-id:chat'] = 'device-chat'
    noisy['deepseek-device-id:platform'] = 'device-api'

    const normalized = normalizeWebLoginEntries(noisy)
    check('N1: noisy map is accepted', normalized.ok === true, JSON.stringify(normalized))
    check('N2: userToken survives the 64-entry budget',
      normalized.ok && normalized.entries.userToken === noisy.userToken)
    check('N3: user info survives', normalized.ok && normalized.entries.__appKit_userInfo === noisy.__appKit_userInfo)
    check('N4: both device ids survive',
      normalized.ok
      && normalized.entries['deepseek-device-id:chat'] === 'device-chat'
      && normalized.entries['deepseek-device-id:platform'] === 'device-api')
    check('N5: userToken is first in the stored order',
      normalized.ok && Object.keys(normalized.entries)[0] === 'userToken',
      normalized.ok ? Object.keys(normalized.entries).join(',') : 'rejected')
  }

  // ---- 1b. an empty logged-out wrapper is not a live token -------------
  {
    const start = client.indexOf('function tokenText')
    const end = client.indexOf('function isSignInUrl')
    check('V0: token helpers are locatable', start >= 0 && end > start)
    const tokenFns = vm.runInNewContext(
      client.slice(start, end) + ';({ hasWebToken: hasWebToken, tokenText: tokenText })',
      {},
    )
    check('V1: a wrapped token is live',
      tokenFns.hasWebToken({ userToken: '{"value":"abc","__version":"0"}' }) === true)
    check('V2: a direct JWT is live',
      tokenFns.hasWebToken({ userToken: 'abc.def.ghi' }) === true)
    check('V3: a null wrapper is not a live token',
      tokenFns.hasWebToken({ userToken: '{"value":null,"__version":"0"}' }) === false)
    check('V4: an empty wrapper is not a live token',
      tokenFns.hasWebToken({ userToken: '{"value":"","__version":"0"}' }) === false)
    check('V5: user info alone is not a live token',
      tokenFns.hasWebToken({ __appKit_userInfo: '{"id":"u"}' }) === false)
  }

  // ---- 2. the live-page poll is present -------------------------------
  {
    check('C1: the page effect starts a capture poll',
      client.includes('capturePoll = setInterval') && client.includes('captureWebLogin(pageId, frame)'))
    check('C2: did-navigate is listened to, not only in-page',
      client.includes("addEventListener('did-navigate', onDidNavigate)"))
    check('C3: ready/finish capture immediately',
      client.includes('captureWebLogin(pageId, frame, true)'))
    check('C4: a sign-in URL no longer suppresses a present token',
      client.includes('if (hasWebToken(entries))') &&
      !client.includes('if (isSignInUrl(url)) {\n              // Logging out'))
    check('C5: only session keys are copied',
      client.includes('^userToken$') && client.includes('^deepseek-device-id'))
    check('C6: a successful save is deduplicated by fingerprint',
      client.includes("state.lastSaved = fingerprint"))
    check('C7: a failed save is retried, not recorded as saved',
      client.includes("if (data && data.ok === true)") &&
      client.indexOf('state.lastSaved = fingerprint') > client.indexOf('if (data && data.ok === true)'))
    const reloadBlock = client.slice(client.indexOf('function reload()'), client.indexOf('function openExternal()'))
    check('C10: a page reload handles the loadURL rejection and returns to loading',
      reloadBlock.indexOf("setStatus('loading')") >= 0
      && reloadBlock.indexOf("pending.catch(function (error)") >= 0
      && reloadBlock.indexOf("setStatus('error')") >= 0,
      reloadBlock ? reloadBlock.slice(0, 120) : 'no reload block')
    check('C11: did-fail-load no longer swallows a real -2 failure',
      client.includes('if (event && event.errorCode === -3) return')
      && !client.includes('event.errorCode === -3 || event.errorCode === -2'))
  }

  // ---- 2b. restore retries a failed host route -------------------------
  // A missing /api route used to latch `restored` before the request ran, so
  // every later dom-ready was a no-op. The first failed load must leave the
  // latch open and schedule a retry; the second load has to apply the snapshot.
  {
    const h = makeLoginRuntime({ loadFailures: 1 })
    h.api.restoreWebLogin('chat', h.frame)
    await h.flush()
    check('R1: a failed snapshot load does not latch the page as restored',
      h.calls.load === 1 && h.api.webLoginState.chat.restored === false,
      JSON.stringify({ loads: h.calls.load, state: h.api.webLoginState.chat }))
    check('R2: a failed snapshot load schedules a bounded retry',
      h.timers.some((timer) => timer.ms === 5000), JSON.stringify(h.timers))
    h.runTimer(5000)
    await h.flush()
    check('R3: the retry loads the snapshot and applies it',
      h.calls.load === 2 && h.frame.applied === 1 && h.frame.reloads === 1,
      JSON.stringify({ loads: h.calls.load, applied: h.frame.applied, reloads: h.frame.reloads }))
    check('R4: a successful retry latches restored', h.api.webLoginState.chat.restored === true)
  }

  // ---- 2c. clear retries after a failed delete -------------------------
  // A deliberate logout must not leave the old snapshot on disk. The failed
  // clear stays pending, and a later capture on the sign-in page tries again.
  {
    const h = makeLoginRuntime({ clearFailures: 1 })
    const state = h.api.webLoginState.chat
    state.signedIn = true
    h.frame.url = 'https://chat.deepseek.com/sign_in'
    h.api.captureWebLogin('chat', h.frame, true)
    h.runTimer(0)
    await h.flush()
    check('C8: a failed clear stays pending instead of claiming success',
      h.calls.clear === 1 && state.clearPending === true,
      JSON.stringify({ clears: h.calls.clear, pending: state.clearPending }))
    h.advance(5000)
    h.api.captureWebLogin('chat', h.frame, true)
    h.runTimer(0)
    await h.flush()
    check('C9: the next sign-in capture retries the clear',
      h.calls.clear === 2 && state.clearPending === false,
      JSON.stringify({ clears: h.calls.clear, pending: state.clearPending }))
  }

  // ---- 2d. a failed logout survives a client restart -------------------
  // `clearPending` is memory-only. If the user quits DSH before a retry, the
  // next client must still know not to restore the old snapshot, and it must
  // retry the clear even after the page has moved off /sign_in.
  {
    const storage = new Map()
    const key = 'dsh-sidebar-suite:web-login-clear:chat'
    const h1 = makeLoginRuntime({ clearFailures: 1, storage })
    const state1 = h1.api.webLoginState.chat
    state1.signedIn = true
    h1.frame.url = 'https://chat.deepseek.com/sign_in'
    h1.api.captureWebLogin('chat', h1.frame, true)
    h1.runTimer(0)
    await h1.flush()
    check('C12: a failed clear persists the logout intent in localStorage',
      h1.calls.clear === 1 && state1.clearPending === true && storage.get(key) === '1',
      JSON.stringify({ clears: h1.calls.clear, pending: state1.clearPending, flag: storage.get(key) }))

    // A fresh runtime is a new process: no memory state, only the shared
    // localStorage map survives.
    const h2 = makeLoginRuntime({ storage })
    const state2 = h2.api.webLoginState.chat
    check('C13: a restarted client rehydrates the pending logout',
      state2.clearPending === true, JSON.stringify(state2))

    h2.api.restoreWebLogin('chat', h2.frame)
    await h2.flush()
    check('C14: a pending logout blocks snapshot restore after restart',
      h2.calls.load === 0 && state2.restored === false,
      JSON.stringify({ loads: h2.calls.load, restored: state2.restored }))

    // The remounted page can be on the normal URL. Waiting for /sign_in would
    // leave the old snapshot behind; capture must retry on any route.
    h2.frame.url = 'https://chat.deepseek.com/'
    h2.api.captureWebLogin('chat', h2.frame, true)
    h2.runTimer(0)
    await h2.flush()
    check('C15: a pending logout retries on a normal URL and clears the flag',
      h2.calls.clear === 1 && state2.clearPending === false && !storage.has(key),
      JSON.stringify({ clears: h2.calls.clear, pending: state2.clearPending, flag: storage.get(key) }))
  }

  // ---- 2e. a new login supersedes a pending logout ----------------------
  {
    const storage = new Map([['dsh-sidebar-suite:web-login-clear:chat', '1']])
    const key = 'dsh-sidebar-suite:web-login-clear:chat'
    const h = makeLoginRuntime({ storage })
    const state = h.api.webLoginState.chat
    check('C16: a new runtime starts with the persisted logout flag',
      state.clearPending === true)
    h.frame.url = 'https://chat.deepseek.com/'
    h.frame.entries = { userToken: '{"value":"new-token","__version":"0"}' }
    h.api.captureWebLogin('chat', h.frame, true)
    h.runTimer(0)
    await h.flush()
    check('C17: a successful new save removes the stale logout flag',
      h.calls.save === 1 && h.calls.clear === 0 &&
      state.clearPending === false && !storage.has(key),
      JSON.stringify({ saves: h.calls.save, clears: h.calls.clear, flag: storage.get(key) }))
  }

  // ---- 3. credential store unavailable: tombstone only, no plaintext entry -
  {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-login-'))
    process.env.DSH_HOME = home
    const host = createWebLoginHost({ get() { return null } })
    const entries = {
      'cache-entry-0': 'x',
      userToken: '{"value":"session-token","__version":"0"}',
      __appKit_userInfo: '{"id":"user-1"}',
    }
    const saved = await host.savePage('chat', entries)
    check('F1: unavailable credentials report credentials-unavailable',
      saved.ok === false && saved.reason === 'credentials-unavailable', JSON.stringify(saved))
    const read = await host.readPage('chat')
    check('F2: nothing readable is restored from the plaintext file',
      read.ok && read.found === false, JSON.stringify(read))
    const store = host.storePath()
    check('F3: the snapshot file is under DSH_HOME', store.startsWith(home), store)
    const raw = JSON.parse(fs.readFileSync(store, 'utf8'))
    check('F4: on-disk payload carries no entries, only a tombstone',
      raw.pages.chat.cleared === true && !raw.pages.chat.entries, JSON.stringify(raw.pages.chat))
    fs.rmSync(home, { recursive: true, force: true })
    delete process.env.DSH_HOME
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
