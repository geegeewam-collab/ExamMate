package com.exammate.app;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/** Native Android media session for Bluetooth and wired headset transport controls. */
@CapacitorPlugin(name = "ExamMateMedia")
public final class ExamMateMediaPlugin extends Plugin {
    private MediaSession mediaSession;
    private boolean active = false;
    private String title = "Exam Mate";
    private String subtitle = "";
    private boolean playing = false;

    @PluginMethod
    public void activate(PluginCall call) {
        try {
            ensureSession();
            updateSessionState();
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not activate headset controls.", error);
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        title = safe(call.getString("title"), "Exam Mate");
        subtitle = safe(call.getString("subtitle"), "");
        playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        active = Boolean.TRUE.equals(call.getBoolean("active", false));
        try {
            if (active) ensureSession();
            updateSessionState();
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not update headset controls.", error);
        }
    }

    @PluginMethod
    public void deactivate(PluginCall call) {
        releaseSession();
        call.resolve();
    }

    @PluginMethod
    public void getAudioRoutes(PluginCall call) {
        JSObject result = new JSObject();
        JSArray inputs = new JSArray();
        JSArray outputs = new JSArray();
        try {
            AudioManager manager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (manager != null) {
                for (AudioDeviceInfo device : manager.getDevices(AudioManager.GET_DEVICES_ALL)) {
                    String label = deviceLabel(device);
                    if (device.isSource()) inputs.put(label);
                    if (device.isSink()) outputs.put(label);
                }
            }
        } catch (SecurityException ignored) {
            // Audio routing itself remains managed by Android. Route labels are optional diagnostics.
        }
        result.put("inputs", inputs);
        result.put("outputs", outputs);
        call.resolve(result);
    }

    private void ensureSession() {
        if (mediaSession != null) return;
        mediaSession = new MediaSession(getContext(), "ExamMate");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { emitAction("play"); }
            @Override public void onPause() { emitAction("pause"); }
            @Override public void onSkipToNext() { emitAction("next"); }
            @Override public void onSkipToPrevious() { emitAction("back"); }
            @Override public void onFastForward() { emitAction("fastforward"); }
            @Override public void onRewind() { emitAction("repeat"); }
            @Override public void onStop() { emitAction("pause"); }
        });
        mediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setActive(true);
    }

    private void updateSessionState() {
        if (mediaSession == null) return;
        if (!active) {
            mediaSession.setPlaybackState(new PlaybackState.Builder()
                .setActions(0)
                .setState(PlaybackState.STATE_NONE, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 0f)
                .build());
            mediaSession.setActive(false);
            return;
        }

        mediaSession.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, "Exam Mate")
            .putString(MediaMetadata.METADATA_KEY_ALBUM, subtitle)
            .build());

        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
            PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT |
            PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_FAST_FORWARD |
            PlaybackState.ACTION_REWIND | PlaybackState.ACTION_STOP;
        mediaSession.setPlaybackState(new PlaybackState.Builder()
            .setActions(actions)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                PlaybackState.PLAYBACK_POSITION_UNKNOWN, playing ? 1f : 0f)
            .build());
        mediaSession.setActive(true);
    }

    private void emitAction(String action) {
        JSObject payload = new JSObject();
        payload.put("action", action);
        notifyListeners("mediaAction", payload);
    }

    private void releaseSession() {
        active = false;
        if (mediaSession != null) {
            try {
                mediaSession.setActive(false);
                mediaSession.release();
            } catch (Exception ignored) { }
            mediaSession = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        releaseSession();
        super.handleOnDestroy();
    }

    private static String safe(String value, String fallback) {
        if (value == null) return fallback;
        String clean = value.trim();
        return clean.isEmpty() ? fallback : clean;
    }

    private static String deviceLabel(AudioDeviceInfo device) {
        String type;
        switch (device.getType()) {
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP: type = "Bluetooth audio"; break;
            case AudioDeviceInfo.TYPE_BLE_HEADSET: type = "Bluetooth LE headset"; break;
            case AudioDeviceInfo.TYPE_BLE_SPEAKER: type = "Bluetooth LE audio"; break;
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: type = "Bluetooth headset"; break;
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: type = "Wired headphones"; break;
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: type = "Wired headset"; break;
            case AudioDeviceInfo.TYPE_USB_HEADSET: type = "USB headset"; break;
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: type = "Phone earpiece"; break;
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: type = "Phone speaker"; break;
            default: type = "Audio device"; break;
        }
        String name = device.getProductName() == null ? "" : device.getProductName().toString().trim();
        return name.isEmpty() ? type : type + " · " + name;
    }
}
