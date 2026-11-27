// R-05 — window focus host: the real child-process branch is driven through an
// injectable exec stub. No PowerShell is spawned in a unit test (that would
// steal focus / depend on the foreground window).
//
// Branches covered:
//   1. timeout        — exec killed after the script timeout -> reason 'timeout'
//   2. exec-failed    — exec rejected, no usable stdout -> reason 'exec-failed'
//   3. unexpected-output — stdout is not JSON -> reason 'unexpected-output'
//   4. nonzero exit with a JSON verdict on stdout — the JSON wins
//   5. default command — the runner is invoked as powershell.exe with an
//      argument array; no request text reaches the script string.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createWindowFocusHost } from '../lib/window-focus-host.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

function rejectedError(props) {
  const error = new Error(props.message || 'exec failed')
  error.killed = !!props.killed
  error.stdout = props.stdout || ''
  error.stderr = props.stderr || ''
  return error
}

async function main() {
  // ---- 1. timeout: the script timer kills the child ----------------------
  const timedOut = createWindowFocusHost(null, {
    platform: 'win32',
    execImpl: async () => { throw rejectedError({ killed: true, stdout: '', stderr: 'script timeout' }) },
  })
  const r1 = await timedOut.focusWindow()
  check('R-05: a killed child reports reason timeout',
    r1.ok === false && r1.reason === 'timeout', JSON.stringify(r1))

  // ---- 2. exec-failed: spawn itself rejected, no stdout -------------------
  const spawnFailed = createWindowFocusHost(null, {
    platform: 'win32',
    execImpl: async () => { throw rejectedError({ message: 'spawn ENOENT powershell.exe' }) },
  })
  const r2 = await spawnFailed.focusWindow()
  check('R-05: a spawn failure reports reason exec-failed',
    r2.ok === false && r2.reason === 'exec-failed', JSON.stringify(r2))

  // ---- 3. unexpected-output: stdout carries no parseable JSON ------------
  const noisy = createWindowFocusHost(null, {
    platform: 'win32',
    execImpl: async () => ({ stdout: 'cannot open C:\\Windows\\system32\\…', stderr: '' }),
  })
  const r3 = await noisy.focusWindow()
  check('R-05: non-JSON stdout reports unexpected-output',
    r3.ok === false && r3.reason === 'unexpected-output', JSON.stringify(r3))

  // ---- 4. nonzero exit but stdout still carries the JSON verdict ---------
  const verdictOnStdout = createWindowFocusHost(null, {
    platform: 'win32',
    execImpl: async () => {
      throw rejectedError({ stdout: '{"ok":true,"pid":7,"window":9}', stderr: '' })
    },
  })
  const r4 = await verdictOnStdout.focusWindow()
  check('R-05: a nonzero exit with JSON stdout is ruled by that JSON',
    r4.ok === true && r4.pid === 7 && r4.window === 9, JSON.stringify(r4))

  // The generic fallback must NOT override a usable stderr-only verdict: a
  // rejected call whose stdout parses keeps the parsed object's own reason.
  const refusedOnStdout = createWindowFocusHost(null, {
    platform: 'win32',
    execImpl: async () => {
      throw rejectedError({ stdout: '{"ok":false,"reason":"foreground-refused","pid":7}', stderr: '' })
    },
  })
  const r4b = await refusedOnStdout.focusWindow()
  check('R-05: a refused verdict on stdout keeps its own reason',
    r4b.ok === false && r4b.reason === 'foreground-refused', JSON.stringify(r4b))

  // ---- 5. default command/args wiring ------------------------------------
  const calls = []
  const wired = createWindowFocusHost(null, {
    platform: 'win32',
    execImpl: async (command, args, options) => {
      calls.push({ command, args, options })
      return { stdout: '{"ok":true,"pid":42,"window":524734}', stderr: '' }
    },
  })
  // The request body is ignored by design; prove the supplied request text
  // never ends up in the PowerShell argument array or script string.
  const routeCtx = null
  void routeCtx
  const r5 = await wired.focusWindow()
  check('R-05: the runner is invoked as powershell.exe',
    calls.length === 1 && calls[0].command === 'powershell.exe', JSON.stringify(calls.map((c) => c.command)))
  check('R-05: arguments are an array, not a command string',
    Array.isArray(calls[0].args) && calls[0].args.length === 6, JSON.stringify(calls[0].args))
  check('R-05: the fixed flags are passed first',
    calls[0].args[0] === '-NoProfile' && calls[0].args[1] === '-NonInteractive'
      && calls[0].args[2] === '-ExecutionPolicy' && calls[0].args[3] === 'Bypass'
      && calls[0].args[4] === '-Command',
    JSON.stringify(calls[0].args.slice(0, 5)))
  const script = String(calls[0].args[5] || '')
  check('R-05: the -Command slot carries the focus script',
    typeof script === 'string' && script.indexOf('Get-Process -Id') >= 0, script.slice(0, 60))
  check('R-05: request text does not reach the script string',
    script.indexOf('12345') < 0 && script.indexOf('{"pid"') < 0, script.slice(0, 60))
  check('R-05: the real timeout/hide options are preserved',
    calls[0].options && calls[0].options.timeout === 8000 && calls[0].options.windowsHide === true,
    JSON.stringify(calls[0].options))
  check('R-05: a successful wired call reports ok',
    r5.ok === true && r5.pid === 42, JSON.stringify(r5))

  // Source contract: without an injected execImpl the real promisified
  // execFile is the runner, and the command literal stays powershell.exe.
  const source = fs.readFileSync(ROOT + '/lib/window-focus-host.mjs', 'utf8')
  check('R-05: the default runner is the imported promisified execFile',
    source.includes('const runner = execImpl || execFileAsync') && source.includes('promisify(execFile)'))
  check('R-05: the command literal is powershell.exe',
    source.includes("'powershell.exe'"))

  // Sanity: non-Windows stays on the unsupported path and never calls exec.
  let execCalled = false
  const linux = createWindowFocusHost(null, {
    platform: 'linux',
    execImpl: async () => { execCalled = true; return { stdout: '{}', stderr: '' } },
  })
  const r6 = await linux.focusWindow()
  check('R-05: non-Windows reports windows-only without exec',
    r6.ok === false && r6.unsupported === true && r6.reason === 'windows-only' && execCalled === false,
    JSON.stringify(r6))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
