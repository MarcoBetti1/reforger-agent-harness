import json,tempfile,unittest
from pathlib import Path
from checkpoint_artifacts import create,verify,CheckpointError,strict_json

class Checkpoints(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)/'source';self.root.mkdir();self.out=Path(self.tmp.name)/'checkpoint'
  (self.root/'builder.py').write_text('print("source only")\n',encoding='utf-8')
  self.selection={'schema':1,'label':'source checkpoint','qualification':'Source-only, native acceptance pending','files':[{'path':'builder.py','provenance':'original'}],'references':[]}
 def test_exact_round_trip_and_external_digest(self):
  r=create(self.root,self.selection,self.out);self.assertEqual(1,r['files']);self.assertEqual(r,verify(self.out,r['manifestSHA256']));self.assertEqual((self.root/'builder.py').read_bytes(),(self.out/'builder.py').read_bytes())
 def test_refuses_path_escape_before_output(self):
  self.selection['files'][0]['path']='../outside.py'
  with self.assertRaises(CheckpointError):create(self.root,self.selection,self.out)
  self.assertFalse(self.out.exists())
 def test_refuses_binary_asset_and_unknown_provenance(self):
  for path,origin in [('asset.blend','original'),('builder.py','third_party_raw')]:
   self.selection['files']=[{'path':path,'provenance':origin}]
   with self.assertRaises(CheckpointError):create(self.root,self.selection,self.out)
 def test_refuses_secret_json_and_owner_receipt(self):
  for name,data in [('record.json',{'ownerKey':'private-capability'}),('RECORD.JSON',{'ownerKey':'private-capability'}),('owner-lease-private.json',{})]:
   (self.root/name).write_text(json.dumps(data),encoding='utf-8');self.selection['files']=[{'path':name,'provenance':'metadata'}]
   with self.assertRaises(CheckpointError):create(self.root,self.selection,self.out)
 def test_refuses_signed_links(self):
  (self.root/'note.md').write_text('https://example.invalid/file?X-Amz-Signature=fake',encoding='utf-8');self.selection['files']=[{'path':'note.md','provenance':'metadata'}]
  with self.assertRaises(CheckpointError):create(self.root,self.selection,self.out)
 def test_retained_reference_identity(self):
  self.selection['references']=[{'role':'original source archive','library_file_id':'libfile_'+'a'*32,'sha256':'b'*64,'bytes':12,'version':0}]
  self.assertEqual(1,create(self.root,self.selection,self.out)['externalArtifactReferences'])
 def test_refuses_signed_link_in_selection_metadata(self):
  self.selection['qualification']='https://example.invalid/file?sig=fake'
  with self.assertRaises(CheckpointError):create(self.root,self.selection,self.out)
 def test_refuses_duplicate_case_paths(self):
  self.selection['files'].append({'path':'Builder.py','provenance':'original'})
  with self.assertRaises(CheckpointError):create(self.root,self.selection,self.out)
 def test_refuses_existing_destination_without_overwrite(self):
  self.out.mkdir();(self.out/'keep.txt').write_text('keep',encoding='utf-8')
  with self.assertRaises(CheckpointError):create(self.root,self.selection,self.out)
  self.assertEqual('keep',(self.out/'keep.txt').read_text(encoding='utf-8'))
 def test_modified_missing_or_extra_file_fails(self):
  create(self.root,self.selection,self.out);(self.out/'builder.py').write_text('changed',encoding='utf-8')
  with self.assertRaises(CheckpointError):verify(self.out)
  (self.out/'builder.py').write_bytes((self.root/'builder.py').read_bytes());(self.out/'extra.md').write_text('extra',encoding='utf-8')
  with self.assertRaises(CheckpointError):verify(self.out)
  (self.out/'extra.md').unlink();(self.out/'builder.py').unlink()
  with self.assertRaises(CheckpointError):verify(self.out)
 def test_incomplete_or_wrong_external_identity_fails(self):
  create(self.root,self.selection,self.out)
  with self.assertRaises(CheckpointError):verify(self.out,'0'*64)
  (self.out/'COMPLETE').unlink()
  with self.assertRaises(CheckpointError):verify(self.out)
 def test_duplicate_json_fields_fail(self):
  with self.assertRaises(CheckpointError):strict_json('{"schema":1,"schema":1}')
 def test_reserved_metadata_containment_is_checked(self):
  from unittest import mock
  import checkpoint_artifacts as module
  create(self.root,self.selection,self.out);real=module.within;calls=[]
  def checked(root,rel):
   calls.append(rel)
   if rel=='checkpoint.json':raise CheckpointError('External symlink metadata refused')
   return real(root,rel)
  with mock.patch.object(module,'within',side_effect=checked):
   with self.assertRaises(CheckpointError):verify(self.out)
  self.assertIn('checkpoint.json',calls)
 def test_external_symlink_metadata_refused_when_supported(self):
  create(self.root,self.selection,self.out);p=self.out/'checkpoint.json';outside=Path(self.tmp.name)/'external.json';outside.write_bytes(p.read_bytes());p.unlink()
  try:p.symlink_to(outside)
  except OSError:self.skipTest('Symlink creation is not permitted in this shell')
  with self.assertRaises(CheckpointError):verify(self.out)
if __name__=='__main__':unittest.main(verbosity=2)
