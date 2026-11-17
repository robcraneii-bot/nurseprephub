// Loads question sets from /questions/*.json, validates them, strips answer keys for the browser,
// and grades responses. Question content lives only in the JSON files (see questions/README.md).
const fs = require('fs');
const path = require('path');

const DIR = process.env.QUESTIONS_DIR || path.join(__dirname, '..', 'questions');
const FORMATS = ['mc', 'sata', 'priority', 'delegation', 'case', 'order', 'calc', 'ekg', 'match', 'fill', 'matrix', 'cloze'];
const CHOICE_FORMATS = ['mc', 'priority', 'delegation', 'ekg', 'case'];
const DIFFICULTY = ['beginner', 'intermediate', 'advanced', 'nclex'];
// The six clinical judgment steps, used to tag case-study questions.
const NCJMM = ['recognize-cues', 'analyze-cues', 'prioritize-hypotheses', 'generate-solutions', 'take-action', 'evaluate-outcomes'];
const CLOZE_SLOT = /\{\{([\w-]+)\}\}/g;
// Fields that reveal the answer; removed before a question is sent to the browser.
const KEY_FIELDS = ['answer', 'exact', 'tolerance', 'explanation', 'why', 'steps', 'mistakes', 'roundingExplanation', 'acceptUnits'];
// Reviewer bookkeeping (see scripts/review-server.js); never sent to students.
const REVIEW_FIELDS = ['reviewedBy', 'reviewedAt', 'reviewNote'];

const decimals = to => { const s = String(to); return s.includes('.') ? s.split('.')[1].length : 0; };
function roundTo(x, to) {
  if (!to) return x;
  return Number((Math.round((x + Math.sign(x) * Number.EPSILON) / to) * to).toFixed(decimals(to)));
}
function parseNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw ?? '').trim();
  // Commas only as thousands separators ("1,000"); "1,5" is ambiguous (decimal comma) and rejected.
  if (s.includes(',')) { if (!/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return null; s = s.replace(/,/g, ''); }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return Number(s);
}
const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const normUnit = s => norm(s).replace(/\s/g, '').replace(/^mls?$/, 'ml').replace(/\/hour$/, '/hr').replace(/^gtts?\/min$/, 'gtt/min');

