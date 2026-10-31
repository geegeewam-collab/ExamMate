# Exam Mate

**Current release: v2.1.4 (31 October 2026).** See [CHANGELOG.md](./CHANGELOG.md) for this release.

Snap a photo of exam questions. Exam Mate answers them and reads the answers aloud slowly, with a pause after each phrase so the student can write.

**One Vercel project does everything.** Your site `https://exam-mate-one.vercel.app` serves the student app at `/`, **your admin dashboard at `/admin`**, and the server (`/api/...`). The Android and iOS apps talk to the same site.

```
app/        Pages (student app "/", dashboard "/admin") and the server routes (app/api)
src/        Student app code
server/     License, owner and photo-answer logic (no framework, fully tested)
android/    Android project and native media-session bridge
ios/templates/  iOS native media-session bridge (generated into Xcode project during sync)
scripts/    export.mjs builds the platform bundle; add-ios.mjs and setup-ios.mjs configure iOS
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

1. Run `npm install` once on your computer, then commit the refreshed `package-lock.json` and **push to GitHub**. The supplied lockfile was missing entries for three newly declared native dependencies (`@capacitor/ios`, `@capacitor-community/text-to-speech` and `@capgo/capacitor-speech-recognition`), so do not use `npm ci` until this refresh has completed. Your existing Vercel project `exam-mate-one` redeploys automatically.
2. In Vercel, open the project: **Settings > Build and Development**. If **Output Directory** shows an override such as `out`, clear it (leave the default). The website is now a normal Next.js build.
3. **Database (free).** When you create it, pick the region **US East (N. Virginia)**: that is next to where Vercel runs your server, which keeps every request quick. Go to https://upstash.com, create a **Redis** database on the **Free** plan (no card needed; check their pricing page for the current limits) and copy its **REST URL** and **REST Token**. This app stores only license records and a few counters, so the free plan is plenty. If Vercel's Marketplace screen does not show a free option, ignore it and use upstash.com directly.
4. **Settings > Environment Variables** (add the required values, then redeploy):
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: the two values from step 3
   - `ADMIN_PASSWORD`: long and private. **This is your login. There is no sign-up.**
   - `TOKEN_SECRET`: run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste the result. It must be at least 32 random characters; 64 hex characters is recommended. **Changing this value invalidates every previously issued activation token**, so existing users may need to activate their license again.
   - `GEMINI_ASK_MODEL` (optional): the model used for voice questions. Leave empty for the default fast one.
   - `GEMINI_API_KEY`: your own key from https://aistudio.google.com/apikey. Used only for your owner devices.
5. **Check the setup:** open `https://exam-mate-one.vercel.app/api/health`. It should say `"ok": true` and `"database": "ok"`. If not, the `hints` list tells you in plain words what is missing. It never shows your secret values.
6. Open `https://exam-mate-one.vercel.app/admin` and sign in with `ADMIN_PASSWORD`.

### Getting into the app yourself (owner)
Open the app (website or APK). On the first screen **tap the app icon 5 times**. An **Owner sign-in** box appears. Enter the same `ADMIN_PASSWORD`. You are in with no license key and no Gemini key. Settings then shows **Owner device** and a button to open the admin dashboard.

If you ever change `ADMIN_PASSWORD`, every owner device is signed out and signs in again with the new one.

### Native Android and iPhone apps

Set the API URL before making a native bundle. Add `.env.local` in the project root:

```env
NEXT_PUBLIC_API_URL=https://exam-mate-one.vercel.app
NEXT_PUBLIC_SUPPORT_URL=https://wa.me/2547XXXXXXXX
```

Install dependencies (use `npm install` at least once after updating the Capacitor, iOS and speech plugins so the lockfile is regenerated):

```bash
npm install
```

**Android** — on Windows, macOS or Linux with Android Studio/SDK installed:

```bash
npm run cap:sync
npm run cap:open
```

Build and test the APK from Android Studio. The native ExamMateMedia plugin provides Android MediaSession controls for play/pause, next, previous and rewind.

**iPhone** — on a Mac with a Capacitor 8-compatible Xcode toolchain installed:

```bash
npm run cap:sync:ios
npm run cap:open:ios
```

In Xcode, select your Apple development team, set the bundle signing settings, connect an iPhone or choose a simulator, then build. The sync command generates `ios/App` and installs the native media-control bridge and speech privacy descriptions.

The web/PWA build remains available at `https://exam-mate-one.vercel.app`; it uses browser speech and browser Media Session support where available. Native Bluetooth/wired audio routing is handled by iOS or Android. Exam Mate does not scan for, pair or force-connect headsets. Pair a Bluetooth headset in the phone's Settings first; USB-C, Lightning and compatible 3.5 mm adapters use the system audio route automatically. The OS chooses whether a headset microphone is available to its speech-recognition service.

## Publishing a release

This project is versioned as `2.1.4`. After committing the V2 source to the release branch, create and push the release tag:

```bash
git tag -a v2.1.4 -m "Exam Mate v2.1.4"
git push origin v2.1.4
```

