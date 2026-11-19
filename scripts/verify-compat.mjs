#!/usr/bin/env node
// 宿主兼容巡检：DSH 每次出新 rc / 改 CLI 打包布局时，跑一次就知道
// 插件的宿主契约（test_047 矩阵）和真实启动链路（smoke-l5）还成不成立。
// 绿 = 什么都没变；红 = 明确指出挂在哪一段，不用猜。
//
//   node scripts/verify-compat.mjs                 契约矩阵 + L5 冒烟
//   node scripts/verify-compat.mjs --matrix-only   只跑契约矩阵（无需 DSH）
//   node scripts/verify-compat.mjs --cli <路径>    指定 DSH 安装目录传给冒烟
//
// 设计：本脚本不重新实现任何断言，只编排两个已有脚本并按退出码汇总，
// 避免巡检逻辑和被测逻辑漂移。契约矩阵不需要宿主，L5 需要；宿主缺失时
// L5 记 SKIP 而不是 FAIL —— 遵循「少报」原则，环境不具备不算插件坏。
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const argv = process.argv.slice(2)
const matrixOnly = argv.includes('--matrix-only')
const cliIdx = argv.indexOf('--cli')
const cliArg = cliIdx >= 0 ? argv[cliIdx + 1] : ''

function runNode(script, extra) {
  return new Promise((done) => {
    const args = [script, ...extra]
    const child = process.platform === 'win32'
      ? spawn('node', args, { cwd: ROOT, windowsHide: true })
      : spawn('node', args, { cwd: ROOT })
    let out = ''
    const take = (buf) => { out += buf.toString('utf8') }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('error', (e) => done({ code: -1, out: out + String((e && e.message) || e) }))
    child.on('close', (code) => done({ code, out }))
  })
}

function lastLine(text) {
  const lines = String(text || '').trimEnd().split('\n')
  return lines[lines.length - 1] || ''
}

function failLines(text, limit = 6) {
  return String(text || '').split('\n')
    .filter((l) => /^FAIL\b|\[\d\/\d\] FAIL|致命|结果：未通过|not ok/.test(l))
    .slice(0, limit)
    .map((l) => '    ' + l.trim())
}

const checks = []
console.log('=== DSH 宿主兼容巡检 ===\n')

// 1) 契约矩阵（纯本地，无需宿主）
process.stdout.write('[1/2] 运行宿主契约矩阵（rc.1–rc.5）...\n')
const matrix = await runNode('tests/test_047.mjs', [])
const matrixOk = matrix.code === 0
checks.push({ name: '宿主契约矩阵', ok: matrixOk, summary: lastLine(matrix.out) })
process.stdout.write('    ' + lastLine(matrix.out) + '\n')
if (!matrixOk) failLines(matrix.out).forEach((l) => console.log(l))

// 2) L5 冒烟（需要本机 DSH；--matrix-only 或宿主缺失时 SKIP）
if (matrixOnly) {
  checks.push({ name: 'L5 启动冒烟', skip: true, summary: '--matrix-only 已跳过' })
  console.log('\n[2/2] L5 启动冒烟 — SKIP（--matrix-only）')
} else {
  process.stdout.write('\n[2/2] 运行 L5 启动冒烟（装得上 → 起得来 → 有响应）...\n')
  const smokeArgs = cliArg ? ['--cli', cliArg] : []
  const smoke = await runNode('scripts/smoke-l5.mjs', smokeArgs)
  const out = String(smoke.out || '')
  const noHost = /找不到|未找到|无法定位|no launcher|找不到 dsh|致命.*(dsh|启动器)/i.test(out)
  if (noHost || smoke.code === 2) {
    checks.push({ name: 'L5 启动冒烟', skip: true, summary: '本机未探测到 DSH' })
    console.log('    SKIP  本机未探测到 DSH（契约矩阵仍已验证）')
    console.log('    提示：用 --cli <DSH 安装目录> 指定路径后可跑完整巡检')
  } else {
    const smokeOk = smoke.code === 0
    checks.push({ name: 'L5 启动冒烟', ok: smokeOk, summary: lastLine(out) })
    console.log('    ' + lastLine(out))
    if (!smokeOk) failLines(out).forEach((l) => console.log(l))
  }
}

// 汇总
console.log('\n=== 汇总 ===')
let red = 0
let skipped = 0
for (const c of checks) {
  if (c.skip) { skipped += 1; console.log('  SKIP  ' + c.name + '  — ' + c.summary) }
  else if (c.ok) console.log('  PASS  ' + c.name + '  — ' + c.summary)
  else { red += 1; console.log('  FAIL  ' + c.name + '  — ' + c.summary) }
}
console.log('')
if (red > 0) {
  console.log('结果：宿主兼容性有问题（' + red + ' 项失败）。上面 FAIL 行指出具体契约/步骤。')
  process.exit(1)
} else if (skipped > 0) {
  console.log('结果：契约矩阵通过；L5 因环境未验证（SKIP 不算通过）。')
  process.exit(0)
} else {
  console.log('结果：全部通过 —— DSH 宿主契约与启动链路均未退化。')
  process.exit(0)
}
