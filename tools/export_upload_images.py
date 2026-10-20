"""Full-resolution JPEG export with a decimal byte ceiling and source provenance.

No crop, resize, retouch, upscaling or original overwrites. PNGs remain archival.
Requires Pillow (tools/requirements-visual-review.txt).
"""
from io import BytesIO
from pathlib import Path
import argparse
import hashlib
import json
import sys

from PIL import Image, ImageChops, ImageStat


def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def export_images(sources, output, max_bytes=4_800_000, quality_floor=85):
    if not sources or not 10_000 <= max_bytes <= 50_000_000 or not 1 <= quality_floor <= 100:
        raise ValueError('Supply images, max bytes 10000..50000000 and quality floor 1..100')
    output = Path(output).resolve()
    if output.exists() or output.is_symlink():
        raise ValueError('Fresh output directory required; preserve previous exports')
    paths = [Path(p).resolve(strict=True) for p in sources]
    names = [p.stem.lower() for p in paths]
    if len(names) != len(set(names)):
        raise ValueError('Duplicate output stems; use a distinct selection')
    # Complete input validation before creating output.
    for p in paths:
        with Image.open(p) as im:
            im.load()
            if im.mode not in ('RGB', 'RGBA', 'L'):
                raise ValueError('Unsupported image mode: ' + im.mode)
            if 'A' in im.getbands() and im.getchannel('A').getextrema() != (255, 255):
                raise ValueError('Transparent original cannot be faithfully represented by JPEG')
    output.mkdir(parents=True)
    receipt = {'schema': 1, 'maxBytesExclusive': max_bytes, 'qualityFloor': quality_floor,
               'crop': False, 'resize': False, 'sceneContentAltered': False, 'lossyEncoding': True, 'images': []}
    try:
        for p in paths:
            before = digest(p)
            with Image.open(p) as im:
                im.load()
                rgb = im.convert('RGB')
            for quality in range(100, quality_floor - 1, -1):
                buf = BytesIO()
                rgb.save(buf, format='JPEG', quality=quality, subsampling=0, optimize=True, progressive=True)
                encoded = buf.getvalue()
                if len(encoded) < max_bytes:
                    break
            else:
                raise ValueError('No full-resolution export fits within the quality floor: ' + p.name)
            dest = output / (p.stem + '.jpg')
            with dest.open('xb') as stream:
                stream.write(encoded)
            with Image.open(dest) as decoded:
                decoded.load()
                if decoded.size != rgb.size or decoded.format != 'JPEG':
                    raise ValueError('Decode verification failed')
                difference = ImageChops.difference(rgb, decoded)
                mean_error = ImageStat.Stat(difference).mean
            if digest(p) != before:
                raise ValueError('Source changed during export: ' + str(p))
            receipt['images'].append({'source': str(p), 'sourceSha256': before, 'output': str(dest),
                                      'sha256': digest(dest), 'bytes': len(encoded), 'dimensions': list(rgb.size),
                                      'quality': quality, 'subsampling': '4:4:4', 'meanAbsoluteRGBError': mean_error})
        receipt['status'] = 'PASS'
    except Exception as error:
        receipt['status'] = 'NOT_TESTED'
        receipt['reason'] = str(error)
        raise
    finally:
        with (output / 'manifest.json').open('x', encoding='utf-8') as stream:
            json.dump(receipt, stream, indent=2)
            stream.write('\n')
    return receipt


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--image', action='append', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--max-bytes', type=int, default=4_800_000)
    p.add_argument('--quality-floor', type=int, default=85)
    p.add_argument('--execute', action='store_true')
    args = p.parse_args()
    if not args.execute:
        print(json.dumps({'status': 'NOT_TESTED', 'dryRun': True, 'sources': args.image, 'output': args.output,
                          'maxBytesExclusive': args.max_bytes, 'qualityFloor': args.quality_floor}))
        return 0
    try:
        print(json.dumps(export_images(args.image, args.output, args.max_bytes, args.quality_floor), indent=2))
        return 0
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
