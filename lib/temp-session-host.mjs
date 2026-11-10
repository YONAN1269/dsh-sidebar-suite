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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, release as osRelease } from 'node:os'
import { dirname, join } from 'node:path'
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
  deleteOnExit: true,
  // Daily cleanup (0.2.2). Independent of deleteOnExit: a user who keeps DSH
  // open for days wants "delete at 03:00 every night", and a user who closes it
  // every evening wants "delete on quit". Both can be on at the same time.
  scheduleDelete: false,
  scheduleTime: '03:00', // HH:MM, local time
  maxKept: 20,
  found: false,
  error: '',
}

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
  routes: { registered: 0, errors: [] },
  contexts: [],
  storePath: '',
  lastPurge: null,
  lastError: '',
  bootPurged: false,
  hooks: false,
  scheduler: { timer: null, nextRunAt: null, lastRunAt: null, retryAt: null, busy: false },
}

// ---------------------------------------------------------------------------
// locations
// ---------------------------------------------------------------------------

/** DSH home: `$DSH_HOME` or `~/.dsh` (@deepseek-ai/dsh-home-paths rule). */
function dshHome() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  if (configured.length > 0) return configured
  return join(homedir(), '.dsh')
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
// config file (Notepad-editable, no source edits)
// ---------------------------------------------------------------------------

function configPath() {
  return join(PLUGIN_ROOT, 'temp-session-config.txt')
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
  deleteOnExit: { key: 'DELETE_ON_EXIT', text: (value) => (value ? 'on' : 'off') },
  scheduleDelete: { key: 'SCHEDULE_DELETE', text: (value) => (value ? 'on' : 'off') },
  scheduleTime: { key: 'SCHEDULE_TIME', text: (value) => String(value) },
  maxKept: { key: 'MAX_KEPT', text: (value) => String(value) },
}

const FIELD_BY_KEY = Object.create(null)
for (const field of Object.keys(CONFIG_KEYS)) FIELD_BY_KEY[CONFIG_KEYS[field].key] = field

function parseConfig() {
  const next = { ...DEFAULT_CONFIG }
  let raw = ''
  try {
    raw = readFileSync(configPath(), 'utf8')
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
  return next
}

/**
 * Persist the settings the detail page changed.
 *
 * Line-based on purpose: comments, blank lines and key order survive, so the
 * file stays readable in Notepad and nothing the user wrote by hand is lost.
 * Only values after `=` are replaced; keys that are missing get appended.
 */
function saveConfig(patch) {
  const next = { ...state.config }
  const input = patch && typeof patch === 'object' ? patch : {}
  if (typeof input.showButton === 'boolean') next.showButton = input.showButton
  if (input.inChatMode === 'show' || input.inChatMode === 'hide') next.inChatMode = input.inChatMode
  if (input.buttonStyle === 'own' || input.buttonStyle === 'pair') next.buttonStyle = input.buttonStyle
  if (typeof input.expandAllSessions === 'boolean') next.expandAllSessions = input.expandAllSessions
  if (typeof input.deleteOnExit === 'boolean') next.deleteOnExit = input.deleteOnExit
  if (typeof input.scheduleDelete === 'boolean') next.scheduleDelete = input.scheduleDelete
  const clock = normalizeClock(input.scheduleTime)
  if (clock) next.scheduleTime = clock
  const kept = Number.parseInt(input.maxKept, 10)
  if (Number.isFinite(kept) && kept > 0) next.maxKept = Math.min(kept, 200)

  let raw = ''
  let existing = false
  try {
    raw = readFileSync(configPath(), 'utf8')
    existing = true
  } catch (error) {
    void error
  }
  if (!existing) {
    raw = [
      '# 临时会话配置 · 用记事本改等号右边，保存后「完全退出并重开 DSH」才生效。',
      '# Temporary session settings. Edit values after =, then fully quit and reopen DSH.',
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
    writeFileSync(configPath(), lines.join(eol), 'utf8')
  } catch (error) {
    return { ok: false, error: `config write failed: ${error && error.message}` }
  }

  next.found = true
  next.error = ''
  state.config = next
  restartScheduler()
  return { ok: true, config: publicConfig() }
}

/** The subset the detail page reads back. */
function publicConfig() {
  return {
    showButton: state.config.showButton,
    inChatMode: state.config.inChatMode,
    buttonStyle: state.config.buttonStyle,
    expandAllSessions: state.config.expandAllSessions,
    deleteOnExit: state.config.deleteOnExit,
    scheduleDelete: state.config.scheduleDelete,
    scheduleTime: state.config.scheduleTime,
    maxKept: state.config.maxKept,
    configFile: configPath(),
    found: state.config.found,
  }
}

// ---------------------------------------------------------------------------
// tracking store
// ---------------------------------------------------------------------------

function normalizeId(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 128) return ''
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : ''
}

async function loadStore() {
  state.storePath = storePath()
  try {
    const raw = await readFile(state.storePath, 'utf8')
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.sessions) ? parsed.sessions : []
    state.tracked = list.map(normalizeId).filter(Boolean)
  } catch (error) {
    if (error && error.code !== 'ENOENT') state.lastError = `store read failed: ${error.message}`
    state.tracked = []
  }
}

