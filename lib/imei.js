// IMEI checks shared by the IMEI tab (components/tools/ImeiPanel.js) and the
// saved-devices API. An IMEI is 15 digits; the last is a Luhn check digit.

export const luhnCheckDigit = (digits14) => {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(digits14[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
};

export const imeiDigits = (raw) => String(raw ?? '').replace(/[\s\-/.]/g, '');

const split = (imei) => ({ imei, tac: imei.slice(0, 8), serial: imei.slice(8, 14), check: imei[14] });

// { ok, kind, message, parts? } for whatever was typed, or null when empty.
export function checkImei(raw) {
  const digits = imeiDigits(raw);
  if (!digits) return null;
  if (!/^\d+$/.test(digits)) return { ok: false, message: 'An IMEI has digits only.' };
  if (digits.length === 14) {
    const check = luhnCheckDigit(digits);
    return { ok: true, kind: 'imei14', message: `14 digits — the full IMEI ends with check digit ${check}: ${digits}${check}`, parts: split(`${digits}${check}`) };
  }
  if (digits.length === 16) {
    return {
      ok: true,
      kind: 'imeisv',
      message: 'This is an IMEISV (IMEI + 2-digit software version). The IMEI is its first 14 digits plus a check digit.',
      parts: split(`${digits.slice(0, 14)}${luhnCheckDigit(digits.slice(0, 14))}`),
    };
  }
  if (digits.length !== 15) return { ok: false, message: `An IMEI has 15 digits — this has ${digits.length}.` };
  const expected = luhnCheckDigit(digits.slice(0, 14));
  if (Number(digits[14]) !== expected) {
    return { ok: false, message: `The check digit doesn’t match (expected ${expected}, got ${digits[14]}) — there’s probably a typo.` };
  }
  return { ok: true, kind: 'imei', message: 'Valid IMEI.', parts: split(digits) };
}

// The 15-digit IMEI to store, or null when `raw` isn't one.
export function normalizeImei(raw) {
  const r = checkImei(raw);
  return r?.ok ? r.parts.imei : null;
}
