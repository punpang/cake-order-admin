-- ลุ้นโชคท้ายบิล: หลายโครงการพร้อมกัน
-- แต่ละโครงการมีเงื่อนไขเดียว (ซื้อสินค้าที่เลือก = 1 ครั้งต่อบิล · ซื้อครบทุก X บาท = ทุก X บาทได้ 1 ครั้ง) ช่วงวันเช็กจากวันที่ซื้อบิล
-- รางวัลวนตามลำดับของโครงการนั้น · อายุคูปองของโครงการนั้น · บิลหนึ่งได้ลุ้นแยกทุกโครงการที่เข้าเงื่อนไข
-- 1) ตั้งค่าชุดเดิม (มี perBaht ที่ config/shop.luckyDraw) → โครงการแรก id 'legacy' เป็นแบบซื้อสินค้าที่เลือก
-- 2) บิลเดิม (draws เป็นตัวเลข) → draws เป็นรายโครงการ { legacy: n } และการลุ้นเดิมระบุโครงการ legacy
-- 3) RPC punpang_lucky_spin รับรหัสโครงการ (p_project) · นับตำแหน่งการวนแยกตามโครงการ · จำกัดการลุ้นตามจำนวนของบิลในโครงการนั้น

-- 1) ตั้งค่า: ย้ายชุดเดิมเป็นโครงการแรก (ทำเฉพาะแถวที่ยังเป็นรูปแบบเดิม)
-- 1a) ชุดเดิมที่มีการตั้งค่าจริง (เปิดอยู่ หรือมีรางวัล/สินค้า) → โครงการแรก id legacy
update public.punpang_kv
   set data = jsonb_set(data, '{v,luckyDraw}', jsonb_build_object(
         'siteUrl', coalesce(data->'v'->'luckyDraw'->>'siteUrl', ''),
         'projects', jsonb_build_array(jsonb_build_object(
           'id', 'legacy',
           'name', 'ลุ้นโชคท้ายบิล',
           'enabled', coalesce((data->'v'->'luckyDraw'->>'enabled')::boolean, false),
           'kind', 'items',
           'itemIds', coalesce(data->'v'->'luckyDraw'->'itemIds', '[]'::jsonb),
           'everyBaht', null,
           'from', coalesce(data->'v'->'luckyDraw'->>'from', ''),
           'to', coalesce(data->'v'->'luckyDraw'->>'to', ''),
           'couponDays', coalesce((data->'v'->'luckyDraw'->>'couponDays')::integer, 30),
           'prizes', coalesce(data->'v'->'luckyDraw'->'prizes', '[]'::jsonb)))))
 where collection = 'config' and id = 'shop' and (data->'v'->'luckyDraw'->>'perBaht') is not null
   and (coalesce((data->'v'->'luckyDraw'->>'enabled')::boolean, false)
        or (case when jsonb_typeof(data->'v'->'luckyDraw'->'prizes') = 'array' then jsonb_array_length(data->'v'->'luckyDraw'->'prizes') else 0 end) > 0
        or (case when jsonb_typeof(data->'v'->'luckyDraw'->'itemIds') = 'array' then jsonb_array_length(data->'v'->'luckyDraw'->'itemIds') else 0 end) > 0);
-- 1b) ชุดเดิมที่ยังไม่เคยตั้งค่า (ค่าเริ่มต้น) → ไม่มีโครงการ (เอาคีย์เดิมออก)
update public.punpang_kv
   set data = jsonb_set(data, '{v,luckyDraw}', jsonb_build_object(
         'siteUrl', coalesce(data->'v'->'luckyDraw'->>'siteUrl', ''),
         'projects', '[]'::jsonb))
 where collection = 'config' and id = 'shop' and (data->'v'->'luckyDraw'->>'perBaht') is not null;

-- 2) บิลเดิม: จำนวนลุ้นเป็นรายโครงการ และการลุ้นเดิมเป็นของโครงการ legacy
update public.punpang_records r
   set data = jsonb_set(
         jsonb_set(r.data, '{draws}', jsonb_build_object('legacy', (r.data->>'draws')::integer)),
         '{spins}',
         coalesce((select jsonb_agg(s || jsonb_build_object('projectId', 'legacy'))
                     from jsonb_array_elements(coalesce(r.data->'spins', '[]'::jsonb)) s), '[]'::jsonb))
 where r.collection = 'luckyTokens' and jsonb_typeof(r.data->'draws') = 'number';

