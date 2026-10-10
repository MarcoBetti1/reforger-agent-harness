"""Synthetic validator tests. These are not engine or gameplay evidence."""
import importlib.util
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('native_review', Path(__file__).with_name('native_capture_review.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class NativeReviewGates(unittest.TestCase):
    def fixture(self, root, count=1, black=False, stale=False):
        profile = root / 'profile'
        profile.mkdir()
        views, telemetry = [], []
        for i in range(count):
            label = f'view-{i}'
            views.append({'label':label,'purpose':'exterior'})
            im = Image.new('RGB', (320,240), 'black')
            if not black:
                ImageDraw.Draw(im).rectangle((40,30,260,180), fill='white')
            p = profile / f'NativeCapture-unit-{label}.bmp'
            im.save(p)
            if stale: os.utime(p, (1,1))
            telemetry += [f'NVC_FRAME|unit|{label}|1|100|pose', f'NVC_STATE|unit|{label}|engine=0|rpm=0|crew=0|selected=1|adapter=rotorcraft']
        manifest = {'job':{'id':'unit','views':views,'resolution':[320,240],'state':'stopped','seats':[]},'nativeTelemetry':telemetry,'startedUtc':datetime.now(timezone.utc).isoformat(),'plan':{'profile':str(profile)}}
        (root/'manifest.json').write_text(json.dumps(manifest))

    def test_rejects_black_pixels(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.fixture(root,black=True)
            with self.assertRaisesRegex(ValueError,'Black/blank'): module.review(root)

    def test_rejects_duplicate_view_pixels(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.fixture(root,count=2)
            with self.assertRaisesRegex(ValueError,'Duplicated pixels'): module.review(root)

    def test_rejects_stale_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.fixture(root,stale=True)
            with self.assertRaisesRegex(ValueError,'Stale file'): module.review(root)

    def test_rejects_missing_frame(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);self.fixture(root)
            next((root/'profile').glob('*.bmp')).unlink()
            with self.assertRaisesRegex(ValueError,'Missing or ambiguous'): module.review(root)

if __name__ == '__main__': unittest.main()
