// dsh-sidebar-suite — temporary session host half (0.2.0).
//
// What changed from 0.1.x, and why
// --------------------------------
// 0.1.x kept the conversation "in memory" and drew its own window. That could
// never satisfy two requirements at once: a temporary chat must show up in the
// left sidebar next to normal sessions (so the user can switch tasks), and it
// must use the host's own conversation window.
//
// So from 0.2.0 the Client half creates a REAL DSH session through the host's
// own navigation service (`uiWorkspace.createNamed` + `openSession`) — exactly
// what the native "New Session" button does — and this Host half only remembers
// which sessions are temporary and removes them afterwards.
//
// Removal facts verified in app.asar (DSH 0.2.2-rc.1):
//   - `@deepseek-ai/dsh-api-remotes` exposes session/create, session/rename,
//     workspace/archiveSession ... but NO session delete. There is no official
//     "delete a conversation" API: the UI's own action is archive (hide).
//   - `@deepseek-ai/dsh-session-query-sqlite` reconciles its index against the
//     files actually present (`persistentDeletes`), so removing a session
//     directory is safe: the search index drops the row on the next reconcile.
//   - There is no plugin-facing quit hook (`before-quit` / `will-quit` are not
//     reachable from a bundle), so deletion is attempted twice: synchronously
//     from a `process.on('exit')` handler, and again on the next launch before
//     the window lists sessions. The second pass is the guarantee.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, release as osRelease } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = dirname(HERE)

/**
 * The version an issue report should quote.
 *
 * Read from this package's own manifest rather than hard-coded, so a feedback
 * report can never claim a version the running code does not have. A missing or
 * unreadable manifest is not an error: the report just omits the field.
 */
let pluginVersionCache = ''
function pluginVersion() {
  if (pluginVersionCache) return pluginVersionCache
  try {
    const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
    if (pkg && typeof pkg.version === 'string') pluginVersionCache = pkg.version
  } catch (error) {
    void error
  }
  return pluginVersionCache
}

const DEFAULT_CONFIG = {
  showButton: true,
  inChatMode: 'hide', // hide | show
  buttonStyle: 'pair', // pair = beside New Session | own = its own full-width row
  // 0.2.4: the host's workspace list folds after five sessions and paints a
  // "展开其余 N 个会话" button. This plugin expands every group instead.
  expandAllSessions: true,
  // 0.4.0: right-clicking a temporary session row offers "keep as a normal
  // session" and "delete now". Off means the row behaves like a plain session
  // row again — the escape hatch if another plugin owns the context menu.
  rowMenu: true,
  deleteOnExit: true,
  // Daily cleanup (0.2.2). Independent of deleteOnExit: a user who keeps DSH
  // open for days wants "delete at 03:00 every night", and a user who closes it
  // every evening wants "delete on quit". Both can be on at the same time.
  scheduleDelete: false,
  scheduleTime: '03:00', // HH:MM, local time
  maxKept: 20,
  // 0.8.0: "temporary" still means "gone when DSH quits", but the bytes move
  // into a local trash folder first so a mis-click is undoable. On by default:
  // the whole point is that the user did not predict the mistake. Off restores
  // the pre-0.8.0 behaviour (delete straight off the disk).
  keepDeleted: true,
  keepDeletedDays: 7,
  found: false,
  error: '',
}

/** Trash caps. Retention is time-based; these are the storage safety net. */
const TRASH_MAX_ENTRIES = 20
const TRASH_MAX_BYTES = 200 * 1024 * 1024
/** The config POST route's raw JSON body cap. */
const MAX_CONFIG_BODY_BYTES = 16 * 1024

/** A session touched this recently is probably open — never delete it now. */
const ACTIVE_WINDOW_MS = 3 * 60 * 1000
/** After skipping an active session, look again this much later. */
const RETRY_DELAY_MS = 5 * 60 * 1000
/** The scheduler wakes up this often; a minute is plenty for a HH:MM target. */
const TICK_MS = 30 * 1000

/** Every tracked id is a session this plugin created and must delete later. */
const state = {
  config: { ...DEFAULT_CONFIG },
  tracked: [],
  routes: { registered: 0, errors: [], paths: [] },
  // 1.0.0 M1: why this host cannot host the temp-session routes. Reuses the
  // per-route `routes.errors` detail; this is the single summary exposed via
  // status() so a client can tell "degraded" from "no temp sessions yet".
  degraded: '',
  contexts: [],
  storePath: '',
  // 0.7.3: set when the tracking file exists but cannot be read/parsed. Kept in
  // the state literal so `status()`/`probe()` can surface it and so saveStore
  // knows to preserve the bytes as `.corrupt` instead of overwriting them.
  storeReadError: '',
  // 0.7.3: did the last loadStore() actually read the file? Windows reports
  // ENOENT (not ENOTDIR) when a path component is a file, so `storeReadError`
  // alone cannot tell "nothing stored yet" from "the store is unreachable".
  // Rollback needs that distinction: only a successful read makes the file
  // authoritative.
  storeLoadOk: false,
  lastPurge: null,
  lastError: '',
  bootPurged: false,
  hooks: false,
  // 0.8.1: how many times the trash was walked for retention, and what the last
  // walk decided. Exposed through status() so a regression test can prove that
  // one batch delete prunes once instead of once per session.
  trashPrunes: 0,
  trashKept: 0,
  trashBytes: 0,
  scheduler: { timer: null, nextRunAt: null, lastRunAt: null, retryAt: null, busy: false },
  // 0.2.8 hot reload. The config file is user-editable in Notepad; a mtime+size
  // stamp lets us notice a save without hashing the file, and the monotone
  // revision is what the client polls so it can re-apply settings in place.
  configStamp: '',
  configRevision: 0,
  configReloads: 0,
  configReloadSource: 'boot',
  // 0.6.1: the runtime config moved out of the package directory, so a package
  // upgrade can no longer overwrite a user's switches. True when this process
  // had to seed the data-directory copy for the first time.
  configMigrated: false,
  // 0.6.1 (community PR #105 review): the daily timer is owned by ctx.effect
  // where the host supports it, instead of living as a bare setInterval.
  schedulerEffectBound: false,
  // 0.7.4 (unreleased): which ctx currently owns the scheduler effect. A hot
  // reload creates a NEW ctx; the old effect's cleanup must not kill the timer
  // owned by the new one.
  schedulerCtx: null,
}

/**
 * Optional seams for regression tests. Without injection they match the real
 * host runtime: the wall clock, the global interval timers, and the process
 * `exit` hook. A test may pass `now`, `timers` and `hooks` through the second
 * `createTempSessionHost` argument; omitting them leaves behaviour unchanged.
 */
const inject = {
  now: () => Date.now(),
  timers: { setInterval, clearInterval },
  // Test-only exit-hook registrar; null keeps the real process 'exit' wiring.
  exitHook: null,
}

// ---------------------------------------------------------------------------
// locations
// ---------------------------------------------------------------------------

/** DSH home: `$DSH_HOME` or `~/.dsh` (@deepseek-ai/dsh-home-paths rule). */
function dshHome() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  if (configured.length > 0) return configured
  try {
    return join(homedir(), '.dsh')
  } catch (error) {
    // 1.0.0 M1: an unknown host/OS may fail the home lookup. A path that is
    // still writable under cwd keeps config/store reads working; the reason is
    // reported through status().degraded instead of throwing out of register().
    void error
    state.degraded = 'home path unavailable; using cwd/.dsh'
    return join(process.cwd(), '.dsh')
  }
}

/** Where session directories live: `<home>/sessions/<encoded-cwd>/<sessionId>/`. */
function sessionsRoot() {
  return join(dshHome(), 'sessions')
}

/** Our own tracking file, inside DSH home so it travels with the profile. */
function storePath() {
  return join(dshHome(), 'dsh-sidebar-suite', 'temp-sessions.json')
}

function projectionCacheFile(sessionId) {
  return join(dshHome(), 'storages', 'session_projcache', 'sessions', `session-${sessionId}.json`)
}

// ---------------------------------------------------------------------------
// path guards for deletion
// ---------------------------------------------------------------------------
//
// Everything that removes something from disk goes through `safeSessionDir`.
// Two things are being defended against, and neither is hypothetical:
//
//  1. `.` / `..` as an id. `normalizeId` used to accept them (the character
//     class allows dots), and `join(root, workspace, '..')` collapses to the
//     workspace itself — so one poisoned id deleted every session in that
//     workspace, and `..` at purge time walked up one level per workspace.
//  2. A path that leaves `<sessions>/<workspace>/<id>`. Ids normally come from
//     this plugin's own store, but the store is a plain JSON file a user or a
//     broken older build can write, and `?sessionId=` is reachable from the
//     page. A delete path must not trust its own inputs.

/** The character class an id is allowed to use (unchanged since 0.2.x). */
// 0.7.3: no `:`. On NTFS `session-a:b` is "file session-a, stream b", so an id
// carrying a colon would let resolve()/rm() act on a stream rather than the
// directory. Real ids never contain one, so dropping it costs nothing.
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/

/**
 * `.`, `..`, `...` — and anything else with `..` in it — are never ids.
 *
 * A real DSH session id is `session-<uuid>`; no legitimate id needs a dot run,
 * so rejecting them outright costs nothing and closes the whole traversal class
 * before any path is built.
 */
function isUnsafeId(value) {
  if (typeof value !== 'string' || value.length === 0) return true
  if (/^\.+$/.test(value)) return true
  return value.includes('..')
}

/** True when `child` sits strictly inside `parent` (both already resolved). */
function isInsideRoot(parent, child) {
  const rel = relative(parent, child)
  if (rel.length === 0) return false
  if (rel.startsWith('..')) return false
  if (isAbsolute(rel)) return false
  return rel.split(sep).filter(Boolean).length === 2
}

/**
 * `<root>/<workspace>/<id>` → the path we are willing to delete, or `''`.
 *
 * The returned path is the plain resolved one (not the real path) so callers
 * delete the directory the user actually sees; the real path is only used to
 * prove the target has not been redirected somewhere else by a symlink.
 * Requiring exactly two path segments also rejects a workspace name that
 * smuggles in a separator or a `..` of its own.
 */
function safeSessionDir(root, workspace, id) {
  if (isUnsafeId(id) || !SESSION_ID_PATTERN.test(id)) return ''
  if (typeof workspace !== 'string' || workspace.length === 0) return ''
  if (workspace.includes('/') || workspace.includes('\\') || workspace.includes('..')) return ''
  if (workspace === '.' || workspace === '..') return ''

  const target = resolve(root, workspace, id)
  if (!isInsideRoot(resolve(root), target)) return ''

  let rootReal = ''
  let targetReal = ''
  try {
    rootReal = realpathSync(root)
    targetReal = realpathSync(target)
  } catch (error) {
    // 0.7.0 (P3): a failed guard used to be silent, so a purge blocked by ACLs,
    // antivirus or a OneDrive placeholder reported removed:0 with no reason.
    // ENOENT just means this workspace has no such session (a normal miss);
    // anything else is a real diagnostic the user and feedback report need.
    const code = error && error.code
    if (code && code !== 'ENOENT') {
      state.lastError = `session path guard: ${code} on ${id} in ${workspace}`
    }
    return ''
  }
  if (!isInsideRoot(rootReal, targetReal)) return ''

  // `rm -r` follows the directory it is given, so a symlink standing where a
  // session directory should be would delete its target instead. Refuse it.
  try {
    if (!lstatSync(target).isDirectory()) return ''
  } catch (error) {
    const code = error && error.code
    if (code && code !== 'ENOENT') {
      state.lastError = `session path guard: ${code} on ${id} in ${workspace}`
    }
    return ''
  }
  return target
}

