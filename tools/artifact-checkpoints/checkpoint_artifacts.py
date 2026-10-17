"""Explicit text-only, hash-verified recovery checkpoints. Never runs or uploads files."""
from __future__ import annotations
import argparse,datetime,hashlib,json,re,sys
from pathlib import Path,PurePosixPath

MAX_FILE=2*1024*1024
MAX_TOTAL=32*1024*1024
ALLOWED={'.py','.ps1','.cmd','.ts','.mjs','.c','.et','.conf','.md','.json','.txt','.gproj','.yml','.yaml'}
SPECIAL={'.gitignore','.gitattributes'}
PRIVATE_PARTS={'.git','.aws','.ssh','profiles','profile','downloads','runs','runs-v2','fixtures','node_modules'}
PRIVATE_KEYS={'ownertoken','ownerkey','ownersecret','accesstoken','refreshtoken','password','clientsecret','privatekey'}
SECRET=re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{30,})\b|https?://[^\s"<>]+[?&](?:sig|signature|token|X-Amz-Signature)=',re.I)

class CheckpointError(ValueError):pass
def digest(data):return hashlib.sha256(data).hexdigest()
def encode(value):return (json.dumps(value,indent=2,sort_keys=True,allow_nan=False)+'\n').encode('utf-8')
def strict_json(data):
 def unique(pairs):
  out={}
  for k,v in pairs:
   if k in out:raise CheckpointError('Duplicate JSON field')
   out[k]=v
  return out
 def nonfinite(value):raise CheckpointError('Nonfinite JSON constant')
 try:return json.loads(data,object_pairs_hook=unique,parse_constant=nonfinite)
 except (UnicodeError,ValueError) as e:raise CheckpointError('Invalid JSON') from e
def relpath(value):
 if not isinstance(value,str) or not value or '\\' in value or ':' in value:raise CheckpointError('Expected a relative POSIX file path')
 p=PurePosixPath(value)
 if p.is_absolute() or any(x in {'','..','.'} for x in value.split('/')):raise CheckpointError('Path escapes selected root')
 if any(x.casefold() in PRIVATE_PARTS for x in p.parts):raise CheckpointError('Private/generated directory is excluded')
 name=p.name.casefold()
 if name.startswith('.env') or name.startswith('owner-') or name in {'reforger-agent.config.json','checkpoint.json','COMPLETE'.casefold()} or 'credential' in name:raise CheckpointError('Private/reserved filename is excluded')
 if p.suffix.casefold() not in ALLOWED and name not in SPECIAL:raise CheckpointError('Only explicit source/text metadata may be checkpointed')
 return p.as_posix()
def within(root,rel):
 p=root/rel
 try:p.resolve(strict=True).relative_to(root.resolve(strict=True))
 except (OSError,ValueError) as e:raise CheckpointError('Input or checkpoint member leaves its root') from e
 if p.is_symlink() or not p.is_file():raise CheckpointError('Expected an ordinary file')
 return p
def check_content(rel,data):
 if len(data)>MAX_FILE or b'\0' in data:raise CheckpointError('Binary or oversized input is excluded')
 try:text=data.decode('utf-8-sig')
 except UnicodeError as e:raise CheckpointError('Input is not UTF-8 text') from e
 if SECRET.search(text):raise CheckpointError('Credential/private-key/signed-link pattern found')
 if PurePosixPath(rel).suffix.casefold()=='.json':
  def inspect(value):
   if isinstance(value,dict):
    for k,v in value.items():
     if re.sub('[^a-z]','',k.casefold()) in PRIVATE_KEYS and v not in [None,'',False]:raise CheckpointError('Private JSON value is excluded')
     inspect(v)
   elif isinstance(value,list):
    for v in value:inspect(v)
  inspect(strict_json(text))
def references(values):
 if not isinstance(values,list):raise CheckpointError('references must be a list')
 out=[]
 for v in values:
  if not isinstance(v,dict) or set(v)-{'role','library_file_id','sha256','bytes','version'}:raise CheckpointError('Unsupported artifact reference fields')
  if not isinstance(v.get('role'),str) or not re.fullmatch(r'libfile_[a-f0-9]{32}',v.get('library_file_id','')):raise CheckpointError('Expected an exact retained Library identity')
  if 'sha256' in v and not re.fullmatch('[a-f0-9]{64}',v['sha256']):raise CheckpointError('Invalid artifact digest')
  if 'bytes' in v and (type(v['bytes']) is not int or v['bytes']<0):raise CheckpointError('Invalid artifact size')
  if 'version' in v and (type(v['version']) is not int or v['version']<0):raise CheckpointError('Invalid artifact version')
  out.append(v.copy())
 return out
