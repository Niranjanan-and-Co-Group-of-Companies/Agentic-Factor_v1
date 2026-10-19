# Agentic Factor — mobile app (iOS + Android)

Expo SDK 58 (React Native), Expo Router. Talks to the same API as the website (`EXPO_PUBLIC_API_URL`,
default https://agenticfactor.io); the API's shapes are shared with the website through
`../src/lib/contracts`.

## Run it

```bash
cd mobile
nvm use            # Node 22 (see .nvmrc) — Expo SDK 58 needs 22.13 or newer
npm install
npx expo start     # scan the QR code with Expo Go (iPhone camera / Android Expo Go app)
```

Sign in with Apple and in-app purchases need a development build (`npx eas-cli@latest build --profile development`).

## Checks

```bash
npx tsc --noEmit
npx expo lint
npx expo-doctor
```

## Layout

- `src/app/` — screens (Expo Router): `sign-in`, `(tabs)/index` (Assistant), `(tabs)/missions`, `(tabs)/account`
- `src/components/` — chat view, cards (runs and approvals, builds, results), UI building blocks
- `src/lib/` — API client (session token, streamed replies), sign-in, chat engine, card actions
- `src/theme/` — colours (the website's tokens), spacing, text sizes
