import mysql from 'mysql2/promise';

// Keep one pool per process. `next dev` re-evaluates this module on every hot
// reload (and per route bundle), so a plain module-level variable created a new
// 10-connection pool each time and never closed the old ones - enough reloads
// exhausted MySQL's max_connections ("Too many connections") for every app on
// the server.
const globalForDb = globalThis;

export function getPool() {
  if (!globalForDb.__myTrackPool) {
    globalForDb.__myTrackPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'my_track',
      waitForConnections: true,
      connectionLimit: 10,
      maxIdle: 10,
      idleTimeout: 60000,
      queueLimit: 0,
    });
  }
  return globalForDb.__myTrackPool;
}

export async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}
