const express = require('express');
const path = require('path');
const fs = require('fs');
const bank = require('./practice/bank');
const { createGate } = require('./gate');

const app = express();
const PORT = process.env.PORT || 8080;

// Behind one proxy hop (Railway/Render/Heroku style) req.ip is the visitor's address.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '4kb' }));
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }); next(); });

/* ── Private-access gate: nothing below is reachable without a valid access code (see gate.js) ── */
const gate = createGate();
app.use(gate.middleware);
gate.routes(app);

// Serve only what the site needs. Source code, question files, reports, scripts and archives are never sent.
app.use('/img', express.static(path.join(__dirname, 'img'), { dotfiles: 'ignore', index: false }));
['practice.js', 'practice.css'].forEach(f => app.get('/practice/' + f, (req, res) => res.sendFile(path.join(__dirname, 'practice', f))));

/* ── AI chat: free during early access, with a per-visitor daily allowance ── */
const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 25);
const ALLOWED_MODELS = new Set(['claude-sonnet-4-6']);
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const usage = new Map(); // signed-in user (or ip) -> { day, count }
const today = () => new Date().toISOString().slice(0, 10);
function takeAiCredit(ip) {
  const d = today();
  const u = usage.get(ip);
  if (!u || u.day !== d) { usage.set(ip, { day: d, count: 1 }); return { ok: true, left: AI_DAILY_LIMIT - 1 }; }
  if (u.count >= AI_DAILY_LIMIT) return { ok: false, left: 0 };
  u.count++;
  return { ok: true, left: AI_DAILY_LIMIT - u.count };
}
setInterval(() => { const d = today(); for (const [k, v] of usage) if (v.day !== d) usage.delete(k); }, 36e5).unref();

app.post('/api/chat', async (req, res) => {
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'Set ANTHROPIC_API_KEY in environment variables.' });
  const credit = takeAiCredit(req.user ? 'user:' + req.user.name : req.ip);
  res.set('X-AI-Remaining', String(credit.left));
  if (!credit.ok) {
    const msg = `You've used today's ${AI_DAILY_LIMIT} free AI requests. Your allowance resets at midnight UTC. Lessons, flashcards, games and the question bank stay fully available.`;
    // content[] mirrors the API shape so the existing AI tools display the message as-is.
    return res.status(429).json({ error: { type: 'daily_limit', message: msg }, content: [{ type: 'text', text: msg }] });
  }
  const { model, max_tokens, system, messages } = req.body || {};
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL,
        max_tokens: Math.min(Number(max_tokens) || 1000, 1500),
        system: typeof system === 'string' ? system : '',
        messages: Array.isArray(messages) ? messages.slice(-40) : []
      })
    });
    res.status(response.status).json(await response.json());
  } catch (e) { res.status(500).json({ error: 'AI service error' }); }
});

/* ── Care Plan Generator: structured plans built from form fields (prompt lives on the server) ── */
require('./careplan').register(app, { takeAiCredit, dailyLimit: AI_DAILY_LIMIT });

/* ── Practice: question sets are graded here so answer keys never reach the browser early ── */
app.get('/api/practice/sets', (req, res) => res.json(bank.listSets()));
app.get('/api/practice/sets/:set', (req, res) => {
  const s = bank.publicSet(req.params.set);
  s ? res.json(s) : res.status(404).json({ error: 'Unknown set' });
});
app.post('/api/practice/check', (req, res) => {
  const { id, response } = req.body || {};
  const r = bank.check(String(id || ''), response);
  r ? res.json(r) : res.status(404).json({ error: 'Unknown question' });
});
// Student asked to see the explanation without answering: reveal it, ungraded.
app.post('/api/practice/reveal', (req, res) => {
  const r = bank.reveal(String((req.body || {}).id || ''));
  r ? res.json(r) : res.status(404).json({ error: 'Unknown question' });
});

/* ── Question reports (wrong answer, confusing explanation, typo) ── */
const REPORT_FILE = path.join(__dirname, 'data', 'reports.jsonl');
const reportsByIp = new Map();
app.post('/api/practice/report', (req, res) => {
  const { id, reason, note } = req.body || {};
  if (!bank.has(String(id || ''))) return res.status(404).json({ error: 'Unknown question' });
  const n = reportsByIp.get(req.ip) || 0;
  if (n >= 30) return res.status(429).json({ error: 'Too many reports today' });
  reportsByIp.set(req.ip, n + 1);
  const line = JSON.stringify({ at: new Date().toISOString(), id: String(id), reason: String(reason || '').slice(0, 40), note: String(note || '').slice(0, 1000) });
  fs.mkdir(path.dirname(REPORT_FILE), { recursive: true }, () => fs.appendFile(REPORT_FILE, line + '\n', () => {}));
  res.json({ ok: true });
});
setInterval(() => reportsByIp.clear(), 864e5).unref();

// Public (for uptime checks), so it reveals nothing beyond "up".
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
// Any other path that looks like a file is not part of the site.
app.get('*', (req, res) => /\.[a-z0-9]+$/i.test(req.path) ? res.status(404).end() : res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log('NursePrepHub running on port ' + PORT));
