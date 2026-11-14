package com.punpang.cakeadmin;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ปลั๊กอินของแอปนี้ต้องลงทะเบียนก่อน super.onCreate
        registerPlugin(BtPrinterPlugin.class);
        registerPlugin(CustomerDisplayPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
