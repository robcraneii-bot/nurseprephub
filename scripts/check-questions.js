// Validates every file in /questions. Exit code 1 if anything is wrong.
const bank = require('../practice/bank');
const errors = bank.errors();
for (const s of bank.listSets()) console.log(`${s.set}: ${s.total} question(s) — ` + s.categories.map(c => `${c.name} ${c.count}`).join(', '));
if (errors.length) { console.error(`\n${errors.length} problem(s):\n- ` + errors.join('\n- ')); process.exit(1); }
console.log('\nAll questions valid.');
