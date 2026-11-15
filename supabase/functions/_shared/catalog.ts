// แคตาล็อกที่ใช้คิดราคาและตรวจราคา: ค่าตั้งค่า (punpang_kv collection config) + สินค้าหน้าร้าน (punpang_items)
// อ่านด้วยสิทธิ์เซิร์ฟเวอร์ · ใช้ร่วมกันโดย quote-create และ order-audit · คืน null เมื่ออ่านไม่สำเร็จ
const CONFIG_IDS = ['shop', 'priceLists', 'bundles', 'optionGroups', 'posDiscounts', 'posBundles', 'posDeals', 'posModifiers']

// อ่านทั้งชุดแบบแบ่งหน้า (API ส่งทีละไม่เกิน 1000 แถว) · path ต้องมีเครื่องหมาย ? แล้ว
export async function pages(url: string, headers: Record<string, string>, path: string): Promise<any[] | null> {
  const out: any[] = []
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${url}/rest/v1/${path}&limit=1000&offset=${off}`, { headers })
    if (!r.ok) return null
    const rows = await r.json()
    if (!Array.isArray(rows)) return null
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

export async function loadCatalog(url: string, headers: Record<string, string>): Promise<Record<string, any> | null> {
  const kv = await pages(url, headers, `punpang_kv?collection=eq.config&id=in.(${CONFIG_IDS.join(',')})&select=id,data`)
  if (!kv) return null
  const cfg: Record<string, any> = {}
  for (const row of kv) cfg[row.id] = row.data?.v
  const items = await pages(url, headers, 'punpang_items?kind=eq.retail&select=id,name,price,active,data&order=id')
  if (!items) return null
  return {
    shop: cfg.shop ?? {},
    priceLists: cfg.priceLists ?? [],
    optionGroups: cfg.optionGroups ?? [],
    bundles: cfg.bundles ?? [],
    posDiscounts: cfg.posDiscounts ?? [],
    posBundles: cfg.posBundles ?? [],
    posDeals: cfg.posDeals ?? [],
    posModifiers: cfg.posModifiers ?? [],
    retailItems: items.map((x) => ({ ...(x.data || {}), id: x.id, name: x.name, price: x.price == null ? null : Number(x.price), active: x.active })),
  }
}
