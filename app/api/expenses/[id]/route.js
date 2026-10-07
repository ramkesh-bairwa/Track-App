import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { EXPENSE_COLUMNS, parseExpense } from '@/lib/expensesServer';

async function ownExpense(id, user) {
  const rows = await query(`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE id = ? AND user_id = ?`, [Number(id) || 0, user.id]);
  return rows[0] || null;
}

export const PATCH = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const expense = await ownExpense(params.id, user);
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { value, error } = parseExpense({ ...expense, ...body });
  if (error) return NextResponse.json({ error }, { status: 400 });

  await query(
    'UPDATE expenses SET spent_on = ?, amount = ?, description = ?, category = ?, payment_method = ?, note = ? WHERE id = ?',
    [value.spent_on, value.amount, value.description, value.category, value.payment_method, value.note, expense.id]
  );
  return NextResponse.json({ ok: true });
});

export const DELETE = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const expense = await ownExpense(params.id, user);
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await query('DELETE FROM expenses WHERE id = ?', [expense.id]);
  return NextResponse.json({ ok: true });
});