// ---------------------------------------------------------------------------
// config file (Notepad-editable, no source edits)
// ---------------------------------------------------------------------------
//
// 0.6.1 (community PR #105 review): the writable config no longer lives in the
// package directory. `pnpm add dsh-sidebar-suite@<new>` replaces that directory
// wholesale, so every value the user typed into the packaged text file was
// silently reset on upgrade. The live copy now sits next to our tracking store
// in DSH home. The packaged file stays in the npm tarball as a factory template:
// on first boot with a new version its contents are copied over, which also
// carries over any hand edits that survived the upgrade. From then on the
// package is read-only as far as this plugin is concerned.

/** Where the settings the user edits actually live. */
function configPath() {
  return join(dshHome(), 'dsh-sidebar-suite', 'temp-session-config.txt')
}

/** The factory template shipped inside the npm package (never written to). */
function legacyConfigPath() {
  return join(PLUGIN_ROOT, 'temp-session-config.txt')
}

/** Fallback text when neither the data copy nor the shipped template exists. */
function defaultConfigText() {
  const lines = [
    '# 临时会话设置 · 此文件位于 DSH 数据目录，升级插件不会覆盖。',
    '# Temporary session settings. Stored in DSH home so upgrades never overwrite it.',
    '# 记事本改等号右边，保存后约 3 秒自动生效，不用重启 DSH。',
    '# Edit values after =; saves apply in ~3s, no restart.',
    '',
  ]
  for (const field of Object.keys(CONFIG_KEYS)) {
    lines.push(`${CONFIG_KEYS[field].key}=${CONFIG_KEYS[field].text(DEFAULT_CONFIG[field])}`)
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * Make sure the data-directory config exists, seeding it from the packaged
 * template exactly once. Cheap enough to call on every read (one stat), and it
 * keeps `DSH_HOME` overrides / tests honest without a module-level cache.
 *
 * Returns the path to read or write. A failed seed is not fatal: parseConfig()
 * falls back to DEFAULT_CONFIG and the UI keeps working, it just reports the
 * reason in `lastError`.
 */
function ensureConfigFile() {
  const target = configPath()
  try {
    if (existsSync(target)) return target
    let seed = ''
    try {
      seed = readFileSync(legacyConfigPath(), 'utf8')
    } catch (error) {
      void error
    }
    if (seed.trim().length === 0) seed = defaultConfigText()
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, seed, 'utf8')
    state.configMigrated = true
  } catch (error) {
    state.lastError = `config migration failed: ${error && error.message}`
  }
  return target
}

/** `3:5` / `03:05` / `25:99` → `03:05` / `03:05` / `''` (invalid). */
function normalizeClock(value) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(text)
  if (!match) return ''
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return ''
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return ''
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** One entry per editable field: its key in the text file and how to write it. */
const CONFIG_KEYS = {
  showButton: { key: 'SHOW_TEMP_BUTTON', text: (value) => (value ? 'on' : 'off') },
  inChatMode: { key: 'TEMP_IN_CHAT_MODE', text: (value) => String(value) },
  buttonStyle: { key: 'TEMP_BUTTON_STYLE', text: (value) => String(value) },
  expandAllSessions: { key: 'EXPAND_ALL_SESSIONS', text: (value) => (value ? 'on' : 'off') },
  rowMenu: { key: 'TEMP_ROW_MENU', text: (value) => (value ? 'on' : 'off') },
  deleteOnExit: { key: 'DELETE_ON_EXIT', text: (value) => (value ? 'on' : 'off') },
  scheduleDelete: { key: 'SCHEDULE_DELETE', text: (value) => (value ? 'on' : 'off') },
  scheduleTime: { key: 'SCHEDULE_TIME', text: (value) => String(value) },
  maxKept: { key: 'MAX_KEPT', text: (value) => String(value) },
  keepDeleted: { key: 'KEEP_DELETED', text: (value) => (value ? 'on' : 'off') },
  keepDeletedDays: { key: 'KEEP_DELETED_DAYS', text: (value) => String(value) },
}

const FIELD_BY_KEY = Object.create(null)
for (const field of Object.keys(CONFIG_KEYS)) FIELD_BY_KEY[CONFIG_KEYS[field].key] = field

function parseConfig() {
  const next = { ...DEFAULT_CONFIG }
  let raw = ''
  try {
    raw = readFileSync(ensureConfigFile(), 'utf8')
    next.found = true
  } catch (error) {
    next.error = `config not readable: ${error && error.message}`
    return next
  }
  const kv = Object.create(null)
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim()
    if (text.length === 0 || text.startsWith('#') || text.startsWith(';')) continue
    const eq = text.indexOf('=')
    if (eq <= 0) continue
    kv[text.slice(0, eq).trim().toUpperCase()] = text.slice(eq + 1).trim()
  }
  if (kv.SHOW_TEMP_BUTTON !== undefined) next.showButton = kv.SHOW_TEMP_BUTTON.toLowerCase() !== 'off'
  if (kv.TEMP_IN_CHAT_MODE !== undefined) {
    next.inChatMode = kv.TEMP_IN_CHAT_MODE.toLowerCase() === 'show' ? 'show' : 'hide'
  }
  if (kv.TEMP_BUTTON_STYLE !== undefined) {
    next.buttonStyle = kv.TEMP_BUTTON_STYLE.toLowerCase() === 'own' ? 'own' : 'pair'
  }
  if (kv.EXPAND_ALL_SESSIONS !== undefined) {
    next.expandAllSessions = kv.EXPAND_ALL_SESSIONS.toLowerCase() !== 'off'
  }
  if (kv.TEMP_ROW_MENU !== undefined) next.rowMenu = kv.TEMP_ROW_MENU.toLowerCase() !== 'off'
  if (kv.DELETE_ON_EXIT !== undefined) next.deleteOnExit = kv.DELETE_ON_EXIT.toLowerCase() !== 'off'
  if (kv.SCHEDULE_DELETE !== undefined) next.scheduleDelete = kv.SCHEDULE_DELETE.toLowerCase() !== 'off'
  if (kv.SCHEDULE_TIME !== undefined) {
    const clock = normalizeClock(kv.SCHEDULE_TIME)
    if (clock) next.scheduleTime = clock
  }
  if (kv.MAX_KEPT !== undefined) {
    const parsed = Number.parseInt(kv.MAX_KEPT, 10)
    if (Number.isFinite(parsed) && parsed > 0) next.maxKept = Math.min(parsed, 200)
  }
  if (kv.KEEP_DELETED !== undefined) next.keepDeleted = kv.KEEP_DELETED.toLowerCase() !== 'off'
  if (kv.KEEP_DELETED_DAYS !== undefined) {
    const parsed = Number.parseInt(kv.KEEP_DELETED_DAYS, 10)
    if (Number.isFinite(parsed) && parsed > 0) next.keepDeletedDays = Math.min(parsed, 365)
  }
  return next
}

/** Cheap fingerprint of the on-disk config file. */
function configStamp() {
  try {
    const st = statSync(ensureConfigFile())
    return `${st.mtimeMs}:${st.size}`
  } catch (error) {
    void error
    return 'missing'
  }
}

/**
 * 0.2.8 hot reload — pick up a hand edit without restarting DSH.
 *
 * There is deliberately no fs.watch here: editors save by renaming a temp file,
 * watches get lost on some network/OneDrive folders, and a watcher can keep the
 * host process alive. Every status/config/probe request checks the stamp
 * instead, and the client polls every few seconds, so behaviour is live within
 * one poll even on filesystems with coarse mtime resolution.
 */
function refreshConfigIfChanged() {
  const stamp = configStamp()
  if (stamp === state.configStamp) return false
  state.configStamp = stamp
  const next = parseConfig()
  const fields = [
    'showButton', 'inChatMode', 'buttonStyle', 'expandAllSessions', 'rowMenu',
    'deleteOnExit', 'scheduleDelete', 'scheduleTime', 'maxKept',
    'keepDeleted', 'keepDeletedDays',
  ]
  const changed = fields.some((field) => next[field] !== state.config[field])
  const scheduleMoved = next.scheduleDelete !== state.config.scheduleDelete
    || next.scheduleTime !== state.config.scheduleTime
  state.config = next
  if (changed) {
    state.configRevision += 1
    state.configReloads += 1
    state.configReloadSource = 'file'
    // The daily target may have moved (or been switched off entirely). Any
    // other edit keeps the pending retry for a session that was in use.
    restartScheduler(!scheduleMoved)
  }
  return changed
}

/**
 * Persist the settings the detail page changed.
 *
 * Line-based on purpose: comments, blank lines and key order survive, so the
 * file stays readable in Notepad and nothing the user wrote by hand is lost.
 * Only values after `=` are replaced; keys that are missing get appended.
 */
function saveConfig(patch) {
  // A hand edit made after boot must not be silently overwritten by a UI save.
  refreshConfigIfChanged()
  const next = { ...state.config }
  const input = patch && typeof patch === 'object' ? patch : {}
  if (typeof input.showButton === 'boolean') next.showButton = input.showButton
  if (input.inChatMode === 'show' || input.inChatMode === 'hide') next.inChatMode = input.inChatMode
  if (input.buttonStyle === 'own' || input.buttonStyle === 'pair') next.buttonStyle = input.buttonStyle
  if (typeof input.expandAllSessions === 'boolean') next.expandAllSessions = input.expandAllSessions
  if (typeof input.rowMenu === 'boolean') next.rowMenu = input.rowMenu
  if (typeof input.deleteOnExit === 'boolean') next.deleteOnExit = input.deleteOnExit
  if (typeof input.scheduleDelete === 'boolean') next.scheduleDelete = input.scheduleDelete
  const clock = normalizeClock(input.scheduleTime)
  if (clock) next.scheduleTime = clock
  const kept = Number.parseInt(input.maxKept, 10)
  if (Number.isFinite(kept) && kept > 0) next.maxKept = Math.min(kept, 200)
  if (typeof input.keepDeleted === 'boolean') next.keepDeleted = input.keepDeleted
  const keepDays = Number.parseInt(input.keepDeletedDays, 10)
  if (Number.isFinite(keepDays) && keepDays > 0) next.keepDeletedDays = Math.min(keepDays, 365)

  let raw = ''
  let existing = false
  try {
    raw = readFileSync(ensureConfigFile(), 'utf8')
    existing = true
  } catch (error) {
    void error
  }
  if (!existing) {
    raw = [
      '# 临时会话设置（0.2.8）· 记事本改等号右边，保存后约 3 秒自动生效，不用重启 DSH。',
      '# Temporary session settings (0.2.8). Edit values after =; saves apply in ~3s, no restart.',
      '',
    ].join('\n')
  }
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const written = Object.create(null)

  const lines = raw.split(/\r?\n/).map((line) => {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith(';')) return line
    const eq = line.indexOf('=')
    if (eq <= 0) return line
    const name = line.slice(0, eq).trim().toUpperCase()
    const field = FIELD_BY_KEY[name]
    if (!field) return line
    written[name] = true
    return `${line.slice(0, eq)}=${CONFIG_KEYS[field].text(next[field])}`
  })

  const missing = Object.keys(CONFIG_KEYS).filter((field) => !written[CONFIG_KEYS[field].key])
  if (missing.length > 0) {
    lines.push('')
    for (const field of missing) lines.push(`${CONFIG_KEYS[field].key}=${CONFIG_KEYS[field].text(next[field])}`)
  }

  try {
    writeFileSync(ensureConfigFile(), lines.join(eol), 'utf8')
  } catch (error) {
    return { ok: false, error: `config write failed: ${error && error.message}` }
  }

  // 0.7.3: only a real schedule change may drop the 5-minute retry of a session
  // that was in use during the last run. Toggling an unrelated setting used to
  // wipe it, pushing that cleanup to tomorrow.
  const scheduleMoved = next.scheduleDelete !== state.config.scheduleDelete
    || next.scheduleTime !== state.config.scheduleTime
  next.found = true
  next.error = ''
  state.config = next
  // We just changed the file's mtime ourselves. Record the new stamp so the
  // next poll does not report our own write as an external edit.
  state.configStamp = configStamp()
  state.configRevision += 1
  state.configReloads += 1
  state.configReloadSource = 'ui'
  restartScheduler(!scheduleMoved)
  return { ok: true, config: publicConfig() }
}

