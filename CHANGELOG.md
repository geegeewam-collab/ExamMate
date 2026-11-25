# Changelog

## [2.1.12] - 2026-11-25

### Installation
- The APK is now signed with all three Android signature schemes (v1, v2 and v3). Since minSdk 24 it carried only v2, which some phone installers, security scanners and file managers reject as "package is invalid".
- The release build now runs Android's own signature and alignment checks and refuses to publish an APK that fails them.
- Release notes come from this changelog, so the in-app update prompt shows what changed. The release page also lists the exact file size and SHA-256, so a download on a phone can be checked.
- The download page explains how to open the APK and what to do if a phone reports "package is invalid".
- Bumped version to 2.1.12, Android versionCode and iOS build number to 14.

## [2.1.11] - 2026-11-25

### In-app updates (Android)
- The app checks for a newer GitHub release when it opens and when it comes back to the foreground (at most hourly).
- "Update now" downloads the APK inside the app with a progress bar and opens Android's installer, which updates in place: no uninstall, and the license, Gemini key and saved papers are kept.
- "Later" hides the prompt until the first open of the next day. A newer release is offered straight away.
- First use asks once for Android's "Allow from this source" permission, then continues automatically.
- The downloaded file is checked to be ExamMate and newer than the installed build. Android itself refuses any APK signed with a different key.
- New endpoint GET /api/app-version (latest release, cached 5 minutes). Optional MIN_APP_VERSION forces an update with no Later option.
- Bumped version to 2.1.11, Android versionCode and iOS build number to 13.

## [2.1.10] - 2026-11-25

### Release
- Re-release of 2.1.9. The v2.1.9 build stopped at a release-metadata test with a hard-coded version; that test now reads package.json and checks iOS and Android build numbers match.
- Bumped version to 2.1.10, Android versionCode and iOS build number to 12.

## [2.1.9] - 2026-11-25

### Answers
- Rewrote the answer-style policy around exam command words. State, name, list, identify and highlight questions get short points with no explanation; define, describe, explain, differentiate, compare, discuss, evaluate and calculate each get the depth examiners expect.
- Added explicit rules against AI-sounding wording (stock openers, filler phrases, hedging, em dashes) so answers read like a prepared student wrote them.

### Token savings
- Answer calls no longer re-send the page photos for every question group. Photos are attached only to groups containing a question that needs a diagram, table, figure or an unreadable part.
- Shortened the shared answer prompts, which are sent with every model call.

### Reliability and security
- Voice Ask tries its preferred fast models first, then falls back to the models the key can actually use, so a renamed or retired model no longer breaks Voice Ask. Cancelled questions now stop the upstream call.
- Changing ADMIN_PASSWORD and redeploying now resets the stored parent password and signs out every admin session and owner device. A password changed in the app stays in force until ADMIN_PASSWORD changes again. Existing records are adopted on upgrade, never reset.
- Android backups are disabled so the stored Gemini key and license token are not copied into cloud backups.
- Bumped version to 2.1.9, Android versionCode and iOS build number to 11.

## [2.1.8] - 2026-11-04

### Reliability
- Increased the photo-reading budget from 24 s to 50 s and the individual read-call timeout from 18 s to 36 s.
- Increased the answer-stage per-call timeout to 35 s and the overall API processing budget to 108 s.
- Increased the `/api/answer` route execution allowance to 120 s, leaving headroom for image reading, answer groups, retries and response delivery.
- Kept page batching and bounded per-request image sizes; there is no fixed total page or question-count cap in the client flow.
- Added regression coverage for large extracted papers to ensure all returned questions continue to be answered in order.
- Bumped package version to 2.1.8, Android fallback versionCode to 10, and iOS build number to 10.

### Notes
- The natural student-answering policy is unchanged. The observed `reading the photo: time budget used up` failure occurs before that answer-style prompt is sent.
- Full dependency-installed CI, a production Next.js build, and live Gemini latency testing must still be run before public rollout.

