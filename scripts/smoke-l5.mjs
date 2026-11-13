#!/usr/bin/env node
// 发布前冒烟：复刻 dsh.so 的 L5（装得上 → 起得来 → 有响应）。
// 用独立的临时 DSH_HOME，不碰你正在用的 ~/.dsh。
//
//   node scripts/smoke-l5.mjs                          测当前目录（未发布代码）
//   node scripts/smoke-l5.mjs dsh-sidebar-suite@0.5.1  测 npm 上的某个版本
//   node scripts/smoke-l5.mjs --keep                   保留临时目录便于排查
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const WIN = process.platform === 'win32'

const opts = {
  spec: '',
  cli: '',
  keep: false,
  installTimeout: 240,
  bootTimeout: 90,
  httpTimeout: 20,
}

for (let i = 0; i < process.argv.length - 2; i++) {
  const raw = process.argv.slice(2)
  const a = raw[i]
  if (a === '--keep') opts.keep = true
  else if (a === '--cli') opts.cli = raw[++i] || ''
  else if (a === '--install-timeout') opts.installTimeout = Number(raw[++i]) || 240
  else if (a === '--boot-timeout') opts.bootTimeout = Number(raw[++i]) || 90
  else if (a === '--http-timeout') opts.httpTimeout = Number(raw[++i]) || 20
  else if (a === '-h' || a === '--help') { usage(); process.exit(0) }
  else if (!a.startsWith('-')) opts.spec = a
}

function usage() {
  console.log(`用法: node scripts/smoke-l5.mjs [包规格] [选项]

  包规格        省略则测当前目录（用 pnpm link 方式装入，不要求已发布）
               也可以写 npm 上已发布的，如 dsh-sidebar-suite@0.5.1
  --cli <路径>  指定 dsh 启动器（dsh.cmd 或安装目录），默认自动探测
  --keep        跑完不删临时 DSH_HOME
  --install-timeout <秒>  安装超时，默认 240
  --boot-timeout <秒>     启动到打印 URL 的超时，默认 90
  --http-timeout <秒>     HTTP 探测超时，默认 20`)
}

function fail(msg) {
  console.error(`\n[致命] ${msg}`)
  process.exit(2)
}

// ---- 定位 dsh 启动器 ----
// dsh.cmd 内部是： "<目录>\..\..\..\..\DeepSeek Harness.exe" --expose-internals "<目录>\..\..\..\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" %*
// 直接调 exe + 参数数组，避免 cmd 对中文路径 / 引号的破坏。
function launcherFromCmd(cmdPath) {
  let body = ''
  try {
    body = readFileSync(cmdPath, 'utf8')
  } catch {
    return null
  }
  if (!/~dp0/i.test(body)) return null
  const dir = dirname(cmdPath)
  const exeMatch = body.match(/"([^"]*?\.exe)"/i)
  const cliMatch = body.match(/"([^"]*?cli\.js)"/i)
  if (!exeMatch || !cliMatch) return null
  // %~dp0 是「带尾分隔符的脚本目录」；dirname() 返回的没有尾分隔符，必须补上，
  // 否则 "…\bin" + "..\.." 会粘成 "…\bin..\.."。
  const base = /[\\/]$/.test(dir) ? dir : dir + '/'
  const expand = (p) => resolve(p.replace(/%~dp0/gi, base).replace(/\\/g, '/'))
  const exe = expand(exeMatch[1])
  const cliJs = expand(cliMatch[1])
  if (!existsSync(exe)) return null
  // cli.js 通常在 app.asar 归档内部，Node 的 existsSync 看不到归档里的条目，
  // 所以只校验宿主 exe 与 asar 本体（或 unpacked 的真实文件）是否在。
  if (!isReachable(cliJs)) return null
  return { exe, prefix: ['--expose-internals', cliJs], label: exe }
}

function isReachable(cliJs) {
  if (existsSync(cliJs)) return true
  const idx = cliJs.toLowerCase().indexOf('app.asar')
  if (idx < 0) return false
  return existsSync(cliJs.slice(0, idx) + 'app.asar')
}

function findLauncher() {
  const tries = []
  if (opts.cli) tries.push(opts.cli)
  if (process.env.DSH_CLI) tries.push(process.env.DSH_CLI)

  for (const dir of (process.env.PATH || '').split(WIN ? ';' : ':')) {
    if (!dir) continue
    tries.push(join(dir, WIN ? 'dsh.cmd' : 'dsh'))
  }
  for (const guess of [
    'D:/program/harness/resources/runtime/cli/bin/dsh.cmd',
    'C:/Program Files/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd',
    join(process.env.LOCALAPPDATA || '', 'Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd'),
  ]) {
    if (guess) tries.push(guess)
  }

  for (const candidate of tries) {
    if (!candidate || !existsSync(candidate)) continue
    if (candidate.toLowerCase().endsWith('.exe')) {
      const cliJs = resolve(dirname(candidate), 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
      if (isReachable(cliJs)) return { exe: candidate, prefix: ['--expose-internals', cliJs], label: candidate }
      continue
    }
    if (statSync(candidate).isDirectory()) {
      const inner = join(candidate, 'resources/runtime/cli/bin/dsh.cmd')
      if (existsSync(inner)) {
        const l = launcherFromCmd(inner)
        if (l) return l
      }
      continue
    }
    const l = launcherFromCmd(candidate)
    if (l) return l
  }
  return null
}

// ---- 工具 ----
const t0 = Date.now()
const since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

function run(exe, args, env, timeoutMs) {
  return new Promise((resolveRun) => {
    const child = spawn(exe, args, { cwd: 'C:\\', env, windowsHide: true })
    let out = ''
    const collect = (buf) => { if (out.length < 400000) out += buf.toString('utf8') }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      killTree(child.pid)
      resolveRun({ code: 'timeout', out })
    }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); resolveRun({ code: 'spawn-error', out: String(e && e.message) }) })
    child.on('close', (code) => { clearTimeout(timer); resolveRun({ code, out }) })
  })
}

