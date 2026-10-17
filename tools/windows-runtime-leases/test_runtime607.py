"""Offline fixtures only. No native executable is launched or controlled."""
import copy,hashlib,json,multiprocessing,os,subprocess,sys,tempfile,time,unittest,uuid
from pathlib import Path
from unittest import mock
from runtime_lease607 import RuntimeLeases,LeaseError,Busy,Ambiguous,atomic_json,exclusive_legacy,CIMProbe,identity,split_windows_command_line

HERE=Path(__file__).resolve().parent
BIRTH='2026-10-17T12:00:00.123456+00:00'
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def released_legacy(): return {'status':'released_fixture','pid':None,'activeRuntime':None,'owner':'offline fixture only'}
class FakeProbe:
    def __init__(self,root):
        self.root=Path(root);self.rows={12345:{'state':'found','processId':12345,'exe':str(self.root/'controller.exe'),'creationUtc':BIRTH,'commandLine':'offline controller fixture'}}
    def __call__(self,number): return copy.deepcopy(self.rows.get(number,{'state':'missing'}))
    def child(self,number,spec):
        args=[spec['exe'],'-profile',spec['profile'],'-logsDir',spec['logs'],'-addonDownloadDir',spec['downloads'],'-addonsDir',spec['addons'],'-noFocus','-noBackend','-maxFPS',str(spec['maxFPS']),'-screenWidth='+str(spec['width']),'-screenHeight='+str(spec['height'])]
        self.rows[number]={'state':'found','processId':number,'exe':spec['exe'],'creationUtc':BIRTH,'commandLine':subprocess.list2cmdline(args)}
def specification(root,name='review',lane='user-review'):
    base=Path(root)/'instances'/name
    return {'lane':lane,'label':name,'workRoot':str(base),'exe':str(Path(root)/'never-launched-diag.exe'),'profile':str(base/'profile'),'logs':str(base/'logs'),'downloads':str(base/'downloads'),'addons':str(base/'addons'),'parallelApproved':True,'noOSInput':lane=='background-qa','noFocus':True,'hiddenWindow':lane=='background-qa','maxFPS':30 if lane=='background-qa' else 60,'width':1280 if lane=='background-qa' else 1920,'height':720 if lane=='background-qa' else 1080}
def config(root):
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    c={'schema':2,'registryId':str(uuid.uuid4()),'migrationEnabled':True,'registryPath':'registry.json','legacySlotPath':'legacy.json','maxBackground':2,'lockTimeoutSeconds':10}
    atomic_json(root/'config.json',c);atomic_json(root/'legacy.json',released_legacy());return root/'config.json'
def race_worker(root,name,lane,start,ready,result):
    probe=FakeProbe(root);manager=RuntimeLeases(Path(root)/'config.json',probe=probe);ready.put(name);start.wait(10)
    try:
        receipt=manager.claim(specification(root,name,lane),12345,str(Path(root)/'controller.exe'))
        result.put({'name':name,'lane':lane,'ok':True,'leaseId':receipt['leaseId']})
    except LeaseError as e: result.put({'name':name,'lane':lane,'ok':False,'errorType':type(e).__name__})

