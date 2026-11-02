# Native audio guide

ExamMate uses the native text-to-speech plugin on supported mobile devices and the browser speech synthesis API on the web. The reading engine keeps each phrase as a separate speech unit, supports pause/resume/next/previous/repeat, and exposes media controls through the native media plugin.

For programming answers, fenced code blocks are split by source line and punctuation/operators are announced in speech. Mathematical symbols remain unchanged in the displayed answer and are spoken by their mathematical names. Voice availability and voice quality depend on the device's installed speech engine and selected language.

On Android, native text-to-speech uses the operating system's active audio route. It should play through the built-in speaker when no headset is connected, and through a connected wired or Bluetooth headset when Android has selected that device. Exam Mate deliberately does not force speakerphone mode, because that would break normal headset routing. The app sends TTS at full plugin volume; the device's media/audio output level still controls audible loudness.
