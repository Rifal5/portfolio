// General feed-forward neural network (multilayer perceptron).
//
// Matrix-dimension convention (see psrivasin, "Getting Matrix Dimensions Right
// in Neural Networks"): for layer l, the weight matrix W^(l) has shape
//   (n_l, n_{l-1})            // rows = neurons in this layer, cols = inputs
// and the bias vector b^(l) has shape (n_l). Forward propagation is
//   z^(l) = W^(l) · a^(l-1) + b^(l),   a^(l) = tanh(z^(l))
//
// All weights and biases are packed into one Float32Array for cache-friendly
// storage and cheap mutation. W^(l) is stored row-major, so the weight from
// input i to neuron j lives at  wOffset + j * n_{l-1} + i.

// Retina-style vision: each of the two eyes is split into BINS_PER_EYE angular
// bins; each bin reports RETINA_CHANNELS values — how much food/target, threat,
// and obstacle sits in that direction. Purely angular (distance-agnostic): a bin
// lights up by WHERE things are, not how far. One extra input = own energy.
export const BINS_PER_EYE = 8
export const RETINA_CHANNELS = 3          // 0 = target/food, 1 = threat, 2 = obstacle/wall
export const RETINA_SIZE = 2 * BINS_PER_EYE * RETINA_CHANNELS   // 2 eyes × bins × channels
export const ARCH = [RETINA_SIZE + 1, 18, 10, 3]   // retina + energy → hidden → hidden → out
export const N_IN = ARCH[0]
export const N_OUT = ARCH[ARCH.length - 1]
export const N_LAYERS = ARCH.length

const _CH = ['food', 'threat', 'wall']
const _EYE = ['L', 'R']
export const INPUT_LABELS = (() => {
  const out = []
  for (let e = 0; e < 2; e++)
    for (let b = 0; b < BINS_PER_EYE; b++)
      for (let c = 0; c < RETINA_CHANNELS; c++)
        out.push(`${_EYE[e]}${b} ${_CH[c]}`)
  out.push('Energy')
  return out
})()
export const OUTPUT_LABELS = ['Turn', 'Thrust', 'Reproduce']

// Precompute per-layer parameter offsets into the flat array.
function buildLayout(arch) {
  const layers = []
  let offset = 0
  for (let l = 1; l < arch.length; l++) {
    const nIn = arch[l - 1], nOut = arch[l]
    const wSize = nOut * nIn
    layers.push({ nIn, nOut, wOffset: offset, bOffset: offset + wSize })
    offset += wSize + nOut          // weights then biases
  }
  return { layers, total: offset }
}
export const LAYOUT = buildLayout(ARCH)
export const PARAM_COUNT = LAYOUT.total

// Xavier-style initialization: weight scale ~ 1/sqrt(fan_in), small biases.
export function randomParams() {
  const p = new Float32Array(PARAM_COUNT)
  for (const L of LAYOUT.layers) {
    const scale = 1 / Math.sqrt(L.nIn)
    const wEnd = L.wOffset + L.nOut * L.nIn
    for (let i = L.wOffset; i < wEnd; i++) p[i] = (Math.random() * 2 - 1) * scale
    for (let j = 0; j < L.nOut; j++) p[L.bOffset + j] = (Math.random() * 2 - 1) * 0.1
  }
  return p
}

// Mutate weights AND biases uniformly (Gaussian-ish via sum of uniforms).
export function mutate(params, rate = 0.12, strength = 0.25) {
  const p = new Float32Array(params)
  for (let i = 0; i < p.length; i++) {
    if (Math.random() < rate) {
      const g = (Math.random() + Math.random() + Math.random() - 1.5) * strength
      p[i] = Math.max(-4, Math.min(4, p[i] + g))
    }
  }
  return p
}

// Shared activation buffers, one per layer (input included). forward() is not
// re-entrant but avoids any allocation in the hot loop.
const _act = ARCH.map(n => new Float32Array(n))

// Run the network. `activationsOut`, if provided, is an array of Float32Arrays
// (one per layer, matching ARCH) that receives the activations for visualization.
export function forward(params, inputs, activationsOut) {
  _act[0].set(inputs)
  for (let l = 0; l < LAYOUT.layers.length; l++) {
    const L = LAYOUT.layers[l]
    const aPrev = _act[l]
    const aCur = _act[l + 1]
    for (let j = 0; j < L.nOut; j++) {
      let sum = params[L.bOffset + j]            // bias b^(l)_j
      const base = L.wOffset + j * L.nIn          // row j of W^(l)
      for (let i = 0; i < L.nIn; i++) sum += params[base + i] * aPrev[i]
      aCur[j] = Math.tanh(sum)
    }
  }
  if (activationsOut) {
    for (let l = 0; l < _act.length; l++) {
      if (activationsOut[l]) activationsOut[l].set(_act[l])
    }
  }
  return _act[_act.length - 1]
}

// Weight matrix accessor for visualization: weight from neuron i (layer l) to
// neuron j (layer l+1).
export function weightAt(params, l, j, i) {
  const L = LAYOUT.layers[l]
  return params[L.wOffset + j * L.nIn + i]
}

