/**
 * Copies pdf.js (legacy build, widest browser support) plus its fonts/cmaps
 * into public/pdfjs so the PDF editor can load it at runtime without the
 * bundler touching it. Runs automatically after `npm install`.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'pdfjs-dist');
const dest = path.join(root, 'public', 'pdfjs');

if (!fs.existsSync(src)) {
  console.log('pdfjs-dist not installed; skipping copy.');
  process.exit(0);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  fs.copyFileSync(path.join(src, 'legacy', 'build', f), path.join(dest, f));
}
for (const dir of ['cmaps', 'standard_fonts']) {
  if (fs.existsSync(path.join(src, dir))) fs.cpSync(path.join(src, dir), path.join(dest, dir), { recursive: true });
}
const version = require(path.join(src, 'package.json')).version;
fs.writeFileSync(path.join(dest, 'VERSION'), version);
console.log(`Copied pdf.js ${version} to public/pdfjs`);