/* ── validation ── */
function validateQuestion(q, set, ids) {
  const e = [];
  const need = (cond, msg) => { if (!cond) e.push(msg); };
  need(typeof q.id === 'string' && q.id, 'missing id');
  need(!ids.has(q.id), `duplicate id "${q.id}"`);
  need(FORMATS.includes(q.format), `format must be one of ${FORMATS.join(', ')}`);
  need(set.categories.some(c => c.id === q.category), `category "${q.category}" is not listed in the set's categories`);
  need(typeof q.stem === 'string' && q.stem.trim(), 'missing stem (the question text)');
  if (q.difficulty !== undefined) need(DIFFICULTY.includes(q.difficulty), `difficulty must be one of ${DIFFICULTY.join(', ')}`);
  need(typeof q.explanation === 'string' && q.explanation.trim(), 'missing explanation (why the answer is correct)');
  const optIds = Array.isArray(q.options) ? q.options.map(o => o && o.id) : [];
  const hasOpts = () => need(optIds.length >= 2 && optIds.every(Boolean) && new Set(optIds).size === optIds.length, 'options must be 2+ items with unique ids');
  if (CHOICE_FORMATS.includes(q.format)) { hasOpts(); need(optIds.includes(q.answer), 'answer must be one option id'); }
  if (q.format === 'case') need(typeof q.case === 'string' && q.case.trim(), 'case questions need a "case" scenario');
  if (q.format === 'sata') { hasOpts(); need(Array.isArray(q.answer) && q.answer.length && q.answer.every(a => optIds.includes(a)), 'answer must be a list of option ids'); }
  if (q.format === 'order') { hasOpts(); need(Array.isArray(q.answer) && q.answer.length === optIds.length && q.answer.every(a => optIds.includes(a)) && new Set(q.answer).size === optIds.length, 'answer must list every option id once, in the correct order'); }
  if (q.format === 'match') {
    const L = (q.left || []).map(o => o.id), R = (q.right || []).map(o => o.id);
    need(L.length >= 2 && R.length >= 2, 'match questions need "left" and "right" lists');
    need(q.answer && typeof q.answer === 'object' && L.every(l => R.includes(q.answer[l])), 'answer must map every left id to a right id');
  }
  if (q.format === 'matrix') {
    const R = (q.rows || []).map(o => o && o.id), C = (q.columns || []).map(o => o && o.id);
    need(R.length >= 2 && R.every(Boolean) && new Set(R).size === R.length, 'matrix questions need 2+ "rows" with unique ids');
    need(C.length >= 2 && C.every(Boolean) && new Set(C).size === C.length, 'matrix questions need 2+ "columns" with unique ids');
    need(q.answer && typeof q.answer === 'object' && R.every(r => C.includes(q.answer[r])), 'answer must map every row id to one column id');
  }
  if (q.format === 'cloze') {
    const B = (q.blanks || []).map(b => b && b.id), slots = [...String(q.template || '').matchAll(CLOZE_SLOT)].map(m => m[1]);
    need(B.length >= 1 && B.every(Boolean) && new Set(B).size === B.length, 'cloze questions need "blanks" with unique ids');
    need(slots.length === B.length && B.every(b => slots.includes(b)), 'cloze "template" must contain {{id}} once for every blank');
    (q.blanks || []).forEach(b => need(b && Array.isArray(b.options) && b.options.length >= 2 && q.answer && b.options.some(o => o.id === q.answer[b.id]), `blank "${b && b.id}" needs 2+ options and an answer among them`));
  }
  if (q.ncjmm !== undefined) need(NCJMM.includes(q.ncjmm), `ncjmm must be one of ${NCJMM.join(', ')}`);
  if (q.format === 'fill') need(Array.isArray(q.answer) && q.answer.length && q.answer.every(a => typeof a === 'string' && a.trim()), 'answer must be a list of accepted text answers');
  if (q.format === 'calc') {
    need(typeof q.answer === 'number' && Number.isFinite(q.answer), 'answer must be a number');
    need(typeof q.unit === 'string' && q.unit, 'calc questions need a "unit"');
    need(q.rounding && typeof q.rounding.to === 'number' && q.rounding.to > 0, 'calc questions need rounding.to (for example 0.1, 0.01 or 1)');
    if (q.rounding && q.rounding.to && typeof q.answer === 'number') need(roundTo(q.answer, q.rounding.to) === q.answer, `answer ${q.answer} is not rounded to ${q.rounding.to}`);
    if (typeof q.exact === 'number' && q.rounding && q.rounding.to) need(roundTo(q.exact, q.rounding.to) === q.answer, `exact value ${q.exact} rounds to ${roundTo(q.exact, q.rounding.to)}, not ${q.answer}`);
    if (q.unitChoices) need(Array.isArray(q.unitChoices) && q.unitChoices.some(u => normUnit(u) === normUnit(q.unit)), 'unitChoices must include the correct unit');
  }
  return e;
}

/* ── case studies (mode "case"): each case unfolds over stages; each stage adds chart entries and asks questions ── */
function validateCases(set, good, f) {
  const ok = [], have = new Set(good.map(q => q.id)), all = new Set(set.questions.map(q => q && q.id)), used = new Set();
  if (!Array.isArray(set.cases)) { ERRORS.push(`${f}: case sets need a "cases" list`); return ok; }
  set.cases.forEach((c, i) => {
    const e = [], need = (cond, msg) => { if (!cond) e.push(msg); };
    c = c || {};
    need(typeof c.id === 'string' && c.id, 'missing id');
    need(typeof c.title === 'string' && c.title.trim(), 'missing title');
    need(set.categories.some(x => x.id === c.category), `category "${c.category}" is not listed in the set's categories`);
    const tabs = (c.tabs || []).map(t => t && t.id);
    need(tabs.length && tabs.every(Boolean), 'needs "tabs" (chart sections such as notes, vitals, labs, orders)');
    need(Array.isArray(c.stages) && c.stages.length, 'needs "stages"');
    (c.stages || []).forEach((s, si) => {
      (s.chart || []).forEach(en => need(en && tabs.includes(en.tab) && (typeof en.text === 'string' || Array.isArray(en.rows)), `stage ${si + 1}: chart entries need a known "tab" and "text" or "rows"`));
      need(Array.isArray(s.questions) && s.questions.length, `stage ${si + 1}: needs "questions"`);
      (s.questions || []).forEach(id => {
        if (!all.has(id)) e.push(`stage ${si + 1}: question "${id}" is not in this file`);
        else if (!have.has(id)) e.push(`stage ${si + 1}: question "${id}" has errors (see above)`);
        if (used.has(id)) e.push(`question "${id}" is used twice`);
        used.add(id);
      });
    });
    if (e.length) ERRORS.push(`${f} case ${i + 1}${c.id ? ` (${c.id})` : ''}: ${e.join('; ')}`);
    else ok.push(c);
  });
  good.filter(q => !used.has(q.id)).forEach(q => ERRORS.push(`${f}: question "${q.id}" is not part of any case`));
  return ok;
}

