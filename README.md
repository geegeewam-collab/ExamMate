# Exam Mate

Snap a photo of exam questions. Exam Mate answers them and reads the answers aloud slowly, with a pause after each phrase so the student can write.

The app is **licensed**: it only works on a device that has activated a valid key that you issued. You manage keys from a private web dashboard.

```
ExamMate-main/
├─ app/, src/        The student app (Next.js static export, wrapped by Capacitor for Android)
├─ android/          Android project (unchanged)
├─ admin/            YOUR side: license server + dashboard + the AI endpoint. Deploys as its own Vercel project
├─ tests/            App tests            (npm test)
└─ _unused/          Old code kept for reference (voice prototype, old standalone reader, old passcode route)
```

## How access works

| Step | What happens |
|---|---|
| Student opens the app | Activation screen. Nothing else is reachable. |
| Enters a key | App sends key + its device ID to your server. First time: the key is bound to that device and a signed token is stored on the phone. |
| Friend tries the same key | Refused: "This license is already used on another device." |
| Every launch / return to the app | App asks the server "is my token still valid?". Revoked, deleted or reset means back to the activation screen. |
| Every photo | Sent to **your** server with the token. Server re-checks the license, applies a daily limit, and only then calls Gemini. The Gemini key never leaves the server, so a copied or modified APK gets nothing. |
| No internet | The app still opens for up to 14 days after the last successful check (reading pasted text, history, settings). Photos need internet. |

## One-time setup

### 1. Deploy the admin (your side)
1. In Vercel, **Add New > Project**, pick this repo, and set **Root Directory** to `admin`.
2. In the project, **Storage / Marketplace > Upstash Redis** (free plan). Connect it to the project. This adds the Redis variables automatically.
3. **Settings > Environment Variables**:
   - `ADMIN_PASSWORD` : long and private
   - `TOKEN_SECRET` : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (changing it later logs everyone out)
   - `GEMINI_API_KEY` : from Google AI Studio
   - `DAILY_LIMIT` : photos per license per day (default 60). This protects your Gemini bill.
4. Redeploy.

### 2. Get into the admin (this is how YOU get in)
Open `https://YOUR-ADMIN-PROJECT.vercel.app/admin` and sign in with `ADMIN_PASSWORD`.

Generate a license labelled **Owner** with **3 devices**. Use that key in the app on your own phone(s). You are a normal licensed user; the dashboard is where you manage everyone else.

### 3. Point the app at your admin
Create `.env.local` in the project root (see `.env.example`):

```
NEXT_PUBLIC_API_URL=https://YOUR-ADMIN-PROJECT.vercel.app
NEXT_PUBLIC_SUPPORT_URL=https://wa.me/2547XXXXXXXX
```

Then build the Android app:

```
npm install
npm run cap:sync
npm run cap:open        # opens Android Studio: Build > Build APK
```

If you also host the app on Vercel as a website, add the same two variables there (Settings > Environment Variables).

## Day to day (admin dashboard)

- **Give access**: Generate (1 to 50 at once, name them), copy the key, send it to the student.
- **Deny access**: Revoke. They are locked out the next time the app opens or sends a photo. Restore brings them back.
- **Student changed phone**: Reset device, then they enter the same key on the new phone.
- **Remove for good**: Delete.
- Tap a key to copy it. Status shows Active, Not activated, or Revoked.

## Tests

- `npm test` : app logic (reading engine, text splitting)
- `cd admin && npm test` : license, admin API and photo endpoint (device binding, forged tokens, brute force, daily limit)
- `npm run typecheck`

## If something goes wrong

- **"Network error" on activation**: `NEXT_PUBLIC_API_URL` is missing or wrong, or you did not rebuild after setting it.
- **"The server is missing its settings"**: `TOKEN_SECRET` (or `GEMINI_API_KEY` for photos) is not set on the admin project. Redeploy after adding.
- **Wrong password forever**: after 8 wrong attempts an IP is blocked for 10 minutes.
- **Student says "already used on another device"**: they reinstalled or changed phone. Use Reset device.
