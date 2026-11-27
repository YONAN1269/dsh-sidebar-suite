// R-03 (TS-01) — Host half bootstrap: real `lib/index.js` dynamic import,
// fake ctx with a fake connection.fetch registry and a capturing logger.
//
// Asserts:
//   1. apply() mounts all 19 Host routes (temp-session 14, web-login 3,
//      focus-window 1, update-check 1).
//   2. An injected Host loader failure does not throw out of apply(); the other
//      Hosts still register and the degradation reason is recorded.
//
// Runs against a throwaway DSH_HOME; no real profile or credential store is
// touched.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const HOME = mkdtempSync(join(tmpdir(), 'dsbs-074-'))
process.env.DSH_HOME = HOME

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

const EXPECTED_ROUTES = [
  // temp-session host: 14
  '/api/dsh-temp-session.status',
  '/api/dsh-temp-session.list',
  '/api/dsh-temp-session.config',
  '/api/dsh-temp-session.track',
  '/api/dsh-temp-session.untrack',
  '/api/dsh-temp-session.keep-all',
  '/api/dsh-temp-session.remove',
  '/api/dsh-temp-session.purge',
  '/api/dsh-temp-session.probe',
  '/api/dsh-temp-session.paths',
  '/api/dsh-temp-session.trash',
  '/api/dsh-temp-session.trash-restore',
  '/api/dsh-temp-session.trash-delete',
  '/api/dsh-temp-session.trash-empty',
  // web-login host: 3
  '/api/dsh-sidebar-suite.web-login-load',
  '/api/dsh-sidebar-suite.web-login-save',
  '/api/dsh-sidebar-suite.web-login-clear',
  // focus-window host: 1
  '/api/dsh-sidebar-suite.focus-window',
  // update-check host: 1
  '/api/dsh-sidebar-suite.update-check',
]

function makeCtx() {
  const registered = []
  const logs = { debug: [], warn: [], info: [], error: [] }
  const ctx = {
    registered,
    get(name) {
      if (name !== 'connection') return null
      return {
        fetch: {
          register(spec) { registered.push(spec) },
        },
      }
    },
    logger: {
      debug: (...args) => logs.debug.push(args.map(String).join(' ')),
      warn: (...args) => logs.warn.push(args.map(String).join(' ')),
      info: (...args) => logs.info.push(args.map(String).join(' ')),
      error: (...args) => logs.error.push(args.map(String).join(' ')),
    },
  }
  return { ctx, registered, logs }
}

async function main() {
  const index = await import(pathToFileURL(ROOT + '/lib/index.js').href)

  // ---- scenario 1: real boot, every Host registers -----------------------
  const boot = makeCtx()
  let bootError = null
  try {
    await index.apply(boot.ctx)
  } catch (error) {
    bootError = error
  }
  check('R-03: apply() does not throw on the real boot', bootError === null, String(bootError && bootError.message))

  const bootPaths = boot.registered.map((spec) => spec.path)
  check('R-03: exactly 19 routes are mounted', boot.registered.length === 19, String(boot.registered.length))
  for (const expected of EXPECTED_ROUTES) {
    check('R-03: route mounted ' + expected, bootPaths.includes(expected), bootPaths.join(','))
  }

  const byPrefix = (paths, prefix) => paths.filter((p) => p.indexOf(prefix) === 0)
  check('R-03: temp-session host mounts 14 routes', byPrefix(bootPaths, '/api/dsh-temp-session.').length === 14,
    String(byPrefix(bootPaths, '/api/dsh-temp-session.').length))
  check('R-03: web-login host mounts 3 routes', byPrefix(bootPaths, '/api/dsh-sidebar-suite.web-login-').length === 3,
    String(byPrefix(bootPaths, '/api/dsh-sidebar-suite.web-login-').length))
  check('R-03: focus-window host mounts 1 route', byPrefix(bootPaths, '/api/dsh-sidebar-suite.focus-window').length === 1)
  check('R-03: update-check host mounts 1 route', byPrefix(bootPaths, '/api/dsh-sidebar-suite.update-check').length === 1)

  // ---- scenario 2: injected loader fails for the focus Host -------------
  // A repeated apply reuses the already-mounted Host instances by design; the
  // injected loader only decides which factory survives a fresh mount. The
  // assertions below pin the failure contract: apply() does not throw, the
  // remaining routes still land in this registry, and the reason is logged.
  const injected = makeCtx()
  const loader = async (spec) => {
    if (spec === './window-focus-host.mjs') throw new Error('injected focus failure')
    // Resolve the relative specifier against the plugin lib dir: a dynamic
    // import inside this test module would otherwise resolve to the test dir.
    return import(pathToFileURL(ROOT + '/lib/' + spec.slice(2)).href)
  }
  let injectedError = null
  try {
    await index.apply(injected.ctx, { loader })
  } catch (error) {
    injectedError = error
  }
  check('R-03: a Host loader failure does not throw out of apply()',
    injectedError === null, String(injectedError && injectedError.message))

  const injectedPaths = injected.registered.map((spec) => spec.path)
  check('R-03: the failed Host contributes no route',
    !injectedPaths.includes('/api/dsh-sidebar-suite.focus-window'), injectedPaths.join(','))
  check('R-03: the other three Hosts still register in this registry',
    injectedPaths.length === 18, String(injectedPaths.length))
  check('R-03: the failed Host records a degradation warning',
    injected.logs.warn.some((line) => line.indexOf('window-focus host') >= 0 && line.indexOf('injected focus failure') >= 0),
    injected.logs.warn.join(' | '))

  // ---- scenario 3: direct hosts snapshot with one null factory ----------
  const direct = makeCtx()
  const snapshot = {
    factories: { temp: null, webLogin: null, focus: null, update: null },
    errors: { focus: 'direct injected failure' },
  }
  let directError = null
  try {
    await index.apply(direct.ctx, { hosts: snapshot })
  } catch (error) {
    directError = error
  }
  check('R-03: a direct snapshot with null factories does not throw',
    directError === null, String(directError && directError.message))
  check('R-03: direct snapshot records the missing Host warning',
    direct.logs.warn.some((line) => line.indexOf('window-focus host') >= 0),
    direct.logs.warn.join(' | '))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(() => {
  // Detach the temp host's real exit quit hook before deleting the fixture dir.
  process.removeAllListeners('exit')
  try { rmSync(HOME, { recursive: true, force: true }) }
  catch (error) { console.error('CLEANUP_FAIL ' + HOME + ' ' + error.code + ' ' + error.message) }
})
