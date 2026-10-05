/**
 * Makes an existing account an admin (sees and deletes everyone's tracker
 * screenshots, and can make other admins from the Users page).
 * Usage: npm run make-admin -- you@example.com
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.trim().match(/^([^#=]+)=(.*)$/);
    if (m && !(m[1].trim() in process.env)) process.env[m[1].trim()] = m[2].trim();
  }
}

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) throw new Error('Give the account email: npm run make-admin -- you@example.com');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'my_track',
  });
  const [result] = await connection.query('UPDATE users SET is_admin = 1 WHERE LOWER(email) = ?', [email]);
  await connection.end();
  if (!result.affectedRows) throw new Error(`No account uses ${email}.`);
  console.log(`${email} is now an admin.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
