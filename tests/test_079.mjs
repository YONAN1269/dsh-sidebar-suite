// R-11 (TS-08) — login snapshot dual-store adjudication, normalize caps, and
// the rename EBUSY retry/degrade path; plus a real two-process restart check.
//
// In-process:
//   - 3 x 3 x 3 parameterized matrix: credential found/cleared/missing x file
//     found/cleared/missing x timestamp new/old/equal.
//   - normalize: over-long value, over-long key, 64KB total cap.
//   - injected rename failing EBUSY on every attempt: retry three times, then
//     degrade instead of losing the in-flight write chain.
//
// Cross-process (isolated temp dir, stub credential provider, fake test values
// only — no real credential): a first child clears while its provider delete
// fails (file tombstone only); a second brand-new child reloads the module and
// must not restore the old login.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createWebLoginHost } from '../lib/web-login-host.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOME = mkdtempSync(join(tmpdir(), 'dsbs-079-'))
process.env.DSH_HOME = HOME
mkdirSync(join(HOME, 'dsh-sidebar-suite'), { recursive: true })
const STORE = join(HOME, 'dsh-sidebar-suite', 'web-login.json')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

const EPOCH = 1_700_000_000_000
const iso = (ms) => new Date(ms).toISOString()

function providerFor(credLabel) {
  if (credLabel === 'missing') {
    return {
      async readRecord() { return null },
      async modifyRecord() {},
      async deleteRecord() {},
    }
  }
  const payload = credLabel === 'cleared'
    ? { version: 1, page: 'chat', cleared: true, savedAt: iso(EPOCH) }
    : { version: 1, page: 'chat', entries: { token: 'CRED-VALUE' }, savedAt: iso(EPOCH) }
  return {
    async readRecord() { return { kind: 'grant', payload } },
    async modifyRecord() {},
    async deleteRecord() {},
  }
}

function writeSlot(fileLabel, rel) {
  const file = { version: 1, pages: {} }
  if (fileLabel !== 'missing') {
    const f = rel === 'new' ? EPOCH + 1000 : rel === 'old' ? EPOCH - 1000 : EPOCH
    file.pages.chat = fileLabel === 'cleared'
      ? { version: 1, cleared: true, savedAt: iso(f) }
      : { version: 1, entries: { token: 'FILE-VALUE' }, savedAt: iso(f) }
  }
  writeFileSync(STORE, JSON.stringify(file))
}

function expected(credLabel, fileLabel, rel) {
  if (credLabel === 'found') {
    if (fileLabel === 'cleared') {
      const fileWins = rel !== 'old' // fileTs >= credentialTs on new/equal
      return fileWins
        ? { found: false, cleared: true, source: 'file' }
        : { found: true, cleared: false, source: 'credentials' }
    }
    if (fileLabel === 'found') {
      return rel === 'new'
        ? { found: true, cleared: false, source: 'file' }
        : { found: true, cleared: false, source: 'credentials' }
    }
    return { found: true, cleared: false, source: 'credentials' }
  }
  if (credLabel === 'cleared') {
    if (fileLabel === 'found' && rel === 'new') return { found: true, cleared: false, source: 'file' }
    return { found: false, cleared: true, source: 'credentials' }
  }
  if (fileLabel === 'found') return { found: true, cleared: false, source: 'file' }
  if (fileLabel === 'cleared') return { found: false, cleared: true, source: 'file' }
  return { found: false, cleared: false, source: 'credentials' }
}

function hostFor(credLabel, renameImpl) {
  const ctx = {
    get: (name) => (name === 'credentials' ? providerFor(credLabel) : null),
    logger: { debug() {}, warn() {}, info() {}, error() {} },
  }
  return createWebLoginHost(ctx, renameImpl ? { renameImpl } : undefined)
}

