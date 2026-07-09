// Neural policy definitions, per plant, shared by training, the worker, the
// runtime controller, and the network visualization so they all agree on the
// network shape and input encoding.
//
// Angles are fed as sin/cos pairs (no ±π wrap discontinuity). Output is one
// tanh in [-1,1], scaled to the motor force. `labels` name the inputs for the
// live network view.

export const NEURAL = {
  single: {
    arch: [5, 12, 8, 1],
    W: 8, V: 4,
    labels: ['sinθ', 'cosθ', 'θ̇', 'x', 'ẋ'],
    inputs: (plant, s) => [
      Math.sin(s.theta), Math.cos(s.theta),
      s.thetadot / 8, s.x / plant.PARAMS.trackHalfWidth, s.xdot / 4,
    ],
  },
  double: {
    arch: [8, 16, 12, 1],
    W: 8, V: 4,
    labels: ['sinθ₁', 'cosθ₁', 'sinθ₂', 'cosθ₂', 'θ̇₁', 'θ̇₂', 'x', 'ẋ'],
    inputs: (plant, s) => [
      Math.sin(s.theta1), Math.cos(s.theta1), Math.sin(s.theta2), Math.cos(s.theta2),
      s.theta1dot / 8, s.theta2dot / 8, s.x / plant.PARAMS.trackHalfWidth, s.xdot / 4,
    ],
  },
}

export function neuralConfig(plant) { return NEURAL[plant.meta.name] }

// Compute the force AND expose activations (for the viz) via the optional out.
export function policyForce(mlp, weights, plant, s, activationsOut) {
  const cfg = NEURAL[plant.meta.name]
  const out = mlp.forward(weights, cfg.inputs(plant, s), activationsOut)
  return out[0] * plant.PARAMS.forceMax
}
