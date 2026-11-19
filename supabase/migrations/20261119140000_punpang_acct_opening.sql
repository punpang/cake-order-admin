-- บัญชี: โหลดรายละเอียดเฉพาะช่วงล่าสุด ส่วนก่อนหน้าใช้ "ยอดยกมา" ที่ฐานข้อมูลรวมให้
-- ยอดรวมเดบิต/เครดิตรายบัญชีของรายการที่บันทึกเอง + รายการแช่แข็ง ที่ลงวันที่ถึง p_through
-- security invoker: นโยบาย RLS ของสองตารางใช้ตามสิทธิ์ผู้เรียก (ไม่มีสิทธิ์ดูบัญชี = ได้ผลว่าง)
create or replace function public.punpang_acct_opening(p_through date)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('account', t.account, 'dr', t.dr, 'cr', t.cr) order by t.account), '[]'::jsonb)
  from (
    select l->>'account' as account,
           sum(coalesce((l->>'dr')::numeric, 0)) as dr,
           sum(coalesce((l->>'cr')::numeric, 0)) as cr
    from (
      select e.data->'lines' as lines from public.punpang_acct_entries e where e.entry_date <= p_through
      union all
      select f.data->'lines' from public.punpang_acct_frozen f where f.entry_date <= p_through
    ) s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.lines) = 'array' then s.lines else '[]'::jsonb end) as l
    where coalesce(l->>'account', '') <> ''
    group by 1
  ) t
$$;
revoke all on function public.punpang_acct_opening(date) from public, anon;
grant execute on function public.punpang_acct_opening(date) to authenticated;

-- ใบกำกับภาษี: ออร์เดอร์หนึ่งมีใบที่ใช้งานได้ (ยังไม่ถูกยกเลิกด้วยใบลดหนี้) ได้ใบเดียว
-- เดิมตรวจในแอปอย่างเดียว · ตอนนี้แอปโหลดใบเฉพาะช่วงล่าสุด จึงกันซ้ำที่ฐานข้อมูลด้วย
create unique index if not exists punpang_acct_invoices_one_active_per_order
  on public.punpang_acct_invoices (order_id)
  where kind = 'invoice' and order_id is not null and (data->>'voidedBy') is null;
create index if not exists punpang_acct_invoices_doc_date_idx on public.punpang_acct_invoices (doc_date);

-- สำเนาโหมดทดสอบ (punpang_test) ให้มีฟังก์ชันและดัชนีใหม่ด้วย (ดู supabase/tests/mirror.test.sql ข้อ A6)
select punpang_test.punpang_test_sync();