/** The subset the detail page reads back. */
function publicConfig() {
  return {
    showButton: state.config.showButton,
    inChatMode: state.config.inChatMode,
    buttonStyle: state.config.buttonStyle,
    expandAllSessions: state.config.expandAllSessions,
    rowMenu: state.config.rowMenu,
    deleteOnExit: state.config.deleteOnExit,
    scheduleDelete: state.config.scheduleDelete,
    scheduleTime: state.config.scheduleTime,
    maxKept: state.config.maxKept,
    keepDeleted: state.config.keepDeleted,
    keepDeletedDays: state.config.keepDeletedDays,
    configFile: configPath(),
    configMigrated: state.configMigrated,
    configTemplate: legacyConfigPath(),
    found: state.config.found,
    configRevision: state.configRevision,
    configReloads: state.configReloads,
    configReloadSource: state.configReloadSource,
  }
}

// ---------------------------------------------------------------------------
// tracking store
// ---------------------------------------------------------------------------

function normalizeId(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 128) return ''
  if (isUnsafeId(trimmed)) return ''
  return SESSION_ID_PATTERN.test(trimmed) ? trimmed : ''
}

async function loadStore() {
  state.storePath = storePath()
  state.storeLoadOk = false
  try {
    const raw = await readFile(state.storePath, 'utf8')
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.sessions) ? parsed.sessions : []
    // 0.7.3 (#1): de-duplicate ids. A repeated id made purgeAll delete/archive
    // the same session twice (a false `failed` entry) and inflated maxKept,
    // trimming a newer, still-wanted session too early.
    state.tracked = Array.from(new Set(list.map(normalizeId).filter(Boolean)))
    state.storeReadError = ''
    state.storeLoadOk = true
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      // 0.7.3 (#1): a read/parse failure is NOT the same as "no file yet".
      // Clearing `tracked` here silently permanentised every temp session: a
      // torn write (crash mid-write) or a transient lock looked like an empty
      // store, the exit hook early-returned, and the next successful save
      // overwrote the only record of those ids. Keep the last known-good list
      // in memory and surface the error instead of pretending it is empty.
      state.lastError = `store read failed: ${error.message}`
      state.storeReadError = state.lastError
      return
    }
    // ENOENT = genuine first run, an empty tracking list is correct.
    state.tracked = []
    state.storeReadError = ''
  }
}

/**
 * 0.7.3 (#4): restore in-memory tracking after a failed write.
 *
 * Preferred path is re-reading the file (atomic writes mean it still holds the
 * pre-write state), which also preserves any id a concurrent track() added.
 * If the file cannot be read at all (e.g. the data dir was replaced by a file),
 * fall back to the caller's `before` snapshot so rollback still works.
 */
async function rollbackStore(before) {
  state.storeReadError = ''
  await loadStore()
  // The file is authoritative only when we actually read it. An earlier version
  // unioned the pre-call snapshot on top of the file, which resurrected ids a
  // *concurrent* untrack() had legitimately removed: the user clicks "keep this
  // session", another caller's failed write rolls back, the kept id comes back,
  // and the next quit deletes exactly the session the user saved. The mirror
  // case matters too: when the read itself failed (Windows reports ENOENT for a
  // path blocked by a file, not ENOTDIR), the file tells us nothing and the
  // snapshot is the only state left.
  if (!state.storeLoadOk) state.tracked = before.slice()
}

/**
 * Persist the tracking library. Returns true only when the bytes are on disk
 * (0.7.2, defect #2): callers must not report success — especially for
 * `untrack`, where a silent failure turns "keep this session" into a deletion
 * on the next launch when the old id is loaded back from this very file.
 */
// 0.7.3: per-write counter so concurrent saves never share a temp filename.
// A fixed `<store>.tmp` made the second rename() fail with ENOENT, which then
// looked like a write failure and rolled back a successful change.
let storeWriteSeq = 0

async function saveStore() {
  const path = state.storePath || storePath()
  state.storePath = path
  storeWriteSeq += 1
  const tmp = `${path}.${process.pid}.${storeWriteSeq}.tmp`
  try {
    await mkdir(dirname(path), { recursive: true })
    // Never silently overwrite a file we failed to parse: the ids in it are the
    // only record of those sessions. Move it aside first so it can be recovered.
    // `existsSync` matters because Windows reports ENOENT for a store blocked by
    // a file in its path — the file is still there and still worth keeping.
    if (!state.storeLoadOk && existsSync(path)) {
      try {
        await rename(path, `${path}.corrupt`)
      } catch (error) {
        void error
      }
    }
    const body = JSON.stringify({ version: 1, sessions: state.tracked }, null, 2)
    await writeFile(tmp, body, 'utf8')
    let fallbackWarning = ''
    try {
      await rename(tmp, path)
    } catch (renameError) {
      // Windows / OneDrive: the target can be briefly held by a scanner or an
      // on-demand placeholder, and an atomic replace is then refused. Fall back
      // to a direct write so a user's "keep this session" is not refused
      // forever just because the atomic path was unavailable.
      await writeFile(path, body, 'utf8')
      fallbackWarning = `atomic replace fell back to a direct write: ${renameError && renameError.message}`
    }
    state.lastError = fallbackWarning
    // What we just wrote is readable by definition, so the next save must not
    // treat the store as unreachable and move it aside again.
    state.storeReadError = ''
    state.storeLoadOk = true
    return true
  } catch (error) {
    state.lastError = `store write failed: ${error && error.message}`
    return false
  } finally {
    // A refused write must not leave the session ids sitting in a stray .tmp.
    try {
      await rm(tmp, { force: true })
    } catch (error) {
      void error
    }
  }
}

// ---------------------------------------------------------------------------
// deletion
// ---------------------------------------------------------------------------

/** Every `<sessions>/<workspace>/<id>` directory that exists right now. */
function sessionDirsSync(sessionId) {
  const root = sessionsRoot()
  const found = []
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch (error) {
    void error
    return found
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = safeSessionDir(root, entry.name, sessionId)
    if (candidate.length === 0) continue
    found.push(candidate)
  }
  return found
}

function sessionKey(id) {
  // 0.7.3: NTFS is case-insensitive, POSIX is not. One helper so the one-shot
  // scan, the per-id scan and the purge index all compare the same way.
  return process.platform === 'win32' ? String(id).toLowerCase() : String(id)
}

/**
 * 0.7.3: one directory listing for a whole purge instead of one per id.
 *
 * Every session lives at `<root>/<workspace>/<id>`, so a single pass yields the
 * set of ids still on disk. Purging 20 ids used to cost ~240 synchronous
 * readdir calls plus realpath resolution; on a network or OneDrive home that is
 * a visible stall in the sidebar.
 *
 * Returns `null` when the index cannot be trusted (a workspace directory was
 * unreadable). Callers then fall back to the per-id scan: slower, but it never
 * mistakes "cannot look" for "not there".
 */
function indexSessionIds() {
  const root = sessionsRoot()
  let workspaces = []
  try {
    workspaces = readdirSync(root, { withFileTypes: true })
  } catch (error) {
    return error && error.code === 'ENOENT' ? new Set() : null
  }
  const found = new Set()
  for (const ws of workspaces) {
    if (!ws.isDirectory() && !ws.isSymbolicLink()) continue
    try {
      for (const name of readdirSync(join(root, ws.name))) found.add(sessionKey(name))
    } catch (error) {
      void error
      return null
    }
  }
  return found
}

/**
 * 0.7.3 (#2): is a tracked id a zombie whose session is genuinely gone?
 *
 * `sessionDirsSync` returns [] both when the session really is gone and when a
 * path entry exists but was REFUSED by the guard (e.g. a symlink standing in
 * for a session dir) or readdir failed. Dropping the id in those cases would
 * break two deliberate behaviours: a refused deletion must stay tracked for a
 * later retry, and a locked/redirected session must not be silently forgotten.
 *
 * So we only call it "gone" when: the sessions root is readable/ENOENT (not a
 * permissions error), AND no workspace contains any entry named `sessionId`
 * (regardless of type — a symlink counts as "still something on disk").
 *
 * Pass a `Set` from `indexSessionIds()` to answer from memory; `null` means the
 * index was untrustworthy and the id must be kept.
 */
function sessionGoneFromDisk(sessionId, index) {
  if (isUnsafeId(sessionId) || !SESSION_ID_PATTERN.test(sessionId)) return false
  if (index !== undefined) {
    if (index === null) return false
    return !index.has(sessionKey(sessionId))
  }
  const root = sessionsRoot()
  let workspaces = []
  try {
    workspaces = readdirSync(root, { withFileTypes: true })
  } catch (error) {
    return !!(error && error.code === 'ENOENT') // root genuinely absent = all gone
  }
  for (const ws of workspaces) {
    // 0.7.3: a workspace directory that is itself a symlink/junction still holds
    // its sessions -- readdir follows it. Skipping it here made every session
    // under that workspace look like a zombie, so a user who relocated
    // `sessions/<ws>` to another drive silently lost tracking for it.
    if (!ws.isDirectory() && !ws.isSymbolicLink()) continue
    // If any entry under any workspace still bears this id, it is not a zombie.
    try {
      const names = readdirSync(join(root, ws.name))
      const wanted = sessionKey(sessionId)
      if (names.some((name) => sessionKey(name) === wanted)) return false
    } catch (error) {
      void error
      return false // cannot confirm — keep the id (fail-safe)
    }
  }
  return true
}

/**
 * 0.7.4: a workspace directory that is itself a symlink / junction is a
 * special case. `indexSessionIds()` follows it and sees the sessions inside,
 * but `safeSessionDir()` refuses to delete through a link that leaves the
 * sessions root. Both rules are correct on their own; together they used to
 * produce a permanent dead state — purge kept the id forever and the page's
 * "delete" silently did nothing.
 *
 * Detect that exact case so callers can keep the safety rule, stop retrying,
 * and hand the user the concrete path instead of a vague "will retry".
 */
function linkedWorkspaceDirs(sessionId) {
  if (isUnsafeId(sessionId) || !SESSION_ID_PATTERN.test(sessionId)) return []
  const root = sessionsRoot()
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch (error) {
    void error
    return []
  }
  const blocked = []
  for (const entry of entries) {
    const wsPath = join(root, entry.name)
    let isLink = false
    try {
      isLink = lstatSync(wsPath).isSymbolicLink()
    } catch (error) {
      void error
      continue
    }
    if (!isLink) continue
    let names = []
    try {
      names = readdirSync(wsPath)
    } catch (error) {
      void error
      continue
    }
    if (!names.some((name) => sessionKey(name) === sessionKey(sessionId))) continue
    // Only report the exact case the guard refuses because the workspace's
    // real path leaves the sessions root. An ACL/IO failure would also make
    // safeSessionDir() return '', but that one must stay on the retry path —
    // permanently untracking it would silently abandon a recoverable session.
    let escapesRoot = false
    try {
      const rootReal = realpathSync(root)
      const targetReal = realpathSync(resolve(wsPath, sessionId))
      escapesRoot = !isInsideRoot(rootReal, targetReal)
    } catch (error) {
      void error
      continue
    }
    if (!escapesRoot) continue
    blocked.push({ workspace: entry.name, path: resolve(wsPath, sessionId) })
  }
  return blocked
}

/**
 * True when the session wrote anything within `ms`.
 *
 * There is no reliable "is this conversation open" signal reachable from a
 * bundle, so the newest file mtime stands in for it: an open conversation keeps
 * touching its transcript, an idle one goes quiet. Deleting an open session
 * would make the host's window point at a directory that no longer exists, so
 * the scheduled pass skips those and tries again a few minutes later.
 */