## [2.1.7] - 2026-11-04

### Changed
- Added one shared natural student-answering policy used by both examination answers and Voice Ask, so responses favour clear, practical explanations over bare textbook category labels.
- Kept academic terminology, factual accuracy, command words, requested point counts, mathematical notation, code formatting, and the existing API response schemas intact.
- Refined Quick mode to give concise but meaningful exam-ready points, including the setting and task for application/use questions where relevant.
- Refined Learn mode to add explanation, working or examples only when they help the specific question instead of forcing `Method:` and `Example:` sections onto every answer.
- Applied the same natural-language principles to Voice Ask while preserving reader-control actions and its spoken-response format.

### Release metadata
- Bumped package version to 2.1.7, Android fallback versionCode to 9, and iOS build number to 9.

### Validation
- Added regression checks confirming the shared policy reaches both Gemini pathways and that Learn mode no longer forces generic teaching sections. See `RELEASE-VALIDATION-2.1.7.md` for passed checks and environment limitations.

## Unreleased

### Added
- Persistent reading sessions when navigating to Settings or History, with a resume action and Android hardware-back handling that minimises the reader instead of closing the app.
- A top hamburger menu for Read, History and Settings; removed the bottom navigation bar.
- Minimal graphite/charcoal and ivory themes with restrained sage-green accents, plus a calmer AI progress indicator.
- Page thumbnails and selected-page count, bounded thumbnail rendering for large selections, processing progress, searchable/renameable answer history, and streamlined pace presets.
- Parent-admin sign-in sessions, password changes, sign-out of other devices, and read-only guest access with parent-managed guest accounts.
- Line-aware source-code speech and mathematical-symbol pronunciation while preserving the original visible symbols and code formatting. Code is displayed in a monospace line view with an explicit source-line number.
- In-player pace presets so students can switch between Write along, Balanced and Quick review without leaving the reading session; active prose is re-segmented at the current sentence when the pace changes.
- Full programming blocks remain visible during playback, with the current source line highlighted while speech announces each line transition.
- Empty cover/instruction-only batches no longer abort later page batches; a clear no-questions message is returned only when the complete upload contains no questions.

### Fixed (audio and photo)
- Spoken answers never started on Android and showed "Audio has not started": the native speech plugin was returned straight out of a promise, and Capacitor plugin objects look like promises, so loading never finished. The text-to-speech and media plugins are now wrapped in plain objects.
- Every native speech step (plugin load, stop, language check, listener) has its own time limit. Android now retries a cold text-to-speech service for up to about 8 seconds, shares the warmed controller between the reader and voice assistant, and uses a 20 s native no-audio watchdog (3.5 s on web) so first-use engine startup is not mistaken for silent playback. Speech errors show a useful reason.
- "Could not prepare page" on camera/gallery photos: image preparation recognises image bytes and file extensions, tries bitmap, blob URL and FileReader data-URL decoders, and falls back from canvas.toBlob() to canvas.toDataURL(). Small supported JPG/PNG/WebP photos can be sent unchanged when canvas preparation fails; HEIC/AVIF are converted when the device can decode them and otherwise receive a clear format-specific message.

### Fixed
- Removed silent three-image and 30-question truncation. All selected pages are processed in sequential request-sized batches without keeping every base64 image in memory at once.
- Aligned server image validation with the compressed image size generated by the client.
- Propagated cancellation to active Gemini generation requests where supported.
- Kept reading position and playback settings when visiting other screens; corrected resume handling for the first phrase. Android hardware Back now dispatches a cancellable app event so the reader can return to the workspace before the activity exits.
- Replaced corrupted root documentation/configuration files, restored `.gitignore` and `.npmrc`, and archived the obsolete Android workflow outside GitHub Actions' active workflow directory.
- Changed the test runner to use the locally installed TypeScript compiler and Node's built-in test runner, avoiding runtime package downloads.

