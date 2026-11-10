-- ดัชนีให้ foreign key ของ punpang_payments (advisor: unindexed_foreign_keys) · รันซ้ำได้ (if not exists)
create index if not exists punpang_payments_reported_by_idx on public.punpang_payments (reported_by);
create index if not exists punpang_payments_confirmed_by_idx on public.punpang_payments (confirmed_by);
