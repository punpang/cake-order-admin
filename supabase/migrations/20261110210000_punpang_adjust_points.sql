-- แอดมินปรับแต้ม (+เพิ่ม / −ลด) แบบอะตอมิกบนสมุดแต้มเดิม (punpang_customers.data.ledger)
-- เพิ่ม = สร้างก้อนใหม่ (หมดอายุตามตั้งค่าร้าน) · ลด = ตรวจยอดภายใต้ล็อกแล้วตัดจากก้อนที่ใกล้หมดอายุก่อน · ต้องมีสิทธิ์ adjustPoints และระบุเหตุผล
create or replace function public.punpang_adjust_points(p_customer text, p_delta integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  role_ text := public.punpang__pts_staff();
  c record; ledger jsonb; new_ledger jsonb; takes jsonb; nmap jsonb; bal integer; n integer := abs(coalesce(p_delta, 0));
  why text := left(btrim(coalesce(p_reason, '')), 120);
  today_ text := public.punpang__pts_today();
  eid text := public.punpang__pts_newid();
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  label text;
  exp_at text;
begin
  if role_ is null or not public.punpang_has_perm('adjustPoints') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_delta is null or p_delta = 0 or n > 1000000 then return jsonb_build_object('error', 'invalid'); end if;
  if why = '' then return jsonb_build_object('error', 'no_reason'); end if;
  select * into c from public.punpang_customers where id = p_customer for update;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then return jsonb_build_object('error', 'no_customer'); end if;
  ledger := coalesce(c.data->'ledger', '[]'::jsonb);
  label := case when p_delta > 0 then 'เพิ่ม' else 'ลด' end || 'คะแนนโดยแอดมิน: ' || why;

  if p_delta > 0 then
    exp_at := to_char(((now() at time zone 'Asia/Bangkok')::date + (public.punpang__pts_cfg('pointExpireDays', 365))::int), 'YYYY-MM-DD');
    new_ledger := ledger || jsonb_build_array(jsonb_build_object(
      'id', eid, 'at', nowz, 'delta', n, 'reason', label, 'orderId', null, 'expiresAt', exp_at, 'remaining', n, 'adjust', true, 'by', role_));
  else
    with lots as (
      select ord::int as ord, e->>'id' as id, (e->>'remaining')::int as rem, coalesce(e->>'expiresAt', '9999') as exp
        from jsonb_array_elements(ledger) with ordinality as t(e, ord)
       where (e->>'delta')::int > 0 and coalesce((e->>'remaining')::int, 0) > 0 and (e->>'expiresAt' is null or e->>'expiresAt' >= today_)
    ), cum as (
      select ord, id, rem, coalesce(sum(rem) over (order by exp, ord rows between unbounded preceding and 1 preceding), 0) as before from lots
    ), tk as (
      select ord, id, least(rem, greatest(n - before, 0)) as k from cum
    )
    select coalesce((select sum(rem) from lots), 0),
           (select jsonb_agg(jsonb_build_object('lotId', id, 'n', k) order by ord) from tk where k > 0),
           (select jsonb_object_agg(ord::text, k) from tk where k > 0)
      into bal, takes, nmap;
    if bal < n then return jsonb_build_object('error', 'insufficient', 'balance', bal); end if;
    select coalesce(jsonb_agg(case when nmap ? (ord::text)
                                   then jsonb_set(e, '{remaining}', to_jsonb((e->>'remaining')::int - (nmap->>(ord::text))::int))
                                   else e end order by ord), '[]'::jsonb)
      into new_ledger from jsonb_array_elements(ledger) with ordinality as t(e, ord);
    new_ledger := new_ledger || jsonb_build_array(jsonb_build_object(
      'id', eid, 'at', nowz, 'delta', -n, 'reason', label, 'orderId', null, 'takes', takes, 'adjust', true, 'by', role_));
  end if;

  update public.punpang_customers set data = jsonb_set(data, '{ledger}', new_ledger), updated_at = now() where id = c.id;
  select coalesce(sum((e->>'remaining')::int), 0) into bal
    from jsonb_array_elements(new_ledger) e
   where (e->>'delta')::int > 0 and coalesce((e->>'remaining')::int, 0) > 0 and (e->>'expiresAt' is null or e->>'expiresAt' >= today_);
  return jsonb_build_object('ok', true, 'entryId', eid, 'balance', bal);
end $$;

revoke all on function public.punpang_adjust_points(text, integer, text) from public, anon;
grant execute on function public.punpang_adjust_points(text, integer, text) to authenticated;
