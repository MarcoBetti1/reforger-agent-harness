"""Versioned local coordination; does not launch, stop, focus or send input.

Native process identity is inspected via read-only CIM. Tests inject a process
probe into the library, never through the production CLI. Legacy bridge writes
occur only after explicit migration enablement, under an exclusive legacy file
handle as well as the registry's named mutex. No expiry alone proves ownership.
"""
from __future__ import annotations
import argparse,contextlib,ctypes,datetime,hashlib,json,os,re,subprocess,sys,time,uuid
from pathlib import Path

class LeaseError(RuntimeError): pass
class Busy(LeaseError): pass
class Ambiguous(LeaseError): pass

def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def canon(value):
    if not isinstance(value,str) or not value or not os.path.isabs(value): raise Ambiguous('Expected an absolute path')
    return os.path.normcase(os.path.realpath(value))
def overlap(a,b):
    a,b=canon(a),canon(b)
    try: return os.path.commonpath([a,b]) in (a,b)
    except ValueError: return False
def keyhash(value): return hashlib.sha256(value.encode()).hexdigest()
def valid_guid(value):
    try: return str(uuid.UUID(value))==value
    except (ValueError,TypeError,AttributeError): return False
def read_json(path):
    try:
        data=Path(path).read_bytes()
        if len(data)>2*1024*1024: raise Ambiguous('Coordination file exceeds limit')
        return strict_json(data.decode('utf-8-sig'))
    except (OSError,UnicodeError,ValueError) as e: raise Ambiguous('Unreadable or malformed coordination record: '+str(path)) from e
def strict_json(text):
    def unique(pairs):
        out={}
        for k,v in pairs:
            if k in out: raise Ambiguous('Duplicate JSON field: '+k)
            out[k]=v
        return out
    def reject_constant(value): raise Ambiguous('Nonfinite JSON constant')
    return json.loads(text,object_pairs_hook=unique,parse_constant=reject_constant)
def stamp(value):
    try:
        # CIM emits seven fractional digits; Python preserves microsecond precision.
        s=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
        if s.tzinfo is None: raise ValueError('timezone required')
        return s.astimezone(datetime.timezone.utc).isoformat(timespec='microseconds')
    except (ValueError,TypeError,AttributeError) as e: raise Ambiguous('Invalid process creation timestamp') from e

def split_windows_command_line(value):
    if not isinstance(value,str) or not value: raise Ambiguous('Process command line unavailable')
    shell=ctypes.WinDLL('shell32',use_last_error=True);kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    shell.CommandLineToArgvW.argtypes=[ctypes.c_wchar_p,ctypes.POINTER(ctypes.c_int)]
    shell.CommandLineToArgvW.restype=ctypes.POINTER(ctypes.c_wchar_p)
    kernel.LocalFree.argtypes=[ctypes.c_void_p];kernel.LocalFree.restype=ctypes.c_void_p
    count=ctypes.c_int();ptr=shell.CommandLineToArgvW(value,ctypes.byref(count))
    if not ptr: raise Ambiguous('Cannot parse process command line')
    try: return [ptr[i] for i in range(count.value)]
    finally: kernel.LocalFree(ptr)

