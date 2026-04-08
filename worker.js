// ─── Constants ───────────────────────────────────────────────────
const BIN_PATTERNS = [/\bbin\b/i, /\bfill a bag\b/i, /\bglass case\b/i];
const MAX_TXN_DURATION_MS = 30 * 60 * 1000;
const ALL_STORES = ["BL1", "BL2", "BL4", "BL8", "BL12", "BL14"];

// L3 (Clover category name) → L2 (rollup category) mapping
const L3_TO_L2 = {
  "BL CONSUMABLES - FOOD - PEPSI": "Consumable Food",
  "BL CONSUMABLES - FOOD - PEPSI CASE PACK": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - BEVERAGES": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - BREAKFAST": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - CANDY": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - CANNED GOODS": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - COFFEE & TEA": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - CONDIMENTS": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - FROZEN": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - PANTRY": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - SINGLES": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - SNACKS": "Consumable Food",
  "FG G CI MIXED CANDY": "Consumable Food",
  "FRONTE PASTA - 10LBS": "Consumable Food",
  "FRONTE PASTA - 5LBS": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - ENERGY DRINKS": "Consumable Food",
  "FG BL CONSUMABLES - FOOD - MIXED BAG CANDY": "Consumable Food",
  "FG BL CONSUMABLES - HBA - ALLERGY/COUGH/FLU": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - COSMETICS": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - FACE": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - HAIRCARE": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - HYGIENE": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - MEDS": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - ORAL": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - PAIN": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - SUNCARE": "Consumable HBA",
  "FG BL CONSUMABLES - HBA - TRAVEL SIZE": "Consumable HBA",
  "FG BL CONSUMABLES - CHEMICALS": "Consumable Other",
  "FG BL CONSUMABLES - HOUSEKEEPING": "Consumable Other",
  "FG BL CONSUMABLES - PAPER": "Consumable Other",
  "FG BL CONSUMABLES - PET": "Consumable Other",
  "BL PAPER - NON INVENTORY": "Consumable Other",
  "FG BL FURNITURE - READY TO ASSEMBLE": "Furniture",
  "FG BL FURNITURE - RTA - CHAIRS": "Furniture",
  "FG BL FURNITURE - RTA - TABLES/STANDS": "Furniture",
  "FG BL FURNITURE - UPHOLSTERY": "Furniture",
  "FG BL FURNITURE - CASEGOODS": "Furniture",
  "FG BL FURNITURE - MATTRESSES": "Furniture",
  "FG BL WAYFAIR": "Furniture",
  "MATTRESS ATLANTA MATTRESSES": "Furniture",
  "BAILEY'S RECLINER FURNITURE": "Furniture",
  "BL STORES - COMPTON'S FURNITURE": "Furniture",
  "FG BL HARDLINES - BABY": "Hardlines",
  "FG BL HARDLINES - ELECTRONICS": "Hardlines",
  "FG BL HARDLINES - GENERAL MERCHANDISE": "Hardlines",
  "FG BL HARDLINES - LUGGAGE": "Hardlines",
  "FG BL HARDLINES - OFFICE PRODUCTS": "Hardlines",
  "FG BL HARDLINES - STORAGE": "Hardlines",
  "FG BL HARDLINES - TOYS": "Hardlines",
  "FG BL HARDLINES - SPORTING GOODS": "Hardlines",
  "FG T BULLSEYE": "Hardlines",
  "APPLIANCES - BL STORES": "Hardlines",
  "Bakers Secret - Kitchen Cooking": "Home",
  "FG BL HAMILTON BEACH": "Home",
  "FG BL HOME - BATH": "Home",
  "FG BL HOME - BEDDING & PILLOWS": "Home",
  "FG BL HOME - HOME DECOR": "Home",
  "FG BL HOME - KITCHEN": "Home",
  "FG BL HOME - RUGS": "Home",
  "BL FOAM PLATE PACKS": "Home",
  "FG BL SEASONAL - CHRISTMAS - CANDY": "Seasonal",
  "FG BL SEASONAL - CHRISTMAS - GM": "Seasonal",
  "FG BL SEASONAL - EASTER - GM": "Seasonal",
  "FG BL SEASONAL - EASTER - CANDY": "Seasonal",
  "FG BL SEASONAL - VALENTINES - CANDY": "Seasonal",
  "FG BL SEASONAL - VALENTINES - GM": "Seasonal",
  "FG BL SEASONAL - BACK TO SCHOOL": "Seasonal",
  "FG BL SEASONAL - HALLOWEEN - GM": "Seasonal",
  "FG BL SEASONAL - HALLOWEEN - CANDY": "Seasonal",
  "FG BL SEASONAL - HALLOWEEN - SINGLES": "Seasonal",
  "FG BL SEASONAL - SPRING/SUMMER": "Seasonal",
  "FG BL SEASONAL - LAWN & GARDEN": "Seasonal",
  "FG BALSAM CHRISTMAS TREES B": "Seasonal",
  "FG COSTUMES": "Seasonal",
  "FG BL SOFTLINES - ACCESSORIES": "Softline - Accessories",
  "FG BL SOFTLINES - APPAREL": "Softline - Apparel",
  "FG BL SOFTLINES - SHOES": "Softline - Shoes",
  "Custom Sales": "Custom Sales",
  "MI Bottle/Can Deposit": "Custom Sales",
  "Refund": "Refund",
};

