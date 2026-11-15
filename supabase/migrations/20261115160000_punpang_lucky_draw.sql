-- ลุ้นโชคท้ายบิล (QR ท้ายใบเสร็จ → หน้าลุ้นโชคของบิลนั้น)
-- 1) collection ใหม่ luckyTokens: 1 แถวต่อบิลที่ออก QR · เก็บเฉพาะ hash ของ token (ไม่เก็บ token เต็ม)
-- 2) สิทธิ์: พนักงานที่มีสิทธิ์ POS อ่าน/เขียนได้ (ออกรหัสตอนขาย · รับรางวัลที่ร้าน) · การลุ้น (สุ่ม/ตัดสิทธิ์ครั้งเดียว) ทำที่ Edge Function lucky-spin ด้วย service role
-- ค่าเดิมของ collection ครบ 18 ตัวยังอยู่ จึงไม่กระทบข้อมูลที่มีอยู่

alter table public.punpang_records drop constraint if exists punpang_records_collection_check;
alter table public.punpang_records add constraint punpang_records_collection_check check (collection = any (array['reviews','coupons','spinLog','photoRequests','deletionRequests','birthdayGreeted','notifySent','shortLinks','outbox','bell','orderLinks','consents','chatDrafts','aiLog','retentionLog','slipRead','slipTrain','fileDeletions','luckyTokens']::text[]));

create or replace function public.punpang_rec_can(c text, w boolean)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.punpang_staff s
    where s.user_id = (select auth.uid()) and s.active and (
      s.perms && array['manage']
      or case c
        when 'reviews'          then (not w and s.perms && array['viewAllOrders'])
        when 'coupons'          then s.perms && array['useLoyalty','adjustPoints']
        when 'spinLog'          then s.perms && array['useLoyalty','adjustPoints']
        when 'birthdayGreeted'  then s.perms && array['birthdays']
        when 'notifySent'       then true
        when 'bell'             then true
        when 'outbox'           then (w or s.perms && array['chat','viewAllOrders'])
        when 'consents'         then s.perms && array['viewAllOrders','createOrder']
        when 'orderLinks'       then s.perms && array['createOrder','viewAllOrders','sendToPayment']
        when 'chatDrafts'       then s.perms && array['chat']
        when 'luckyTokens'      then s.perms && array['pos']
        else false end));
$function$;
