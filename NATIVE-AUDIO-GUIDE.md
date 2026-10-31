# Exam Mate 2.1.4 — One-earbud Ask shortcut

## Ask without saying a wake phrase

1. Connect your wired or Bluetooth headset through the phone's normal settings.
2. Open Exam Mate and go to **Settings → Voice assistant**.
3. Enable **Ask questions by voice**.
4. Enable **Use headset play/pause button to Ask**.
5. Start reading and keep Exam Mate active in the foreground.
6. Press the headset's main multifunction/play-pause control once while the reader is speaking. This can be the centre button on wired EarPods, or the play/pause press/tap on a Bluetooth earbud.
7. Exam Mate pauses the reader and starts listening. Ask your question normally. After the answer, it resumes from the interrupted phrase.

No previous-track or next-track command is needed. The main play/pause press is normally available with one earbud worn, provided the headset still sends the standard media pause/toggle event to the phone.

## How the button behaves

- While the reader is playing: **play/pause** opens Ask instead of pausing. Exam Mate itself pauses the reader as part of starting the voice interaction.
- While the reader is already paused: **play** resumes reading normally.
- With the shortcut off: play/pause returns to its ordinary reader toggle behavior.
- Next track remains Next phrase.
- Previous track remains Back one phrase.
- Rewind/skip backward repeats the current phrase when the headset exposes that media command.

## Compatibility notes

- This uses the OS-standard play, pause and toggle media events. It does not pair with, scan for, or reconfigure the headset.
- Wired EarPods with a centre button normally expose play/pause. Many single-ear Bluetooth buds also expose a multifunction play/pause control, but exact gestures vary by model and vendor settings.
- If a manufacturer reserves the control for Siri/Google Assistant or does not send its event to third-party media sessions, Exam Mate cannot intercept it. Use the on-screen Ask button or wake phrase in that case.
- This is a button-triggered Ask shortcut, not an always-on hotword listener. After the button press, speak the question. Voice recognition still needs microphone permission, speech-recognition availability and Exam Mate active in the foreground.
- The headset microphone is only used when the headset exposes a microphone route and the OS speech service selects it. Otherwise playback can still go to the headset while the phone microphone is used for speech input.

## Testing checklist

- Wired EarPods: start reading and click the centre button once; Ask should open. With reading paused, click again; reading should resume.
- One Bluetooth earbud: test its main play/pause control while reading; Ask should open if the phone sends a standard media event.
- Two Bluetooth earbuds: same test.
- Shortcut disabled: play/pause toggles reading and previous track remains Back.
- Shortcut enabled: next and previous retain navigation; only play/pause while actively reading starts Ask.
- After Ask answers, confirm reading resumes at the interrupted phrase.
- Test with the screen on and separately with the device locked. Background microphone capture is not guaranteed by iOS/Android.
