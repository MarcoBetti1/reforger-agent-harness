"""Review native tracked-course telemetry; no launcher or physics setters.

Contract and thresholds: docs/driving-review.md. These are regression gates,
not performance specifications or real-world traction measurements.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import statistics

from visual_review import parse_fields, number, vector


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def analyze(log):
    samples = {}
    for line in log.splitlines():
        for tag in ('STATE', 'MOTION', 'CONTROL', 'WHEELS', 'ADMISSION'):
            marker = 'QA_DRIVE_' + tag + ' '
            if marker not in line:
                continue
            values = parse_fields(line.split(marker, 1)[1])
            ident = number(values['sample'], 1, 10000)
            if ident != int(ident) or tag in samples.setdefault(int(ident), {}):
                raise ValueError('Duplicate/noninteger telemetry sample')
            samples[int(ident)][tag] = values
    if not 20 <= len(samples) <= 10000:
        raise ValueError('Expected 20-10000 native samples')
    phases = {}
    previous = None
    order = ['idle', 'forward', 'stop-forward', 'reverse', 'stop-reverse', 'left', 'right', 'final-stop']
    current_phase = None
    phase_index = -1
    for ident, row in sorted(samples.items()):
        if set(row) != {'STATE', 'MOTION', 'CONTROL', 'WHEELS', 'ADMISSION'}:
            raise ValueError('Incomplete native sample: ' + str(ident))
        state, motion, controls, wheels = (row[k] for k in ('STATE', 'MOTION', 'CONTROL', 'WHEELS'))
        if state['phase'] != current_phase:
            phase_index += 1
            if phase_index >= len(order) or state['phase'] != order[phase_index]:
                raise ValueError('Course phases must be contiguous and in declared order')
            current_phase = state['phase']
        if row['ADMISSION']['controlled'] != 1 or row['ADMISSION']['occupied'] != 1:
            raise ValueError('Exact controlled driver/seat not established')
        stamp = number(state['worldMs'], 0, 1e10) / 1000
        if previous is not None and not 0 < stamp - previous <= 1:
            raise ValueError('Nonmonotonic world clock or sample gap exceeds one second')
        previous = stamp
        if state['timeScale'] != 1:
            raise ValueError('Native world time scale is not one; declare a separate timing contract')
        velocity, forward, position = (vector(motion[k]) for k in ('velocity', 'forward', 'position'))
        if not .99 <= math.sqrt(dot(forward, forward)) <= 1.01:
            raise ValueError('Invalid native facing basis')
        for key in ('rpm', 'load', 'gear', 'engine'):
            number(state[key], -100, 10000)
        # Retain anomalous solver getter values separately. They cannot qualify
        # native input readback; actual action, powertrain and movement still can.
        for key in ('throttle', 'brake'):
            number(controls[key], -100, 100)
        for key in ('steer', 'actionThrottle', 'actionBrake', 'actionSteer'):
            number(controls[key], -1, 1)
        signed = dot(velocity, forward)
        speed = math.hypot(velocity[0], velocity[2])
        yaw = number(motion['yawRate'], -100, 100)
        rim = statistics.mean(abs(number(wheels[side+'RPM'], -1e5, 1e5))*2*math.pi*number(wheels[side+'Radius'], .01, 10)/60 for side in ('left', 'right'))
        grounded = all(wheels[side+'Contact'] == 1 for side in ('left', 'right'))
        commanded = (controls['actionThrottle'] > .1 if current_phase == 'forward' else
                     controls['actionBrake'] > .1 if current_phase == 'reverse' else
                     controls['actionSteer'] < -.1 if current_phase == 'left' else
                     controls['actionSteer'] > .1 if current_phase == 'right' else False)
        sample = {'seconds': stamp, 'position': position, 'forward': forward, 'signedSpeed': signed, 'speed': speed,
                  'speed3D': math.sqrt(dot(velocity, velocity)),
                  'grade': number(motion['gradeDegrees'], -90, 90), 'yawRate': yaw,
                  'radius': speed/abs(yaw) if abs(yaw) >= .01 and speed >= .25 else None,
                  'wheel4Slip': (rim-speed)/max(rim, speed, .5), 'grounded': grounded,
                  'solverControlsInDocumentedRange': all(0 <= controls[k] <= 1 for k in ('throttle', 'brake')),
                  'powered': state['engine'] == 1 and state['rpm'] >= 500 and state['load'] > .05 and
                  commanded and grounded}
        phases.setdefault(state['phase'], []).append(sample)
    required = {'idle', 'forward', 'stop-forward', 'reverse', 'stop-reverse', 'left', 'right', 'final-stop'}
    if set(phases) != required or any(len(rows) < 6 for rows in phases.values()):
        raise ValueError('Course phases missing, unknown or undersampled')
    metrics = {}
    for phase, rows in phases.items():
        path_projection = sum(dot([b-a for a, b in zip(left['position'], right['position'])], left['forward']) for left, right in zip(rows, rows[1:]))
        progress = dot([b-a for a, b in zip(rows[0]['position'], rows[-1]['position'])], rows[0]['forward'])
        yaw = sum((a['yawRate']+b['yawRate'])*.5*(b['seconds']-a['seconds']) for a, b in zip(rows, rows[1:]))
        radii = [s['radius'] for s in rows if s['radius'] is not None]
        intervals, segment = [], []
        for sample in rows + [None]:
            direction_ok = sample and (sample['signedSpeed'] >= .1 if phase == 'forward' else
                                       sample['signedSpeed'] <= -.1 if phase == 'reverse' else
                                       sample['speed'] >= .25 if phase in ('left', 'right') else False)
            if sample and sample['powered'] and direction_ok:
                segment.append(sample)
                continue
            if len(segment) >= 2:
                intervals.append({'worldSeconds': segment[-1]['seconds']-segment[0]['seconds'],
                                  'netProgressMetres': dot([b-a for a, b in zip(segment[0]['position'], segment[-1]['position'])], rows[0]['forward']),
                                  'pathMetres': sum(math.dist(a['position'], b['position']) for a, b in zip(segment, segment[1:])),
                                  'yawRadians': sum((a['yawRate']+b['yawRate'])*.5*(b['seconds']-a['seconds']) for a, b in zip(segment, segment[1:]))})
            segment = []
        metrics[phase] = {'samples': len(rows), 'worldSeconds': rows[-1]['seconds']-rows[0]['seconds'],
                          'signedProgressMetres': progress, 'integratedFacingProjectedPathMetres': path_projection,
                          'maxHeadingChangeDegrees': max(math.degrees(math.acos(max(-1, min(1, dot(s['forward'], rows[0]['forward']))))) for s in rows),
                          'maxSpeedMps': max(s['speed'] for s in rows),
                          'max3DSpeedMps': max(s['speed3D'] for s in rows),
                          'maxPositionDriftMetres': max(math.dist(s['position'], rows[0]['position']) for s in rows),
                          'minSignedSpeedMps': min(s['signedSpeed'] for s in rows), 'maxSignedSpeedMps': max(s['signedSpeed'] for s in rows),
                          'meanGradeDegrees': statistics.mean(s['grade'] for s in rows),
                          'maxAbsGradeDegrees': max(abs(s['grade']) for s in rows),
                          'yawRadians': yaw, 'medianMovingTurnRadiusMetres': statistics.median(radii) if radii else None,
                          'poweredSampleFraction': statistics.mean(s['powered'] for s in rows),
                          'continuousPoweredMovement': intervals,
                          'groundedSampleFraction': statistics.mean(s['grounded'] for s in rows),
                          'solverControlsInDocumentedRange': all(s['solverControlsInDocumentedRange'] for s in rows),
                          'meanWheel4SlipProxy': statistics.mean(s['wheel4Slip'] for s in rows)}
    idle, forward, reverse = (metrics[k] for k in ('idle', 'forward', 'reverse'))
    tail = [s for s in phases['final-stop'] if s['seconds'] >= phases['final-stop'][-1]['seconds']-2]
    checks = {}
    def check(key, condition, reason, actual):
        checks[key] = {'status': 'PASS' if condition else 'FAIL', 'reason': reason, 'actual': actual}
    forward_progress = forward['signedProgressMetres'] >= 1 and forward['maxHeadingChangeDegrees'] <= 15
    check('drive.signed-progress', forward_progress, 'At least one metre net forward displacement on the frozen phase-start facing; heading change <=15 degrees', forward['signedProgressMetres'])
    reverse_overlap = any(s['worldSeconds'] >= .5 and s['netProgressMetres'] <= -1 for s in reverse['continuousPoweredMovement'])
    check('drive.reverse', reverse['signedProgressMetres'] <= -1 and reverse['maxHeadingChangeDegrees'] <= 15 and reverse['poweredSampleFraction'] >= .5 and reverse_overlap, 'Net reverse on frozen phase-start facing, heading change <=15 degrees; power/action/contact-qualified moving interval must itself cover -1m', reverse)
    forward_overlap = any(s['worldSeconds'] >= .5 and s['netProgressMetres'] >= 1 for s in forward['continuousPoweredMovement'])
    powered = idle['max3DSpeedMps'] <= .25 and idle['maxPositionDriftMetres'] <= .25 and idle['groundedSampleFraction'] == 1 and idle['maxAbsGradeDegrees'] <= 2 and forward['poweredSampleFraction'] >= .5 and forward['maxSignedSpeedMps'] >= 1 and forward_progress and forward_overlap
    check('drive.powered', powered, 'Settled low-grade idle control, native engine/RPM/load/controls/contact, then forward acceleration and displacement', {'idle': idle, 'forward': forward})
    turn = metrics['left']['yawRadians'] * metrics['right']['yawRadians'] < 0 and all(abs(metrics[k]['yawRadians']) >= .1 and metrics[k]['medianMovingTurnRadiusMetres'] is not None and metrics[k]['poweredSampleFraction'] >= .5 and any(s['worldSeconds'] >= .5 and s['pathMetres'] >= .5 and abs(s['yawRadians']) >= .1 for s in metrics[k]['continuousPoweredMovement']) for k in ('left', 'right'))
    check('drive.turn-radius', turn, 'Opposite measured yaw with moving-radius samples; no requested-steering-only verdict', {k: metrics[k] for k in ('left', 'right')})
    stop = {'seconds': tail[-1]['seconds']-tail[0]['seconds'], 'max3DSpeedMps': max(s['speed3D'] for s in tail), 'maxPositionDriftMetres': max(math.dist(s['position'], tail[0]['position']) for s in tail), 'grounded': all(s['grounded'] for s in tail)}
    check('drive.stop-dwell', stop['seconds'] >= 1.5 and stop['max3DSpeedMps'] <= .25 and stop['maxPositionDriftMetres'] <= .1 and stop['grounded'], 'At least 1.5 world seconds grounded, low 3D speed and stable position at the terminal stop', stop)
    checks['drive.slope'] = {'status': 'NOT_TESTED', 'reason': 'Terrain grade measured along facing; no qualified uphill/downhill course or grade acceptance threshold'}
    checks['drive.slip'] = {'status': 'NOT_TESTED', 'reason': 'Wheel-4 rim-speed proxy only; contact material, full track contact and friction coefficient unqualified'}
    checks['drive.control-readback'] = {'status': 'NOT_TESTED', 'reason': 'Solver throttle/brake getter semantics are not qualified; retain raw values. Core gates use observed action values plus actual powertrain/contact/movement, never setter readback alone.',
                                       'actual': {'allWithinDocumentedZeroToOneRange': all(m['solverControlsInDocumentedRange'] for m in metrics.values())}}
    return {'schema': 1, 'status': 'FAIL' if any(v['status'] == 'FAIL' for v in checks.values()) else 'PASS',
            'metrics': metrics, 'assertions': checks, 'limits': 'Scripted native action course; ordinary keyboard, slope capability, traction coefficient, post-hit driving and multiplayer remain unqualified.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--console', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    data = None
    try:
        with args.console.open('rb') as stream:
            data = stream.read(64*1024**2+1)
        if len(data) > 64*1024**2:
            raise ValueError('Native console exceeds 64 MiB')
        result = analyze(data.decode('utf-8', errors='replace'))
    except (OSError, ValueError, KeyError, TypeError) as error:
        result = {'schema': 1, 'status': 'NOT_TESTED', 'reason': type(error).__name__ + ': ' + str(error)}
    if data is not None:
        result['sourceSHA256'] = hashlib.sha256(data).hexdigest()
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2, allow_nan=False)
        stream.write('\n')
    print(json.dumps({'status': result['status'], 'phases': len(result.get('metrics', {})), 'reason': result.get('reason')}))
    return 0 if result['status'] == 'PASS' else 1 if result['status'] == 'FAIL' else 2


if __name__ == '__main__':
    raise SystemExit(main())
