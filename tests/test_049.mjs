// dsh-sidebar-suite 0.8.0 — local trash: deletion becomes undoable.
//
// The one irreversible thing this plugin does is delete a conversation, and a
// user who loses one does not file an issue — they uninstall. So deletion now
// moves the directory into `<dshHome>/dsh-sidebar-suite/trash/` first.
//
// What must hold (each has a check below):
//   1. A delete still removes the session from the sessions root, and the bytes
//      survive under the trash with readable metadata.
//   2. Restore puts the exact content back and drops the trash entry.
//   3. A restored session is NOT re-tracked (it must not vanish again at quit).
//   4. KEEP_DELETED=off restores the old straight-delete behaviour.
//   5. Retention drops entries older than KEEP_DELETED_DAYS.
//   6. A tampered meta.workspace cannot write outside the sessions root.
//   7. A restore refuses when a session with that id already exists.
//
// Everything runs against a throwaway DSH_HOME. No machine-specific paths.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOST = pathToFileURL(path.join(ROOT, 'lib', 'temp-session-host.mjs')).href

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra === undefined ? '' : '  ->  ' + JSON.stringify(extra))) }
}

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-049-'))
process.env.DSH_HOME = HOME
const SESSIONS = path.join(HOME, 'sessions')
const DATA = path.join(HOME, 'dsh-sidebar-suite')
const TRASH = path.join(DATA, 'trash')
const CONFIG = path.join(DATA, 'temp-session-config.txt')

fs.mkdirSync(DATA, { recursive: true })
fs.mkdirSync(path.join(SESSIONS, '--proj--'), { recursive: true })
fs.writeFileSync(
  CONFIG,
  'DELETE_ON_EXIT=on\nSCHEDULE_DELETE=off\nKEEP_DELETED=on\nKEEP_DELETED_DAYS=7\n',
  'utf8',
)

function seed(id) {
  const dir = path.join(SESSIONS, '--proj--', id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'session.jsonl'), 'transcript-of-' + id)
  return dir
}

const routes = new Map()
const fetchRegistry = {
  register(route) {
    if (routes.has(route.path)) throw new Error('connection: exact Fetch route "' + route.path + '" is already registered')
    routes.set(route.path, route)
    return async () => routes.delete(route.path)
  },
}
const ctx = {
  connection: { fetch: fetchRegistry },
  get(name) {
    if (name === 'connection') return ctx.connection
    if (name === 'workspaceRegistry') return { archiveSession: async () => true }
    return undefined
  },
  logger: { debug() {}, warn() {}, info() {}, error() {} },
}

const mod = await import(HOST + '?v049=1')
const host = mod.createTempSessionHost(ctx)
host.register(ctx)

async function call(p, init) {
  const route = routes.get(String(p).split('?')[0])
  if (!route) throw new Error('no route for ' + p)
  const res = await route.fetch(new Request('http://dsh.invalid' + p, init))
  return res.json()
}

