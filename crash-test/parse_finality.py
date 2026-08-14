#!/usr/bin/env python3
"""Parse `FINALITY_RESULT ...` lines from harness output into structured JSON.

Usage: python3 parse_finality.py <log> [more.log ...] > finality_sweep.json
Each line looks like:
  FINALITY_RESULT consensus=alpenglow nodes=5 offline=1 pct=20.0 ticks_per_slot=8 \
    window_secs=30 n=412 outcome=FINALIZED p50_ms=61.2 p90_ms=98.0 min_ms=12.1 \
    max_ms=210.4 depth_p50=1 depth_p90=2
"""
import datetime
import json
import os
import subprocess
import sys
from pathlib import Path

TICK_MS = 6.25  # PohConfig default target tick duration


def parse_line(line: str) -> dict:
    kv = {}
    for tok in line.split("FINALITY_RESULT", 1)[1].split():
        if "=" in tok:
            k, v = tok.split("=", 1)
            kv[k] = v
    ticks = int(kv["ticks_per_slot"])
    out = {
        "consensus": kv["consensus"],
        "num_nodes": int(kv["nodes"]),
        "num_offline": int(kv["offline"]),
        "pct_offline": float(kv["pct"]),
        "ticks_per_slot": ticks,
        "slot_ms": round(ticks * TICK_MS, 1),
        "window_secs": int(kv["window_secs"]),
        "samples": int(kv["n"]),
        "outcome": kv["outcome"],
        "p50_ms": float(kv["p50_ms"]),
        "p90_ms": float(kv["p90_ms"]),
        "min_ms": float(kv["min_ms"]),
        "max_ms": float(kv["max_ms"]),
        "depth_p50_slots": int(kv["depth_p50"]),
        "depth_p90_slots": int(kv["depth_p90"]),
    }
    # Slot-denominated finality (cadence-independent, colocation-immune).
    if out["samples"] and out["slot_ms"]:
        out["p50_slots"] = round(out["p50_ms"] / out["slot_ms"], 2)
    return out


def agave_sha() -> str:
    try:
        agave_dir = os.environ.get("AGAVE_DIR", str(Path.home() / "Desktop" / "agave"))
        return subprocess.check_output(
            ["git", "-C", agave_dir, "rev-parse", "--short", "HEAD"], text=True
        ).strip()
    except Exception:
        return "unknown"


def main():
    runs = []
    for path in sys.argv[1:]:
        with open(path, errors="ignore") as f:
            for line in f:
                if "FINALITY_RESULT" in line:
                    try:
                        runs.append(parse_line(line))
                    except Exception as e:
                        print(f"skip: {e}", file=sys.stderr)
    runs.sort(
        key=lambda r: (
            0 if r["consensus"] == "alpenglow" else 1,
            r["num_nodes"],
            r["num_offline"],
        )
    )
    doc = {
        "scenario": "finality_latency_sweep",
        "generated_at": datetime.date.today().isoformat(),
        "agave_commit": agave_sha(),
        "machine": "Apple M3 Pro, 11 cores, 18GB (local cluster, colocated)",
        "note": (
            "Millisecond numbers are only comparable within one consensus mode at "
            "one cadence (the Alpenglow offline sweep). Cross-consensus comparison "
            "uses slot depth only: Tower runs 64-tick (400 ms) slots, Alpenglow "
            "8-tick (50 ms) test slots. Colocated single-machine cluster — "
            "absolute times are not representative of a real network."
        ),
        "runs": runs,
    }
    print(json.dumps(doc, indent=2))


if __name__ == "__main__":
    main()
