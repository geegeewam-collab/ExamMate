package com.exammate.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app updates for the sideloaded APK: reads the installed version, downloads a newer release into the app cache,
 * checks it is really a newer ExamMate build, then hands it to Android's own installer. Android installs it over the
 * existing app (keeping the license, key and saved papers) and refuses any APK signed with a different key.
 */
@CapacitorPlugin(name = "ExamMateUpdater")
public final class ExamMateUpdaterPlugin extends Plugin {
    private static final int MAX_BYTES = 200 * 1024 * 1024;
    private volatile boolean downloading = false;

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageInfo info = packages().getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionName", info.versionName == null ? "" : info.versionName);
            result.put("versionCode", versionCode(info));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not read the app version.", error);
        }
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packages().canRequestPackageInstalls());
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open the install settings.", error);
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("The update address is not valid.");
            return;
        }
        if (downloading) {
            call.reject("The update is already downloading.");
            return;
        }
        downloading = true;
        new Thread(() -> {
            File dir = new File(getContext().getCacheDir(), "updates");
            File apk = new File(dir, "ExamMate-update.apk");
            try {
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("Could not prepare storage for the update.");
                download(url, apk);
                checkIsNewerExamMate(apk);
                openInstaller(apk);
                call.resolve();
            } catch (Exception error) {
                //noinspection ResultOfMethodCallIgnored
                apk.delete();
                String message = error.getMessage();
                call.reject(message != null && !message.isEmpty() ? message : "The update could not be downloaded.", error);
            } finally {
                downloading = false;
            }
        }, "ExamMateUpdate").start();
    }

    private void download(String address, File target) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(60_000);
        try {
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new IOException("The update could not be downloaded (error " + status + ").");
            long total = connection.getContentLengthLong();
            if (total > MAX_BYTES) throw new IOException("The update file is unexpectedly large.");
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                long done = 0;
                int lastPercent = -1;
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    done += read;
                    if (done > MAX_BYTES) throw new IOException("The update file is unexpectedly large.");
                    if (total > 0) {
                        int percent = (int) (done * 100 / total);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            JSObject progress = new JSObject();
                            progress.put("percent", percent);
                            notifyListeners("progress", progress);
                        }
                    }
                }
            }
        } finally {
            connection.disconnect();
        }
    }

    /** Refuses anything that is not ExamMate or is not newer than the installed build. */
    private void checkIsNewerExamMate(File apk) throws Exception {
        PackageInfo downloaded = packages().getPackageArchiveInfo(apk.getPath(), 0);
        if (downloaded == null) throw new IOException("The downloaded file is not a valid app. Try again.");
        String ours = getContext().getPackageName();
        if (!ours.equals(downloaded.packageName)) throw new IOException("The downloaded file is not Exam Mate.");
        PackageInfo installed = packages().getPackageInfo(ours, 0);
        if (versionCode(downloaded) <= versionCode(installed)) throw new IOException("You already have the latest version.");
    }

    private void openInstaller(File apk) {
        Context context = getContext();
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    private PackageManager packages() {
        return getContext().getPackageManager();
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }
}
