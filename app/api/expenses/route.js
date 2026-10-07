import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { EXPENSE_COLUMNS, isMonth, parseExpense } from '@/lib/expensesServer';

// One month's expenses (?month=YYYY-MM), plus the month before's total to compare.
export const GET = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const month = new URL(request.url).searchParams.get('month');
  if (!isMonth(month)) return NextResponse.json({ error: 'Give a month like 2026-10.' }, { status: 400 });

  const start = `${month}-01`;
  const [expenses, [prev]] = await Promise.all([
    query(
      `SELECT ${EXPENSE_COLUMNS} FROM expenses
        WHERE user_id = ? AND spent_on >= ? AND spent_on < DATE_ADD(?, INTERVAL 1 MONTH)
        ORDER BY spent_on DESC, id DESC`,
      [user.id, start, start]
    ),
    query(
      `SELECT CAST(COALESCE(SUM(amount), 0) AS DOUBLE) AS total FROM expenses
        WHERE user_id = ? AND spent_on >= DATE_SUB(?, INTERVAL 1 MONTH) AND spent_on < ?`,
      [user.id, start, start]
    ),
  ]);
  return NextResponse.json({ expenses, previousTotal: prev.total });
});

export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { value, error } = parseExpense(await request.json().catch(() => ({})));
  if (error) return NextResponse.json({ error }, { status: 400 });

  const res = await query(
    'INSERT INTO expenses (user_id, spent_on, amount, description, category, payment_method, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [user.id, value.spent_on, value.amount, value.description, value.category, value.payment_method, value.note]
  );
  return NextResponse.json({ ok: true, id: res.insertId });
});
