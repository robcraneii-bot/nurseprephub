# Question files

Each `.json` file in this folder is one practice set. The server loads them at startup, checks them, and grades
answers itself, so answer keys and explanations never reach the browser before a student submits.
This folder is **not** served to visitors.

After editing, run:

```
npm run check-questions
```

It lists any problem (missing field, answer not among the options, a calc answer that isn't rounded the way the
question says, and so on). Invalid questions are skipped by the site and logged at startup.

## Reviewing questions

```
npm run review
```

Then open http://localhost:8090. It runs only on your own computer (it isn't part of the deployed site) and shows every
question with its answer key, rationale, source and any student reports (from `data/reports.jsonl`). You can:

- **Mark reviewed.** This needs your initials and a `source`. It sets `verified: true`, `reviewedBy` and `reviewedAt`.
- **Save a reviewer note** (`reviewNote`). Students never see it.
- **Edit JSON** to fix a question. Changes are checked the same way the site checks them. If you change a reviewed
  question, it goes back to "Needs review".

Changes are written to the files in this folder. Commit them and redeploy to publish them.

## Set file

```json
{
  "set": "dosage",                 // unique id, used in the URL: #practice/dosage
  "mode": "dosage",                // "dosage" adds the calculation workspace and rounding panel; otherwise "bank"
  "tier": "free",                  // "free" or "pro"
  "title": "Dosage Calculation Challenge",
  "description": "One line shown on the practice page.",
  "roundingRules": ["..."],        // optional; shown in the Rounding reference panel
  "categories": [ { "id": "iv-pump", "name": "IV Flow Rates – Electronic Pump" } ],
  "questions": [ ... ]
}
```

## Fields every question can use

| Field | Required | What it is |
|---|---|---|
| `id` | yes | Unique across all files, e.g. `dosage-q1`. Don't change it after publishing; saved progress uses it. |
| `category` | yes | One of the set's category ids. |
| `format` | yes | `mc`, `sata`, `priority`, `delegation`, `case`, `order`, `calc`, `ekg`, `match`, `fill`. |
| `stem` | yes | The question being asked. |
| `explanation` | yes | Why the correct answer is correct. |
| `number` | no | Display number, e.g. `7`. Defaults to its position. |
| `patient` | no | Patient information, shown separately from the question. |
| `order` | no | The medication or provider order. |
| `available` | no | What is on hand (concentration, supplies, drop factor). |
| `case` | `case` only | Scenario text for a clinical judgment question. |
| `image` | no | Path to an image, e.g. `img/strips/afib.png` (EKG strips). |
| `why` | no | For choice questions: `{ "B": "why B is wrong", ... }`. |
| `steps` | no | Worked solution: `[{ "work": "500 mg × 1 tab / 250 mg", "explain": "..." }]`. |
| `mistakes` | no | Common mistakes to avoid, as a list. |
| `hints` | no | Hints that don't give the answer away, revealed one at a time. |
| `formula` | no | The formula to show when the student asks for it. |
| `concept` | no | The key nursing concept. |
| `lesson` | no | Related tool id to link to (`medmath`, `ekg`, `cardpharm`, ...). |
| `difficulty` | no | `beginner`, `intermediate`, `advanced`, `nclex`. |
| `source` | no | Where the question and rationale come from (textbook, edition, page). |
| `verified` | no | `true` once reviewed. Unverified questions show a "Not yet verified" label. |
| `reviewedBy`, `reviewedAt`, `reviewNote` | no | Set by the review tool. Never sent to students. |

## Format-specific answers

| Format | Answer shape |
|---|---|
| `mc`, `priority`, `delegation`, `ekg`, `case` | `"options": [{"id":"A","text":"..."}]`, `"answer": "A"` |
| `sata` | `"options": [...]`, `"answer": ["A","C","D"]` |
| `order` (drag and drop) | `"options": [...]`, `"answer": ["C","A","D","B"]` (every id, first to last). Options are shuffled for the student. |
| `match` | `"left": [{"id":"1","text":"..."}]`, `"right": [{"id":"a","text":"..."}]`, `"answer": {"1":"c","2":"a"}` |
| `fill` | `"answer": ["accepted answer", "another accepted spelling"]` (not case sensitive) |
| `calc` | see below |
| `matrix` | `"rows": [{"id":"r1","text":"..."}]`, `"columns": [{"id":"ind","text":"Indicated"}]`, `"answer": {"r1":"ind"}` (one column per row). `why` can be keyed by row id. Partial credit is shown per row. |
| `cloze` | `"template": "The client has {{1}} because {{2}}."`, `"blanks": [{"id":"1","label":"Condition","options":[{"id":"A","text":"..."}]}]`, `"answer": {"1":"A"}` |

Any question can also carry `"ncjmm"`: one of `recognize-cues`, `analyze-cues`, `prioritize-hypotheses`,
`generate-solutions`, `take-action`, `evaluate-outcomes` (the six clinical judgment steps). Case study results are grouped by it.

## Case study sets (`"mode": "case"`)

`cases.json` holds unfolding case studies. The questions live in `questions` like any other set, and a `cases` list
says how they unfold. Every question must belong to exactly one case.

```json
"cases": [{
  "id": "case-hf", "category": "cardiovascular", "title": "Shortness of breath after missed diuretics",
  "setting": "Medical-surgical unit", "difficulty": "nclex", "summary": "One line for the case list",
  "debrief": "Shown on the results screen.",
  "tabs": [{"id":"notes","name":"Nurses' notes"}, {"id":"vitals","name":"Vital signs"}, {"id":"labs","name":"Labs"}, {"id":"orders","name":"Orders"}],
  "stages": [{
    "step": "recognize-cues", "title": "Admission, 0800", "text": "What is happening now.",
    "chart": [
      {"tab":"notes", "time":"0800", "title":"Admission assessment", "text":"Free text."},
      {"tab":"vitals", "time":"0800", "rows": [["Heart rate","108/min","high"], ["Temperature","36.8 C"]]}
    ],
    "questions": ["case-hf-q1"]
  }]
}]
```

Chart entries add up as the case goes on; entries from the current stage are marked New. A row's third value flags
it: `high`, `low`, `crit` or `abn`. A student cannot move to the next question in a case until they answer (or view the
explanation for) the current one. Chart text for later stages is sent to the browser with the set, so do not put
answers in it.

### `calc` (medication calculations)

```json
{
  "format": "calc",
  "unit": "mL/hr",                       // shown next to the answer box
  "answer": 0,                           // the correctly rounded answer
  "exact": 0,                            // optional: the unrounded result; the checker confirms it rounds to "answer"
  "rounding": { "to": 1, "label": "to the nearest whole number", "special": false, "note": "" },
  "unitChoices": ["mL/hr", "gtt/min"],   // optional: makes the student pick the unit too, and grades it
  "acceptUnits": ["mL/h"],               // optional: other spellings of the correct unit
  "tolerance": 0                         // optional: allowed difference; default is exact after rounding
}
```

`rounding.to` is `0.1` (tenths), `0.01` (hundredths) or `1` (whole numbers). Set `"special": true` and put the
instruction in `note` when a question has its own rounding rule; it is then shown highlighted instead of the
standard rule. An answer with the right calculation but wrong rounding is marked incorrect with a rounding tip.
Answers written as `.5` or `2.50` are graded on their value, with a medication-safety note about leading and trailing zeros.
