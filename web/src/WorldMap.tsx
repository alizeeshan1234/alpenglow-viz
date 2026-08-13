import { useEffect, useMemo, useRef, useState } from "react";
import land from "./land.json";
import {
  GEO_VALIDATORS,
  GEO_FETCHED_AT,
  TOTAL_GEO_STAKE,
  computeTiming,
  leaderChoices,
} from "./geo";

const W = 1000;
const H = 440;
const LAT_MAX = 75;
const LAT_MIN = -56;

const px = (lon: number) => ((lon + 180) / 360) * W;
const py = (lat: number) => ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H;

// How many of the biggest validators get animated arcs (all get dots).
const ARC_VALIDATORS = 220;

const COL = {
  bg: "#0b0e14",
  land: "#161c27",
  landEdge: "#232b3a",
  idle: "#3a4356",
  block: "#4f8cff",
  vote: "#35d07f",
  leader: "#7c5cff",
  text: "#e6e9ef",
  muted: "#8a93a6",
};

function buildLandPath(): Path2D {
  const p = new Path2D();
  for (const ring of land as [number, number][][]) {
    ring.forEach(([lon, lat], i) => {
      if (i === 0) p.moveTo(px(lon), py(lat));
      else p.lineTo(px(lon), py(lat));
    });
    p.closePath();
  }
  return p;
}

function arcPoint(
  x1: number, y1: number, x2: number, y2: number, t: number
): [number, number] {
  // Quadratic bezier with a perpendicular bulge.
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy) || 1;
  const bulge = Math.min(40, d * 0.18);
  const cx = mx - (dy / d) * bulge;
  const cy = my + (dx / d) * bulge;
  const u = 1 - t;
  return [
    u * u * x1 + 2 * u * t * cx + t * t * x2,
    u * u * y1 + 2 * u * t * cy + t * t * y2,
  ];
}

