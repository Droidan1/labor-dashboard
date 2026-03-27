export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const storeKey = url.searchParams.get("store");

    if (!storeKey) {
      return new Response(JSON.stringify({ error: "Please specify a store" }), {
        status: 400, headers: corsHeaders
      });
    }

    const targetStore = storeKey.toUpperCase();
    const merchantId = env[`${targetStore}_MERCHANT_ID`];
    const apiToken   = env[`${targetStore}_API_TOKEN`];

    if (!merchantId || !apiToken) {
      return new Response(JSON.stringify({ error: "Store keys not found in Cloudflare" }), {
        status: 404, headers: corsHeaders
      });
    }

    // Filter to today's locked orders only, and expand payments for tax data
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const limit = 1000;
    let offset = 0;
    let allElements = [];

    try {
      while (true) {
        const cloverUrl = `https://api.clover.com/v3/merchants/${merchantId}/orders`
          + `?filter=createdTime>=${startOfToday}`
          + `&filter=state=locked`
          + `&expand=payments,lineItems`
          + `&limit=${limit}&offset=${offset}`;

        const cloverResponse = await fetch(cloverUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          }
        });

        const data = await cloverResponse.json();

        if (!data || !data.elements || data.elements.length === 0) {
          break;
        }

        for (let i = 0; i < data.elements.length; i++) {
          allElements.push(data.elements[i]);
        }

        if (data.elements.length < limit) {
          break;
        }
        offset = offset + limit;
      }

      const result = JSON.stringify({ elements: allElements });
      return new Response(result, {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: "Failed to connect to Clover" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
