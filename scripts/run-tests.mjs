#!/usr/bin/env node
// 离线测试编排器：零依赖，不重新实现任何断言，只把 tests/test_*.mjs 逐个
// 当成独立 Node 子进程跑下去。一个套件失败不中断后面的套件；每个套件
// 追加一行摘要（文件名、PASS 数、FAIL 数、耗时、退出码），结束打印总计，
// 有任一失败则以非零码退出。
//
//   node scripts/run-tests.mjs              全量跑，原样转发各套件自己的 PASS/FAIL 输出
//   node scripts/run-tests.mjs --quiet      只输出摘要行与失败套件的详情
//   node scripts/run-tests.mjs test_064     位置参数按文件名子串过滤（可多个）
//
// 说明：各套件自己打印 PASS/FAIL 行，本脚本只统计行首 `PASS `/`FAIL ` 的数量，
// 不改变既有输出格式。结尾另起一行报告 %TEMP% 下 `dsbs-*` 残留目录数量，
// 只报告、不自动删除。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const TESTS_DIR = path.join(ROOT, 'tests')

const argv = process.argv.slice(2)
const quiet = argv.includes('--quiet') || argv.includes('-q')
const listOnly = argv.includes('--list') || argv.includes('-l')
const filters = argv.filter((arg) => !arg.startsWith('-'))

function listTests() {
  return fs.readdirSync(TESTS_DIR)
    .filter((name) => /^test_.*\.mjs$/.test(name))
    .filter((name) => filters.length === 0 || filters.some((f) => name.indexOf(f) >= 0))
    .sort()
}

function countLines(text, prefix) {
  let n = 0
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line.indexOf(prefix) === 0) n += 1
  }
  return n
}

function snapshotDsbsDirs() {
  let names = []
  try {
    names = fs.readdirSync(os.tmpdir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.indexOf('dsbs-') === 0)
      .map((entry) => entry.name)
  } catch (error) {
    void error
  }
  return new Set(names)
}

const beforeRun = snapshotDsbsDirs()
const tests = listTests()

// --list: print the discovered suite file names only, do not execute anything.
// Lets wiring assertions ask the runner itself which suites are in the run,
// instead of parsing a hard-coded chain in package.json.
if (listOnly) {
  for (const name of tests) console.log(name)
  process.exitCode = 0
} else {

let totalPass = 0
let totalFail = 0
const failures = []
const leakedBySuite = []
const startedAt = Date.now()

for (const name of tests) {
  const file = path.join(TESTS_DIR, name)
  const beforeSuite = snapshotDsbsDirs()
  const t0 = Date.now()
  const result = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
  const elapsed = Date.now() - t0
  const out = result.stdout || ''
  const err = result.stderr || ''
  const pass = countLines(out, 'PASS')
  const fail = countLines(out, 'FAIL')
  const exitLabel = result.status == null
    ? (result.signal ? 'SIG' + result.signal : '?')
    : String(result.status)
  const ok = result.status === 0 && fail === 0
  totalPass += pass
  totalFail += fail
  if (!ok) failures.push({ name, exit: exitLabel, fail, out, err })

  const afterSuite = snapshotDsbsDirs()
  const leaked = [...afterSuite].filter((n) => !beforeSuite.has(n))
  if (leaked.length > 0) leakedBySuite.push({ name, leaked })

  if (!quiet || !ok) {
    if (out) process.stdout.write(out)
    if (err) process.stderr.write(err)
  }
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}  pass=${pass} fail=${fail} exit=${exitLabel} ${elapsed}ms leaked=${leaked.length}`)
}

const afterRun = snapshotDsbsDirs()
const newDuringRun = [...afterRun].filter((n) => !beforeRun.has(n))

console.log('')
console.log(`Total: ${tests.length} suites, ${totalPass} passed, ${totalFail} failed, ${Date.now() - startedAt}ms`)
if (leakedBySuite.length > 0) {
  console.log('Leaking suites (dsbs-* dirs left behind after the suite exited):')
  for (const { name, leaked } of leakedBySuite) {
    console.log(`  ${name}  leaked=${leaked.length}  [${leaked.join(', ')}]`)
  }
}
console.log(`Temp dirs dsbs-*: ${afterRun.size} still present at end (${beforeRun.size} before run, ${newDuringRun.length} new during this run); reported only, not deleted by the runner.`)

process.exitCode = failures.length > 0 ? 1 : 0
}