function sessionActiveWithin(sessionId, ms) {
  const cutoff = Date.now() - ms
  for (const dir of sessionDirsSync(sessionId)) {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      void error
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue
      try {
        if (statSync(join(dir, entry.name)).mtimeMs >= cutoff) return true
      } catch (error) {
        void error
      }
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// trash (0.8.0) — "temporary" still means deleted, but undoable for N days
// ---------------------------------------------------------------------------
//
// Why this exists: the one irreversible thing this plugin does is delete a
// conversation. A user who mis-clicks loses the transcript and — crucially —
// does not file an issue about it, they uninstall. So deletion moves the
// directory into a local trash folder instead of unlinking it.
//
// Guarantees that must hold:
//  1. The bytes never leave the machine, and never leave the DSH home tree.
//  2. A trash failure must NOT silently become a permanent delete: the caller
//     reports a failure and retries, exactly like a locked file.
//  3. Restoring puts the session back at `<sessions>/<workspace>/<id>`; the
//     path guard is re-applied to the metadata, which is a plain JSON file a
//     user (or an older build) can write.
//  4. Retention is bounded in both time and size, so this cannot grow forever.

/** `<dshHome>/dsh-sidebar-suite/trash/` — inside the profile, same volume. */
function trashRoot() {
  return join(dshHome(), 'dsh-sidebar-suite', 'trash')
}

/**
 * `<epochMillis>-<sessionId>`. The timestamp leads so a directory listing is
 * already sorted oldest-first without reading metadata.
 */
const TRASH_KEY_PATTERN = /^[0-9]{10,16}-[A-Za-z0-9._-]+$/

/** Resolve one entry directory, refusing anything that is not a direct child. */
function trashEntryDir(key) {
  if (typeof key !== 'string' || !TRASH_KEY_PATTERN.test(key)) return ''
  const root = resolve(trashRoot())
  const target = resolve(root, key)
  const rel = relative(root, target)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return ''
  if (rel.split(sep).filter(Boolean).length !== 1) return ''
  return target
}

function trashEntryMeta(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
  } catch (error) {
    void error
    return null
  }
}

function dirSizeSync(dir) {
  let total = 0
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    void error
    return 0
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    try {
      if (entry.isDirectory()) total += dirSizeSync(full)
      else if (entry.isFile()) total += statSync(full).size
    } catch (error) {
      void error
    }
  }
  return total
}

/**
 * A short, one-line label for a session, read from the host's projection cache.
 *
 * The trash list used to show a bare UUID, which is useless exactly when the
 * user has to pick which entry to bring back. The cache holds the session's own
 * label and is deleted as part of the same delete, so this is the last moment it
 * can be read. Purely cosmetic: every shape is checked, the file is size-capped,
 * and anything unexpected simply means "no title".
 */
const TRASH_TITLE_MAX = 80
function normalizeSessionTitle(value) {
  if (typeof value !== 'string') return ''
  let text = value.replace(/\s+/g, ' ').trim()
  // Every session's first message starts with the same "Today is <date>." line,
  // which identifies nothing — drop it so the titles stay distinguishable.
  text = text.replace(/^today is \d{4}-\d{2}-\d{2}\.?\s*/i, '')
  // ...and some start with a bare tag such as <system-reminder>.
  text = text.replace(/^<[^<>]{0,40}>\s*/, '').trim()
  if (text.length === 0) return ''
  return text.length > TRASH_TITLE_MAX ? `${text.slice(0, TRASH_TITLE_MAX)}…` : text
}

function sessionTitleSync(sessionId) {
  const file = projectionCacheFile(sessionId)
  try {
    if (statSync(file).size > 4 * 1024 * 1024) return ''
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const rows = raw && raw.record && raw.record.rows
    const row = rows && typeof rows === 'object' ? rows.title : null
    return normalizeSessionTitle(row && row.val)
  } catch (error) {
    void error
    return ''
  }
}

/**
 * The entry a park for this (session, workspace) already created, if any.
 *
 * Reusing it is what keeps a retry from making a second entry: the first attempt
 * can leave a complete copy behind while the original directory is only partly
 * removed (a copy succeeded, the delete of the original did not). Parking again
 * used to mint a new timestamped key, so the same session appeared twice and the
 * newer one held nothing.
 */
function findParkedEntry(entries, sessionId, workspace) {
  for (const entry of entries) {
    if (entry.id === sessionId && entry.workspace === workspace) return entry
  }
  return null
}

/** The meta payload, in one place so the sync and async parkers cannot drift. */
function trashMetaFor(fields) {
  return JSON.stringify({
    id: fields.id,
    workspace: fields.workspace,
    deletedAt: fields.deletedAt,
    reason: fields.reason,
    title: fields.title || '',
    bytes: fields.bytes,
  }, null, 2)
}

/** Every trash entry, newest first. Unreadable metadata falls back to mtime. */
function trashEntriesSync() {
  const root = trashRoot()
  let names = []
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (error) {
    void error
    return []
  }
  const entries = []
  for (const name of names) {
    const dir = trashEntryDir(name)
    if (dir.length === 0) continue
    const meta = trashEntryMeta(dir)
    let deletedAt = meta && typeof meta.deletedAt === 'string' ? Date.parse(meta.deletedAt) : NaN
    if (!Number.isFinite(deletedAt)) {
      try {
        deletedAt = statSync(dir).mtimeMs
      } catch (error) {
        void error
        continue
      }
    }
    // 0.8.1: the size is recorded when the entry is parked, so listing the
    // trash costs a few small meta reads instead of a recursive walk over
    // every file of every deleted session (8000 files took 0.5s per listing).
    // Entries parked by 0.8.0, and hand-made ones, have no `bytes` and still
    // fall back to a walk.
    const bytes = (function () {
      const cached = meta && Number(meta.bytes)
      if (Number.isFinite(cached) && cached >= 0) return cached
      return dirSizeSync(dir)
    })()
    entries.push({
      key: name,
      id: meta && typeof meta.id === 'string' ? meta.id : '',
      workspace: meta && typeof meta.workspace === 'string' ? meta.workspace : '',
      title: meta && typeof meta.title === 'string' ? meta.title : '',
      deletedAt: new Date(deletedAt).toISOString(),
      bytes,
      // Larger than the whole budget: it is kept anyway (the newest entry is
      // exempt from the byte cap, because a huge session is exactly the one the
      // trash exists for), so the UI has to say why it is still there.
      oversize: bytes > TRASH_MAX_BYTES,
      dir,
    })
  }
  entries.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt))
  return entries
}

function removeTrashEntrySync(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 2 })
    return true
  } catch (error) {
    state.lastError = `trash cleanup failed: ${error && error.message}`
    return false
  }
}

/**
 * Apply retention: older than `keepDeletedDays` goes, then the newest entries
 * are kept up to the entry/size caps. Newest-first order means "drop the tail".
 *
 * 0.8.1: the newest entry is exempt from the byte cap. It used to be trimmed
 * like any other, which meant a session larger than 200MB was parked and then
 * deleted in the same call — a silent permanent delete dressed up as a
 * successful one, and precisely the case the trash exists for. A single huge
 * entry is now kept (and is the only one kept); older ones still go first.
 */
function pruneTrashSync(daysOverride) {
  state.trashPrunes += 1
  const entries = trashEntriesSync()
  // 0.8.1 (fourth pass): the quit path cannot await a config reload, so it
  // passes the days it just read from disk. Everything else uses the cached
  // value, which status/config/trash routes keep fresh.
  const source = daysOverride === undefined || daysOverride === null
    ? state.config.keepDeletedDays
    : daysOverride
  const configured = Number.parseInt(source, 10)
  const days = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CONFIG.keepDeletedDays
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const fresh = []
  for (const entry of entries) {
    const at = Date.parse(entry.deletedAt)
    if (Number.isFinite(at) && at < cutoff) {
      // A locked entry is still on disk. Keep it in the retention pass so the
      // counters describe what the user can actually recover, not a world
      // where the failed delete succeeded.
      if (!removeTrashEntrySync(entry.dir)) fresh.push(entry)
      continue
    }
    fresh.push(entry)
  }
  let kept = 0
  let bytes = 0
  // 0.8.1 (fourth pass): once one entry does not fit, every OLDER entry goes
  // too. Without the latch the loop kept skipping a large entry and then
  // admitted the small ones behind it, so deleting a 300 MB session removed
  // it while two older 1 MB sessions survived — the exact opposite of
  // "oldest go first", and a silent loss of the item the user just deleted.
  let trimmed = false
  for (const entry of fresh) {
    if (trimmed || kept >= TRASH_MAX_ENTRIES || (kept > 0 && bytes + entry.bytes > TRASH_MAX_BYTES)) {
      trimmed = true
      // Same accounting rule as the expiry pass: a failed removal leaves the
      // entry recoverable, so it still counts towards the reported totals.
      if (!removeTrashEntrySync(entry.dir)) {
        kept += 1
        bytes += entry.bytes
      }
      continue
    }
    kept += 1
    bytes += entry.bytes
  }
  state.trashKept = kept
  state.trashBytes = bytes
  return { kept, bytes }
}

/**
 * Move one session's directories into the trash and return how many moved.
 *
 * `sessionDirsSync` is the same guard the delete path uses, so a session that
 * lives behind a linked workspace is never moved (that would relocate the
 * user's real workspace into the trash folder).
 *
 * `options.prune === false` skips the retention pass. A batch delete (quit,
 * scheduled, manual purge) passes it and prunes once at the end: pruning after
 * every park turned N deletes into N walks of the whole trash, which took
 * seconds on the synchronous quit path.
 */
function trashSessionSync(sessionId, reason, options) {
  const settings = options && typeof options === 'object' ? options : {}
  const dirs = sessionDirsSync(sessionId)
  if (dirs.length === 0) return { moved: 0, keys: [] }
  const keys = []
  const title = sessionTitleSync(sessionId)
  let parked = null
  let index = 0
  for (const dir of dirs) {
    const workspace = basename(dirname(dir))
    const stamp = Date.now() + index
    index += 1
    // Listed lazily: a plain delete that cannot have a prior entry should not
    // pay for a trash listing at all.
    if (parked === null) parked = trashEntriesSync()
    const prior = findParkedEntry(parked, sessionId, workspace)
    const key = prior ? prior.key : `${stamp}-${sessionId}`
    const entry = prior ? prior.dir : trashEntryDir(key)
    if (entry.length === 0) continue
    // 0.8.1: a reused entry keeps its old key (the key is just an id, nothing
    // parses it) but gets a fresh `deletedAt`. Inheriting the old one would let
    // a deletion the user just asked for expire hours later: if the same session
    // reappears on disk and is deleted again, the entry it lands in could already
    // be six days old. Retention is measured from the last time it was parked.
    const deletedAt = new Date(stamp).toISOString()
    const priorTitle = prior && typeof prior.title === 'string' ? prior.title : ''
    let keepCopy = false
    try {
      mkdirSync(entry, { recursive: true })
      const payload = join(entry, 'data')
      const merged = existsSync(payload)
      const meta = {
        id: sessionId, workspace, deletedAt, reason,
        title: priorTitle || title,
        bytes: 0,
      }
      if (merged) {
        // A previous attempt already copied part of this session and could not
        // finish removing the original. Merge the remainder in (a rename would
        // fail onto an existing directory) and keep the copy no matter what.
        cpSync(dir, payload, { recursive: true, force: true })
        rmSync(dir, { recursive: true, force: true, maxRetries: 2 })
        // Count the merged tree, not the source: the point of the merge is that
        // the numbers on screen reflect what is actually in the entry.
        meta.bytes = dirSizeSync(payload)
        writeFileSync(join(entry, 'meta.json'), trashMetaFor(meta), 'utf8')
      } else {
        meta.bytes = dirSizeSync(dir)
        // Metadata first: an entry with data but no metadata cannot be restored,
        // and prune would have to guess its age from mtime.
        writeFileSync(join(entry, 'meta.json'), trashMetaFor(meta), 'utf8')
        try {
          renameSync(dir, payload)
        } catch (error) {
          // EXDEV: DSH_HOME on another volume. Copy then drop, and let a copy
          // failure abort the whole entry rather than half-park a session.
          void error
          cpSync(dir, payload, { recursive: true })
          try {
            rmSync(dir, { recursive: true, force: true, maxRetries: 2 })
          } catch (removeError) {
            // 0.8.1: the copy already exists and the original is partly gone.
            // Dropping the copy here (the old behaviour) left a half-deleted
            // session with no way back, so keep it and report a failure instead.
            keepCopy = true
            throw removeError
          }
        }
      }
      if (keys.indexOf(key) < 0) keys.push(key)
    } catch (error) {
      state.lastError = `park ${sessionId} failed: ${error && error.message}`
      // A copy we had to keep on purpose is not a stray half-parked entry, and
      // neither is an entry a previous attempt created: it is the only copy.
      if (!keepCopy && !prior) removeTrashEntrySync(entry)
    }
  }
  if (keys.length > 0 && settings.prune !== false) pruneTrashSync()
  return { moved: keys.length, keys }
}