function drawArcTrail(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  progress: number, color: string
) {
  const steps = 14;
  const tail = 0.35;
  const from = Math.max(0, progress - tail);
  ctx.strokeStyle = color;
  ctx.beginPath();
  for (let s = 0; s <= steps; s++) {
    const t = from + ((progress - from) * s) / steps;
    const [x, y] = arcPoint(x1, y1, x2, y2, t);
    if (s === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const [hx, hy] = arcPoint(x1, y1, x2, y2, progress);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(hx, hy, 1.8, 0, Math.PI * 2);
  ctx.fill();
}

const fmt = (ms: number) => `${Math.round(ms)} ms`;

export default function WorldMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landPath = useMemo(buildLandPath, []);
  const choices = useMemo(leaderChoices, []);
  const [leader, setLeader] = useState(choices[0]);
  const timing = useMemo(() => computeTiming(leader), [leader]);
  const [clock, setClock] = useState(0); // virtual ms
  const [playing, setPlaying] = useState(false);
  const [slowdown, setSlowdown] = useState(30);
  const raf = useRef(0);
  const last = useRef(0);

  // precomputed screen positions
  const pos = useMemo(
    () => GEO_VALIDATORS.map((v) => [px(v.lon), py(v.lat)] as const),
    []
  );

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / slowdown;
      last.current = now;
      setClock((c) => {
        const next = c + dt;
        if (next >= timing.tEnd) {
          setPlaying(false);
          return timing.tEnd;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, slowdown, timing.tEnd]);

  // draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const t = clock;
    const { recvAt, via, voteLandsAt, relays, t60, t80 } = timing;
    const [lx, ly] = pos[leader];

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = COL.land;
    ctx.fill(landPath);
    ctx.strokeStyle = COL.landEdge;
    ctx.lineWidth = 0.7;
    ctx.stroke(landPath);

    ctx.lineWidth = 1;

    // shred arcs: leader → relay, relay → validator (top ARC_VALIDATORS only)
    for (let i = 0; i < Math.min(ARC_VALIDATORS, GEO_VALIDATORS.length); i++) {
      if (i === leader) continue;
      const arrive = recvAt[i];
      const src = via[i] === -1 ? leader : via[i];
      const start = via[i] === -1 ? 0 : recvAt[via[i]];
      if (t <= start || t >= arrive + 15) continue;
      const p = Math.min(1, (t - start) / (arrive - start || 1));
      const [sx, sy] = pos[src];
      const [dx, dy] = pos[i];
      drawArcTrail(ctx, sx, sy, dx, dy, p, "rgba(79,140,255,0.55)");
    }

    // vote arcs back to observer
    for (let i = 0; i < Math.min(ARC_VALIDATORS, GEO_VALIDATORS.length); i++) {
      if (i === leader) continue;
      const start = recvAt[i] + 1;
      const arrive = voteLandsAt[i];
      if (t <= start || t >= arrive + 15) continue;
      const p = Math.min(1, (t - start) / (arrive - start || 1));
      const [sx, sy] = pos[i];
      drawArcTrail(ctx, sx, sy, lx, ly, p, "rgba(53,208,127,0.5)");
    }

    // validator dots
    for (let i = 0; i < GEO_VALIDATORS.length; i++) {
      const v = GEO_VALIDATORS[i];
      const [x, y] = pos[i];
      const r = 1.2 + Math.sqrt(v.stake / TOTAL_GEO_STAKE) * 24;
      const received = t >= recvAt[i];
      const voted = t >= voteLandsAt[i];
      ctx.fillStyle = received ? COL.block : COL.idle;
      ctx.globalAlpha = received ? 0.95 : 0.55;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (voted) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = COL.vote;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(x, y, r + 1.6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
    ctx.globalAlpha = 1;

    // leader marker
    ctx.fillStyle = COL.leader;
    ctx.beginPath();
    ctx.arc(lx, ly, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COL.leader;
    ctx.beginPath();
    ctx.arc(lx, ly, 9 + (t % 60) / 9, 0, Math.PI * 2);
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // clock
    ctx.fillStyle = COL.text;
    ctx.font = "600 26px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.fillText(fmt(t), W - 16, 36);
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = COL.muted;
    ctx.fillText("protocol time", W - 16, 52);

    // threshold banners
    ctx.textAlign = "left";
    let by = 30;
    const banner = (text: string, color: string) => {
      ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = color;
      ctx.fillText(text, 16, by);
      by += 22;
    };
    if (t >= t60) banner(`✓ 60% of stake notarized — ${fmt(t60)}`, COL.block);
    if (t >= t80) banner(`⚡ 80% — FAST-FINALIZED — ${fmt(t80)}`, COL.vote);
    if (t >= t80)
      banner(`TowerBFT would wait ~${(12800 / 1000).toFixed(1)} s more`, COL.muted);
  }, [clock, timing, landPath, pos, leader]);

  const replay = () => {
    setClock(0);
    setPlaying(true);
  };

  return (
    <section className="worldmap">
      <div className="race-head">
        <h2>The 150 ms, on a map</h2>
        <div className="map-controls">
          <label>
            leader:{" "}
            <select
              value={leader}
              onChange={(e) => {
                setLeader(Number(e.target.value));
                setClock(0);
                setPlaying(false);
              }}
            >
              {choices.map((i) => (
                <option key={i} value={i}>
                  {GEO_VALIDATORS[i].label} ({GEO_VALIDATORS[i].city})
                </option>
              ))}
            </select>
          </label>
          <label>
            speed:{" "}
            <select
              value={slowdown}
              onChange={(e) => setSlowdown(Number(e.target.value))}
            >
              <option value={60}>1/60×</option>
              <option value={30}>1/30×</option>
              <option value={10}>1/10×</option>
            </select>
          </label>
          <button onClick={playing ? () => setPlaying(false) : replay}>
            {playing ? "⏸ Pause" : clock > 0 ? "🔁 Replay" : "▶ Play"}
          </button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="map-canvas"
      />
      <input
        className="map-scrub"
        type="range"
        min={0}
        max={Math.ceil(timing.tEnd)}
        value={Math.round(clock)}
        onChange={(e) => {
          setPlaying(false);
          setClock(Number(e.target.value));
        }}
      />

      <div className="map-stats">
        <div className="map-stat">
          <span className="k">60% notarized</span>
          <span className="v" style={{ color: COL.block }}>{fmt(timing.t60)}</span>
        </div>
        <div className="map-stat">
          <span className="k">80% fast-finalized</span>
          <span className="v" style={{ color: COL.vote }}>{fmt(timing.t80)}</span>
        </div>
        <div className="map-stat">
          <span className="k">TowerBFT (optimistic)</span>
          <span className="v" style={{ color: COL.muted }}>~12,800 ms</span>
        </div>
      </div>

      <p className="race-note">
        {GEO_VALIDATORS.length} real validators at their real locations
        (Stakewiz, {GEO_FETCHED_AT}); dot size = activated stake. Block shreds
        fan out leader → stake-weighted relays → everyone (blue); notar votes
        stream back (green). Latency = speed of light in fiber over
        great-circle routes (×1.4 routing) + hop overhead. Pick a Tokyo or
        Singapore leader and watch finality time jump — half of Solana's stake
        lives in Frankfurt, Amsterdam and London.
      </p>
    </section>
  );
}
