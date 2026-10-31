# Exam Mate V2 — Security, responsive and theme audit

Audit scope: source review of the V2 ZIP. This is not a penetration test or a live-device certification.

## Implemented in V2

- Ask no longer renders the owner-only timing/provider diagnostic panel. The Ask API now returns only `{ action, answer }` on success and `{ code, error }` on failure. Model names, retry traces, timings and raw provider errors are not sent to clients.
- Ask JSON requests are capped at 20 KB before JSON parsing.
- API JSON responses and admin license responses use `Cache-Control: no-store`.
- Hosted Next.js pages send `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` limited to same-origin camera/microphone with geolocation disabled.
- `/api/health` warns when `TOKEN_SECRET` is shorter than 32 characters or `ADMIN_PASSWORD` is shorter than 16 characters. Use a cryptographically random 32-byte secret (64 hex characters recommended), not a memorable phrase.
- Responsive CSS includes a narrower 360 px breakpoint, safe-area padding, dynamic viewport support and existing reduced-motion support. Admin grids collapse to two columns on small screens.
- Light appearance follows the device's `prefers-color-scheme`; dark appearance uses the graphite/teal brand palette. Light-mode secondary/accent contrast was darkened for readability. The PWA manifest theme colour is aligned to the graphite palette.

## Existing licence protections confirmed in source

- License tokens are HMAC-SHA256 signed and compared with constant-time signature checks.
- Student tokens are bound to a device identifier; the server checks the active license record and device binding on protected requests.
- Revocation, deletion and device reset are checked server-side and invalidate access.
- First-time device claims use an atomic Upstash Redis Lua operation, preventing concurrent activation requests from bypassing `maxDevices`.
- License-key guessing and owner/admin password failures have Redis-backed rate limits.
- Student Gemini keys are sent as a request header to the server for that request; the server's `GEMINI_API_KEY` is read only in server code and is not placed in the public client bundle.

## Remaining risks / recommended next work

1. **Device token storage:** the app stores its signed bearer token using Capacitor Preferences. This is convenient persistent storage, but it is not a hardware-backed secure vault. A rooted/compromised device or device backup may expose it. For a future release, move the token to Android Keystore/iOS Keychain-backed secure storage and provide a migration path.
2. **No token expiry:** existing signed tokens do not expire by age. This was preserved to avoid forcing existing students to reactivate and to retain the current offline grace flow. Plan a future token refresh/expiry system that can renew a token without asking students to re-enter a key.
3. **Admin credential in sessionStorage:** `/admin` stores the admin password in tab-scoped `sessionStorage` to authorize subsequent requests. It is cleared when the tab/session ends or the user signs out, but same-origin script injection could read it. The stronger long-term design is a short-lived server-issued session in an `HttpOnly; Secure; SameSite` cookie, with CSRF protection.
4. **CORS:** API CORS remains `*` so the same backend can serve the hosted site and Capacitor's local WebView origin. Cookie credentials are not used, and protected API calls still require a signed token and device ID. Before adding more web frontends, change this to an explicit, configurable origin allowlist while retaining the required Capacitor origin.
5. **Operational secrets:** rotating `TOKEN_SECRET` invalidates all existing signed tokens. Do not change it casually in production. If you discover it is weak, schedule the rotation and prepare to have existing users activate again with their existing license keys.
6. **Dependency lockfile:** the supplied lockfile did not contain entries for the declared `@capacitor-community/text-to-speech` and `@capgo/capacitor-speech-recognition` dependencies. Registry access was unavailable during this pass, so I did not invent package checksums. Run `npm install` and commit the regenerated `package-lock.json` before using `npm ci`. The included Android release workflow uses `npm install`, which refreshes the dependency resolution during the build.

## Visual / device verification

- The CSS is responsive by construction: constrained page widths, wrapping voice controls, flexible admin grids, safe areas and scrollable reading-sheet content.
- Dark mode is automatic from the operating system; there is no separate in-app theme switch in this release.
- Actual screenshots, screen-reader checks and mic/camera permissions still need to be tested on at least one small Android phone, one larger Android phone and an iPhone/Safari device before public release.
