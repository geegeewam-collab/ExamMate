# Exam Mate

Snap a photo of exam questions. Exam Mate answers them and reads the answers aloud slowly, with a pause after each phrase so the student can write.

**One Vercel project does everything.** Your site `https://exam-mate-one.vercel.app` serves the student app at `/`, **your admin dashboard at `/admin`**, and the server (`/api/...`). The Android app talks to the same site.

```
app/        Pages (student app "/", dashboard "/admin") and the server routes (app/api)
src/        Student app code
server/     License, owner and photo-answer logic (no framework, fully tested)
android/    Android project (icon and splash already set)
scripts/    export.mjs builds the Android bundle, test.mjs runs the tests
.github/    Workflow that builds the signed APK and posts it to GitHub Releases
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
3. **Database (free).** When you create it, pick the region **US East (N. Virginia)**: that is next to where Vercel runs your server, which keeps every request quick. Go to https://upstash.com, create a **Redis** database on the **Free** plan (no card needed; check their pricing page for the current limits) and copy its **REST URL** and **REST Token**. This app stores only license records and a few counters, so the free plan is plenty. If Vercel's Marketplace screen does not show a free option, ignore it and use upstash.com directly.
4. **Settings > Environment Variables** (add all five, then redeploy):
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: the two values from step 3
   - `ADMIN_PASSWORD`: long and private. **This is your login. There is no sign-up.**
   - `TOKEN_SECRET`: run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste the result.
   - `GEMINI_ASK_MODEL` (optional): the model used for voice questions. Leave empty for the default fast one.
   - `GEMINI_API_KEY`: your own key from https://aistudio.google.com/apikey. Used only for your owner devices.
5. **Check the setup:** open `https://exam-mate-one.vercel.app/api/health`. It should say `"ok": true` and `"database": "ok"`. If not, the `hints` list tells you in plain words what is missing. It never shows your secret values.
6. Open `https://exam-mate-one.vercel.app/admin` and sign in with `ADMIN_PASSWORD`.

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

## Getting the app to buyers

There are three ways. Use the first two together.

### 1. The web version (works today, nothing to build)
Open `https://exam-mate-one.vercel.app` on the phone.
- **Android (Chrome):** menu > **Install app** (or **Add to Home screen**).
- **iPhone (Safari):** Share > **Add to Home Screen**.

It gets the Exam Mate icon and opens full screen like an app. Activation works the same. Clearing the browser's site data counts as a new device, so you would use **Reset device**.

### 2. A downloadable APK on GitHub (like other open-source repos)
Set this up once, then every release is one command.

**One-time: create a signing key** (this is what proves updates come from you). On your computer, in a terminal (Android Studio ships `keytool` in its `jbr/bin` folder; on Windows use that full path if `keytool` is not found):
```
keytool -genkeypair -v -storetype PKCS12 -keystore exammate.jks -alias exammate -keyalg RSA -keysize 2048 -validity 10000
```
Pick strong passwords and **back up `exammate.jks` and the passwords somewhere safe (not in the repo)**. If you lose it, you can never publish an update that installs over the old one, and every student's license would need **Reset device** (Android ties the device ID to the signing key).

Turn it into text for GitHub:
- Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("exammate.jks")) | Set-Clipboard`
- Mac/Linux: `base64 -w0 exammate.jks`

In your GitHub repo: **Settings > Secrets and variables > Actions > New repository secret**, add four secrets:
`ANDROID_KEYSTORE_BASE64` (the text above), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`exammate`), `ANDROID_KEY_PASSWORD`.

**Every release:**
```
git tag v1.0.0
git push --tags
```
GitHub builds the app (about 10 minutes, watch it under the **Actions** tab) and posts **ExamMate.apk** under **Releases**. For the next version use `v1.0.1` and so on.

**The link you send to buyers** (after the first release):
- A friendly page: `https://exam-mate-one.vercel.app/download` (big Download button plus install steps)
- Or the direct file: `https://github.com/YOUR-NAME/YOUR-REPO/releases/latest/download/ExamMate.apk`

The APK itself can be public: it is useless without a license key you issued.

**Keep the code private but the download public:** create a second, empty **public** repo (e.g. `exammate-downloads`). In your code repo add the variable `RELEASES_REPO` = `yourname/exammate-downloads` and a secret `RELEASES_TOKEN` (a fine-grained personal access token with **Contents: read and write** on that repo). Then in Vercel set `NEXT_PUBLIC_APK_URL` to `https://github.com/yourname/exammate-downloads/releases/latest/download/ExamMate.apk`.

