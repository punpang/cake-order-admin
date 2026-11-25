-- สั่งล่วงหน้า: โควตารายรอบเวลา (แผนโหมดวันรับและรอบเวลา Task 2)
-- ตาราง punpang_preorder_round_slots นับจำนวนออร์เดอร์ที่จองแล้วต่อ (แคมเปญ, วันรับ, รอบ) · ฟังก์ชันจอง/ปลดทำงานแบบอะตอมมิกด้วยการล็อกแถว
-- ไม่แก้ punpang_preorder_reserve เดิม (โควตาสินค้า/วัน) เพื่อไม่กระทบออเดอร์ที่มีอยู่
-- แคมเปญโหมดวัน (pickupMode ไม่ใช่ 'slot') จองรอบไม่ได้

create table if not exists public.punpang_preorder_round_slots (
  campaign_id text not null references public.punpang_preorder_campaigns (id),
  pickup_date date not null,
  round_time text not null check (round_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  reserved integer not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, pickup_date, round_time)
);

alter table public.punpang_preorder_round_slots enable row level security;
revoke all on public.punpang_preorder_round_slots from public, anon, authenticated;

create or replace function public.punpang_preorder_reserve_round(p_campaign text, p_pickup date, p_round text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.punpang_preorder_campaigns%rowtype;
  rd jsonb; cap integer; cur integer;
  today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  select * into c from public.punpang_preorder_campaigns where id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if c.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if today < c.order_from or today > c.order_to then return jsonb_build_object('ok', false, 'error', 'outside_order_window'); end if;
  if p_pickup < c.pickup_from or p_pickup > c.pickup_to then return jsonb_build_object('ok', false, 'error', 'bad_date'); end if;
  if coalesce(c.data->>'pickupMode', 'day') <> 'slot' then return jsonb_build_object('ok', false, 'error', 'not_slot_mode'); end if;
  select e into rd from jsonb_array_elements(coalesce(c.data->'rounds', '[]'::jsonb)) as e where e->>'time' = p_round limit 1;
  if rd is null then return jsonb_build_object('ok', false, 'error', 'bad_round'); end if;
  cap := (rd->>'cap')::integer;
  insert into public.punpang_preorder_round_slots (campaign_id, pickup_date, round_time, reserved)
    values (c.id, p_pickup, p_round, 0) on conflict do nothing;
  select reserved into cur from public.punpang_preorder_round_slots
    where campaign_id = c.id and pickup_date = p_pickup and round_time = p_round for update;
  if cur >= cap then return jsonb_build_object('ok', false, 'error', 'round_full'); end if;
  update public.punpang_preorder_round_slots set reserved = reserved + 1, updated_at = now()
    where campaign_id = c.id and pickup_date = p_pickup and round_time = p_round;
  return jsonb_build_object('ok', true, 'reserved', cur + 1, 'cap', cap);
end $$;

create or replace function public.punpang_preorder_release_round(p_campaign text, p_pickup date, p_round text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur integer;
begin
  select reserved into cur from public.punpang_preorder_round_slots
    where campaign_id = p_campaign and pickup_date = p_pickup and round_time = p_round for update;
  if not found or cur <= 0 then return jsonb_build_object('ok', false, 'error', 'nothing_to_release'); end if;
  update public.punpang_preorder_round_slots set reserved = reserved - 1, updated_at = now()
    where campaign_id = p_campaign and pickup_date = p_pickup and round_time = p_round;
  return jsonb_build_object('ok', true, 'reserved', cur - 1);
end $$;

revoke all on function public.punpang_preorder_reserve_round(text, date, text) from public, anon, authenticated;
revoke all on function public.punpang_preorder_release_round(text, date, text) from public, anon, authenticated;
grant execute on function public.punpang_preorder_reserve_round(text, date, text) to service_role;
grant execute on function public.punpang_preorder_release_round(text, date, text) to service_role;

-- โหมดทดสอบ: ตารางโควตารอบเป็น iso แล้วซิงก์นิยามใหม่
do $$
declare d text; n text; pat text := '''punpang_preorder_notifications''];';
begin
  d := pg_get_functiondef('punpang_test.punpang_test_sync()'::regprocedure);
  if position('''punpang_preorder_round_slots''' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then
    raise exception 'ไม่พบรายการ iso ที่คาดไว้ใน punpang_test_sync (ตรวจ migration โหมดทดสอบ)';
  end if;
  n := replace(d, pat, '''punpang_preorder_notifications'', ''punpang_preorder_round_slots''];');
  execute n;
end $$;
select punpang_test.punpang_test_sync();
