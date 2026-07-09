// Controller registry — the UI reads labels + plant compatibility from here.
// Each entry: { label, make(plant, opts), plants:[…allowed plant names] }.
// neural is added in Phase 6.
import { makeController as lqr } from './lqr.js'
import { makeController as pid } from './pid.js'
import { makeController as neural } from './neural.js'
import { makeController as manual } from './manual.js'

export const CONTROLLERS = {
  lqr: { label: 'LQR (optimal state feedback)', make: lqr, plants: ['single', 'double'] },
  // A single SISO PID cannot stabilize the underactuated double pendulum, so it
  // is offered for the single pole only (see UI gating).
  pid: { label: 'PID (cascade)', make: pid, plants: ['single'] },
  neural: { label: 'Neural net (evolved)', make: neural, plants: ['single', 'double'] },
  manual: { label: 'Off — you drive (← →)', make: manual, plants: ['single', 'double'] },
}

export const CONTROLLER_KEYS = Object.keys(CONTROLLERS)
