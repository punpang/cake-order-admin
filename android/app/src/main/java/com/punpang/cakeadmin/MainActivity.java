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