async function trashSession(sessionId, reason, options) {
  const settings = options && typeof options === 'object' ? options : {}
  const root = sessionsRoot()
  let entries = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    void error
  }
  const keys = []
  const title = sessionTitleSync(sessionId)
  let parked = null
  let index = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = safeSessionDir(root, entry.name, sessionId)
    if (dir.length === 0) continue
    const workspace = entry.name
    const stamp = Date.now() + index
    index += 1
    if (parked === null) parked = trashEntriesSync()
    // Same rule as the sync path: a retry lands in the entry it already made.
    const prior = findParkedEntry(parked, sessionId, workspace)
    const key = prior ? prior.key : `${stamp}-${sessionId}`
    const target = prior ? prior.dir : trashEntryDir(key)
    if (target.length === 0) continue
    // Same rule as the sync path: the key stays, the deadline restarts.
    const deletedAt = new Date(stamp).toISOString()
    const priorTitle = prior && typeof prior.title === 'string' ? prior.title : ''
    let keepCopy = false
    try {
      await mkdir(target, { recursive: true })
      const payload = join(target, 'data')
      const merged = existsSync(payload)
      const meta = {
        id: sessionId, workspace, deletedAt, reason,
        title: priorTitle || title,
        bytes: 0,
      }
      if (merged) {
        await cp(dir, payload, { recursive: true, force: true })
        await rm(dir, { recursive: true, force: true, maxRetries: 2 })
        meta.bytes = dirSizeSync(payload)
        await writeFile(join(target, 'meta.json'), trashMetaFor(meta), 'utf8')
      } else {
        meta.bytes = dirSizeSync(dir)
        await writeFile(join(target, 'meta.json'), trashMetaFor(meta), 'utf8')
        try {
          await rename(dir, payload)
        } catch (error) {
          void error
          await cp(dir, payload, { recursive: true })
          try {
            await rm(dir, { recursive: true, force: true, maxRetries: 2 })
          } catch (removeError) {
            // Same rule as the sync path: a copy that exists is kept when the
            // original could not be fully removed.
            keepCopy = true
            throw removeError
          }
        }
      }
      if (keys.indexOf(key) < 0) keys.push(key)
    } catch (error) {
      state.lastError = `park ${sessionId} failed: ${error && error.message}`
      // A kept copy, or an entry a previous attempt created, is the only copy
      // left — never delete it as "cleanup".
      if (keepCopy || prior) continue
      try {
        await rm(target, { recursive: true, force: true })
      } catch (inner) {
        void inner
      }
    }
  }
  if (keys.length > 0 && settings.prune !== false) pruneTrashSync()
  return { moved: keys.length, keys }
}

/**
 * `<sessions>/<workspace>/<id>` for a RESTORE, or `''`.
 *
 * Deliberately not `safeSessionDir`: that guard proves the target exists (it
 * realpaths it), which is right for deletion and wrong here — the whole point
 * of a restore is that the directory is gone. So this validates the shape and
 * the parent only. The parent is where a symlink could redirect us, and it may
 * legitimately be missing for a workspace whose last session just went away.
 */
function restoreTarget(workspace, id) {
  if (isUnsafeId(id) || !SESSION_ID_PATTERN.test(id)) return ''
  if (typeof workspace !== 'string' || workspace.length === 0) return ''
  if (workspace.includes('/') || workspace.includes('\\') || workspace.includes('..')) return ''
  if (workspace === '.' || workspace === '..') return ''
  const root = resolve(sessionsRoot())
  const target = resolve(root, workspace, id)
  if (!isInsideRoot(root, target)) return ''
  const parent = dirname(target)
  if (existsSync(parent)) {
    let rootReal = ''
    let parentReal = ''
    try {
      rootReal = realpathSync(root)
      parentReal = realpathSync(parent)
    } catch (error) {
      void error
      return ''
    }
    const rel = relative(rootReal, parentReal)
    if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return ''
    if (rel.split(sep).filter(Boolean).length !== 1) return ''
  }
  return target
}

/**
 * Put one trashed session back where it came from.
 *
 * The restored session is NOT re-tracked as temporary: the user asked to
 * recover it, so it must not vanish again at the next quit.
 */
async function restoreTrashEntry(key) {
  const dir = trashEntryDir(key)
  if (dir.length === 0) return { ok: false, error: 'invalid trash key' }
  let meta = null
  try {
    meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  } catch (error) {
    void error
    return { ok: false, error: 'trash entry is unreadable' }
  }
  const id = meta && typeof meta.id === 'string' ? meta.id : ''
  const workspace = meta && typeof meta.workspace === 'string' ? meta.workspace : ''
  const target = restoreTarget(workspace, id)
  if (target.length === 0) return { ok: false, error: 'trash entry points outside the sessions root' }
  const payload = join(dir, 'data')
  if (!existsSync(payload)) return { ok: false, error: 'trash entry has no data' }
  if (existsSync(target)) {
    // The directory is back: either the user re-created it, or a delete left a
    // half-removed one behind. Overwriting it could destroy a live session, so
    // refuse — but return the path, because "a session already exists" with no
    // way to find it is a dead end.
    return {
      ok: false,
      code: 'target-exists',
      target,
      error: 'a session with this id already exists',
    }
  }
  try {
    await mkdir(dirname(target), { recursive: true })
    await rename(payload, target)
  } catch (error) {
    return { ok: false, error: `restore failed: ${error && error.message}` }
  }
  try {
    await rm(dir, { recursive: true, force: true })
  } catch (error) {
    void error
  }
  return { ok: true, id, workspace }
}

function removeSessionSync(sessionId, options) {
  if (isUnsafeId(sessionId) || !SESSION_ID_PATTERN.test(sessionId)) return 0
  const settings = options && typeof options === 'object' ? options : {}
  const keepDeleted = typeof settings.keepDeleted === 'boolean'
    ? settings.keepDeleted
    : state.config.keepDeleted !== false
  let removed = 0
  if (keepDeleted) {
    // 0.8.0: park instead of unlink. A parking failure reports 0 so every
    // caller treats it as "still there, retry" — never as a permanent delete.
    removed = trashSessionSync(sessionId, settings.reason || 'delete', settings).moved
  } else {
    for (const dir of sessionDirsSync(sessionId)) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 2 })
        removed += 1
      } catch (error) {
        state.lastError = `delete ${sessionId} failed: ${error && error.message}`
      }
    }
  }
  if (removed > 0) {
    try {
      rmSync(projectionCacheFile(sessionId), { force: true })
    } catch (error) {
      void error
    }
  }
  return removed
}

async function removeSession(sessionId, options) {
  if (isUnsafeId(sessionId) || !SESSION_ID_PATTERN.test(sessionId)) return 0
  const settings = options && typeof options === 'object' ? options : {}
  const keepDeleted = typeof settings.keepDeleted === 'boolean'
    ? settings.keepDeleted
    : state.config.keepDeleted !== false
  let removed = 0
  if (keepDeleted) {
    // 0.8.0: same contract as the sync path — parking only, and a parking
    // failure is a failure, not an excuse to unlink.
    removed = (await trashSession(sessionId, settings.reason || 'delete', settings)).moved
  } else {
    const root = sessionsRoot()
    let entries = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (error) {
      void error
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const target = safeSessionDir(root, entry.name, sessionId)
      if (target.length === 0) continue
      try {
        await rm(target, { recursive: true, force: true, maxRetries: 2 })
        removed += 1
      } catch (error) {
        state.lastError = `delete ${sessionId} failed: ${error && error.message}`
      }
    }
  }
  // 0.7.3: only drop the projection cache when the session really went away.
  // Deleting it after a refused delete (locked dir, guard-refused symlink) made
  // the host rebuild a projection for a session we are about to retry.
  if (removed > 0) {
    try {
      await rm(projectionCacheFile(sessionId), { force: true })
    } catch (error) {
      void error
    }
  }
  return removed
}

/**
 * Hide a session we could not delete from disk.
 *
 * `workspaceRegistry.archiveSession` is the host's own "remove from the list"
 * primitive (the sidebar's archive action). It is a fallback only: when the
 * files are gone the session disappears by itself once the search index
 * reconciles.
 */
async function hideSession(sessionId) {
  for (const candidate of state.contexts) {
    try {
      const registry = candidate && typeof candidate.get === 'function' ? candidate.get('workspaceRegistry') : null
      if (registry && typeof registry.archiveSession === 'function') {
        // 0.7.3: the host returns false when it did not archive anything (the
        // session is not in that workspace's index). Reporting `hidden: true`
        // there told the user "hidden, retried next launch" while the row was
        // still on screen.
        const archived = await registry.archiveSession(sessionId, { stopActivity: true })
        return archived !== false
      }
    } catch (error) {
      void error
    }
  }
  return false
}

/**
 * Delete every tracked session (async path: startup, manual, scheduled, route).
 *
 * `skipActiveMs` protects a conversation the user is looking at right now: the
 * scheduled cleanup passes 3 minutes, the quit path passes nothing (a quit is
 * the user asking for the cleanup, and the process is going away anyway).
 */
