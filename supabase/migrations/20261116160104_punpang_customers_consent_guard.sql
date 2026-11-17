-- ความยินยอมรับข่าวสารของลูกค้า (M-3): เปลี่ยน promoOptIn / promoConsentAt ได้เฉพาะผู้จัดการ (manage)
-- · เพิ่มลูกค้าใหม่ได้เมื่อไม่ยินยอม (ค่าเริ่มต้น) แต่ตั้งว่ายินยอม/ตั้งเวลายินยอมไม่ได้
-- · ลูกค้าที่ยินยอม/ถอนเองผ่านบัญชีเว็บ เขียนผ่านเซิร์ฟเวอร์ (service role) จึงไม่ถูกตรวจนี้
-- · ยังคงกันแต้มสะสม (ledger / spins) เหมือนเดิม
-- ทดสอบแล้วในธุรกรรมที่ย้อนกลับ (ตารางชั่วคราว): เพิ่มด้วยไม่ยินยอม ผ่าน · เพิ่มด้วยยินยอม ถูกบล็อก · แก้ชื่อ ผ่าน · เปลี่ยน promoOptIn/promoConsentAt ถูกบล็อก · แก้ ledger ถูกบล็อก

create or replace function public.punpang_customers_guard()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
declare
  old_ledger jsonb;
  new_ledger jsonb;
  old_spins numeric;
  new_spins numeric;
  old_promo jsonb;
  new_promo jsonb;
  old_consent jsonb;
  new_consent jsonb;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.punpang_has_perm('manage') then return new; end if;

  new_ledger := case when jsonb_typeof(new.data->'ledger') = 'array' then new.data->'ledger' else '[]'::jsonb end;
  new_spins := case when jsonb_typeof(new.data->'spins') = 'number' then (new.data->>'spins')::numeric else 0 end;
  if tg_op = 'INSERT' then
    old_ledger := '[]'::jsonb;
    old_spins := 0;
  else
    old_ledger := case when jsonb_typeof(old.data->'ledger') = 'array' then old.data->'ledger' else '[]'::jsonb end;
    old_spins := case when jsonb_typeof(old.data->'spins') = 'number' then (old.data->>'spins')::numeric else 0 end;
  end if;
  if new_ledger is distinct from old_ledger or new_spins is distinct from old_spins then
    raise exception 'points ledger and spins can only change through the loyalty RPCs' using errcode = '42501';
  end if;

  new_promo := new.data->'promoOptIn';
  new_consent := new.data->'promoConsentAt';
  if tg_op = 'INSERT' then
    if new_promo = 'true'::jsonb or (new_consent is not null and new_consent <> 'null'::jsonb) then
      raise exception 'promotion consent can only be set by a manager' using errcode = '42501';
    end if;
  else
    old_promo := old.data->'promoOptIn';
    old_consent := old.data->'promoConsentAt';
    if new_promo is distinct from old_promo or new_consent is distinct from old_consent then
      raise exception 'promotion consent can only be changed by a manager' using errcode = '42501';
    end if;
  end if;
  return new;
end
$function$;