/** Trash entry directories currently on disk. */
function entries() {
  try {
    return fs.readdirSync(TRASH, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch (error) {
    void error
    return []
  }
}

try {
  // ---- 1. delete parks instead of unlinking -----------------------------
  const A = 'session-049-alpha'
  const dirA = seed(A)
  await call('/api/dsh-temp-session.track?sessionId=' + A, { method: 'POST' })
  const purgedA = await call('/api/dsh-temp-session.purge', { method: 'POST' })
  check('trash: purge still removes the session from the sessions root',
    purgedA.removed === 1 && !fs.existsSync(dirA), purgedA)

  const parked = entries()
  check('trash: exactly one entry was created', parked.length === 1, parked)
  const entryA = parked[0] || ''
  check('trash: entry key starts with a timestamp and ends with the id',
    /^[0-9]{10,16}-session-049-alpha$/.test(entryA), entryA)
  const metaA = (function () {
    try {
      return JSON.parse(fs.readFileSync(path.join(TRASH, entryA, 'meta.json'), 'utf8'))
    } catch (error) {
      void error
      return null
    }
  })()
  check('trash: metadata records id and workspace',
    !!metaA && metaA.id === A && metaA.workspace === '--proj--', metaA)
  check('trash: metadata records when it was deleted',
    !!metaA && typeof metaA.deletedAt === 'string' && Number.isFinite(Date.parse(metaA.deletedAt)), metaA && metaA.deletedAt)
  const payload = path.join(TRASH, entryA, 'data', 'session.jsonl')
  check('trash: the transcript survived the delete',
    fs.existsSync(payload) && fs.readFileSync(payload, 'utf8') === 'transcript-of-' + A)

  const listed = await call('/api/dsh-temp-session.trash')
  check('trash: the route lists the entry',
    listed.ok === true && listed.entries.length === 1 && listed.entries[0].key === entryA, listed)
  check('trash: the route reports the retention window',
    listed.keepDeleted === true && listed.keepDeletedDays === 7, listed)

  // ---- 2/3. restore puts it back, and does not re-track ------------------
  const restored = await call('/api/dsh-temp-session.trash-restore?key=' + encodeURIComponent(entryA), { method: 'POST' })
  check('trash: restore reports success', restored.ok === true && restored.id === A, restored)
  const back = path.join(SESSIONS, '--proj--', A, 'session.jsonl')
  check('trash: restored content is byte-identical',
    fs.existsSync(back) && fs.readFileSync(back, 'utf8') === 'transcript-of-' + A)
  check('trash: the entry is gone after restore', entries().length === 0, entries())
  check('trash: a restored session is not tracked as temporary again',
    (await call('/api/dsh-temp-session.list')).count === 0)
  const store = JSON.parse(fs.readFileSync(path.join(DATA, 'temp-sessions.json'), 'utf8'))
  check('trash: the store file does not list the restored id', store.sessions.length === 0, store)

  // ---- 4. KEEP_DELETED=off means straight delete -------------------------
  const off = await call('/api/dsh-temp-session.config', {
    method: 'POST',
    body: JSON.stringify({ keepDeleted: false }),
  })
  check('trash: the switch can be turned off', off.ok === true && off.keepDeleted === false, off)
  const B = 'session-049-beta'
  const dirB = seed(B)
  await call('/api/dsh-temp-session.track?sessionId=' + B, { method: 'POST' })
  const purgedB = await call('/api/dsh-temp-session.purge', { method: 'POST' })
  check('trash: with the switch off the session is deleted outright',
    purgedB.removed === 1 && !fs.existsSync(dirB), purgedB)
  check('trash: with the switch off nothing is parked', entries().length === 0, entries())

  // ---- 5. retention drops old entries ------------------------------------
  await call('/api/dsh-temp-session.config', {
    method: 'POST',
    body: JSON.stringify({ keepDeleted: true, keepDeletedDays: 7 }),
  })
  const C = 'session-049-gamma'
  seed(C)
  await call('/api/dsh-temp-session.track?sessionId=' + C, { method: 'POST' })
  await call('/api/dsh-temp-session.purge', { method: 'POST' })
  const aged = entries()
  check('trash: the retention entry exists before ageing', aged.length === 1, aged)
  const agedMetaPath = path.join(TRASH, aged[0] || 'missing', 'meta.json')
  if (aged.length === 1) {
    const meta = JSON.parse(fs.readFileSync(agedMetaPath, 'utf8'))
    meta.deletedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    fs.writeFileSync(agedMetaPath, JSON.stringify(meta, null, 2), 'utf8')
  }
  const afterAge = await call('/api/dsh-temp-session.trash')
  check('trash: an entry older than the retention window is pruned',
    afterAge.ok === true && afterAge.entries.length === 0, afterAge)
  check('trash: the pruned entry is gone from disk', entries().length === 0, entries())

  // ---- 6. tampered metadata cannot escape the sessions root -------------
  const evil = path.join(TRASH, '1700000000000-session-049-evil')
  fs.mkdirSync(path.join(evil, 'data'), { recursive: true })
  fs.writeFileSync(path.join(evil, 'data', 'session.jsonl'), 'x')
  fs.writeFileSync(path.join(evil, 'meta.json'), JSON.stringify({
    id: 'session-049-evil', workspace: '..', deletedAt: new Date().toISOString(), reason: 'test',
  }, null, 2), 'utf8')
  const evilRestore = await call('/api/dsh-temp-session.trash-restore?key=1700000000000-session-049-evil', { method: 'POST' })
  check('trash: a workspace of ".." is refused', evilRestore.ok === false, evilRestore)
  check('trash: the refused entry stays in the trash', entries().includes('1700000000000-session-049-evil'))

  const badKey = await call('/api/dsh-temp-session.trash-restore?key=' + encodeURIComponent('../../escape'), { method: 'POST' })
  check('trash: a traversal key is refused', badKey.ok === false, badKey)

  // ---- 7. restore refuses when the target already exists -----------------
  const D = 'session-049-delta'
  seed(D)
  await call('/api/dsh-temp-session.track?sessionId=' + D, { method: 'POST' })
  await call('/api/dsh-temp-session.purge', { method: 'POST' })
  const deltaEntry = entries().filter((name) => name.endsWith('-' + D))[0] || ''
  check('trash: the delta entry exists', deltaEntry.length > 0, entries())
  fs.mkdirSync(path.join(SESSIONS, '--proj--', D), { recursive: true })
  const collide = await call('/api/dsh-temp-session.trash-restore?key=' + encodeURIComponent(deltaEntry), { method: 'POST' })
  check('trash: restoring over an existing session is refused', collide.ok === false, collide)
  check('trash: the collided entry is kept', entries().includes(deltaEntry))

  // ---- empty ------------------------------------------------------------
  const emptied = await call('/api/dsh-temp-session.trash-empty', { method: 'POST' })
  check('trash: empty removes every entry',
    emptied.ok === true && emptied.removed >= 2 && entries().length === 0, emptied)
} finally {
  fs.rmSync(HOME, { recursive: true, force: true })
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
