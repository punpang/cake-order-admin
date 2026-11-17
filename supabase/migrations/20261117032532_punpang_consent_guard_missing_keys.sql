-- บัค #9: พนักงานที่ไม่ใช่ผู้จัดการบันทึกลูกค้าเก่า (ที่ไม่มีคีย์ promoOptIn/promoConsentAt) ไม่ได้
--   เดิมเทียบ "ไม่มีคีย์" (NULL) กับ false ว่าเปลี่ยนค่า → ฟอร์มส่ง promoOptIn = false ทุกครั้ง จึงถูกบล็อก
-- แก้: ถือว่า "ไม่มีคีย์" = ค่าเริ่มต้น (promoOptIn = false, promoConsentAt = null) และ JSON null เท่ากับไม่มีคีย์
--   · การเปลี่ยนความยินยอมจริง (เปิด/ปิด/เปลี่ยนเวลา) ยังเป็นของผู้จัดการเท่านั้นตาม M-3
--   · การเพิ่มลูกค้าใหม่ที่ตั้งว่ายินยอมยังถูกบล็อก · แต้ม/สมุดยังกันเหมือนเดิม · ผู้จัดการ/บริการเซิร์ฟเวอร์ไม่ถูกตรวจ

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

  -- ไม่มีคีย์ หรือเป็น JSON null → ถือเป็นค่าเริ่มต้น (promoOptIn = false, promoConsentAt = null)
  new_promo := coalesce(nullif(new.data->'promoOptIn', 'null'::jsonb), 'false'::jsonb);
  new_consent := coalesce(nullif(new.data->'promoConsentAt', 'null'::jsonb), 'null'::jsonb);
  if tg_op = 'INSERT' then
    if new_promo = 'true'::jsonb or new_consent <> 'null'::jsonb then
      raise exception 'promotion consent can only be set by a manager' using errcode = '42501';
    end if;
  else
    old_promo := coalesce(nullif(old.data->'promoOptIn', 'null'::jsonb), 'false'::jsonb);
    old_consent := coalesce(nullif(old.data->'promoConsentAt', 'null'::jsonb), 'null'::jsonb);
    if new_promo is distinct from old_promo or new_consent is distinct from old_consent then
      raise exception 'promotion consent can only be changed by a manager' using errcode = '42501';
    end if;
  end if;
  return new;
end
$function$;
