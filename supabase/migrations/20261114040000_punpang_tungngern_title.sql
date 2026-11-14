-- เก็บหัวข้อแจ้งเตือน (title) ในบันทึกรับข้อความ เช่น "เงินเข้า 1 บาท" เพื่อตรวจสอบย้อนหลัง
-- ต้องรันหลัง 20261114030000_punpang_tungngern_switch.sql

alter table public.manee_inbox add column if not exists title text not null default '';
