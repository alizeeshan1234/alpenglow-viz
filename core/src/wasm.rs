use crate::{scenarios, sim::Simulation, types::Validator};
use wasm_bindgen::prelude::*;

/// The JavaScript-facing handle around the pure-Rust `Simulation`.
#[wasm_bindgen]
pub struct SimHandle {
    inner: Simulation,
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
        }
    }

    /// Load a scenario: "fast" | "slow" | "offline".
    pub fn load_preset(&mut self, name: &str) {
        let (slot, votes) = scenarios::preset(name, self.inner.validators());
        self.inner.load(slot, votes);
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