function killTree(pid) {
  if (!pid) return
  try {
    if (WIN) spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else process.kill(pid, 'SIGKILL')
  } catch {
    // 进程可能已经退了
  }
}

function tail(text, lines = 25) {
  return String(text || '').trimEnd().split('\n').slice(-lines).join('\n')
}

function latestPnpmLog(profileDir) {
  const base = join(profileDir, '.plugin-manager', 'logs')
  if (!existsSync(base)) return ''
  try {
    const dirs = readdirSync(base)
      .map((n) => ({ n, p: join(base, n), t: statSync(join(base, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    if (!dirs.length) return ''
    const log = join(dirs[0].p, 'pnpm.log')
    return existsSync(log) ? log : ''
  } catch {
    return ''
  }
}

const results = []
function record(step, name, ok, detail, extra = '') {
  results.push({ step, name, ok, detail, extra })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`[${step}] ${mark}  ${name}  ${detail}`)
  if (!ok && extra) console.log(indent(extra))
}
function indent(text) {
  return String(text).split('\n').map((l) => `      ${l}`).join('\n')
}

// ---- 主流程 ----
const launcher = findLauncher()
if (!launcher) {
  fail('找不到 dsh 启动器。用 --cli <dsh.cmd 或安装目录> 指定，或设置环境变量 DSH_CLI。')
}

const spec = opts.spec || ROOT
const home = join(tmpdir(), `dsh-smoke-${Date.now().toString(36)}`)
mkdirSync(home, { recursive: true })
const env = { ...process.env, DSH_HOME: home }
const profileDir = join(home, 'profiles', 'web')

console.log(`dsh 启动器  : ${launcher.label}`)
console.log(`工件        : ${spec}`)
console.log(`临时 DSH_HOME: ${home}\n`)

let exitCode = 0

// L5.1 安装
{
  const args = [...launcher.prefix, 'plugin', '--profile', 'web', 'add', spec]
  const r = await run(launcher.exe, args, env, opts.installTimeout * 1000)
  const ok = r.code === 0
  if (ok) {
    record('1/3', 'L5.1 沙盒安装', true, `(${since()})`)
  } else {
    const log = latestPnpmLog(profileDir)
    const detail = r.code === 'timeout' ? `超时 ${opts.installTimeout}s` : `退出码 ${r.code}`
    const extra = [
      tail(r.out),
      log ? `pnpm 日志: ${log}` : '',
    ].filter(Boolean).join('\n')
    record('1/3', 'L5.1 沙盒安装', false, `(${since()})`, extra)
    exitCode = 1
  }
}

// L5.2 启动 + L5.3 HTTP
if (exitCode === 0) {
  const args = [...launcher.prefix, '--profile', 'web', '--port', '0', '--no-open']
  const child = spawn(launcher.exe, args, { cwd: 'C:\\', env, windowsHide: true })
  let out = ''
  let url = ''
  const collect = (buf) => {
    const chunk = buf.toString('utf8')
    out += chunk
    if (!url) {
      const m = out.match(/https?:\/\/[^\s"']+:\d+[^\s"']*/)
      if (m) url = m[0]
    }
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  const deadline = Date.now() + opts.bootTimeout * 1000
  while (!url && Date.now() < deadline && child.exitCode === null) {
    await new Promise((r) => setTimeout(r, 200))
  }

  if (!url) {
    record('2/3', 'L5.2 启动就绪', false, `(${since()})`,
      `未在 ${opts.bootTimeout}s 内打印监听地址\n\n${tail(out)}`)
    exitCode = 1
  } else {
    record('2/3', 'L5.2 启动就绪', true, `(${since()})  ${url.replace(/token=[^&]+/, 'token=***')}`)

    let status = 0
    let lastErr = ''
    const httpDeadline = Date.now() + opts.httpTimeout * 1000
    while (Date.now() < httpDeadline) {
      try {
        const res = await fetch(url, { redirect: 'manual' })
        status = res.status
        if (status >= 200 && status < 400) break
        lastErr = `HTTP ${status}`
      } catch (e) {
        lastErr = String((e && e.message) || e)
      }
      await new Promise((r) => setTimeout(r, 400))
    }

    if (status >= 200 && status < 400) {
      record('3/3', 'L5.3 HTTP 响应', true, `(${since()})  HTTP ${status}`)
    } else {
      record('3/3', 'L5.3 HTTP 响应', false, `(${since()})  ${lastErr || '无响应'}`, tail(out))
      exitCode = 1
    }
  }

  killTree(child.pid)
  await new Promise((r) => setTimeout(r, 800))
}

// 清理
if (opts.keep || exitCode !== 0) {
  console.log(`\n临时目录已保留: ${home}`)
  const log = latestPnpmLog(profileDir)
  if (log) console.log(`pnpm 日志: ${log}`)
} else {
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 3 })
  } catch {
    console.log(`\n临时目录删除失败（可手动删）: ${home}`)
  }
}

const passed = results.filter((r) => r.ok).length
console.log(`\n${exitCode === 0 ? '结果：通过' : '结果：未通过'}  ${passed}/${results.length} 项，耗时 ${since()}`)
process.exit(exitCode)
