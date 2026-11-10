// dsh-sidebar-suite 0.2.4 — plugin-detail-page positioning copy.
//
// The Host renders two separate pieces of prose on a bundle's detail page:
//   * meta.description from locale/<lang>.json  -> detailDesc / plugin card
//   * the Markdown document named by meta.detail -> BundleDetailSection
// Both must say what this plugin is (a sidebar-experience plugin) and name the
// two design goals (practical + good-looking). This test also guards the
// package wiring that lets the Host actually read those files after publish.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Relocatable: <repo>/tests -> <repo>. No machine-specific paths (CI-safe).
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const read = (p) => readFileSync(ROOT + '/' + p, 'utf8')

let pass = 0
let fail = 0
function check(name, ok, extra) {
  if (ok) { pass += 1; console.log('PASS  ' + name) }
  else { fail += 1; console.log('FAIL  ' + name + (extra ? '  →  ' + extra : '')) }
}

const FOCUS = '专门针对改进 DSH 左侧栏体验'
const EN_FOCUS = 'dedicated to'
const zh = JSON.parse(read('locale/zh.json'))
const en = JSON.parse(read('locale/en.json'))
const pkg = JSON.parse(read('package.json'))
const detail = read('DETAIL.md')
const readme = read('README.md')
const guide = read('使用说明.md')
const client = read('lib/client.js')

// ---- the one-liner the Host shows above the detail sections ---------------
for (const [lang, loc] of [['zh', zh], ['en', en]]) {
  const one = loc.meta && loc.meta.description
  check(`locale/${lang}: description parses as a string`, typeof one === 'string')
  check(`locale/${lang}: names the sidebar focus`, typeof one === 'string' && one.includes(FOCUS))
  check(`locale/${lang}: English half names the same focus`, typeof one === 'string' && one.includes('A plugin dedicated to a better DSH sidebar'))
  check(`locale/${lang}: states practicality`, typeof one === 'string' && one.includes('强实用性') && one.includes('seriously practical'))
  check(`locale/${lang}: states visual quality`, typeof one === 'string' && one.includes('好看') && one.includes('good-looking'))
  check(`locale/${lang}: detail document still wired`, loc.meta.detail === 'DETAIL.md')
}
check('locale: zh and en one-liners stay identical', zh.meta.description === en.meta.description)

// ---- the long detail document --------------------------------------------
check('DETAIL: opening blockquote declares the positioning', detail.slice(0, 1200).includes('**这是一款专门针对改进 DSH 左侧栏体验的插件。**'))
check('DETAIL: English opening declares the positioning', detail.slice(0, 1600).includes('**This is a plugin dedicated to improving the DSH sidebar experience.**'))
check('DETAIL: has a "what this plugin is" section', detail.includes('## 这是一款什么插件 / What this plugin is'))
check('DETAIL: has a practicality section', detail.includes('### 强实用性 / Seriously practical'))
check('DETAIL: has a visual-quality section', detail.includes('### 美观性 / Looks native'))
check('DETAIL: practicality lists the newer features',
  detail.includes('临时会话 / Temporary session') && detail.includes('No more "Show N more"') && detail.includes('设置项置顶 / Settings first'))
check('DETAIL: visual claims are concrete, not slogans',
  detail.includes('--dsw-alias-*') && detail.includes('36×24') && detail.includes('::after') && detail.includes('inert') && detail.includes('10 px'))
check('DETAIL: still documents the three layouts', detail.includes('## 三种布局 / Three layouts'))
check('DETAIL: still documents feedback and support',
  detail.includes('## 反馈 / Feedback') && detail.includes('## 支持作者 / Support the author'))

// ---- README (npm / marketplace body) and the local guide -----------------
check('README: declares the positioning', readme.includes('**这是一款专门针对改进 DSH 左侧栏体验的插件。**'))
check('README: names both design goals', readme.includes('强实用性 / Seriously practical') && readme.includes('美观性 / Looks native'))
check('README: links to the long detail document', readme.includes('[DETAIL.md](DETAIL.md)'))
check('guide: opens with the same positioning', guide.slice(0, 700).includes('**这是一款专门针对改进 DSH 左侧栏体验的插件**'))

