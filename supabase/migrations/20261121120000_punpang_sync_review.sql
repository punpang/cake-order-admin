-- คิวรอตรวจของผู้จัดการ: ออร์เดอร์ที่มีการเงิน (ชำระ/คืน/แต้ม/คูปอง) และถูกฐานข้อมูลปฏิเสธถาวร เก็บที่นี่ก่อนเอาออกจากเครื่องพนักงาน
-- พนักงานขาย (pos/createOrder) เพิ่มรายการได้เท่านั้น · ผู้จัดการ (manage) อ่านได้จากทุกเครื่อง และแก้ได้เฉพาะ edited_payload กับสถานะ
-- ต้นฉบับ (payload) แก้ไม่ได้ · รายการที่ปิดหรือส่งซ้ำแล้วแก้ไม่ได้ทุกช่อง · ผู้ปิดและเวลาบันทึกโดยฐานข้อมูล (ตรวจด้วย trigger)

create table if not exists public.punpang_sync_review (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  order_code text not null default '',
  channel text,
  reason_code text not null default '',
  reason_message text not null default '',
  payload jsonb not null,
  edited_payload jsonb,
  status text not null default 'open' check (status in ('open', 'resent', 'closed')),
  created_by text default (auth.uid())::text,
  created_at timestamptz not null default now(),
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text not null default '',
  constraint punpang_sync_review_resolved_chk check (status = 'open' or (resolved_at is not null and (status = 'resent' or length(btrim(resolution_note)) > 0)))
);
create unique index if not exists punpang_sync_review_open_uniq on public.punpang_sync_review (order_id) where status = 'open';
create index if not exists punpang_sync_review_status_idx on public.punpang_sync_review (status, created_at);

alter table public.punpang_sync_review enable row level security;
revoke all on public.punpang_sync_review from public, anon, authenticated;
grant select, insert, update on public.punpang_sync_review to authenticated;

drop policy if exists sync_review_insert on public.punpang_sync_review;
create policy sync_review_insert on public.punpang_sync_review for insert to authenticated
  with check (status = 'open' and created_by = (select auth.uid())::text and (public.punpang_has_perm('pos') or public.punpang_has_perm('createOrder')));
drop policy if exists sync_review_read on public.punpang_sync_review;
create policy sync_review_read on public.punpang_sync_review for select to authenticated
  using (public.punpang_has_perm('manage'));
drop policy if exists sync_review_update on public.punpang_sync_review;
create policy sync_review_update on public.punpang_sync_review for update to authenticated
  using (public.punpang_has_perm('manage')) with check (public.punpang_has_perm('manage'));

create or replace function public.punpang_sync_review_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- รายการที่ปิดหรือส่งซ้ำแล้ว แก้ไขไม่ได้ทุกช่อง
  if old.status <> 'open' then
    if new is distinct from old then
      raise exception 'punpang_sync_review: รายการนี้ปิดหรือส่งซ้ำแล้ว แก้ไขไม่ได้' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.order_id is distinct from old.order_id or new.order_code is distinct from old.order_code
     or new.channel is distinct from old.channel or new.payload is distinct from old.payload
     or new.reason_code is distinct from old.reason_code or new.reason_message is distinct from old.reason_message
     or new.created_at is distinct from old.created_at or new.created_by is distinct from old.created_by then
    raise exception 'punpang_sync_review: ต้นฉบับของรายการรอตรวจแก้ไม่ได้' using errcode = '42501';
  end if;
  if new.status = 'open' then
    -- ยังไม่ปิด: ช่องการปิดต้องว่าง
    new.resolved_by := null;
    new.resolved_at := null;
    new.resolution_note := '';
  else
    -- ปิดหรือส่งซ้ำ: ผู้ทำและเวลาบันทึกโดยฐานข้อมูล (ไม่รับค่าจากไคลเอนต์)
    new.resolved_by := (select auth.uid())::text;
    new.resolved_at := now();
  end if;
  return new;
end $$;
revoke all on function public.punpang_sync_review_guard() from public, anon, authenticated;
drop trigger if exists punpang_sync_review_guard on public.punpang_sync_review;
create trigger punpang_sync_review_guard before update on public.punpang_sync_review
  for each row execute function public.punpang_sync_review_guard();

-- โหมดทดสอบ: จัดประเภทตารางรอตรวจเป็นตารางธุรกิจ (แยกสำเนา) โดยเพิ่มชื่อในรายการ iso ของฟังก์ชันปัจจุบัน
-- (ไม่คัดลอกฟังก์ชันทั้งชุด: migration อื่นแก้ฟังก์ชันนี้ภายหลังแล้ว เช่น ตารางข้อมูลร่วม punpang_error_log)
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('punpang_test.punpang_test_sync()'::regprocedure);
  if position('''punpang_sync_review''' in d) > 0 then return; end if;
  n := replace(d, '''punpang_cake_clicks''];', '''punpang_cake_clicks'', ''punpang_sync_review''];');
  if n = d then raise exception 'sync review: หารายการตารางธุรกิจใน punpang_test_sync ไม่เจอ'; end if;
  execute n;
end $$;

select punpang_test.punpang_test_sync();
