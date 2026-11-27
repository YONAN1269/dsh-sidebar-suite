// CH-06 + PD-13 — 客户端侧回归。
//
// CH-06: host 在凭据服务不可用时只写墓碑并返回 ok:false /
// reason:'credentials-unavailable'（host 侧已由 test_064/065/079 覆盖）。本套件
// 锁定客户端行为：
//   1. 收到该 reason 时在状态机上置 credentialsUnavailable 标记，面板据此提示；
//   2. 之后一次成功保存清除该标记；
//   3. 不改变 4 秒重试节流，失败轮询不会每 1.5 秒重发；
//   4. 中英字典各有一条提示文案，面板渲染对应提示节点。
//
// PD-13: 「全部保留」与逐行删除一样走二次确认：第一次点击只 armed 并显示
// 「再点一次确认」，第二次点击才发 keep-all；切到别的动作或 5 秒后解除。
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const client = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

const enBlock = client.slice(client.indexOf('en: {'), client.indexOf('zh: {'))
const zhBlock = client.slice(client.indexOf('zh: {'))

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

// ---- 状态机运行时桩（同 test_065 的切片方式，离线可重复） ------------------
function makeRuntime(options = {}) {
  const start = client.indexOf('var WEB_LOGIN_CLEAR_KEY')
  const end = client.indexOf('function makeWebPagePanel(pageId)')
  if (start < 0 || end <= start) throw new Error('web-login state block not found')
  const block = client.slice(start, end)
  const calls = { load: 0, save: 0, clear: 0 }
  const timers = []
  const storage = new Map()
  let timerId = 0
  let now = 10000
  let saveReply = options.saveReply || { ok: true }
  const frame = {
    url: 'https://chat.deepseek.com/',
    entries: {},
    getURL() { return this.url },
    reload() {},
    focus() {},
    executeJavaScript(code) {
      if (String(code).indexOf('localStorage.setItem') >= 0) return true
      return JSON.stringify(this.entries)
    },
  }
  const runtime = { disposed: false }
  const documentStub = { hidden: false }
  const windowStub = {
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  }
  const setTimeoutStub = (fn, ms) => { timerId += 1; timers.push({ id: timerId, fn, ms }); return timerId }
  const clearTimeoutStub = (id) => {
    const index = timers.findIndex((timer) => timer.id === id)
    if (index >= 0) timers.splice(index, 1)
  }
  const dateStub = { now: () => now }
  const tempCall = (path) => {
    if (path.indexOf('-load') >= 0) { calls.load += 1; return Promise.resolve({ ok: true, found: false }) }
    if (path.indexOf('-clear') >= 0) { calls.clear += 1; return Promise.resolve({ ok: true }) }
    if (path.indexOf('-save') >= 0) { calls.save += 1; return Promise.resolve(saveReply) }
    return Promise.resolve({ ok: false })
  }
  const factory = new Function(
    'WEB_LOGIN_API', 'tempCall', 'runtime', 'document', 'window', 'setTimeout', 'clearTimeout', 'Date',
    block + '\nreturn { webLoginState: webLoginState, captureWebLogin: captureWebLogin, resetWebLoginPage: resetWebLoginPage }',
  )
  const api = factory('api/dsh-sidebar-suite.web-login', tempCall, runtime, documentStub, windowStub,
    setTimeoutStub, clearTimeoutStub, dateStub)
  const flush = async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const runTimer = (ms) => {
    const index = timers.findIndex((timer) => timer.ms === ms)
    if (index < 0) return false
    const timer = timers.splice(index, 1)[0]
    timer.fn()
    return true
  }
  return {
    api, frame, calls, timers, storage, flush, runTimer,
    setSaveReply(next) { saveReply = next },
    advance(ms) { now += ms },
  }
}

