"""Recipe integration and misleading-success regressions; no engine or Blender."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import workflow as w

ROOT=Path(w.__file__).resolve().parents[1]


class RecipeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        (self.root/'addon.gproj').write_text('GameProject { GUID "0123456789ABCDEF" }')
        (self.root/'QA.ent').write_text('GenericEntity {}')
        self.adapter=ROOT/'examples/workflows/adapter_scaffold.py'

    def init(self,template='terrain'):
        target=self.root/'job.json'
        argv=['init','--template',template,'--project',str(self.root/'addon.gproj'),
              '--world','QA.ent','--adapter',str(self.adapter),'--executable',sys.executable,
              '--addons-root',str(self.root),'--output',str(target)]
        with contextlib.redirect_stdout(io.StringIO()):self.assertEqual(w.main(argv),0)
        return target

    def result(self,assertions):
        return {'schema':1,'runId':'replay','caseId':'recorded',
                'infrastructure':{'status':'PASS','reason':'Synthetic result transport; not a new native test'},
                'assertions':{name:{'status':status,'reason':'Saved-evidence regression example'} for name,status in assertions.items()},
                'lifecycle':{'status':'PASS','reason':'No renderer in this fixture','verifiedExited':True,'leaseReleased':True},
                'evidence':['evidence.txt']}

    def normalize(self,result,required):
        (self.root/'evidence.txt').write_text('Synthetic transport, not native qualification')
        request={'runId':'replay','caseId':'recorded','attemptDir':str(self.root),'assertions':required}
        return w.validate_result(result,request)

    def test_terrain_init_uses_real_entrypoint_and_plans_from_unrelated_cwd(self):
        job=self.init();previous=os.getcwd()
        try:
            os.chdir(self.root)
            with patch.object(w.subprocess,'Popen',side_effect=AssertionError('planning must not spawn')):
                plan=w.plan(job)
        finally:os.chdir(previous)
        self.assertEqual(plan['template'],'terrain')
        self.assertIn('terrain.visual-review',plan['cases'][0]['assertions'])
        self.assertIn('terrain.traversal',plan['cases'][0]['assertions'])
        self.assertIn('terrain.coverage',plan['cases'][0]['assertions'])

    def test_import_only_job_cannot_drop_terrain_acceptance_gates(self):
        job=self.init();value=w.read_json(job)
        value['cases'][0]['assertions']=['fixture.ready','terrain.data-integrity']
        job.write_text(json.dumps(value))
        with self.assertRaisesRegex(w.WorkflowError,'mandatory'):w.plan(job)

    def test_normal_resource_repair_cannot_hide_visual_rejection(self):
        required=w.read_json(w.TEMPLATES)['terrain']['requiredAssertions']
        values={name:'PASS' for name in required};values['terrain.visual-review']='FAIL'
        result=self.normalize(self.result(values),required)
        self.assertEqual(w.verdict(result,required),'FAIL')
        self.assertEqual(result['assertions']['terrain.data-integrity']['status'],'PASS')
        self.assertEqual(result['infrastructure']['status'],'PASS')

    def test_untested_ground_routes_and_coverage_never_pass_from_data_flags(self):
        required=w.read_json(w.TEMPLATES)['terrain']['requiredAssertions']
        values={name:'PASS' for name in required if name not in {'terrain.traversal','terrain.coverage'}}
        result=self.normalize(self.result(values),required)
        self.assertEqual(w.verdict(result,required),'NOT_TESTED')

    def test_blender_render_and_static_fit_cannot_replace_native_or_motion(self):
        recipe=w.read_json(ROOT/'examples/workflows/asset-preparation-cases.example.json')
        required=recipe['requiredAssertions']+recipe['cases'][-1]['additionalAssertions']
        values={name:'PASS' for name in required if name not in {'image.native','asset.motion-ownership'}}
        self.assertEqual(w.verdict(self.normalize(self.result(values),required),required),'NOT_TESTED')

    def test_insensitive_control_censors_attribution_and_keeps_infrastructure_distinct(self):
        stage=w.read_json(ROOT/'examples/workflows/terrain-cases.example.json')['stages'][1]
        values={name:'PASS' for name in stage['requiredAssertions']}
        values['terrain.control-sensitive']='NOT_TESTED';values['terrain.surface-parity']='NOT_TESTED'
        result=self.normalize(self.result(values),stage['requiredAssertions'])
        self.assertEqual(w.verdict(result,stage['requiredAssertions']),'NOT_TESTED')
        self.assertEqual(result['infrastructure']['status'],'PASS')

    def test_examples_cover_template_minimums_with_unique_safe_case_ids(self):
        templates=w.read_json(w.TEMPLATES)
        asset=w.read_json(ROOT/'examples/workflows/asset-preparation-cases.example.json')
        stages=[asset,*w.read_json(ROOT/'examples/workflows/terrain-cases.example.json')['stages']]
        for stage in stages:
            self.assertTrue(set(templates[stage['template']]['requiredAssertions'])<=set(stage['requiredAssertions']))
            ids=[case['id'] for case in stage['cases']]
            self.assertEqual(len(ids),len(set(ids)));self.assertTrue(all(w.LABEL.fullmatch(name) for name in ids))

    def test_new_terrain_job_with_existing_inert_scaffold_reports_not_tested(self):
        job=self.init()
        with contextlib.redirect_stdout(io.StringIO()):result=w.run(job,self.root/'evidence',execute=True)
        self.assertEqual(result['status'],'NOT_TESTED')
        self.assertEqual(len(result['cases']),1)
        detail=w.read_json(self.root/'evidence'/result['cases'][0]['result'])
        self.assertEqual(detail['infrastructure']['status'],'NOT_TESTED')


if __name__=='__main__':unittest.main()
