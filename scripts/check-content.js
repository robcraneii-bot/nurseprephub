// Decodes every study tool in index.html and scans all site files for names and wording that must never appear.
// Exit code 1 on any match. Run: npm run check-content
const fs = require('fs');
const path = require('path');
const { tools } = require('./tool-data');

const ROOT = path.join(__dirname, '..');
const BANNED = [
  [/garc[ií]a/i, 'instructor name'],
  [/\bdr\.?\s*g\b|\bdoctor\s+g\b/i, 'instructor name'],
  [/from your (?:cardiac meds )?lecture(?! notes)/i, 'class-material wording'],
  [/ackley[^<]{0,40}page numbers|page numbers[^<]{0,40}ackley/i, 'AI page-number claim']
];
const files = { ...Object.fromEntries(Object.entries(tools()).map(([id, html]) => [`index.html [tool ${id}]`, html])) };
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  if (['node_modules', '.git', 'data'].includes(e.name)) return;
  const p = path.join(d, e.name);
  if (e.isDirectory()) return walk(p);
  if (/\.(html|js|json|md|css)$/.test(e.name) && p !== __filename) files[path.relative(ROOT, p)] = fs.readFileSync(p, 'utf8');
});
walk(ROOT);
let n = 0;
for (const [f, text] of Object.entries(files)) for (const [re, why] of BANNED) {
  const m = text.match(re);
  if (m) { n++; console.log(`${f}: ${why}: "...${text.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ')}..."`); }
}
// The identifier rules exist twice (server in careplan.js, instant feedback in the careplan tool page); they must match.
const rulesOf = t => { const m = String(t || '').match(/\/\* ID_RULES start[\s\S]*?\/\* ID_RULES end \*\//); return m && m[0].replace(/\s+/g, ' '); };
const serverRules = rulesOf(files['careplan.js']), pageRules = rulesOf(files['index.html [tool careplan]']);
if (!serverRules || serverRules !== pageRules) { n++; console.log('careplan: identifier rules in careplan.js and the Care Plan Generator page are missing or differ; copy the ID_RULES block across.'); }
console.log(n ? `\n${n} problem(s).` : `Checked ${Object.keys(files).length} files and decoded tools: no banned names or wording.`);
process.exit(n ? 1 : 0);
