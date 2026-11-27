#!/usr/bin/env node
// 离线覆盖率度量（零依赖，不接进默认 `npm test`，单独运行）：
//
//   node scripts/coverage.mjs            跑全部 tests/test_*.mjs，汇总 lib/ 覆盖率
//   node scripts/coverage.mjs --quiet     子进程输出只在失败时打印
//
// 口径（务必连同数字一起读）：
//   * 数据来自 Node 内置 V8 覆盖率（NODE_V8_COVERAGE），按进程产出的 coverage
//     JSON 按文件合并；同一 range 在多个进程里取最大计数。
//   * 行覆盖率是「语句范围近似」：V8 给的是字符 range（startOffset/endOffset），
//     一个行只要被任一 count>0 的 range 命中就算覆盖；空白行/注释行也计入分母，
//     因此行覆盖率偏保守，不等于 Istanbul 那种可执行语句口径。
//   * 函数覆盖率：coverage JSON 里每个 function 条目算一个函数，任一一组
//     range count>0 即记为已覆盖；匿名/内联函数按 V8 上报的条目计数。
//   * 在 vm 沙箱里跑的 client.js 以裸文件名 'client.js' 上报，按 basename 归并；
//     ROOT 之外的真实磁盘路径（node_modules 依赖）即使同名也忽略，不混桶；
//     若某条目 URL 无法对应到 lib/ 下的目标文件，忽略并在结尾计数提示。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const TESTS_DIR = path.join(ROOT, 'tests')
const LIB_DIR = path.join(ROOT, 'lib')

const argv = process.argv.slice(2)
const quiet = argv.includes('--quiet') || argv.includes('-q')

const TARGETS = [
  'lib/index.js',
  'lib/client.js',
  'lib/temp-session-host.mjs',
  'lib/web-login-host.mjs',
  'lib/window-focus-host.mjs',
  'lib/update-host.mjs',
]

function listTests() {
  return fs.readdirSync(TESTS_DIR)
    .filter((name) => /^test_.*\.mjs$/.test(name))
    .sort()
}

// ---- run every suite under NODE_V8_COVERAGE -------------------------------

const covDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbs-coverage-'))

const failures = []
let totalPass = 0
let totalFail = 0

