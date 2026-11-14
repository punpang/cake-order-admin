-- เปลี่ยนแหล่งรับยอดจากแม่มณีเป็นถุงเงิน: จับคู่ด้วยรหัสธุรกรรม (ORD/POS) ในแจ้งเตือน แทนการจับคู่ด้วยยอด+เวลา
-- แจ้งเตือนถุงเงินไม่มียอดเงิน จึงให้ amount เป็นค่าว่างได้ (แถวเก่าที่มียอดยังอยู่เหมือนเดิม)
-- ยังไม่มีผลจนกว่าจะรันใน SQL Editor · และ deploy manee-receiver กับ manee-list ให้เป็นเวอร์ชันใหม่

alter table public.tungngern_transfers add column if not exists ref text not null default '';
alter table public.tungngern_transfers alter column amount drop not null;
create index if not exists tungngern_transfers_ref_idx on public.tungngern_transfers (ref);

-- รายชื่อแอปที่รับ: เพิ่มถุงเงิน และเอาแม่มณีออก
insert into public.tungngern_app_names (name) values ('ถุงเงิน') on conflict do nothing;
delete from public.tungngern_app_names where name = 'แม่มณี';
