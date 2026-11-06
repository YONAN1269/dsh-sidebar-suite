// dsh-sidebar-suite — Host half.
//
// Ships only the option schema. Every layout rule lives in the Client half, so
// this module has no runtime dependencies of its own: `@deepseek-ai/schemastery`
// is resolved the way the host resolves it (bare specifier first, then the
// profile's own node_modules), and when neither works the plugin still loads
// without a schema instead of failing the whole plugin tree.
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Values the Client half falls back to when a field is absent. */
const DEFAULTS = {
  mode: 'b',
  showQuickSwitch: true,
  tab: 'ext',
  foldExt: false,
  foldWs: false,
}

/**
 * Resolve the schema library without making the module import depend on it.
 *
 * A plugin installed from a local directory is linked into the profile, so the
 * host usually resolves a bare specifier through the profile's node_modules. If
 * the loader realpaths that link, a bare specifier fails; the profile directory
 * itself is then the second attempt, and the directories around this file and
 * the running process are the last resort. When nothing resolves, the plugin
 * still loads, just without a settings schema.
 */
function looksLikeSchema(value) {
  return typeof value === 'function' || typeof value?.object === 'function'
}

async function tryBare() {
  try {
    const mod = await import('@deepseek-ai/schemastery')
    const schema = mod && (mod.default || mod)
    return looksLikeSchema(schema) ? schema : null
  } catch (error) {
    void error
    return null
  }
}

/** Directories whose `node_modules` may hold the profile's schema copy. */
function candidateBases() {
  const bases = []
  const push = (dir) => {
    if (typeof dir === 'string' && dir.length > 0 && !bases.includes(dir)) bases.push(dir)
  }

  const climb = (start, levels) => {
    let dir = start
    for (let i = 0; i < levels && dir; i += 1) {
      push(dir)
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  push(process.env.DSH_PROFILE_DIR)
  climb(dirname(fileURLToPath(import.meta.url)), 8)
  climb(process.cwd(), 8)

  const homes = [process.env.DSH_HOME, process.env.USERPROFILE, process.env.HOME].filter(Boolean)
  for (const home of homes) {
    const profiles = join(home, '.dsh', 'profiles')
    try {
      for (const name of readdirSync(profiles)) push(join(profiles, name))
    } catch (error) {
      void error
    }
    const direct = join(home, 'profiles')
    try {
      for (const name of readdirSync(direct)) push(join(direct, name))
    } catch (error) {
      void error
    }
  }
  return bases
}

async function loadSchema() {
  const bare = await tryBare()
  if (bare) return bare

  for (const base of candidateBases()) {
    const packageDir = join(base, 'node_modules', '@deepseek-ai', 'schemastery')
    const entry = join(packageDir, 'lib', 'index.mjs')
    if (!existsSync(entry)) continue

    // require() follows the package's own `exports` map, so this keeps working
    // when the library layout changes between versions.
    try {
      const require = createRequire(join(base, 'package.json'))
      const schema = require('@deepseek-ai/schemastery')
      if (looksLikeSchema(schema)) return schema
    } catch (error) {
      void error
    }
    try {
      const mod = await import(pathToFileURL(entry).href)
      const schema = mod && (mod.default || mod)
      if (looksLikeSchema(schema)) return schema
    } catch (error) {
      void error
    }
  }
  return null
}

const schema = await loadSchema()

/**
 * Volatile fields are the ones the settings page can change without restarting
 * this plugin: the host re-applies them in place and the Client half reads the
 * new values through its config form.
 */
export const Config = schema === null
  ? undefined
  : schema.object({
    mode: schema
      .union(['a', 'b', 'c'])
      .default(DEFAULTS.mode)
      .description('Sidebar layout: a folds each group, b switches the two groups with tabs, c keeps the workspaces and opens the panels as an overlay.')
      .volatile(),
    showQuickSwitch: schema
      .boolean()
      .default(DEFAULTS.showQuickSwitch)
      .description('Show the button that cycles through the three layouts in the sidebar control bar.')
      .volatile(),
    tab: schema
      .union(['ext', 'ws'])
      .default(DEFAULTS.tab)
      .description('Which group the tabbed layout shows first.')
      .volatile(),
    foldExt: schema
      .boolean()
      .default(DEFAULTS.foldExt)
      .description('Folded layout: whether the panels group starts folded.')
      .volatile(),
    foldWs: schema
      .boolean()
      .default(DEFAULTS.foldWs)
      .description('Folded layout: whether the workspaces group starts folded.')
      .volatile(),
  })

export function apply(ctx) {
  try {
    ctx.logger?.debug?.('[dsh-sidebar-suite] host half ready')
  } catch (error) {
    void error
  }
}
