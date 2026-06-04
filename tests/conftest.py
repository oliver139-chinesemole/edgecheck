import sys
from pathlib import Path
import pytest

# Make backend importable
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import os
os.environ.setdefault("DB_PATH", ":memory:")
