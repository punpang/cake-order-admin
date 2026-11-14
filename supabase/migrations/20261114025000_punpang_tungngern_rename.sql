-- เปลี่ยนชื่อตารางจาก manee_* เป็น tungngern_* (ข้อมูลและสิทธิ์ RLS ติดไปกับตารางเดิม)
-- ต้องรันก่อน 20261114030000_punpang_tungngern_switch.sql และ 20261114040000_punpang_tungngern_title.sql

alter table public.manee_transfers rename to tungngern_transfers;
alter table public.manee_inbox rename to tungngern_inbox;
alter table public.manee_app_names rename to tungngern_app_names;
alter index if exists public.manee_transfers_received_idx rename to tungngern_transfers_received_idx;
alter index if exists public.manee_inbox_app_idx rename to tungngern_inbox_app_idx;
