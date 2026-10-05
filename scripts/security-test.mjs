/**
 * MyTrack security self-test (CLI) — a defensive test harness for YOUR OWN
 * running MyTrack instance. Shares its checks with the in-app "Test site"
 * page via lib/securityChecks.js.
 *
 *   npm run security-test                 # against http://localhost:3000
 *   BASE_URL=http://localhost:3001 npm run security-test
 *   npm run security-test -- auth idor    # only some categories
 *
 * Point it only at a server you control.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { runSuite, summarize, CATS, CAT_LABELS, INJECTION_CHEATSHEET } from '../lib/securityChecks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const categories = process.argv.slice(2).map((s) => s.toLowerCase()).filter((c) => CATS.includes(c));

function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0 && !(t.slice(0, i).trim() in process.env)) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}
async function cleanup(tag) {
  loadEnv();
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'my_track',
    });
    const [r] = await conn.query('DELETE FROM users WHERE email LIKE ?', [`${tag}-%@example.test`]);
    await conn.end();
    return r.affectedRows;
  } catch (e) {
    return `skipped (${e.message})`;
  }
}

const C = { CRITICAL: '\x1b[41m\x1b[97m', HIGH: '\x1b[31m', MEDIUM: '\x1b[33m', LOW: '\x1b[36m', INFO: '\x1b[90m', reset: '\x1b[0m', green: '\x1b[32m', bold: '\x1b[1m' };

async function main() {
  const { results, tag, error } = await runSuite({ base: BASE, categories, ratelimitAttempts: 25 });
  if (error && !results.length) {
    console.error(error + ` (target ${BASE})`);
    process.exit(1);
  }
  const s = summarize(results);
  console.log(`\n${C.bold}MyTrack security self-test${C.reset}  ·  target ${BASE}  ·  ${new Date().toLocaleString()}`);
  console.log(`${s.passed} defended · ${s.failed} weakness${s.failed === 1 ? '' : 'es'} to review\n`);

  const byCat = {};
  for (const r of results) (byCat[r.cat] ||= []).push(r);
  for (const cat of CATS.filter((c) => byCat[c])) {
    console.log(`${C.bold}[${cat.toUpperCase()}] ${CAT_LABELS[cat]}${C.reset}`);
    for (const r of byCat[cat]) {
      console.log(`  ${r.ok ? `${C.green}✓ pass${C.reset}` : `${C[r.severity]} ✗ ${r.severity}${C.reset}`}  ${r.name}`);
      if (!r.ok) {
        console.log(`         ${r.detail}`);
        console.log(`         ${C.INFO}try:${C.reset} ${r.howToInject}`);
      }
    }
    console.log('');
  }

  const md = [
    `# MyTrack security self-test report`,
    `- Target: ${BASE}`,
    `- Run: ${new Date().toISOString()}`,
    `- Result: **${s.passed} defended, ${s.failed} to review**\n`,
  ];
  if (s.failed) {
    md.push(`## Weaknesses to review (most severe first)\n`);
    md.push(`| Severity | Area | Check | What was observed | How to reproduce |`);
    md.push(`|---|---|---|---|---|`);
    for (const r of s.fails) md.push(`| ${r.severity} | ${CAT_LABELS[r.cat]} | ${r.name} | ${r.detail} | \`${r.howToInject.replace(/\|/g, '\\|')}\` |`);
    md.push('');
  }
  md.push(`## Checks that passed (${s.passed})\n`);
  for (const r of s.passes) md.push(`- ✓ [${r.cat}] ${r.name} — ${r.detail}`);
  md.push(`\n## Injection cheat-sheet\n`);
  for (const c of INJECTION_CHEATSHEET) md.push(`- **${c.label}** (${c.where}): ${c.items.map((i) => '`' + i + '`').join(', ')}`);
  fs.writeFileSync(path.join(__dirname, '..', 'security-report.md'), md.join('\n') + '\n');
  console.log(`Full report written to security-report.md`);

  const removed = await cleanup(tag);
  console.log(`Cleanup: removed throwaway test data (${removed}).`);
}

main().catch((e) => {
  console.error('Test run error:', e.message);
  process.exit(1);
});