function isBinItem(name) {
  return BIN_PATTERNS.some(p => p.test(name));
}

// ─── Fetch item → category mapping from Clover inventory (cached 24h) ──
async function fetchItemCategoryMap(store, env) {
  const cacheKey = `item-cats:${store.toLowerCase()}`;

  if (env.SALES_SNAPSHOTS) {
    const cached = await env.SALES_SNAPSHOTS.get(cacheKey, "json");
    if (cached) return cached;
  }

  const merchantId = env[`${store}_MERCHANT_ID`];
  const apiToken = env[`${store}_API_TOKEN`];
  if (!merchantId || !apiToken) return {};

  const map = {};
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `https://api.clover.com/v3/merchants/${merchantId}/items?expand=categories&limit=${limit}&offset=${offset}`;
    const resp = await fetch(url, {
      headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
    });
    const data = await resp.json();
    if (!data?.elements?.length) break;

    for (const item of data.elements) {
      const catName = item.categories?.elements?.[0]?.name;
      if (catName && item.id) {
        map[item.id] = catName;
      }
    }
    if (data.elements.length < limit) break;
    offset += limit;
  }

  if (env.SALES_SNAPSHOTS) {
    await env.SALES_SNAPSHOTS.put(cacheKey, JSON.stringify(map), { expirationTtl: 86400 });
  }

  return map;
}

