// Sensor model — corrupts the clean measured signals the way real hardware
// would: additive Gaussian noise (electrical/quantization noise floor) and
// finite resolution (encoder quantization). Only position-like signals are
// measured (x, angles); velocities are NOT sensed directly — the observer
// estimates them, exactly as on a real rig with encoders but no tachometers.
//
// Config keys map field name -> magnitude, e.g.
//   noise:      { x: 0.002, theta: 0.004 }   // std-dev in metres / radians
//   resolution: { x: 0.001, theta: 0.00314 } // quantum (e.g. ~0.18° encoder)
// A field absent from both maps passes through untouched. All-empty = ideal.

// Box–Muller standard normal.
function gauss() {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function makeSensor({ noise = {}, resolution = {} } = {}) {
  const fields = [...new Set([...Object.keys(noise), ...Object.keys(resolution)])]
  return {
    // clean: the plant's measure() output, e.g. { x, theta }. Returns a corrupted copy.
    measure(clean) {
      const out = { ...clean }
      for (const f of fields) {
        if (out[f] === undefined) continue
        let v = out[f]
        if (noise[f] > 0) v += gauss() * noise[f]
        if (resolution[f] > 0) v = Math.round(v / resolution[f]) * resolution[f]
        out[f] = v
      }
      return out
    },
  }
}
