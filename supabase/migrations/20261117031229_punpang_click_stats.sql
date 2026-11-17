-- สถิติคลิกแบบรวมยอด (ขั้นที่ 1 ของการแก้ punpang_click_pairs): คืนเฉพาะจำนวนผู้เยี่ยมชมไม่ซ้ำต่อรูป และต่อคู่รูป
-- · ไม่มีรหัสผู้เยี่ยมชมในผลลัพธ์ · ตัดรายการที่มีผู้เยี่ยมชมน้อยกว่า 3 คน (ฝังในฟังก์ชัน ผู้เรียกปรับไม่ได้)
-- · ใช้ 5,000 คลิกล่าสุดเหมือนเดิม · punpang_click_pairs เดิมยังคงอยู่ (anon ยังเรียกได้) จนกว่าจะตัดสิทธิ์ในขั้นถัดไป

create or replace function public.punpang_click_stats()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  with recent as (
    select c.v, c.photo_id from public.punpang_cake_clicks c order by c.at desc limit 5000
  ), uniq as (
    select distinct v, photo_id from recent
  ), photo_n as (
    select photo_id, count(*)::int as n from uniq group by photo_id having count(*) >= 3
  ), pair_n as (
    select a.photo_id as a, b.photo_id as b, count(*)::int as n
    from uniq a join uniq b on a.v = b.v and a.photo_id < b.photo_id
    group by a.photo_id, b.photo_id having count(*) >= 3
  )
  select jsonb_build_object(
    'photos', coalesce((select jsonb_object_agg(photo_id, n) from photo_n), '{}'::jsonb),
    'pairs', coalesce((select jsonb_agg(jsonb_build_object('a', a, 'b', b, 'n', n)) from pair_n), '[]'::jsonb)
  );
$$;

revoke all on function public.punpang_click_stats() from public, anon, authenticated;
grant execute on function public.punpang_click_stats() to anon, authenticated;

-- ฉบับโหมดทดสอบ (punpang_test): โครงสร้างและสิทธิ์เหมือนฉบับจริง ใช้ตารางของ schema ทดสอบ
create or replace function punpang_test.punpang_click_stats()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  with recent as (
    select c.v, c.photo_id from punpang_test.punpang_cake_clicks c order by c.at desc limit 5000
  ), uniq as (
    select distinct v, photo_id from recent
  ), photo_n as (
    select photo_id, count(*)::int as n from uniq group by photo_id having count(*) >= 3
  ), pair_n as (
    select a.photo_id as a, b.photo_id as b, count(*)::int as n
    from uniq a join uniq b on a.v = b.v and a.photo_id < b.photo_id
    group by a.photo_id, b.photo_id having count(*) >= 3
  )
  select jsonb_build_object(
    'photos', coalesce((select jsonb_object_agg(photo_id, n) from photo_n), '{}'::jsonb),
    'pairs', coalesce((select jsonb_agg(jsonb_build_object('a', a, 'b', b, 'n', n)) from pair_n), '[]'::jsonb)
  );
$$;

revoke all on function punpang_test.punpang_click_stats() from public, anon, authenticated;
grant execute on function punpang_test.punpang_click_stats() to anon, authenticated;
