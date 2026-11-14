package com.punpang.cakeadmin;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

// เครื่องพิมพ์ใบเสร็จ Bluetooth (SPP / RFCOMM) · รายการเครื่องที่จับคู่แล้ว + ส่งข้อมูลภาพ ESC/POS
@CapacitorPlugin(
    name = "BtPrinter",
    permissions = {
        @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "bluetooth")
    }
)
public class BtPrinterPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private boolean hasBtPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return getPermissionState("bluetooth") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void list(PluginCall call) {
        if (!hasBtPermission()) {
            requestPermissionForAlias("bluetooth", call, "afterListPermission");
            return;
        }
        listPaired(call);
    }

    @PermissionCallback
    private void afterListPermission(PluginCall call) {
        if (hasBtPermission()) listPaired(call);
        else call.reject("ยังไม่ได้รับสิทธิ์ Bluetooth");
    }

    private void listPaired(PluginCall call) {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.reject("อุปกรณ์นี้ไม่มี Bluetooth");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("กรุณาเปิด Bluetooth ก่อน");
            return;
        }
        JSArray devices = new JSArray();
        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        if (bonded != null) {
            for (BluetoothDevice d : bonded) {
                JSObject o = new JSObject();
                o.put("name", d.getName() == null ? "" : d.getName());
                o.put("address", d.getAddress());
                devices.put(o);
            }
        }
        JSObject res = new JSObject();
        res.put("devices", devices);
        call.resolve(res);
    }

    @PluginMethod
    public void print(PluginCall call) {
        if (!hasBtPermission()) {
            requestPermissionForAlias("bluetooth", call, "afterPrintPermission");
            return;
        }
        printNow(call);
    }

    @PermissionCallback
    private void afterPrintPermission(PluginCall call) {
        if (hasBtPermission()) printNow(call);
        else call.reject("ยังไม่ได้รับสิทธิ์ Bluetooth");
    }

    private void printNow(PluginCall call) {
        final String address = call.getString("address", "");
        final String data = call.getString("data", "");
        if (address.isEmpty() || data.isEmpty()) {
            call.reject("ข้อมูลเครื่องพิมพ์หรือใบเสร็จไม่ครบ");
            return;
        }
        // การเชื่อมต่อและส่งข้อมูลใช้เวลา จึงทำในเธรดแยก (ไม่บล็อกหน้าจอ)
        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null || !adapter.isEnabled()) {
                    call.reject("กรุณาเปิด Bluetooth ก่อน");
                    return;
                }
                BluetoothDevice device = adapter.getRemoteDevice(address);
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                OutputStream out = socket.getOutputStream();
                final int chunk = 512;
                for (int i = 0; i < bytes.length; i += chunk) {
                    int n = Math.min(chunk, bytes.length - i);
                    out.write(bytes, i, n);
                    out.flush();
                    Thread.sleep(15);
                }
                Thread.sleep(500);
                call.resolve();
            } catch (Exception e) {
                call.reject("พิมพ์ไม่สำเร็จ: " + e.getMessage());
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (Exception ignored) {
                    }
                }
            }
        }).start();
    }
}
