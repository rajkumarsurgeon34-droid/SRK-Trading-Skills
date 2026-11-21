package in.shazverse.srktrading;

import android.annotation.SuppressLint;
import android.app.Dialog;
import android.graphics.Bitmap;
import android.util.Base64;
import android.view.ViewGroup;
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
import java.io.BufferedReader;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;
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
    private static final String HDFC_MASTER_URL = "https://developer.hdfcsec.com/oapi/v1/security-master";
    private final OkHttpClient ok = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS)
            .pingInterval(20, TimeUnit.SECONDS).build();
    private Dialog loginDialog;

    private WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(6);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object scripLock = new Object();
    private final Object masterLock = new Object();

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

        /**
         * Broker login page shown inside the app. When the page redirects to a URL
         * starting with redirectPrefix, its query parameters are returned:
         * window.__srkLogin(id, {params:{...}} | {error}).
         */
        @JavascriptInterface
        public void brokerLogin(final String id, final String loginUrl, final String redirectPrefix) {
            main.post(() -> openLoginDialog(id, loginUrl, redirectPrefix));
        }

        /**
         * Search the HDFC Securities security master (CSV, cached half a day).
         * filterJson: {"exchange":"NSE","instrument_segment":"OPTIDX","symbol_name":"NIFTY"} — exact, case-insensitive.
         * Result: window.__srkScrip(id, {items:[{column:value}], error}) — max 6000 rows.
         */
        @JavascriptInterface
        public void hdfcMasterSearch(final String id, final String filterJson) {
            pool.execute(() -> {
                JSONObject res = new JSONObject();
                try {
                    JSONObject f = new JSONObject(filterJson);
                    File file = ensureHdfcMaster();
                    JSONArray items = new JSONArray();
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
                        String headerLine = br.readLine();
                        if (headerLine == null) throw new Exception("Empty security master");
                        if (headerLine.startsWith("\uFEFF")) headerLine = headerLine.substring(1);
                        List<String> head = parseCsvLine(headerLine);
                        for (int i = 0; i < head.size(); i++) head.set(i, head.get(i).trim().toLowerCase());
                        String line;
                        while ((line = br.readLine()) != null && items.length() < 6000) {
                            List<String> cells = parseCsvLine(line);
                            JSONObject row = new JSONObject();
                            for (int i = 0; i < head.size() && i < cells.size(); i++) row.put(head.get(i), cells.get(i).trim());
                            if (matches(row, f)) items.put(row);
                        }
                    }
                    res.put("items", items);
                } catch (Exception e) {
                    try { res.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
                }
                reply("__srkScrip", id, res);
            });
        }

        /**
         * Open a WebSocket, send the given text frames, collect binary frames for up to waitMs,
         * then close. Result: window.__srkWs(id, {frames:[base64...], texts:[...], error}).
         */
        @JavascriptInterface
        public void wsSnapshot(final String id, final String url, final String headersJson,
                               final String framesJson, final int waitMs) {
            pool.execute(() -> {
                final JSONArray frames = new JSONArray();
                final JSONArray texts = new JSONArray();
                final String[] err = {null};
                final AtomicBoolean done = new AtomicBoolean(false);
                final Object lock = new Object();
                WebSocket ws = null;
                try {
                    Request.Builder rb = new Request.Builder().url(url);
                    JSONObject h = headersJson == null || headersJson.isEmpty() ? new JSONObject() : new JSONObject(headersJson);
                    Iterator<String> keys = h.keys();
                    while (keys.hasNext()) { String k = keys.next(); rb.header(k, h.optString(k)); }
                    final JSONArray send = new JSONArray(framesJson);
                    ws = ok.newWebSocket(rb.build(), new WebSocketListener() {
                        @Override public void onOpen(@NonNull WebSocket w, @NonNull Response r) {
                            for (int i = 0; i < send.length(); i++) w.send(send.optString(i));
                        }
                        @Override public void onMessage(@NonNull WebSocket w, @NonNull ByteString bytes) {
                            synchronized (lock) { frames.put(Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)); }
                        }
                        @Override public void onMessage(@NonNull WebSocket w, @NonNull String text) {
                            synchronized (lock) { if (texts.length() < 50) texts.put(text); }
                        }
                        @Override public void onFailure(@NonNull WebSocket w, @NonNull Throwable t, Response r) {
                            synchronized (lock) {
                                err[0] = (r != null ? "HTTP " + r.code() + " " : "") + t.getMessage();
                                done.set(true); lock.notifyAll();
                            }
                        }
                        @Override public void onClosed(@NonNull WebSocket w, int code, @NonNull String reason) {
                            synchronized (lock) { done.set(true); lock.notifyAll(); }
                        }
                    });
                    long end = System.currentTimeMillis() + Math.max(1000, Math.min(waitMs, 20000));
                    synchronized (lock) {
                        while (!done.get()) {
                            long left = end - System.currentTimeMillis();
                            if (left <= 0) break;
                            lock.wait(left);
                        }
                    }
                } catch (Exception e) {
                    err[0] = String.valueOf(e.getMessage());
                } finally {
                    if (ws != null) ws.close(1000, "done");
                }
                JSONObject res = new JSONObject();
                try {
                    synchronized (lock) { res.put("frames", frames); res.put("texts", texts); }
                    if (err[0] != null) res.put("error", err[0]);
                } catch (Exception ignored) { }
                reply("__srkWs", id, res);
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

    private void openLoginDialog(final String id, final String loginUrl, final String redirectPrefix) {
        if (loginDialog != null) loginDialog.dismiss();
        final AtomicBoolean replied = new AtomicBoolean(false);
        final Dialog d = new Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        final WebView lw = new WebView(this);
        lw.getSettings().setJavaScriptEnabled(true);
        lw.getSettings().setDomStorageEnabled(true);
        lw.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        lw.setWebViewClient(new WebViewClient() {
            private boolean capture(String url) {
                if (url == null || !url.startsWith(redirectPrefix)) return false;
                if (replied.compareAndSet(false, true)) {
                    JSONObject res = new JSONObject();
                    try {
                        JSONObject params = new JSONObject();
                        Uri u = Uri.parse(url);
                        for (String k : u.getQueryParameterNames()) params.put(k, u.getQueryParameter(k));
                        String frag = u.getFragment();
                        if (frag != null) {
                            Uri fu = Uri.parse("x://y?" + frag);
                            for (String k : fu.getQueryParameterNames()) params.put(k, fu.getQueryParameter(k));
                        }
                        res.put("params", params);
                    } catch (Exception e) {
                        try { res.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
                    }
                    reply("__srkLogin", id, res);
                }
                d.dismiss();
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return capture(r.getUrl().toString()); }
            @Override public void onPageStarted(WebView v, String url, Bitmap fav) {
                if (capture(url)) v.stopLoading(); else super.onPageStarted(v, url, fav);
            }
        });
        d.setContentView(lw);
        d.setOnDismissListener(x -> {
            if (replied.compareAndSet(false, true)) {
                JSONObject res = new JSONObject();
                try { res.put("error", "Login cancelled"); } catch (Exception ignored) { }
                reply("__srkLogin", id, res);
            }
            lw.destroy();
            loginDialog = null;
        });
        loginDialog = d;
        d.show();
        lw.loadUrl(loginUrl);
    }

    private static List<String> parseCsvLine(String line) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean q = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (q) {
                if (c == '"') {
                    if (i + 1 < line.length() && line.charAt(i + 1) == '"') { cur.append('"'); i++; }
                    else q = false;
                } else cur.append(c);
            } else if (c == '"') q = true;
            else if (c == ',') { out.add(cur.toString()); cur.setLength(0); }
            else cur.append(c);
        }
        out.add(cur.toString());
        return out;
    }

    private File ensureHdfcMaster() throws Exception {
        synchronized (masterLock) {
            File file = new File(getCacheDir(), "hdfc_security_master.csv");
            long half = 12L * 3600 * 1000;
            if (file.exists() && file.length() > 500_000 && System.currentTimeMillis() - file.lastModified() < half) return file;
            HttpURLConnection c = open(HDFC_MASTER_URL, "GET", null);
            if (c.getResponseCode() != 200) throw new Exception("HDFC security master HTTP " + c.getResponseCode());
            File tmp = new File(getCacheDir(), "hdfc_security_master.tmp");
            try (InputStream in = body(c); OutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            if (!tmp.renameTo(file)) throw new Exception("Could not save security master");
            return file;
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