async function purgeAll(reason, options) {
  const skipActiveMs = options && Number.isFinite(options.skipActiveMs) ? options.skipActiveMs : 0
  const ids = state.tracked.slice()
  const report = {
    reason, at: new Date().toISOString(),
    tried: ids.length, removed: 0, hidden: 0, skipped: 0, failed: [],
    // 0.7.4: guard refusals caused by a linked workspace. These are permanent,
    // so the id is untracked and the path is reported instead of retried forever.
    blocked: [], blockedPaths: [],
    // 0.7.3: ids whose files were already gone. Kept apart from `removed` so the
    // number reported as deleted reflects work actually done this run; the
    // client still shows removed+zombies as "cleaned up".
    zombies: 0,
  }
  // 0.7.2 (#3): track only the ids we actually deleted, then subtract them from
  // the CURRENT list at the end. The old code assigned a snapshot-derived
  // `kept` array wholesale, so any id added by a concurrent `track()` during
  // these awaits was silently erased — a temp session that would never be
  // cleaned up. Incremental removal keeps newly tracked ids intact.
  const removedIds = []
  // 0.7.3: one listing for the whole loop. Updated as we delete so the "is it
  // gone" question still gets a truthful answer without re-reading directories.
  const liveIds = indexSessionIds()
  for (const id of ids) {
    if (skipActiveMs > 0 && sessionActiveWithin(id, skipActiveMs)) {
      report.skipped += 1
      continue
    }
    let removed = 0
    try {
      // 0.8.1: retention runs once after the loop, not after every session.
      removed = await removeSession(id, { reason, prune: false })
    } catch (error) {
      void error
    }
    if (liveIds && removed > 0) liveIds.delete(sessionKey(id))
    // 0.7.3 (#2): judge by "is it gone from disk", not by the rm call's count.
    // A zombie id (directory deleted by a previous crash or by the host UI)
    // must be dropped from tracking instead of being reported as a permanent
    // failure forever. sessionGoneFromDisk() only says true when the root is
    // readable and no entry with this id remains — a readdir error or a
    // guard-refused symlink keeps the id for the next retry.
    if (sessionGoneFromDisk(id, liveIds)) {
      // Count a zombie separately: from the user's point of view the temporary
      // session is gone and its tracking entry is cleared, but no file was
      // deleted this run, and blurring the two made the report claim 20 deletes
      // when zero bytes were touched.
      if (removed > 0) report.removed += 1
      else report.zombies += 1
      removedIds.push(id)
      continue
    }
    // 0.7.4: a linked workspace is a PERMANENT guard refusal, not a transient
    // lock. Deleting through the link would escape the sessions root, so we
    // keep that rule — but retrying it at every startup and 30s tick forever
    // is a dead state. Untrack it and report the exact path to handle manually.
    const blockedDirs = removed === 0 ? linkedWorkspaceDirs(id) : []
    if (blockedDirs.length > 0) {
      report.blocked.push(id)
      for (const entry of blockedDirs) report.blockedPaths.push(entry.path)
      removedIds.push(id)
      continue
    }
    // The directory survived (locked file, permission). Hide it so the sidebar
    // does not show a "temporary" chat that outlives its promise, and retry the
    // delete on the next launch — keep the id tracked.
    const hidden = await hideSession(id)
    if (hidden) report.hidden += 1
    report.failed.push(id)
  }
  const before = state.tracked.slice()
  state.tracked = state.tracked.filter((id) => !removedIds.includes(id))
  // 0.8.1: one retention pass for the whole batch (see trashSessionSync).
  try {
    pruneTrashSync()
  } catch (error) {
    void error
  }
  const saved = await saveStore()
  if (!saved) {
    // 0.7.2 (#2): rollback so memory matches the file on disk. 0.7.3 (#4):
    // prefer re-reading the file (preserves concurrent track() ids); fall back
    // to the snapshot if the file itself is unreadable.
    await rollbackStore(before)
    report.storeWriteFailed = true
    report.error = state.lastError
  }
  state.lastPurge = report
  return report
}

/**
 * Delete one tracked session from the sidebar menu (0.4.0).
 *
 * Same steps as `purgeAll` for a single id: remove the directories, verify they
 * are really gone, fall back to hiding the row when a file is locked. Two
 * deliberate differences:
 *
 * - **Only tracked ids are accepted.** This route is reachable from the page, so
 *   it must never become "delete any session by id". An untracked id is refused
 *   before any filesystem call.
 * - **A failed delete keeps the id tracked**, exactly like `purgeAll`, so the
 *   next launch retries it instead of leaving an undeletable row that silently
 *   stopped being temporary.
 */
async function removeOne(sessionId) {
  await ensureReady()
  const id = normalizeId(sessionId)
  if (id.length === 0) return { ok: false, error: 'invalid session id' }
  if (!state.tracked.includes(id)) return { ok: false, error: 'not a temporary session' }
  let removed = 0
  try {
    removed = await removeSession(id, { reason: 'single' })
  } catch (error) {
    void error
  }
  // 0.7.3 (#2): a zombie id whose directory is already gone counts as removed.
  const gone = sessionGoneFromDisk(id)
  // 0.7.4: a linked workspace is refused by the deletion guard on purpose.
  // Recognise it BEFORE hiding the row: otherwise the user loses both the
  // session and any clue why nothing was deleted, and the id is retried
  // forever. Keep the safety rule, stop tracking, return the exact path.
  const blockedDirs = gone ? [] : linkedWorkspaceDirs(id)
  if (blockedDirs.length > 0) {
    const paths = blockedDirs.map((entry) => entry.path)
    // Keep absolute paths out of `lastError`: it is copied verbatim into the
    // feedback report and from there into a public issue URL. The exact paths
    // stay in this call's response for the local toast only.
    const detail = `linked workspace: session ${id} not deleted outside sessions root`
    const before = state.tracked.slice()
    state.tracked = state.tracked.filter((item) => item !== id)
    if (!await saveStore()) {
      await rollbackStore(before)
      state.lastError = detail
      return { ok: false, error: detail, blocked: true, paths, ids: state.tracked.slice(), count: state.tracked.length }
    }
    state.lastError = detail
    state.lastPurge = {
      reason: 'single', at: new Date().toISOString(), tried: 1,
      removed: 0, hidden: 0, skipped: 0, blocked: [id], blockedPaths: paths, failed: [],
    }
    return {
      ok: false,
      error: `session lives in a linked workspace and was NOT deleted for safety. Remove it manually: ${paths.join(' | ')}`,
      blocked: true,
      paths,
      ids: state.tracked.slice(),
      count: state.tracked.length,
    }
  }
  let hidden = false
  if (!gone) hidden = await hideSession(id)
  const report = {
    reason: 'single',
    at: new Date().toISOString(),
    tried: 1,
    removed: gone ? 1 : 0,
    hidden: hidden ? 1 : 0,
    skipped: 0,
    failed: [],
  }
  if (gone) {
    // Files are really gone — safe to forget the id, but only once the tracking
    // file confirms it (0.7.2, #2).
    const before = state.tracked.slice()
    state.tracked = state.tracked.filter((item) => item !== id)
    if (!await saveStore()) {
      // 0.7.3 (#4): re-read from disk instead of a stale snapshot so a
      // concurrent track() is not silently dropped on rollback.
      await rollbackStore(before)
      report.storeWriteFailed = true
      state.lastPurge = report
      return { ok: false, error: state.lastError, ids: state.tracked.slice(), count: state.tracked.length }
    }
    state.lastPurge = report
    return { ok: true, removed: true, hidden: false, ids: state.tracked.slice(), count: state.tracked.length }
  }
  // 0.7.0 (P1): `hideSession` only archives the ROW; it is not a disk deletion.
  // The old code removed the id on `hidden`, so a locked file was never retried
  // and the session content lived forever — breaking "temporary = gone on exit".
  // purgeAll() keeps such an id for the next launch; do the same here. The
  // client still shows its "locked, will retry" toast via hidden:true.
  report.failed.push(id)
  state.lastPurge = report
  const outcome = {
    removed: false,
    hidden,
    retried: true,
    ids: state.tracked.slice(),
    count: state.tracked.length,
  }
  if (hidden) return { ok: true, ...outcome }
  return { ok: false, error: 'delete failed — the session files are locked', ...outcome }
}

/** Delete every tracked session synchronously — the quit path has no `await`. */
function purgeSync(reason, options) {
  const settings = options && typeof options === 'object' ? options : {}
  if (state.tracked.length === 0) {
    // 0.8.1 (fourth pass): "nothing to delete" is not "nothing to expire". A
    // machine whose temporary sessions were all removed earlier still needs
    // its trash trimmed on quit, otherwise expired entries survive forever.
    try {
      pruneTrashSync(settings.keepDeletedDays)
    } catch (error) {
      void error
    }
    return { reason, tried: 0, removed: 0, blocked: [], kept: [] }
  }
  // 0.8.1: the quit path is synchronous and blocking; prune once at the end
  // instead of once per session.
  const batch = { ...settings, prune: false }
  const ids = state.tracked.slice()
  const kept = []
  const blocked = []
  let removed = 0
  for (const id of ids) {
    const count = removeSessionSync(id, batch)
    if (count > 0 && sessionDirsSync(id).length === 0) removed += 1
    else if (sessionGoneFromDisk(id)) removed += 1 // 0.7.3 (#2): zombie id
    else if (linkedWorkspaceDirs(id).length > 0) blocked.push(id) // 0.7.4: permanent refusal
    else kept.push(id)
  }
  state.tracked = kept
  try {
    pruneTrashSync(settings.keepDeletedDays)
  } catch (error) {
    void error
  }
  // Best effort: the process is going away, so this write often loses the race.
  try {
    const path = state.storePath || storePath()
    mkdirSync(dirname(path), { recursive: true })
    const body = JSON.stringify({ version: 1, sessions: kept }, null, 2)
    // 0.7.3: this is the write most likely to be interrupted (quit, kill,
    // power loss), so it gets the same temp+rename treatment as saveStore.
    // A torn file here is what makes the next launch lose every id.
    const tmp = `${path}.${process.pid}.exit.tmp`
    try {
      writeFileSync(tmp, body)
      renameSync(tmp, path)
    } catch (error) {
      // Last resort: a non-atomic write still records the list, which beats a
      // store that keeps listing sessions we just deleted.
      try {
        writeFileSync(path, body)
      } catch (inner) {
        void inner
      }
      try {
        rmSync(tmp, { force: true })
      } catch (inner) {
        void inner
      }
    }
  } catch (error) {
    void error
  }
  state.lastPurge = { reason, at: new Date().toISOString(), tried: ids.length, removed, blocked, kept }
  return state.lastPurge
}

/**
 * One readiness gate for the whole process: load the tracking file, then run
 * the startup purge exactly once. Every route awaits it, otherwise a request
 * arriving first would be overwritten by the load (`state.tracked = []`).
 */
let readyTask = null
function ensureReady() {
  if (readyTask) return readyTask
  readyTask = (async () => {
    await loadStore()
    // 0.8.0: retention is applied at boot even when nothing is deleted this
    // run, otherwise a machine that is never quit for days keeps stale entries.
    try {
      pruneTrashSync()
    } catch (error) {
      void error
    }
    if (state.config.deleteOnExit && !state.bootPurged) {
      // 0.7.3: mark the pass complete only after it actually ran. Setting the
      // flag first meant a purge that threw skipped the cleanup for the rest of
      // this run (purgeAll swallows per-session errors, so this is the rare
      // top-level throw).
      if (state.tracked.length > 0) await purgeAll('startup')
      state.bootPurged = true
    }
  })().catch((error) => {
    state.lastError = `startup failed: ${error && error.message}`
  })
  return readyTask
}

/**
 * Quit-path cleanup decision (0.7.2, defect #1).
 *
 * The async paths (startup purge, scheduler) read `state.config`, which hot
 * reload keeps fresh. The `exit` event cannot await a reload, so re-read the
 * on-disk config synchronously here: a hand edit made seconds before quitting
 * must be honoured. `parseConfig()` falls back to DEFAULT_CONFIG (deleteOnExit
 * = true) when the file is unreadable, so a broken config still errs on the
 * side of "temporary = gone" — the safe direction for the core promise.
 */
function purgeOnExit() {
  let config = { ...DEFAULT_CONFIG }
  try {
    config = parseConfig()
  } catch (error) {
    void error
  }
  if (config.deleteOnExit === false) {
    return { reason: 'process-exit', at: new Date(inject.now()).toISOString(), tried: 0, removed: 0, kept: state.tracked.slice(), skippedByConfig: true }
  }
  // 0.8.1 (fourth pass): carry BOTH settings into the synchronous purge. The
  // old code only passed KEEP_DELETED, so a "3 → 1 day" edit made seconds before
  // quitting was still measured against the cached 7-day window.
  return purgeSync('process-exit', {
    keepDeleted: config.keepDeleted !== false,
    keepDeletedDays: config.keepDeletedDays,
    reason: 'process-exit',
  })
}

/** Register the quit hook once per process. */
function installExitHook() {
  if (state.hooks) return
  state.hooks = true
  const handler = () => {
    try {
      purgeOnExit()
    } catch (error) {
      void error
    }
  }
  // A test-only registrar replaces the real hook; the default path keeps the
  // direct process 'exit' wiring this regression contract pins.
  if (typeof inject.exitHook === 'function') {
    inject.exitHook(handler)
    return
  }
  try {
    process.once('exit', () => {
      try {
        purgeOnExit()
      } catch (error) {
        void error
      }
    })
  } catch (error) {
    void error
  }
}

// ---------------------------------------------------------------------------
// daily cleanup scheduler (0.2.2)
// ---------------------------------------------------------------------------

