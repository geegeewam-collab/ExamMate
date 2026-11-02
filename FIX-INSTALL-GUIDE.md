# Exam Mate 2.1.6 — Android speech and paper-upload fix

This source update addresses the Android-only reader failures shown in the screenshots. The hosted website's browser speech engine is unchanged.

## What changed

- Android reader playback, voice-assistant speech and pre-warming now share one native TTS controller and the same initialization state.
- The app gives Android's speech service more time to initialize and retries language discovery before reporting that no voice is available.
- Photo preparation is more tolerant of Android WebView differences: it detects file extensions when the MIME type is missing, tries multiple image-decoding paths, and falls back from canvas `toBlob()` to `toDataURL()` or the original small JPG/PNG/WebP file.
- The Android sync script now verifies that Capacitor generated a native TTS plugin registry entry. It stops the release build if the runtime plugin is missing, rather than producing an APK that cannot speak.
- Release metadata is now 2.1.6 (Android fallback version code 8; iOS build number 8).

## Build and install the fixed Android app

The ZIP contains updated source code, **not a compiled APK**. Rebuild the native app so the TTS plugin registration and JavaScript fixes are included in the installed package.

### Recommended: GitHub Actions

1. Replace/update the corresponding files in your ExamMate repository with the files from this ZIP.
2. Commit and push the changes to the branch used by your Android workflow.
3. Open **GitHub → Actions → Build Android APK → Run workflow**.
4. Wait for the workflow to finish successfully, then open that workflow run and download the **ExamMate-apk** artifact.
5. Install that APK on the Android phone.

The workflow runs `npm ci`, type-checks and tests the project, builds the static app, runs `npx cap sync android`, verifies the generated TTS registry, and then builds the signed APK. It uses `NEXT_PUBLIC_API_URL` from your GitHub Actions variables/secrets, with `https://exam-mate-one.vercel.app` as a fallback. The Android signing secrets must already be configured for the signed release step.

### Local build

From the project root, use Node 22 and run:

```bash
npm ci
npm run typecheck
npm test
npm run cap:sync
```

Then open Android Studio with `npm run cap:open`, sync Gradle, and build the signed release APK using the same release keystore as the currently installed app.

## Check the Android phone's speech service

The app uses Android's installed system text-to-speech engine; it does not generate audio in the website layer. On the phone, search Android Settings for **Text-to-speech output**, select a working engine (for example, Speech Services by Google), and install the voice for the language you want to read. Make sure media volume is audible. Connect Bluetooth or wired headphones before starting if you want audio routed to them.

After installing 2.1.6, test in this order:

1. Enter `Hey you` in Text to read and start playback.
2. Select a normal JPG or PNG page from the gallery and submit it.
3. Try a camera photo, then try Learn mode.
4. Repeat with headphones connected.

If Android refuses to install the APK as an update, the signing key may differ from the one used for the installed copy. Do not uninstall the existing app until you have considered its locally stored data and confirmed you can sign the new build with the original keystore.

## Validation completed here

- 114 automated regression tests passed, including new Android TTS cold-start, shared-controller and image data-URL fallback tests.
- The modified image, speech and reader source files passed a focused TypeScript check.
- A full Next.js production build and signed Android APK were not produced in this environment because the project dependencies, Android SDK and signing key are not installed here. The GitHub Actions workflow is the intended full native build and release check.
