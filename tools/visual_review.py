"""Fixed-recipe native review capture. Attaches only to a verified owned fixture.

The addon owns its world and GVR command/readback implementation; this tool never
launches/closes a renderer, changes global settings, or uses desktop input.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

LABEL = re.compile(r"[a-z0-9][a-z0-9-]{0,63}\Z")
MAX_LOG = 32 * 1024 * 1024


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"),
                      parse_constant=lambda value: fail("Non-finite JSON number: " + value))


def fail(message):
    raise ValueError(message)


def label(value):
    if not isinstance(value, str) or not LABEL.fullmatch(value):
        fail("Labels must contain 1-64 lowercase letters, digits or hyphens")
    return value


def number(value, low, high):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        fail(f"Expected finite number in [{low}, {high}]")
    return value


def vector(value):
    if not isinstance(value, list) or len(value) != 3:
        fail("Expected a three-component vector")
    return [number(v, -100000, 100000) for v in value]


def validate_recipe(recipe):
    if type(recipe.get("schema")) is not int or recipe.get("schema") != 1:
        fail("Unsupported review recipe schema")
    datetime.strptime(recipe["date"], "%Y-%m-%d")
    number(recipe["FOV_degrees"], 15, 110)
    number(recipe["HDR_brightness"], 0.000001, 0.999999)
    resolution = recipe["resolution"]
    if not isinstance(resolution, list) or len(resolution) != 2:
        fail("Expected width and height")
    for value, low, high in zip(resolution, [320, 240], [3840, 2160]):
        if type(value) is not int:
            fail("Resolution must use integers")
        number(value, low, high)
    vector(recipe["stageOrigin"])
    world = recipe["world"]
    if not isinstance(world, str) or not re.fullmatch(r"Worlds/[A-Za-z0-9_/-]+\.ent", world) or ".." in world:
        fail("Expected an addon-owned Worlds/...ent resource")
    presets = recipe["presets"]
    if not isinstance(presets, dict) or not 1 <= len(presets) <= 12:
        fail("Expected 1-12 lighting presets")
    for name, preset in presets.items():
        label(name)
        if preset["weather"] not in ("Clear", "Overcast"):
            fail("Weather must be a supported Clear/Overcast state")
        number(preset["hour"], 0, 24)
        number(preset.get("HDR_brightness", recipe["HDR_brightness"]), 0.000001, .999999)
    stations = recipe["stations"]
    if not isinstance(stations, list) or not 1 <= len(stations) <= 64:
        fail("Expected 1-64 camera stations")
    names = set()
    for station in stations:
        name = label(station["name"])
        if name in names:
            fail("Duplicate camera station")
        names.add(name)
        eye, target = vector(station["eye"]), vector(station["target"])
        if math.dist(eye, target) < .01:
            fail("Camera eye and target must differ")
        if "pose" in station and station["pose"] not in ("folded", "deployed"):
            fail("Unknown fixture pose")
    for preset, station in recipe.get("representative", []):
        if preset not in presets or station not in names:
            fail("Representative references an unknown light or camera station")
    return recipe


def make_plan(recipe, selection, preset, prefix):
    label(prefix)
    stations = {s["name"]: s for s in recipe["stations"]}
    if selection == "representative":
        pairs = recipe.get("representative", [])
    else:
        if preset not in recipe["presets"]:
            fail("Unknown preset")
        pairs = [(preset, name) for name in stations]
    if not pairs or len(pairs) > 120:
        fail("Choose 1-120 frames")
    if len(pairs) * math.prod(recipe["resolution"]) * 4 > 512 * 1024**2:
        fail("Requested native frames exceed the 512 MiB raw-pixel budget")
    plan = []
    for lighting, name in pairs:
        station = stations[name]
        frame_label = label(prefix + "-" + lighting + "-" + name)
        plan.append({"label": frame_label, "preset": lighting, "station": station,
                     "exposure": recipe["presets"][lighting].get("HDR_brightness", recipe["HDR_brightness"])})
    if len({p["label"] for p in plan}) != len(plan):
        fail("Duplicate frame labels")
    return plan


def regular(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        fail("Expected an ordinary file: " + str(path))
    return path


def contained(root, candidate):
    root, candidate = Path(root).resolve(), Path(candidate).resolve()
    if candidate == root or not candidate.is_relative_to(root):
        fail("Path escapes the owned run/profile")
    return candidate


def load_owner(path):
    owner = read_json(regular(path))
    if owner.get("stoppedUtc") or type(owner.get("pid")) is not int or not 0 < owner["pid"] < 2**32:
        fail("A live, explicit owned-process receipt is required")
    for key in ("run", "profile", "logs", "exe"):
        if not Path(owner[key]).is_absolute():
            fail("Owner paths must be absolute")
    root = Path(owner["run"]).resolve()
    primary = (Path.home()/"Documents/My Games/ArmaReforger").resolve()
    if any(Path(owner[key]).resolve() == primary or Path(owner[key]).resolve().is_relative_to(primary) for key in ("run", "profile", "logs")):
        fail("The normal ArmaReforger profile is not an isolated review run")
    for key in ("profile", "logs"):
        contained(root, owner[key])
    datetime.fromisoformat(owner["creationUtc"].replace("Z", "+00:00"))
    return owner


def verify_native_process(owner, world):
    if os.name != "nt":
        fail("Live native capture is Windows-only; dry runs and validation are portable")
    # PID is validated integer; no path or supplied command text is interpolated.
    script = ("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"
              "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=" + str(owner["pid"]) + "';"
              "if(!$p){exit 3};@{pid=$p.ProcessId;exe=$p.ExecutablePath;commandLine=$p.CommandLine;"
              "creationUtc=$p.CreationDate.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress")
    query = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                           capture_output=True, text=True, encoding="utf-8", timeout=15, check=True)
    actual = json.loads(query.stdout)
    if actual["pid"] != owner["pid"] or os.path.normcase(str(Path(actual["exe"]).resolve())) != os.path.normcase(str(Path(owner["exe"]).resolve())):
        fail("Owned process executable/PID differs")
    old = datetime.fromisoformat(owner["creationUtc"].replace("Z", "+00:00")).timestamp()
    new = datetime.fromisoformat(actual["creationUtc"].replace("Z", "+00:00")).timestamp()
    if abs(old-new) > .001:
        fail("Owned process creation time differs (possible PID reuse)")
    import ctypes
    from ctypes import wintypes
    shell = ctypes.WinDLL("shell32", use_last_error=True)
    shell.CommandLineToArgvW.restype = ctypes.POINTER(wintypes.LPWSTR)
    shell.CommandLineToArgvW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
    count = ctypes.c_int()
    args = shell.CommandLineToArgvW(actual["commandLine"], ctypes.byref(count))
    if not args:
        fail("Cannot inspect native process arguments")
    try:
        argv = [args[i] for i in range(count.value)]
    finally:
        kernel = ctypes.WinDLL("kernel32")
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree(args)
    def option(name):
        if argv.count(name) != 1 or argv.index(name)+1 >= len(argv):
            fail("Expected one native " + name + " argument")
        return argv[argv.index(name)+1]
    if os.path.normcase(str(Path(option("-profile")).resolve())) != os.path.normcase(str(Path(owner["profile"]).resolve())) or option("-world") != world:
        fail("Owned process profile/world differs")
    if "-noFocus" not in argv:
        fail("The owned review runtime must use an isolated unfocused launch")


def parse_fields(line):
    fields = {}
    for key, value in re.findall(r"(\w+)=(<[^>]+>|[^\s]+)", line):
        if value.startswith("<"):
            value = vector([float(v) for v in value.strip("<>").split(",")])
        else:
            try:
                numeric = float(value)
                if not math.isfinite(numeric):
                    fail("Non-finite native telemetry")
                value = numeric
            except ValueError:
                if value.lower() in ("nan", "inf", "+inf", "-inf"):
                    fail("Non-finite native telemetry")
        fields[key] = value
    return fields


def readback(text, recipe, frame):
    actual = {}
    for tag in ("ENV_ACTUAL", "CAMERA", "BODY", "RADAR", "PERF"):
        rows = [s for s in text.splitlines() if f"GVR_{tag} label={frame['label']} " in s]
        if rows:
            actual[tag] = parse_fields(rows[-1])
    if not all(key in actual for key in ("ENV_ACTUAL", "CAMERA", "BODY")):
        fail("Native environment/camera/body readbacks missing")
    env, camera, body = (actual[key] for key in ("ENV_ACTUAL", "CAMERA", "BODY"))
    expected = recipe["presets"][frame["preset"]]
    if env["preset"] != frame["preset"] or env["weather"] != expected["weather"] or abs(env["hour"]-expected["hour"]) > .001:
        fail("Requested weather/time not observed")
    if any(env[key] != 0 for key in ("wetness", "rain", "cracks", "puddles")):
        fail("Requested dry state not observed")
    if camera["fov"] != recipe["FOV_degrees"] or not math.isclose(camera["exposure"], frame["exposure"], abs_tol=1e-7, rel_tol=0):
        fail("Requested FOV/exposure not observed")
    for key, identity in (("right", [1, 0, 0]), ("up", [0, 1, 0]), ("forward", [0, 0, 1])):
        if max(abs(a-b) for a, b in zip(body[key], identity)) > 1e-6:
            fail("Review body orientation changed")
    if frame["preset"] != "outdoor" and math.dist(body["origin"], recipe["stageOrigin"]) > .001:
        fail("Review body stage origin changed")
    station = frame["station"]
    if max(abs(a-b-c) for a, b, c in zip(camera["eye"], body["origin"], station["eye"])) > .001:
        fail("Camera eye differs from fixed station")
    direction = [a-b for a, b in zip(station["target"], station["eye"])]
    length = math.sqrt(sum(v*v for v in direction))
    error = max(abs(a-b/length) for a, b in zip(camera["forward"], direction))
    if error > .0005:
        fail("Camera direction differs from fixed station")
    camera["maxForwardComponentErrorVersusDoubleRecipe"] = error
    forward = [v/length for v in direction]
    horizontal = math.hypot(forward[0], forward[2])
    if horizontal < 1e-6:
        fail("Near-vertical camera requires a separately defined up-vector contract")
    right = [forward[2]/horizontal, 0, -forward[0]/horizontal]
    up = [forward[1]*right[2], forward[2]*right[0]-forward[0]*right[2], -forward[1]*right[0]]
    for key, expected_basis in (("right", right), ("up", up)):
        if key not in camera or max(abs(a-b) for a, b in zip(camera[key], expected_basis)) > .0005:
            fail("Camera roll/up basis differs from fixed station")
    if "pose" in station:
        if "RADAR" not in actual or actual["RADAR"].get("deployment") != (1 if station["pose"] == "deployed" else 0):
            fail("Requested project pose not observed")
    return actual


class NativeChannel:
    def __init__(self, owner, output):
        self.profile = Path(owner["profile"]).resolve()
        self.log = contained(owner["logs"], Path(owner["logs"])/"script.log")
        self.output = output
        self.command_file = contained(self.profile, self.profile/"profile/GVR-command.txt")
        self.pid = owner["pid"]

    def text(self):
        if not self.log.exists():
            return ""
        if regular(self.log).stat().st_size > MAX_LOG:
            fail("Native script log exceeds bounded 32 MiB read")
        text = self.log.read_text(errors="replace")
        if "Can't compile" in text or "GVR_FAIL" in text or re.search(r"SCRIPT\s+\(E\)|NULL pointer", text):
            fail("Native fixture reports a compile/runtime error; preserve its log")
        return text

    def command(self, op, *args):
        if op not in {"camera", "preset", "stage", "outdoor", "radar", "exposure", "settings", "frame"}:
            fail("Command outside passive review scope")
        args = [str(s) for s in args]
        if any(any(c in s for c in "\n\r|") for s in args):
            fail("Invalid command separator")
        if self.command_file.exists():
            regular(self.command_file)
        ident = uuid.uuid4().hex
        temporary = self.command_file.with_name("GVR-" + ident + ".tmp")
        with temporary.open("x") as stream:
            stream.write("|".join([ident, op, *args])+"\n")
        for attempt in range(50):
            try:
                os.replace(temporary, self.command_file)
                break
            except PermissionError:
                if attempt == 49:
                    raise
                time.sleep(.02)
        end = time.monotonic()+15
        while time.monotonic() < end:
            text = self.text()
            if f"GVR_REJECT id={ident}" in text:
                fail("Native fixture rejected command")
            if f"GVR_ACK id={ident} op={op}" in text:
                break
            time.sleep(.15)
        else:
            fail("No native acknowledgement; do not assume the command ran")
        with (self.output/"commands.jsonl").open("a") as stream:
            stream.write(json.dumps({"id": ident, "pid": self.pid, "operation": op, "args": args, "utcEpoch": time.time(), "OSInput": False})+"\n")
        time.sleep(.3)


def save_pixels(bmp, png, resolution):
    from PIL import Image
    regular(bmp)
    with Image.open(bmp) as image:
        if list(image.size) != resolution:
            fail("Decoded native resolution differs")
        image.load()
        rgba = image.convert("RGBA").tobytes()
        low, high = image.convert("L").getextrema()
        if high-low < 4:
            fail("Blank native frame")
        with png.open("xb") as stream:
            image.save(stream, format="PNG")
    with Image.open(png) as image:
        if image.convert("RGBA").tobytes() != rgba:
            fail("PNG changed native pixels")
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    return {"nativeBMP": str(bmp), "nativeBMPSHA256": digest(bmp), "png": str(png),
            "pngSHA256": digest(png), "rgbaSHA256": hashlib.sha256(rgba).hexdigest(),
            "size": resolution, "losslessNativePixels": True}


def execute(recipe, frames, owner, output, baseline):
    verify_native_process(owner, recipe["world"])
    output = contained(owner["run"], output)
    if output.exists():
        fail("Fresh review output required; earlier evidence is never overwritten")
    native_root = contained(owner["profile"], Path(owner["profile"])/"profile")
    for frame in frames:
        if (native_root/("GVR-"+frame["label"]+".bmp")).exists():
            fail("Native frame name already exists; choose a new label prefix")
    channel = NativeChannel(owner, output)
    end = time.monotonic()+60
    while "GVR_READY stage=1" not in channel.text():
        if time.monotonic() >= end:
            fail("Owned review fixture not ready")
        time.sleep(.5)
    output.mkdir(parents=True, exist_ok=False)
    records = []
    manifest = {"recipe": recipe, "owner": owner, "frames": records,
                "automaticValidationPassed": False, "manualVisualAcceptance": "pending",
                "limitations": ["No GPU time, active LOD or live mip residency measurement.",
                                "Named weather/time/dry state verified; cloud/wind phase not pinned.",
                                "Static visual fixture, not driving/crew/multiplayer certification."]}
    try:
        channel.command("settings")
        settings = sorted(set(s.split("GVR_SETTING ", 1)[1] for s in channel.text().splitlines() if "GVR_SETTING " in s))
        if not settings:
            fail("Native renderer settings readback missing")
        if baseline and read_json(regular(baseline)) != settings:
            fail("Renderer settings differ from comparison baseline")
        (output/"graphics-settings.json").write_text(json.dumps(settings, indent=2)+"\n")
        manifest["graphicsBaselineCompared"] = bool(baseline)
        hashes = set()
        for frame in frames:
            verify_native_process(owner, recipe["world"])
            station = frame["station"]
            channel.command("outdoor" if frame["preset"] == "outdoor" else "stage")
            channel.command("preset", frame["preset"])
            channel.command("radar", station.get("pose", "folded"))
            channel.command("camera", " ".join(map(str, station["eye"])), " ".join(map(str, station["target"])))
            channel.command("exposure", frame["exposure"])
            time.sleep(3)
            channel.command("frame", frame["label"])
            actual = readback(channel.text(), recipe, frame)
            bmp = native_root/("GVR-"+frame["label"]+".bmp")
            end = time.monotonic()+20
            while True:
                try:
                    pixels = save_pixels(bmp, output/(frame["label"]+".png"), recipe["resolution"])
                    break
                except (FileNotFoundError, OSError):
                    if time.monotonic() >= end:
                        raise
                    time.sleep(.2)
            if pixels["rgbaSHA256"] in hashes:
                fail("Different requested views produced identical pixels")
            hashes.add(pixels["rgbaSHA256"])
            records.append({"label": frame["label"], "requested": frame, "actual": actual, **pixels})
            print("Saved native review frame: " + frame["label"], flush=True)
        manifest["automaticValidationPassed"] = True
    finally:
        (output/"review-manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--owner", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--selection", choices=["representative", "all"], default="representative")
    parser.add_argument("--preset", default="soft")
    parser.add_argument("--label-prefix", default="review")
    parser.add_argument("--settings-baseline", type=Path)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(argv)
    recipe = validate_recipe(read_json(regular(args.recipe)))
    frames = make_plan(recipe, args.selection, args.preset, args.label_prefix)
    if not args.execute:
        print(json.dumps({"dryRun": True, "frames": frames, "rawBytes": len(frames)*math.prod(recipe["resolution"])*4,
                          "rendererLaunched": False, "filesWritten": False}, indent=2))
        return 0
    if not args.owner:
        parser.error("--execute requires an explicit --owner receipt")
    owner = load_owner(args.owner)
    output = args.output or Path(owner["run"])/"review"
    execute(recipe, frames, owner, output, args.settings_baseline)
    print("Numeric/pixel gates passed. Inspect the full-resolution images before visual acceptance.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from error
