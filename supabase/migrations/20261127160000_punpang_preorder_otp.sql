-- สั่งล่วงหน้า เฟส 2C: purpose preorder ของ OTP + บันทึกการขอ OTP แบบเพิ่มได้อย่างเดียว + เพดานการขอ
-- เพดาน (ค่าคงที่ในฟังก์ชันนี้เท่านั้น): 5 ครั้ง/ชม. ต่อเบอร์ · 10 ครั้ง/วันต่อเบอร์ · 20 ครั้ง/ชม. ต่อ IP · 300 ครั้ง/วันรวม (นับแบบเลื่อนย้อนหลัง)
-- ตรวจและบันทึกในธุรกรรมเดียว ล็อกด้วย advisory lock เพื่อไม่ให้คำขอพร้อมกันหลุดเพดาน
-- log ไม่มีสิทธิ์ลบ/แก้ไขให้บทบาทใดเลย (รวม service_role) · ฟังก์ชันรันด้วยสิทธิ์เจ้าของ

alter table public.punpang_otps drop constraint if exists punpang_otps_purpose_check;
alter table public.punpang_otps add constraint punpang_otps_purpose_check
  check (purpose in ('register','reset','change_pin','change_phone','delete','preorder'));

create table if not exists public.punpang_otp_log (
  id bigserial primary key,
  phone_hash text not null,
  ip_hash text not null,
  purpose text not null,
  created_at timestamptz not null default now()
);
create index if not exists punpang_otp_log_phone_idx on public.punpang_otp_log (phone_hash, created_at);
create index if not exists punpang_otp_log_ip_idx on public.punpang_otp_log (ip_hash, created_at);
create index if not exists punpang_otp_log_created_idx on public.punpang_otp_log (created_at);

alter table public.punpang_otp_log enable row level security;
revoke all on public.punpang_otp_log from public, anon, authenticated, service_role;

create or replace function public.punpang_preorder_otp_allowed(p_phone_hash text, p_ip_hash text, p_purpose text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n_phone_h int; n_phone_d int; n_ip_h int; n_all_d int;
begin
  if p_purpose is distinct from 'preorder' then return false; end if;
  perform pg_advisory_xact_lock(hashtext('punpang_preorder_otp'));
  select count(*) into n_phone_h from public.punpang_otp_log where phone_hash = p_phone_hash and created_at > now() - interval '1 hour';
  select count(*) into n_phone_d from public.punpang_otp_log where phone_hash = p_phone_hash and created_at > now() - interval '1 day';
  select count(*) into n_ip_h from public.punpang_otp_log where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  select count(*) into n_all_d from public.punpang_otp_log where created_at > now() - interval '1 day';
  if n_phone_h >= 5 or n_phone_d >= 10 or n_ip_h >= 20 or n_all_d >= 300 then return false; end if;
  insert into public.punpang_otp_log (phone_hash, ip_hash, purpose) values (p_phone_hash, p_ip_hash, p_purpose);
  return true;
end $$;

revoke all on function public.punpang_preorder_otp_allowed(text, text, text) from public, anon, authenticated;
grant execute on function public.punpang_preorder_otp_allowed(text, text, text) to service_role;

-- โหมดทดสอบ: ตาราง log เป็น iso (มีสำเนาข้อมูลทดสอบ) และซิงก์นิยามใหม่
do $$
declare d text; n text; pat text := '''punpang_preorder_orders''];';
begin
  d := pg_get_functiondef('punpang_test.punpang_test_sync()'::regprocedure);
  if position('''punpang_otp_log''' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then
    raise exception 'ไม่พบรายการ iso ที่คาดไว้ใน punpang_test_sync (ตรวจ migration โหมดทดสอบ)';
  end if;
  n := replace(d, pat, '''punpang_preorder_orders'', ''punpang_otp_log''];');
  execute n;
end $$;
select punpang_test.punpang_test_sync();
