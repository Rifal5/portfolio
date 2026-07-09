// Manual controller — no automatic control at all. The commanded cart force
// comes from the user (arrow keys), so you can push the cart around and try to
// balance the pole yourself. `setDrive(-1..1)` is fed from the held keys each
// frame; the output is a fraction of the motor limit so it's controllable.

const DRIVE_FRAC = 0.6

export function makeController(plant) {
  let drive = 0
  return {
    compute() { return { force: drive * plant.PARAMS.forceMax * DRIVE_FRAC, mode: 'manual' } },
    reset() { drive = 0 },
    setDrive(d) { drive = Math.max(-1, Math.min(1, d)) },
  }
}