// ─── Fetch raw orders from Clover API ────────────────────────────
async function fetchCloverOrders(store, env, sinceTimestamp) {
  const targetStore = store.toUpperCase();
  const merchantId = env[`${targetStore}_MERCHANT_ID`];
  const apiToken = env[`${targetStore}_API_TOKEN`];

  if (!merchantId || !apiToken) return null;

  const limit = 1000;
  let offset = 0;
  const allElements = [];

  while (true) {
    const cloverUrl = `https://api.clover.com/v3/merchants/${merchantId}/orders`
      + `?filter=createdTime>=${sinceTimestamp}`
      + `&filter=state=locked`
      + `&expand=payments,lineItems`
      + `&limit=${limit}&offset=${offset}`;

    const resp = await fetch(cloverUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = await resp.json();
    if (!data || !data.elements || data.elements.length === 0) break;

    allElements.push(...data.elements);
    if (data.elements.length < limit) break;
    offset += limit;
  }

  return allElements;
}

// ─── Aggregate raw orders into summary metrics ───────────────────
function aggregateOrders(elements, sinceTimestamp) {
  let totalNet = 0, binNet = 0, retailNet = 0;
  let orderCount = 0, totalItemCount = 0;
  let totalTxnTimeMs = 0, txnTimeCount = 0;

  for (const order of elements) {
    if (order.total == null || order.total === 0) continue;
    if (order.state !== "locked") continue;
    if (order.createdTime < sinceTimestamp) continue;

    const totalCents = order.total;

    let taxCents = 0;
    if (order.payments?.elements) {
      for (const pmt of order.payments.elements) {
        taxCents += (pmt.taxAmount || 0);
      }
    }
    const orderNet = totalCents - taxCents;
    totalNet += orderNet;
    if (orderNet > 0) orderCount++;

    // Transaction time
    if (orderNet > 0 && order.createdTime && order.payments?.elements?.length) {
      let lastPaymentTime = 0;
      for (const pmt of order.payments.elements) {
        if (pmt.createdTime > lastPaymentTime) lastPaymentTime = pmt.createdTime;
      }
      if (lastPaymentTime > order.createdTime) {
        const duration = lastPaymentTime - order.createdTime;
        if (duration < MAX_TXN_DURATION_MS) {
          totalTxnTimeMs += duration;
          txnTimeCount++;
        }
      }
    }

    // Classify line items as bin vs retail
    let binItemTotal = 0, retailItemTotal = 0, orderItemCount = 0;
    if (order.lineItems?.elements) {
      for (const item of order.lineItems.elements) {
        const qty = item.unitQty != null ? item.unitQty / 1000 : 1;
        const price = (item.price || 0) * qty;
        orderItemCount += qty;
        if (isBinItem(item.name || "")) {
          binItemTotal += price;
        } else {
          retailItemTotal += price;
        }
      }
    }
    if (orderNet > 0) totalItemCount += orderItemCount;

    // Distribute net proportionally
    const itemGross = binItemTotal + retailItemTotal;
    if (itemGross > 0) {
      binNet += orderNet * (binItemTotal / itemGross);
      retailNet += orderNet * (retailItemTotal / itemGross);
    } else {
      retailNet += orderNet;
    }
  }

  const avgCart = orderCount > 0 ? (totalNet / orderCount) / 100 : 0;
  const avgItems = orderCount > 0 ? totalItemCount / orderCount : 0;
  const avgTxnSec = txnTimeCount > 0 ? Math.round(totalTxnTimeMs / txnTimeCount / 1000) : null;

  return {
    total: totalNet / 100,
    retail: Math.round(retailNet) / 100,
    bin: Math.round(binNet) / 100,
    avgCart,
    avgItems,
    orderCount,
    avgTxnSec,
  };
}

// ─── Save a snapshot to KV + D1 ─────────────────────────────────
async function saveSnapshot(env, store, dateStr, data) {
  const snapshotTime = new Date().toISOString();

  // Write to KV (existing behavior)
  if (env.SALES_SNAPSHOTS) {
    const key = `sales:${store.toLowerCase()}:${dateStr}`;
    await env.SALES_SNAPSHOTS.put(key, JSON.stringify({ ...data, snapshotTime }));
  }

  // Write to D1
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO daily_sales (store, date, total, retail, bin, order_count, avg_cart, avg_items, avg_txn_sec, snapshot_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(store, date) DO UPDATE SET
           total=excluded.total, retail=excluded.retail, bin=excluded.bin,
           order_count=excluded.order_count, avg_cart=excluded.avg_cart,
           avg_items=excluded.avg_items, avg_txn_sec=excluded.avg_txn_sec,
           snapshot_time=excluded.snapshot_time,
           budget=COALESCE(budget, excluded.budget),
           labor_pct=COALESCE(labor_pct, excluded.labor_pct),
           auction=COALESCE(auction, excluded.auction),
           week=COALESCE(week, excluded.week)`
      ).bind(
        store.toUpperCase(), dateStr,
        data.total ?? null, data.retail ?? null, data.bin ?? null,
        data.orderCount ?? null, data.avgCart ?? null, data.avgItems ?? null,
        data.avgTxnSec != null ? Math.round(data.avgTxnSec) : null, snapshotTime
      ).run();
    } catch (e) {
      console.error(`D1 write failed for ${store} ${dateStr}:`, e.message);
    }
  }
}

// ─── Fetch and aggregate for a store, then snapshot ──────────────
async function fetchAggregateAndSnapshot(store, env, sinceTimestamp, dateStr) {
  const elements = await fetchCloverOrders(store, env, sinceTimestamp);
  if (!elements) return null;

  const data = aggregateOrders(elements, sinceTimestamp);
  await saveSnapshot(env, store, dateStr, data);
  return data;
}

// ─── CORS headers ────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Snapshot-Secret",
};

// ─── Worker export ───────────────────────────────────────────────
export default {
  // ── HTTP request handler ──────────────────────────────────────
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ── History endpoint: ?history=true&store=BL1&from=2026-03-25&to=2026-04-01
    if (url.searchParams.get("history") === "true") {
      const store = url.searchParams.get("store");
      if (!store) {
        return new Response(JSON.stringify({ error: "Please specify a store" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!from || !to) {
        return new Response(JSON.stringify({ error: "Please specify from and to dates (YYYY-MM-DD)" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const results = {};
      const current = new Date(from + "T00:00:00Z");
      const end = new Date(to + "T00:00:00Z");

      while (current <= end) {
        const dateStr = current.toISOString().slice(0, 10);
        const val = await env.SALES_SNAPSHOTS.get(`sales:${store.toLowerCase()}:${dateStr}`, "json");
        if (val) results[dateStr] = val;
        current.setUTCDate(current.getUTCDate() + 1);
      }

      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── D1 History endpoint: ?history_d1=true&store=BL1&from=YYYY-MM-DD&to=YYYY-MM-DD
    if (url.searchParams.get("history_d1") === "true") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      if (!env.DB) {
        return new Response(JSON.stringify({ error: "D1 not configured" }), { status: 500, headers: corsJson });
      }
      const store = (url.searchParams.get("store") || "").toUpperCase();
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!store || !from || !to) {
        return new Response(JSON.stringify({ error: "Missing store, from, or to params" }), { status: 400, headers: corsJson });
      }
      const { results: rows } = await env.DB.prepare(
        "SELECT * FROM daily_sales WHERE store = ? AND date >= ? AND date <= ? ORDER BY date"
      ).bind(store, from, to).all();
      const out = {};
      for (const row of rows) {
        out[row.date] = {
          total: row.total, retail: row.retail, bin: row.bin,
          avgCart: row.avg_cart, avgItems: row.avg_items,
          orderCount: row.order_count, avgTxnSec: row.avg_txn_sec,
          snapshotTime: row.snapshot_time,
          budget: row.budget, laborPct: row.labor_pct,
          auction: row.auction, week: row.week,
        };
      }
      return new Response(JSON.stringify(out), { headers: corsJson });
    }

    // ── Manual snapshot endpoint: ?action=snapshot&store=BL1
    if (url.searchParams.get("action") === "snapshot") {
      const secret = request.headers.get("X-Snapshot-Secret");
      if (!env.SNAPSHOT_SECRET || secret !== env.SNAPSHOT_SECRET) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: corsHeaders,
        });
      }

      const store = url.searchParams.get("store");
      if (!store) {
        return new Response(JSON.stringify({ error: "Please specify a store" }), {
          status: 400, headers: corsHeaders,
        });
      }

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      // Use midnight UTC as the start time for full-day snapshot
      const startOfDay = new Date(dateStr + "T00:00:00Z").getTime();

      try {
        const data = await fetchAggregateAndSnapshot(store.toUpperCase(), env, startOfDay, dateStr);
        if (!data) {
          return new Response(JSON.stringify({ error: "Store keys not found" }), {
            status: 404, headers: corsHeaders,
          });
        }
        return new Response(JSON.stringify({ ok: true, store, date: dateStr, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Snapshot failed", detail: err.message }), {
          status: 500, headers: corsHeaders,
        });
      }
    }

    // ── Backfill endpoint: ?action=backfill (imports Sheets + KV → D1)
    if (url.searchParams.get("action") === "backfill") {
      const secret = request.headers.get("X-Snapshot-Secret");
      if (!env.SNAPSHOT_SECRET || secret !== env.SNAPSHOT_SECRET) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!env.DB) {
        return new Response(JSON.stringify({ error: "D1 not configured" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const SHEET_ID = "17byTs8k0CjH5gPOuBncq3RS3rL4PJR0PamdnbkKPss8";
      const STORE_TABS = {
        "BL1/BL6 Coliseum": "BL1", "BL2/BL7 South Bend": "BL2",
        "BL4/BL5 Dupont": "BL4", "BL8/BL9 Holland": "BL8",
        "BL12/BL13 Wyoming": "BL12", "BL14/B15 Battle Creek": "BL14"
      };
      const COL = { WEEK:2, DATE:3, B_TOTAL:8, A_RETAIL:17, A_BINS:18, A_AUCTION:19, A_TOTAL:20, A_LABOR:22 };

      function parseNum(cell) {
        if (!cell || cell.v == null || cell.v === "") return null;
        if (typeof cell.v === "number") return cell.v;
        const cleaned = String(cell.v).replace(/[,$%\s]/g, "");
        const n = parseFloat(cleaned);
        return isNaN(n) ? null : n;
      }

      function parseDate(cell) {
        if (!cell || cell.v == null) return null;
        const dv = cell.v;
        if (typeof dv === "string") {
          const dm = dv.match(/Date\((\d+),(\d+),(\d+)\)/);
          if (dm) return new Date(+dm[1], +dm[2], +dm[3]);
          const d = new Date(dv);
          return isNaN(d.getTime()) ? null : d;
        }
        if (typeof dv === "number") {
          const d = new Date(Math.round((dv - 25569) * 86400000));
          return isNaN(d.getTime()) ? null : d;
        }
        return null;
      }

      // Optional: filter to a single store to avoid subrequest limits
      const filterStore = url.searchParams.get("store")?.toUpperCase();
      const storeEntries = Object.entries(STORE_TABS).filter(([, code]) => !filterStore || code === filterStore);

      const summary = {};
      for (const [tabName, storeCode] of storeEntries) {
        let imported = 0, skipped = 0, errors = 0;
        try {
          // Fetch Google Sheets data via GViz API
          const gvizUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?headers=0&sheet=${encodeURIComponent(tabName)}&tqx=out:json`;
          const resp = await fetch(gvizUrl);
          const text = await resp.text();
          // Strip JSONP wrapper: google.visualization.Query.setResponse({...})
          const jsonStart = text.indexOf("{");
          const jsonEnd = text.lastIndexOf("}");
          if (jsonStart === -1 || jsonEnd === -1) { summary[storeCode] = { error: "Failed to parse GViz response" }; continue; }
          const gviz = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
          if (gviz.status !== "ok") { summary[storeCode] = { error: "Sheet returned error" }; continue; }

          const rows = gviz.table.rows || [];
          for (const row of rows) {
            const c = row.c || [];
            const date = parseDate(c[COL.DATE]);
            if (!date) { skipped++; continue; }

            const dateStr = date.toISOString().slice(0, 10);
            const week = c[COL.WEEK]?.v != null ? String(c[COL.WEEK].v) : null;
            const bTotal = parseNum(c[COL.B_TOTAL]);
            const aRetail = parseNum(c[COL.A_RETAIL]);
            const aBins = parseNum(c[COL.A_BINS]);
            const aAuction = parseNum(c[COL.A_AUCTION]);
            const aTotal = parseNum(c[COL.A_TOTAL]);
            const aLabor = parseNum(c[COL.A_LABOR]);

            // Also read KV snapshot for this date (Clover metrics)
            let kvData = null;
            if (env.SALES_SNAPSHOTS) {
              kvData = await env.SALES_SNAPSHOTS.get(`sales:${storeCode.toLowerCase()}:${dateStr}`, "json");
            }

            try {
              await env.DB.prepare(
                `INSERT INTO daily_sales (store, date, week, budget, total, retail, bin, auction, labor_pct,
                  order_count, avg_cart, avg_items, avg_txn_sec, snapshot_time)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(store, date) DO UPDATE SET
                   week=excluded.week, budget=excluded.budget,
                   total=COALESCE(excluded.total, total),
                   retail=COALESCE(excluded.retail, retail),
                   bin=COALESCE(excluded.bin, bin),
                   auction=COALESCE(excluded.auction, auction),
                   labor_pct=COALESCE(excluded.labor_pct, labor_pct),
                   order_count=COALESCE(excluded.order_count, order_count),
                   avg_cart=COALESCE(excluded.avg_cart, avg_cart),
                   avg_items=COALESCE(excluded.avg_items, avg_items),
                   avg_txn_sec=COALESCE(excluded.avg_txn_sec, avg_txn_sec),
                   snapshot_time=COALESCE(excluded.snapshot_time, snapshot_time)`
              ).bind(
                storeCode, dateStr, week, bTotal,
                kvData?.total || aTotal || null, kvData?.retail || aRetail || null, kvData?.bin || aBins || null,
                aAuction || null, aLabor || null,
                kvData?.orderCount ?? null, kvData?.avgCart ?? null, kvData?.avgItems ?? null,
                kvData?.avgTxnSec != null ? Math.round(kvData.avgTxnSec) : null,
                kvData?.snapshotTime ?? null
              ).run();
              imported++;
            } catch (e) {
              errors++;
              console.error(`Backfill D1 error ${storeCode} ${dateStr}:`, e.message);
            }
          }
          summary[storeCode] = { imported, skipped, errors };
        } catch (e) {
          summary[storeCode] = { error: e.message };
        }
      }
      return new Response(JSON.stringify({ ok: true, summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Item sales by L2 category: ?action=items&store=BL1
    if (url.searchParams.get("action") === "items") {
      const corsJson = { ...corsHeaders, "Content-Type": "application/json" };
      const store = (url.searchParams.get("store") || "").toUpperCase();
      if (!store) {
        return new Response(JSON.stringify({ error: "Missing store param" }), { status: 400, headers: corsJson });
      }
      const merchantId = env[`${store}_MERCHANT_ID`];
      const apiToken = env[`${store}_API_TOKEN`];
      if (!merchantId || !apiToken) {
        return new Response(JSON.stringify({ error: "Store keys not found" }), { status: 404, headers: corsJson });
      }

      try {
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);
        const startOfDay = new Date(todayStr + "T00:00:00Z").getTime();

        // Fetch orders with lineItems expanded to include item references
        const allElements = [];
        let offset = 0;
        const limit = 1000;
        while (true) {
          const cloverUrl = `https://api.clover.com/v3/merchants/${merchantId}/orders`
            + `?filter=createdTime>=${startOfDay}`
            + `&filter=state=locked`
            + `&expand=payments,lineItems.item,lineItems.discounts`
            + `&limit=${limit}&offset=${offset}`;
          const resp = await fetch(cloverUrl, {
            headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
          });
          const data = await resp.json();
          if (!data?.elements?.length) break;
          allElements.push(...data.elements);
          if (data.elements.length < limit) break;
          offset += limit;
        }

        // Fetch item→category mapping (cached 24h)
        const itemCatMap = await fetchItemCategoryMap(store, env);

        // Aggregate by L2 category
        const cats = {};
        function getCat(name) {
          if (!cats[name]) cats[name] = { qty: 0, gross: 0, discounts: 0, refunds: 0, net: 0 };
          return cats[name];
        }

        for (const order of allElements) {
          if (order.total == null || order.total === 0) continue;

          // Calculate tax for this order
          let taxCents = 0;
          if (order.payments?.elements) {
            for (const pmt of order.payments.elements) {
              taxCents += (pmt.taxAmount || 0);
            }
          }

          const lineItems = order.lineItems?.elements || [];

          for (const li of lineItems) {
            const qty = li.unitQty != null ? li.unitQty / 1000 : 1;
            const priceCents = (li.price || 0) * qty;

            // Determine L3 category from item reference → category map
            let l3 = null;
            const itemId = li.item?.id;
            if (itemId && itemCatMap[itemId]) {
              l3 = itemCatMap[itemId];
            }

            // Map L3 → L2
            let l2;
            if (l3 && L3_TO_L2[l3]) {
              l2 = L3_TO_L2[l3];
            } else if (l3) {
              // L3 exists but not in mapping — try to match by prefix
              l2 = "Uncategorized";
            } else if (li.name === "Refund" || priceCents < 0) {
              l2 = "Refund";
            } else {
              l2 = "Custom Sales";
            }

            const cat = getCat(l2);
            const grossCents = Math.abs(priceCents);

            // Sum discounts on this line item
            let discCents = 0;
            if (li.discounts?.elements) {
              for (const d of li.discounts.elements) {
                discCents += Math.abs(d.amount || 0);
              }
            }

            if (priceCents < 0) {
              // Refund line item
              cat.refunds -= grossCents / 100;
              cat.net -= grossCents / 100;
            } else {
              cat.qty += qty;
              cat.gross += grossCents / 100;
              cat.discounts -= discCents / 100;
              cat.net += (grossCents - discCents) / 100;
            }
          }
        }

        // Calculate totals and format response
        let totalQty = 0, totalGross = 0, totalDisc = 0, totalRef = 0, totalNet = 0;
        const categories = [];
        for (const [name, c] of Object.entries(cats)) {
          totalQty += c.qty;
          totalGross += c.gross;
          totalDisc += c.discounts;
          totalRef += c.refunds;
          totalNet += c.net;
          categories.push({
            category: name,
            qty: Math.round(c.qty),
            gross: Math.round(c.gross * 100) / 100,
            discounts: Math.round(c.discounts * 100) / 100,
            refunds: Math.round(c.refunds * 100) / 100,
            netSales: Math.round(c.net * 100) / 100,
            asp: c.qty > 0 ? Math.round((c.net / c.qty) * 100) / 100 : 0,
          });
        }

        // Sort by net sales descending
        categories.sort((a, b) => b.netSales - a.netSales);

        // Add pctQty
        for (const c of categories) {
          c.pctQty = totalQty > 0 ? Math.round((c.qty / totalQty) * 1000) / 10 : 0;
        }

        return new Response(JSON.stringify({
          store, date: todayStr,
          categories,
          totals: {
            qty: Math.round(totalQty),
            gross: Math.round(totalGross * 100) / 100,
            discounts: Math.round(totalDisc * 100) / 100,
            refunds: Math.round(totalRef * 100) / 100,
            netSales: Math.round(totalNet * 100) / 100,
            asp: totalQty > 0 ? Math.round((totalNet / totalQty) * 100) / 100 : 0,
          },
          orderCount: allElements.length,
        }), { headers: corsJson });
      } catch (err) {
        return new Response(JSON.stringify({ error: "Items fetch failed", detail: err.message }), {
          status: 500, headers: corsJson,
        });
      }
    }

    // ── Live data endpoint (existing): ?store=BL1&since=timestamp
    const storeKey = url.searchParams.get("store");
    if (!storeKey) {
      return new Response(JSON.stringify({ error: "Please specify a store" }), {
        status: 400, headers: corsHeaders,
      });
    }

    const targetStore = storeKey.toUpperCase();
    const merchantId = env[`${targetStore}_MERCHANT_ID`];
    const apiToken = env[`${targetStore}_API_TOKEN`];

    if (!merchantId || !apiToken) {
      return new Response(JSON.stringify({ error: "Store keys not found in Cloudflare" }), {
        status: 404, headers: corsHeaders,
      });
    }

    const since = url.searchParams.get("since");
    const startOfToday = since ? Number(since) : new Date(new Date().toISOString().slice(0, 10)).getTime();

    try {
      const elements = await fetchCloverOrders(targetStore, env, startOfToday);
      const result = JSON.stringify({ elements: elements || [] });
      const response = new Response(result, {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

      // Snapshot-on-fetch: save today's aggregated data to KV in background
      if (env.SALES_SNAPSHOTS && elements && elements.length > 0) {
        const todayStr = new Date().toISOString().slice(0, 10);
        const aggregated = aggregateOrders(elements, startOfToday);
        ctx.waitUntil(saveSnapshot(env, targetStore, todayStr, aggregated));
      }

      return response;
    } catch (error) {
      return new Response(JSON.stringify({ error: "Failed to connect to Clover" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },

  // ── Cron trigger handler (end-of-day snapshots) ───────────────
  async scheduled(event, env, ctx) {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const startOfDay = new Date(todayStr + "T00:00:00Z").getTime();

    const results = {};

    for (const store of ALL_STORES) {
      try {
        const data = await fetchAggregateAndSnapshot(store, env, startOfDay, todayStr);
        results[store] = data ? "ok" : "skipped (no credentials)";
      } catch (err) {
        results[store] = `error: ${err.message}`;
      }
    }

    console.log("Daily snapshot results:", JSON.stringify(results));
  },
};
