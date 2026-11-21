package in.shazverse.srktrading;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.JsonReader;
import android.util.JsonToken;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.CookieHandler;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.GZIPInputStream;

/**
 * SRK Trading — WebView shell. The whole interface lives in assets/www.
 * Native side only does what a WebView can't: cross-site HTTP (Angel One,
 * Yahoo Finance, NSE — no CORS limits, NSE cookies kept) and streaming the
 * large Angel One instrument list without loading it all into JavaScript.
 */
public class MainActivity extends AppCompatActivity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/www/index.html";
    private static final String SCRIP_URL =
            "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";

    private WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(6);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object scripLock = new Object();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        CookieManager cm = new CookieManager();
        cm.setCookiePolicy(CookiePolicy.ACCEPT_ALL);
        CookieHandler.setDefault(cm);

        web = new WebView(this);
        setContentView(web);
        ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {
            Insets b = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            v.setPadding(b.left, b.top, b.right, b.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return loader.shouldInterceptRequest(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException ignored) { }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "SRKNative");
        web.loadUrl(START);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                web.evaluateJavascript("window.srkBack ? window.srkBack() : false", value -> {
                    if (!"true".equals(value)) finish();
                });
            }
        });
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private void reply(String fn, String id, JSONObject payload) {
        final String js = "window." + fn + "(" + JSONObject.quote(id) + "," + payload.toString() + ")";
        main.post(() -> { if (web != null) web.evaluateJavascript(js, null); });
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static HttpURLConnection open(String url, String method, JSONObject headers) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("Accept-Encoding", "gzip");
        if (headers != null) {
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                c.setRequestProperty(k, headers.optString(k));
            }
        }
        return c;
    }

    private static InputStream body(HttpURLConnection c) throws Exception {
        InputStream in = c.getResponseCode() >= 400 ? c.getErrorStream() : c.getInputStream();
        if (in == null) return new java.io.ByteArrayInputStream(new byte[0]);
        if ("gzip".equalsIgnoreCase(c.getContentEncoding())) in = new GZIPInputStream(in);
        return new BufferedInputStream(in);
    }

    private class Bridge {
        /** Async HTTP. Result: window.__srkHttp(id, {status, body, error}) */
        @JavascriptInterface
        public void http(final String id, final String method, final String url,
                         final String headersJson, final String reqBody) {
            pool.execute(() -> {
                JSONObject res = new JSONObject();
                try {
                    JSONObject h = headersJson == null || headersJson.isEmpty() ? null : new JSONObject(headersJson);
                    HttpURLConnection c = open(url, method == null ? "GET" : method, h);
                    if (reqBody != null && !reqBody.isEmpty()) {
                        c.setDoOutput(true);
                        try (OutputStream os = c.getOutputStream()) {
                            os.write(reqBody.getBytes(StandardCharsets.UTF_8));
                        }
                    }
                    int code = c.getResponseCode();
                    String text;
                    try (InputStream in = body(c)) {
                        text = new String(readAll(in), StandardCharsets.UTF_8);
                    }
                    res.put("status", code);
                    res.put("body", text);
                } catch (Exception e) {
                    try {
                        res.put("status", 0);
                        res.put("error", String.valueOf(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
                    } catch (Exception ignored) { }
                }
                reply("__srkHttp", id, res);
            });
        }

        /**
         * Search the Angel One instrument master (≈ tens of MB) natively.
         * filterJson: {"name":"NIFTY","exch_seg":"NFO","instrumenttype":"OPTIDX","expiry":"25NOV2026","symbol":"RELIANCE-EQ"}
         * Any field may be omitted. Result: window.__srkScrip(id, {items:[...], error}) — max 4000 rows.
         * The file is cached for the day.
         */
        @JavascriptInterface
        public void scripSearch(final String id, final String filterJson) {
            pool.execute(() -> {
                JSONObject res = new JSONObject();
                try {
                    JSONObject f = new JSONObject(filterJson);
                    File file = ensureScripFile();
                    JSONArray items = new JSONArray();
                    try (JsonReader r = new JsonReader(new InputStreamReader(new BufferedInputStream(new FileInputStream(file)), StandardCharsets.UTF_8))) {
                        r.beginArray();
                        while (r.hasNext()) {
                            JSONObject row = new JSONObject();
                            r.beginObject();
                            while (r.hasNext()) {
                                String k = r.nextName();
                                JsonToken tk = r.peek();
                                if (tk == JsonToken.NULL) { r.nextNull(); continue; }
                                if (tk == JsonToken.BOOLEAN) { row.put(k, String.valueOf(r.nextBoolean())); continue; }
                                if (tk == JsonToken.BEGIN_ARRAY || tk == JsonToken.BEGIN_OBJECT) { r.skipValue(); continue; }
                                row.put(k, r.nextString());
                            }
                            r.endObject();
                            if (matches(row, f) && items.length() < 4000) items.put(row);
                        }
                        r.endArray();
                    }
                    res.put("items", items);
                } catch (Exception e) {
                    try { res.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
                }
                reply("__srkScrip", id, res);
            });
        }

        @JavascriptInterface
        public void openUrl(String url) {
            main.post(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
                catch (ActivityNotFoundException ignored) { }
            });
        }

        @JavascriptInterface
        public void share(String text) {
            main.post(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, "Share"));
            });
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }
    }

    private static boolean matches(JSONObject row, JSONObject f) {
        Iterator<String> keys = f.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            if (!f.optString(k).equalsIgnoreCase(row.optString(k))) return false;
        }
        return true;
    }

    private File ensureScripFile() throws Exception {
        synchronized (scripLock) {
            File file = new File(getCacheDir(), "angel_scrip_master.json");
            long day = 24L * 3600 * 1000;
            if (file.exists() && file.length() > 1_000_000
                    && System.currentTimeMillis() - file.lastModified() < day / 2) return file;
            HttpURLConnection c = open(SCRIP_URL, "GET", null);
            if (c.getResponseCode() != 200) throw new Exception("Instrument list HTTP " + c.getResponseCode());
            File tmp = new File(getCacheDir(), "angel_scrip_master.tmp");
            try (InputStream in = body(c); OutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            if (!tmp.renameTo(file)) throw new Exception("Could not save instrument list");
            return file;
        }
    }
}