async function main() {
  // ---- R-11: 27-case adjudication matrix ---------------------------------
  const credLabels = ['found', 'cleared', 'missing']
  const fileLabels = ['found', 'cleared', 'missing']
  const rels = ['new', 'old', 'equal']
  let matrixCount = 0
  for (const cred of credLabels) {
    for (const file of fileLabels) {
      for (const rel of rels) {
        writeSlot(file, rel)
        const host = hostFor(cred)
        const res = await host.readPage('chat')
        const exp = expected(cred, file, rel)
        const ok = res.found === exp.found
          && (res.cleared === true) === exp.cleared
          && (exp.source === null || res.source === exp.source)
        matrixCount += 1
        check(`R-11: adjudication ${cred}/${file}/${rel}`, ok,
          JSON.stringify({ res: { found: res.found, cleared: res.cleared, source: res.source }, exp }))
      }
    }
  }
  check('R-11: the matrix ran all 27 cases', matrixCount === 27, String(matrixCount))

  // ---- normalize: over-long value, over-long key, 64KB total cap --------
  writeFileSync(STORE, JSON.stringify({ version: 1, pages: {} }))
  const noCred = { get: () => null, logger: { debug() {}, warn() {}, info() {}, error() {} } }

  const longValue = createWebLoginHost(noCred)
  const rLongValue = await longValue.savePage('chat', { keep: 'x'.repeat(16385) })
  const afterLongValue = await longValue.readPage('chat')
  check('R-11: a value over 16384 chars is dropped',
    rLongValue.ok === false && afterLongValue.found === false,
    JSON.stringify({ rLongValue, afterLongValue }))

  const longKey = createWebLoginHost(noCred)
  const rLongKey = await longKey.savePage('chat', { ['k'.repeat(257)]: 'v' })
  check('R-11: a key over 256 chars is dropped', rLongKey.ok === false, JSON.stringify(rLongKey))

  writeFileSync(STORE, JSON.stringify({ version: 1, pages: {} }))
  const cappedRecords = new Map()
  const cappedProvider = {
    async readRecord(key) { return cappedRecords.get(key) || null },
    async modifyRecord(key, mutate) {
      const next = await mutate(cappedRecords.get(key))
      cappedRecords.set(key, next)
      return next
    },
    async deleteRecord(key) { cappedRecords.delete(key) },
  }
  const capped = createWebLoginHost({ get: (n) => (n === 'credentials' ? cappedProvider : null) })
  // Each value stays under the 16384 per-value cap; five 16000-char values
  // cross the 64KB total budget after the fourth, so the fifth is dropped.
  const lots = {
    a: 'y'.repeat(16000),
    b: 'z'.repeat(16000),
    c: 'y'.repeat(16000),
    d: 'z'.repeat(16000),
    e: 'y'.repeat(16000),
  }
  const rCapped = await capped.savePage('chat', lots)
  const afterCapped = await capped.readPage('chat')
  check('R-11: the 64KB total cap keeps entries under budget and drops the rest',
    rCapped.ok === true && afterCapped.found === true && Object.keys(afterCapped.entries).length === 4,
    JSON.stringify({ rCapped, afterCapped: afterCapped.entries && Object.keys(afterCapped.entries) }))

  // ---- EBUSY on every rename: retry thrice, then degrade ----------------
  let renameCalls = 0
  const ebusyRename = async () => {
    renameCalls += 1
    throw Object.assign(new Error('resource busy'), { code: 'EBUSY' })
  }
  const ebusyHost = createWebLoginHost(noCred, { renameImpl: ebusyRename })
  const rEbusy = await ebusyHost.savePage('chat', { token: 'TEST-VALUE' })
  check('R-11: a persistently EBUSY tombstone write fails cleanly',
    rEbusy.ok === false && rEbusy.reason === 'credentials-unavailable', JSON.stringify(rEbusy))
  check('R-11: the EBUSY path retries three times before giving up', renameCalls === 3, String(renameCalls))
  check('R-11: the retry/degrade failure is recorded in state.degraded',
    typeof ebusyHost.state.degraded === 'string' && ebusyHost.state.degraded.indexOf('credentials unavailable: file tombstone failed:') === 0,
    String(ebusyHost.state.degraded))

  // ---- CH-06: a provider without modifyRecord also gets tombstone-only ----
  const noModifyRecords = new Map()
  const noModifyProvider = { async readRecord(key) { return noModifyRecords.get(key) || null } }
  const noModifyHost = createWebLoginHost({ get: (n) => (n === 'credentials' ? noModifyProvider : null) })
  const rNoModify = await noModifyHost.savePage('chat', { token: 'TEST-VALUE' })
  check('R-11: a provider without modifyRecord reports credentials-unavailable',
    rNoModify.ok === false && rNoModify.reason === 'credentials-unavailable', JSON.stringify(rNoModify))
  const noModifySlot = JSON.parse(readFileSync(STORE, 'utf8')).pages.chat
  check('R-11: the modifyRecord-less provider leaves a tombstone and no entries',
    !!noModifySlot && noModifySlot.cleared === true && !noModifySlot.entries, JSON.stringify(noModifySlot))

  // ---- clear `removed` flag: empty store / seeded login / masked failure
  const OLD_KEY = 'dsh-sidebar-suite/web-login-chat'
  function mapProvider(records) {
    return {
      async readRecord(key) { return records.get(key) || null },
      async modifyRecord(key, mutate) { const next = await mutate(records.get(key)); records.set(key, next); return next },
      async deleteRecord(key) { records.delete(key) },
    }
  }
  const resetFileStore = () => writeFileSync(STORE, JSON.stringify({ version: 1, pages: {} }))

  resetFileStore()
  const emptyHost = createWebLoginHost(noCred)
  const clearEmpty = await emptyHost.clearPage('chat')
  check('R-11: clear on an empty store reports ok:true, removed:false',
    clearEmpty.ok === true && clearEmpty.removed === false && typeof clearEmpty.savedAt === 'string',
    JSON.stringify(clearEmpty))

  resetFileStore()
  const seeded = new Map()
  seeded.set(OLD_KEY, { kind: 'grant', payload: { version: 1, page: 'chat', entries: { token: 'TEST-VALUE' }, savedAt: '2020-01-01T00:00:00.000Z' } })
  const seededHost = createWebLoginHost({ get: (n) => (n === 'credentials' ? mapProvider(seeded) : null) })
  const clearSeeded = await seededHost.clearPage('chat')
  check('R-11: clear on a seeded login reports ok:true, removed:true',
    clearSeeded.ok === true && clearSeeded.removed === true, JSON.stringify(clearSeeded))

  resetFileStore()
  const stuck = new Map()
  stuck.set(OLD_KEY, { kind: 'grant', payload: { version: 1, page: 'chat', entries: { token: 'TEST-VALUE' }, savedAt: '2020-01-01T00:00:00.000Z' } })
  const stuckProvider = {
    async readRecord(key) { return stuck.get(key) || null },
    async modifyRecord() { throw new Error('tombstone failed') },
    async deleteRecord() { throw new Error('delete failed') },
  }
  const stuckHost = createWebLoginHost({ get: (n) => (n === 'credentials' ? stuckProvider : null) })
  const clearStuck = await stuckHost.clearPage('chat')
  check('R-11: a masked clear failure never reports removed:true',
    clearStuck.ok === false && clearStuck.maskedByFile === true && clearStuck.removed !== true,
    JSON.stringify(clearStuck))

  // ---- Cross-process restart: stub provider, two fresh node children -----
  await runCrossProcess()

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

// ---------------------------------------------------------------------------
// Cross-process section
// ---------------------------------------------------------------------------
const CHILD_LINES = [
  'import { readFileSync, writeFileSync, existsSync } from "node:fs"',
  'import { pathToFileURL } from "node:url"',
  'const [mode, homeDir, recordsFile, failFile, libPath] = process.argv.slice(2)',
  'process.env.DSH_HOME = homeDir',
  'const records = () => { try { return JSON.parse(readFileSync(recordsFile, "utf8")) } catch (error) { return {} } }',
  'const saveRecords = (r) => writeFileSync(recordsFile, JSON.stringify(r, null, 2))',
  'const provider = {',
  '  async readRecord(key) { const r = records()[key]; return r ? { kind: "grant", payload: r.payload } : null },',
  '  async modifyRecord(key, fn) {',
  '    if (existsSync(failFile)) throw Object.assign(new Error("EACCES modify"), { code: "EACCES" })',
  '    const cur = records()[key]; const next = await fn(cur); saveRecords({ ...records(), [key]: next })',
  '  },',
  '  async deleteRecord(key) {',
  '    if (existsSync(failFile)) throw Object.assign(new Error("EACCES delete"), { code: "EACCES" })',
  '    const r = records(); delete r[key]; saveRecords(r)',
  '  },',
  '}',
  'const { createWebLoginHost } = await import(pathToFileURL(libPath).href)',
  'const ctx = { get: (n) => (n === "credentials" ? provider : null), logger: { debug() {}, warn() {}, info() {}, error() {} } }',
  'const host = createWebLoginHost(ctx)',
  'if (mode === "seed") {',
  '  const key = "dsh-sidebar-suite/web-login-chat"',
  '  saveRecords({ [key]: { kind: "grant", payload: { version: 1, page: "chat", entries: { token: "TEST-VALUE" }, savedAt: "2020-01-01T00:00:00.000Z" } } })',
  '  console.log("SEED_OK")',
  '} else if (mode === "clear") {',
  '  const result = await host.clearPage("chat")',
  '  console.log("CLEAR_RESULT " + JSON.stringify(result))',
  '} else {',
  '  const result = await host.readPage("chat")',
  '  console.log("READ_RESULT " + JSON.stringify({ found: result.found, cleared: result.cleared === true, source: result.source }))',
  '}',
]

function runChild(childScript, mode, procDir, recordsFile, failFile, libPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [childScript, mode, procDir, recordsFile, failFile, libPath], {
      env: { ...process.env, DSH_HOME: procDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }))
    child.on('error', reject)
  })
}

