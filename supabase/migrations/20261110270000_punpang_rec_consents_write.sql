-- ความยินยอม (consents): เขียนได้เฉพาะพนักงานที่มีสิทธิ์ดูออร์เดอร์ทั้งหมด หรือสร้างออร์เดอร์ (ตรงกับการอ่านในแอป)
-- เดิมพนักงาน active ทุกคนเขียนได้ (เงื่อนไข w or ...) · outbox/bell/notifySent คงเดิมเพราะทุกบทบาทต้องแจ้งเตือนได้
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
        else false end));
$function$;