/** Next occurrence of `HH:MM`, local time. Always strictly in the future. */
function computeNextRun(clock) {
  const normalized = normalizeClock(clock)
  if (!normalized) return null
  const hour = Number(normalized.slice(0, 2))
  const minute = Number(normalized.slice(3, 5))
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next
}

function stopScheduler() {
  if (state.scheduler.timer) {
    try { inject.timers.clearInterval(state.scheduler.timer) } catch (error) { void error }
    state.scheduler.timer = null
  }
  state.scheduler.nextRunAt = null
  state.scheduler.retryAt = null
}

/**
 * One wake-up. Two ways to be due: the daily target arrived, or a previous run
 * skipped a session that was in use and asked to look again in a few minutes.
 */
async function schedulerTick() {
  // 0.7.3 (#5): the scheduler must not run on a stale on/off switch. Without a
  // page polling status/config/probe, refreshConfigIfChanged() may never have
  // run, so a hand edit to SCHEDULE_DELETE would be ignored until the next
  // request — deleting sessions the user just protected. Re-read before acting.
  refreshConfigIfChanged()
  const scheduler = state.scheduler
  if (scheduler.busy || !state.config.scheduleDelete) return
  const now = inject.now()
  const dueNext = !!(scheduler.nextRunAt && now >= scheduler.nextRunAt.getTime())
  const dueRetry = !!(scheduler.retryAt && now >= scheduler.retryAt.getTime())
  if (!dueNext && !dueRetry) return

  scheduler.busy = true
  try {
    await ensureReady()
    const report = await purgeAll(dueNext ? 'scheduled' : 'scheduled-retry', { skipActiveMs: ACTIVE_WINDOW_MS })
    scheduler.lastRunAt = report.at
    scheduler.retryAt = report.skipped > 0 || report.failed.length > 0
      ? new Date(inject.now() + RETRY_DELAY_MS)
      : null
    if (dueNext) scheduler.nextRunAt = computeNextRun(state.config.scheduleTime)
  } catch (error) {
    state.lastError = `scheduled cleanup failed: ${error && error.message}`
  } finally {
    scheduler.busy = false
  }
}

function startScheduler(preserveRetry) {
  // 0.7.3: a restart caused by anything other than the schedule itself (a plugin
  // reload, an unrelated setting) must not forget that a session in use was
  // asked to be retried in five minutes.
  const retryAt = preserveRetry === true ? state.scheduler.retryAt : null
  stopScheduler()
  if (!state.config.scheduleDelete) return
  state.scheduler.retryAt = retryAt
  state.scheduler.nextRunAt = computeNextRun(state.config.scheduleTime)
  try {
    const timer = inject.timers.setInterval(schedulerTick, TICK_MS)
    // A cleanup timer must never be the reason the host process stays alive.
    if (timer && typeof timer.unref === 'function') timer.unref()
    state.scheduler.timer = timer
  } catch (error) {
    state.lastError = `scheduler start failed: ${error && error.message}`
  }
}

/** Re-read the target after a settings change; also used at boot. */
function restartScheduler(preserveRetry) {
  startScheduler(preserveRetry)
}

/**
 * 0.6.1 (community PR #105 review): let the host own the timer's lifetime.
 *
 * `ctx.effect(fn)` runs fn immediately and calls the disposer it returns when
 * the plugin is disposed / re-applied. A bare setInterval used to outlive a
 * plugin reload, leaving a second scheduler ticking against the same state.
 * Hosts without `effect` (older Cordis, test doubles) keep the old behaviour,
 * so this is a pure lifetime improvement, never a new requirement.
 */
function bindSchedulerEffect(hostCtx) {
  // Always (re)start for this apply: startScheduler() stops any stale timer
  // first, so repeated applies cannot duplicate it. A reload is not a schedule
  // change, so the pending retry survives.
  restartScheduler(true)
  if (typeof hostCtx?.effect !== 'function') {
    // No host-managed lifetime on this ctx. Any effect from an older scope is
    // now orphaned; its cleanup no-ops because schedulerCtx no longer matches.
    state.schedulerCtx = null
    state.schedulerEffectBound = false
    return
  }
  // A hot reload applies the same singleton host with a NEW ctx. Binding the
  // effect to that ctx is what keeps disposal correct: the old ctx's cleanup
  // runs later, and must not stop the timer the new ctx now owns.
  if (state.schedulerCtx === hostCtx && state.schedulerEffectBound) return
  const boundCtx = hostCtx
  try {
    hostCtx.effect(() => {
      // Re-assert ownership on every run: if the host's effect is reactive and
      // re-fires, its cleanup clears the owner and the outer assignment would
      // never happen again — leaving a timer no one can stop.
      state.schedulerCtx = boundCtx
      state.schedulerEffectBound = true
      restartScheduler(true)
      return function () {
        // Superseded by a re-apply on a newer ctx: our timer is no longer ours
        // to stop. This is the bug that let a disabled plugin keep deleting.
        if (state.schedulerCtx !== boundCtx) return
        state.schedulerCtx = null
        state.schedulerEffectBound = false
        stopScheduler()
      }
    }, 'dsh-sidebar-suite: daily cleanup')
    state.schedulerCtx = boundCtx
    state.schedulerEffectBound = true
  } catch (error) {
    state.lastError = `ctx.effect registration failed: ${error && error.message}`
    state.schedulerCtx = null
    state.schedulerEffectBound = false
    restartScheduler(true)
  }
}

