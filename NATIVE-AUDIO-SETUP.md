# Native audio setup

## Android

1. Install a system text-to-speech engine and a voice for the student's language in Android Settings.
2. Sync the Capacitor project with `npm run cap:sync`.
3. Open Android Studio with `npm run cap:open` and run the app on a device.
4. Test play, pause, resume, next, previous, repeat, screen lock and headset media buttons on a physical device.

## iOS

1. On macOS, run `npm run cap:sync:ios`.
2. Open the workspace with `npm run cap:open:ios`.
3. Test speech voices, background playback, lock-screen controls and interruption recovery on a physical iPhone.

Speech services are provided by the operating system. The app can choose an installed voice and pace, but the exact pronunciation and available voices vary by device and language.
