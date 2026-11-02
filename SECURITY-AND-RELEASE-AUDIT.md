# Security and release checklist

## Server configuration

- Set `ADMIN_PASSWORD` to a unique password of at least 16 characters.
- Set `TOKEN_SECRET` to at least 32 random characters (preferably 64 random hexadecimal characters). Keep it stable; changing it invalidates signed sessions and tokens.
- Configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from the same Upstash REST database.
- Configure `GEMINI_API_KEY` for owner-side photo answering. Students using their own Gemini key supply it on their device.
- Open `/api/health` after deployment and resolve any reported configuration/database issue.

## Admin access

The first successful parent-admin sign-in binds the parent role to that browser/device identity. Sign-ins from other device identities are read-only; named guest accounts are also read-only. The parent can change the password and invalidate other admin sessions. Use the parent device's admin dashboard to manage guest access and license device resets.

## Android release

The active workflow is `.github/workflows/android-apk.yml`. It runs after a `v*` tag or manual dispatch. It performs TypeScript checks and tests, builds/syncs the web bundle, signs the APK and publishes it. Required GitHub Actions secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Optional variables/secrets control the deployed API/support URLs and release repository/token.

## Before publishing

- Run `npm ci`, `npm run typecheck`, `npm test`, and the production build.
- Build and install the APK on a physical Android device.
- Test multi-page uploads, complete answer delivery, stop/cancel, resume after Settings/History, hardware Back, voice code-line reading, symbols, permissions and offline behaviour.
- Verify the deployed `/api/health` response and a real license activation.

No static checklist can guarantee a crash-free release on every device; test the release APK on the target Android versions and representative camera/speech engines.
