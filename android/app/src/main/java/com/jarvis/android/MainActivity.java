package com.jarvis.android;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.provider.Settings;
import android.os.Vibrator;
import android.os.VibrationEffect;
import android.os.Looper;
import android.os.Build;
import android.os.Bundle;
import android.graphics.Color;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;

public class MainActivity extends Activity {
    private static final String JARVIS_URL = "https://appassets.androidplatform.net/assets/jarvis/index.html";
    private static final int FILE_CHOOSER_REQUEST = 42;
    private WebView webView;
    private PermissionRequest pendingPermissionRequest;
    private ValueCallback<Uri[]> pendingFileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        getWindow().setStatusBarColor(Color.rgb(7, 18, 29));
        getWindow().setNavigationBarColor(Color.rgb(7, 18, 29));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(true);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
        webView.setFitsSystemWindows(true);
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            int top = 0;
            int bottom = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                top = bars.top;
                bottom = bars.bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            view.setPadding(0, top, 0, bottom);
            return insets;
        });

        webView.setBackgroundColor(0xFF07121D);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.getSettings().setDisplayZoomControls(false);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setSupportMultipleWindows(false);
        webView.addJavascriptInterface(new JarvisBridge(), "JarvisAndroid");

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = filePathCallback;
                Intent chooser = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                chooser.addCategory(Intent.CATEGORY_OPENABLE);
                chooser.setType("*/*");
                chooser.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
                chooser.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(chooser, FILE_CHOOSER_REQUEST);
                } catch (Exception error) {
                    pendingFileCallback = null;
                    filePathCallback.onReceiveValue(null);
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                            && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        pendingPermissionRequest = request;
                        request.deny();
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 41);
                        return;
                    }
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                });
            }
        });

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 41);
        }
        webView.loadUrl(JARVIS_URL);
        webView.requestApplyInsets();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || pendingFileCallback == null) return;
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int index = 0; index < count; index++) results[index] = data.getClipData().getItemAt(index).getUri();
            } else if (data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
        }
        pendingFileCallback.onReceiveValue(results);
        pendingFileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != 41) return;
        if (pendingPermissionRequest != null) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pendingPermissionRequest.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                pendingPermissionRequest.deny();
            }
            pendingPermissionRequest = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    /**
     * Small, explicit Android bridge used by Jarvis tool calls. Every call is
     * approved in the web UI before it reaches this class. It only operates on
     * the Android device that currently runs the app; it never controls Windows.
     */
    private final class JarvisBridge {
        @JavascriptInterface
        public String performAction(String action, String json) {
            if (Looper.myLooper() != Looper.getMainLooper()) {
                final String[] output = new String[1];
                CountDownLatch latch = new CountDownLatch(1);
                runOnUiThread(() -> { output[0] = performActionOnUiThread(action, json); latch.countDown(); });
                try { latch.await(8, java.util.concurrent.TimeUnit.SECONDS); }
                catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
                return output[0] == null ? error("Android no respondió a tiempo.") : output[0];
            }
            return performActionOnUiThread(action, json);
        }

        private String performActionOnUiThread(String action, String json) {
            try {
                JSONObject args = new JSONObject(json == null ? "{}" : json);
                JSONObject result = new JSONObject();
                switch (action == null ? "" : action) {
                    case "get_system_info":
                        result.put("dispositivo", Build.MANUFACTURER + " " + Build.MODEL);
                        result.put("android", Build.VERSION.RELEASE);
                        result.put("sdk", Build.VERSION.SDK_INT);
                        return success(result);
                    case "open_app":
                        openApplication(args.optString("app", ""));
                        result.put("abierta", args.optString("app", "aplicación"));
                        return success(result);
                    case "open_url":
                        openUrl(args.optString("url", ""));
                        result.put("abierto", args.optString("url", "enlace"));
                        return success(result);
                    case "share_text":
                        shareText(args.optString("text", ""), args.optString("title", "Compartir con Jarvis"));
                        result.put("compartido", true);
                        return success(result);
                    case "open_settings":
                        openSettings(args.optString("section", "general"));
                        result.put("ajustes", args.optString("section", "general"));
                        return success(result);
                    case "open_camera":
                        startActivity(new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE));
                        result.put("camara", true);
                        return success(result);
                    case "open_gallery":
                        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                        picker.addCategory(Intent.CATEGORY_OPENABLE);
                        picker.setType("image/*");
                        picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
                        startActivity(picker);
                        result.put("galeria", true);
                        return success(result);
                    case "vibrate":
                        vibrate(Math.max(50, Math.min(2000, args.optInt("milliseconds", 300))));
                        result.put("vibrado", true);
                        return success(result);
                    default:
                        return error("La acción «" + action + "» todavía no está disponible de forma nativa en Android.");
                }
            } catch (Exception error) {
                return error(error.getMessage() == null ? "No se pudo ejecutar la acción en Android." : error.getMessage());
            }
        }

        private String success(JSONObject result) {
            try { return new JSONObject().put("result", result).toString(); }
            catch (Exception ignored) { return "{\"result\":{}}"; }
        }

        private String error(String message) {
            try { return new JSONObject().put("error", message).toString(); }
            catch (Exception ignored) { return "{\"error\":\"Acción no disponible\"}"; }
        }

        private void openApplication(String requested) {
            String query = requested == null ? "" : requested.trim().toLowerCase(Locale.ROOT);
            if (query.isEmpty()) throw new IllegalArgumentException("Indica qué aplicación quieres abrir.");
            String[] knownPackages = {
                    "com.android.calculator2", "com.google.android.calculator", "com.android.chrome",
                    "com.google.android.youtube", "com.whatsapp", "com.instagram.android",
                    "com.roblox.client", "com.spotify.music", "com.discord"
            };
            PackageManager manager = getPackageManager();
            for (String packageName : knownPackages) {
                Intent launch = manager.getLaunchIntentForPackage(packageName);
                if (launch != null) {
                    ApplicationInfo info;
                    try { info = manager.getApplicationInfo(packageName, 0); }
                    catch (PackageManager.NameNotFoundException ignored) { continue; }
                    String label = String.valueOf(manager.getApplicationLabel(info)).toLowerCase(Locale.ROOT);
                    if (label.contains(query) || query.contains(label) || packageName.contains(query)) {
                        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(launch);
                        return;
                    }
                }
            }
            for (ApplicationInfo info : manager.getInstalledApplications(PackageManager.GET_META_DATA)) {
                Intent launch = manager.getLaunchIntentForPackage(info.packageName);
                if (launch == null) continue;
                String label = String.valueOf(manager.getApplicationLabel(info)).toLowerCase(Locale.ROOT);
                if (label.contains(query) || query.contains(label)) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(launch);
                    return;
                }
            }
            throw new IllegalArgumentException("No encontré «" + requested + "» entre las aplicaciones instaladas.");
        }

        private void openUrl(String value) {
            if (value == null || !(value.startsWith("https://") || value.startsWith("http://"))) throw new IllegalArgumentException("Solo se pueden abrir enlaces http o https.");
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(value)));
        }

        private void shareText(String text, String title) {
            if (text == null || text.trim().isEmpty()) throw new IllegalArgumentException("No hay texto para compartir.");
            Intent share = new Intent(Intent.ACTION_SEND);
            share.setType("text/plain");
            share.putExtra(Intent.EXTRA_TEXT, text);
            startActivity(Intent.createChooser(share, title == null ? "Compartir" : title));
        }

        private void openSettings(String section) {
            String value = section == null ? "" : section.toLowerCase(Locale.ROOT);
            String action = Settings.ACTION_SETTINGS;
            if (value.contains("wifi") || value.contains("wi-fi")) action = Settings.ACTION_WIFI_SETTINGS;
            else if (value.contains("bluetooth")) action = Settings.ACTION_BLUETOOTH_SETTINGS;
            else if (value.contains("aplic")) action = Settings.ACTION_APPLICATION_SETTINGS;
            else if (value.contains("sonido") || value.contains("audio")) action = Settings.ACTION_SOUND_SETTINGS;
            startActivity(new Intent(action));
        }

        private void vibrate(int milliseconds) {
            Vibrator vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null) throw new IllegalStateException("Este dispositivo no tiene vibrador disponible.");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(VibrationEffect.createOneShot(milliseconds, VibrationEffect.DEFAULT_AMPLITUDE));
            else vibrator.vibrate(milliseconds);
        }
    }
}
