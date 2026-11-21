"""Package each skill folder as dist/<skill>.skill (a zip) for upload to Claude.

    python3 scripts/package_skills.py
"""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
DIST.mkdir(exist_ok=True)
for skill in sorted((ROOT / "skills").iterdir()):
    if not (skill / "SKILL.md").exists():
        continue
    out = DIST / f"{skill.name}.skill"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(skill.rglob("*")):
            if f.is_file() and "__pycache__" not in f.parts and "tests" not in f.parts:
                z.write(f, Path(skill.name) / f.relative_to(skill))
    print(f"packaged {out.name}")
