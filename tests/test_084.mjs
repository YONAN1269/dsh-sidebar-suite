// UI-02 + CE-10 — 图标统一 CSS mask；innerHTML 信任边界守卫。
//
// UI-02: 星标与折叠箭头不再用文本字形（★ ☆ ▸ ▾），DOM 只带 data 属性与
// class，图标由 CSS mask 绘制、颜色跟随 currentColor / 主题；选中/未选中、
// 折叠/展开通过属性切换 --dsbs-icon；金色星标保留金色语义。测试桩没有
// createElementNS，渲染端只能走 createElement + 属性 + CSS。
//
// CE-10: 全 bundle 的 innerHTML / insertAdjacentHTML / outerHTML 写入有且仅有
// 第三方插件页签图标那一处，且其上方有信任边界说明；不为消毒改动合法内联
// SVG 的现状行为。
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const client = fs.readFileSync(ROOT + '/lib/client.js', 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  ->  ' + extra : '')) }
}

async function main() {
  // ---- UI-02: 源码不再出现图标文本字形 ------------------------------------
  check('UI02: 源码不含 ★ 星标实心字符', !client.includes('★'))
  check('UI02: 源码不含 ☆ 星标空心字符', !client.includes('☆'))
  check('UI02: 源码不含 ▸ 右箭头字符', !client.includes('▸'))
  check('UI02: 源码不含 ▾ 下箭头字符', !client.includes('▾'))
  check('UI02: 渲染端不使用 createElementNS（桩 DOM 无此 API）', !client.includes('createElementNS('))

  // ---- UI-02: 五行图标落点都带 data 属性且由 CSS mask 绘制 ----------------
  // 行内星标按钮
  check('UI02: 行内星标按钮保留 data-dsbs-fav-star 属性', client.includes("setAttribute('data-dsbs-fav-star', '')"))
  check('UI02: 行内星标按钮保留 aria-label 语义', client.includes("star.setAttribute('aria-label', t('fav.remove'))"))
  check('UI02: 行内星标规则带 mask-image',
    client.includes('[data-dsbs-fav-row] [data-dsbs-fav-star]::before')
    && /\[data-dsbs-fav-row\] \[data-dsbs-fav-star\]::before\{[^}]*mask-image:var\(--dsbs-icon\)/.test(client))

  // 分组头部星标
  check('UI02: 头部星标保留 data-dsbs-fav-mark 与 aria-hidden',
    client.includes("setAttribute('data-dsbs-fav-mark', '')") && client.includes("star.setAttribute('aria-hidden', 'true')"))
  check('UI02: 头部星标规则带 mask-image',
    client.includes('[data-dsbs-fav-head] [data-dsbs-fav-mark]::before')
    && /\[data-dsbs-fav-head\] \[data-dsbs-fav-mark\]::before\{[^}]*mask-image:var\(--dsbs-icon\)/.test(client))

  // 折叠箭头：属性切换，不再写文本字形
  check('UI02: 箭头用 data-dsbs-fav-collapsed 属性切换',
    client.includes("setAttribute('data-dsbs-fav-collapsed', favoriteCollapsed ? 'true' : 'false')"))
  check('UI02: 箭头保留 aria-hidden 语义', client.includes("chevron.setAttribute('aria-hidden', 'true')"))
  check('UI02: 箭头规则带 mask-image',
    client.includes('[data-dsbs-fav-head] [data-dsbs-fav-chevron]::before')
    && /\[data-dsbs-fav-head\] \[data-dsbs-fav-chevron\]::before\{[^}]*mask-image:var\(--dsbs-icon\)/.test(client))
  check('UI02: 折叠态通过属性切换 --dsbs-icon',
    client.includes('[data-dsbs-fav-chevron][data-dsbs-fav-collapsed="true"]{--dsbs-icon:var(--dsbs-fav-chevron-right)}'))

  // 宿主行收藏开关按钮
  check('UI02: 收藏开关保留 data-dsbs-fav-action 与 aria-pressed',
    client.includes("'data-dsbs-fav-action': id") && client.includes("'aria-pressed': active ? 'true' : 'false'"))
  check('UI02: 收藏开关规则带 mask-image，选中/未选中切换图标变量',
    client.includes('[data-dsbs-fav-action]::before')
    && client.includes('[data-dsbs-fav-action][aria-pressed="true"]{color:var(--dsw-alias-state-business-warning,#e8b931);--dsbs-icon:var(--dsbs-fav-star)}')
    && client.includes('--dsbs-fav-star-outline'))

  // 生成的标题星标规则
  const titleRuleBlock = client.slice(client.indexOf('span[class*="title"]::before{'))
  check('UI02: 生成的标题星标规则走 mask-image 而非 content 字形',
    titleRuleBlock.includes('mask-image:url("data:image/svg+xml,') && titleRuleBlock.includes('width:15px'))
  check('UI02: 生成规则不再用 content:"★" 字形', !/content:"★"/.test(client))

  // ---- UI-02: 金色语义保留 -------------------------------------------------
  check('UI02: 金色星标保留 #e8b931 回退色', client.includes('#e8b931'))
  check('UI02: mask 背景用 currentColor 跟随主题',
    (client.match(/background:currentColor/g) || []).length >= 3)

  // ---- CE-10: 全 bundle HTML 写入点唯一且有信任边界说明 --------------------
  const sinks = client.match(/\.innerHTML\s*=|\.insertAdjacentHTML\s*\(|\.outerHTML\s*=/g) || []
  check('CE10: innerHTML/insertAdjacentHTML/outerHTML 写入点有且仅有一处',
    sinks.length === 1, sinks.join(' | '))
  const sinkIndex = client.indexOf('glyph.innerHTML = entry.icon')
  check('CE10: 唯一写入点为第三方页签图标 glyph.innerHTML', sinkIndex >= 0)
  if (sinkIndex >= 0) {
    const boundary = client.slice(Math.max(0, sinkIndex - 620), sinkIndex)
    check('CE10: 写入点上方有信任边界注释（标注唯一 sink 与插件来源）',
      boundary.indexOf('Trust boundary') >= 0 && boundary.indexOf('plugin') >= 0, boundary)
    check('CE10: 注释明确标签保持纯文本节点', boundary.indexOf('text node') >= 0)
  }
  check('CE10: 标签等自由文本不走 innerHTML',
    !/label\.innerHTML|title\.innerHTML|description\.innerHTML/.test(client))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