try {
  for (const name of listTests()) {
    const t0 = Date.now()
    const result = spawnSync(process.execPath, [path.join(TESTS_DIR, name)], {
      cwd: ROOT,
      env: { ...process.env, NODE_V8_COVERAGE: covDir },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    })
    const out = result.stdout || ''
    const err = result.stderr || ''
    const pass = (out.match(/^PASS /gm) || []).length
    const fail = (out.match(/^FAIL /gm) || []).length
    totalPass += pass
    totalFail += fail
    const ok = result.status === 0 && fail === 0
    if (!ok) failures.push({ name, status: result.status, out, err })
    if (!quiet || !ok) {
      if (out) process.stdout.write(out)
      if (err) process.stderr.write(err)
    }
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}  pass=${pass} fail=${fail} exit=${result.status} ${Date.now() - t0}ms`)
  }

  // ---- parse and merge the V8 coverage reports ----------------------------

  // relPath -> { ranges: Map<"start-end", maxCount>, functions: Map<"start-end", maxCount> }
  const merged = new Map(TARGETS.map((rel) => [rel, { ranges: new Map(), functions: new Map() }]))
  const byBasename = new Map(TARGETS.map((rel) => [path.basename(rel), rel]))
  let unmatched = 0

  const files = fs.readdirSync(covDir).filter((f) => f.indexOf('coverage-') === 0 && f.endsWith('.json'))
  for (const file of files) {
    let report
    try {
      report = JSON.parse(fs.readFileSync(path.join(covDir, file), 'utf8'))
    } catch (error) {
      continue
    }
    const entries = Array.isArray(report.result)
      ? report.result
      : (report.result && report.result.coverage) || report.coverage || []
    for (const entry of entries) {
      const rel = matchTarget(entry.url)
      if (!rel) { unmatched += 1; continue }
      const bucket = merged.get(rel)
      for (const fn of entry.functions || []) {
        let fnCovered = 0
        for (const range of fn.ranges || []) {
          const key = `${range.startOffset}-${range.endOffset}`
          const count = range.count || 0
          bucket.ranges.set(key, Math.max(bucket.ranges.get(key) || 0, count))
          if (count > 0) fnCovered = 1
        }
        const fnKey = `${(fn.ranges && fn.ranges[0] && fn.ranges[0].startOffset) || 0}-${(fn.ranges && fn.ranges[0] && fn.ranges[0].endOffset) || 0}`
        bucket.functions.set(fnKey, Math.max(bucket.functions.get(fnKey) || 0, fnCovered))
      }
    }
  }

  function matchTarget(url) {
    if (!url) return null
    let p = url
    if (url.indexOf('file://') === 0) {
      try { p = fileURLToPath(url) } catch (error) { p = url }
    }
    // 非绝对路径是 vm 沙箱上报的裸文件名（如 'client.js'），才按 basename 归并。
    if (!path.isAbsolute(p)) {
      const bare = !p.includes(path.sep) && !p.includes('/')
      if (bare && byBasename.has(path.basename(p))) return byBasename.get(path.basename(p))
      return null
    }
    // 绝对路径：只收 ROOT 之内的文件；ROOT 之外的真实磁盘路径（node_modules
    // 依赖）即使同名也忽略，避免与依赖里同名的 index.js 之类混进同一个桶。
    const rel = path.relative(ROOT, p).replace(/\\/g, '/')
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      return TARGETS.includes(rel) ? rel : null
    }
    return null
  }

  // ---- per-file line / function coverage ----------------------------------

  const rows = TARGETS.map((rel) => {
    const abs = path.join(ROOT, rel)
    const bucket = merged.get(rel)
    let src = ''
    try { src = fs.readFileSync(abs, 'utf8') } catch (error) { src = '' }

    const lineStarts = [0]
    for (let i = 0; i < src.length; i += 1) {
      if (src[i] === '\n') lineStarts.push(i + 1)
    }
    const totalLines = lineStarts.length
    const coveredLines = new Set()
    for (const [key, count] of bucket.ranges) {
      if (count <= 0) continue
      const [s, e] = key.split('-').map(Number)
      for (let li = 0; li < lineStarts.length; li += 1) {
        const lineStart = lineStarts[li]
        const lineEnd = li + 1 < lineStarts.length ? lineStarts[li + 1] - 1 : src.length
        if (lineStart < e && lineEnd > s) coveredLines.add(li)
      }
    }
    const totalFns = bucket.functions.size
    const coveredFns = [...bucket.functions.values()].filter((c) => c > 0).length

    return {
      rel,
      totalLines,
      coveredLines: coveredLines.size,
      linePct: totalLines === 0 ? 0 : (coveredLines.size / totalLines) * 100,
      totalFns,
      coveredFns,
      fnPct: totalFns === 0 ? 0 : (coveredFns / totalFns) * 100,
    }
  })

  // ---- report --------------------------------------------------------------

  const pad = (n, w) => String(n).padStart(w)
  const pct = (v) => v.toFixed(1) + '%'
  console.log('')
  console.log('Coverage (V8 ranges; line coverage is a statement-range approximation):')
  console.log('  ' + pad('file', 34) + '  ' + pad('lines', 18) + '  ' + pad('functions', 18))
  for (const row of rows) {
    console.log(
      '  ' + pad(row.rel, 34) + '  ' +
      pad(`${row.coveredLines}/${row.totalLines} (${pct(row.linePct)})`, 18) + '  ' +
      pad(`${row.coveredFns}/${row.totalFns} (${pct(row.fnPct)})`, 18),
    )
  }
  if (unmatched > 0) console.log(`  (${unmatched} coverage entries did not map to a lib/ target and were ignored)`)
  console.log(`  Suites: ${failures.length === 0 ? 'all green' : failures.length + ' failed'}, ${totalPass} passed, ${totalFail} failed`)
} finally {
  try { fs.rmSync(covDir, { recursive: true, force: true }) } catch (error) { void error }
}

process.exitCode = failures.length > 0 ? 1 : 0
