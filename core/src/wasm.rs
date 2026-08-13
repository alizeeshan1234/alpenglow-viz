use crate::{scenarios, sim::Simulation, types::Validator};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
struct ValidatorSpec {
    label: String,
    stake: u64,
}

/// The JavaScript-facing handle around the pure-Rust `Simulation`.
#[wasm_bindgen]
pub struct SimHandle {
    inner: Simulation,
    // True when the validator set is real (mainnet) — we then never paint a
    // real validator as the byzantine equivocator; the faulty leader stays
    // off-screen.
    real: bool,
}

#[wasm_bindgen]
impl SimHandle {
    /// `n` validators, each with equal stake (10). Clean 60% / 80% lines.
    #[wasm_bindgen(constructor)]
    pub fn new(n: usize) -> SimHandle {
        let validators = (0..n)
            .map(|i| Validator {
                id: i,
                stake: 10,
                label: format!("V{i}"),
                byzantine: false,
            })
            .collect();
        SimHandle {
            inner: Simulation::new(validators),
            real: false,
        }
    }

    /// Build a simulation from an explicit validator set:
    /// `SimHandle.withValidators([{ label, stake }, …])` — e.g. real mainnet stake.
    #[wasm_bindgen(js_name = withValidators)]
    pub fn with_validators(specs: JsValue) -> Result<SimHandle, JsValue> {
        let specs: Vec<ValidatorSpec> =
            serde_wasm_bindgen::from_value(specs).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let validators = specs
            .into_iter()
            .enumerate()
            .map(|(id, s)| Validator {
                id,
                stake: s.stake,
                label: s.label,
                byzantine: false,
            })
            .collect();
        Ok(SimHandle {
            inner: Simulation::new(validators),
            real: true,
        })
    }

    /// Load a scenario: "fast" | "slow" | "offline" | "split".
    pub fn load_preset(&mut self, name: &str) {
        // In "split" the equivocating leader is V0; mark it byzantine.
        let n = self.inner.validators().len();
        for id in 0..n {
            self.inner.set_byzantine(id, false);
        }
        if name == "split" && !self.real {
            self.inner.set_byzantine(0, true);
        }
        let (slot, votes) = scenarios::preset(name, self.inner.validators());
        self.inner.load(slot, votes);
    }

    /// Knock a validator offline / bring it back. Its future votes are dropped.
    pub fn toggle_offline(&mut self, id: usize) {
        self.inner.toggle_offline(id);
    }

    /// Advance one vote; returns the events for this tick as a JS array.
    pub fn step(&mut self) -> JsValue {
        let events = self.inner.step();
        serde_wasm_bindgen::to_value(&events).unwrap()
    }

    /// Current renderable state.
    pub fn snapshot(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.inner.snapshot()).unwrap()
    }
}
