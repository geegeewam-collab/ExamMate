# ExamMate

ExamMate is a mobile-first study reader. Students can photograph exam pages or paste/import text, receive organised answers, and listen phrase by phrase while writing. Mathematical notation stays visible as symbols while speech explains each symbol; programming answers retain their source formatting, remain visible as complete code blocks with the active line highlighted, and are read one code line at a time. It includes Quick and Learn answer modes, a reading engine, Voice Ask, saved answer history, and a parent-admin license dashboard.

## Requirements

- Node.js 20 or newer (Node 22 is used in CI).
- npm.
- A deployed ExamMate API with Gemini and Upstash Redis configured for photo answering and license/admin services.
- Android Studio and an Android SDK for local Android builds. iOS builds require macOS and Xcode.

## Local development

1. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_API_URL` to the deployed API URL.
2. Install dependencies with `npm ci`.
3. Run `npm run dev` for the web app.
4. Run `npm run typecheck` and `npm test` before committing.

The native app embeds `NEXT_PUBLIC_API_URL` at build time and talks to the deployed server. The Next.js web deployment hosts the UI and `/api/*` routes.

## Environment variables

See `.env.example`. `ADMIN_PASSWORD`, `TOKEN_SECRET`, `GEMINI_API_KEY`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` are server-only values. `NEXT_PUBLIC_API_URL` is intentionally public and is embedded in native builds. Never commit `.env.local`, signing keys, or real credentials.

## Android

- `npm run cap:sync` builds the static web export and syncs the Android project. Set `NEXT_PUBLIC_API_URL` first.
- `npm run cap:open` opens the Android project in Android Studio.
- The release APK workflow is `.github/workflows/android-apk.yml`. It runs on version tags (`v*`) or manual dispatch and expects the four `ANDROID_*` signing secrets described in the workflow.

## iOS

- `npm run cap:add-ios` creates the iOS platform if it does not exist.
- `npm run cap:sync:ios` builds and syncs the iOS project.
- `npm run cap:open:ios` opens it in Xcode on macOS.

## Tests

`npm test` runs the TypeScript tests under `tests/` by compiling the test sources with the project-pinned TypeScript compiler and executing them with Node’s test runner. No runtime package download is required. `npm run typecheck` runs the strict TypeScript check. CI runs both before building the APK.

## Project map

- `app/` – Next.js app pages and API route handlers.
- `src/components/` – student interface, reader, history, settings and admin screens.
- `src/lib/` – reading engine, speech/text utilities, image processing and settings.
- `src/services/` – Gemini, license, storage and answer service clients.
- `server/` – Gemini orchestration, answer/voice APIs, license, admin authentication and Redis store.
- `android/` – Capacitor Android project.
- `scripts/` – native export, setup and test scripts.
- `tests/` – regression and unit tests.