/* ── loading ── */
let SETS = new Map(), QUESTIONS = new Map(), ERRORS = [];
function load() {
  SETS = new Map(); QUESTIONS = new Map(); ERRORS = [];
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort() : [];
  for (const f of files) {
    let set;
    try { set = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (err) { ERRORS.push(`${f}: invalid JSON (${err.message})`); continue; }
    if (!set.set || !Array.isArray(set.categories) || !Array.isArray(set.questions)) { ERRORS.push(`${f}: needs "set", "categories" and "questions"`); continue; }
    if (SETS.has(set.set)) { ERRORS.push(`${f}: duplicate set id "${set.set}"`); continue; }
    const ids = new Set(QUESTIONS.keys()), good = [];
    set.questions.forEach((q, i) => {
      const errs = validateQuestion(q || {}, set, ids);
      if (errs.length) ERRORS.push(`${f} question ${i + 1}${q && q.id ? ` (${q.id})` : ''}: ${errs.join('; ')}`);
      else { ids.add(q.id); good.push(q); QUESTIONS.set(q.id, { ...q, set: set.set }); }
    });
    if (set.mode === 'case') set.cases = validateCases(set, good, f);
    SETS.set(set.set, { ...set, questions: good });
  }
  ERRORS.forEach(e => console.warn('[questions] ' + e));
  return ERRORS;
}

function shuffled(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
function publicQuestion(q) {
  const p = {};
  for (const [k, v] of Object.entries(q)) if (!KEY_FIELDS.includes(k) && !REVIEW_FIELDS.includes(k)) p[k] = v;
  // An ordering list shown in answer order would give the answer away.
  if (q.format === 'order') { let o = shuffled(q.options); for (let n = 0; n < 5 && o.every((x, i) => x.id === q.answer[i]); n++) o = shuffled(q.options); p.options = o; }
  if (q.format === 'match') p.right = shuffled(q.right);
  return p;
}
function listSets() {
  return [...SETS.values()].map(s => ({
    set: s.set, title: s.title || s.set, description: s.description || '', tier: s.tier || 'free', mode: s.mode || 'bank',
    total: s.questions.length, verified: s.questions.filter(q => q.verified === true).length,
    categories: s.categories.map(c => ({ ...c, count: s.questions.filter(q => q.category === c.id).length })),
    ...(s.mode === 'case' ? { cases: s.cases.map(c => ({ id: c.id, title: c.title, category: c.category, difficulty: c.difficulty || '', summary: c.summary || '', setting: c.setting || '', stages: c.stages.length, questions: c.stages.flatMap(st => st.questions) })) } : {})
  }));
}
function publicSet(id) {
  const s = SETS.get(id); if (!s) return null;
  const { questions, ...meta } = s;
  return { ...meta, questions: questions.map(publicQuestion) };
}

/* ── grading ── */
function answerText(q) {
  const opt = id => { const o = (q.options || []).find(x => x.id === id); return o ? `${o.id}. ${o.text}` : id; };
  switch (q.format) {
    case 'sata': return q.answer.map(opt).join('\n');
    case 'order': return q.answer.map((id, i) => `${i + 1}. ${(q.options.find(o => o.id === id) || {}).text}`).join('\n');
    case 'match': return q.left.map(l => `${l.text} → ${(q.right.find(r => r.id === q.answer[l.id]) || {}).text}`).join('\n');
    case 'fill': return q.answer[0];
    case 'matrix': return q.rows.map(r => `${r.text}: ${(q.columns.find(c => c.id === q.answer[r.id]) || {}).text}`).join('\n');
    case 'cloze': return String(q.template).replace(CLOZE_SLOT, (m, id) => { const b = q.blanks.find(x => x.id === id); return `[${(b.options.find(o => o.id === q.answer[id]) || {}).text}]`; });
    case 'calc': return `${q.answer} ${q.unit}`;
    default: return opt(q.answer);
  }
}
function feedback(q) {
  return {
    id: q.id, answer: q.answer, answerText: answerText(q), explanation: q.explanation, why: q.why || {}, steps: q.steps || [],
    mistakes: q.mistakes || [], roundingExplanation: q.roundingExplanation || '', concept: q.concept || '', lesson: q.lesson || '',
    source: q.source || '', verified: q.verified === true, unit: q.unit || ''
  };
}
function check(id, response) {
  const q = QUESTIONS.get(id); if (!q) return null;
  const r = response || {};
  const out = { correct: false, notes: [] };
  switch (q.format) {
    case 'sata': {
      const got = new Set(Array.isArray(r.choices) ? r.choices : []), want = new Set(q.answer);
      out.correct = got.size === want.size && [...want].every(a => got.has(a));
      out.selectedRight = [...got].filter(a => want.has(a)).length; out.totalRight = want.size;
      out.selectedWrong = [...got].filter(a => !want.has(a)).length;
      break;
    }
    case 'order': out.correct = Array.isArray(r.order) && r.order.length === q.answer.length && r.order.every((a, i) => a === q.answer[i]); break;
    case 'match': out.correct = r.pairs && typeof r.pairs === 'object' && q.left.every(l => r.pairs[l.id] === q.answer[l.id]); break;
    case 'fill': out.correct = q.answer.some(a => norm(a) === norm(r.text)); break;
    case 'matrix': case 'cloze': {
      // NGN-style partial credit: each row or blank scores on its own; the question is correct only if all are.
      const got = (q.format === 'matrix' ? r.cells : r.blanks) || {}, keys = Object.keys(q.answer);
      out.partRight = keys.filter(k => got[k] === q.answer[k]).length; out.partTotal = keys.length;
      out.correct = out.partRight === out.partTotal;
      break;
    }
    case 'calc': {
      const raw = String(r.value ?? '').trim();
      const v = parseNumber(raw);
      if (v === null) { out.notes.push('Enter a number, for example 2.5'); out.invalid = true; break; }
      const tol = typeof q.tolerance === 'number' ? q.tolerance : Math.pow(10, -(decimals(q.rounding.to) + 6));
      const numOk = Math.abs(v - q.answer) <= tol;
      let unitOk = true;
      if (q.unitChoices) {
        const accepted = [q.unit, ...(q.acceptUnits || [])].map(normUnit);
        unitOk = accepted.includes(normUnit(r.unit));
        if (!unitOk) { out.unitIssue = true; out.notes.push(r.unit ? `The unit should be ${q.unit}, not ${r.unit}.` : `Choose a unit. This answer is in ${q.unit}.`); }
      }
      out.correct = numOk && unitOk;
      if (!numOk) {
        const ref = typeof q.exact === 'number' ? q.exact : q.answer;
        if (Math.abs(v - ref) < q.rounding.to && roundTo(v, q.rounding.to) !== v) { out.roundingIssue = true; out.notes.push(`Your calculation is right, but it needs rounding ${q.rounding.label || 'to ' + q.rounding.to}.`); }
        else if (Math.abs(v - ref) < q.rounding.to) { out.roundingIssue = true; out.notes.push(`Close. Check your rounding: ${q.rounding.label || 'round to ' + q.rounding.to}.`); }
      }
      // Medication-safety notation (ISMP): leading zero required, no trailing zeros.
      if (/^\./.test(raw)) out.notes.push(`Safety tip: always write a leading zero (0${raw}). ".${raw.slice(1)}" can be misread as ${raw.slice(1)}.`);
      if (/\.\d*0$/.test(raw)) out.notes.push(`Safety tip: drop trailing zeros (${Number(raw)}). "${raw}" can be misread as ten times the dose.`);
      break;
    }
    default: out.correct = r.choice === q.answer;
  }
  return { ...out, ...feedback(q) };
}
function reveal(id) { const q = QUESTIONS.get(id); return q ? { revealed: true, ...feedback(q) } : null; }

load();
module.exports = { NCJMM, load, listSets, publicSet, check, reveal, has: id => QUESTIONS.has(id), count: () => QUESTIONS.size, errors: () => ERRORS, roundTo, FORMATS, validateQuestion };
