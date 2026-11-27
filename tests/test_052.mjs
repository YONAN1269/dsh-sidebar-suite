// dsh-sidebar-suite 0.8.1 (fourth pass) — independent re-review of the trash.
//
//   1. A byte-cap trim skipped the big entry and kept older small ones. The
//      docs say "oldest go first"; the loop actually kept a non-contiguous tail.
//
// Host checks use a throwaway DSH_HOME. No user data is touched.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOST = pathToFileURL(path.join(ROOT, 'lib', 'temp-session-host.mjs')).href + '?v052=1'

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra === undefined ? '' : '  ->  ' + JSON.stringify(extra))) }
}

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-052-'))
process.env.DSH_HOME = HOME
const SESSIONS = path.join(HOME, 'sessions')
const PROJ = path.join(HOME, 'storages', 'session_projcache', 'sessions')
const DATA = path.join(HOME, 'dsh-sidebar-suite')
const TRASH = path.join(DATA, 'trash')
const CONFIG = path.join(DATA, 'temp-session-config.txt')
fs.mkdirSync(PROJ, { recursive: true })
fs.mkdirSync(DATA, { recursive: true })
fs.writeFileSync(CONFIG, [
  'DELETE_ON_EXIT=off', 'SCHEDULE_DELETE=off',
  'KEEP_DELETED=on', 'KEEP_DELETED_DAYS=7', '',
].join('\n'), 'utf8')

const routes = new Map()
const registry = { register(route) { routes.set(route.path, route); return async () => routes.delete(route.path) } }
const ctx = {
  connection: { fetch: registry },
  get(name) {
    if (name === 'connection') return ctx.connection
    if (name === 'workspaceRegistry') return { archiveSession: async () => true }
    return undefined
  },
  logger: { debug() {}, warn() {}, info() {}, error() {} },
}
const mod = await import(HOST)
const host = mod.createTempSessionHost(ctx)
host.register(ctx)

async function call(p, init) {
  const route = routes.get(String(p).split('?')[0])
  if (!route) throw new Error('no route for ' + p)
  const res = await route.fetch(new Request('http://dsh.invalid' + p, init))
  return res.json()
}
function seed(id, workspace) {
  const dir = path.join(SESSIONS, workspace || '--proj--', id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'x.jsonl'), 'content-' + id)
  return dir
}
const MB = 1024 * 1024
function metaOf(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) }
  catch (error) { void error; return null }
}
/** Order the parked entries by their own deletedAt, oldest first. */
function oldestFirst() {
  return fs.readdirSync(TRASH, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ key: e.name, dir: path.join(TRASH, e.name), meta: metaOf(path.join(TRASH, e.name)) }))
    .filter((e) => !!e.meta && typeof e.meta.deletedAt === 'string')
    .sort((a, b) => Date.parse(a.meta.deletedAt) - Date.parse(b.meta.deletedAt))
}
/** Force a size without writing hundred-megabyte files: the cap reads meta.bytes. */
function setBytes(entry, bytes) {
  entry.meta.bytes = bytes
  fs.writeFileSync(path.join(entry.dir, 'meta.json'), JSON.stringify(entry.meta), 'utf8')
}

try {
  // ---- A1. a size trim removes the OLDEST entries, not a non-contiguous set --
  // Deleted in this order, so t1 is the OLDEST and t4 the NEWEST entry.
  const ids = ['t1-oldest', 't2', 't3', 't4-newest']
  for (const id of ids) {
    seed(id)
    await call('/api/dsh-temp-session.track?sessionId=' + id, { method: 'POST' })
  }
  await new Promise((resolve) => setTimeout(resolve, 15))
  for (const id of ids) await call('/api/dsh-temp-session.remove?sessionId=' + id, { method: 'POST' })

  const ordered = oldestFirst()
  check('A1: all four sessions are parked before trimming', ordered.length === 4, ordered.map((e) => e.meta.id))
  if (ordered.length === 4) {
    check('A1: the deletion order is the retention order',
      ordered.map((e) => e.meta.id).join(',') === ids.join(','), ordered.map((e) => e.meta.id))
    // The newest is small, the SECOND newest is huge. A contiguous trim keeps
    // only the newest; the old loop skipped the huge one and admitted the two
    // small entries behind it.
    const sizes = { 't1-oldest': MB, 't2': MB, 't3': 300 * MB, 't4-newest': 10 * MB }
    for (const entry of ordered) setBytes(entry, sizes[entry.meta.id] || MB)
    // GET /trash is read-only: it lists every parked entry without trimming.
    const listedBefore = await call('/api/dsh-temp-session.trash')
    const beforeTrim = (Array.isArray(listedBefore.entries) ? listedBefore.entries : []).map((e) => e.id).sort()
    check('A1: GET trash lists all four entries without trimming', beforeTrim.length === 4, beforeTrim)
    // The size trim runs on the purge path (purgeAll -> pruneTrashSync).
    await call('/api/dsh-temp-session.purge', { method: 'POST' })
    const listed = await call('/api/dsh-temp-session.trash')
    const kept = (Array.isArray(listed.entries) ? listed.entries : []).map((e) => e.id).sort()
    check('A1: only the newest entry survives a byte-cap trim',
      kept.length === 1 && kept[0] === 't4-newest', kept)
    check('A1: the oldest entries are removed before a newer oversized one',
      kept.indexOf('t1-oldest') < 0 && kept.indexOf('t2') < 0, kept)
  }
} finally {
  // The host registers a real process 'exit' quit hook; it rewrites the config
  // under HOME on exit, which would recreate the fixture dir after we delete it.
  process.removeAllListeners('exit')
  try { fs.rmSync(HOME, { recursive: true, force: true }) }
  catch (error) { console.error('CLEANUP_FAIL ' + HOME + ' ' + error.code + ' ' + error.message) }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
