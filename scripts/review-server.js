// Local question review tool. Run with `npm run review`, then open http://localhost:8090
// It listens on 127.0.0.1 only and is never part of the deployed site (server.js does not load it).
// Changes are written straight to questions/*.json; commit and redeploy to publish them.
const express = require('express');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = process.env.QUESTIONS_DIR || path.join(ROOT, 'questions');
const REPORT_FILE = path.join(ROOT, 'data', 'reports.jsonl');
const PORT = Number(process.env.REVIEW_PORT || 8090);
process.env.QUESTIONS_DIR = DIR;
const bank = require('../practice/bank');

const files = () => fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
const readSet = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
// Same formatting as the files already use, so diffs stay small.
function writeSet(f, set) {
  const p = path.join(DIR, f), tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(set, null, 2) + '\n');
  fs.renameSync(tmp, p);
}
function readReports() {
  if (!fs.existsSync(REPORT_FILE)) return [];
  return fs.readFileSync(REPORT_FILE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function find(id) {
  for (const f of files()) {
    const set = readSet(f);
    const i = set.questions.findIndex(q => q && q.id === id);
    if (i >= 0) return { f, set, i };
  }
  return null;
}
const today = () => new Date().toISOString().slice(0, 10);

const app = express();
app.use(express.json({ limit: '1mb' }));
// Only answer requests addressed to this machine (blocks DNS-rebinding from other sites).
app.use((req, res, next) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '') ? next() : res.status(403).end());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'review.html')));

app.get('/api/questions', (req, res) => {
  const reports = readReports();
  const out = [];
  for (const f of files()) {
    let set; try { set = readSet(f); } catch (e) { continue; }
    const cats = Object.fromEntries((set.categories || []).map(c => [c.id, c.name]));
    (set.questions || []).forEach((q, i) => out.push({
      file: f, set: set.set, index: i, categoryName: cats[q.category] || q.category, q,
      reports: reports.filter(r => r.id === q.id)
    }));
  }
  bank.load();
  res.json({ questions: out, errors: bank.errors() });
});

// Mark reviewed / not reviewed, with reviewer initials and an optional note.
app.post('/api/verify', (req, res) => {
  const { id, verified, reviewer, note } = req.body || {};
  const hit = find(String(id || ''));
  if (!hit) return res.status(404).json({ error: 'Unknown question' });
  const q = hit.set.questions[hit.i];
  if (verified) {
    if (!String(reviewer || '').trim()) return res.status(400).json({ error: 'Enter your initials before marking a question reviewed.' });
    if (!String(q.source || '').trim()) return res.status(400).json({ error: 'Add a source before marking this question reviewed.' });
    q.verified = true; q.reviewedBy = String(reviewer).trim().slice(0, 40); q.reviewedAt = today();
  } else {
    q.verified = false; delete q.reviewedBy; delete q.reviewedAt;
  }
  if (note !== undefined) { const n = String(note).trim().slice(0, 2000); n ? q.reviewNote = n : delete q.reviewNote; }
  writeSet(hit.f, hit.set);
  res.json({ ok: true, q });
});

// Replace a question with edited JSON. Rejected if it fails the same checks the site uses.
app.post('/api/save', (req, res) => {
  const { id, question } = req.body || {};
  const hit = find(String(id || ''));
  if (!hit) return res.status(404).json({ error: 'Unknown question' });
  if (!question || typeof question !== 'object' || Array.isArray(question)) return res.status(400).json({ error: 'Not a question object' });
  if (question.id !== id) return res.status(400).json({ error: `Keep the id "${id}". Saved progress depends on it.` });
  const old = hit.set.questions[hit.i];
  const changed = JSON.stringify({ ...old, verified: 0, reviewedBy: 0, reviewedAt: 0, reviewNote: 0 }) !== JSON.stringify({ ...question, verified: 0, reviewedBy: 0, reviewedAt: 0, reviewNote: 0 });
  // Editing content of a reviewed question sends it back for review.
  if (changed && old.verified === true) { question.verified = false; delete question.reviewedBy; delete question.reviewedAt; }
  const errs = bank.validateQuestion(question, hit.set, new Set());
  if (errs.length) return res.status(400).json({ error: errs.join('; ') });
  hit.set.questions[hit.i] = question;
  writeSet(hit.f, hit.set);
  res.json({ ok: true, q: question, unverified: changed && old.verified === true });
});

app.listen(PORT, '127.0.0.1', () => console.log(`Question review: http://localhost:${PORT}  (editing ${DIR})`));
