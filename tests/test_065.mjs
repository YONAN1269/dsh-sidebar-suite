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
  }

  // ---- 3. file fallback actually returns the token ---------------------
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
    check('F1: fallback writes a file snapshot', saved.ok === true && saved.source === 'file', JSON.stringify(saved))
    const read = await host.readPage('chat')
    check('F2: fallback restores the token',
      read.ok && read.found && read.entries.userToken === entries.userToken,
      JSON.stringify(read))
    const store = host.storePath()
    check('F3: the snapshot is under DSH_HOME', store.startsWith(home), store)
    const raw = JSON.parse(fs.readFileSync(store, 'utf8'))
    check('F4: on-disk payload carries the token',
      raw.pages.chat.entries.userToken === entries.userToken)
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