class OfflineFixtures607(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.top=Path(tempfile.mkdtemp(prefix='offline607-',dir=str(HERE/'fixtures')))
    def setUp(self):
        self.root=self.top/self._testMethodName;self.config=config(self.root);self.probe=FakeProbe(self.root);self.manager=RuntimeLeases(self.config,probe=self.probe)
    def claim(self,name='review',lane='user-review'):
        spec=specification(self.root,name,lane);return self.manager.claim(spec,12345,str(self.root/'controller.exe')),spec
    def running(self,name='review',lane='user-review',number=24001):
        receipt,spec=self.claim(name,lane);self.manager.mark_starting(receipt);self.probe.child(number,spec);self.manager.attach(receipt,number);return receipt,spec
    def state(self): return self.manager.inspect()
    def snapshots(self):
        return {p.name:p.read_bytes() for p in [self.root/'legacy.json',self.root/'registry.json'] if p.exists()}
    def unchanged_failure(self,fn,error=LeaseError):
        before=self.snapshots()
        with self.assertRaises(error): fn()
        self.assertEqual(before,self.snapshots())
    def test_user_and_two_backgrounds_coexist(self):
        self.running();self.running('qa-one','background-qa',24002);self.running('qa-two','background-qa',24003)
        self.assertEqual(3,sum(r['state']=='running' for r in self.state()['leases']))
        self.unchanged_failure(lambda:self.claim('qa-three','background-qa'),Busy)
    def test_duplicate_user_review_refused(self):
        self.claim();self.unchanged_failure(lambda:self.claim('different-review'),Busy)
    def test_missing_running_pid_retires_stale_only(self):
        old,_=self.running();del self.probe.rows[24001];new,_=self.claim('new-review')
        state=self.state();self.assertEqual(['released-stale','reserved'],[r['state'] for r in state['leases']])
        other=copy.deepcopy(state['leases'][1]);self.manager.release(old);self.assertEqual(other,self.state()['leases'][1]);self.assertEqual(new['leaseId'],other['leaseId'])
    def test_reused_pid_same_exe_and_paths_different_birth_refused(self):
        self.running();self.probe.rows[24001]['creationUtc']='2026-10-17T12:00:01.123456+00:00'
        self.unchanged_failure(lambda:self.claim('qa','background-qa'),Ambiguous)
    def test_reused_pid_different_executable_refused(self):
        self.running();self.probe.rows[24001]['exe']=str(self.root/'unowned.exe')
        self.unchanged_failure(lambda:self.claim('qa','background-qa'),Ambiguous)
    def test_unknown_process_query_refused(self):
        self.running();self.probe.rows[24001]={'state':'unknown'}
        self.unchanged_failure(lambda:self.claim('qa','background-qa'),Ambiguous)
    def test_missing_process_metadata_refused(self):
        self.running();self.probe.rows[24001]['exe']=None
        self.unchanged_failure(lambda:self.claim('qa','background-qa'),Ambiguous)
    def test_live_owned_process_cannot_be_released(self):
        receipt,_=self.running();self.unchanged_failure(lambda:self.manager.release(receipt),Busy)
    def test_wrong_owner_key_and_id_cannot_release(self):
        receipt,_=self.claim();other=dict(receipt,ownerKey='wrong');self.unchanged_failure(lambda:self.manager.release(other),Ambiguous)
        other=dict(receipt,leaseId=str(uuid.uuid4()));self.unchanged_failure(lambda:self.manager.release(other),Ambiguous)
    def test_own_release_preserves_other_lease(self):
        one,_=self.claim();two,_=self.claim('qa','background-qa');before=copy.deepcopy(self.state()['leases'][1]);self.manager.release(one)
        self.assertEqual(before,self.state()['leases'][1]);self.assertEqual('reserved_runtime_registry_v2',json.loads((self.root/'legacy.json').read_text())['status'])
        self.manager.release(two);self.assertEqual('released_runtime_registry_v2',json.loads((self.root/'legacy.json').read_text())['status'])
    def test_dead_reservation_controller_is_ambiguous(self):
        self.claim();del self.probe.rows[12345];self.unchanged_failure(lambda:self.claim('qa','background-qa'),Ambiguous)
    def test_starting_without_attached_pid_retained(self):
        receipt,_=self.claim();self.manager.mark_starting(receipt);self.unchanged_failure(lambda:self.manager.release(receipt),Ambiguous)
        del self.probe.rows[12345];self.unchanged_failure(lambda:self.claim('qa','background-qa'),Ambiguous)
    def test_attach_requires_starting_and_verifies_exact_arguments(self):
        receipt,spec=self.claim();self.probe.child(24001,spec);self.unchanged_failure(lambda:self.manager.attach(receipt,24001),Ambiguous)
        self.manager.mark_starting(receipt);self.probe.rows[24001]['commandLine']+=' -profile '+str(self.root/'other-profile');self.unchanged_failure(lambda:self.manager.attach(receipt,24001),Ambiguous)
    def test_attach_wrong_profile_or_resource_bound_refused(self):
        receipt,spec=self.claim('qa','background-qa');self.manager.mark_starting(receipt);self.probe.child(24001,spec)
        self.probe.rows[24001]['commandLine']=self.probe.rows[24001]['commandLine'].replace('-maxFPS 30','-maxFPS 120');self.unchanged_failure(lambda:self.manager.attach(receipt,24001),Ambiguous)
        self.probe.child(24001,spec);self.probe.rows[24001]['commandLine']=self.probe.rows[24001]['commandLine'].replace(spec['profile'],spec['profile']+'-different');self.unchanged_failure(lambda:self.manager.attach(receipt,24001),Ambiguous)
    def test_background_focus_input_capabilities_refused(self):
        for key in ['noOSInput','noFocus','hiddenWindow']:
            spec=specification(self.root,'qa','background-qa');spec[key]=False;self.unchanged_failure(lambda:self.manager.claim(spec,12345,str(self.root/'controller.exe')),Ambiguous)
    def test_cross_role_and_ancestor_paths_refused(self):
        self.claim();spec=specification(self.root,'qa','background-qa');spec['profile']=str(self.root/'instances/review/addons/nested');spec['workRoot']=str(self.root/'instances')
        self.unchanged_failure(lambda:self.manager.claim(spec,12345,str(self.root/'controller.exe')),Busy)
    def test_internal_profile_download_overlap_refused(self):
        spec=specification(self.root);spec['downloads']=str(Path(spec['profile'])/'downloads');self.unchanged_failure(lambda:self.manager.claim(spec,12345,str(self.root/'controller.exe')),Ambiguous)
    def test_malformed_duplicate_json_and_missing_fields_refused(self):
        self.claim();p=self.root/'registry.json';p.write_text('{"schema":2,"schema":2}');self.unchanged_failure(lambda:self.claim('qa','background-qa'),Ambiguous)
        p.write_text('{bad json');self.unchanged_failure(lambda:self.claim('qa','background-qa'),Ambiguous)
        p.write_text('{}');self.unchanged_failure(lambda:self.claim('qa','background-qa'),Ambiguous)
    def test_foreign_or_live_legacy_record_preserved(self):
        p=self.root/'legacy.json';atomic_json(p,{'status':'running_user_review606','pid':35192,'activeRuntime':'fixture-only','owner':'do not touch real606'})
        self.unchanged_failure(lambda:self.claim(),Busy)
        atomic_json(p,{'status':'reserved_runtime_registry_v2','pid':None,'activeRuntime':'v2-managed','registryId':str(uuid.uuid4()),'registryPath':str(self.root/'foreign.json')});self.unchanged_failure(lambda:self.claim(),Ambiguous)
    def test_legacy_exclusive_handle_refuses_claim(self):
        before=self.snapshots()
        with exclusive_legacy(self.root/'legacy.json'):
            with self.assertRaises(Busy):self.claim()
        self.assertEqual(before,self.snapshots())
    def test_orphan_bridge_and_active_registry_without_bridge_fail_closed(self):
        self.claim();p=self.root/'registry.json';saved=p.read_bytes();p.unlink();self.unchanged_failure(lambda:self.claim('qa','background-qa'),Ambiguous)
        p.write_bytes(saved);atomic_json(self.root/'legacy.json',released_legacy());self.unchanged_failure(lambda:self.claim('qa','background-qa'),Ambiguous)
    def test_interrupted_first_commit_leaves_busy_bridge(self):
        with mock.patch('runtime_lease607.atomic_json',side_effect=OSError('offline injected disk fault')):
            with self.assertRaises(OSError): self.claim()
        self.assertEqual('reserved_runtime_registry_v2',json.loads((self.root/'legacy.json').read_text())['status']);self.unchanged_failure(lambda:self.claim(),Ambiguous)
    def test_disabled_production_migration_never_opens_legacy(self):
        c=json.loads(self.config.read_text());c['migrationEnabled']=False;atomic_json(self.config,c);manager=RuntimeLeases(self.config,probe=self.probe)
        with mock.patch('runtime_lease607.exclusive_legacy',side_effect=AssertionError('Must not open legacy')):
            self.unchanged_failure(lambda:manager.claim(specification(self.root),12345,str(self.root/'controller.exe')),Busy)
    def test_cross_process_claim_race(self):
        ctx=multiprocessing.get_context('spawn');start=ctx.Event();ready=ctx.Queue();results=ctx.Queue()
        cases=[('review-one','user-review'),('review-two','user-review'),('qa-one','background-qa'),('qa-two','background-qa'),('qa-three','background-qa')]
        workers=[ctx.Process(target=race_worker,args=(str(self.root),name,lane,start,ready,results)) for name,lane in cases]
        for w in workers:w.start()
        for _ in workers:ready.get(timeout=20)
        start.set();observed=[results.get(timeout=20) for _ in workers]
        for w in workers:w.join(10);self.assertEqual(0,w.exitcode)
        self.assertEqual(1,sum(r['ok'] and r['lane']=='user-review' for r in observed));self.assertEqual(2,sum(r['ok'] and r['lane']=='background-qa' for r in observed))
        atomic_json(self.root/'race-result.json',observed)
    def test_actual_cmd_validate_only_no_native_launch(self):
        build=self.root/'independent-build';addon=build/'addons/gepard';addon.mkdir(parents=True);(addon/'fixture.txt').write_text('This is not a mod and cannot launch a game.')
        manifest=build/'fixture-manifest.json';atomic_json(manifest,{'fixture.txt':sha(addon/'fixture.txt')});fake=build/'never-launched-game.exe';fake.write_bytes(b'OFFLINE NOT EXECUTABLE')
        spec={'schema':1,'label':'offline fixture','parallelApproved':True,'buildRoot':str(build),'addonPath':'addons/gepard','manifestPath':'fixture-manifest.json','manifestSHA256':sha(manifest),'fileCount':1,'gameExe':str(fake),'pythonExe':sys.executable,'addonId':'OFFLINE','world':'OFFLINE','worldSystemsConfig':'OFFLINE'}
        buildconfig=self.root/'fixture-build.json';atomic_json(buildconfig,spec)
        # The actual shipped CMD and Windows PowerShell parser are exercised.
        cmd=str(Path(os.environ['SystemRoot'])/'System32/cmd.exe')
        for extra in [[],['-Background']]:
            default=subprocess.run([cmd,'/d','/c',str(HERE/'Launch-Runtime607.cmd'),'-BuildConfig',str(buildconfig),*extra],capture_output=True,text=True,timeout=30,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            self.assertEqual(0,default.returncode,default.stdout+default.stderr);self.assertFalse(json.loads(default.stdout)['gameStarted'])
            result=subprocess.run([cmd,'/d','/c',str(HERE/'Launch-Runtime607.cmd'),'-BuildConfig',str(buildconfig),'-ValidateOnly',*extra],capture_output=True,text=True,timeout=30,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            self.assertEqual(0,result.returncode,result.stdout+result.stderr);data=json.loads(result.stdout);self.assertFalse(data['gameStarted']);self.assertFalse(data['registryMutated']);self.assertFalse(data['profileCreated']);self.assertFalse(data['migrationEnabled'])
        self.assertFalse((build/'runs-v2').exists());self.assertFalse((HERE/'state').exists())
        ps=str(Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe')
        for field,value in [('world','Worlds/a.ent" -profile other'),('addonId','x\n-profile'),('worldSystemsConfig','-profile'),('world',['a','b'])]:
            bad=copy.deepcopy(spec);bad[field]=value;atomic_json(buildconfig,bad)
            refused=subprocess.run([ps,'-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',str(HERE/'Launch-Runtime607.ps1'),'-BuildConfig',str(buildconfig),'-ValidateOnly'],capture_output=True,text=True,stdin=subprocess.DEVNULL,timeout=30,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            self.assertNotEqual(0,refused.returncode,field);self.assertIn('refused',(refused.stdout+refused.stderr).lower());self.assertFalse((build/'runs-v2').exists())
    def test_actual_windows_argument_quoting_trailing_backslash(self):
        value='C:\\folder with space\\'
        script='$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile($args[0],[ref]$tokens,[ref]$errors);$fn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Quote607"},$true);Invoke-Expression $fn.Extent.Text; Quote607 $args[1] | ConvertTo-Json -Compress'
        helper=self.root/'quote-fixture.ps1';helper.write_text(script,encoding='utf-8');ps=str(Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe')
        r=subprocess.run([ps,'-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',str(helper),str(HERE/'Launch-Runtime607.ps1'),value],capture_output=True,text=True,timeout=30,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        self.assertEqual(0,r.returncode,r.stderr);quoted=json.loads(r.stdout);self.assertEqual(value,split_windows_command_line('fake.exe '+quoted)[1])
    def test_current_helper_process_read_only_identity_probe(self):
        actual=CIMProbe()(os.getpid());self.assertEqual('found',actual['state']);self.assertEqual(os.getpid(),actual['processId']);self.assertEqual(os.path.normcase(os.path.realpath(sys.executable)),identity(actual)['exe']);self.assertTrue(actual['commandLine'])
    def test_receipt_output_refuses_existing_and_coordination_before_claim(self):
        spec=specification(self.root);existing=Path(spec['workRoot'])/'owner.json';existing.parent.mkdir(parents=True);existing.write_text('existing owner')
        for destination in [existing,self.root/'config.json',self.root/'registry.json',self.root/'legacy.json',self.root/'outside.json',Path(spec['profile'])/'owner.json']:
            self.unchanged_failure(lambda:self.manager.claim_to_file(spec,12345,str(self.root/'controller.exe'),destination),Ambiguous)
        self.assertEqual('existing owner',existing.read_text());self.assertFalse((self.root/'registry.json').exists())
    def test_receipt_exclusive_save_and_persistence_failure_keep_reservation(self):
        spec=specification(self.root);out=Path(spec['workRoot'])/'owner.json';result=self.manager.claim_to_file(spec,12345,str(self.root/'controller.exe'),out)
        self.assertNotIn('ownerKey',result);receipt=json.loads(out.read_text());self.assertEqual(result['leaseId'],receipt['leaseId']);self.assertTrue(receipt['ownerKey'])
        self.unchanged_failure(lambda:self.manager.claim_to_file(spec,12345,str(self.root/'controller.exe'),out),Ambiguous)
        self.manager.release(receipt);spec=specification(self.root,'qa','background-qa');out=Path(spec['workRoot'])/'owner.json';real=Path.open
        def disk_fault(path,*args,**kwargs):
            if path==out:raise OSError('offline exclusive receipt race/disk failure')
            return real(path,*args,**kwargs)
        with mock.patch.object(Path,'open',disk_fault):
            with self.assertRaises(Ambiguous):self.manager.claim_to_file(spec,12345,str(self.root/'controller.exe'),out)
        self.assertEqual('reserved',self.state()['leases'][-1]['state']);self.assertFalse(out.exists())

if __name__=='__main__':
    (HERE/'fixtures').mkdir(exist_ok=True)
    started=time.monotonic();suite=unittest.defaultTestLoader.loadTestsFromTestCase(OfflineFixtures607);result=unittest.TextTestRunner(verbosity=2).run(suite)
    report={'status':'passed' if result.wasSuccessful() else 'failed','testsRun':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'elapsedSeconds':round(time.monotonic()-started,3),'fixtureRoot':str(OfflineFixtures607.top),'actualNativeExecutablesLaunched':0,'productionLegacySlotWritten':False,'productionMigrationEnabled':False,'scope':'Actual Windows mutex/exclusive-handle and cross-process fixture race; injected process snapshots for native identity cases; actual CMD/PowerShell ValidateOnly for both lanes. No live game controls.'}
    atomic_json(HERE/'OFFLINE_FIXTURES607.json',report);sys.exit(not result.wasSuccessful())
