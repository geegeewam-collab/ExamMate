# Exam Mate

Snap a photo of exam questions. Exam Mate answers them and reads the answers aloud slowly, with a pause after each phrase so the student can write.

**One Vercel project does everything.** Your site `https://exam-mate-one.vercel.app` serves the student app at `/`, **your admin dashboard at `/admin`**, and the server (`/api/...`). The Android app talks to the same site.

```
app/        Pages (student app "/", dashboard "/admin") and the server routes (app/api)
src/        Student app code
server/     License, owner and photo-answer logic (no framework, fully tested)
android/    Android project (icon and splash already set)
scripts/    export.mjs builds the Android bundle, test.mjs runs the tests
tests/      Unit tests (npm test)
_unused/    Old code kept for reference
```

## Who needs what

| | License key | Gemini key | Sign-in |
|---|---|---|---|
| **Student** (paid once) | Entered **once**, on first launch of a device | Their **own free** key, set up once with a guided screen | Nothing after that |
| **You (owner)** | **Never** | **Never.** Your server key is used | Admin password, once per device |

Students never see an owner option. After the first activation the app does not ask for the key again; it re-checks quietly in the background.

## Setup (one time)

1. Run `npm install` once on your computer (it adds `@upstash/redis` and refreshes `package-lock.json`), then **push to GitHub**. Your existing Vercel project `exam-mate-one` redeploys automatically.
2. In Vercel, open the project: **Settings > Build and Development**. If **Output Directory** shows an override such as `out`, clear it (leave the default). The website is now a normal Next.js build.
3. **Storage / Marketplace > Upstash Redis** (free plan). Connect it to the project. This adds its variables for you.
4. **Settings > Environment Variables** (add all three, then redeploy):
   - `ADMIN_PASSWORD`: long and private. **This is your login. There is no sign-up.**
   - `TOKEN_SECRET`: run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste the result.
   - `GEMINI_API_KEY`: your own key from https://aistudio.google.com/apikey. Used only for your owner devices.
5. Open `https://exam-mate-one.vercel.app/admin` and sign in with `ADMIN_PASSWORD`.

### Getting into the app yourself (owner)
Open the app (website or APK). On the first screen **tap the app icon 5 times**. An **Owner sign-in** box appears. Enter the same `ADMIN_PASSWORD`. You are in with no license key and no Gemini key. Settings then shows **Owner device** and a button to open the admin dashboard.

If you ever change `ADMIN_PASSWORD`, every owner device is signed out and signs in again with the new one.

### Android app
Create `.env.local` in the project root:
```
NEXT_PUBLIC_API_URL=https://exam-mate-one.vercel.app
NEXT_PUBLIC_SUPPORT_URL=https://wa.me/2547XXXXXXXX
```
Then:
```
npm install
npm run cap:sync     # builds the app bundle and copies it into android/
npm run cap:open     # opens Android Studio, then Build > Build APK
```
The website needs no `NEXT_PUBLIC_API_URL`. Only the Android build does.

## Selling to students

1. `/admin` > **New license**: type the student's name, Generate, copy the key, send it.
2. Student installs the app, enters the key (once), then follows the **Connect your free Gemini key** screen: it links to Google AI Studio, they create a key, paste it, done.
3. To take access away: **Revoke**. Changed phone: **Reset device**. Remove for good: **Delete**.

### How the Gemini key works
- Google's free tier is per Google account, so each student uses their own. Your key is never given to students.
- The key is stored only on the student's phone. For each photo it is sent through your server to Google and is never saved on the server.
- If a student sees a limit message, their free allowance is used up for a while. Free limits are set by Google and have been tightened before.

## Tests
`npm test` runs the reading engine, text splitting, and the server tests (licenses, device binding, forged tokens, owner sign-in, student keys, brute force). `npm run typecheck` checks types.

## If something goes wrong
- **`/admin` shows 404**: the new code is not deployed yet, or Vercel is serving an old build. Check the latest deployment is green, and that Output Directory is not overridden.
- **"The server is missing its settings"**: `TOKEN_SECRET` is not set. Add it and redeploy.
- **"Network error" in the Android app**: `NEXT_PUBLIC_API_URL` is missing from `.env.local`, or you did not run `npm run cap:sync` after adding it.
- **Wrong password / blocked**: after 8 wrong attempts an IP is blocked for 10 minutes.
- **Student: "already used on another device"**: they changed or reset their phone. Use **Reset device**.
- **Photos fail with a Gemini message**: the student's key was refused or their free allowance is used up. They can change it in Settings.
