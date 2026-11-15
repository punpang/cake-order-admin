-- รอบแก้ 2026-11-15 (ประวัติการแก้ออร์เดอร์และแคตาล็อก · ไม่บล็อกการแก้ไข) · รันหลัง 20261115090000 · รันซ้ำได้ปลอดภัย
-- บันทึกที่ฐานข้อมูล (ทำงานกับทุกการเขียน แม้มาจากเครื่องที่แก้ข้อมูลเองได้):
--   1) punpang_order_changes: ทุกครั้งที่รายการ/ส่วนลด/ค่าส่ง/VAT ของออร์เดอร์เปลี่ยน — ใครแก้ เมื่อไร รายการใดหายไป/เพิ่ม/เปลี่ยน
--   2) punpang_catalog_history: ทุกครั้งที่สินค้าหน้าร้านหรือการตั้งค่าราคาเปลี่ยน — ค่าก่อนและหลัง ใครแก้ เมื่อไร
-- ตัวตรวจใช้ประวัติข้อ 2 เพื่อเทียบออร์เดอร์กับราคาที่ใช้ได้ ณ เวลาที่สร้าง (ไม่เตือนจากการเปลี่ยนราคาภายหลัง)
-- และตรวจซ้ำเมื่อออร์เดอร์ถูกแก้หลังตรวจครั้งก่อน (ทั้งสองตารางอ่านได้เฉพาะสิทธิ์ที่เห็นออร์เดอร์/แก้ตั้งค่า · เขียนได้เฉพาะเซิร์ฟเวอร์และ trigger)

-- ============================================================================
-- 1) ตารางบันทึก
-- ============================================================================
create table if not exists public.punpang_order_changes (
  id bigint generated always as identity primary key,
  order_id text not null references public.punpang_orders (id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  summary jsonb not null
);
create index if not exists punpang_order_changes_order_idx on public.punpang_order_changes (order_id, changed_at);

create table if not exists public.punpang_catalog_history (
  id bigint generated always as identity primary key,
  source text not null check (source in ('item', 'config')),
  key text not null,
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz not null default now(),
  changed_by uuid
);
create index if not exists punpang_catalog_history_time_idx on public.punpang_catalog_history (changed_at);

alter table public.punpang_order_changes enable row level security;
alter table public.punpang_catalog_history enable row level security;
revoke all on public.punpang_order_changes from public, anon, authenticated;
revoke all on public.punpang_catalog_history from public, anon, authenticated;
grant select on public.punpang_order_changes to authenticated;
grant select on public.punpang_catalog_history to authenticated;

drop policy if exists order_changes_read on public.punpang_order_changes;
create policy order_changes_read on public.punpang_order_changes for select to authenticated
  using (public.punpang_has_perm('viewAllOrders') or public.punpang_has_perm('manage'));

drop policy if exists catalog_history_read on public.punpang_catalog_history;
create policy catalog_history_read on public.punpang_catalog_history for select to authenticated
  using (public.punpang_has_perm('manage'));

-- ============================================================================
-- 2) บันทึกการแก้รายการ/การเงินของออร์เดอร์ (AFTER UPDATE · ไม่บล็อก)
-- ============================================================================
create or replace function public.punpang_log_order_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed jsonb;
  added jsonb;
  changed jsonb;
  money jsonb := '{}'::jsonb;
  f text;
begin
  if old.data is not distinct from new.data then
    return null;
  end if;

  -- รายการเทียบกันด้วยรหัสรายการ
  select
    coalesce(jsonb_agg(jsonb_build_object('id', o.v->>'id', 'name', o.v->>'name', 'qty', o.v->'qty', 'unitPrice', o.v->'unitPrice'))
      filter (where n.v is null), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('id', n.v->>'id', 'name', n.v->>'name', 'qty', n.v->'qty', 'unitPrice', n.v->'unitPrice'))
      filter (where o.v is null), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('id', o.v->>'id',
        'before', jsonb_build_object('qty', o.v->'qty', 'unitPrice', o.v->'unitPrice', 'discounts', o.v->'discounts'),
        'after', jsonb_build_object('qty', n.v->'qty', 'unitPrice', n.v->'unitPrice', 'discounts', n.v->'discounts')))
      filter (where o.v is not null and n.v is not null
        and (o.v->'qty' is distinct from n.v->'qty'
          or o.v->'unitPrice' is distinct from n.v->'unitPrice'
          or o.v->'discounts' is distinct from n.v->'discounts')), '[]'::jsonb)
  into removed, added, changed
  from jsonb_array_elements(coalesce(old.data->'items', '[]'::jsonb)) as o(v)
  full join jsonb_array_elements(coalesce(new.data->'items', '[]'::jsonb)) as n(v)
    on (o.v->>'id') = (n.v->>'id');

  foreach f in array array['adjustment', 'shippingFee', 'vat', 'couponsUsed', 'pointsUsed', 'distanceKm', 'feeManual', 'pickupAt'] loop
    if old.data->f is distinct from new.data->f then
      money := money || jsonb_build_object(f, jsonb_build_object('before', old.data->f, 'after', new.data->f));
    end if;
  end loop;

  if removed = '[]'::jsonb and added = '[]'::jsonb and changed = '[]'::jsonb and money = '{}'::jsonb then
    return null;
  end if;

  insert into public.punpang_order_changes (order_id, changed_by, summary)
  values (new.id, auth.uid(), jsonb_build_object(
    'removed', removed,
    'added', added,
    'changed', changed,
    'money', money,
    'itemsBefore', jsonb_array_length(coalesce(old.data->'items', '[]'::jsonb)),
    'itemsAfter', jsonb_array_length(coalesce(new.data->'items', '[]'::jsonb))));
  return null;
