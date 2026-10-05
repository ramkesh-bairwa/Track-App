// Daily Expenses: validation and the SELECT list shared by the API routes.
import { isDate } from './calendarServer';

export const EXPENSE_CATEGORIES = [
  'food', 'groceries', 'transport', 'fuel', 'shopping', 'bills', 'rent', 'health',
  'education', 'entertainment', 'travel', 'gifts', 'personal', 'other',
];
export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank', 'wallet', 'other'];

// spent_on comes back as 'YYYY-MM-DD' (see calendarServer's note on DATE
// columns) and amount as a plain number.
export const EXPENSE_COLUMNS = `id, DATE_FORMAT(spent_on, '%Y-%m-%d') AS spent_on, CAST(amount AS DOUBLE) AS amount,
  description, category, payment_method, note`;

export const isMonth = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function parseExpense(body) {
  if (!isDate(body.spent_on)) return { error: 'Pick a valid date.' };
  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter an amount above 0.' };
  if (amount >= 1e10) return { error: 'That amount is too large.' };
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 255) : '';
  if (!description) return { error: 'Say what the money was spent on.' };
  return {
    value: {
      spent_on: body.spent_on,
      amount,
      description,
      category: EXPENSE_CATEGORIES.includes(body.category) ? body.category : 'other',
      payment_method: PAYMENT_METHODS.includes(body.payment_method) ? body.payment_method : 'cash',
      note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null,
    },
  };
}
