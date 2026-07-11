// Generic feed-forward MLP, parameterized by architecture. Same design as the
// creatures neural-net (flat Float32Array weights, row-major W, tanh
// activations) but instance-based so any consumer can pick its own layer sizes.
// Weights for layer l: W^(l) shape (n_l, n_{l-1}) row-major, then biases (n_l).

function buildLayout(arch) {
  const layers = []
  let offset = 0
  for (let l = 1; l < arch.length; l++) {
    const nIn = arch[l - 1], nOut = arch[l]
    layers.push({ nIn, nOut, wOffset: offset, bOffset: offset + nOut * nIn })
    offset += nOut * nIn + nOut
  }
  return { layers, total: offset }
}

export function makeMLP(arch) {
  const layout = buildLayout(arch)
  const act = arch.map(n => new Float32Array(n))

  function randomParams() {
    const p = new Float32Array(layout.total)
    for (const L of layout.layers) {
      const scale = 1 / Math.sqrt(L.nIn)
      const wEnd = L.wOffset + L.nOut * L.nIn
      for (let i = L.wOffset; i < wEnd; i++) p[i] = (Math.random() * 2 - 1) * scale
      for (let j = 0; j < L.nOut; j++) p[L.bOffset + j] = (Math.random() * 2 - 1) * 0.1
    }
    return p
  }

  // Mutation is architecture-independent (perturbs each parameter), matching the
  // creatures neuroevolution: Gaussian-ish via a sum of uniforms, clipped.
  function mutate(params, rate = 0.12, strength = 0.25) {
    const p = new Float32Array(params)
    for (let i = 0; i < p.length; i++) {
      if (Math.random() < rate) {
        const g = (Math.random() + Math.random() + Math.random() - 1.5) * strength
        p[i] = Math.max(-4, Math.min(4, p[i] + g))
      }
    }
    return p
  }

  // Not re-entrant (shared buffers), no allocation in the hot loop. If
  // `activationsOut` (array of arrays, one per layer incl. input) is given, it
  // receives a copy of every layer's activations — used by the network view.
  function forward(params, inputs, activationsOut) {
    act[0].set(inputs)
    for (let l = 0; l < layout.layers.length; l++) {
      const L = layout.layers[l]
      const aPrev = act[l]
      const aCur = act[l + 1]
      for (let j = 0; j < L.nOut; j++) {
        let sum = params[L.bOffset + j]
        const base = L.wOffset + j * L.nIn
        for (let i = 0; i < L.nIn; i++) sum += params[base + i] * aPrev[i]
        aCur[j] = Math.tanh(sum)
      }
    }
    if (activationsOut) for (let l = 0; l < act.length; l++) if (activationsOut[l]) activationsOut[l].set(act[l])
    return act[act.length - 1]
  }

  // Weight from input i of layer l to neuron j (for drawing edges).
  function weightAt(params, l, j, i) {
    const L = layout.layers[l]
    return params[L.wOffset + j * L.nIn + i]
  }

  // One supervised gradient step (backprop) minimizing ½‖out − target‖² for a
  // single sample; updates `params` in place and returns the squared error. Used
  // to train by imitation (e.g. cloning an LQR). tanh derivative = 1 − a².
  const delta = arch.map(n => new Float32Array(n))
  function sgdStep(params, inputs, target, lr) {
    forward(params, inputs) // fills `act`
    const nL = layout.layers.length
    const out = act[nL]
    let loss = 0
    for (let j = 0; j < out.length; j++) { const o = out[j]; delta[nL][j] = (o - target[j]) * (1 - o * o); loss += (o - target[j]) ** 2 }
    for (let k = nL - 1; k >= 0; k--) {
      const L = layout.layers[k], aPrev = act[k], d = delta[k + 1]
      if (k >= 1) { // propagate error to the previous layer BEFORE updating weights
        const dp = delta[k]
        for (let i = 0; i < L.nIn; i++) {
          let s = 0
          for (let j = 0; j < L.nOut; j++) s += params[L.wOffset + j * L.nIn + i] * d[j]
          dp[i] = s * (1 - aPrev[i] * aPrev[i])
        }
      }
      for (let j = 0; j < L.nOut; j++) {
        const base = L.wOffset + j * L.nIn, dj = d[j]
        for (let i = 0; i < L.nIn; i++) params[base + i] -= lr * dj * aPrev[i]
        params[L.bOffset + j] -= lr * dj
      }
    }
    return loss
  }

  return { arch, paramCount: layout.total, layers: layout.layers, randomParams, mutate, forward, weightAt, sgdStep }
}
