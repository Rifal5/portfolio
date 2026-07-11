// Neural policy definitions, per plant. The double is GOAL-CONDITIONED: the
// desired equilibrium is fed to the network as two extra inputs (±1 per link:
// +1 = that link up, -1 = down), so ONE network handles all four targets. e.g.
// target [1, -1] = lower link up, upper link down.
//
// Angles enter as sin/cos pairs (no ±π wrap). Output is one tanh → motor force.

export const NEURAL = {
  single: {
    arch: [5, 12, 8, 1], goalConditioned: false, W: 8, V: 4,
    labels: ['sinθ', 'cosθ', 'θ̇', 'x', 'ẋ'],
    inputs: (plant, s) => [
      Math.sin(s.theta), Math.cos(s.theta),
      s.thetadot / 8, s.x / plant.PARAMS.trackHalfWidth, s.xdot / 4,
    ],
  },
  double: {
    arch: [10, 22, 14, 1], goalConditioned: true, W: 8, V: 4,
    labels: ['sinθ₁', 'cosθ₁', 'sinθ₂', 'cosθ₂', 'θ̇₁', 'θ̇₂', 'x', 'ẋ', 'tgt₁', 'tgt₂'],
    inputs: (plant, s, target) => [
      Math.sin(s.theta1), Math.cos(s.theta1), Math.sin(s.theta2), Math.cos(s.theta2),
      s.theta1dot / 8, s.theta2dot / 8, s.x / plant.PARAMS.trackHalfWidth, s.xdot / 4,
      target[0], target[1],
    ],
  },
}

export function neuralConfig(plant) { return NEURAL[plant.meta.name] }

// Encode an equilibrium as the network's target input (±1 per link). Empty for
// non-goal-conditioned plants.
export function targetVec(plant, eqIndex) {
  if (plant.meta.name !== 'double') return []
  const e = plant.meta.equilibria[eqIndex].x
  return [Math.cos(e[1]), Math.cos(e[2])] // cos(0)=+1 up, cos(π)=-1 down
}

// Force + optional activations for the viz. `target` is the goal input (or []).
export function policyForce(mlp, weights, plant, s, target, activationsOut) {
  const cfg = NEURAL[plant.meta.name]
  const out = mlp.forward(weights, cfg.inputs(plant, s, target), activationsOut)
  return out[0] * plant.PARAMS.forceMax
}
