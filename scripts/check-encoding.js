const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ignoredDirs = new Set([
  '.git',
  '.next',
  'coverage',
  'node_modules',
  'public',
]);
const extensions = new Set([
  '.css',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
]);
const suspiciousTokens = [
  String.fromCharCode(0xfffd),
  String.fromCharCode(0x951f, 0x65a4, 0x62f7),
  String.fromCharCode(0x00c3),
  String.fromCharCode(0x00c2),
  String.fromCharCode(0x00e2),
];
const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        walk(path.join(dir, entry.name));
      }
      continue;
    }

    const file = path.join(dir, entry.name);
    if (!extensions.has(path.extname(file))) {
      continue;
    }

    const text = fs.readFileSync(file, 'utf8');
    if (suspiciousTokens.some((token) => text.includes(token))) {
      failures.push(path.relative(root, file));
    }
  }
}

walk(root);

if (failures.length > 0) {
  console.error('Encoding check failed:');
  failures.forEach((file) => console.error(`- ${file}`));
  process.exit(1);
}

console.log('Encoding check passed.');
