#!/usr/bin/env bash
# Alpenglow Crash Test — one-command reproduction.
#
# Boots real Agave Alpenglow LocalClusters, injects offline-stake faults, and
# writes measured finalize/stall results to results/offline_sweep.json.
#
# Prereqs: an agave checkout (Alpenglow-capable, >= 4.3), Rust per its
# rust-toolchain.toml, and Xcode command line tools on macOS.
set -euo pipefail

AGAVE_DIR="${AGAVE_DIR:-$HOME/Desktop/agave}"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$OUT_DIR/logs"
mkdir -p "$LOG_DIR" "$OUT_DIR/results"

# macOS: RocksDB's bindgen build needs libclang at build+run time.
if [[ "$(uname)" == "Darwin" ]]; then
  CLANG_LIB="/Library/Developer/CommandLineTools/usr/lib"
  export LIBCLANG_PATH="${LIBCLANG_PATH:-$CLANG_LIB}"
  export DYLD_FALLBACK_LIBRARY_PATH="${DYLD_FALLBACK_LIBRARY_PATH:-$CLANG_LIB}"
fi

# The crash_test harness must be present in the agave checkout.
HARNESS="$AGAVE_DIR/local-cluster/tests/crash_test.rs"
if [[ ! -f "$HARNESS" ]]; then
  echo "Installing crash_test harness into $AGAVE_DIR ..."
  cp "$OUT_DIR/crash_test.rs" "$HARNESS"
fi

SCENARIOS=(
  crash_4node_0offline
  crash_4node_1offline
  crash_4node_2offline
  crash_4node_3offline
)

cd "$AGAVE_DIR"
for s in "${SCENARIOS[@]}"; do
  echo "=== running $s ==="
  cargo test -p solana-local-cluster --test crash_test "$s" \
    -- --exact --nocapture --test-threads=1 2>&1 | tee "$LOG_DIR/$s.log" || true
done

python3 "$OUT_DIR/parse_results.py" "$LOG_DIR"/*.log > "$OUT_DIR/results/offline_sweep.json"
echo "=== wrote $OUT_DIR/results/offline_sweep.json ==="
cat "$OUT_DIR/results/offline_sweep.json"
