-- สินค้าฝากขาย (รอบสรุปยอด): collection ใหม่ consignRounds ใน punpang_records
-- 1) เพิ่มชื่อใน allow-list ของ collection (รายการเดิมคงอยู่ครบ)
-- 2) สิทธิ์: อ่านได้ผู้มี viewAllOrders · เขียน (สรุป/จ่าย) เฉพาะผู้จัดการ (manage ผ่านด่านบนสุดของฟังก์ชัน)
-- 3) คัดลอกฟังก์ชันที่แก้แล้วไปยังโหมดทดสอบ

alter table public.punpang_records drop constraint if exists punpang_records_collection_check;
alter table public.punpang_records add constraint punpang_records_collection_check
  check (collection = any (array['reviews','coupons','spinLog','photoRequests','deletionRequests','birthdayGreeted','notifySent','shortLinks','outbox','bell','orderLinks','consents','chatDrafts','aiLog','retentionLog','slipRead','slipTrain','fileDeletions','luckyTokens','testRecipients','consignRounds']::text[]));

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
        when 'consignRounds'    then (not w and s.perms && array['viewAllOrders'])
        else false end));
$function$;


select punpang_test.punpang_test_sync();
