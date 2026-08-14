// Proxy to the Alpenglow test cluster RPC (plain HTTP, so the HTTPS page
// can't call it directly). Forwards only the two read-only slot queries.
// The cluster is Anza's and its address rotates — override via env var on
// Vercel (Settings → Environment Variables) without redeploying code.
const CLUSTER = process.env.ALPENGLOW_RPC || "http://103.50.32.125:8899";

const BATCH = [
  { jsonrpc: "2.0", id: 1, method: "getSlot", params: [{ commitment: "processed" }] },
  { jsonrpc: "2.0", id: 2, method: "getSlot", params: [{ commitment: "finalized" }] },
];

export default async function handler(req, res) {
  try {
    const r = await fetch(CLUSTER, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BATCH),
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json();
    // Collapse all concurrent visitors into ~1 upstream request per 2 s so a
    // traffic spike doesn't hammer Anza's cluster node.
    res.setHeader("cache-control", "public, s-maxage=2, stale-while-revalidate=10");
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: "cluster unreachable" });
  }
}
