# MyTrack Mobile (Expo / React Native)

The MyTrack phone app (iOS + Android). It is a **pure client of the web
backend's REST API** — it has no database or server of its own. Everything it
shows comes from the same `/api/...` routes the website uses, on the same
account.

## How auth works

- The app signs in with `POST /api/auth/login` and gets a `token` back.
- It stores that token (AsyncStorage) and sends it on every request as
  `Authorization: Bearer <token>`.
- The server's `getCurrentUser()` accepts that header exactly like the
  website's session cookie, so **every existing API works from the app with no
  mobile-specific backend**.

## Point it at a server

The default server is `https://my-track.glamofashion.com` (see `src/config.js`).
To use a local dev server, set an env var before starting:

```bash
# physical phone must reach your Mac's LAN IP, not localhost
EXPO_PUBLIC_API_URL=http://192.168.1.5:3010 npx expo start
```

## Run it

```bash
cd mobile
npm install
npx expo start          # then scan the QR with Expo Go (iOS/Android)
# or: npm run ios / npm run android   (needs a simulator/emulator)
```

## Build installable apps

Uses EAS (Expo Application Services):

```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview   # .apk
eas build -p ios --profile preview       # needs an Apple account
```

## What's in it

- **Login** → token stored, auto-restored on next launch.
- **Home** → menu.
- **Tracks** → `GET /api/tracks`, tap a track → its records (`/api/tracks/:id/entries`).
- **Task boards** → `GET /api/task-boards`.
- **Notes** → `GET /api/notes`.

Adding a screen = call another existing API in `src/api.js` and render it; no
backend change needed.

## Structure

```
App.js                 auth gate + simple screen stack
src/config.js          API base URL
src/api.js             fetch wrapper (attaches Bearer token)
src/storage.js         token persistence (AsyncStorage)
src/Header.js, ui.js, theme.js   shared UI
src/screens/*          Login, Home, Tracks, TrackDetail, Tasks, Notes
```
