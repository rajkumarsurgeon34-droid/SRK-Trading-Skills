"""Copy india_common/ (helpers + config) into every skill's scripts/ folder.

Run after editing india_common/india_fno_config.json or india_common.py:
    python3 scripts/sync_india_common.py
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "india_common"
FILES = ["india_common.py", "india_fno_config.json"]

count = 0
for scripts in sorted((ROOT / "skills").glob("*/scripts")):
    if not any(scripts.glob("*.py")):
        continue
    for f in FILES:
        shutil.copy2(SRC / f, scripts / f)
    count += 1
print(f"Synced india_common into {count} skills.")
