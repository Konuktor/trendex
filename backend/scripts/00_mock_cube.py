"""Write a synthetic cube (same schema as the real one) to data/cube_mock/."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from trendex_core import config  # noqa: E402
from trendex_core.io import mock_cube  # noqa: E402

if __name__ == "__main__":
    t = time.time()
    m = mock_cube.make(config.DATA / "cube_mock")
    print(f"mock cube: {m['n_cells']} cells in {time.time() - t:.1f}s -> {config.DATA / 'cube_mock'}")
