# Native tracked-course review

Select `mobility` through [workflows.md](workflows.md). The addon owns its scene,
driver, native action timing, fresh reset, source manifest and normal lifecycle.
The harness supplies a small offline telemetry reviewer:

```powershell
python tools/driving_review.py --console '<native-run>/logs/console.log' --output '<fresh>/driving-review.json'
```

The local adaptation used an isolated driver/vehicle, ordinary player camera,
exact controlled-character/occupied-seat checks, native tracked action input and
full driving assistance in a fresh private profile. Record assistance mode and
native reverse semantics. No throttle, velocity, gear, health or friction setter
supplied motion evidence. Apply actions before the next simulation step and
sample actual physics; a requested action alone cannot qualify driving.

The fixed phases are `idle`, `forward`, `stop-forward`, `reverse`, `stop-reverse`,
`left`, `right`, `final-stop`, each contiguous, once, in that order. Every phase
needs at least six samples. Use native `BaseWorld.GetWorldTime()` milliseconds,
actual time scale one, increasing clocks and gaps at most one second. Keep wall
time and callback counts separate. The observed course used about half-second
samples and phases of 4/6/6/6/6/5/5/5 world seconds.

Each sample emits five lines with the same integer `sample`:

| Prefix | Required fields |
|---|---|
| `QA_DRIVE_STATE` | sample, phase, worldMs, timeScale, engine (0/1), rpm, load, gear |
| `QA_DRIVE_MOTION` | sample, position, forward, velocity (vectors), yawRate (rad/s), gradeDegrees |
| `QA_DRIVE_CONTROL` | sample, throttle, brake (raw solver getters), steer (requested), actionThrottle, actionBrake, actionSteer (actual action values) |
| `QA_DRIVE_WHEELS` | sample, leftRPM, rightRPM, leftRadius, rightRadius, leftContact, rightContact (road wheel 4) |
| `QA_DRIVE_ADMISSION` | sample, controlled=1, occupied=1 |

Vectors use `<x,y,z>` and other fields `key=value`. Retain one run's console,
source/build manifest, actor/vehicle/seat identities and lifecycle receipt.
Adapters can call `analyze(console)` and attach its assertions/metrics as hashed
coordinator evidence. Protocol, clock and admission errors are NOT_TESTED;
qualified measurements below thresholds are FAIL. The standalone CLI uses exit
codes 0/1/2 for PASS/FAIL/NOT_TESTED and preserves an exclusive result receipt.

The fixed regression gates require:

- Net forward/reverse displacement of at least +1/-1 m on the **frozen phase-start
  facing**, with heading change <=15 degrees. The integrated facing-projected
  path is a separate diagnostic; a circle cannot establish signed progress.
- A grounded idle control with 3D speed <=0.25 m/s, position drift <=0.25 m and
  absolute sampled terrain grade <=2 degrees. Forward then needs speed >=1 m/s.
- Each claimed forward/reverse/turn maneuver needs at least half its samples
  engine-on, RPM >=500, load >0.05, its actual driving/steering action and both
  sampled wheel contacts. Power and movement must overlap in one continuous
  interval of at least 0.5 s. Forward/reverse must cover +1/-1 m **within that
  interval**, rather than combine powered rest with later unpowered motion.
- Opposite measured turn yaw, at least 0.1 rad rotation and a moving radius.
  A qualified powered interval itself needs >=0.5 m path and >=0.1 rad yaw.
  Radius is horizontal speed divided by absolute yaw rate; exclude speed <0.25
  m/s and yaw rate <0.01 rad/s.
- Terminal stop: at least 1.5 world seconds grounded, 3D speed <=0.25 m/s and
  position drift <=0.1 m. An earlier stop or falling vehicle cannot qualify.

These are operational regression thresholds, not torque, efficiency or real-world
vehicle specifications. Require additional assertions for the actual task.

The local probe observed solver `GetBrake()` values up to 6 and
`GetThrottle()==0` despite actual action, powertrain and motion. Installed API
docs describe 0..1. Their semantics remain NOT_TESTED; raw values and a range
diagnostic stay visible. Do not clamp them or tune physics to satisfy a getter.

Terrain grade uses native surface height ahead/behind the body. A flat course
does not qualify hill climbing. Wheel-4 rim-speed slip is only a proxy; full
contact distribution, terrain material and friction coefficients are unqualified.
`drive.slope`, `drive.slip`, `drive.control-readback`, ordinary keyboard input,
post-hit driving and multiplayer remain separate. Add any needed domain to the
job's required assertions; the generic reviewer cannot turn it green.
