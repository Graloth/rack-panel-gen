"""Open every generated STEP file in OpenCascade and check it is one valid solid with the expected size and volume."""
import json
import sys
from pathlib import Path

from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer

OUT = Path(__file__).parent / "out"
expected = json.loads((OUT / "expected.json").read_text())
failures = 0

for name, exp in expected.items():
    reader = STEPControl_Reader()
    if reader.ReadFile(str(OUT / f"{name}.step")) != IFSelect_RetDone:
        print(f"FAIL {name}: could not read"); failures += 1; continue
    reader.TransferRoots()
    shape = reader.OneShape()

    valid = BRepCheck_Analyzer(shape).IsValid()
    solids, it = 0, TopExp_Explorer(shape, TopAbs_SOLID)
    while it.More():
        solids += 1; it.Next()
    props = GProp_GProps(); BRepGProp.VolumeProperties_s(shape, props)
    vol = props.Mass()
    box = Bnd_Box(); BRepBndLib.Add_s(shape, box)
    lo, hi = box.CornerMin(), box.CornerMax()
    size = (hi.X() - lo.X(), hi.Y() - lo.Y(), hi.Z() - lo.Z())

    rel = abs(vol - exp["volume"]) / exp["volume"]
    size_ok = all(abs(a - b) < 1e-3 for a, b in zip(size, (exp["W"], exp["H"], exp["T"])))
    ok = valid and solids == 1 and rel < 1e-6 and size_ok
    failures += not ok
    print(f"{'ok  ' if ok else 'FAIL'} {name:26} valid={valid} solids={solids} volume={vol:11.3f} rel.err={rel:.1e} size={tuple(round(s, 3) for s in size)}")

print(f"{len(expected) - failures}/{len(expected)} passed")
sys.exit(1 if failures else 0)
