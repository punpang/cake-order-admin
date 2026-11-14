package com.punpang.cakeadmin;

import android.os.Bundle;
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
        hideStatusBar();
    }

    // ซ่อนแถบบนของระบบ (นาฬิกา สัญญาณ) ให้แอปใช้พื้นที่เต็มจอ · ปัดลงจากขอบบนจะแสดงชั่วคราวแล้วซ่อนเองอัตโนมัติ
    private void hideStatusBar() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.statusBars());
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // กลับมาโฟกัสหลังดึงแถบแจ้งเตือน/กดสลับแอป ให้ซ่อนแถบบนอีกครั้ง
        if (hasFocus) hideStatusBar();
    }
}
