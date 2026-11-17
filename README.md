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

## Care Plan Generator

`POST /api/careplan` (see `careplan.js`) takes form fields only; the prompt is built on the server, so the browser
cannot change the instructions. It calls Claude Opus 5.5 (`claude-opus-5-5`) through the official Anthropic SDK with a
structured-output schema, so every plan has the same shape: prioritized nursing diagnoses with related-to and
evidenced-by statements, goals, interventions with rationales, evaluation, teaching and urgent flags. Refusal
fallbacks are on (`fallbacks: "default"`). Each plan counts as one request toward the daily AI limit.
Students can edit, reorder, save (in their own browser), print and copy plans.

## Checks

```
npm run check-questions     # validates questions/*.json
npm run check-content       # decodes every tool and fails on banned names or wording
npm run review              # local question review tool, http://localhost:8090
```

Study tools are stored base64-encoded in `index.html` (`TOOL_DATA`). Edit them with
`node scripts/tool-data.js extract <dir>`, change the HTML, then `node scripts/tool-data.js pack <dir>`.
