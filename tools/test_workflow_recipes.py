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

    def assert_each_gate_is_required(self,required,expected):
        passing={name:'PASS' for name in required}
        self.assertEqual(w.verdict(self.normalize(self.result(passing),required),required),'PASS')
        for gate in expected:
            for mode in ['missing','NOT_TESTED']:
                with self.subTest(gate=gate,mode=mode):
                    self.assertIn(gate,required)
                    values=dict(passing)
                    if mode=='missing':values.pop(gate)
                    else:values[gate]='NOT_TESTED'
                    result=self.normalize(self.result(values),required)
                    self.assertEqual(result['assertions'][gate]['status'],'NOT_TESTED')
                    self.assertTrue(all(row['status']=='PASS' for name,row in result['assertions'].items() if name!=gate))
                    self.assertEqual(w.verdict(result,required),'NOT_TESTED')
                    self.assertEqual(result['infrastructure']['status'],'PASS')

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
        self.assert_each_gate_is_required(required,['fixture.ready','terrain.data-integrity','terrain.visual-review',
                                                   'terrain.traversal','terrain.coverage'])

    def test_blender_render_and_static_fit_cannot_replace_native_or_motion(self):
        recipe=w.read_json(ROOT/'examples/workflows/asset-preparation-cases.example.json')
        required=recipe['requiredAssertions']+recipe['cases'][-1]['additionalAssertions']
        self.assert_each_gate_is_required(required,['fixture.ready','camera.readback','image.native','reference.attribution',
            'asset.source-contract','export.deterministic','geometry.semantic-preserved','geometry.native-topology',
            'materials.binding-scope','uv.valid','asset.motion-ownership','input.positive-control','crew.exit','crew.reentry','post-reentry.fire'])

    def test_insensitive_control_censors_attribution_and_keeps_infrastructure_distinct(self):
        stage=w.read_json(ROOT/'examples/workflows/terrain-cases.example.json')['stages'][1]
        self.assert_each_gate_is_required(stage['requiredAssertions'],['fixture.ready','camera.readback','image.native',
            'terrain.data-integrity','terrain.control-sensitive','terrain.surface-parity'])

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

    def recipe_init(self,*options):
        target=self.root/'recipe-job.json'
        args=['init','--project',str(self.root/'addon.gproj'),'--world','QA.ent',
              '--adapter',str(self.adapter),'--executable',sys.executable,'--addons-root',str(self.root),
              '--output',str(target),*options]
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):code=w.main(args)
        return code,target

    def test_asset_recipe_copies_case_parameters_and_additional_gates_without_manual_lists(self):
        code,file=self.recipe_init('--recipe','asset-preparation')
        self.assertEqual(code,0);job=w.read_json(file)
        self.assertEqual(job['template'],'visual');self.assertEqual(len(job['cases']),4)
        self.assertIn('purpose',job['cases'][1]['parameters'])
        self.assertIn('asset.native-coordinate-parity',job['cases'][1]['assertions'])
        self.assertIn('asset.motion-ownership',job['cases'][-1]['assertions'])
        self.assertEqual(job['requiredFiles'][0]['sha256'],w.sha(w.RECIPES['asset-preparation']))
        w.plan(file)

    def test_terrain_stage_copies_all_promotion_gates_and_matrix_cases(self):
        code,file=self.recipe_init('--recipe','terrain','--stage','playable-reference-block')
        self.assertEqual(code,0);job=w.read_json(file)
        self.assertEqual(job['template'],'terrain');self.assertEqual(len(job['cases']),3)
        for case in job['cases']:
            self.assertTrue({'terrain.geographic-confidence','terrain.regeneration','terrain.performance'}<=set(case['assertions']))
        w.plan(file)

    def test_initialized_diagnostic_cases_require_control_sensitivity(self):
        code,file=self.recipe_init('--recipe','terrain','--stage','surface-diagnostic')
        self.assertEqual(code,0);job=w.read_json(file)
        self.assertEqual(len(job['cases']),4)
        for case in job['cases']:
            with self.subTest(case=case['id']):
                self.assertIn('terrain.control-sensitive',case['assertions'])
                self.assertIn('terrain.surface-parity',case['assertions'])
        w.plan(file)

    def test_recipe_case_selection_preserves_selected_assertions_and_rejects_unknowns(self):
        code,file=self.recipe_init('--recipe','asset-preparation','--case','moving-owner-regression')
        self.assertEqual(code,0);job=w.read_json(file)
        self.assertEqual([case['id'] for case in job['cases']],['moving-owner-regression'])
        self.assertIn('post-reentry.fire',job['cases'][0]['assertions'])
        file.unlink()
        code,file=self.recipe_init('--recipe','asset-preparation','--case','invented')
        self.assertEqual(code,2);self.assertFalse(file.exists())

    def test_ambiguous_stage_template_conflict_and_duplicate_selection_fail_before_creation(self):
        options=[[],['--recipe','terrain'],['--template','terrain','--stage','playable-reference-block'],
                 ['--recipe','terrain','--stage','missing'],['--recipe','asset-preparation','--stage','anything'],
                 ['--recipe','asset-preparation','--template','startup'],
                 ['--recipe','asset-preparation','--case','moving-owner-regression','--case','moving-owner-regression']]
        for args in options:
            with self.subTest(args=args):
                code,file=self.recipe_init(*args);self.assertEqual(code,2);self.assertFalse(file.exists())

    def test_recipe_drift_is_pinned_and_cannot_silently_change_a_job(self):
        copy=self.root/'recipe.json';copy.write_bytes(w.RECIPES['asset-preparation'].read_bytes())
        with patch.dict(w.RECIPES,{'asset-preparation':copy}):
            code,file=self.recipe_init('--recipe','asset-preparation')
            self.assertEqual(code,0);w.plan(file)
            copy.write_bytes(copy.read_bytes()+b' ')
            with self.assertRaisesRegex(w.WorkflowError,'Pinned file differs'):w.plan(file)

    def test_recipe_mode_preserves_exclusive_creation(self):
        code,file=self.recipe_init('--recipe','asset-preparation');self.assertEqual(code,0)
        before=file.read_bytes()
        code,_=self.recipe_init('--recipe','terrain','--stage','playable-reference-block')
        self.assertEqual(code,2);self.assertEqual(file.read_bytes(),before)

    def test_malformed_recipe_or_missing_mandatory_gate_rejects_before_creation(self):
        copy=self.root/'recipe.json';recipe=w.read_json(w.RECIPES['asset-preparation'])
        broken=dict(recipe);broken['requiredAssertions']=['fixture.ready']
        for value in [[],broken]:
            copy.write_text(json.dumps(value))
            with patch.dict(w.RECIPES,{'asset-preparation':copy}):
                code,file=self.recipe_init('--recipe','asset-preparation')
                self.assertEqual(code,2);self.assertFalse(file.exists())

    def test_recipe_change_during_read_cannot_pin_different_cases(self):
        copy=self.root/'recipe.json';copy.write_bytes(w.RECIPES['asset-preparation'].read_bytes())
        original=w.read_json
        def changed(file):
            value=original(file)
            if Path(file)==copy:copy.write_bytes(copy.read_bytes()+b' ')
            return value
        with patch.dict(w.RECIPES,{'asset-preparation':copy}),patch.object(w,'read_json',side_effect=changed):
            code,file=self.recipe_init('--recipe','asset-preparation')
            self.assertEqual(code,2);self.assertFalse(file.exists())


if __name__=='__main__':unittest.main()
