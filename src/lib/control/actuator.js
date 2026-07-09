// Actuator model — turns a commanded force into the force a real motor would
// actually deliver. Four effects, applied in physical order:
//   deadband     — small commands produce no motion (static friction / dead zone)
//   saturation   — hard force limit (±forceMax)
//   slew-rate    — the command can't change faster than slewMax (N/s): finite
//                  current-loop bandwidth / voltage headroom
//   first-order lag — the motor's electrical/mechanical time constant tau:
//                  the delivered force chases the commanded one, it doesn't jump
//
// Any effect with a non-positive parameter is disabled, so an all-zero config is
// an ideal actuator (identity) — that's exactly Ideal mode.

export function makeActuator({ forceMax = Infinity, slewMax = 0, tau = 0, deadband = 0 } = {}) {
  let cmdPrev = 0 // last (post-slew) command, for slew limiting
  let out = 0     // last delivered force, for the lag filter
  return {
    apply(uCmd, dt) {
      let u = Math.abs(uCmd) < deadband ? 0 : uCmd
      u = Math.max(-forceMax, Math.min(forceMax, u))
      if (slewMax > 0) {
        const maxStep = slewMax * dt
        u = Math.max(cmdPrev - maxStep, Math.min(cmdPrev + maxStep, u))
      }
      cmdPrev = u
      if (tau > 0) out += (u - out) * (1 - Math.exp(-dt / tau))
      else out = u
      return out
    },
    reset() { cmdPrev = 0; out = 0 },
    get delivered() { return out },
  }
}
