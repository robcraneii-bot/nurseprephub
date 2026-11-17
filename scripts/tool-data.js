// Unpack and repack the study tools stored as base64 in index.html (const TOOL_DATA={"id": "<base64>", ...}).
//   node scripts/tool-data.js extract <dir>   writes <dir>/<id>.html for every tool
//   node scripts/tool-data.js pack <dir>      re-encodes any <dir>/<id>.html that changed and updates index.html
//   node scripts/tool-data.js list            prints each tool id and its decoded size
// The browser decodes with decodeURIComponent(escape(atob(data))), which is plain UTF-8 base64, so that is what pack writes.
const fs = require('fs');
const path = require('path');

const INDEX = path.join(__dirname, '..', 'index.html');
const RE = /const TOOL_DATA=(\{[^\n]*?\});\n/;

function read() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const m = html.match(RE);
  if (!m) throw new Error('TOOL_DATA not found in index.html');
  return { html, m, data: JSON.parse(m[1]) };
}
const decode = b64 => Buffer.from(b64, 'base64').toString('utf8');
const encode = s => Buffer.from(s, 'utf8').toString('base64');

function tools() {
  const { data } = read();
  return Object.fromEntries(Object.entries(data).map(([id, b64]) => [id, decode(b64)]));
}

if (require.main === module) {
  const [cmd, dir] = process.argv.slice(2);
  if (cmd === 'list') {
    for (const [id, html] of Object.entries(tools())) console.log(`${id}\t${html.length}`);
  } else if (cmd === 'extract' && dir) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [id, html] of Object.entries(tools())) fs.writeFileSync(path.join(dir, id + '.html'), html);
    console.log(`Extracted ${Object.keys(tools()).length} tools to ${dir}`);
  } else if (cmd === 'pack' && dir) {
    const { html, m, data } = read();
    const changed = [];
    for (const id of Object.keys(data)) {
      const f = path.join(dir, id + '.html');
      if (!fs.existsSync(f)) continue;
      const src = fs.readFileSync(f, 'utf8');
      if (src !== decode(data[id])) { data[id] = encode(src); changed.push(id); }
    }
    if (!changed.length) return console.log('No tool changed.');
    // Keep the original spacing ({"id": "...", ...}) so the diff stays limited to the edited entries.
    const json = '{' + Object.entries(data).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ') + '}';
    fs.writeFileSync(INDEX, html.replace(m[0], () => `const TOOL_DATA=${json};\n`));
    console.log('Repacked: ' + changed.join(', '));
  } else {
    console.log('Usage: node scripts/tool-data.js extract <dir> | pack <dir> | list');
    process.exit(1);
  }
}
module.exports = { tools, decode, encode };
