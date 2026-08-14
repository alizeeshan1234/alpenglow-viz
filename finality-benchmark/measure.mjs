#!/usr/bin/env node
// Wall-clock finality benchmark: Solana mainnet (TowerBFT) vs the Alpenglow
// community cluster (Anza-coordinated, volunteer-run, SIMD-0326 active) — measured simultaneously, identical methodology.
//
// Method: on one websocket per cluster, timestamp each slot when it is first
// announced (slotSubscribe) and again when it is rooted/finalized
// (rootSubscribe). Both events ride the same connection, so the one-way
// network delay cancels — the delta is protocol finality with ms precision,
// measurable from anywhere on earth.
//
// Also runs an end-to-end test on the Alpenglow cluster: requestAirdrop (a
// real transaction) → signatureSubscribe(finalized), i.e. user-perceived
// submit→finalized time, which includes one full internet RTT.
//
// Usage: node measure.mjs [seconds]   (default 150)

import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DURATION_S = Number(process.argv[2] ?? 150);

const CLUSTERS = [
  {
    name: "alpenglow",
    label: "Alpenglow community cluster (SIMD-0326, Agave 4.3.0)",
    ws: "ws://103.50.32.125:8900",
    http: "http://103.50.32.125:8899",
  },
  {
    name: "mainnet",
    label: "Solana mainnet-beta (TowerBFT)",
    ws: "wss://api.mainnet-beta.solana.com/",
    http: "https://api.mainnet-beta.solana.com",
  },
];

// ---------------------------------------------------------------- utilities

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

function freshPubkey() {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  return base58(new Uint8Array(der.subarray(der.length - 32)));
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function summarize(ms) {
  const s = [...ms].sort((a, b) => a - b);
  return {
    samples: s.length,
    min: s[0] ?? null,
    p50: pct(s, 50),
    p90: pct(s, 90),
    p99: pct(s, 99),
    max: s[s.length - 1] ?? null,
  };
}

async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

/** Median HTTP round-trip of a trivial call — our distance to the node. */
async function measureRtt(url, n = 7) {
  const rtts = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await rpc(url, "getHealth").catch(() => {});
    rtts.push(performance.now() - t);
  }
  rtts.sort((a, b) => a - b);
  return rtts[Math.floor(rtts.length / 2)];
}

// ------------------------------------------------- finality via websocket

function measureFinality(cluster, durationMs) {
  return new Promise((resolve) => {
    const seen = new Map(); // slot -> perf timestamp when first announced
    const samples = []; // { slot, ms }
    let ws;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      try { ws?.close(); } catch {}
      resolve(samples);
    };

    const connect = () => {
      if (done) return;
      ws = new WebSocket(cluster.ws);
      ws.onopen = () => {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "slotSubscribe" }));
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "rootSubscribe" }));
      };
      ws.onmessage = (ev) => {
        const now = performance.now();
        const m = JSON.parse(ev.data);
        if (m.method === "slotNotification") {
          const slot = m.params.result.slot;
          if (!seen.has(slot)) seen.set(slot, now);
          // Mainnet roots trail announcements by ~32 slots; keep a deep buffer.
          if (seen.size > 512) seen.delete(Math.min(...seen.keys()));
        } else if (m.method === "rootNotification") {
          const root = m.params.result;
          const t0 = seen.get(root);
          if (t0 !== undefined) {
            samples.push({ slot: root, ms: now - t0 });
            seen.delete(root);
          }
        }
      };
      ws.onerror = ws.onclose = () => {
        if (!done) setTimeout(connect, 1000);
      };
    };

    connect();
    setTimeout(finish, durationMs);
  });
}

// ------------------------------------------- end-to-end tx on Alpenglow