### 3. Google Play (later, optional)
Not needed to start. Google is rolling out "developer verification" for apps installed outside the Play Store: enforcement began on 30 Sep 2026 in Brazil, Indonesia, Singapore and Thailand, and Google says it expands worldwide in 2027. When it reaches your buyers, unverified APKs will need extra install steps. Registering as an Android developer (one-time fee of about $25) before then avoids that. Check Google's current rules at that time.

### Sending it on WhatsApp
Send the `/download` link and the license key as **two separate messages**, so the key is easy to copy. Do not attach the APK file itself: a link always gives them the latest version.

## Selling to students

1. `/admin` > **New license**: type the student's name, Generate, copy the key, send it.
2. Student installs the app, enters the key (once), then follows the **Connect your free Gemini key** screen: it links to Google AI Studio, they create a key, paste it, done.
3. To take access away: **Revoke**. Changed phone: **Reset device**. Remove for good: **Delete**.

### How the Gemini key works
- Google's free tier is per Google account, so each student uses their own. Your key is never given to students.
- The key is stored only on the student's phone. For each photo it is sent through your server to Google and is never saved on the server.
- If a student sees a limit message, their free allowance is used up for a while. Free limits are set by Google and have been tightened before.

## Voice assistant (ask questions while reading)

Turn it on in **Settings > Voice assistant**. While a reading session is open you can:

- say the **wake phrase** (default "Hey Exam Mate", or "Hey Reader", "Hello Mate", or your own), then keep talking. A ding plays, the reader **pauses**, it listens, then it answers out loud and **carries on from the phrase it was on**.
- say it all in one go: "Hey Exam Mate, what does that mean?"
- use the **ask button** on the reading screen (tap, hold 1 s, or hold 3 s, your choice. Holding gives a ding and a buzz).
- optionally, **triple-press your earbuds** (needs earbuds that send "previous track" for three presses).

**You do not need to learn commands.** Whatever you say goes to the AI, which works out whether you want a question answered or the reader controlled, in your own words: "could you try going faster", "I didn't catch that", "hold on a sec", "skip ahead", "you're going too quick", "carry on", "that's enough". It can repeat, go back, skip ahead, pause, continue, stop, and speed up or slow down. If the internet is down, plain one-word commands (next, repeat, pause...) still work.

Notes:
- Holding an earbud for 3 seconds **cannot** be detected by any app. The phone keeps that for its own assistant. That is why the on-screen hold, the wake phrase and the triple-press exist.
- It only listens while a reading session is open and the app is on screen. It stops when you lock the screen. Earbuds work best, otherwise the phone's speaker can confuse it.
- It uses the phone's speech recognition (Google on Android), which may send audio to Google. The setting is off until the student turns it on.
- Questions use the same Gemini key as photos: students use their own, you use the server's. Answers are saved in History.

## Reading aloud on Android
The Android app does not have the browser's speech feature, so it uses the phone's own **Text-to-speech** engine (through the `@capacitor-community/text-to-speech` plugin). It goes to your earbuds like any other sound. If the app says **"No speech voice found"**, open the phone's **Settings > Text-to-speech output**, choose or install an engine (Google Speech Services is the usual one), then press Resume.

## Tests
`npm test` runs the reading engine, text splitting, native speech, the voice assistant (wake phrase, commands, interrupt and resume), and the server tests (licenses, device binding, forged tokens, owner sign-in, student keys, brute force). `npm run typecheck` checks types.

## If something goes wrong
- **Admin sign-in says "Request failed" or "The server hit a problem"**: open `/api/health` on your site. The usual cause is the database settings: `UPSTASH_REDIS_REST_URL` must be the **REST URL** (starts with `https://`) and `UPSTASH_REDIS_REST_TOKEN` the **REST Token**, each enabled for Production, then **Redeploy**. Use your main address (`exam-mate-one.vercel.app`), not a long one-off deployment address, because variables can differ per environment.
- **`/admin` shows 404**: the new code is not deployed yet, or Vercel is serving an old build. Check the latest deployment is green, and that Output Directory is not overridden.
- **"The server is missing its settings"**: `TOKEN_SECRET` is not set. Add it and redeploy.
- **"Network error" in the Android app**: `NEXT_PUBLIC_API_URL` is missing from `.env.local`, or you did not run `npm run cap:sync` after adding it.
- **Wrong password / blocked**: after 8 wrong attempts an IP is blocked for 10 minutes.
- **Student: "already used on another device"**: they changed or reset their phone. Use **Reset device**.
- **Photos fail with a Gemini message**: the student's key was refused or their free allowance is used up. They can change it in Settings.
