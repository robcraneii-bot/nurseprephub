# NursePrepHub

Nursing study platform: lessons, flashcards, games, a practice engine (dosage, question bank, case studies) and AI study tools.
For education only, not medical advice. Not affiliated with MSJC or NCSBN. NCLEX is a trademark of its owner.

## Run locally

```
npm install
GATE=off npm start          # http://localhost:8080, gate disabled on your own computer only
```

## Private-access gate

The whole site and every API require a personal access code (see `gate.js`). Set these environment variables on the server:

| Variable | What it is |
|---|---|
| `ACCESS_CODES` | Comma-separated `role:name:hash` entries. Role is `owner` or `consultant`. |
| `SESSION_SECRET` | At least 32 random characters. Signs the 30-day sign-in cookie. Changing it signs everyone out. |
| `ANTHROPIC_API_KEY` | For the AI tools. |

Make a code (run it yourself, so the code is only shown on your screen):

```
npm run access-code -- consultant angel
```

It prints the code to give that person and the `ACCESS_CODES` entry to add on the server. Only the hash is stored.
To revoke someone, delete their entry and restart; their cookie stops working at once.
If `ACCESS_CODES` or `SESSION_SECRET` is missing, nobody can sign in (the gate fails closed).

## Care Plan Builder

Study and simulation only, with fictional cases. No real patient information: notes that look like they contain a
name, birth date, record number or other identifier are blocked in the page and again on the server, before anything
is sent or counted.

`POST /api/careplan` (see `careplan.js`) takes a `mode` plus fictional case notes (up to 5000 characters). The prompts
are built on the server, so the browser cannot change the instructions, and each reply is constrained to a
structured-output schema. Modes: `case` writes a fictional practice case, `organize` sorts notes into SOAP, and `plan`
drafts the ADPIE plan (prioritized nursing diagnoses with SOAP, SMART goals, interventions with rationales,
evaluation, SBAR handoff, recognize-cues sorting, and a missing or unclear list). It calls Claude Opus 5.5
(`claude-opus-5-5`) with refusal fallbacks on. Each call counts as one request toward the daily AI limit and is
refunded if it fails on our side. Case notes are not stored on the server.

Plans are edited, reordered, saved (in the student's own browser), exported as an HTML file and printed in the page.
Every AI item is labeled "AI draft, verify before use".

References: the AI never writes citations. `references/careplan-refs.json` holds hand-checked sources (2021 to 2026,
`verified: true`), served through `GET /api/careplan/refs`. Any rationale without a matching source shows
"Not yet verified".

## Checks

```
npm run check-questions     # validates questions/*.json
npm run check-content       # decodes every tool and fails on banned names or wording
npm run review              # local question review tool, http://localhost:8090
```

Study tools are stored base64-encoded in `index.html` (`TOOL_DATA`). Edit them with
`node scripts/tool-data.js extract <dir>`, change the HTML, then `node scripts/tool-data.js pack <dir>`.
