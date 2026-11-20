import { NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { applySchemaCompletion } from '@/lib/schemaMigrate';

export const dynamic = 'force-dynamic';

// Runs a .sql dump (from Export → SQL) straight against the database — a raw
// restore. It can create/drop tables and insert rows for every user, so it is
// admin-only. Best on a fresh/empty database (e.g. a new desktop install); on a
// database that already has the data, the dump's rows collide on their primary
// keys and the restore reports the first conflict.
export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!user.is_admin) {
    return NextResponse.json({ error: 'Only an admin can import a SQL file.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const sql = typeof body?.sql === 'string' ? body.sql.trim() : '';
  if (!sql) return NextResponse.json({ error: 'Choose a .sql file to import.' }, { status: 400 });
  // A MyTrack SQL export always starts with its header/SET lines and only ever
  // creates/inserts — reject anything that isn't recognisably one.
  if (!/\b(CREATE TABLE|INSERT INTO|DROP TABLE)\b/i.test(sql)) {
    return NextResponse.json({ error: 'That file does not look like a MyTrack SQL export.' }, { status: 400 });
  }

  // A dedicated connection with multipleStatements — the shared pool keeps it
  // off on purpose, so a normal query can never run more than one statement.
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'my_track',
    multipleStatements: true,
  });
  try {
    await conn.query(sql);
    // A restored dump can be older than the running app and so miss columns the
    // app selects (which would 500 every page). Bring the schema back up to date
    // without dropping anything. Best-effort — never fails the import.
    const healed = await applySchemaCompletion(conn, process.env.DB_NAME);
    return NextResponse.json({ ok: true, healed });
  } catch (err) {
    // Give the real database error back (e.g. a duplicate key on a non-empty DB)
    // instead of a generic 500, so the person knows what to do.
    return NextResponse.json(
      { error: `The database rejected the SQL: ${err.sqlMessage || err.message}` },
      { status: 400 }
    );
  } finally {
    await conn.end();
  }
});
