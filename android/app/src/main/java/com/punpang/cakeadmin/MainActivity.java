package com.punpang.cakeadmin;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ปลั๊กอินของแอปนี้ต้องลงทะเบียนก่อน super.onCreate
        registerPlugin(BtPrinterPlugin.class);
        registerPlugin(CustomerDisplayPlugin.class);
        super.onCreate(savedInstanceState);
        keepClearOfStatusBar();
        hideNavigationBar();
    }

    // ซ่อนแถบนำทางล่าง (ปุ่มกลับ/หน้าแรก/เมนู) · ปัดขอบล่างขึ้นเพื่อแสดงชั่วคราว แล้วซ่อนเองอัตโนมัติ
    private void hideNavigationBar() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.navigationBars());
    }

    // แถบจะกลับมาเมื่อเปิดป๊อปอัปของระบบ (เช่น ขอสิทธิ์) จึงซ่อนใหม่ทุกครั้งที่หน้าต่างกลับมาโฟกัส
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideNavigationBar();
    }

    // แถบบนของระบบ (นาฬิกา สัญญาณ) แสดงตามปกติ · เว้นพื้นที่ด้านบนเท่าความสูงของแถบนั้น เนื้อหาแอปจึงไม่ทับ
    private void keepClearOfStatusBar() {
        View webView = getBridge().getWebView();
        if (!(webView.getParent() instanceof ViewGroup)) return;
        ViewGroup container = (ViewGroup) webView.getParent();
        // พื้นที่แถบบนใช้สีเดียวกับหัวแอป (ครีม) และให้ไอคอนแถบบนเป็นสีเข้มให้มองเห็น
        container.setBackgroundColor(Color.parseColor("#FFF8F2"));
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(true);
        ViewCompat.setOnApplyWindowInsetsListener(container, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            v.setPadding(0, bars.top, 0, 0);
            return insets;
        });
    }
}
