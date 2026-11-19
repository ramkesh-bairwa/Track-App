// The MyTrack web backend the app talks to. Everything the app does goes
// through this server's existing REST API (the same one the website uses) —
// no separate mobile backend. Override with EXPO_PUBLIC_API_URL to point at a
// local dev server (e.g. http://192.168.1.5:3006) while developing.
export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL || 'https://my-track.glamofashion.com';
