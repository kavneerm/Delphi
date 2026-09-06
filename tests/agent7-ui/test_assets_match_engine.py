"""ui/data/assets.json must stay a copy of the engine's catalogue.

The console draws satellite arcs by propagating orbital elements in the browser
(ui/src/orbits.js mirrors engine/orbits.py). That is only legitimate while the
elements are the engine's own. If agent1-engine re-tunes an orbit and this file
does not follow, the map would draw arcs that disagree with the ground-track
lines in the very log it is playing back -- silently, and in a demo.
"""

from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ASSETS = json.loads((REPO / "ui" / "data" / "assets.json").read_text(encoding="utf-8"))["assets"]


def _engine_assets() -> dict[str, dict]:
    from engine.world import initial_state

    state = initial_state()
    assets = state["assets"] if isinstance(state, dict) and "assets" in state else state
    return {k: v for k, v in assets.items() if "orbit" in v}


def test_same_asset_ids() -> None:
    assert {a["id"] for a in ASSETS} == set(_engine_assets())


def test_same_orbits_and_owners() -> None:
    engine = _engine_assets()
    for a in ASSETS:
        e = engine[a["id"]]
        assert a["owner"] == e.get("owner"), f"{a['id']} owner drifted"
        assert a["asset_class"] == e.get("asset_class"), f"{a['id']} asset_class drifted"
        assert a["orbit"] == e["orbit"], f"{a['id']} orbit drifted from engine.world"


def test_elements_use_the_engine_key_names() -> None:
    """ui/src/orbits.js reads these keys verbatim; a rename in the engine has to
    surface here rather than as an undefined in the browser."""
    required = {"a_km", "e", "inc_deg", "raan_deg", "argp_deg", "m0_deg"}
    for a in ASSETS:
        assert required <= set(a["orbit"]), f"{a['id']} is missing {required - set(a['orbit'])}"


def test_every_logged_asset_has_a_catalogue_entry() -> None:
    """Anything the log puts a ground track on must be drawable."""
    runs = json.loads((REPO / "ui" / "data" / "runs.json").read_text(encoding="utf-8"))["runs"]
    known = {a["id"] for a in ASSETS}
    for r in runs:
        for raw in (REPO / r["path"]).read_text(encoding="utf-8").splitlines():
            if '"assets.ground_tracks"' not in raw:
                continue
            line = json.loads(raw)
            missing = set(line["payload"]["value"]) - known
            assert not missing, f"{r['id']} logs tracks for uncatalogued assets: {missing}"
            break
