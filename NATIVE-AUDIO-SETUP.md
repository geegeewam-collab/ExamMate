# Exam Mate — Native Audio & Headset Support (v2.1.4)

This release uses the operating system's audio and speech services on native Android and iOS builds. It does not implement its own Bluetooth pairing screen and does not scan for nearby devices.

## What is supported

- **Playback output:** Android system TextToSpeech and iOS AVSpeechSynthesizer output follow the active system audio route. That includes compatible Bluetooth headphones/earbuds, wired USB-C and Lightning EarPods, and 3.5 mm headphones through a supported adapter.
- **Speech input:** the Capacitor speech-recognition plugin uses Android SpeechRecognizer or Apple's SFSpeechRecognizer. The phone chooses the input route. A Bluetooth accessory microphone is used only when the accessory exposes a microphone profile and the OS speech service selects it.
- **Hardware/media controls:** Android MediaSession and iOS MPRemoteCommandCenter forward supported media commands to the reader while a reading session is active.
- **Voice Ask:** use the wake phrase or on-screen Ask control, or enable **Use headset play/pause button to Ask** in Settings → Voice assistant. The standard play/pause media event opens Ask while reading, so it can work with a single earbud that exposes the multifunction button. Raw click counts and long-press gestures are not consistently exposed, so Exam Mate does not rely on triple-click or Siri/Google Assistant interception.

## Standard headset command mapping

With **Use headset play/pause button to Ask** turned off:

| System media action | Exam Mate action |
|---|---|
| Play | Start reading from the editor, or resume |
| Pause / Play-Pause toggle | Toggle reader state |
| Next track / fast-forward | Move to the next phrase |
| Previous track | Move back one phrase |
| Rewind / skip backward | Repeat the current phrase |

With the shortcut enabled while Voice Ask is enabled, a **play/pause press while the reader is actively speaking opens Ask**. The reader is paused by the assistant itself; after the question is answered it resumes. When already paused, Play still resumes normally. Next track and Previous track remain navigation actions.

EarPods/AirPods and Android headsets commonly translate their physical controls into these system media actions. The exact physical gesture is determined by the headset and operating system. Volume buttons stay under system control. Some accessories expose only play/pause and next/previous, and do not expose rewind.

## Pairing and routing

1. Pair Bluetooth earbuds in the phone's **system Bluetooth settings** before opening Exam Mate. Wired headphones should be connected to the phone's supported USB-C/Lightning port or compatible audio adapter.
2. Start a reading session. TTS audio follows the route selected by Android/iOS. Exam Mate does not override the selected route or initiate pairing.
3. Start Voice Ask only after the headset is connected. The OS selects the microphone input. Bluetooth audio output (A2DP) and Bluetooth headset microphone (HFP/HSP/LE Audio profile support) are separate capabilities; some earbuds provide high-quality output but no mic route to the speech service.
4. To verify routing, check the phone's audio output picker and system Bluetooth/audio settings. A connected device does not necessarily expose a microphone.

## Build Android

On Windows, macOS or Linux with Node 22+ and Android Studio/SDK. The supplied lockfile needs a one-time `npm install` refresh because V2.1 adds the iOS and native speech packages; commit the resulting lockfile before using `npm ci`:

```bash
npm install
npm run cap:sync
npm run cap:open
```

Build the APK from Android Studio. The sync step registers the Capgo speech-recognition and Capacitor text-to-speech native plugins. `MainActivity` also registers the ExamMateMedia MediaSession plugin.

## Build iPhone/iPad

On macOS with Xcode and Node 22+. Run `npm install` first to refresh the lockfile for the native plugins:

```bash
npm install
npm run cap:sync:ios
npm run cap:open:ios
```

The sync step creates `ios/App` if missing, installs the Swift media-control plugin into the generated Xcode target, and adds the microphone/speech privacy descriptions. In Xcode, select your Apple development team, check the bundle identifier, connect a physical iPhone, and build/run. The iOS build workflow also generates the project and compiles it for the iOS Simulator on GitHub Actions.

The `ios/` folder in source control contains templates; the generated Xcode project is produced by the sync command. App Store/TestFlight signing, provisioning and submission are still completed through Xcode/App Store Connect.

## Speech-recognition permissions and missing voice troubleshooting

- On Android, allow microphone permission. If Voice Ask reports no recognition service, install/enable Google Speech Services (or the manufacturer speech service) and download the language model for the language you use. For spoken output, open **Settings → Text-to-speech output**, select an engine, and download the needed language voice.
- On iPhone, allow both microphone and Speech Recognition when prompted. The app uses the system speech recognizer and does not download its own speech model. If recognition is unavailable, check **Settings → Privacy & Security → Speech Recognition** and **Microphone** for Exam Mate. The system voice for reading is separate from the speech-recognition service.
- If a reader reports no compatible TTS voice, install/download a system voice for the reading language and press Resume. The app retries language discovery after an unavailable-voice response.
- Browser/PWA speech support is browser-dependent and does not include the custom native media bridge. Use the native Android/iOS app for the full native control path.

## Release validation checklist

Test on physical hardware before publishing a public release:

- Android phone + Bluetooth earbuds that expose a microphone.
- Android phone + USB-C or 3.5 mm wired EarPods/headset.
- Physical iPhone + AirPods/Bluetooth headset.
- Physical iPhone + USB-C or Lightning EarPods/adaptor.
- Reading audio routes to the connected accessory; disconnecting it returns playback to the system's default output.
- With headset Ask off, play/pause toggles reading. With it on, a play/pause press while reading opens Ask; Play while paused resumes normally. Next and Previous remain navigation actions.
- Voice Ask prompts for microphone/speech permissions and receives a clear transcript in the selected language. Check whether the headset or phone microphone is active; do not assume every Bluetooth model exposes a mic. Locale matching is exact or same-language-region only; it does not silently recognize speech using a different language.
- Reading does not skip phrases after a voice-engine failure; installing a TTS voice and resuming retries the voice lookup.

## Platform limits

No app can guarantee that every Bluetooth or wired accessory exposes the same buttons, microphone profile or system media-key events. Bluetooth pairing and route selection remain in phone settings. iOS does not provide a general-purpose API for Exam Mate to intercept raw EarPods/AirPods click counts or Siri long-press gestures. Android vendors also vary in how they dispatch headset media keys. Exam Mate handles the standard OS media actions; hardware-specific behaviour must be verified on the target model.