class CIMProbe:
    """A fresh cache per transaction. Missing means CIM query succeeded, no row."""
    def __init__(self): self.cache={}
    def __call__(self,process_id):
        if process_id not in self.cache:
            if type(process_id) is not int or process_id<1: raise Ambiguous('Invalid process ID')
            ps=Path(os.environ.get('SystemRoot','C:/Windows'))/'System32/WindowsPowerShell/v1.0/powershell.exe'
            code=("$ErrorActionPreference='Stop';[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);Import-Module (Join-Path $PSHOME 'Modules/CimCmdlets/CimCmdlets.psd1') -ErrorAction Stop;$p607=Get-CimInstance Win32_Process -Filter 'ProcessId="+str(process_id)+"';"
                  "if($null -eq $p607){@{state='missing'}|ConvertTo-Json -Compress}else{"
                  "@{state='found';processId=[int]$p607.ProcessId;exe=$p607.ExecutablePath;creationUtc=$p607.CreationDate.ToUniversalTime().ToString('o');commandLine=$p607.CommandLine}|ConvertTo-Json -Compress}")
            try:
                result=subprocess.run([str(ps),'-NoLogo','-NoProfile','-NonInteractive','-Command',code],capture_output=True,text=True,encoding='utf-8',errors='strict',timeout=8,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                if result.returncode: raise Ambiguous('Process query failed: '+result.stderr.strip()[:1200])
                row=strict_json(result.stdout)
            except (OSError,subprocess.SubprocessError,ValueError,UnicodeError) as e: raise Ambiguous('Process query unavailable') from e
            if row.get('state')=='found':
                identity(row)
                if row['processId']!=process_id or not row.get('commandLine'): raise Ambiguous('Incomplete process identity')
            elif row!={'state':'missing'}: raise Ambiguous('Ambiguous process query result')
            self.cache[process_id]=row
        return self.cache[process_id]

def identity(row):
    if not isinstance(row,dict) or type(row.get('processId')) is not int or row['processId']<1: raise Ambiguous('Missing process identity')
    return {'processId':row['processId'],'exe':canon(row.get('exe')),'creationUtc':stamp(row.get('creationUtc'))}
def same_identity(expected,actual): return identity(expected)==identity(actual)

@contextlib.contextmanager
def mutex(path,timeout):
    if os.name!='nt': raise LeaseError('This Windows harness requires Windows')
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateMutexW.argtypes=[ctypes.c_void_p,ctypes.c_bool,ctypes.c_wchar_p];kernel.CreateMutexW.restype=ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes=[ctypes.c_void_p,ctypes.c_uint32];kernel.WaitForSingleObject.restype=ctypes.c_uint32
    kernel.ReleaseMutex.argtypes=[ctypes.c_void_p];kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    name='Local\\GEP_RUNTIME_V2_'+keyhash(canon(str(path)))
    handle=kernel.CreateMutexW(None,False,name)
    if not handle: raise Ambiguous('Cannot create registry mutex')
    acquired=False
    try:
        outcome=kernel.WaitForSingleObject(handle,int(timeout*1000))
        if outcome not in (0,0x80): raise Busy('Coordination lock is busy')
        acquired=True;yield
    finally:
        if acquired: kernel.ReleaseMutex(handle)
        kernel.CloseHandle(handle)

@contextlib.contextmanager
def exclusive_legacy(path):
    # shareMode=0 cooperates with the old PowerShell FileShare.None claim.
    import msvcrt
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateFileW.argtypes=[ctypes.c_wchar_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p,ctypes.c_uint32,ctypes.c_uint32,ctypes.c_void_p]
    kernel.CreateFileW.restype=ctypes.c_void_p
    handle=kernel.CreateFileW(str(path),0xC0000000,0,None,3,0x80,None) # existing only
    if handle==ctypes.c_void_p(-1).value: raise Busy('Legacy slot is absent, busy, or unreadable; preserve it')
    descriptor=msvcrt.open_osfhandle(handle,os.O_RDWR|os.O_BINARY)
    with os.fdopen(descriptor,'r+b') as stream: yield stream

def atomic_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        with temp.open('xb') as f:
            f.write((json.dumps(value,indent=2)+'\n').encode());f.flush();os.fsync(f.fileno())
        os.replace(temp,path)
    finally:
        if temp.exists(): temp.unlink()

class RuntimeLeases:
    def __init__(self,config_path,probe=None):
        self.config_path=Path(canon(str(Path(config_path).absolute())))
        self.cfg=read_json(self.config_path)
        c=self.cfg
        if c.get('schema')!=2 or not valid_guid(c.get('registryId')) or type(c.get('migrationEnabled')) is not bool: raise Ambiguous('Invalid harness configuration')
        if set(c)!={'schema','registryId','migrationEnabled','registryPath','legacySlotPath','maxBackground','lockTimeoutSeconds'} or not all(isinstance(c.get(k),str) and c[k] for k in ('registryPath','legacySlotPath')): raise Ambiguous('Unknown or incomplete harness configuration')
        if type(c.get('maxBackground')) is not int or not 2<=c['maxBackground']<=4: raise Ambiguous('Invalid background capacity')
        if type(c.get('lockTimeoutSeconds')) not in (int,float) or not 1<=c['lockTimeoutSeconds']<=30: raise Ambiguous('Invalid lock bound')
        self.path=Path(canon(str((self.config_path.parent/c['registryPath']).absolute())))
        self.legacy=Path(canon(str((self.config_path.parent/c['legacySlotPath']).absolute())))
        if overlap(str(self.path),str(self.legacy)): raise Ambiguous('Registry and legacy paths overlap')
        self.injected_probe=probe;self.probe=None

    def empty(self): return {'schema':2,'registryId':self.cfg['registryId'],'generation':0,'leases':[]}
    def validate_record(self,record):
        if not isinstance(record,dict) or not valid_guid(record.get('leaseId')) or not isinstance(record.get('ownerKeyHash'),str) or not re.fullmatch('[0-9a-f]{64}',record['ownerKeyHash']): raise Ambiguous('Malformed lease ownership')
        if set(record)-{'leaseId','ownerKeyHash','lane','label','state','controller','process','spec','reservedUtc','startingUtc','attachedUtc','releasedUtc'}: raise Ambiguous('Unknown lease field')
        if record.get('lane') not in ('user-review','background-qa') or record.get('state') not in ('reserved','starting','running','released','released-stale'): raise Ambiguous('Unknown lease lane/state')
        identity(record.get('controller'))
        spec=record.get('spec');self.validate_spec(spec)
        if spec['lane']!=record['lane']: raise Ambiguous('Lease lane mismatch')
        process=record.get('process')
        if record['state']=='running' and process is None: raise Ambiguous('Running lease without process')
        if record['state'] in ('reserved','starting') and process is not None: raise Ambiguous('Unattached lease has unexpected process')
        if process is not None: identity(process)
        stamp(record.get('reservedUtc'))
        if record['state'] in ('starting','running'): stamp(record.get('startingUtc'))
        if record['state'].startswith('released'): stamp(record.get('releasedUtc'))

    def read_state(self):
        data=read_json(self.path) if self.path.exists() else self.empty()
        if not isinstance(data,dict) or set(data)!={'schema','registryId','generation','leases'} or data.get('schema')!=2 or data.get('registryId')!=self.cfg['registryId'] or type(data.get('generation')) is not int or data['generation']<0 or not isinstance(data.get('leases'),list): raise Ambiguous('Registry schema/identity differs')
        if len(data['leases'])>512: raise Ambiguous('Registry history limit exceeded; archive deliberately')
        seen=set()
        for row in data['leases']:
            self.validate_record(row)
            if row['leaseId'] in seen: raise Ambiguous('Duplicate lease ID')
            seen.add(row['leaseId'])
        active=[r for r in data['leases'] if not r['state'].startswith('released')]
        if sum(r['lane']=='user-review' for r in active)>1 or sum(r['lane']=='background-qa' for r in active)>self.cfg['maxBackground']: raise Ambiguous('Registry exceeds declared lane capacity')
        for i,row in enumerate(active):
            for other in active[i+1:]: self.check_disjoint(row['spec'],other['spec'])
        return data

    def validate_spec(self,spec):
        if not isinstance(spec,dict) or spec.get('lane') not in ('user-review','background-qa') or not isinstance(spec.get('label'),str) or not spec['label'].strip(): raise Ambiguous('Invalid launch specification')
        if set(spec)-{'lane','label','workRoot','exe','profile','logs','downloads','addons','parallelApproved','noOSInput','noFocus','hiddenWindow','maxFPS','width','height'}: raise Ambiguous('Unknown launch capability')
        for key in ('workRoot','exe','profile','logs','downloads','addons'): canon(spec.get(key))
        folders=[spec[k] for k in ('profile','logs','downloads','addons')]
        if any(overlap(f,str(self.path)) or overlap(f,str(self.legacy)) for f in folders): raise Ambiguous('Runtime paths overlap coordination files')
        if any(canon(f)==canon(spec['workRoot']) or not overlap(f,spec['workRoot']) for f in folders): raise Ambiguous('Instance folders must be inside its work root')
        for i,one in enumerate(folders):
            for two in folders[i+1:]:
                if overlap(one,two): raise Ambiguous('Instance profile/log/download/addon folders overlap')
        if spec.get('parallelApproved') is not True: raise Ambiguous('Parallel runtime authorization is missing')
        if spec['lane']=='background-qa':
            if spec.get('noOSInput') is not True or spec.get('noFocus') is not True or spec.get('hiddenWindow') is not True: raise Ambiguous('Background QA must preserve input/focus')
            if type(spec.get('maxFPS')) is not int or not 1<=spec['maxFPS']<=30: raise Ambiguous('Background FPS bound missing')
            if type(spec.get('width')) is not int or type(spec.get('height')) is not int or not 1<=spec['width']<=1280 or not 1<=spec['height']<=720: raise Ambiguous('Background resolution bound missing')
        return spec

    def check_disjoint(self,a,b):
        if overlap(a['workRoot'],b['workRoot']): raise Busy('Another instance owns an overlapping work root')
        for x in ('profile','logs','downloads','addons'):
            for y in ('profile','logs','downloads','addons'):
                if overlap(a[x],b[y]): raise Busy('Another instance owns overlapping runtime paths')

    def legacy_record(self,stream):
        stream.seek(0);raw=stream.read(2*1024*1024+1)
        try: row=strict_json(raw.decode('utf-8-sig'))
        except (UnicodeError,ValueError) as e: raise Ambiguous('Legacy slot is malformed; preserve it') from e
        if not isinstance(row,dict) or len(raw)>2*1024*1024 or not isinstance(row.get('status'),str) or 'pid' not in row or 'activeRuntime' not in row: raise Ambiguous('Legacy slot identity is ambiguous')
        if row['status']=='reserved_runtime_registry_v2':
            if row.get('registryId')!=self.cfg['registryId'] or row.get('registryPath')!=str(self.path) or row['pid'] is not None or row['activeRuntime']!='v2-managed': raise Ambiguous('Foreign or malformed legacy bridge')
        elif not row['status'].startswith('released') or row['pid'] is not None or row['activeRuntime'] is not None:
            raise Busy('A legacy review/QA session still owns its slot')
        return row

    def write_bridge(self,stream,active):
        row={'status':'reserved_runtime_registry_v2' if active else 'released_runtime_registry_v2','owner':'Runtime harness607 schema2 bridge','registryId':self.cfg['registryId'],'registryPath':str(self.path),'pid':None,'activeRuntime':'v2-managed' if active else None,'updatedUtc':utc()}
        stream.seek(0);stream.truncate();stream.write((json.dumps(row,indent=2)+'\n').encode());stream.flush();os.fsync(stream.fileno())

    def refresh(self,state):
        changed=False
        for row in state['leases']:
            if row['state'].startswith('released'): continue
            expected=row['process'] if row['state']=='running' else row['controller']
            actual=self.probe(expected['processId'])
            if actual.get('state')=='missing':
                if row['state'] in ('reserved','starting'): raise Ambiguous('Reservation controller disappeared before process attachment; inspect owner receipt')
                row['state']='released-stale';row['releasedUtc']=utc();changed=True
            elif actual.get('state')!='found' or not same_identity(expected,actual):
                raise Ambiguous('PID was reused or process identity changed; preserve every process and lease')
            elif row['state']=='running': self.verify_command(row['spec'],actual)
        return changed

    def verify_command(self,spec,process):
        if canon(process['exe'])!=canon(spec['exe']): raise Ambiguous('Runtime executable differs')
        args=split_windows_command_line(process.get('commandLine'))
        if not args or canon(args[0])!=canon(spec['exe']): raise Ambiguous('Runtime command executable differs')
        options={};i=1
        while i<len(args):
            arg=args[i]
            if not arg.startswith('-'): raise Ambiguous('Unpaired runtime argument')
            if '=' in arg:
                key,value=arg.split('=',1)
            else:
                key=arg;value=None
                if i+1<len(args) and not args[i+1].startswith('-'):
                    i+=1;value=args[i]
            key=key.lower()
            if key in options: raise Ambiguous('Duplicate runtime argument')
            options[key]=value;i+=1
        for option,key in [('-profile','profile'),('-logsdir','logs'),('-addondownloaddir','downloads'),('-addonsdir','addons')]:
            if canon(options.get(option))!=canon(spec[key]): raise Ambiguous('Runtime path argument differs: '+option)
        if spec['lane']=='background-qa':
            for flag in ('-nofocus','-nobackend'):
                if flag not in options or options[flag] is not None: raise Ambiguous('Required background flag missing')
            for option,key in [('-maxfps','maxFPS'),('-screenwidth','width'),('-screenheight','height')]:
                if options.get(option)!=str(spec[key]): raise Ambiguous('Background render bound differs')

    @contextlib.contextmanager
    def transaction(self):
        if self.cfg['migrationEnabled'] is not True: raise Busy('Runtime migration is disabled; existing launchers remain unchanged')
        self.probe=self.injected_probe or CIMProbe()
        with mutex(self.path,self.cfg['lockTimeoutSeconds']):
            with exclusive_legacy(self.legacy) as legacy:
                bridge=self.legacy_record(legacy);state=self.read_state()
                # A bridge without a registry can follow an interrupted first
                # claim. Never silently erase it or guess that no runtime exists.
                if bridge['status']=='reserved_runtime_registry_v2' and not self.path.exists(): raise Ambiguous('Orphan bridge; investigate interrupted migration')
                if bridge['status'].startswith('released') and any(not r['state'].startswith('released') for r in state['leases']): raise Ambiguous('Active registry without its legacy bridge')
                self.refresh(state)
                yield state,legacy

    def commit(self,state,legacy):
        state['generation']+=1
        active=any(not r['state'].startswith('released') for r in state['leases'])
        # Claim bridge first; a crash leaves a safe busy bridge. On final release
        # commit the empty registry first, then free the bridge. No launch or
        # release returns to its caller before both writes complete.
        if active:
            self.write_bridge(legacy,True);atomic_json(self.path,state)
        else:
            atomic_json(self.path,state);self.write_bridge(legacy,False)

    def claim(self,spec,controller_id,controller_exe):
        self.validate_spec(spec)
        with self.transaction() as (state,legacy):
            current=self.probe(controller_id)
            if current.get('state')!='found' or canon(current.get('exe'))!=canon(controller_exe): raise Ambiguous('Launcher controller identity unavailable')
            active=[r for r in state['leases'] if not r['state'].startswith('released')]
            if spec['lane']=='user-review' and any(r['lane']=='user-review' for r in active): raise Busy('A user review is already running or reserved')
            if spec['lane']=='background-qa' and sum(r['lane']=='background-qa' for r in active)>=self.cfg['maxBackground']: raise Busy('Background capacity is occupied')
            for other in active: self.check_disjoint(spec,other['spec'])
            token=uuid.uuid4().hex+uuid.uuid4().hex;lease_id=str(uuid.uuid4())
            state['leases'].append({'leaseId':lease_id,'ownerKeyHash':keyhash(token),'lane':spec['lane'],'label':spec['label'],'state':'reserved','controller':identity(current),'process':None,'spec':spec,'reservedUtc':utc()})
            self.commit(state,legacy)
            return {'leaseId':lease_id,'ownerKey':token,'registryId':self.cfg['registryId']}

    def owned(self,state,receipt):
        if not isinstance(receipt,dict) or receipt.get('registryId')!=self.cfg['registryId'] or not valid_guid(receipt.get('leaseId')) or not isinstance(receipt.get('ownerKey'),str): raise Ambiguous('Owner receipt differs')
        matches=[r for r in state['leases'] if r['leaseId']==receipt['leaseId']]
        if len(matches)!=1 or matches[0]['ownerKeyHash']!=keyhash(receipt['ownerKey']): raise Ambiguous('Owner-specific lease release refused')
        return matches[0]

    def claim_to_file(self,spec,controller_id,controller_exe,receipt_output):
        # The CLI must never use an atomic replace for a private capability.
        # Preflight before claiming; exclusive final creation also closes a
        # destination race. Persistence failure retains the busy reservation.
        self.validate_spec(spec)
        raw=Path(receipt_output).absolute();output=Path(canon(str(raw)))
        if any(overlap(str(output),str(p)) for p in [self.config_path,self.path,self.legacy]): raise Ambiguous('Receipt destination overlaps coordination data')
        if canon(str(output))==canon(spec['workRoot']) or not overlap(str(output),spec['workRoot']): raise Ambiguous('Receipt must be inside its independent work root')
        if any(overlap(str(output),spec[k]) for k in ['profile','logs','downloads','addons']): raise Ambiguous('Receipt must be outside runtime content folders')
        if os.path.lexists(raw) or os.path.lexists(output): raise Ambiguous('Receipt destination already exists')
        result=self.claim(spec,controller_id,controller_exe)
        try:
            output.parent.mkdir(parents=True,exist_ok=True)
            with output.open('x',encoding='utf-8') as f:
                json.dump(result,f,indent=2);f.flush();os.fsync(f.fileno())
        except OSError as e: raise Ambiguous('Lease reserved but owner receipt was not saved; retain reservation for inspection') from e
        return {'leaseId':result['leaseId'],'receiptSaved':str(output)}

    def attach(self,receipt,process_id):
        with self.transaction() as (state,legacy):
            row=self.owned(state,receipt)
            if row['state']!='starting': raise Ambiguous('Lease was not marked starting before process creation')
            actual=self.probe(process_id)
            if actual.get('state')!='found': raise Ambiguous('Started process cannot be verified; reservation retained')
            self.verify_command(row['spec'],actual)
            row['process']=identity(actual);row['state']='running';row['attachedUtc']=utc()
            self.commit(state,legacy)
            return {'leaseId':row['leaseId'],'state':row['state'],'process':row['process']}

    def mark_starting(self,receipt):
        with self.transaction() as (state,legacy):
            row=self.owned(state,receipt)
            if row['state']!='reserved': raise Ambiguous('Lease is not reserved for a new launch')
            row['state']='starting';row['startingUtc']=utc();self.commit(state,legacy)
            return {'leaseId':row['leaseId'],'state':row['state']}

    def release(self,receipt):
        with self.transaction() as (state,legacy):
            row=self.owned(state,receipt)
            if row['state']=='starting': raise Ambiguous('Process creation may have occurred; retain unattached starting lease for inspection')
            if row['state']=='running': raise Busy('Owned runtime still exists; close it normally before release')
            if row['state']=='reserved':
                row['state']='released';row['releasedUtc']=utc()
            self.commit(state,legacy)
            return {'leaseId':row['leaseId'],'state':row['state']}

    def inspect(self):
        # Read-only inspection needs no migration or bridge write.
        with mutex(self.path,self.cfg['lockTimeoutSeconds']):
            return self.read_state()

def main():
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('command',choices=['claim','starting','attach','release','inspect']);p.add_argument('--spec');p.add_argument('--receipt');p.add_argument('--controller-id',type=int);p.add_argument('--controller-exe');p.add_argument('--process-id',type=int);p.add_argument('--receipt-output')
    a=p.parse_args();manager=RuntimeLeases(a.config)
    if a.command=='claim':
        if not a.receipt_output: raise LeaseError('Owner receipt output path is required')
        # Receipt capability is never printed, replaced or stored in runtime content.
        result=manager.claim_to_file(read_json(a.spec),a.controller_id,a.controller_exe,a.receipt_output)
    elif a.command=='starting': result=manager.mark_starting(read_json(a.receipt))
    elif a.command=='attach': result=manager.attach(read_json(a.receipt),a.process_id)
    elif a.command=='release': result=manager.release(read_json(a.receipt))
    else: result=manager.inspect()
    print(json.dumps({'ok':True,'result':result},indent=2));return 0

if __name__=='__main__':
    try: sys.exit(main())
    except LeaseError as error:
        print(json.dumps({'ok':False,'errorType':type(error).__name__,'error':str(error)}),file=sys.stderr);sys.exit(2)
