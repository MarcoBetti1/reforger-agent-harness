from pathlib import Path
import json
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import workflow as w

ADAPTER = '''import json,sys,time
from pathlib import Path
request,result,cancel=map(Path,sys.argv[1:])
r=json.loads(request.read_text()); mode=r['parameters'].get('mode','pass')
if mode=='wait':
 while not cancel.exists(): time.sleep(.02)
if mode=='late': time.sleep(3)
if mode=='noisy': print('x'*4096,flush=True)
e=result.parent/'native.log';e.write_text('Synthetic coordinator fixture; not engine evidence')
out={'schema':1,'runId':r['runId'],'caseId':r['caseId'],
 'infrastructure':{'status':'PASS','reason':'synthetic fixture'},
 'assertions':{k:{'status':'PASS','reason':'synthetic fixture'} for k in r['assertions']},
 'lifecycle':{'status':'PASS','reason':'synthetic closure','verifiedExited':True,'leaseReleased':True},
 'evidence':[str(e)]}
if mode=='fail': out['assertions']['fixture.ready']['status']='FAIL'
if mode=='infra': out['infrastructure']['status']='NOT_TESTED'
if mode=='stale': out['runId']='prior-run'
if mode=='missing': del out['assertions']['world.loaded']
if mode=='lease': out['lifecycle']['leaseReleased']=False
if mode=='malformed': out['assertions']['fixture.ready']['reason']=''
result.write_text(json.dumps(out))
'''


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root/'scripts').mkdir()
        (self.root/'scripts/probe.c').write_text('class ProbeClass : GenericEntity {}')
        (self.root/'Scene.ent').write_text('ProbeClass {}')
        (self.root/'addon.gproj').write_text('GameProject { GUID "0123456789ABCDEF" }')
        (self.root/'adapter.py').write_text(ADAPTER)
        self.job = {'schema':1,'template':'startup','project':'addon.gproj','world':'Scene.ent',
                    'sourceRoots':['.'],'addonRoots':['.'],'requiredFiles':[{'path':'Scene.ent'}],'requiredClasses':['ProbeClass'],
                    'capabilities':['isolated-reset','owned-lifecycle','native-load'],
                    'adapter':{'executable':sys.executable,'script':'adapter.py','args':['{script}','{request}','{result}','{cancel}']},
                    'cases':[self.case('first'),self.case('second')], 'timeoutSeconds':3,'closeGraceSeconds':2}
        self.path = self.root/'job.json'
        self.write_job()

    def case(self, name, mode='pass'):
        return {'id':name,'parameters':{'mode':mode},'assertions':['fixture.ready','world.loaded']}

    def write_job(self):
        self.path.write_text(json.dumps(self.job))

    def run_job(self):
        return w.run(self.path,self.root/'batch',execute=True)

    def test_dry_plan_checks_inputs_without_outputs_or_spawn(self):
        with patch('workflow.subprocess.Popen',side_effect=AssertionError('spawn')):
            out=w.run(self.path,self.root/'batch')
        self.assertEqual(out['status'],'NOT_TESTED')
        self.assertFalse((self.root/'batch').exists())
        self.assertEqual(out['classDefinitions']['ProbeClass'],[str((self.root/'scripts/probe.c').resolve())])

    def test_missing_spawn_class_stops_before_launch(self):
        (self.root/'scripts/probe.c').write_text('// class ProbeClass {}')
        with self.assertRaisesRegex(w.WorkflowError,'class missing'):
            self.run_job()
        self.assertFalse((self.root/'batch').exists())

    def test_missing_world_or_wrong_pin(self):
        self.job['world']='Absent.ent';self.write_job()
        with self.assertRaisesRegex(w.WorkflowError,'World not found'):w.plan(self.path)
        self.job['world']='Scene.ent';self.job['requiredFiles'][0]['sha256']='0'*64;self.write_job()
        with self.assertRaisesRegex(w.WorkflowError,'Pinned file differs'):w.plan(self.path)

    def test_missing_capability_and_mandatory_assertion(self):
        self.job['capabilities'].remove('native-load');self.write_job()
        with self.assertRaisesRegex(w.WorkflowError,'capabilities'):w.plan(self.path)
        self.job['capabilities'].append('native-load');self.job['cases'][0]['assertions']=['fixture.ready'];self.write_job()
        with self.assertRaisesRegex(w.WorkflowError,'mandatory'):w.plan(self.path)

    def test_measured_failure_preserved_and_next_case_runs(self):
        self.job['cases'][0]=self.case('first','fail');self.write_job()
        out=self.run_job()
        self.assertEqual(out['status'],'FAIL')
        self.assertEqual([r['status'] for r in out['cases']],['FAIL','PASS'])
        self.assertTrue((self.root/'batch/index.md').is_file())

    def test_infrastructure_stops_next_case(self):
        self.job['cases'][0]=self.case('first','infra');self.write_job()
        out=self.run_job()
        self.assertEqual(out['status'],'NOT_TESTED')
        self.assertEqual(out['notStarted'],['second'])

    def test_stale_result_never_passes(self):
        self.job['cases'][0]=self.case('first','stale');self.write_job()
        out=self.run_job()
        self.assertEqual(out['cases'][0]['status'],'NOT_TESTED')
        self.assertIn('identity',out['cases'][0]['infrastructure']['reason'])

    def test_missing_assertion_is_not_tested(self):
        self.job['cases'][0]=self.case('first','missing');self.write_job()
        out=self.run_job()
        self.assertEqual(out['cases'][0]['status'],'NOT_TESTED')
        self.assertEqual(len(out['cases']),2)

    def test_lifecycle_blocks_next_case_even_after_behavior_pass(self):
        self.job['cases'][0]=self.case('first','lease');self.write_job()
        out=self.run_job()
        self.assertEqual(out['cases'][0]['status'],'PASS')
        self.assertEqual(out['status'],'NOT_TESTED')
        self.assertEqual(out['notStarted'],['second'])

    def test_reason_required(self):
        self.job['cases'][0]=self.case('first','malformed');self.write_job()
        self.assertEqual(self.run_job()['status'],'NOT_TESTED')

    def test_cooperative_cancel_preserves_closure_but_censors_behavior(self):
        self.job['cases'][0]=self.case('first','wait');self.write_job()
        stop=self.root/'STOP'
        timer=threading.Timer(.3,lambda:stop.write_text('human stop'))
        timer.start();self.addCleanup(timer.join)
        out=w.run(self.path,self.root/'batch',True,stop)
        self.assertEqual(out['status'],'NOT_TESTED')
        self.assertEqual(out['notStarted'],['second'])
        self.assertTrue(out['cases'][0]['lifecycle']['leaseReleased'])
        self.assertTrue((self.root/'batch/first/CANCEL').exists())

    def test_deadline_requests_cooperative_close(self):
        self.job['cases']=[self.case('first','wait')];self.job['timeoutSeconds']=1;self.write_job()
        out=self.run_job()
        self.assertEqual(out['status'],'NOT_TESTED')
        self.assertEqual(out['stopReason'],'deadline')

    def test_unresponsive_adapter_is_preserved_and_reported(self):
        self.job['cases'][0]=self.case('first','late');self.job['timeoutSeconds']=1;self.job['closeGraceSeconds']=1;self.write_job()
        out=self.run_job()
        self.assertEqual(out['status'],'NOT_TESTED')
        self.assertIn('adapter still alive',out['stopReason'])
        self.assertEqual(out['notStarted'],['second'])
        self.assertTrue((self.root/'batch/first/adapter-owner.json').exists())
        # Synthetic child exits itself. The coordinator never kills it.
        time.sleep(1.4)

    def test_rerun_never_overwrites_and_fresh_rerun_is_allowed(self):
        self.assertEqual(self.run_job()['status'],'PASS')
        before=w.sha(self.root/'batch/summary.json')
        with self.assertRaisesRegex(w.WorkflowError,'Fresh batch'):self.run_job()
        self.assertEqual(w.sha(self.root/'batch/summary.json'),before)
        out=w.run(self.path,self.root/'fresh',True,only=['second'])
        self.assertEqual(len(out['cases']),1)

    def test_pin_change_stops_before_next_case(self):
        planned=w.plan(self.path)
        (self.root/'Scene.ent').write_text('changed')
        with self.assertRaisesRegex(w.WorkflowError,'Input changed'):w.verify_pins(planned)

    def test_duplicate_json_and_nonfinite_values_rejected(self):
        self.path.write_text('{"schema":1,"schema":1}')
        with self.assertRaisesRegex(w.WorkflowError,'Duplicate'):w.read_json(self.path)
        self.path.write_text('{"number":NaN}')
        with self.assertRaisesRegex(w.WorkflowError,'Nonfinite'):w.read_json(self.path)

    def test_low_space_refuses_before_writes_or_launch(self):
        with patch('workflow.shutil.disk_usage',return_value=type('Usage',(),{'free':0})()):
            with self.assertRaisesRegex(w.WorkflowError,'2 GiB'):self.run_job()
        self.assertFalse((self.root/'batch').exists())

    def test_noisy_adapter_censors_and_stops_batch(self):
        self.job['cases'][0]=self.case('first','noisy');self.write_job()
        with patch('workflow.MAX_ADAPTER_LOG_BYTES',64):out=self.run_job()
        self.assertEqual(out['status'],'NOT_TESTED')
        self.assertIn('adapter-log-limit',out['stopReason'])
        self.assertEqual(out['notStarted'],['second'])

    def test_missing_base_dependency_and_duplicate_guid(self):
        project=self.root/'addon.gproj'
        project.write_text('GameProject { GUID "0123456789ABCDEF" Dependencies { "AAAAAAAAAAAAAAAA" } }')
        with self.assertRaisesRegex(w.WorkflowError,'Missing mounted dependency'):w.plan(self.path)
        (self.root/'base').mkdir()
        (self.root/'base/base.gproj').write_text('GameProject { GUID "AAAAAAAAAAAAAAAA" }')
        self.assertEqual(len(w.plan(self.path)['dependencies']),2)
        (self.root/'base/duplicate.gproj').write_text('GameProject { GUID "AAAAAAAAAAAAAAAA" }')
        with self.assertRaisesRegex(w.WorkflowError,'Duplicate mounted'):w.plan(self.path)


if __name__=='__main__':unittest.main()
