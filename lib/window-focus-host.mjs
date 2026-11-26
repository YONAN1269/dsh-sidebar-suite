/**
 * Window focus host (1.1.3, Windows only).
 *
 * DSH is an Electron app, and its preload exposes no API to show, restore or
 * focus the main window. When another full-screen app covers DSH, the window is
 * alive but unreachable without Alt-Tab. A plugin running in the renderer cannot
 * call Win32, so this host route does the one thing a renderer cannot: find the
 * app process that owns this host, restore its main window and bring it to the
 * foreground.
 *
 * The route is deliberately tiny and parameter-free. The target PID comes from
 * `process.ppid` (walking a few ancestors if the immediate parent is not the
 * GUI process), never from the request, so the endpoint cannot be used to focus
 * an arbitrary window.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const ROUTE = '/api/dsh-sidebar-suite.focus-window'
const SCRIPT_TIMEOUT_MS = 8000

function json(body, code = 200) {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function errorMessage(error) {
  return String((error && error.message) || error || 'unknown error')
}

/**
 * PowerShell is invoked with an argument array (not a command string), so the
 * PID is the only value interpolated into the script and it is always an
 * integer. No request body or user text reaches the shell.
 */
export function focusScript(startPid) {
  const pid = Number.isInteger(startPid) && startPid > 0 ? startPid : 0
  return `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DshFocusWindow {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);

  // Process.MainWindowHandle can be 0 when Electron puts its window on a
  // different thread/owner or when the process has several top-level windows.
  // Enumerate visible top-level windows for the PID and match the app title
  // instead of trusting that one cached property.
  public static IntPtr FindMainWindow(int pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      int owner;
      GetWindowThreadProcessId(hWnd, out owner);
      if (owner != pid) return true;
      StringBuilder title = new StringBuilder(256);
      GetWindowText(hWnd, title, 256);
      if (title.ToString().IndexOf("DeepSeek Harness", StringComparison.OrdinalIgnoreCase) >= 0) {
        found = hWnd;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
$depth = 0
$hwnd = [IntPtr]::Zero
while ($null -ne $p -and $hwnd -eq [IntPtr]::Zero -and $depth -lt 5) {
  if ($p.MainWindowHandle -ne 0) { $hwnd = $p.MainWindowHandle }
  else { $hwnd = [DshFocusWindow]::FindMainWindow($p.Id) }
  if ($hwnd -eq [IntPtr]::Zero) {
    $parentId = 0
    try {
      $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)").ParentProcessId
    } catch { $parentId = 0 }
    if (-not $parentId) { break }
    $p = Get-Process -Id $parentId -ErrorAction SilentlyContinue
    $depth++
  }
}
if ($null -eq $p) {
  Write-Output '{"ok":false,"reason":"process-not-found"}'
  exit 2
}
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Output '{"ok":false,"reason":"no-main-window"}'
  exit 3
}
if ([DshFocusWindow]::IsIconic($hwnd) -or -not [DshFocusWindow]::IsWindowVisible($hwnd)) {
  # ShowWindowAsync is the one that reliably un-hides an Electron window
  # owned by another process; the synchronous ShowWindow can report success
  # on the call and leave the window hidden.
  [void][DshFocusWindow]::ShowWindowAsync($hwnd, 9)
} else {
  [void][DshFocusWindow]::ShowWindowAsync($hwnd, 5)
}
[void][DshFocusWindow]::SetForegroundWindow($hwnd)
try {
  $shell = New-Object -ComObject WScript.Shell
  $activated = $shell.AppActivate($p.Id)
} catch { $activated = $false }
if ($activated) {
  Write-Output ('{"ok":true,"pid":' + $p.Id + ',"window":' + $hwnd + '}')
  exit 0
}
Write-Output ('{"ok":false,"reason":"foreground-refused","pid":' + $p.Id + ',"window":' + $hwnd + '}')
exit 4
`
}

export function createWindowFocusHost(initialCtx, options) {
  const opts = options && typeof options === 'object' ? options : {}
  let hostCtx = initialCtx || null
  const platform = typeof opts.platform === 'string' ? opts.platform : process.platform
  const focusImpl = typeof opts.focusImpl === 'function' ? opts.focusImpl : null

  const state = {
    routes: { registered: 0, paths: [], errors: [] },
    degraded: null,
    attempts: 0,
    lastResult: null,
  }

  function setContext(next) {
    if (!next) return
    hostCtx = next
  }

  function parseOutput(stdout) {
    const text = String(stdout || '').trim()
    if (!text) return null
    try {
      return JSON.parse(text.split(/\r?\n/).filter(Boolean).pop())
    } catch (error) {
      void error
      return null
    }
  }

  async function focusWindow() {
    state.attempts += 1
    if (platform !== 'win32') {
      const result = { ok: false, unsupported: true, reason: 'windows-only' }
      state.lastResult = result
      return result
    }
    if (focusImpl) {
      const result = await focusImpl()
      state.lastResult = result
      return result
    }
    try {
      const { stdout, stderr } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command', focusScript(process.ppid),
      ], { timeout: SCRIPT_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 })
      const parsed = parseOutput(stdout)
      if (parsed && typeof parsed === 'object') {
        state.lastResult = parsed
        return parsed
      }
      const result = {
        ok: false,
        reason: 'unexpected-output',
        detail: String(stderr || stdout || '').trim().slice(0, 160),
      }
      state.lastResult = result
      return result
    } catch (error) {
      // A non-zero exit from the script still carries its JSON verdict on
      // stdout; prefer that over the generic exec error.
      const parsedError = parseOutput(error && error.stdout)
      if (parsedError && typeof parsedError === 'object') {
        state.lastResult = parsedError
        return parsedError
      }
      const result = {
        ok: false,
        reason: error && error.killed ? 'timeout' : 'exec-failed',
        detail: errorMessage(error).slice(0, 160),
      }
      state.lastResult = result
      return result
    }
  }

  async function handle(request) {
    // The route takes no payload; POST is required so a page prefetch or a
    // link preview cannot steal focus as a side effect of a GET.
    void request
    const result = await focusWindow()
    try {
      hostCtx?.logger?.info?.(`[dsh-sidebar-suite] focus-window ${result && result.ok ? 'ok' : 'failed'}: ${result && result.reason ? result.reason : 'done'}`)
    } catch (error) {
      void error
    }
    return json(result, result.ok ? 200 : 503)
  }

  function register(ctx) {
    const target = ctx || hostCtx
    if (!target) return 0
    try {
      const connection = typeof target.get === 'function' ? target.get('connection') : null
      const registry = connection && connection.fetch
      if (!registry || typeof registry.register !== 'function') {
        state.degraded = 'connection.fetch unavailable'
        return 0
      }
      registry.register({
        path: ROUTE,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => handle(request),
      })
      state.routes.registered = 1
      state.routes.paths = [ROUTE]
      return 1
    } catch (error) {
      const message = errorMessage(error)
      if (/already registered/i.test(message)) {
        state.routes.registered = 1
        state.routes.paths = [ROUTE]
        return 1
      }
      state.routes.errors.push(`${ROUTE}: ${message}`)
      state.degraded = `route registration failed: ${message}`
      return 0
    }
  }

  return {
    register,
    setContext,
    focusWindow,
    state,
    routePath: ROUTE,
  }
}
