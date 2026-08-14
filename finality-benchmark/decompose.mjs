#!/usr/bin/env node
// Decomposes Alpenglow finality on the community cluster into its stages using
// slotsUpdatesSubscribe: firstShredReceived (block starts arriving) →
// completed (block fully received) → frozen (replayed) → root (finalized).
// The frozen→root delta is the pure consensus path: votes + certificate.
//
// Usage: node decompose.mjs [seconds]   (default 120)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DURATION_S = Number(process.argv[2] ?? 120);
const WS_URL = "ws://103.50.32.125:8900";

const slots = new Map(); // slot -> { stage: perf timestamp }
const done = [];

const ws = new WebSocket(WS_URL);
ws.onopen = () => {
  ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "slotsUpdatesSubscribe" }));
  ws.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "rootSubscribe" }));
};
ws.onerror = () => {
  console.error("websocket error — cluster unreachable?");
  process.exit(1);
};
ws.onmessage = (ev) => {
  const now = performance.now();
  const m = JSON.parse(ev.data);
  if (m.method === "slotsUpdatesNotification") {
    const { slot, type } = m.params.result;
    if (!slots.has(slot)) slots.set(slot, {});
    const rec = slots.get(slot);
    if (!(type in rec)) rec[type] = now; // first occurrence only
  } else if (m.method === "rootNotification") {
    const root = m.params.result;
    const rec = slots.get(root);
    if (rec && rec.firstShredReceived !== undefined) {
      done.push({ slot: root, rootAt: now, ...rec });
      slots.delete(root);
    }
  }
};

const pct = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null;

setTimeout(() => {
  const delta = (from, to) =>
    done
      .filter((d) => d[from] !== undefined && d[to] !== undefined)
      .map((d) => d[to] - d[from])
      .sort((a, b) => a - b);

  const stages = [
    ["firstShredReceived", "completed", "block streamed by leader (propagation, not consensus)"],
    ["completed", "frozen", "replay"],
    ["frozen", "rootAt", "CONSENSUS: votes -> finalization certificate"],
    ["firstShredReceived", "rootAt", "end-to-end: first shred -> finalized"],
  ];

  const summary = {};
  console.log(`\n${done.length} slots decomposed over ${DURATION_S}s\n`);
  for (const [a, b, label] of stages) {
    const d = delta(a, b);
    const s = { n: d.length, min: d[0], p50: pct(d, 50), p90: pct(d, 90), max: d[d.length - 1] };
    summary[`${a}->${b === "rootAt" ? "root" : b}`] = s;
    console.log(
      `${label}\n  p50=${s.p50?.toFixed(0)}ms  p90=${s.p90?.toFixed(0)}ms  min=${s.min?.toFixed(0)}ms  n=${s.n}\n`
    );
  }

  const here = dirname(fileURLToPath(import.meta.url));
  mkdirSync(join(here, "results"), { recursive: true });
  const out = join(here, "results", "finality_decomposition.json");
  writeFileSync(
    out,
    JSON.stringify(
      { measured_at: new Date().toISOString(), duration_s: DURATION_S, ws: WS_URL, stages: summary, slots: done },
      null,
      2
    )
  );
  console.log("Full data:", out);
  process.exit(0);
}, DURATION_S * 1000);
