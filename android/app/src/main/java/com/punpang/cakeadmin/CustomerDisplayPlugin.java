package com.punpang.cakeadmin;

import android.app.Activity;
import android.app.Presentation;
import android.content.Context;
import android.graphics.Color;
import android.hardware.display.DisplayManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.Display;
import android.view.ViewGroup;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

// จอแสดงให้ลูกค้า: แสดงหน้า /display ของแอปบนจอที่สอง (Presentation) แล้วส่งสถานะจาก POS เข้าไปด้วย evaluateJavascript
@CapacitorPlugin(name = "CustomerDisplay")
public class CustomerDisplayPlugin extends Plugin {

    private CustomerPresentation presentation;
    private String lastJson = null;

    private static Display[] externalDisplays(Context ctx) {
        DisplayManager dm = (DisplayManager) ctx.getSystemService(Context.DISPLAY_SERVICE);
        return dm.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject res = new JSObject();
        res.put("count", externalDisplays(getContext()).length);
        call.resolve(res);
    }

    @PluginMethod
    public void show(PluginCall call) {
        final Activity act = getActivity();
        if (act == null) {
            call.reject("แอปยังไม่พร้อม");
            return;
        }
        final Display[] displays = externalDisplays(act);
        if (displays.length == 0) {
            call.reject("ไม่พบจอที่สองที่ต่ออยู่");
            return;
        }
        act.runOnUiThread(() -> {
            try {
                if (presentation != null) presentation.dismiss();
                presentation = new CustomerPresentation(act, displays[0]);
                presentation.setPending(lastJson);
                presentation.show();
                call.resolve();
            } catch (Exception e) {
                call.reject("เปิดจอลูกค้าไม่สำเร็จ: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void update(PluginCall call) {
        final String json = call.getString("json", "{}");
        lastJson = json;
        Activity act = getActivity();
        if (act != null) {
            act.runOnUiThread(() -> {
                if (presentation != null) presentation.push(json);
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void hide(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.resolve();
            return;
        }
        act.runOnUiThread(() -> {
            if (presentation != null) {
                presentation.dismiss();
                presentation = null;
            }
            call.resolve();
        });
    }

    // อ่านไฟล์ของเว็บจากโฟลเดอร์ public ที่ Capacitor คัดลอกไว้ (โดเมน localhost เท่านั้น)
    static WebResourceResponse assetResponse(Context ctx, String path) {
        String p = (path == null || path.isEmpty() || "/".equals(path)) ? "/index.html" : path;
        String rel = "public" + p;
        try {
            InputStream in = ctx.getAssets().open(rel);
            return new WebResourceResponse(mimeOf(rel), "UTF-8", in);
        } catch (IOException e) {
            return null;
        }
    }

    static String mimeOf(String name) {
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        if ("js".equals(ext) || "mjs".equals(ext)) return "text/javascript";
        if ("woff2".equals(ext)) return "font/woff2";
        if ("woff".equals(ext)) return "font/woff";
        String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return m != null ? m : "application/octet-stream";
    }

    static class CustomerPresentation extends Presentation {
        private WebView web;
        private String pending;
        private boolean loaded = false;

        CustomerPresentation(Context ctx, Display display) {
            super(ctx, display);
        }

        void setPending(String json) {
            pending = json;
        }

        void push(String json) {
            if (web == null || !loaded || json == null) return;
            web.evaluateJavascript("window.__displayUpdate && window.__displayUpdate(" + json + ");", null);
        }

        @Override
        protected void onCreate(Bundle savedInstanceState) {
            super.onCreate(savedInstanceState);
            final Context ctx = getContext();
            web = new WebView(ctx);
            web.setBackgroundColor(Color.WHITE);
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            web.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    Uri u = request.getUrl();
                    if (!"localhost".equals(u.getHost())) return null;
                    return assetResponse(ctx, u.getPath());
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    loaded = true;
                    if (pending != null) push(pending);
                }
            });
            setContentView(web, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.loadUrl("https://localhost/index.html#/display");
        }
    }
}
