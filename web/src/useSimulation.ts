import { useCallback, useEffect, useRef, useState } from "react";
import init, { SimHandle } from "./wasm/alpenglow_core.js";

export type SimEvent = any;
export type Snapshot = any;

const NUM_VALIDATORS = 10;

export function useSimulation() {
  const simRef = useRef<SimHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [log, setLog] = useState<SimEvent[]>([]);
  const [preset, setPreset] = useState<string>("fast");
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await init();
      if (cancelled) return;
      const sim = new SimHandle(NUM_VALIDATORS);
      sim.load_preset("fast");
      simRef.current = sim;
      setSnapshot(sim.snapshot());
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPreset = useCallback((name: string) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.load_preset(name);
    setPreset(name);
    setLog([]);
    setSnapshot(sim.snapshot());
    setPlaying(false);
  }, []);

  const step = useCallback((): boolean => {
    const sim = simRef.current;
    if (!sim) return false;
    const events: SimEvent[] = sim.step();
    setSnapshot(sim.snapshot());
    setLog((l) => [...events, ...l].slice(0, 80));
    const idle = events.some((e) => e.type === "Idle");
    return !idle;
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const more = step();
      if (!more) setPlaying(false);
    }, 550);
    return () => clearInterval(id);
  }, [playing, step]);

  return { ready, snapshot, log, preset, playing, setPlaying, loadPreset, step };
}
