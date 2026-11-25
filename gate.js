// Private-access gate: the whole site and every API sit behind a personal access code.
//
// Environment:
//   ACCESS_CODES    comma-separated entries "role:name:sha256-of-code", role = owner | consultant
//                   (make entries with `npm run access-code -- <role> <name>`; the code itself is never stored)
//   SESSION_SECRET  long random string used to sign the sign-in cookie (changing it signs everyone out)
//   GATE=off        disables the gate for local development only
//
// Revoking someone: remove their entry from ACCESS_CODES and restart. Their cookie stops working immediately,
// because every request re-checks that the entry still exists with the same code.
const crypto = require('crypto');

const COOKIE = 'nph_session';
const MAX_AGE_S = 30 * 24 * 3600;
const ROLES = ['owner', 'consultant'];

const hashCode = code => crypto.createHash('sha256').update(normalize(code)).digest('hex');
// Codes are shown grouped ("ABCD-EFGH-..."); accept them typed with or without dashes, spaces or lowercase.
function normalize(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
const b64u = buf => Buffer.from(buf).toString('base64url');

function parseEntries(raw) {
  const out = [], errors = [];
  String(raw || '').split(',').map(s => s.trim()).filter(Boolean).forEach((e, i) => {
    const [role, name, hash] = e.split(':');
    if (!ROLES.includes(role) || !name || !/^[a-f0-9]{64}$/.test(hash || '')) errors.push(`entry ${i + 1} is not "role:name:sha256"`);
    else out.push({ role, name, hash });
  });
  return { entries: out, errors };
}

function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createGate(env = process.env) {
  const off = env.GATE === 'off';
  const { entries, errors } = parseEntries(env.ACCESS_CODES);
  const secret = env.SESSION_SECRET || '';
  // Fail closed: a misconfigured gate locks everyone out instead of opening the site.
  const problems = [...errors];
  if (!off && !entries.length) problems.push('ACCESS_CODES has no valid entries, so nobody can sign in');
  if (!off && secret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');
  problems.forEach(p => console.warn('[gate] ' + p));
  if (off) console.warn('[gate] GATE=off: the site is open to anyone. Use this only on your own computer.');

  const sign = payload => crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  function issue(entry) {
    const payload = b64u(JSON.stringify({ n: entry.name, r: entry.role, h: entry.hash.slice(0, 12), e: Math.floor(Date.now() / 1000) + MAX_AGE_S }));
    return payload + '.' + sign(payload);
  }
  function verify(token) {
    if (!secret || !token || !token.includes('.')) return null;
    const [payload, sig] = token.split('.');
    if (!safeEqual(sig, sign(payload))) return null;
    let s; try { s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (e) { return null; }
    if (!s || s.e < Date.now() / 1000) return null;
    const entry = entries.find(x => x.name === s.n && x.role === s.r && x.hash.slice(0, 12) === s.h);
    return entry ? { name: entry.name, role: entry.role } : null;
  }

  // Failed sign-ins per IP, cleared every 15 minutes.
  const fails = new Map();
  setInterval(() => fails.clear(), 15 * 60e3).unref();

  const secure = req => req.secure || req.headers['x-forwarded-proto'] === 'https';
  const setCookie = (req, res, value, maxAge) => res.append('Set-Cookie',
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`);

  function loginPage(res, status, msg) {
    res.status(status).set('Cache-Control', 'no-store').type('html').send(LOGIN_HTML.replace('<!--MSG-->', msg ? `<p class="err" role="alert">${msg}</p>` : ''));
  }

  function routes(app) {
    app.get('/login', (req, res) => req.user ? res.redirect('/') : loginPage(res, 200));
    app.post('/login', (req, res) => {
      if (secret.length < 32) return loginPage(res, 503, 'Sign-in is not set up on the server yet.');
      const n = fails.get(req.ip) || 0;
      if (n >= 10) return loginPage(res, 429, 'Too many attempts. Wait 15 minutes and try again.');
      const h = hashCode((req.body || {}).code);
      const entry = normalize((req.body || {}).code) && entries.find(e => safeEqual(e.hash, h));
      if (!entry) { fails.set(req.ip, n + 1); return loginPage(res, 401, 'That code was not recognized.'); }
      setCookie(req, res, issue(entry), MAX_AGE_S);
      const hash = String((req.body || {}).h || '');
      res.redirect(303, '/' + (/^#[\w\-/]*$/.test(hash) ? hash : ''));
    });
    app.get('/logout', (req, res) => { setCookie(req, res, '', 0); res.redirect('/login'); });
    app.get('/api/me', (req, res) => res.json(req.user || null));
  }

  // Runs before everything else: identifies the visitor and blocks anyone not signed in.
  function middleware(req, res, next) {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    req.user = off ? { name: 'local', role: 'owner' } : verify(readCookie(req, COOKIE));
    if (req.user || req.path === '/login' || req.path === '/api/health') return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sign in required.' });
    if (req.method === 'GET' || req.method === 'HEAD') return res.redirect('/login');
    return res.status(401).end();
  }

  return { middleware, routes, problems, off };
}

const LOGIN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>NursePrepHub sign in</title>
<style>
:root{--bg:#F5F2EB;--panel:#EEECE7;--field:#FBFAF7;--ink:#293B36;--ink2:#4F5F59;--line:#CBC6BB;--accent:#3D5F56;--bad:#A8323F}
@media (prefers-color-scheme:dark){:root{--bg:#1C2422;--panel:#24302D;--field:#1F2926;--ink:#E6ECE9;--ink2:#B4C0BB;--line:#3D4B47;--accent:#A8C9BF;--bad:#F0A0A8}}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px 16px}
main{width:100%;max-width:400px;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:28px 24px}
h1{font-size:1.4rem;letter-spacing:-.02em;margin-bottom:6px}p{color:var(--ink2);font-size:.92rem}
label{display:block;font-weight:600;font-size:.86rem;margin:18px 0 6px}
input{width:100%;font:inherit;font-size:1.05rem;letter-spacing:.06em;padding:12px 14px;border:1.5px solid var(--line);border-radius:12px;background:var(--field);color:var(--ink)}
input:focus{outline:3px solid color-mix(in srgb,var(--accent) 35%,transparent);border-color:var(--accent)}
button{margin-top:14px;width:100%;min-height:48px;border:0;border-radius:12px;background:var(--accent);color:var(--bg);font:inherit;font-weight:700;cursor:pointer}
.err{color:var(--bad);font-weight:600;margin-top:12px}
</style></head><body><main>
<h1>NursePrepHub</h1><p>This preview is private. Enter your personal access code. You will stay signed in on this device for 30 days.</p>
<form method="post" action="/login"><label for="code">Access code</label>
<input id="code" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required autofocus>
<input type="hidden" name="h" id="h"><button type="submit">Sign in</button></form><!--MSG-->
</main><script>document.getElementById('h').value=location.hash||'';</script></body></html>`;

module.exports = { createGate, hashCode, normalize, parseEntries };
