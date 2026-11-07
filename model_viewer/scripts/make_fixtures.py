"""Reference outputs from the notebook's Python model, used by test/model.test.mjs to check the JavaScript port.

Run from the repository root (needs match 1925299's real tracking file, not the Git LFS pointer):
    python model_viewer/scripts/make_fixtures.py
"""
import json, os
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
plt.show = lambda *a, **k: plt.close("all")

ROOT = Path(__file__).resolve().parents[2]
src = open(ROOT / "notebooks" / "research" / "defensive_shape_integrity.py").read().split("# ## 5. The defensive tiling")[0]
os.chdir(ROOT / "notebooks")
g = {}
exec(compile(src, "nb", "exec"), g)

FITTED, DEFAULT, VM = dict(g["SETTINGS"]), dict(g["DEFAULT_SETTINGS"]), g["VALUE_MODEL"]

def use(settings, value_model):
    for k, v in settings.items():
        g[k] = v
    g["K_LOGIT"] = np.pi / (np.sqrt(3) * settings["SIGMA"])
    g["VALUE_MODEL"] = value_model

ev = g["events"]
pp = ev[ev.event_type == "player_possession"]
cases = []
for frame in [44209, 44283, 12345]:
    row = pp[(pp.frame_start <= frame)].iloc[-1]
    st, ball = g["frame_state"](frame, row.team_id, row.attacking_side)
    if ball is None:
        continue
    phys = g["PHYS"].loc[st.player_id]
    case = {"frame": frame, "team_id": int(row.team_id), "attacking_side": row.attacking_side, "ball": ball.round(6).tolist(),
            "players": [{"id": int(r.player_id), "x": r.x, "y": r.y, "vx": r.vx, "vy": r.vy, "att": bool(r.attacking),
                         "vmax": float(phys.loc[r.player_id, "vmax"]), "amax": float(phys.loc[r.player_id, "amax"])}
                        for r in st.itertuples()]}
    keep = np.arange(0, 7140, 7)
    for name, settings, value_model in [("v0", DEFAULT, None), ("v2", FITTED, VM)]:
        use(settings, value_model)
        pc = g["pitch_control"](st, ball)
        case[name] = {"cells": keep.tolist(), "p_att": pc["p_att"].ravel()[keep].round(6).tolist(),
                      "p_succ": pc["p_succ"].ravel()[keep].round(6).tolist(),
                      "value": pc["v_ctx"].ravel()[keep].round(7).tolist(),
                      "gain": pc["gain"].ravel()[keep].round(7).tolist(), "v_ball": round(pc["v_ball"], 7)}
    cases.append(case)
    print(frame, row.player_name, "v2 max gain", round(max(case["v2"]["gain"]), 4))
use(FITTED, VM)
out = ROOT / "model_viewer" / "test" / "fixtures.json"
out.parent.mkdir(exist_ok=True)
json.dump(cases, open(out, "w"), separators=(",", ":"))
print("wrote", out)
