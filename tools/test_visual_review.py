import contextlib
import copy
import io
import json
import math
import re
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import build_neutral_review_stage as stage
import visual_review as review

EXAMPLE = Path(__file__).resolve().parents[1]/"examples/visual-review.recipe.json"


def telemetry(recipe, frame, **overrides):
    station = frame["station"]
    origin = recipe["stageOrigin"]
    eye = [a+b for a, b in zip(origin, station["eye"])]
    diff = [a-b for a, b in zip(station["target"], station["eye"])]
    length = math.sqrt(sum(v*v for v in diff))
    forward=[v/length for v in diff];horizontal=math.hypot(forward[0],forward[2])
    right=[forward[2]/horizontal,0,-forward[0]/horizontal]
    up=[forward[1]*right[2],forward[2]*right[0]-forward[0]*right[2],-forward[1]*right[0]]
    fmt = lambda v: "<"+",".join(map(str,v))+">"
    lighting = recipe["presets"][frame["preset"]]
    state = {"weather":lighting["weather"], "hour":lighting["hour"], "wetness":0,
             "rain":0, "cracks":0, "puddles":0, "fov":recipe["FOV_degrees"], "exposure":frame["exposure"]}
    state.update(overrides)
    return "\n".join([
        f"GVR_ENV_ACTUAL label={frame['label']} preset={frame['preset']} "+" ".join(f"{k}={state[k]}" for k in ("weather","hour","wetness","rain","cracks","puddles")),
        f"GVR_CAMERA label={frame['label']} eye={fmt(eye)} right={fmt(right)} up={fmt(up)} forward={fmt(forward)} fov={state['fov']} exposure={state['exposure']}",
        f"GVR_BODY label={frame['label']} origin={fmt(origin)} right=<1,0,0> up=<0,1,0> forward=<0,0,1>",
    ])


