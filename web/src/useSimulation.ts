import { useCallback, useEffect, useRef, useState } from "react";
import init, { SimHandle } from "./wasm/alpenglow_core.js";
import { loadMainnet, type MainnetSet } from "./mainnet";

export type SimEvent = any;
export type Snapshot = any;
export type Source = "demo" | "mainnet";

const NUM_DEMO_VALIDATORS = 10;

export function useSimulation() {
  const simRef = useRef<SimHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [log, setLog] = useState<SimEvent[]>([]);
  const [preset, setPreset] = useState<string>("fast");
  const [playing, setPlaying] = useState(false);
  const [source, setSource] = useState<Source>("demo");
  const [mainnet, setMainnet] = useState<MainnetSet | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await init();
      if (cancelled) return;
      const sim = new SimHandle(NUM_DEMO_VALIDATORS);
      sim.load_preset("fast");
      simRef.current = sim;
      setSnapshot(sim.snapshot());
      setReady(true);
      // Fetch real stake in the background; bundled snapshot is the fallback.
      const set = await loadMainnet();
      if (!cancelled) setMainnet(set);
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

  const switchSource = useCallback(
    (next: Source) => {
      if (next === "mainnet" && !mainnet) return;
      const sim =
        next === "mainnet"
          ? SimHandle.withValidators(mainnet!.validators)
          : new SimHandle(NUM_DEMO_VALIDATORS);
      simRef.current = sim;
      setSource(next);
      sim.load_preset(preset);
      setLog([]);
      setSnapshot(sim.snapshot());
      setPlaying(false);
    },
    [mainnet, preset]
  );

  const toggleOffline = useCallback((id: number) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.toggle_offline(id);
    setSnapshot(sim.snapshot());
  }, []);

  const setOfflineSet = useCallback((ids: number[]) => {
    const sim = simRef.current;
    if (!sim) return;
    const current: number[] = sim.snapshot().offline ?? [];
    for (const id of current) if (!ids.includes(id)) sim.toggle_offline(id);
    for (const id of ids) if (!current.includes(id)) sim.toggle_offline(id);
    setSnapshot(sim.snapshot());
  }, []);

  const step = useCallback((): boolean => {
    const sim = simRef.current;
    if (!sim) return false;
    const events: SimEvent[] = sim.step();
    setSnapshot(sim.snapshot());
    setLog((l) => [...events, ...l].slice(0, 120));
    const idle = events.some((e) => e.type === "Idle");
    return !idle;
  }, []);

  useEffect(() => {
    if (!playing) return;
    // Long mainnet vote tapes play faster so a run stays ~10-15 seconds.
    const pending = snapshot?.pending_len ?? 0;
    const interval = pending > 30 ? 110 : 550;
    const id = setInterval(() => {
      const more = step();
      if (!more) setPlaying(false);
    }, interval);
    return () => clearInterval(id);
  }, [playing, step, snapshot?.pending_len]);

  return {
    ready,
    snapshot,
    log,
    preset,
    playing,
    setPlaying,
    loadPreset,
    step,
    toggleOffline,
    setOfflineSet,
    source,
    switchSource,
    mainnet,
  };
}