/** requestAirdrop → signatureSubscribe(finalized); returns ms or null. */
function airdropE2e(cluster, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(cluster.ws);
    let settle = (v) => {
      settle = () => {};
      try { ws.close(); } catch {}
      resolve(v);
    };
    setTimeout(() => settle(null), timeoutMs);

    ws.onerror = () => settle(null);
    ws.onopen = async () => {
      const pubkey = freshPubkey();
      const t0 = performance.now();
      let sig;
      try {
        sig = await rpc(cluster.http, "requestAirdrop", [pubkey, 1_000_000]);
      } catch (e) {
        console.error("  airdrop failed:", e.message);
        settle(null);
        return;
      }
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "signatureSubscribe",
          params: [sig, { commitment: "finalized" }],
        })
      );
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.method === "signatureNotification") {
          settle({ sig, ms: performance.now() - t0 });
        }
      };
    };
  });
}

// -------------------------------------------------------------------- main

const [alpen, mainnet] = CLUSTERS;

console.log(`Finality benchmark — ${DURATION_S}s simultaneous capture`);
console.log(`  ${alpen.label}`);
console.log(`  ${mainnet.label}\n`);

const [alpenRtt, mainnetRtt] = await Promise.all([
  measureRtt(alpen.http),
  measureRtt(mainnet.http),
]);
console.log(`RTT to alpenglow node: ${alpenRtt.toFixed(0)} ms`);
console.log(`RTT to mainnet RPC:    ${mainnetRtt.toFixed(0)} ms\n`);

console.log("Capturing slot→root wall-clock deltas on both clusters…");
const finalityPromise = Promise.all([
  measureFinality(alpen, DURATION_S * 1000),
  measureFinality(mainnet, DURATION_S * 1000),
]);

// While the passive capture runs, fire end-to-end transactions at Alpenglow.
await new Promise((r) => setTimeout(r, 5000));
const e2e = [];
for (let i = 0; i < 5; i++) {
  const r = await airdropE2e(alpen);
  if (r) {
    console.log(`  e2e tx ${i + 1}: submit→finalized ${r.ms.toFixed(0)} ms (${r.sig.slice(0, 12)}…)`);
    e2e.push(r);
  }
  await new Promise((res) => setTimeout(res, 1500));
}

const [alpenSamples, mainnetSamples] = await finalityPromise;

const result = {
  measured_at: new Date().toISOString(),
  duration_s: DURATION_S,
  method:
    "slotSubscribe→rootSubscribe wall-clock delta on a single websocket per cluster (one-way delay cancels); e2e = requestAirdrop→signatureSubscribe(finalized), includes 1 RTT",
  rtt_ms: { alpenglow: alpenRtt, mainnet: mainnetRtt },
  alpenglow: {
    ...alpen,
    finality_ms: summarize(alpenSamples.map((s) => s.ms)),
    e2e_tx_ms: summarize(e2e.map((s) => s.ms)),
    samples: alpenSamples,
  },
  mainnet: {
    ...mainnet,
    finality_ms: summarize(mainnetSamples.map((s) => s.ms)),
    samples: mainnetSamples,
  },
};

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, "results"), { recursive: true });
const out = join(here, "results", "finality_benchmark.json");
writeFileSync(out, JSON.stringify(result, null, 2));

const fmt = (v) => (v === null ? "—" : `${v.toFixed(0)} ms`);
const row = (name, s) =>
  console.log(
    `  ${name.padEnd(34)} n=${String(s.samples).padStart(3)}  p50=${fmt(s.p50).padStart(9)}  p90=${fmt(s.p90).padStart(9)}  p99=${fmt(s.p99).padStart(9)}`
  );

console.log("\n================ RESULTS ================");
row("Alpenglow finality (slot→root)", result.alpenglow.finality_ms);
row("Mainnet finality (slot→root)", result.mainnet.finality_ms);
if (e2e.length) row("Alpenglow e2e tx (incl. RTT)", result.alpenglow.e2e_tx_ms);
const speedup =
  result.mainnet.finality_ms.p50 && result.alpenglow.finality_ms.p50
    ? result.mainnet.finality_ms.p50 / result.alpenglow.finality_ms.p50
    : null;
if (speedup) console.log(`\n  Measured speedup: ${speedup.toFixed(0)}×`);
console.log(`\nFull data: ${out}`);