-- 3) RPC: เปลี่ยนลายเซ็น (เพิ่ม p_project) จึงลบของเดิมแล้วสร้างใหม่
-- ลุ้นได้จนถึงเวลาสิ้นสุดของโครงการ และโครงการต้องเปิดอยู่ · รางวัลวนตามรายการของโครงการ (ทุกการลุ้นของโครงการนั้นนับเป็นตำแหน่งถัดไป รวมที่ไม่ได้รางวัล)
-- ผลแต่ละแบบ: ส่วนลดบาท/ของรางวัล = คูปองในบัญชีสมาชิก (อายุตาม couponDays ของโครงการ) · คะแนนสะสม = เพิ่มก้อนในสมุดคะแนน (อายุตามอายุคะแนนของร้าน) · ไม่ได้รางวัล = ไม่ให้อะไร
-- advisory lock ทำให้การลุ้นพร้อมกันเรียงตำแหน่งถูกต้อง
drop function if exists public.punpang_lucky_spin(text, text);

create or replace function public.punpang_lucky_spin(p_token_hash text, p_customer text, p_project text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cu record; rec record; d jsonb; cfg jsonb; loy jsonb; proj jsonb; prizes jsonb; spins jsonb;
  draws integer; used integer; to_ts timestamptz; turns bigint := 0; chosen jsonb; prize_snap jsonb := null;
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
  select e into proj from jsonb_array_elements(coalesce(cfg->'projects', '[]'::jsonb)) e where e->>'id' = p_project limit 1;
  if proj is null then return jsonb_build_object('error', 'no_project'); end if;
  if not coalesce((proj->>'enabled')::boolean, false) or coalesce(proj->>'to', '') = '' then
    return jsonb_build_object('error', 'closed');
  end if;
  to_ts := (proj->>'to')::timestamptz;
  if now() > to_ts then return jsonb_build_object('error', 'closed'); end if;

  draws := coalesce((d->'draws'->>p_project)::integer, 0);
  if draws < 1 then return jsonb_build_object('error', 'no_draw'); end if;
  spins := coalesce(d->'spins', '[]'::jsonb);
  select count(*) into used from jsonb_array_elements(spins) s where s->>'projectId' = p_project;
  if used >= draws then return jsonb_build_object('error', 'done'); end if;
  prizes := coalesce(proj->'prizes', '[]'::jsonb);
  select data->'v' into loy from public.punpang_kv where collection = 'config' and id = 'loyalty';

  -- ทุกการลุ้นของโครงการนี้ (ทุกบิล รวมที่ไม่ได้รางวัล) นับเป็นตำแหน่งถัดไปของการวนของโครงการนั้น
  select count(*) into turns
    from public.punpang_records r
    cross join lateral jsonb_array_elements(coalesce(r.data->'spins', '[]'::jsonb)) s
   where r.collection = 'luckyTokens' and s->>'projectId' = p_project and jsonb_typeof(s->'prize') = 'object';

  -- รางวัลที่ออก = วนตามรายการของโครงการ (รายการแรก → รายการสุดท้าย แล้ววนกลับไปรายการแรก)
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
        jsonb_build_object('couponExpireDays', coalesce((proj->>'couponDays')::integer, 30)), today_);
    elsif chosen->>'kind' = 'reward' then
      cp_id := public.punpang__cust_new_coupon(p_customer,
        jsonb_build_object('type', 'reward', 'name', chosen->>'name', 'source', 'lucky'),
        jsonb_build_object('couponExpireDays', coalesce((proj->>'couponDays')::integer, 30)), today_);
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

  new_spin := jsonb_build_object('at', nowz, 'projectId', p_project, 'customerId', p_customer, 'prize', prize_snap,
                                 'couponId', cp_id, 'couponExpiresAt', coupon_->>'expiresAt');
  update public.punpang_records
     set data = d || jsonb_build_object('spins', spins || jsonb_build_array(new_spin), 'spinCount', jsonb_array_length(spins) + 1)
   where id = rec.id;
  return jsonb_build_object('ok', true, 'spin', new_spin, 'coupon', coupon_,
                            'draws', draws, 'remaining', draws - used - 1);
end $$;

revoke all on function public.punpang_lucky_spin(text, text, text) from public, anon, authenticated;
grant execute on function public.punpang_lucky_spin(text, text, text) to service_role;