async function saveStore() {
  const path = state.storePath || storePath()
  state.storePath = path
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify({ version: 1, sessions: state.tracked }, null, 2), 'utf8')
  } catch (error) {
    state.lastError = `store write failed: ${error && error.message}`
  }
}

// ---------------------------------------------------------------------------
// deletion
// ---------------------------------------------------------------------------

/** Every `<sessions>/<workspace>/<id>` directory that exists right now. */
function sessionDirsSync(sessionId) {
  const root = sessionsRoot()
  const found = []
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(root, entry.name, sessionId)
      if (existsSync(candidate)) found.push(candidate)
    }
  } catch (error) {
    void error
  }
  return found
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

function removeSessionSync(sessionId) {
  let removed = 0
  for (const dir of sessionDirsSync(sessionId)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 2 })
      removed += 1
    } catch (error) {
      state.lastError = `delete ${sessionId} failed: ${error && error.message}`
    }
  }
  try {
    rmSync(projectionCacheFile(sessionId), { force: true })
  } catch (error) {
    void error
  }
  return removed
}

async function removeSession(sessionId) {
  let removed = 0
  const root = sessionsRoot()
  let entries = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    void error
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const target = join(root, entry.name, sessionId)
    if (!existsSync(target)) continue
    try {
      await rm(target, { recursive: true, force: true, maxRetries: 2 })
      removed += 1
    } catch (error) {
      state.lastError = `delete ${sessionId} failed: ${error && error.message}`
    }
  }
  try {
    await rm(projectionCacheFile(sessionId), { force: true })
  } catch (error) {
    void error
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
        await registry.archiveSession(sessionId, { stopActivity: true })
        return true
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
  }
  const kept = []
  for (const id of ids) {
    if (skipActiveMs > 0 && sessionActiveWithin(id, skipActiveMs)) {
      report.skipped += 1
      kept.push(id)
      continue
    }
    let removed = 0
    try {
      removed = await removeSession(id)
    } catch (error) {
      void error
    }
    if (removed > 0 && sessionDirsSync(id).length === 0) {
      report.removed += 1
      continue
    }
    // The directory survived (locked file, permission). Hide it so the sidebar
    // does not show a "temporary" chat that outlives its promise, and retry the
    // delete on the next launch.
    const hidden = await hideSession(id)
    if (hidden) report.hidden += 1
    report.failed.push(id)
    kept.push(id)
  }
  state.tracked = kept
  await saveStore()
  state.lastPurge = report
  return report
}

/** Delete every tracked session synchronously — the quit path has no `await`. */
function purgeSync(reason) {
  if (state.tracked.length === 0) return { reason, tried: 0, removed: 0, kept: [] }
  const ids = state.tracked.slice()
  const kept = []
  let removed = 0
  for (const id of ids) {
    const count = removeSessionSync(id)
    if (count > 0 && sessionDirsSync(id).length === 0) removed += 1
    else kept.push(id)
  }
  state.tracked = kept
  // Best effort: the process is going away, so this write often loses the race.
  try {
    const path = state.storePath || storePath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ version: 1, sessions: kept }, null, 2))
  } catch (error) {
    void error
  }
  state.lastPurge = { reason, at: new Date().toISOString(), tried: ids.length, removed, kept }
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
    if (state.config.deleteOnExit && !state.bootPurged) {
      state.bootPurged = true
      if (state.tracked.length > 0) await purgeAll('startup')
    }
  })().catch((error) => {
    state.lastError = `startup failed: ${error && error.message}`
  })
  return readyTask
}

