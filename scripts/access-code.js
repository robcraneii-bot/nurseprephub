// Make a personal access code for the private-access gate (see gate.js).
//   npm run access-code -- <owner|consultant> <name>
// Prints the code once (give it to that person privately) and the ACCESS_CODES entry to add on the server.
// Only the hash goes on the server; the code itself is not saved anywhere.
const crypto = require('crypto');
const { hashCode } = require('../gate');

const [role, ...nameParts] = process.argv.slice(2);
const name = nameParts.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
if (!['owner', 'consultant'].includes(role) || !name) {
  console.log('Usage: npm run access-code -- <owner|consultant> <name>\nExample: npm run access-code -- consultant angel');
  process.exit(1);
}
// 20 characters of Crockford base32 (no I, L, O or U), about 100 bits of randomness.
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const raw = Array.from(crypto.randomBytes(20), b => ALPHA[b % 32]).join('');
const code = raw.match(/.{4}/g).join('-');
console.log(`\nAccess code for ${name} (${role}). Share it privately; it is not stored anywhere:\n\n  ${code}\n`);
console.log(`Add this entry to ACCESS_CODES on the server (comma-separated with the others):\n\n  ${role}:${name}:${hashCode(code)}\n`);
