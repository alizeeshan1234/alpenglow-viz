#!/usr/bin/env node
// Renders results/finality_benchmark.json into a shareable PNG (via headless
// Chrome) — every measured sample as a dot on a log time axis.
// Usage: node render_chart.mjs [path-to-chrome-headless]

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const r = JSON.parse(readFileSync(join(here, "results", "finality_benchmark.json"), "utf8"));
let consensusP50 = null;
try {
  const d = JSON.parse(readFileSync(join(here, "results", "finality_decomposition.json"), "utf8"));
  consensusP50 = d.stages["frozen->root"]?.p50 ?? null;
} catch {}

const alpen = r.alpenglow.samples.map((s) => Math.round(s.ms));
const main = r.mainnet.samples.map((s) => Math.round(s.ms));
const p50a = r.alpenglow.finality_ms.p50;
const p50m = r.mainnet.finality_ms.p50;
const speedup = Math.round(p50m / p50a);
const date = r.measured_at.slice(0, 10);

const W = 1200, H = 675;
const PLOT = { x: 70, w: W - 70 - 56, yA: 353, yM: 476, rowH: 66 };
const LOG_LO = Math.log10(60), LOG_HI = Math.log10(20000);
const X = (ms) => PLOT.x + ((Math.log10(Math.max(ms, 60)) - LOG_LO) / (LOG_HI - LOG_LO)) * PLOT.w;

// deterministic jitter so the render is reproducible
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const dots = (samples, cy, color) =>
  samples
    .map((ms) => {
      const y = cy + (rand() - 0.5) * PLOT.rowH;
      return `<circle cx="${X(ms).toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}" fill-opacity="0.5"/>`;
    })
    .join("");

const gridAt = [100, 1000, 10000];
const gridLbl = { 100: "100 ms", 1000: "1 s", 10000: "10 s" };
const minor = [200, 500, 2000, 5000];

const fmtP50 = (v) => (v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${W}px; height:${H}px; overflow:hidden; }
  body { background:#10131a; font-family:-apple-system,"Inter","Helvetica Neue",Arial,sans-serif; color:#f2f4f8; }
  .wrap { padding:44px 56px 0; }
  .title { font-size:31px; font-weight:800; letter-spacing:-0.01em; }
  .sub { font-size:16.5px; color:#9aa3b5; margin-top:9px; line-height:1.45; }
  .hero { display:flex; gap:40px; margin-top:26px; align-items:flex-end; }
  .stat .v { font-size:50px; font-weight:800; font-variant-numeric:tabular-nums; letter-spacing:-0.02em; }
  .stat .k { font-size:14.5px; color:#9aa3b5; margin-top:2px; display:flex; align-items:center; gap:7px; }
  .chip { width:11px; height:11px; border-radius:3px; display:inline-block; }
  .foot { position:absolute; left:56px; right:56px; bottom:22px; display:flex; justify-content:space-between; font-size:14px; color:#78829a; }
  .foot code { font-family:ui-monospace,Menlo,monospace; color:#9aa3b5; }
</style></head><body>
<div class="wrap">
  <div class="title">Time to finality, measured live — every dot is a real slot</div>
  <div class="sub">Solana mainnet (TowerBFT) vs Anza's public Alpenglow cluster (SIMD-0326, Agave 4.3.0) ·
    measured simultaneously over ${r.duration_s}s on ${date} · wall-clock slot-announced → slot-finalized</div>
  <div class="hero">
    <div class="stat"><div class="v" style="color:#2fc08a">${fmtP50(p50a)}</div>
      <div class="k"><span class="chip" style="background:#199e70"></span>Alpenglow · median of ${alpen.length} slots</div></div>
    <div class="stat"><div class="v" style="color:#e0a13a">${fmtP50(p50m)}</div>
      <div class="k"><span class="chip" style="background:#c98500"></span>Mainnet today · median of ${main.length} slots</div></div>
    ${consensusP50 !== null ? `<div class="stat"><div class="v" style="color:#2fc08a">${Math.round(consensusP50)} ms</div>
      <div class="k">consensus alone (block frozen → finalized)</div></div>` : ""}
    <div class="stat"><div class="v" style="color:#f2f4f8">${speedup}×</div>
      <div class="k">measured, not claimed</div></div>
  </div>
</div>
<svg width="${W}" height="${H}" style="position:absolute;inset:0;pointer-events:none" font-family="-apple-system,Inter,Arial,sans-serif">
  ${gridAt.map((g) => `
    <line x1="${X(g)}" y1="300" x2="${X(g)}" y2="560" stroke="#2a3140" stroke-width="1"/>
    <text x="${X(g)}" y="582" fill="#78829a" font-size="14" text-anchor="middle">${gridLbl[g]}</text>`).join("")}
  ${minor.map((g) => `<line x1="${X(g)}" y1="300" x2="${X(g)}" y2="560" stroke="#1c2230" stroke-width="1"/>`).join("")}
  <text x="${PLOT.x}" y="582" fill="#78829a" font-size="14" text-anchor="middle">&lt;60 ms</text>

  <text x="${PLOT.x}" y="316" fill="#c7cddb" font-size="16" font-weight="650">Alpenglow test cluster</text>
  ${dots(alpen, PLOT.yA, "#199e70")}
  <line x1="${X(p50a)}" y1="${PLOT.yA - 42}" x2="${X(p50a)}" y2="${PLOT.yA + 42}" stroke="#2fc08a" stroke-width="3"/>
  <text x="${X(p50a) + 10}" y="${PLOT.yA - 30}" fill="#f2f4f8" font-size="15" font-weight="700">p50 ${fmtP50(p50a)}</text>

  <text x="${PLOT.x}" y="${PLOT.yM - 46}" fill="#c7cddb" font-size="16" font-weight="650">Solana mainnet (TowerBFT)</text>
  ${dots(main, PLOT.yM, "#c98500")}
  <line x1="${X(p50m)}" y1="${PLOT.yM - 42}" x2="${X(p50m)}" y2="${PLOT.yM + 42}" stroke="#e0a13a" stroke-width="3"/>
  <text x="${X(p50m) - 10}" y="${PLOT.yM - 30}" fill="#f2f4f8" font-size="15" font-weight="700" text-anchor="end">p50 ${fmtP50(p50m)}</text>
</svg>
<div class="foot">
  <span>method: same websocket, delta of two events — network delay cancels · <code>node measure.mjs</code> to reproduce</span>
  <span style="color:#8fa7d9;font-weight:600">alpenglow-viz.vercel.app</span>
</div>
</body></html>`;

const htmlPath = join(here, "results", "finality_chart.html");
writeFileSync(htmlPath, html);

const chrome =
  process.argv[2] ??
  `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-149.0.7827.22/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const png = join(here, "results", "finality_chart.png");
execFileSync(chrome, [
  "--headless", "--disable-gpu", "--hide-scrollbars",
  "--force-device-scale-factor=2", `--window-size=${W},${H}`,
  `--screenshot=${png}`, `file://${htmlPath}`,
]);
console.log("wrote", png);