/** Register the quit hook once per process. */
function installExitHook() {
  if (state.hooks) return
  state.hooks = true
  try {
    process.once('exit', () => {
      try {
        purgeSync('process-exit')
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
    try { clearInterval(state.scheduler.timer) } catch (error) { void error }
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
  const scheduler = state.scheduler
  if (scheduler.busy || !state.config.scheduleDelete) return
  const now = Date.now()
  const dueNext = !!(scheduler.nextRunAt && now >= scheduler.nextRunAt.getTime())
  const dueRetry = !!(scheduler.retryAt && now >= scheduler.retryAt.getTime())
  if (!dueNext && !dueRetry) return

  scheduler.busy = true
  try {
    await ensureReady()
    const report = await purgeAll(dueNext ? 'scheduled' : 'scheduled-retry', { skipActiveMs: ACTIVE_WINDOW_MS })
    scheduler.lastRunAt = report.at
    scheduler.retryAt = report.skipped > 0 || report.failed.length > 0
      ? new Date(Date.now() + RETRY_DELAY_MS)
      : null
    if (dueNext) scheduler.nextRunAt = computeNextRun(state.config.scheduleTime)
  } catch (error) {
    state.lastError = `scheduled cleanup failed: ${error && error.message}`
  } finally {
    scheduler.busy = false
  }
}

function startScheduler() {
  stopScheduler()
  if (!state.config.scheduleDelete) return
  state.scheduler.nextRunAt = computeNextRun(state.config.scheduleTime)
  try {
    const timer = setInterval(schedulerTick, TICK_MS)
    // A cleanup timer must never be the reason the host process stays alive.
    if (timer && typeof timer.unref === 'function') timer.unref()
    state.scheduler.timer = timer
  } catch (error) {
    state.lastError = `scheduler start failed: ${error && error.message}`
  }
}

/** Re-read the target after a settings change; also used at boot. */
function restartScheduler() {
  startScheduler()
}

function schedulerStatus() {
  return {
    enabled: state.config.scheduleDelete,
    at: state.config.scheduleTime,
    nextRunAt: state.scheduler.nextRunAt ? state.scheduler.nextRunAt.toISOString() : null,
    lastRunAt: state.scheduler.lastRunAt,
    retryAt: state.scheduler.retryAt ? state.scheduler.retryAt.toISOString() : null,
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
  if (!state.tracked.includes(id)) state.tracked.push(id)
  // Oldest first: trimming keeps the newest MAX_KEPT entries.
  if (state.tracked.length > state.config.maxKept) {
    const overflow = state.tracked.length - state.config.maxKept
    const dropped = state.tracked.splice(0, overflow)
    for (const old of dropped) {
      try {
        await removeSession(old)
      } catch (error) {
        void error
      }
    }
  }
  await saveStore()
  return { ok: true, ids: state.tracked.slice(), count: state.tracked.length }
}

async function untrack(sessionId) {
  await ensureReady()
  const id = normalizeId(sessionId)
  if (id.length === 0) return { ok: false, error: 'invalid session id' }
  state.tracked = state.tracked.filter((item) => item !== id)
  await saveStore()
  return { ok: true, ids: state.tracked.slice(), count: state.tracked.length }
}

function status() {
  return {
    ok: true,
    showButton: state.config.showButton,
    chatModePolicy: state.config.inChatMode,
    buttonStyle: state.config.buttonStyle,
    expandAllSessions: state.config.expandAllSessions,
    deleteOnExit: state.config.deleteOnExit,
    scheduleDelete: state.config.scheduleDelete,
    scheduleTime: state.config.scheduleTime,
    schedule: schedulerStatus(),
    tempCount: state.tracked.length,
    config: { found: state.config.found, error: state.config.error || undefined },
    routes: { registered: state.routes.registered, errors: state.routes.errors.slice(0, 4) },
    lastPurge: state.lastPurge,
    lastError: state.lastError || undefined,
    // Everything a feedback report needs to be diagnosable without a second
    // round-trip. `DSH_CLIENT_VERSION` is set by the desktop main process for
    // the host child (verified in app.asar lib/main.js: DesktopBackendController
    // spawns the host with `DSH_CLIENT_VERSION: desktopClientVersion()`).
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
  return {
    ok: true,
    mode: 'native-session',
    dshHome: dshHome(),
    sessionsRoot: sessionsRoot(),
    storePath: state.storePath || storePath(),
    configFile: configPath(),
    tracked: state.tracked.slice(),
    config: state.config,
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
    return { sessionId: normalizeId(url.searchParams.get('sessionId') || '') }
  } catch (error) {
    void error
    return { sessionId: '' }
  }
}

export function createTempSessionHost(initialCtx) {
  if (initialCtx) state.contexts.push(initialCtx)

  /** Keep every context the plugin is applied to: services differ per scope. */
  function setContext(next) {
    if (!next) return
    if (!state.contexts.includes(next)) state.contexts.push(next)
  }

  function register(hostCtx) {
    setContext(hostCtx)
    state.config = parseConfig()
    installExitHook()
    // Boot the daily cleanup from whatever the file says; a stale timer from a
    // previous apply is replaced, never duplicated.
    restartScheduler()

    // Boot pass: anything still tracked was created in a previous run and must
    // not survive it. `ensureReady()` runs it once and every route waits on it.
    ensureReady()

    const routes = [
      ['/api/dsh-temp-session.status', ['GET'], async () => { await ensureReady(); return json(status()) }],
      ['/api/dsh-temp-session.list', ['GET'], async () => {
        await ensureReady()
        return json({ ok: true, ids: state.tracked.slice(), count: state.tracked.length })
      }],
      ['/api/dsh-temp-session.config', ['GET', 'POST'], async (request) => {
        await ensureReady()
        const method = request && request.method ? String(request.method).toUpperCase() : 'GET'
        if (method !== 'POST') return json({ ok: true, ...publicConfig() })
        let patch = null
        try {
          const raw = await request.text()
          patch = raw && raw.trim().length > 0 ? JSON.parse(raw) : {}
        } catch (error) {
          void error
          return json({ ok: false, error: 'invalid JSON body' }, 400)
        }
        const result = saveConfig(patch)
        if (!result.ok) return json(result, 500)
        return json({ ok: true, ...result.config, schedule: schedulerStatus() })
      }],
      ['/api/dsh-temp-session.track', ['POST', 'GET'], async (request) => {
        const { sessionId } = queryOf(request)
        if (sessionId.length === 0) return json({ ok: false, error: 'sessionId required' }, 400)
        return json(await track(sessionId))
      }],
      ['/api/dsh-temp-session.untrack', ['POST', 'GET'], async (request) => {
        const { sessionId } = queryOf(request)
        if (sessionId.length === 0) return json({ ok: false, error: 'sessionId required' }, 400)
        return json(await untrack(sessionId))
      }],
      ['/api/dsh-temp-session.purge', ['POST', 'GET'], async () => {
        await ensureReady()
        return json({ ok: true, ...(await purgeAll('manual')) })
      }],
      ['/api/dsh-temp-session.probe', ['GET'], () => json(probe())],
    ]

    let registered = 0
    for (const [path, methods, handler] of routes) {
      try {
        const connection = typeof hostCtx?.get === 'function' ? hostCtx.get('connection') : null
        const registry = connection && connection.fetch
        if (!registry || typeof registry.register !== 'function') {
          state.routes.errors.push(`${path}: connection.fetch unavailable`)
          continue
        }
        registry.register({
          path,
          methods,
          requestBody: 'buffered',
          fetch: (request) => handler(request),
        })
        registered += 1
      } catch (error) {
        const message = String((error && error.message) || error)
        // Re-applying the plugin must not fail the batch: an already mounted
        // route is a success, not an error.
        if (/already registered/i.test(message)) registered += 1
        else state.routes.errors.push(`${path}: ${message}`)
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
    purgeAll,
    purgeSync,
    track,
    untrack,
    saveConfig,
    publicConfig,
    computeNextRun,
    schedulerTick,
    startScheduler,
    restartScheduler,
  }
}
