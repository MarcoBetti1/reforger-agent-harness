import copy
import math
import json
from pathlib import Path
import tempfile
import unittest

import driving_review as review


def course(change=None):
    lines=[];ident=0;position=0
    for phase in ('idle','forward','stop-forward','reverse','stop-reverse','left','right','final-stop'):
        for tick in range(6):
            ident+=1
            speed=2 if phase in ('forward','left','right') else -2 if phase=='reverse' else 0
            position+=speed*.5
            values={'sample':ident,'phase':phase,'worldMs':ident*500,'timeScale':1,'engine':1,'rpm':1000,'load':.6,'gear':2,
                    'position':f'<0,0,{position}>','forward':'<0,0,1>','velocity':f'<0,0,{speed}>','yawRate':.2 if phase=='left' else -.2 if phase=='right' else 0,'gradeDegrees':0,
                    'throttle':1 if phase in ('forward','left','right') else 0,'brake':1 if phase=='reverse' else 0,'steer':0,'actionThrottle':1 if speed>0 else 0,'actionBrake':1 if speed<0 else 0,'actionSteer':-1 if phase=='left' else 1 if phase=='right' else 0,
                    'leftRPM':60,'rightRPM':60,'leftRadius':.35,'rightRadius':.35,'leftContact':1,'rightContact':1,'controlled':1,'occupied':1}
            if change:change(values)
            fields={'STATE':('sample','phase','worldMs','timeScale','engine','rpm','load','gear'),
                    'MOTION':('sample','position','forward','velocity','yawRate','gradeDegrees'),
                    'CONTROL':('sample','throttle','brake','steer','actionThrottle','actionBrake','actionSteer'),
                    'WHEELS':('sample','leftRPM','rightRPM','leftRadius','rightRadius','leftContact','rightContact'),
                    'ADMISSION':('sample','controlled','occupied')}
            for tag,keys in fields.items():lines.append('QA_DRIVE_'+tag+' '+' '.join(f'{key}={values[key]}' for key in keys))
    return '\n'.join(lines)


class DrivingTests(unittest.TestCase):
    def test_native_contract_metrics_and_unqualified_domains(self):
        result=review.analyze(course())
        self.assertEqual(result['status'],'PASS')
        self.assertEqual(result['metrics']['forward']['signedProgressMetres'],5)
        self.assertEqual(result['metrics']['reverse']['signedProgressMetres'],-5)
        self.assertAlmostEqual(result['metrics']['left']['medianMovingTurnRadiusMetres'],10)
        self.assertEqual(result['assertions']['drive.slope']['status'],'NOT_TESTED')
        self.assertEqual(result['assertions']['drive.slip']['status'],'NOT_TESTED')

    def test_movement_with_engine_off_cannot_pass_powered(self):
        result=review.analyze(course(lambda v:v.update(engine=0,rpm=0,load=0)))
        self.assertEqual(result['assertions']['drive.powered']['status'],'FAIL')

    def test_unqualified_solver_getter_is_retained_without_inventing_input_proof(self):
        result=review.analyze(course(lambda v:v.update(brake=6)))
        self.assertEqual(result['assertions']['drive.control-readback']['status'],'NOT_TESTED')
        self.assertFalse(result['assertions']['drive.control-readback']['actual']['allWithinDocumentedZeroToOneRange'])
        with self.assertRaisesRegex(ValueError,'controlled driver'):review.analyze(course(lambda v:v.update(controlled=0)))

    def test_downhill_drifting_baseline_cannot_pass_powered(self):
        result=review.analyze(course(lambda v:v.update(velocity='<0,0,2>',gradeDegrees=8) if v['phase']=='idle' else None))
        self.assertEqual(result['assertions']['drive.powered']['status'],'FAIL')

    def test_requested_steering_without_rotation_does_not_pass(self):
        result=review.analyze(course(lambda v:v.update(yawRate=0)))
        self.assertEqual(result['assertions']['drive.turn-radius']['status'],'FAIL')

    def test_scaled_clock_gap_and_incomplete_samples_are_infrastructure_errors(self):
        for text in (course(lambda v:v.update(timeScale=.5)),course().replace('worldMs=1000','worldMs=500'),course().split('\n',1)[1]):
            with self.subTest(text=text[:70]),self.assertRaises(ValueError):review.analyze(text)

    def test_reverse_and_stop_fail_from_actual_telemetry(self):
        result=review.analyze(course(lambda v:v.update(position='<0,0,0>',velocity='<0,0,2>') if v['phase'] in ('reverse','final-stop') else None))
        self.assertEqual(result['assertions']['drive.reverse']['status'],'FAIL')
        self.assertEqual(result['assertions']['drive.stop-dwell']['status'],'FAIL')

    def test_closed_circle_cannot_be_forward_progress(self):
        def circle(v):
            if v['phase']!='forward':return
            angle=(v['sample']-7)*2*math.pi/5
            v.update(position=f'<{math.cos(angle)},0,{math.sin(angle)}>',forward=f'<{-math.sin(angle)},0,{math.cos(angle)}>')
        result=review.analyze(course(circle))
        self.assertEqual(result['assertions']['drive.signed-progress']['status'],'FAIL')
        self.assertEqual(result['assertions']['drive.powered']['status'],'FAIL')
        self.assertAlmostEqual(result['metrics']['forward']['signedProgressMetres'],0)
        self.assertGreater(result['metrics']['forward']['integratedFacingProjectedPathMetres'],1)

    def test_reverse_and_turns_require_their_own_power_and_actual_actions(self):
        result=review.analyze(course(lambda v:v.update(engine=0,rpm=0,load=0,actionThrottle=0,actionBrake=0,actionSteer=0) if v['phase'] in ('reverse','left','right') else None))
        self.assertEqual(result['assertions']['drive.reverse']['status'],'FAIL')
        self.assertEqual(result['assertions']['drive.turn-radius']['status'],'FAIL')

    def test_reordered_and_reentered_phases_do_not_establish_terminal_stop(self):
        for change in (lambda v:v.update(phase='final-stop') if v['phase']=='idle' else v.update(phase='idle') if v['phase']=='final-stop' else None,
                       lambda v:v.update(phase='idle') if v['sample']==14 else None):
            with self.assertRaisesRegex(ValueError,'contiguous'):review.analyze(course(change))

    def test_power_and_motion_must_overlap_continuously(self):
        def disjoint(v):
            if v['phase']!='forward':return
            if v['sample']<=9:v.update(position='<0,0,0>',velocity='<0,0,0>')
            else:v.update(engine=0,rpm=0,load=0,actionThrottle=0)
        result=review.analyze(course(disjoint))
        self.assertEqual(result['assertions']['drive.powered']['status'],'FAIL')

    def test_falling_or_ungrounded_stop_is_not_stationary_acceptance(self):
        for change in (lambda v:v.update(velocity='<0,-10,0>') if v['phase']=='final-stop' else None,
                       lambda v:v.update(leftContact=0,rightContact=0) if v['phase']=='final-stop' else None):
            result=review.analyze(course(change))
            self.assertEqual(result['assertions']['drive.stop-dwell']['status'],'FAIL')

    def test_cli_keeps_protocol_error_distinct_from_measured_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'console.log';output=root/'result.json'
            source.write_text('no native samples')
            self.assertEqual(review.main(['--console',str(source),'--output',str(output)]),2)
            self.assertEqual(json.loads(output.read_text())['status'],'NOT_TESTED')
            with self.assertRaises(FileExistsError):review.main(['--console',str(source),'--output',str(output)])


if __name__=='__main__':unittest.main()
