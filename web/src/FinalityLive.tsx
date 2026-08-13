import { useEffect, useRef, useState } from "react";

const RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];
const POLL_MS = 4000;
const SLOT_MS = 400; // nominal mainnet slot time
const MAX_SAMPLES = 400;
const TOWER_MS = 12800;
const ALPENGLOW_MS = 150;
// Sustained sub-2s finality = the switch has flipped.
const LIVE_THRESHOLD_MS = 2000;

const WS_RPCS = [
  "wss://api.mainnet-beta.solana.com/",
  "wss://solana-rpc.publicnode.com",
];

interface Sample {
  at: number; // wall clock
  ms: number; // time-to-finality
  measured: boolean; // true = wall-clock via websocket, false = slot-gap estimate
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function fetchFinalityGap(rpcIdx: number): Promise<number> {
  const res = await fetch(RPCS[rpcIdx], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "getSlot", params: [{ commitment: "processed" }] },
      { jsonrpc: "2.0", id: 2, method: "getSlot", params: [{ commitment: "finalized" }] },
    ]),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const arr = await res.json();
  const byId: Record<number, number> = {};
  for (const r of arr) byId[r.id] = r.result;
  const gap = byId[1] - byId[2];
  if (!Number.isFinite(gap) || gap < 0) throw new Error("bad slots");
  return Math.max(gap, 0) * SLOT_MS;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export default function FinalityLive() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [error, setError] = useState(false);
  const [wsLive, setWsLive] = useState(false);
  const rpcIdx = useRef(0);
  const wsOk = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Primary: wall-clock measurement over websocket. We timestamp each slot the
  // moment it is first announced (slotSubscribe) and again when it becomes
  // rooted (rootSubscribe); the delta is real measured time-to-finality with
  // millisecond resolution — the slot-gap estimate can't resolve below 400 ms.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let wsIdx = 0;
    const seen = new Map<number, number>();

    const connect = () => {
      if (closed || wsIdx >= WS_RPCS.length) return;
      try {
        ws = new WebSocket(WS_RPCS[wsIdx]);
      } catch {
        wsIdx++;
        connect();
        return;
      }
      ws.onopen = () => {
        ws!.send(
          JSON.stringify({ jsonrpc: "2.0", id: 1, method: "slotSubscribe" })
        );
        ws!.send(
          JSON.stringify({ jsonrpc: "2.0", id: 2, method: "rootSubscribe" })
        );
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        const now = performance.now();
        if (msg.method === "slotNotification") {
          const slot = msg.params.result.slot;
          if (!seen.has(slot)) seen.set(slot, now);
          if (seen.size > 400) {
            const oldest = Math.min(...seen.keys());
            seen.delete(oldest);
          }
        } else if (msg.method === "rootNotification") {
          const root: number = msg.params.result;
          const t0 = seen.get(root);
          if (t0 !== undefined) {
            const ms = now - t0;
            wsOk.current = true;
            setWsLive(true);
            setError(false);
            setSamples((s) =>
              [...s, { at: Date.now(), ms, measured: true }].slice(-MAX_SAMPLES)
            );
            seen.delete(root);
          }
        }
      };
      ws.onerror = ws.onclose = () => {
        if (closed) return;
        wsOk.current = false;
        setWsLive(false);
        wsIdx++;
        setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, []);

  // Fallback: slot-gap estimate over HTTP when the websocket isn't delivering.
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      if (wsOk.current) return;
      for (let tries = 0; tries < RPCS.length; tries++) {
        try {
          const ms = await fetchFinalityGap(rpcIdx.current);
          if (stop || wsOk.current) return;
          setSamples((s) =>
            [...s, { at: Date.now(), ms, measured: false }].slice(-MAX_SAMPLES)
          );
          setError(false);
          return;
        } catch {
          rpcIdx.current = (rpcIdx.current + 1) % RPCS.length;
        }
      }
      if (!stop) setError(true);
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const latest = samples.length ? samples[samples.length - 1].ms : null;
  const recent = samples.slice(-5);
  const alpenglowLive =
    recent.length >= 3 && recent.every((s) => s.ms < LIVE_THRESHOLD_MS);
  const measuredMedian = median(
    samples.filter((s) => s.measured).slice(-40).map((s) => s.ms)
  );

  // sparkline (log scale)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const lo = Math.log10(100); // 100 ms floor
    const hi = Math.log10(30000); // 30 s ceiling
    const y = (ms: number) =>
      H - ((Math.log10(Math.max(ms, 100)) - lo) / (hi - lo)) * H;

    // reference lines
    const ref = (ms: number, color: string, label: string) => {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.4;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y(ms));
      ctx.lineTo(W, y(ms));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = color;
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(label, 4, y(ms) - 3);
      ctx.globalAlpha = 1;
    };
    ref(TOWER_MS, "#f2b134", "TowerBFT ~12.8 s");
    ref(ALPENGLOW_MS, "#35d07f", "Alpenglow ~150 ms");

    if (samples.length > 1) {
      ctx.strokeStyle = "#4f8cff";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      samples.forEach((s, i) => {
        const x = (i / (MAX_SAMPLES - 1)) * W;
        if (i === 0) ctx.moveTo(x, y(s.ms));
        else ctx.lineTo(x, y(s.ms));
      });
      ctx.stroke();
    }
  }, [samples]);

  return (
    <section className={`finality-live ${alpenglowLive ? "live" : ""}`}>
      <div className="fl-left">
        <div className="fl-label">Solana mainnet time-to-finality · live</div>
        <div className="fl-number">
          {error && latest === null
            ? "—"
            : latest === null
            ? "…"
            : latest <= SLOT_MS
            ? `< ${SLOT_MS} ms`
            : fmtMs(latest)}
        </div>
        <div className="fl-status">
          {error && latest === null
            ? "public RPC unreachable — retrying"
            : alpenglowLive
            ? "⚡ ALPENGLOW IS LIVE — finality collapsed ~100×"
            : "⏳ TowerBFT era — Alpenglow activation window: Aug–Oct 2026"}
        </div>
        {measuredMedian > 0 && (
          <div className="fl-bench">
            measured median: <b>{fmtMs(measuredMedian)}</b>
            {alpenglowLive && (
              <>
                {" "}
                · claimed: <b>100–150 ms</b>
              </>
            )}
          </div>
        )}
      </div>
      <div className="fl-right">
        <canvas ref={canvasRef} width={420} height={90} className="fl-chart" />
        <div className="fl-note">
          {wsLive
            ? "measured wall-clock: slot first announced → slot rooted (slotSubscribe/rootSubscribe over websocket)"
            : "slot-gap estimate (finalized vs processed × 400 ms, polled every 4 s)"}{" "}
          — watch this number fall off a cliff the moment Alpenglow activates
        </div>
      </div>
    </section>
  );
}