// ---- the pinned settings card (first thing visible on the detail page) ----
check('client: intro copy is in the bilingual dictionary', client.includes("'settings.intro'"))
check('client: intro names the sidebar focus', client.includes(FOCUS))
check('client: intro names practicality and looks', client.includes('强实用性 + 美观性'))
check('client: intro is rendered with its own hook', client.includes("'data-dsbs-intro': ENTRY"))
check('client: intro uses host design tokens for colour', client.includes("var(--dsw-alias-label-secondary,inherit)"))
check('client: intro sits above the settings title',
  client.indexOf("'data-dsbs-intro': ENTRY") < client.indexOf("t('settings.title')"))

// ---- npm metadata and the wiring that makes all of the above visible ------
check('package: description declares the positioning', pkg.description.includes(FOCUS))
check('package: description names both design goals', pkg.description.includes('强实用性') && pkg.description.includes('克制美观'))
check('package: English description names the same goals', pkg.description.includes('seriously practical') && pkg.description.includes('good-looking'))
check('package: version is valid semver', /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version), pkg.version)
// 0.2.5 delivery fixes: the guide, changelog and storefront assets must actually
// reach users inside the published tarball — not just exist in the repository.
check('package: ships the step-by-step guide in the tarball', pkg.files.includes('使用说明.md'))
check('package: ships the changelog in the tarball', pkg.files.includes('CHANGELOG.md'))
check('package: ships screenshots.json in the tarball', pkg.files.includes('screenshots.json'))
check('package: ships the PNG icon and screenshot images', pkg.files.includes('assets/*.png') && pkg.files.includes('assets/screenshots/*.png'))
check('package: exposes one-command npm test', /tests\/test_020\.mjs/.test((pkg.scripts || {}).test || ''))
check('package: exports the detail document', pkg.exports['./DETAIL.md'] === './DETAIL.md')
check('package: exports the locale files', pkg.exports['./locale/*.json'] === './locale/*.json')
check('package: ships the detail document in the tarball', pkg.files.includes('DETAIL.md'))
check('package: ships both locale files', pkg.files.includes('locale/*.json'))
check('package: ships README for the marketplace body', pkg.files.includes('README.md'))
check('package: ships the client bundle that renders the card', pkg.files.includes('lib/client.js'))

// ---- 0.2.6: the catalog maintainer's default-behaviour disclosure --------
// awesome-dsh-plugin PR #13993 was merged with a copy tweak: temp sessions are
// deleted when DSH quits BY DEFAULT, while the daily cleanup is OFF by default.
// Every surface a user reads must say the same thing — this guards against the
// old "quit / daily auto-delete" wording that made both sound enabled.
const DEF_ZH = '默认在退出 DSH 时删除'
const DEF_OFF = '每天定时清理默认关'
check('copy: npm description discloses both defaults',
  pkg.description.includes(DEF_ZH) && pkg.description.includes(DEF_OFF) && pkg.description.includes('daily cleanup off by default'))
check('copy: detail headline discloses both defaults',
  zh.meta.description.includes(DEF_ZH) && zh.meta.description.includes(DEF_OFF) && en.meta.description.includes('daily cleanup off by default'))
check('copy: DETAIL.md discloses both defaults', detail.includes(DEF_ZH) && detail.includes(DEF_OFF))
check('copy: README discloses both defaults', readme.includes(DEF_ZH) && readme.includes(DEF_OFF))
check('copy: guide discloses both defaults', guide.includes(DEF_ZH) && guide.includes(DEF_OFF))
check('client: settings card spells out the defaults',
  client.includes('退出 DSH 时删除=开，每天定时清理=关') && client.includes('delete on quit = on, daily cleanup = off'))

// ---- 0.2.7: download counters must stay visible and explained -----------
check('README: shows the npm download badge',
  readme.includes('img.shields.io/npm/dm/dsh-sidebar-suite') && readme.includes('https://www.npmjs.com/package/dsh-sidebar-suite'))
check('README: shows the GitHub release download badge',
  readme.includes('img.shields.io/github/downloads/YONAN1269/dsh-sidebar-suite/total'))
check('README: explains that GitHub only counts attached release files',
  readme.includes('只统计') && readme.includes('git clone'))
check('README: keeps the Releases offline-install link',
  readme.includes('https://github.com/YONAN1269/dsh-sidebar-suite/releases'))

// ---- no stale one-liner left anywhere ------------------------------------
const stale = '三种布局把挤成一团的左侧栏理顺'
check('copy: old one-line pitch fully retired',
  !zh.meta.description.includes(stale) && !en.meta.description.includes(stale) && !pkg.description.includes(stale))

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
