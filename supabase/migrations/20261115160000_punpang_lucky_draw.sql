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

-- ลุ้นโชค (สมาชิก): ลุ้นทีละครั้งแบบอะตอมิก · เรียกด้วย service role จาก Edge Function lucky-spin หลังตรวจเซสชันสมาชิกแล้ว
-- รางวัลวนตามลำดับที่ร้านตั้ง ไม่จำกัดจำนวน: ทุกการลุ้นในช่วงเปิดลุ้น (ชุด) นับเป็นตำแหน่งถัดไป · ลุ้นได้จนหมดเวลาหรือร้านปิดกิจกรรม
-- ผลแต่ละแบบ: ส่วนลดบาท/ของรางวัล = คูปองในบัญชีสมาชิก (อายุตาม couponDays) · คะแนนสะสม = เพิ่มก้อนในสมุดคะแนน (อายุตามอายุคะแนนของร้าน) · ไม่ได้รางวัล = ไม่ให้อะไร · advisory lock ทำให้การลุ้นพร้อมกันเรียงตำแหน่งถูกต้อง
create or replace function public.punpang_lucky_spin(p_token_hash text, p_customer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cu record; rec record; d jsonb; cfg jsonb; loy jsonb; prizes jsonb; spins jsonb; draws integer;
  from_ts timestamptz; to_ts timestamptz; turns bigint := 0; chosen jsonb; prize_snap jsonb := null;
  coupon_ jsonb := null; cp_id text := null; new_spin jsonb; nowz text; ledger jsonb; pts integer := 0;
  today_ text := public.punpang__pts_today();
begin
  perform pg_advisory_xact_lock(hashtext('punpang_lucky_spin'));
  nowz := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  select * into cu from public.punpang_customers where id = p_customer for update;
  if not found or coalesce((cu.data->>'deleted')::boolean, false) then
    return jsonb_build_object('error', 'no_customer');
  end if;

  select id, data into rec from public.punpang_records
   where collection = 'luckyTokens' and data->>'tokenHash' = p_token_hash for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  d := rec.data;
  if now() > (d->>'expiresAt')::timestamptz then return jsonb_build_object('error', 'expired'); end if;

  select data->'v'->'luckyDraw' into cfg from public.punpang_kv where collection = 'config' and id = 'shop';
  if cfg is null then return jsonb_build_object('error', 'config_missing'); end if;
  if not coalesce((cfg->>'enabled')::boolean, false) or coalesce(cfg->>'from', '') = '' or coalesce(cfg->>'to', '') = '' then
    return jsonb_build_object('error', 'closed');
  end if;
  from_ts := (cfg->>'from')::timestamptz;
  to_ts := (cfg->>'to')::timestamptz;
  if now() < from_ts or now() > to_ts then return jsonb_build_object('error', 'closed'); end if;

  spins := coalesce(d->'spins', '[]'::jsonb);
  draws := coalesce((d->>'draws')::integer, 0);
  if jsonb_array_length(spins) >= draws then return jsonb_build_object('error', 'done'); end if;
  prizes := coalesce(cfg->'prizes', '[]'::jsonb);
  select data->'v' into loy from public.punpang_kv where collection = 'config' and id = 'loyalty';

  -- ทุกการลุ้นในช่วงเปิดลุ้นนี้ (ทุกบิล รวมที่ไม่ได้รางวัล) นับเป็นตำแหน่งถัดไปของการวน
  select count(*) into turns
    from public.punpang_records r
    cross join lateral jsonb_array_elements(coalesce(r.data->'spins', '[]'::jsonb)) s
   where r.collection = 'luckyTokens'
     and (r.data->>'expiresAt')::timestamptz >= from_ts
     and jsonb_typeof(s->'prize') = 'object'
     and (s->>'at')::timestamptz between from_ts and to_ts;

  -- รางวัลที่ออก = วนตามรายการที่ร้านตั้ง (รายการแรก → รายการสุดท้าย แล้ววนกลับไปรายการแรก)
  if jsonb_array_length(prizes) > 0 then
    chosen := prizes -> ((turns % jsonb_array_length(prizes))::integer);
  end if;

  if chosen is not null then
    pts := case when chosen->>'kind' = 'points' then coalesce((chosen->>'points')::integer, 0) else 0 end;
    prize_snap := jsonb_build_object('id', chosen->>'id', 'name', chosen->>'name', 'kind', chosen->>'kind',
                                     'amount', coalesce((chosen->>'amount')::numeric, 0), 'points', pts);
    if chosen->>'kind' = 'discount' then
      cp_id := public.punpang__cust_new_coupon(p_customer,
        jsonb_build_object('type', 'discount', 'amount', coalesce((chosen->>'amount')::numeric, 0), 'name', chosen->>'name', 'source', 'lucky'),
        jsonb_build_object('couponExpireDays', coalesce((cfg->>'couponDays')::integer, 30)), today_);
    elsif chosen->>'kind' = 'reward' then
      cp_id := public.punpang__cust_new_coupon(p_customer,
        jsonb_build_object('type', 'reward', 'name', chosen->>'name', 'source', 'lucky'),
        jsonb_build_object('couponExpireDays', coalesce((cfg->>'couponDays')::integer, 30)), today_);
    elsif chosen->>'kind' = 'points' and pts > 0 then
      -- คะแนนสะสม: เพิ่มก้อนในสมุดคะแนนของสมาชิก อายุตามอายุคะแนนของร้าน (ไม่ตัดคะแนนอื่น)
      ledger := coalesce(cu.data->'ledger', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', public.punpang__pts_newid(), 'at', nowz, 'delta', pts, 'reason', 'ลุ้นโชค: ' || (chosen->>'name'), 'orderId', null,
        'expiresAt', to_char(today_::date + coalesce((loy->>'pointExpireDays')::integer, 365), 'YYYY-MM-DD'), 'remaining', pts));
      update public.punpang_customers set data = jsonb_set(cu.data, '{ledger}', ledger), updated_at = now() where id = p_customer;
    end if;
    -- ไม่ได้รางวัล (none): ไม่ให้คูปองหรือคะแนน แต่ยังนับเป็นตำแหน่งในการวนแล้ว
    if cp_id is not null then
      select jsonb_build_object('id', r.id) || r.data into coupon_ from public.punpang_records r where r.collection = 'coupons' and r.id = cp_id;
    end if;
  end if;

  new_spin := jsonb_build_object('at', nowz, 'customerId', p_customer, 'prize', prize_snap,
                                 'couponId', cp_id, 'couponExpiresAt', coupon_->>'expiresAt');
  update public.punpang_records
     set data = d || jsonb_build_object('spins', spins || jsonb_build_array(new_spin), 'spinCount', jsonb_array_length(spins) + 1)
   where id = rec.id;
  return jsonb_build_object('ok', true, 'spin', new_spin, 'coupon', coupon_,
                            'draws', draws, 'remaining', draws - jsonb_array_length(spins) - 1);
end $$;

revoke all on function public.punpang_lucky_spin(text, text) from public, anon, authenticated;
grant execute on function public.punpang_lucky_spin(text, text) to service_role;
