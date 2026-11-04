// Local readiness runner. Never deploys or changes remote services.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, 'prelaunch-report')
mkdirSync(out, { recursive: true })
const started = new Date().toISOString()
const items = []
let project = '', section = ''
for (const line of readFileSync(resolve(root, 'nixgen_deskdev_prelaunch_checklist.md'), 'utf8').split(/\r?\n/)) {
  if (/^# /.test(line)) project = line.slice(2)
  if (/^## /.test(line)) section = line.slice(3)
  const match = line.match(/^- \[([ x])\] (.+)/)
  if (match) items.push({ project, section, label: match[2], status: 'unverified', evidence: 'Requires focused verification; source checkmarks are not evidence for this run.' })
}
const checks = [
  ['TypeScript', 'site', 'npx tsc --noEmit -p tsconfig.json'],
  ['Unit tests', 'site', 'npm test'],
  ['Migration guard', '.', 'node scripts/check-migrations.mjs'],
  ['Repository script tests', '.', 'node --test "scripts/**/*.test.mjs"'],
  ['Clean database / RLS tests', 'supabase/tests', 'npm test'],
  ['Shared library drift', '.', 'node scripts/check-shared-drift.mjs'],
  ['Automation validation', '.', 'node scripts/n8n.mjs check'],
  ['Browser E2E and local production build', 'site', 'npm run test:e2e'],
].map(([name, cwd, command], index) => ({ name, cwd, command, id: index + 1, status: 'queued', output: '' }))
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
let finished = false
function render() {
  const db = checks.find(c => c.name === 'Clean database / RLS tests')
  const guard = checks.find(c => c.name === 'Migration guard')
  for (const item of items) {
    if (item.project === 'DeskDev' && item.label === 'Migrations work on a clean database.' && db.status === 'passed') {
      item.status = 'verified'
      item.evidence = 'Clean database / RLS suite passed: all migration files applied in ledger order to throwaway PGlite. Production state is outside this result.'
    }
    if (item.project === 'DeskDev' && item.label === 'Migrations saved.' && guard.status === 'passed') {
      item.status = 'verified'
      item.evidence = 'Migration guard passed against files and migration ledger in this workspace.'
    }
    if (item.project === 'DeskDev' && /Permission Testing|Authentication|Security/.test(item.section) && db.status === 'passed' && item.status !== 'verified') {
      item.status = 'partial'
      item.evidence = 'Local database authorization and sign-up guard suite passed. Check this item against its specific scenario; live auth, browser and integration behavior remain unverified.'
    }
    if (/DNS|after launch|SPF|DKIM|DMARC|Search Console|Backup|backup|restored successfully|Correct package prices|Correct monthly maintenance prices|Previously exposed credentials rotated/.test(item.label)) {
      item.status = 'owner review'
      item.evidence = 'Requires owner-approved production evidence or business confirmation. No remote writes or production restore attempted.'
    }
  }
  const complete = checks.filter(c => ['passed', 'failed'].includes(c.status)).length
  const groups = new Map()
  for (const item of items) {
    const key = `${item.project} / ${item.section}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"><title>Nixgen + DeskDev prelaunch progress</title><style>body{margin:0;background:#10151e;color:#e3eaf5;font:15px system-ui}main{max-width:1100px;margin:auto;padding:32px}h1{font-size:30px}p{color:#aebdd3}section,details{background:#192231;border:1px solid #314059;border-radius:12px;padding:18px;margin:14px 0}summary{cursor:pointer;font-weight:600}.badge{display:inline-block;padding:4px 9px;border-radius:6px;background:#35445d;margin-right:8px}.passed{background:#175b43}.failed{background:#822d3b}.running{background:#75591d}progress{width:100%;height:22px}li{padding:8px 0;border-bottom:1px solid #2b384c}small{display:block;color:#aebdd3;padding-top:5px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}a{color:#90bfff}input{padding:12px;width:90%;background:#10151e;color:white;border:1px solid #516381;border-radius:8px}</style><main><h1>Nixgen + DeskDev prelaunch</h1><p>Refreshes every 10 seconds · Started ${escape(started)} · Updated ${new Date().toISOString()}</p><section><strong>${finished ? 'Run complete' : 'Checks in progress'} · ${complete}/${checks.length} automated checks completed</strong><progress value="${complete}" max="${checks.length}"></progress><p>Launch decision: NOT CLEARED. ${items.filter(i => i.status !== 'verified').length} of ${items.length} checklist items still require verification. Passing a suite provides evidence only for its covered scenarios; it does not certify an entire checklist section.</p><p>Local audit only. DNS changes, deployment, real email delivery, remote account creation, restore drills and production configuration are not performed. Existing work in progress is included in the tested workspace.</p></section><h2>Automated evidence</h2>${checks.map(c => `<details ${c.status === 'running' || c.status === 'failed' ? 'open' : ''}><summary><span class="badge ${c.status}">${c.status}</span>${escape(c.name)}</summary><p>${escape(c.command)} · ${escape(c.cwd)}${c.exitCode !== undefined ? ` · exit ${c.exitCode}` : ''}</p><pre>${escape(c.output.slice(-18000))}</pre></details>`).join('')}<h2>Full source checklist (${items.length} items)</h2><input id="search" placeholder="Filter checklist items" aria-label="Filter checklist items">${[...groups].map(([key, rows]) => `<details class="group"><summary>${escape(key)} · ${rows.filter(i => i.status === 'verified').length}/${rows.length} verified</summary><ul>${rows.map(i => `<li><span class="badge ${i.status}">${i.status}</span>${escape(i.label)}<small>${escape(i.evidence)}</small></li>`).join('')}</ul></details>`).join('')}<p>Evidence and status snapshot: <a href="status.json">status.json</a>. Browser video and detailed results are under site/e2e-report and site/e2e-artifacts.</p></main><script>const input=document.querySelector('#search');input.value=sessionStorage.getItem('filter')||'';function filter(){sessionStorage.setItem('filter',input.value);document.querySelectorAll('.group').forEach(g=>{let count=0;g.querySelectorAll('li').forEach(li=>{li.hidden=!li.textContent.toLowerCase().includes(input.value.toLowerCase());if(!li.hidden)count++});g.hidden=count===0;if(input.value)g.open=true})}input.oninput=filter;filter();document.querySelectorAll('details').forEach((d,i)=>{if(sessionStorage.getItem('open'+i)==='true')d.open=true;d.addEventListener('toggle',()=>sessionStorage.setItem('open'+i,d.open))});</script></html>`
  writeFileSync(resolve(out, 'index.html'), html)
  writeFileSync(resolve(out, 'status.json'), JSON.stringify({ started, updated: new Date().toISOString(), finished, checks, items }, null, 2))
}
render()
const server = createServer((req, res) => {
  const name = req.url?.split('?')[0] === '/status.json' ? 'status.json' : 'index.html'
  res.setHeader('Content-Type', name.endsWith('json') ? 'application/json' : 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(readFileSync(resolve(out, name)))
})
server.listen(6971, '127.0.0.1', () => console.log('Progress report: http://127.0.0.1:6971'))
for (const check of checks) {
  check.status = 'running'
  render()
  console.log(`Starting: ${check.name}`)
  await new Promise(resolveCheck => {
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', check.command], { cwd: resolve(root, check.cwd), env: { ...process.env, E2E_RUN_ID: 'prelaunch', FORCE_COLOR: '0' }, windowsHide: true })
    const append = data => {
      // Do not retain credential-looking strings in the user-facing report.
      check.output = (check.output + data.toString().replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED TOKEN]').replace(/\b(?:sk-|sb_secret_)[A-Za-z0-9_-]+/g, '[REDACTED KEY]').replace(/\x1b\[[0-9;]*m/g, '')).slice(-60000)
      render()
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', error => { append(error.message); check.status = 'failed'; render(); resolveCheck() })
    child.on('close', code => { check.exitCode = code; check.status = code === 0 ? 'passed' : 'failed'; render(); console.log(`${check.name}: ${check.status}`); resolveCheck() })
  })
}
finished = true
render()
console.log('All checks finished. Report server remains available; Ctrl+C stops it.')
