-- ลิงก์ย่อ: ให้เซิร์ฟเวอร์เป็นผู้ตรวจและตัดสินปลายทาง (ผู้เยี่ยมชมไม่ต้องอ่านตารางลิงก์ย่อทั้งหมดอีกต่อไป)
-- ขั้นตอนที่ 1 จาก 2: สร้างฟังก์ชันนี้ก่อน → deploy หน้าเว็บที่เรียกฟังก์ชันนี้ → ค่อยรันไฟล์ถัดไป (ปิดการอ่านสาธารณะ)
-- ตรวจเหมือนฝั่งแอป (src/lib/orderLink.js checkTarget): ภายใน = ขึ้นต้น / (ไม่ใช่ // หรือ \ หรืออักขระควบคุม หรือ /s/) · ภายนอก = https ไม่มี userinfo และโฮสต์อยู่ใน linkAllowlist
-- ตรวจ active/วันหมดอายุ แล้วนับคลิกฝั่งเซิร์ฟเวอร์ · คืน null เมื่อไม่ถูกต้อง (ไม่บอกเหตุผล)
create or replace function public.punpang_resolve_short_link(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  allow jsonb;
  tgt text;
  host text;
begin
  if p_code is null or p_code !~ '^[a-z0-9-]{3,32}$' then return null; end if;

  select r.id, r.data into l
    from public.punpang_records r
   where r.collection = 'shortLinks' and r.data->>'code' = lower(p_code)
   limit 1;
  if not found then return null; end if;

  if coalesce(l.data->>'active', 'true') = 'false' then return null; end if;
  if nullif(l.data->>'expiresAt', '') is not null and (l.data->>'expiresAt')::timestamptz < now() then return null; end if;

  tgt := l.data->>'target';
  if tgt is null or length(tgt) > 2000 then return null; end if;

  if left(tgt, 1) = '/' then
    if left(tgt, 2) = '//' or position(E'\\' in tgt) > 0 or tgt ~ '[[:cntrl:]]' or tgt ~ '^/s/' then return null; end if;
  else
    if tgt !~* '^https://[^/@[:space:]]+(/.*)?$' then return null; end if;
    host := lower(substring(tgt from '^https://([^/:?#]+)'));
    select coalesce(k.data->'v'->'linkAllowlist', '[]'::jsonb) into allow
      from public.punpang_kv k where k.collection = 'config' and k.id = 'shop';
    if allow is null or host is null or not (allow ? host) then return null; end if;
  end if;

  update public.punpang_records
     set data = jsonb_set(data, '{clicks}', to_jsonb(coalesce((data->>'clicks')::int, 0) + 1))
   where collection = 'shortLinks' and id = l.id;

  return jsonb_build_object('kind', case when left(tgt, 1) = '/' then 'internal' else 'external' end, 'target', tgt);
end
$$;

revoke all on function public.punpang_resolve_short_link(text) from public;
grant execute on function public.punpang_resolve_short_link(text) to anon, authenticated;
