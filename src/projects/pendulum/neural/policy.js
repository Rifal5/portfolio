// Neural policy definition for the single cart-pole, shared by training, the
// live worker, and the runtime controller so they always agree on the network
// shape and the input encoding.
//
// Inputs (5, normalized to ~[-1,1]): [sinθ, cosθ, θ̇/Wmax, x/half, ẋ/Vmax].
// Using sin/cos instead of raw θ removes the ±π wrap discontinuity, which
// matters for a policy that must both swing up and balance.
// Output: one tanh in [-1,1], scaled to the motor force.

export const ARCH = [5, 12, 8, 1]
export const NORM = { W: 8, V: 4 } // rad/s and m/s normalizers

export function inputsFor(plant, s) {
  const half = plant.PARAMS.trackHalfWidth
  return [Math.sin(s.theta), Math.cos(s.theta), s.thetadot / NORM.W, s.x / half, s.xdot / NORM.V]
}

export function policyForce(mlp, weights, plant, s) {
  const out = mlp.forward(weights, inputsFor(plant, s))[0]
  return out * plant.PARAMS.forceMax
}
