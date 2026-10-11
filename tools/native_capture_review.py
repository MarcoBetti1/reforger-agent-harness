"""Decode native engine BMPs; retain originals and write labeled review evidence."""
import argparse
import hashlib
import json
from pathlib import Path
from datetime import datetime
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def review(run_dir):
    root = Path(run_dir)
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8-sig'))
    job = manifest['job']
    telemetry = manifest.get('nativeTelemetry', [])
    started = datetime.fromisoformat(manifest['startedUtc'].replace('Z', '+00:00')).timestamp()
    output = root / 'review'
    output.mkdir(exist_ok=False)
    images, records, hashes = [], [], {}
    motion_sequence = job['settleSeconds'] < 1
    previous_time = -1
    for view in job['views']:
        name = f"NativeCapture-{job['id']}-{view['label']}"
        candidates = list(Path(manifest['plan']['profile']).rglob(name + '.bmp'))
        if len(candidates) != 1:
            raise ValueError(f"Missing or ambiguous native frame: {name}")
        src = candidates[0]
        if src.stat().st_mtime < started - 2:
            raise ValueError(f"Stale file timestamp: {name}")
        im = Image.open(src).convert('RGB')
        im.load()
        if list(im.size) != job['resolution']:
            raise ValueError(f"Decoded resolution {im.size} differs from requested {job['resolution']}")
        a = np.asarray(im)
        black = float((a.max(axis=2) < 8).mean())
        deviation = float(a.std(axis=(0,1)).mean())
        if black > .97 or deviation < 2:
            raise ValueError(f"Black/blank capture: {name}")
        digest = hashlib.sha256(src.read_bytes()).hexdigest()
        if digest in hashes and not motion_sequence:
            raise ValueError(f"Duplicated pixels across different views: {name}")
        duplicate_of = hashes.get(digest)
        hashes[digest] = view['label']
        frame = [line for line in telemetry if f"NVC_FRAME|{job['id']}|{view['label']}|1|" in line]
        state = [line for line in telemetry if f"NVC_STATE|{job['id']}|{view['label']}|" in line]
        if len(frame) != 1 or len(state) != 1 or 'selected=1' not in state[0]:
            raise ValueError(f"Missing successful pose/state telemetry: {name}")
        world_time = float(frame[0].split('|')[4])
        if world_time <= previous_time:
            raise ValueError(f"Non-increasing native capture time: {name}")
        previous_time = world_time
        values = dict(part.split('=', 1) for part in state[0].split('|')[3:] if '=' in part)
        if int(values['crew']) != len(job['seats']):
            raise ValueError(f"Crew count mismatch: {name}")
        if job['state'] == 'running':
            if values['engine'] != '1' or float(values['rpm']) < job['minRPM']:
                raise ValueError(f"Requested running state not observed: {name}")
        elif values['engine'] != '0' or (values.get('adapter', 'rotorcraft') == 'rotorcraft' and float(values['rpm']) > .1):
            raise ValueError(f"Requested stopped rotor state not observed: {name}")
        for seat in job['seats']:
            if not any(f"NVC_CREW|{job['id']}|{seat}|occupied=1|" in line for line in telemetry):
                raise ValueError(f"No actual compartment confirmation for {seat}")
        if view['purpose'] == 'native-crew' and not any(f"NVC_VIEW|{job['id']}|{view['label']}|nativeCrew=1|seat={view['nativeSeat']}|cameraType=PlayerCamera" in line for line in telemetry):
            raise ValueError(f"Native crew camera was not established: {name}")
        im.save(output / (view['label'] + '.png'))
        labeled = Image.new('RGB', (im.width, im.height + 52), '#101820')
        labeled.paste(im, (0, 0))
        caption = f"{job['id']} / {view['label']} / {view['purpose']} | {job['state']}: engine {values['engine']}, RPM {values['rpm']}, crew {values['crew']} | {im.width}x{im.height}"
        try: font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 20)
        except OSError: font = ImageFont.load_default()
        ImageDraw.Draw(labeled).text((12, im.height + 12), caption, fill='white', font=font)
        labeled.save(output / (view['label'] + '-labeled.png'))
        thumb = labeled.copy()
        thumb.thumbnail((640, 420))
        images.append(thumb)
        records.append({'label':view['label'], 'source':str(src), 'bytes':src.stat().st_size, 'sha256':digest, 'duplicateOf':duplicate_of,'nativeWorldTimeMs':world_time,'decodedResolution':list(im.size), 'blackFraction':black, 'pixelStd':deviation, 'poseTelemetry':frame[0], 'observedState':values})
    sheet = Image.new('RGB', (1280, 420 * ((len(images)+1)//2)), '#202830')
    for i, im in enumerate(images): sheet.paste(im, ((i%2)*640, (i//2)*420))
    sheet.save(output / 'contact-sheet.png')
    result = {'passed':True, 'kind':'native-engine-visual-inspection', 'frames':records, 'limitations':'External inspection cameras; no human controls, controlled flight, multiplayer or WCS compatibility established.'}
    (output / 'validation.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'passed':True, 'frames':len(records), 'contactSheet':str(output / 'contact-sheet.png')}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run-dir', required=True)
    args = parser.parse_args()
    review(args.run_dir)
