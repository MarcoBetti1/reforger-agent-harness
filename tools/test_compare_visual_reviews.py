import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image
import compare_visual_reviews as compare
import visual_review as review
from test_visual_review import EXAMPLE, telemetry


class CompareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.recipe = review.read_json(EXAMPLE)
        self.a = self.manifest('before')
        self.b = self.manifest('after')

    def manifest(self, prefix):
        root = self.root/prefix;root.mkdir()
        frame = review.make_plan(self.recipe, 'representative', 'soft', prefix)[0]
        pixels = Image.new('RGB', (1280, 720), 'grey');pixels.putpixel((1, 1), (1, 2, 3))
        bmp = root/'native.bmp';png = root/'native.png';pixels.save(bmp)
        saved = review.save_pixels(bmp, png, self.recipe['resolution'])
        actual = review.readback(telemetry(self.recipe, frame), self.recipe, frame)
        manifest = {'recipe': self.recipe, 'automaticValidationPassed': True, 'frames': [{'label': frame['label'], 'requested': frame, 'actual': actual, **saved}]}
        path = root/'review-manifest.json';path.write_text(json.dumps(manifest))
        (root/'graphics-settings.json').write_text(json.dumps(['HDR=0', 'resolution=1280x720']))
        return path

    def alter(self, change):
        data = json.loads(self.b.read_text());change(data);self.b.write_text(json.dumps(data))

    def test_prefix_changes_match_by_light_and_station(self):
        result = compare.compare(self.a, self.b)
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(result['manualVisualAcceptance'], 'pending')
        self.assertNotEqual(result['pairs'][0]['baselineLabel'], result['pairs'][0]['candidateLabel'])

    def test_individually_valid_camera_delta_blocks_matched_pair(self):
        self.alter(lambda d:d['frames'][0]['actual']['CAMERA']['eye'].__setitem__(0, d['frames'][0]['actual']['CAMERA']['eye'][0]+.0005))
        result = compare.compare(self.a, self.b)
        self.assertEqual(result['status'], 'NOT_TESTED')
        self.assertTrue(any(v['field']=='CAMERA.eye' for v in result['differences']))

    def test_graphics_settings_difference_blocks_pair(self):
        (self.b.parent/'graphics-settings.json').write_text(json.dumps(['HDR=1']))
        self.assertEqual(compare.compare(self.a, self.b)['status'], 'NOT_TESTED')

    def test_tampered_png_or_bmp_rejected(self):
        for field in ('png', 'nativeBMP'):
            with self.subTest(field=field):
                data = json.loads(self.b.read_text());path=Path(data['frames'][0][field]);old=path.read_bytes();path.write_bytes(old+b'tampered')
                with self.assertRaisesRegex(ValueError, 'hash differs'):compare.compare(self.a,self.b)
                path.write_bytes(old)

    def test_missing_station_and_required_articulation_rejected(self):
        self.alter(lambda d:d['frames'][0]['requested']['station'].update(pose='deployed'))
        with self.assertRaises(ValueError):compare.compare(self.a,self.b)

    def test_incomplete_capture_and_stale_label_rejected(self):
        self.alter(lambda d:d.update(automaticValidationPassed=False))
        with self.assertRaisesRegex(ValueError, 'Incomplete'):compare.compare(self.a,self.b)
        self.alter(lambda d:d.update(automaticValidationPassed=True))
        self.alter(lambda d:d['frames'][0]['actual']['CAMERA'].update(label='stale'))
        with self.assertRaisesRegex(ValueError, 'label differs'):compare.compare(self.a,self.b)

    def test_cli_emits_unqualified_receipt_for_bad_inputs(self):
        target=self.root/'comparison.json'
        self.assertEqual(compare.main(['--baseline',str(self.a),'--candidate',str(self.root/'missing.json'),'--output',str(target)]),2)
        self.assertEqual(json.loads(target.read_text())['status'],'NOT_TESTED')
        with self.assertRaises(FileExistsError):compare.main(['--baseline',str(self.a),'--candidate',str(self.b),'--output',str(target)])


if __name__ == '__main__':
    unittest.main()
