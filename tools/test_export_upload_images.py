from pathlib import Path
import tempfile
import unittest
from PIL import Image
from export_upload_images import digest, export_images


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.source=self.root/'native.png'
        Image.new('RGB',(100,80),(80,120,160)).save(self.source)

    def test_dimensions_hashes_original_and_decimal_limit(self):
        before=digest(self.source)
        result=export_images([self.source],self.root/'export',10000)
        row=result['images'][0]
        self.assertEqual(result['status'],'PASS')
        self.assertEqual(row['dimensions'],[100,80])
        self.assertEqual(digest(self.source),before)
        self.assertLess(row['bytes'],10000)
        self.assertTrue(result['lossyEncoding'])

    def test_existing_output_and_duplicate_stems_rejected_before_writes(self):
        with self.assertRaises(ValueError):export_images([self.source],self.root)
        with self.assertRaises(ValueError):export_images([self.source,self.source],self.root/'export')
        self.assertFalse((self.root/'export').exists())

    def test_transparency_rejected(self):
        Image.new('RGBA',(100,80),(1,2,3,128)).save(self.source)
        with self.assertRaisesRegex(ValueError,'Transparent'):export_images([self.source],self.root/'export')
        self.assertFalse((self.root/'export').exists())


if __name__=='__main__':unittest.main()
