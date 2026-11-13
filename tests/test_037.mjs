// dsh-sidebar-suite 0.5.1 — ids like `.` / `..` must never reach the disk.
//
// Reported after 0.5.0 was listed: "before deleting a temporary session, reject
// identifiers such as ./.. and confirm the target is inside the sessions
// directory". Both were real. `normalizeId` accepted any string of
// `[A-Za-z0-9._:-]`, which includes `..`, and `join(root, workspace, '..')`
// collapses to the workspace directory itself — so a single poisoned id
// (`?sessionId=..`, or one bad line in temp-sessions.json replayed by the
// startup purge) recursively removed every session in that workspace.
//
// This suite drives the real module against a throwaway DSH_HOME and asserts on
// the filesystem after each call: the routes must refuse the id, and the purge
// must leave the neighbouring sessions untouched even when the store is
// poisoned. Replace temp-session-host.mjs with the 0.5.0 bundle and the
// "store stays intact" assertions fail.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const MODULE = pathToFileURL(path.join(ROOT, 'lib', 'temp-session-host.mjs')).href

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-guard-'))
process.env.DSH_HOME = HOME
const SESSIONS = path.join(HOME, 'sessions')
const STORE = path.join(HOME, 'dsh-sidebar-suite', 'temp-sessions.json')

function makeSession(workspace, id) {
  const dir = path.join(SESSIONS, workspace, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'), '{"role":"user"}\n', 'utf8')
  return dir
}

/** Boot one fresh copy of the module (module state is a singleton). */
async function boot(tag) {
  const mod = await import(MODULE + '?guard=' + tag)
  const routes = new Map()
  const ctx = {
    get(name) {
      if (name !== 'connection') return null
      return { fetch: { register(route) { routes.set(route.path, route) } } }
    },
  }
  const host = mod.createTempSessionHost(ctx)
  host.register(ctx)
  return { host, routes }
}

async function callRemove(routes, query) {
  const route = routes.get('/api/dsh-temp-session.remove')
  const response = await route.fetch(new Request('http://localhost/api/dsh-temp-session.remove?' + query, { method: 'POST' }))
  let body = null
  try { body = await response.json() } catch (error) { void error }
  return { status: response.status, body }
}

const keepA = makeSession('ws-a', 'session-keep')
const tempA = makeSession('ws-a', 'session-temp-a')
const keepB = makeSession('ws-b', 'session-keep')
const tempB = makeSession('ws-b', 'session-temp-b')

const first = await boot('routes')

// --- 1. hostile ids are refused by the route -------------------------------
const hostile = [
  ['..', '..'],
  ['.', '.'],
  ['%2e%2e', '.. (percent-encoded)'],
  ['..%2f..', '..%2f..'],
  ['..%5c..', '..%5c..'],
  ['a..b', 'a..b'],
  ['%2e', '. (percent-encoded)'],
]
for (const [query, label] of hostile) {
  const result = await callRemove(first.routes, 'sessionId=' + query)
  check('remove route refuses "' + label + '"', result.status === 400, 'status ' + result.status + ' body ' + JSON.stringify(result.body))
}

check('no session directory was touched by the hostile calls',
  fs.existsSync(keepA) && fs.existsSync(tempA) && fs.existsSync(keepB) && fs.existsSync(tempB))

// --- 2. a legitimate id still deletes --------------------------------------
await callRemove(first.routes, 'sessionId=session-temp-a') // untracked first
await first.host.track('session-temp-a')
const legit = await callRemove(first.routes, 'sessionId=session-temp-a')
check('tracked temporary session is deleted', legit.status === 200 && legit.body && legit.body.ok === true, JSON.stringify(legit.body))
check('its directory is gone', !fs.existsSync(tempA))
check('the other session in the same workspace survives', fs.existsSync(keepA))

// --- 3. a poisoned store cannot delete neighbours --------------------------
// Exactly what a hand-edited (or corrupted) temp-sessions.json can contain.
fs.writeFileSync(STORE, JSON.stringify({ version: 1, sessions: ['..', '.', 'session-temp-b'] }, null, 2), 'utf8')

const second = await boot('poisoned')
// Register fires the startup purge without awaiting it; every route awaits the
// readiness gate, so this is the same order the real app sees.
const statusRoute = second.routes.get('/api/dsh-temp-session.status')
await statusRoute.fetch(new Request('http://localhost/api/dsh-temp-session.status'))

check('startup purge keeps ws-a/session-keep', fs.existsSync(keepA))
check('startup purge keeps ws-b/session-keep', fs.existsSync(keepB))
check('startup purge still deletes the real temporary session', !fs.existsSync(tempB))

let rewritten = ''
try { rewritten = fs.readFileSync(STORE, 'utf8') } catch (error) { void error }
let storedIds = []
try { storedIds = JSON.parse(rewritten).sessions } catch (error) { void error }
check('the poisoned ids are not carried over', Array.isArray(storedIds) && !storedIds.includes('..') && !storedIds.includes('.'), JSON.stringify(storedIds))

// --- 4. a symlinked "session directory" is not followed ---------------------
const outside = path.join(HOME, 'outside-target')
fs.mkdirSync(outside, { recursive: true })
fs.writeFileSync(path.join(outside, 'important.txt'), 'keep me', 'utf8')
const linkId = 'session-linked'
const linkPath = path.join(SESSIONS, 'ws-a', linkId)
try {
  fs.symlinkSync(outside, linkPath, 'junction')
  await second.host.track(linkId)
  await callRemove(second.routes, 'sessionId=' + linkId)
  check('a symlink standing in for a session directory is not removed through',
    fs.existsSync(path.join(outside, 'important.txt')))
} catch (error) {
  check('symlink case skipped (privilege)', true, String(error && error.message))
}

try { fs.rmSync(HOME, { recursive: true, force: true }) } catch (error) { void error }

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
