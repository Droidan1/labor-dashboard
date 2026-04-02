// ─── Constants ───────────────────────────────────────────────────
const BIN_PATTERNS = [/\bbin\b/i, /\bfill a bag\b/i, /\bglass case\b/i];
const MAX_TXN_DURATION_MS = 30 * 60 * 1000;
const ALL_STORES = ["BL1", "BL2", "BL4", "BL8", "BL12", "BL14"];

function isBinItem(name) {
  return BIN_PATTERNS.some(p => p.test(name));
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

// ─── Save a snapshot to KV ───────────────────────────────────────
async function saveSnapshot(env, store, dateStr, data) {
  const key = `sales:${store.toLowerCase()}:${dateStr}`;
  const value = JSON.stringify({
    ...data,
    snapshotTime: new Date().toISOString(),
  });
  await env.SALES_SNAPSHOTS.put(key, value);
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
