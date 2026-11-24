-- สั่งล่วงหน้า เฟส 3D: หมดเวลาจ่ายมัดจำอัตโนมัติทุก 5 นาที (pg_cron) · เรียกซ้ำได้ (การตั้งชื่อเดิมซ้ำจะปรับงานเดิม)
-- งานเรียก punpang_preorder_expire_due: ปล่อยโควตาและคืนแต้มของออร์เดอร์ที่เลยกำหนด เก็บออร์เดอร์ไว้ให้ขอขยาย
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('punpang-preorder-expire', '*/5 * * * *', $c$select public.punpang_preorder_expire_due(now())$c$);
  end if;
end $$;
