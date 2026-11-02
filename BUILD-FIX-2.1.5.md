# Build note – 2.1.5

The 2.1.5 release corrected the Redis atomic device-claim return type and validates the returned claim result. The active Android release workflow is `.github/workflows/android-apk.yml`. The native export command is `npm run cap:sync`; it requires `NEXT_PUBLIC_API_URL` and syncs the static build into Capacitor.

Run `npm ci`, `npm run typecheck`, and `npm test` before publishing. The signed release workflow also requires `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`.