### Validation notes
- Automated regression suites pass in the available runtime. A full dependency-installed Next.js build/typecheck and signed Android build still need to run in the project's normal CI environment.


## [2.1.6] - 2026-11-02

### Fixed
- Reused one native Android speech controller across reader playback, the voice assistant and pre-warm actions so TTS readiness is shared instead of duplicated.
- Extended Android cold-start language retries and the reader's first-audio watchdog to avoid false "Audio has not started" failures on slower devices.
- Improved image preparation for Android WebViews with filename-based MIME detection and more resilient decoding/encoding fallbacks.
- Added a release-build guard that checks the generated Capacitor plugin registry contains the native text-to-speech plugin, not just the Gradle dependency.

### Release metadata
- Bumped package version to 2.1.6, Android fallback versionCode to 8, and iOS build number to 8.

## [2.1.5] - 2026-10-31

### Fixed
- Fixed the TypeScript production-build failure in the Upstash Redis `eval()` device-claim call. The Redis Lua script now returns a typed tuple (`unknown[]`-compatible) instead of a top-level JSON string.
- Added strict decoding and validation for atomic device-claim results, including malformed or unexpected Redis responses.
- Added regression coverage for all device-claim statuses and invalid payloads.

### Release metadata
- Bumped package version to 2.1.5, Android fallback versionCode to 7, and iOS build number to 7.


## [2.1.4] - 2026-10-31

### Changed
- Refined the existing graphite, teal and ivory visual system with clearer hierarchy, more deliberate card surfaces, calmer reader controls, improved settings grouping, and tighter small-screen spacing.
- Improved admin dashboard surface consistency and key wrapping on narrow screens.
- Preserved all V2.1.3 native Android/iOS speech integrations, headset media controls, and the optional play/pause-to-Ask shortcut.
- Bumped the release metadata to 2.1.4 (Android default versionCode 6; iOS build 6).

### Validation
- Presentation-only CSS refinements; no component structure, API contracts, reader logic, or media-control behaviour changed.

## [2.1.3] - 2026-10-31

### Changed
- Replaced the optional headset Ask shortcut from Previous track to the standard Play/Pause media event, so it no longer depends on a previous-track button or a two-earbud gesture.
- While reading, Play, Pause or Play/Pause toggle opens Voice Ask when the option is enabled and Voice Ask is switched on. The assistant pauses reading, listens, answers, and resumes. When already paused, Play continues to resume normally.
- Next track remains Next phrase; Previous track remains Back; rewind remains Repeat.
- Retained the `earbudAsk` saved-settings key so users upgrading from V2.1.2 keep their opt-in preference, now applied to Play/Pause.
- Android versionCode is 5 and versionName is 2.1.3. iOS build number is 5.

### Compatibility note
- The shortcut uses standard play/pause media events, which are commonly available through the main button on wired EarPods and single Bluetooth earbuds. A headset or OS that reserves that press for Siri/Google Assistant or does not forward a media event cannot be overridden by the app. The on-screen Ask button and wake phrase remain available fallbacks.

## [2.1.2] - 2026-10-31

### Added
- Optional EarPods/headset Ask shortcut. Enable **Use headset previous-track button to Ask** in Settings; a supported Previous track media event starts voice capture instead of reader Back. On many wired EarPods this is triple-click.
- The spoken command “go back” continues to navigate backwards when the hardware shortcut is assigned to Ask.

### Changed
- Previous-track behavior remains Back by default for existing users. The new shortcut is opt-in and is only available while voice Ask is enabled and the reading session is active.
- Android default versionCode is 4 and versionName is 2.1.2.

### Compatibility note
- The shortcut listens for the standard previous-track media command. Many wired EarPods expose this via triple-click; Bluetooth headset gestures vary by model and OS configuration. Apps cannot override gestures reserved by Siri/Google Assistant or force a headset to emit a particular media command. Keep Exam Mate open while reading for the voice capture to start reliably.
