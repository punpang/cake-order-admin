-- สั่งล่วงหน้า: สร้างออเดอร์พร้อมจองรอบเวลาในธุรกรรมเดียว (แผนโหมดวันรับและรอบเวลา Task 3)
-- ถ้าไม่ระบุรอบ (ค่าว่าง) ทำงานเหมือน punpang_preorder_create เดิมทุกประการ
-- ถ้าระบุรอบ: จองรอบ → สร้างออเดอร์ ภายใน savepoint เดียว · ถ้าสร้างไม่สำเร็จ ยกเลิกการจองรอบทั้งหมดอัตโนมัติ
-- ออเดอร์ที่มีอยู่แล้ว (รหัสซ้ำ) ตอบเหมือนเดิมโดยไม่จองรอบเพิ่ม

create or replace function public.punpang_preorder_create_round(p_row jsonb, p_lines jsonb, p_points integer, p_amount numeric, p_round text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  rr jsonb; r jsonb; rnd text := coalesce(p_round, '');
begin
  -- ออเดอร์ซ้ำหรือไม่ระบุรอบ: ใช้ทางเดิม ไม่จองรอบ
  if rnd = '' or exists (select 1 from public.punpang_preorder_orders where id = p_row->>'id') then
    return public.punpang_preorder_create(p_row, p_lines, p_points, p_amount);
  end if;
  begin
    rr := public.punpang_preorder_reserve_round(p_row->>'campaign_id', (p_row->>'pickup_date')::date, rnd);
    if not coalesce((rr->>'ok')::boolean, false) then
      raise exception using errcode = 'P0002', message = coalesce(rr->>'error', 'round_failed');
    end if;
    r := public.punpang_preorder_create(p_row, p_lines, p_points, p_amount);
    if r ? 'error' then
      raise exception using errcode = 'P0002', message = coalesce(r->>'error', 'create_failed');
    end if;
    return r;
  exception when sqlstate 'P0002' then
    return jsonb_build_object('error', sqlerrm);
  end;
end $$;

revoke all on function public.punpang_preorder_create_round(jsonb, jsonb, integer, numeric, text) from public, anon, authenticated;
grant execute on function public.punpang_preorder_create_round(jsonb, jsonb, integer, numeric, text) to service_role;

-- โหมดทดสอบ: ซิงก์นิยามใหม่ (ไม่มีตารางใหม่)
select punpang_test.punpang_test_sync();
