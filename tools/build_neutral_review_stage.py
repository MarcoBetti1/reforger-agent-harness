"""Original matte-stage mesh generator; Blender output remains in the addon project."""
import argparse
import json
import math
from pathlib import Path
import sys


def geometry(segments=128):
    if type(segments) is not int or not 32 <= segments <= 256:
        raise ValueError("Segments must be an integer in [32, 256]")
    vertices, faces = [(0, 0, 0)], []
    rings = [(120., 0.)]
    for i in range(1, 13):
        angle = math.pi*.5*i/12
        rings.append((120+20*math.sin(angle), 20*(1-math.cos(angle))))
    rings.append((140., 32.))
    for radius, height in rings:
        vertices.extend((radius*math.cos(2*math.pi*j/segments), radius*math.sin(2*math.pi*j/segments), height) for j in range(segments))
    for j in range(segments):
        faces.append((0, 1+j, 1+(j+1)%segments))
    for k in range(len(rings)-1):
        a, b = 1+k*segments, 1+(k+1)*segments
        for j in range(segments):
            n = (j+1)%segments
            faces.append((a+j, b+j, b+n, a+n))
    return vertices, faces


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New addon-owned .fbx path")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(argv)
    output = args.output.resolve()
    if output.suffix.lower() != ".fbx" or output.exists() or output.with_suffix(".blend").exists():
        raise ValueError("Choose a fresh .fbx/.blend output pair")
    vertices, faces = geometry()
    print(json.dumps({"dryRun": not args.execute, "vertices": len(vertices), "polygons": len(faces), "radiusMetres": 140, "heightMetres": 32, "output": str(output)}))
    if not args.execute:
        return 0
    import bpy
    # Call with --factory-startup --background: never run inside a user's scene.
    if not bpy.app.background:
        raise ValueError("Run a separate factory-startup background Blender")
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    mesh = bpy.data.meshes.new("ReviewStage")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("ReviewStage", mesh)
    bpy.context.collection.objects.link(obj)
    material = bpy.data.materials.new("Review_MatteGrey")
    material.diffuse_color = (.21586, .21586, .21586, 1)
    obj.data.materials.append(material)
    for face in mesh.polygons:
        face.use_smooth = True
    uv = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        co = mesh.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (co.x/280+.5, co.y/280+.5)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.wm.save_as_mainfile(filepath=str(output.with_suffix(".blend")))
    bpy.ops.export_scene.fbx(filepath=str(output), use_selection=True, object_types={"MESH"},
                            axis_forward="-Z", axis_up="Y", bake_anim=False, add_leaf_bones=False)
    return 0


if __name__ == "__main__":
    # Blender supplies its own flags before the literal -- separator.
    arguments = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else sys.argv[1:]
    raise SystemExit(main(arguments))
