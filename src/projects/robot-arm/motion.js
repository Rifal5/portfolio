// Joint-space motion layer for the arm. The analytic IK gives a target pose, but
// commanding a real robot to jump straight to it is physically impossible — the
// joints teleport. This inserts a per-joint trapezoidal (accel-limited) velocity
// profile between IK and the renderer: each joint accelerates toward its target,
// cruises at a capped speed, and decelerates into position, never exceeding its
// velocity or acceleration limits. That is exactly what a real servo controller
// enforces, so the visualized motion could drive actual hardware.
//
// The braking-distance rule vDes = sqrt(2·aMax·|error|) is the standard
// time-optimal decel ramp: go as fast as allowed, but slow enough to stop
// exactly at the target under the acceleration limit.

const DEFAULT_VMAX = { yaw: 200, shoulder: 140, elbow: 160, wrist: 240 }   // deg/s
const DEFAULT_AMAX = { yaw: 700, shoulder: 500, elbow: 600, wrist: 900 }   // deg/s²
const JOINTS = ['yaw', 'shoulder', 'elbow', 'wrist']

export function makeJointProfiler({ vMax = DEFAULT_VMAX, aMax = DEFAULT_AMAX } = {}) {
  let pos = null
  let atTarget = true
  const vel = { yaw: 0, shoulder: 0, elbow: 0, wrist: 0 }

  function reset(angles) { pos = { ...angles }; for (const j of JOINTS) vel[j] = 0 }

  function step(target, dt) {
    if (!pos) reset(target) // snap to the first commanded pose (no startup lurch)
    let done = true
    for (const j of JOINTS) {
      const err = target[j] - pos[j]
      const vCap = vMax[j], aCap = aMax[j]
      // Desired velocity: fast, but capped so we can still brake to a stop in time.
      const vDes = Math.sign(err) * Math.min(vCap, Math.sqrt(2 * aCap * Math.abs(err)))
      let dv = vDes - vel[j]
      const dvMax = aCap * dt
      dv = Math.max(-dvMax, Math.min(dvMax, dv))
      vel[j] += dv
      pos[j] += vel[j] * dt
      if (Math.abs(err) > 0.4 || Math.abs(vel[j]) > 1) done = false
    }
    atTarget = done
    return done
  }

  return {
    step, reset,
    get pose() { return pos },
    get atTarget() { return atTarget },
    get velocity() { return { ...vel } },
  }
}
