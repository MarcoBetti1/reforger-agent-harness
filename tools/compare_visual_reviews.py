"""Compare retained native review evidence before calling frames matched pairs.

Offline only. A PASS qualifies capture comparability, never model quality.
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image
import visual_review as review


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    path = review.regular(path).resolve()
    data = review.read_json(path)
    recipe = review.validate_recipe(data['recipe'])
    if data.get('automaticValidationPassed') is not True:
        review.fail('Incomplete numeric/pixel validation: ' + str(path))
    rows = data['frames']
    if not isinstance(rows, list) or not 1 <= len(rows) <= 120:
        review.fail('Expected 1-120 retained frames')
    settings = review.read_json(review.regular(path.parent / 'graphics-settings.json'))
    if not isinstance(settings, list) or not settings or not all(isinstance(v, str) for v in settings):
        review.fail('Renderer settings readback missing')
    indexed = {}
    for row in rows:
        request = row['requested']
        key = (request['preset'], request['station']['name'])
        if key in indexed:
            review.fail('Duplicate light/station: ' + str(key))
        if row['label'] != request['label']:
            review.fail('Frame/request label differs')
        # Re-run the original per-frame gates from the retained actual values.
        lines = []
        for tag, values in row['actual'].items():
            if tag == 'PERF':
                continue
            if values.get('label') != row['label']:
                review.fail('Actual telemetry label differs')
            def fmt(v):
                return '<' + ','.join(map(str, v)) + '>' if isinstance(v, list) else str(v)
            fields = ' '.join(k + '=' + fmt(v) for k, v in values.items() if k != 'label')
            lines.append('GVR_' + tag + ' label=' + row['label'] + ' ' + fields)
        review.readback('\n'.join(lines), recipe, request)
        for field, hash_field in (('png', 'pngSHA256'), ('nativeBMP', 'nativeBMPSHA256')):
            image = review.regular(row[field])
            if digest(image) != row[hash_field]:
                review.fail('Retained image hash differs: ' + str(image))
            with Image.open(image) as pixels:
                pixels.load()
                if list(pixels.size) != recipe['resolution'] or hashlib.sha256(pixels.convert('RGBA').tobytes()).hexdigest() != row['rgbaSHA256']:
                    review.fail('Decoded retained pixels differ: ' + str(image))
        indexed[key] = row
    return {'path': path, 'data': data, 'recipe': recipe, 'settings': sorted(settings), 'frames': indexed}


def compare(baseline, candidate):
    left, right = load(baseline), load(candidate)
    differences = []
    def same(name, a, b):
        if a != b:
            differences.append({'field': name, 'baseline': a, 'candidate': b})
    for field in ('world', 'date', 'resolution', 'stageOrigin', 'FOV_degrees', 'HDR_brightness', 'presets', 'stage', 'rootYawPitchRoll', 'radarSweep_degrees'):
        same('recipe.' + field, left['recipe'].get(field), right['recipe'].get(field))
    same('renderer.settings', left['settings'], right['settings'])
    left_keys, right_keys = set(left['frames']), set(right['frames'])
    same('frame.coverage', sorted(left_keys), sorted(right_keys))
    global_compatible = not differences
    pairs = []
    for key in sorted(left_keys & right_keys):
        a, b = left['frames'][key], right['frames'][key]
        start = len(differences)
        same(str(key) + '.station', a['requested']['station'], b['requested']['station'])
        deltas = {}
        tags = {'CAMERA': ('eye', 'right', 'up', 'forward', 'fov', 'exposure'),
                'BODY': ('origin', 'right', 'up', 'forward'),
                'ENV_ACTUAL': ('preset', 'weather', 'hour', 'wetness', 'rain', 'cracks', 'puddles')}
        if 'pose' in a['requested']['station'] or 'pose' in b['requested']['station']:
            tags['RADAR'] = ('deployment', 'sweep')
        for tag, fields in tags.items():
            for field in fields:
                av = a['actual'].get(tag, {}).get(field)
                bv = b['actual'].get(tag, {}).get(field)
                name = tag + '.' + field
                if av is None or bv is None:
                    differences.append({'pair': key, 'field': name, 'reason': 'Required actual value missing'})
                    continue
                if isinstance(av, str) or isinstance(bv, str):
                    same(str(key) + '.' + name, av, bv)
                    continue
                aa, bb = (av, bv) if isinstance(av, list) and isinstance(bv, list) else ([av], [bv])
                if len(aa) != len(bb):
                    review.fail('Actual vector shape differs')
                delta = max(abs(review.number(x, -100000, 100000) - review.number(y, -100000, 100000)) for x, y in zip(aa, bb))
                tolerance = 1e-7 if field == 'exposure' else 1e-6
                deltas[name] = delta
                if delta > tolerance:
                    differences.append({'pair': key, 'field': name, 'maxAbsoluteDelta': delta, 'tolerance': tolerance})
        pairs.append({'preset': key[0], 'station': key[1], 'baselineLabel': a['label'], 'candidateLabel': b['label'],
                      'actualDeltas': deltas, 'comparable': global_compatible and len(differences) == start,
                      'baselinePNG': a['png'], 'candidatePNG': b['png']})
    return {'schema': 1, 'status': 'NOT_TESTED' if differences else 'PASS',
            'reason': 'Capture conditions differ; do not attribute pixel differences to the model' if differences else 'Verified retained pixels and matched recorded capture conditions',
            'baseline': {'manifestSHA256': digest(left['path'])}, 'candidate': {'manifestSHA256': digest(right['path'])},
            'pairs': pairs, 'differences': differences, 'manualVisualAcceptance': 'pending',
            'limits': 'No geometry/material quality verdict. Recorded camera/light/settings only; cloud/wind phase and GPU state remain unpinned. Source manifests and intended asset changes require separate review.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = compare(args.baseline, args.candidate)
    except (OSError, ValueError, KeyError, TypeError) as error:
        result = {'schema': 1, 'status': 'NOT_TESTED', 'reason': type(error).__name__ + ': ' + str(error),
                  'manualVisualAcceptance': 'pending'}
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2, allow_nan=False)
        stream.write('\n')
    print(json.dumps({'status': result['status'], 'pairs': len(result.get('pairs', [])), 'differences': len(result.get('differences', [])), 'reason': result.get('reason'), 'manualVisualAcceptance': 'pending'}))
    return 0 if result['status'] == 'PASS' else 2


if __name__ == '__main__':
    raise SystemExit(main())
