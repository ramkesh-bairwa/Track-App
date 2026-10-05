/**
 * Self-hosts tesseract.js for the Text Extractor: the worker script, the
 * LSTM-only core builds (tesseract.js v7 loads one of these by default, picked
 * by the browser's SIMD support) and the English + Hindi language data, all
 * under public/tesseract. The site's CSP only allows same-origin fetches, so
 * nothing may come from a CDN at runtime. Language files are downloaded once
 * and kept; the rest is re-copied on every run.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const mod = (p) => path.join(root, 'node_modules', p);
const dest = path.join(root, 'public', 'tesseract');
const LANGS = ['eng', 'hin'];
const LANG_URL = (l) => `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`;
const CORES = ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'];

function download(url, file, hops = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, file, hops + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`${url} → HTTP ${res.statusCode}`));
      }
      const tmp = `${file}.part`;
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, file); resolve(); }));
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(mod('tesseract.js')) || !fs.existsSync(mod('tesseract.js-core'))) {
    console.log('tesseract.js not installed; skipping copy.');
    return;
  }
  fs.mkdirSync(path.join(dest, 'core'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'lang'), { recursive: true });
  fs.copyFileSync(mod('tesseract.js/dist/worker.min.js'), path.join(dest, 'worker.min.js'));
  for (const f of CORES) fs.copyFileSync(mod(`tesseract.js-core/${f}`), path.join(dest, 'core', f));
  for (const l of LANGS) {
    const file = path.join(dest, 'lang', `${l}.traineddata.gz`);
    if (fs.existsSync(file) && fs.statSync(file).size > 0) continue;
    try {
      await download(LANG_URL(l), file);
      console.log(`Downloaded ${l}.traineddata.gz`);
    } catch (err) {
      // Don't fail `npm install` over a network hiccup; OCR in that language
      // just won't work until this runs again.
      console.warn(`Could not download ${l}.traineddata.gz: ${err.message}`);
    }
  }
  const version = require(mod('tesseract.js/package.json')).version;
  fs.writeFileSync(path.join(dest, 'VERSION'), version);
  console.log(`Copied tesseract.js ${version} to public/tesseract`);
}

main().catch((err) => {
  console.warn(`copy-tesseract: ${err.message}`);
});