async function main() {
  // ---- 1. CH-06: 凭据不可用时置标记，不破坏 4 秒节流 ----------------------
  {
    const h = makeRuntime({ saveReply: { ok: false, reason: 'credentials-unavailable', savedAt: '2030-01-01T00:00:00.000Z' } })
    h.frame.entries = { userToken: 'abc.def.ghi' }
    h.api.captureWebLogin('chat', h.frame, true)
    h.runTimer(0)
    await h.flush()
    const state = h.api.webLoginState.chat
    check('CH06: 凭据不可用响应置上 credentialsUnavailable 标记',
      state.credentialsUnavailable === true, JSON.stringify({ flag: state.credentialsUnavailable, saves: h.calls.save }))
    check('CH06: 不可用保存不写入 lastSaved（进程内仍按已登录对待，但不冒充已持久化）',
      state.lastSaved === '',
      JSON.stringify({ lastSaved: state.lastSaved, signedIn: state.signedIn }))

    // 4 秒窗口内再次捕获：节流必须仍然生效，不能变成每 1.5 秒重发一次。
    h.api.captureWebLogin('chat', h.frame, true)
    h.runTimer(0)
    await h.flush()
    check('CH06: 4 秒节流保留，窗口内不重复发起保存', h.calls.save === 1, String(h.calls.save))
  }

  // ---- 2. CH-06: 之后一次成功保存清除标记 ---------------------------------
  {
    const h = makeRuntime({ saveReply: { ok: false, reason: 'credentials-unavailable' } })
    h.frame.entries = { userToken: 'abc.def.ghi' }
    h.api.captureWebLogin('chat', h.frame, true)
    h.runTimer(0)
    await h.flush()
    check('CH06: 先置上不可用标记', h.api.webLoginState.chat.credentialsUnavailable === true)

    h.advance(5000) // 越过 4 秒节流窗口
    h.setSaveReply({ ok: true })
    h.api.captureWebLogin('chat', h.frame, true)
    h.runTimer(0)
    await h.flush()
    const state = h.api.webLoginState.chat
    check('CH06: 成功保存后清除不可用标记', state.credentialsUnavailable === false, JSON.stringify(state))
    check('CH06: 成功保存写入 lastSaved 并标记已登录',
      state.lastSaved !== '' && state.signedIn === true, JSON.stringify({ lastSaved: state.lastSaved, signedIn: state.signedIn }))
  }

  // ---- 3. CH-06: 其它失败原因不置不可用标记 -------------------------------
  {
    const h = makeRuntime({ saveReply: { ok: false } })
    h.frame.entries = { userToken: 'abc.def.ghi' }
    h.api.captureWebLogin('chat', h.frame, true)
    h.runTimer(0)
    await h.flush()
    check('CH06: 普通保存失败不置 credentialsUnavailable 标记',
      h.api.webLoginState.chat.credentialsUnavailable === false)
  }

  // ---- 4. CH-06: 字典与面板渲染节点 ---------------------------------------
  check('CH06: 英文字典含 credentialsUnavailable 条目',
    !!enBlock.match(/'page\.credentialsUnavailable':\s*'[^']+'/))
  check('CH06: 中文字典含 credentialsUnavailable 条目',
    !!zhBlock.match(/'page\.credentialsUnavailable':\s*'[^']+'/))
  check('CH06: 英文条目无 CJK 字符',
    (() => { const m = enBlock.match(/'page\.credentialsUnavailable':\s*'([^']*)'/); return !!m && !/[一-鿿]/.test(m[1]) })())
  check('CH06: 面板渲染凭据不可用提示节点',
    client.includes("'data-dsbs-webpage-cred-unavailable': ''"))
  check('CH06: 提示节点绑定 credentialsUnavailable 状态',
    client.includes('credUnavail') && client.includes('credentialsUnavailable'))
  check('CH06: 面板 CSS 含提示节点规则',
    client.includes('[data-dsbs-webpage-cred-unavailable]'))
  check('CH06: 状态机初始值 credentialsUnavailable 为 false',
    client.includes('credentialsUnavailable: false'))

  // ---- 5. PD-13: keep-all 二次确认源码契约 --------------------------------
  const keepAllFn = client.slice(client.indexOf('function keepAllTempSessions'))
  check('PD13: keep-all 先进入 armed 态（!keepAllArm 分支）再发请求',
    /if \(!keepAllArm\)/.test(keepAllFn) && keepAllFn.indexOf("'api/dsh-temp-session.keep-all'") > keepAllFn.indexOf('if (!keepAllArm)'))
  check('PD13: armed 分支 5 秒后自动解除',
    /window\.setTimeout\(function[\s\S]{0,420}5000\)/.test(keepAllFn))
  check('PD13: 第二次点击才清空 armed 并进入 busy',
    /setKeepAllArm\(false\)/.test(keepAllFn) && /setTempListStatus\('busy'\)/.test(keepAllFn))
  check('PD13: 中英双语字典含 keepAllConfirm 条目',
    client.includes("'tempList.keepAllConfirm':"))
  check('PD13: 按钮渲染 armed 数据属性',
    client.includes("'data-dsbs-keep-all-arm': keepAllArm ? 'true' : 'false'"))
  check('PD13: 切换逐行动作时解除 keep-all armed',
    /function tempSessionAction[\s\S]{0,200}setKeepAllArm\(false\)/.test(client)
    && /function requestTempAction[\s\S]{0,260}setKeepAllArm\(false\)/.test(client))
  check('PD13: keep-all 路由名未变',
    client.includes('api/dsh-temp-session.keep-all'))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