The Android GitHub Actions workflow builds the APK and attaches it to the GitHub Release. The iOS build workflow validates the generated iOS project on macOS; App Store/TestFlight signing and release remain an Xcode/App Store Connect step. See `NATIVE-AUDIO-SETUP.md` for headset behavior and device test requirements. The workflow uses the GitHub run number as Android `versionCode` and the tag (for example `2.1.4`) as `versionName`. Ensure the Android signing secrets described below are configured before pushing the tag.

## Getting the app to buyers

There are three ways. Use the first two together.

### 1. The web version (works today, nothing to build)
Open `https://exam-mate-one.vercel.app` on the phone.
- **Android (Chrome):** menu > **Install app** (or **Add to Home screen**).
- **iPhone (Safari):** Share > **Add to Home Screen**. For native iPhone headset media controls and native speech permissions, build the iOS app as described above; PWA support depends on Safari's browser APIs. For native speech-recognition permission prompts and native headset media controls, build the iOS app as described above; the PWA has browser-dependent speech and media support.

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

**Every Android release:** push the same `v2.1.4` tag shown in Publishing a release. GitHub builds the app and posts **ExamMate.apk** under **Releases**. For the next version use `v2.1.5` and so on.

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

**You do not need to learn commands.** Whatever you say goes to the AI, which works out whether you want a question answered or the reader controlled, in your own words: "could you try going faster", "I didn't catch that", "hold on a sec", "skip ahead", "you're going too quick", "carry on", "that's enough". It can repeat, go back, skip ahead, pause, continue, stop, and speed up or slow down. If the internet is down, plain one-word commands (next, repeat, pause...) still work.

Notes:
- Headset controls use the standard media actions exposed by the phone: next track advances one phrase, previous track goes back, and rewind repeats the current phrase when exposed. Optionally, **Use headset play/pause button to Ask** makes a play/pause press while reading open voice Ask instead of pausing; when already paused, Play resumes normally. This is designed to work with a single earbud that exposes the standard multifunction button; headset/OS event routing still varies.
- A long-press on some headsets is reserved by the operating system for its own assistant; Exam Mate cannot intercept that consistently.
- Voice Ask listens while a reading session is open and Exam Mate is on screen. Reading audio and native media controls are separate from microphone listening; the app stops its mic session when it goes to the background. Earbuds help reduce the phone speaker feeding back into the microphone.
- It uses the phone's speech-recognition service (provider varies by OS/device), which may send audio to that provider. The setting is off until the student turns it on.
- Questions use the same Gemini key as photos: students use their own, you use the server's. Answers are saved in History.

## Reading aloud on Android and iPhone
Native builds use the operating system text-to-speech engine through Capacitor. Android uses the selected system TTS engine and installed language data. iPhone uses Apple system voices. Spoken output follows the audio route selected by the operating system, including paired Bluetooth, USB-C, Lightning and compatible wired headsets. If Android reports **"No speech voice found"**, open **Settings > Text-to-speech output**, choose an engine, install voice data for the reading language, return to Exam Mate and press Resume. On iPhone, check that the phone's system voice for the selected language is available in Settings > Accessibility > Spoken Content. The iPhone speech recognizer separately requires microphone and speech-recognition permission. Recognition uses the requested device language (or a same-language regional variant); it does not silently switch to a different language. Voice Ask on Android also requires an enabled system speech-recognition service (commonly Google Speech Services) with the required language model downloaded.

## Tests
`npm test` runs the reading engine, text splitting, native speech, the voice assistant (wake phrase, commands, interrupt and resume), and the server tests (licenses, device binding, forged tokens, owner sign-in, student keys, brute force). `npm run typecheck` checks types.

## If something goes wrong
- **Admin sign-in says "Request failed" or "The server hit a problem"**: open `/api/health` on your site. The usual cause is the database settings: `UPSTASH_REDIS_REST_URL` must be the **REST URL** (starts with `https://`) and `UPSTASH_REDIS_REST_TOKEN` the **REST Token**, each enabled for Production, then **Redeploy**. Use your main address (`exam-mate-one.vercel.app`), not a long one-off deployment address, because variables can differ per environment.
- **`/admin` shows 404**: the new code is not deployed yet, or Vercel is serving an old build. Check the latest deployment is green, and that Output Directory is not overridden.
- **"The server is missing its settings"**: `TOKEN_SECRET` is not set. Add it and redeploy.
- **"Network error" in a native app**: `NEXT_PUBLIC_API_URL` is missing from `.env.local`, or you did not run `npm run cap:sync` after adding it.
- **Wrong password / blocked**: after 8 wrong attempts an IP is blocked for 10 minutes.
- **Student: "already used on another device"**: they changed or reset their phone. Use **Reset device**.
- **Photos fail with a Gemini message**: the student's key was refused or their free allowance is used up. They can change it in Settings.


### Headset Ask shortcut

While a reading session is active and **Ask questions by voice** is enabled, open **Settings → Voice assistant** and turn on **Use headset play/pause button to Ask**. Press the headset's main multifunction/play-pause button once while Exam Mate is reading. The reader pauses and voice capture starts; ask your question after the listening cue. The answer is spoken and reading resumes at the interrupted phrase. When the reader is already paused, Play resumes normally. Previous track remains Back and Next track remains Next. This is designed for one-earbud use, but depends on the headset and operating system forwarding a standard play/pause event. Keep Exam Mate active in the foreground; controls reserved by Siri/Google Assistant or headset firmware cannot be intercepted.