class VisualReviewTests(unittest.TestCase):
    def setUp(self):
        self.recipe = review.validate_recipe(review.read_json(EXAMPLE))
        self.frame = review.make_plan(self.recipe,"representative","soft","test")[0]

    def test_dry_run_never_queries_process_or_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/"unused"
            with patch.object(review,"execute",side_effect=AssertionError("live execution")), contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(review.main(["--recipe",str(EXAMPLE),"--output",str(target)]),0)
            self.assertFalse(target.exists())
            self.assertTrue(json.loads(output.getvalue())["dryRun"])

    def test_nonfinite_and_duplicate_stations_rejected(self):
        for change in (lambda r:r["stations"][0]["eye"].__setitem__(0,float("nan")),
                       lambda r:r["stations"].append(copy.deepcopy(r["stations"][0]))):
            recipe=copy.deepcopy(self.recipe);change(recipe)
            with self.assertRaises(ValueError):review.validate_recipe(recipe)

    def test_command_injection_label_rejected(self):
        with self.assertRaises(ValueError):review.make_plan(self.recipe,"all","soft","bad|frame")

    def test_raw_pixel_budget_rejected(self):
        recipe=copy.deepcopy(self.recipe);recipe["resolution"]=[3840,2160]
        recipe["stations"].append(recipe["stations"][0]|{"name":"extra"})
        with self.assertRaisesRegex(ValueError,"512 MiB"):review.make_plan(recipe,"all","soft","test")

    def test_actual_readbacks_required(self):
        actual=review.readback(telemetry(self.recipe,self.frame),self.recipe,self.frame)
        self.assertEqual(actual["CAMERA"]["exposure"],.04)
        with self.assertRaises(ValueError):review.readback("GVR_ACK op=frame",self.recipe,self.frame)

    def test_weather_exposure_fov_and_dry_state_must_match(self):
        for override in ({"weather":"Clear"},{"hour":8},{"rain":.01},{"wetness":.01},{"fov":60},{"exposure":.02}):
            with self.subTest(override=override),self.assertRaises(ValueError):
                review.readback(telemetry(self.recipe,self.frame,**override),self.recipe,self.frame)

    def test_root_and_camera_drift_rejected(self):
        text=telemetry(self.recipe,self.frame)
        for old,new in (("right=<1,0,0>","right=<.99,.1,0>"),("eye=<606,203.2,2607>","eye=<607,203.2,2607>"),("origin=<600,200,2600>","origin=<600,201,2600>")):
            with self.subTest(field=old),self.assertRaises(ValueError):review.readback(text.replace(old,new),self.recipe,self.frame)

    def test_project_pose_requires_actual_deployment(self):
        frame=copy.deepcopy(self.frame);frame["station"]["pose"]="deployed"
        text=telemetry(self.recipe,frame)
        with self.assertRaises(ValueError):review.readback(text,self.recipe,frame)
        review.readback(text+f"\nGVR_RADAR label={frame['label']} deployment=1 sweep=180",self.recipe,frame)

    def test_camera_roll_drift_rejected(self):
        lines=telemetry(self.recipe,self.frame).splitlines()
        lines=[re.sub(r"right=<[^>]+>","right=<1,0,0>",line) if line.startswith("GVR_CAMERA") else line for line in lines]
        with self.assertRaises(ValueError):review.readback("\n".join(lines),self.recipe,self.frame)

    def test_camera_basis_matches_engine_look_at_convention(self):
        frame=copy.deepcopy(self.frame);frame['station'].update(eye=[1,2,0],target=[0,1,0])
        name=frame['label']
        text=f'''GVR_ENV_ACTUAL label={name} preset=soft weather=Overcast hour=12 wetness=0 rain=0 cracks=0 puddles=0
GVR_CAMERA label={name} eye=<601,202,2600> right=<0,0,1> up=<-0.70710678,0.70710678,0> forward=<-0.70710678,-0.70710678,0> fov=55 exposure=0.04
GVR_BODY label={name} origin=<600,200,2600> right=<1,0,0> up=<0,1,0> forward=<0,0,1>'''
        review.readback(text,self.recipe,frame)

    def test_nonfinite_native_values_rejected(self):
        for value in ("NaN","inf","-inf"):
            with self.assertRaises(ValueError):review.parse_fields("exposure="+value)

    def test_owner_requires_live_pid_and_contained_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);owner={"pid":123,"run":str(root),"profile":str(root/"profile"),"logs":str(root/"logs"),"exe":str(root/"game.exe"),"creationUtc":"2026-01-01T00:00:00Z"}
            path=root/"owner.json";path.write_text(json.dumps(owner));review.load_owner(path)
            for change in ({"pid":True},{"stoppedUtc":"2026-01-01T00:00:01Z"},{"logs":str(root.parent/"unowned")}):
                path.write_text(json.dumps(owner|change))
                with self.assertRaises(ValueError):review.load_owner(path)

    def test_output_cannot_escape_owned_root(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for target in (root,root/".."/"unowned"):
                with self.assertRaises(ValueError):review.contained(root,target)

    def test_normal_user_profile_rejected_even_under_broad_run(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);profile=root/"Documents/My Games/ArmaReforger/profile"
            owner={"pid":123,"run":str(root),"profile":str(profile),"logs":str(root/"logs"),"exe":str(root/"game.exe"),"creationUtc":"2026-01-01T00:00:00Z"}
            path=root/"owner.json";path.write_text(json.dumps(owner))
            with patch.object(Path,"home",return_value=root),self.assertRaises(ValueError):review.load_owner(path)

    def test_saved_png_retains_pixels_and_refuses_overwrite(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);bmp=root/"frame.bmp";png=root/"frame.png"
            image=Image.new("RGB",(320,240),(128,128,128));image.putpixel((10,10),(1,2,3));image.save(bmp)
            result=review.save_pixels(bmp,png,[320,240]);self.assertTrue(result["losslessNativePixels"])
            with self.assertRaises(FileExistsError):review.save_pixels(bmp,png,[320,240])
            with self.assertRaises(ValueError):review.save_pixels(bmp,root/"wrong.png",[640,480])

    def test_stage_geometry_has_upward_floor_and_inward_wall(self):
        vertices,faces=stage.geometry()
        self.assertEqual((len(vertices),len(faces)),(1793,1792))
        self.assertAlmostEqual(max(v[2] for v in vertices),32)
        def normal(face):
            a,b,c=[vertices[i] for i in face[:3]]
            u=[y-x for x,y in zip(a,b)];v=[y-x for x,y in zip(a,c)]
            return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        self.assertGreater(normal(faces[0])[2],0)
        self.assertLess(normal(faces[-128])[0],0)


if __name__=="__main__":unittest.main()