async function runCrossProcess() {
  const procDir = mkdtempSync(join(tmpdir(), 'dsbs-079-proc-'))
  const homeDir = join(procDir, 'home')
  mkdirSync(homeDir, { recursive: true })
  const recordsFile = join(procDir, 'records.json')
  const failFile = join(procDir, 'fail.flag')
  const childScript = join(procDir, 'child.mjs')
  const libPath = ROOT + '/lib/web-login-host.mjs'
  writeFileSync(childScript, CHILD_LINES.join('\n') + '\n')

  let seed
  let clear
  let read
  try {
    seed = await runChild(childScript, 'seed', homeDir, recordsFile, failFile, libPath)
    check('R-11 cross-process: seed child exits cleanly', seed.code === 0, seed.err)

    // The provider delete (and its tombstone modify) must fail on this run.
    writeFileSync(failFile, 'fail')
    clear = await runChild(childScript, 'clear', homeDir, recordsFile, failFile, libPath)
    check('R-11 cross-process: clear child reports the masked failure',
      clear.code === 0 && /CLEAR_RESULT/.test(clear.out), clear.out + ' ' + clear.err)
    const clearLine = clear.out.split('\n').find((line) => line.startsWith('CLEAR_RESULT')) || ''
    const clearResult = JSON.parse(clearLine.slice('CLEAR_RESULT '.length))
    check('R-11 cross-process: grant delete failed but the file tombstone masks it',
      clearResult.ok === false && clearResult.maskedByFile === true, JSON.stringify(clearResult))

    // A brand-new process reloads the module; the old grant must not come back.
    read = await runChild(childScript, 'read', homeDir, recordsFile, failFile, libPath)
    check('R-11 cross-process: read child exits cleanly', read.code === 0, read.err)
    const readLine = read.out.split('\n').find((line) => line.startsWith('READ_RESULT')) || ''
    const readResult = JSON.parse(readLine.slice('READ_RESULT '.length))
    check('R-11 cross-process: the old login is not restored after restart',
      readResult.found === false && readResult.cleared === true && readResult.source === 'file',
      JSON.stringify(readResult))

    // The stale grant record is still on the provider side (delete failed),
    // but the file tombstone wins the adjudication.
    const records = JSON.parse(readFileSync(recordsFile, 'utf8'))
    const stale = Object.values(records)[0]
    check('R-11 cross-process: the undeleted grant still carries the fake test value',
      stale && stale.payload && stale.payload.entries && stale.payload.entries.token === 'TEST-VALUE',
      JSON.stringify(stale && stale.payload))

    console.log('\n[cross-process stdout summary]')
    console.log('  seed  : ' + seed.out)
    console.log('  clear : ' + clear.out)
    console.log('  read  : ' + read.out)
  } finally {
    try { rmSync(procDir, { recursive: true, force: true }) } catch (error) { void error }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => { try { rmSync(HOME, { recursive: true, force: true }) } catch (error) { void error } })