def create(root,selection,output):
 root=Path(root).resolve(strict=True);output=Path(output).absolute()
 if not isinstance(selection,dict) or selection.get('schema')!=1:raise CheckpointError('Expected selection schema1')
 if SECRET.search(json.dumps(selection)):raise CheckpointError('Credential/private-key/signed-link pattern found in selection')
 if not isinstance(selection.get('label'),str) or not selection['label'] or '\n' in selection['label']:raise CheckpointError('A one-line checkpoint label is required')
 if not isinstance(selection.get('qualification'),str) or not selection['qualification']:raise CheckpointError('Explicit qualification limits are required')
 members=selection.get('files');refs=references(selection.get('references',[]))
 if not isinstance(members,list) or not members or len(members)>1000:raise CheckpointError('Select1-1000 explicit text files')
 payload={};entries=[];seen=set();total=0
 for row in members:
  if not isinstance(row,dict) or set(row)!={'path','provenance'} or row['provenance'] not in ['original','metadata','license_notice']:raise CheckpointError('Each explicit file requires supported provenance')
  rel=relpath(row['path'])
  if rel.casefold() in seen:raise CheckpointError('Duplicate file path')
  seen.add(rel.casefold());p=within(root,rel);data=p.read_bytes();check_content(rel,data);total+=len(data)
  if total>MAX_TOTAL:raise CheckpointError('Text checkpoint exceeds32MiB')
  payload[rel]=data;entries.append({'path':rel,'provenance':row['provenance'],'bytes':len(data),'sha256':digest(data)})
 entries.sort(key=lambda x:x['path']);tree=digest(encode(entries))
 manifest={'schema':1,'label':selection['label'],'qualification':selection['qualification'],'createdUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'treeSHA256':tree,'files':entries,'references':refs,'assetPayloadsIncluded':False,'runtimeUsed':False}
 # Atomic exclusive directory claim; never overwrite an existing destination.
 # COMPLETE is written last, so interrupted copies cannot pass verification.
 output.parent.mkdir(parents=True,exist_ok=True)
 try:output.mkdir()
 except FileExistsError as e:raise CheckpointError('Checkpoint destination already exists') from e
 for rel,data in payload.items():
  p=output/rel;p.parent.mkdir(parents=True,exist_ok=True)
  with p.open('xb') as f:f.write(data)
 data=encode(manifest)
 with (output/'checkpoint.json').open('xb') as f:f.write(data)
 with (output/'COMPLETE').open('xb') as f:f.write((digest(data)+'\n').encode())
 return verify(output,digest(data))
def verify(folder,expected_manifest_sha256=None):
 folder=Path(folder).resolve(strict=True)
 try:data=within(folder,'checkpoint.json').read_bytes();complete=within(folder,'COMPLETE').read_text(encoding='utf-8').strip()
 except OSError as e:raise CheckpointError('Checkpoint is incomplete') from e
 actual=digest(data)
 if complete!=actual or (expected_manifest_sha256 is not None and expected_manifest_sha256!=actual):raise CheckpointError('Checkpoint manifest identity differs')
 m=strict_json(data.decode('utf-8'))
 if m.get('schema')!=1 or not isinstance(m.get('files'),list) or not 1<=len(m['files'])<=1000 or digest(encode(m['files']))!=m.get('treeSHA256'):raise CheckpointError('Invalid checkpoint manifest/tree')
 check_content('metadata.json',data)
 expected={'checkpoint.json','COMPLETE'};seen=set();total=0
 for row in m['files']:
  rel=relpath(row['path'])
  if rel.casefold() in seen or row.get('provenance') not in ['original','metadata','license_notice']:raise CheckpointError('Duplicate checkpoint member or unsupported provenance')
  seen.add(rel.casefold())
  expected.add(rel);p=within(folder,rel);b=p.read_bytes();check_content(rel,b)
  if len(b)!=row['bytes'] or digest(b)!=row['sha256']:raise CheckpointError('Checkpoint file identity differs: '+rel)
  total+=len(b)
  if total>MAX_TOTAL:raise CheckpointError('Text checkpoint exceeds32MiB')
 observed={p.relative_to(folder).as_posix() for p in folder.rglob('*') if p.is_file()}
 if observed!=expected:raise CheckpointError('Unexpected or missing checkpoint members')
 references(m.get('references',[]))
 return {'status':'verified','files':len(m['files']),'bytes':total,'manifestSHA256':actual,'treeSHA256':m['treeSHA256'],'externalArtifactReferences':len(m['references']),'qualification':m['qualification']}
def main():
 parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
 c=sub.add_parser('create');c.add_argument('--root',required=True);c.add_argument('--selection',required=True);c.add_argument('--output',required=True)
 v=sub.add_parser('verify');v.add_argument('--checkpoint',required=True);v.add_argument('--manifest-sha256')
 a=parser.parse_args()
 try:r=create(a.root,strict_json(Path(a.selection).read_text(encoding='utf-8-sig')),a.output) if a.command=='create' else verify(a.checkpoint,a.manifest_sha256)
 except (CheckpointError,OSError,KeyError,TypeError) as e:print(json.dumps({'status':'refused','reason':str(e)}));return 2
 print(json.dumps(r,indent=2));return 0
if __name__=='__main__':sys.exit(main())
