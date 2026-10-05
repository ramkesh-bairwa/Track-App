// The locale every on-screen date is formatted with. It's fixed (not the
// runtime default) so server-rendered dates match the browser's on hydration —
// Node and the browser often disagree (en-US "Oct 1, 2026" vs en-GB "1 Oct 2026").
export const DATE_LOCALE = 'en-GB';