function schedulerStatus() {
  return {
    enabled: state.config.scheduleDelete,
    at: state.config.scheduleTime,
    nextRunAt: state.scheduler.nextRunAt ? state.scheduler.nextRunAt.toISOString() : null,
    lastRunAt: state.scheduler.lastRunAt,
    retryAt: state.scheduler.retryAt ? state.scheduler.retryAt.toISOString() : null,
    managed: state.schedulerEffectBound,
  }
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

/** Add one session id to the temporary set (called right after creation). */
async function track(sessionId) {
  await ensureReady()
  const id = normalizeId(sessionId)
  if (id.length === 0) return { ok: false, error: 'invalid session id' }
  const before = state.tracked.slice()
  if (!state.tracked.includes(id)) state.tracked.push(id)
  // Oldest first: trimming keeps the newest MAX_KEPT entries.
  // 0.7.0 (P2): reuse purgeAll()'s single-item rules instead of splicing ids
  // blindly. A session open right now is skipped (ACTIVE_WINDOW_MS), and a
  // delete that fails keeps its id tracked for the next launch — otherwise a
  // lock could delete the conversation the user is looking at, or orphan a
  // directory nobody tracks any more.
  if (state.tracked.length > state.config.maxKept) {
    const overflow = state.tracked.length - state.config.maxKept
    // Only consider the OLDEST `overflow` ids as trim candidates. Never walk
    // further into the list: skipping an active/failed old id must not cause a
    // NEWER, still-wanted session to be deleted in its place.
    const candidates = state.tracked.slice(0, overflow)
    const survivors = []
    for (const id of candidates) {
      if (sessionActiveWithin(id, ACTIVE_WINDOW_MS)) { survivors.push(id); continue }
      let removed = 0
      try {
        removed = await removeSession(id)
      } catch (error) {
        void error
      }
      if (sessionGoneFromDisk(id)) continue // really gone (0.7.3: includes zombies)
      // 0.7.4: a linked workspace can never be deleted by this plugin. Keep
      // refusing the delete, but stop carrying the id forever.
      if (linkedWorkspaceDirs(id).length > 0) continue
      // Delete failed — keep the id so a later launch retries it.
      survivors.push(id)
    }
    // Everyone not examined (the newest maxKept ids) stays untouched.
    state.tracked = survivors.concat(state.tracked.slice(overflow))
  }
  if (!await saveStore()) {
    // 0.7.2 (#2): re-read the file so memory matches what will load next time,
    // and tell the caller instead of claiming the session was tracked.
    // 0.7.3 (#4): fall back to the pre-call snapshot if the file is unreadable.
    await rollbackStore(before)
    return { ok: false, error: state.lastError, ids: state.tracked.slice(), count: state.tracked.length }
  }
  return { ok: true, ids: state.tracked.slice(), count: state.tracked.length }
}

async function untrack(sessionId) {
  await ensureReady()
  const id = normalizeId(sessionId)
  if (id.length === 0) return { ok: false, error: 'invalid session id' }
  const before = state.tracked.slice()
  state.tracked = state.tracked.filter((item) => item !== id)
  if (!await saveStore()) {
    // 0.7.2 (#2): critical — a silent failure here would drop the id in memory
    // but not on disk, so next launch reloads it and DELETES a session the user
    // was told was kept. 0.7.3 (#4): re-read from disk (not a stale snapshot)
    // so a concurrent track() is preserved on rollback too.
    await rollbackStore(before)
    return { ok: false, error: state.lastError, ids: state.tracked.slice(), count: state.tracked.length }
  }
  return { ok: true, ids: state.tracked.slice(), count: state.tracked.length }
}

/**
 * 0.8.5 — promote EVERY tracked session in one call (the detail page's
 * "keep all"). One store write instead of one per id: the client loop used to
 * mean N untrack POSTs and, on a OneDrive home, N atomic-replace dances.
 */
async function keepAll() {
  await ensureReady()
  const before = state.tracked.slice()
  if (before.length === 0) return { ok: true, kept: 0, ids: [], count: 0 }
  state.tracked = []
  if (!await saveStore()) {
    await rollbackStore(before)
    return { ok: false, error: state.lastError, ids: state.tracked.slice(), count: state.tracked.length }
  }
  return { ok: true, kept: before.length, ids: [], count: 0 }
}

function status() {
  // Every poll doubles as a hot-reload check.
  refreshConfigIfChanged()
  return {
    ok: true,
    showButton: state.config.showButton,
    chatModePolicy: state.config.inChatMode,
    buttonStyle: state.config.buttonStyle,
    expandAllSessions: state.config.expandAllSessions,
    rowMenu: state.config.rowMenu,
    deleteOnExit: state.config.deleteOnExit,
    scheduleDelete: state.config.scheduleDelete,
    scheduleTime: state.config.scheduleTime,
    schedule: schedulerStatus(),
    maxKept: state.config.maxKept,
    configFile: configPath(),
    configMigrated: state.configMigrated,
    configRevision: state.configRevision,
    configReloads: state.configReloads,
    configReloadSource: state.configReloadSource,
    tempCount: state.tracked.length,
    config: { found: state.config.found, error: state.config.error || undefined },
    routes: {
      registered: state.routes.registered,
      errors: state.routes.errors.slice(0, 4),
      // The client badge must verify the *critical* routes, not just a count.
      paths: state.routes.paths.slice(),
    },
    // 1.0.0 M1: one summary reason for an unknown/degraded host, alongside the
    // per-route errors above. Absent when everything registered cleanly.
    degraded: state.degraded || undefined,
    lastPurge: state.lastPurge,
    lastError: state.lastError || undefined,
    // 0.8.1: retention counters. `prunes` is what proves a batch delete walks
    // the trash once instead of once per session; kept/bytes are the last pass.
    trash: {
      prunes: state.trashPrunes,
      kept: state.trashKept,
      bytes: state.trashBytes,
    },
    // Everything a feedback report needs to be diagnosable without a second
    // round-trip. `DSH_CLIENT_VERSION` is set by the desktop main process for
    // the host child (verified in the installed rc.5 at resources/app/lib/main.js,
    // formerly inside app.asar: DesktopBackendController spawns the host with
    // `DSH_CLIENT_VERSION: desktopClientVersion()`).
    env: {
      plugin: pluginVersion(),
      dshClient: process.env.DSH_CLIENT_VERSION || '',
      platform: process.platform,
      arch: process.arch,
      os: (() => {
        try {
          return osRelease()
        } catch (error) {
          void error
          return ''
        }
      })(),
      node: process.versions.node || '',
      electron: process.versions.electron || '',
    },
  }
}

function probe() {
  refreshConfigIfChanged()
  return {
    ok: true,
    mode: 'native-session',
    dshHome: dshHome(),
    sessionsRoot: sessionsRoot(),
    storePath: state.storePath || storePath(),
    configFile: configPath(),
    configMigrated: state.configMigrated,
    configTemplate: legacyConfigPath(),
    tracked: state.tracked.slice(),
    config: state.config,
    configRevision: state.configRevision,
    configReloadSource: state.configReloadSource,
    schedule: schedulerStatus(),
    routes: state.routes,
    lastPurge: state.lastPurge,
    lastError: state.lastError || undefined,
    deletesOnExit: state.config.deleteOnExit,
    scheduleEnabled: state.config.scheduleDelete,
    processExitHook: state.hooks,
    createsOwnWindow: false,
    usesNativeWindow: true,
  }
}

function json(body, code = 200) {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function queryOf(request) {
  try {
    const url = new URL(request.url, 'http://localhost')
    return {
      sessionId: normalizeId(url.searchParams.get('sessionId') || ''),
      // 0.8.0: trash routes are keyed by entry directory, not session id — an
      // id can appear more than once after a delete/restore cycle.
      key: url.searchParams.get('key') || '',
    }
  } catch (error) {
    void error
    return { sessionId: '', key: '' }
  }
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

export function createTempSessionHost(initialCtx, options) {
  const opts = options && typeof options === 'object' ? options : {}
  // Test-only seams: wall clock, interval timers, exit hook. Omitting any of
  // them keeps the real runtime default.
  if (typeof opts.now === 'function') inject.now = opts.now
  if (opts.timers && typeof opts.timers.setInterval === 'function') inject.timers = opts.timers
  inject.exitHook = opts.hooks && typeof opts.hooks.onExit === 'function' ? opts.hooks.onExit : null
  if (initialCtx) state.contexts.push(initialCtx)

  /** Keep every context the plugin is applied to: services differ per scope. */
  function setContext(next) {
    if (!next) return
    if (!state.contexts.includes(next)) state.contexts.push(next)
  }

  function register(hostCtx) {
    setContext(hostCtx)
    // 0.7.3 (#6): `configRevision` means "config changed", and refreshConfigIfChanged
    // only bumps it on a real field change. A re-apply (hot reload) used to bump
    // it unconditionally, making polling clients do a pointless re-apply and
    // skewing the diagnostic counters. Only bump when the parsed config differs.
    const prev = state.config
    const next = parseConfig()
    const fields = [
      'showButton', 'inChatMode', 'buttonStyle', 'expandAllSessions', 'rowMenu',
      'deleteOnExit', 'scheduleDelete', 'scheduleTime', 'maxKept',
      'keepDeleted', 'keepDeletedDays',
    ]
    const changed = fields.some((field) => next[field] !== prev[field])
    state.config = next
    state.configStamp = configStamp()
    if (changed || state.configRevision === 0) state.configRevision += 1
    installExitHook()
    // Boot the daily cleanup from whatever the file says; a stale timer from a
    // previous apply is replaced, never duplicated. Since 0.6.1 its lifetime is
    // tied to the host context via ctx.effect where available.
    bindSchedulerEffect(hostCtx)

    // Boot pass: anything still tracked was created in a previous run and must
    // not survive it. `ensureReady()` runs it once and every route waits on it.
    ensureReady()

    const routes = [
      ['/api/dsh-temp-session.status', ['GET'], async () => { await ensureReady(); return json(status()) }],
      ['/api/dsh-temp-session.list', ['GET'], async (request) => {
        await ensureReady()
        const ids = state.tracked.slice()
        // 0.8.4: `?titles=1` — the detail page's temp-session manager needs a
        // label per row; the sidebar's plain poll must stay cheap, so titles
        // are opt-in. Same source the trash reads when it parks an entry: a
        // missing cache simply means "no title" and the id is shown instead.
        let withTitles = false
        try {
          withTitles = new URL(request.url, 'http://localhost').searchParams.get('titles') === '1'
        } catch (error) {
          void error
        }
        if (!withTitles) return json({ ok: true, ids, count: ids.length })
        return json({
          ok: true,
          ids,
          count: ids.length,
          maxKept: state.config.maxKept,
          entries: ids.map((id) => {
            try { return { id, title: sessionTitleSync(id) } } catch (error) {
              void error
              return { id, title: '' }
            }
          }),
        })
      }],
      ['/api/dsh-temp-session.config', ['GET', 'POST'], async (request) => {
        await ensureReady()
        const method = request && request.method ? String(request.method).toUpperCase() : 'GET'
        if (method !== 'POST') {
          refreshConfigIfChanged()
          return json({ ok: true, ...publicConfig() })
        }
        let patch = null
        try {
          const raw = await request.text()
          if (Buffer.byteLength(raw || '', 'utf8') > MAX_CONFIG_BODY_BYTES) {
            return json({ ok: false, error: 'request body too large' }, 413)
          }
          patch = raw && raw.trim().length > 0 ? JSON.parse(raw) : {}
        } catch (error) {
          void error
          return json({ ok: false, error: 'invalid JSON body' }, 400)
        }
        const result = saveConfig(patch)
        if (!result.ok) return json(result, 500)
        return json({ ok: true, ...result.config, schedule: schedulerStatus() })
      }],
      // 0.7.0 (P2): mutating routes are POST-only. A GET must never be able to
      // track/untrack/delete/purge — an image tag or prefetch could do it.
      ['/api/dsh-temp-session.track', ['POST'], async (request) => {
        const { sessionId } = queryOf(request)
        if (sessionId.length === 0) return json({ ok: false, error: 'sessionId required' }, 400)
        return json(await track(sessionId))
      }],
      ['/api/dsh-temp-session.untrack', ['POST'], async (request) => {
        const { sessionId } = queryOf(request)
        if (sessionId.length === 0) return json({ ok: false, error: 'sessionId required' }, 400)
        return json(await untrack(sessionId))
      }],
      // 0.8.5 — one call keeps every tracked session (single store write).
      ['/api/dsh-temp-session.keep-all', ['POST'], async () => {
        return json(await keepAll())
      }],
      // 0.4.0 — delete one temporary session from the row menu.
      ['/api/dsh-temp-session.remove', ['POST'], async (request) => {
        const { sessionId } = queryOf(request)
        if (sessionId.length === 0) return json({ ok: false, error: 'sessionId required' }, 400)
        return json(await removeOne(sessionId))
      }],
      ['/api/dsh-temp-session.purge', ['POST'], async () => {
        await ensureReady()
        return json({ ok: true, ...(await purgeAll('manual')) })
      }],
      ['/api/dsh-temp-session.probe', ['GET'], async () => { await ensureReady(); return json(probe()) }],
      // 0.7.4 — absolute log-directory paths for one session. The client uses
      // these with the host's public remote `openWorkspacePath({ action: 'reveal' })`
      // for the "Open session folder" row-menu item. Read-only: no sessionId in
      // the tracked list yields an empty array, never a directory outside the
      // sessions root (sessionDirsSync already applies the path guard).
      ['/api/dsh-temp-session.paths', ['GET'], async (request) => {
        await ensureReady()
        const { sessionId } = queryOf(request)
        if (sessionId.length === 0) return json({ ok: false, error: 'sessionId required' }, 400)
        const tracked = state.tracked.includes(sessionId)
        let paths = tracked ? sessionDirsSync(sessionId) : []
        if (tracked && paths.length === 0) {
          // A linked workspace is invisible to sessionDirsSync because the
          // delete guard rejects its realpath. This route is display/reveal
          // only: give the user the exact path instead of claiming the folder
          // no longer exists. Never feed these paths to deletion code.
          paths = linkedWorkspaceDirs(sessionId).map((entry) => entry.path)
        }
        return json({ ok: true, id: sessionId, paths })
      }],
      // 0.8.0 — the local trash. Read/write are separate routes so an accidental
      // GET can never restore or purge anything BY KEY. It does apply the time
      // and count retention: "expired entries are cleared when you start DSH or
      // open the detail page" needs a trigger on a machine that never quits
      // through this plugin. No session directory is touched by this GET.
      ['/api/dsh-temp-session.trash', ['GET'], async () => {
        await ensureReady()
        // 0.8.1: this route reports and applies keepDeleted / keepDeletedDays,
        // so it must see a hand-edited config file instead of the value cached
        // at boot (it used to report "on" after the user wrote off).
        refreshConfigIfChanged()
        // Read-only: listing the trash never deletes an entry. Retention runs
        // at boot (ensureReady) and on the scheduled cleanup tick (purgeAll),
        // so an accidental GET cannot touch a session directory.
        const entries = trashEntriesSync().map((entry) => ({
          key: entry.key,
          id: entry.id,
          workspace: entry.workspace,
          title: entry.title,
          deletedAt: entry.deletedAt,
          bytes: entry.bytes,
          oversize: entry.oversize,
        }))
        return json({
          ok: true,
          keepDeleted: state.config.keepDeleted !== false,
          keepDeletedDays: state.config.keepDeletedDays,
          // 0.8.1: the caps used to live only in the code, so the 20-entry trim
          // looked arbitrary from the UI. Say the numbers, and what is on disk.
          caps: { entries: TRASH_MAX_ENTRIES, bytes: TRASH_MAX_BYTES },
          totalBytes: entries.reduce((total, entry) => total + (Number(entry.bytes) || 0), 0),
          entries,
        })
      }],
      ['/api/dsh-temp-session.trash-restore', ['POST'], async (request) => {
        await ensureReady()
        const { key } = queryOf(request)
        const result = await restoreTrashEntry(key)
        return json(result, result.ok ? 200 : 400)
      }],
      ['/api/dsh-temp-session.trash-delete', ['POST'], async (request) => {
        await ensureReady()
        const { key } = queryOf(request)
        const dir = trashEntryDir(key)
        if (dir.length === 0) return json({ ok: false, error: 'invalid trash key' }, 400)
        try {
          await rm(dir, { recursive: true, force: true, maxRetries: 2 })
        } catch (error) {
          return json({ ok: false, error: `delete failed: ${error && error.message}` }, 500)
        }
        return json({ ok: true })
      }],
      ['/api/dsh-temp-session.trash-empty', ['POST'], async () => {
        await ensureReady()
        let removed = 0
        let failed = 0
        for (const entry of trashEntriesSync()) {
          try {
            // A concurrent trash-delete / restore may have taken the directory
            // between the listing and this call. Without the check that counted
            // as a successful removal and inflated "emptied N".
            if (!existsSync(entry.dir)) continue
            await rm(entry.dir, { recursive: true, force: true, maxRetries: 2 })
            removed += 1
          } catch (error) {
            // 0.8.1: a half-emptied trash used to report a plain success, so a
            // locked file left an entry the user believed was gone.
            void error
            failed += 1
          }
        }
        return json({ ok: true, removed, failed })
      }],
    ]

    let registered = 0
    for (const [path, methods, handler] of routes) {
      try {
        const connection = typeof hostCtx?.get === 'function' ? hostCtx.get('connection') : null
        const registry = connection && connection.fetch
        if (!registry || typeof registry.register !== 'function') {
          state.routes.errors.push(`${path}: connection.fetch unavailable`)
          // 1.0.0 M1: service missing is a degraded host, not an exception.
          // register() still returns 0 and every other subsystem keeps going.
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
        const message = String((error && error.message) || error)
        // Re-applying the plugin must not fail the batch: an already mounted
        // route is a success, not an error.
        if (/already registered/i.test(message)) {
          // A previous apply already mounted it; the path is still live.
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
    status,
    probe,
    ensureReady,
    purgeAll,
    purgeSync,
    purgeOnExit,
    track,
    untrack,
    keepAll,
    removeOne,
    saveConfig,
    publicConfig,
    configStamp,
    refreshConfigIfChanged,
    configPath,
    legacyConfigPath,
    ensureConfigFile,
    computeNextRun,
    schedulerTick,
    startScheduler,
    stopScheduler,
    restartScheduler,
    bindSchedulerEffect,
  }
}