end $$;
revoke all on function public.punpang_log_order_changes() from public, anon, authenticated;

drop trigger if exists punpang_orders_log_changes on public.punpang_orders;
create trigger punpang_orders_log_changes after update on public.punpang_orders
  for each row execute function public.punpang_log_order_changes();

-- ============================================================================
-- 3) ประวัติแคตาล็อก: สินค้าหน้าร้าน และการตั้งค่าที่ใช้คิดราคา (AFTER · ไม่บล็อก)
-- ============================================================================
create or replace function public.punpang_log_catalog_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid text;
  rkind text;
  rcoll text;
begin
  if tg_table_name = 'punpang_items' then
    if tg_op = 'DELETE' then rid := old.id; rkind := old.kind; else rid := new.id; rkind := new.kind; end if;
    if rkind <> 'retail' then return null; end if;
    if tg_op = 'UPDATE' and old.price is not distinct from new.price and old.active is not distinct from new.active
       and old.name is not distinct from new.name and old.data is not distinct from new.data then
      return null;
    end if;
    insert into public.punpang_catalog_history (source, key, old_data, new_data, changed_by)
    values ('item', rid,
      case when tg_op = 'INSERT' then null else jsonb_build_object('id', old.id, 'name', old.name, 'price', old.price, 'active', old.active, 'data', old.data) end,
      case when tg_op = 'DELETE' then null else jsonb_build_object('id', new.id, 'name', new.name, 'price', new.price, 'active', new.active, 'data', new.data) end,
      auth.uid());
  else
    if tg_op = 'DELETE' then rid := old.id; rcoll := old.collection; else rid := new.id; rcoll := new.collection; end if;
    if rcoll <> 'config' or rid not in ('shop', 'priceLists', 'bundles', 'optionGroups', 'posDiscounts', 'posBundles', 'posDeals', 'posModifiers') then
      return null;
    end if;
    if tg_op = 'UPDATE' and old.data is not distinct from new.data then return null; end if;
    insert into public.punpang_catalog_history (source, key, old_data, new_data, changed_by)
    values ('config', rid,
      case when tg_op = 'INSERT' then null else old.data->'v' end,
      case when tg_op = 'DELETE' then null else new.data->'v' end,
      auth.uid());
  end if;
  return null;
end $$;
revoke all on function public.punpang_log_catalog_history() from public, anon, authenticated;

drop trigger if exists punpang_items_catalog_history on public.punpang_items;
create trigger punpang_items_catalog_history after insert or update or delete on public.punpang_items
  for each row execute function public.punpang_log_catalog_history();

drop trigger if exists punpang_kv_catalog_history on public.punpang_kv;
create trigger punpang_kv_catalog_history after insert or update or delete on public.punpang_kv
  for each row execute function public.punpang_log_catalog_history();

-- ============================================================================
-- 4) คิวตรวจ: ตรวจซ้ำเมื่อออร์เดอร์ถูกแก้หลังการตรวจครั้งก่อน (แทนที่ฉบับ 20261115090000)
-- ============================================================================
create or replace function public.punpang_orders_unaudited(p_limit int)
returns table (id text, channel text, status text, fulfillment text, data jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.channel, o.status, o.fulfillment, o.data
    from public.punpang_orders o
   where o.updated_at > now() - interval '2 days'
     and not exists (select 1 from public.punpang_order_audits a where a.order_id = o.id and a.checked_at >= o.updated_at)
     and (
       o.channel = 'pos'
       or (coalesce(o.channel, '') <> 'pos' and coalesce(o.status, '') <> 'draft' and coalesce(o.data->>'quoteId', '') = '')
     )
   order by o.updated_at, o.id
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;
revoke all on function public.punpang_orders_unaudited(int) from public, anon, authenticated;
grant execute on function public.punpang_orders_unaudited(int) to service_role;
