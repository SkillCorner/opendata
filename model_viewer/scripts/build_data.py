"""Build the static data the model viewer needs, from the repo's data/ folder and the fitted model files.

Run from the repository root:  python model_viewer/scripts/build_data.py

Writes model_viewer/data/:
  models.json            v0 + v2 pitch-control settings, the location value grid and the v2 context-value coefficients
  matches.json           the match list
  match/<id>.json        teams, pitch sides per period, each player's top speed / acceleration, and possession sequences
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
FITTED = ROOT / "notebooks" / "fitted"
OUT = ROOT / "model_viewer" / "data"
(OUT / "match").mkdir(parents=True, exist_ok=True)

# ---------------- models ----------------
pcs = json.load(open(FITTED / "pitch_control_settings.json"))
vm = json.load(open(FITTED / "value_model.json"))
V = np.array(vm["V_loc"])                                   # (68, 105), row = y, col = x
coef_order = ["pressure_time", "log1p_nearest_def_m", "defenders_ahead",
              "pressure_time×near_goal", "log1p_nearest_def_m×near_goal", "defenders_ahead×near_goal"]
models = {
    "grid": {"x0": -52.0, "y0": -33.5, "nx": V.shape[1], "ny": V.shape[0], "half_l": 52.5, "half_w": 34.0},
    "settings": {"v0": pcs["defaults"], "v2": pcs["settings"]},
    "constants": {"LOFT_MIN_DIST": 15.0},
    "value": {
        "V_loc": [round(float(v), 6) for v in V.ravel()],
        "intercept": vm["intercept"], "coef": [vm["coef"][k] for k in coef_order], "coef_names": coef_order,
        "near_goal_scale_m": vm["near_goal_scale_m"], "cone_deg": vm["cone_deg"],
        "nearest_cap_m": vm["nearest_cap_m"], "pressure_cap_s": vm["pressure_cap_s"],
    },
    "provenance": {
        "v0": "Literature defaults; value = location only (V_loc).",
        "v2": "10 settings fitted on 11,110 passes from 15 training matches; value = V_loc × defensive-context multiplier.",
        "V_loc": "Smoothed SkillCorner possession EPV by location, 15 training matches.",
        "test_matches": vm["test_matches"],
    },
}
json.dump(models, open(OUT / "models.json", "w"), separators=(",", ":"))

# ---------------- matches ----------------
phys = pd.read_csv(DATA / "aggregates" / "aus1league_physicalaggregates_20242025.csv") \
    .groupby("player_id")[["psv99", "timetosprint_top3"]].mean()

def seconds_label(minute, second):
    return f"{int(minute)}'{int(second):02d}"

index = []
for mdir in sorted(p for p in (DATA / "matches").iterdir() if p.name.isdigit()):
    mid = mdir.name
    m = json.load(open(mdir / f"{mid}_match.json"))
    ev = pd.read_csv(mdir / f"{mid}_dynamic_events.csv", low_memory=False)

    pl = pd.DataFrame([{
        "id": p["id"], "name": p["short_name"], "number": p["number"], "team_id": p["team_id"],
        "role": p["player_role"]["name"], "position_group": p["player_role"]["position_group"],
        "gk": p["player_role"]["name"] == "Goalkeeper",
    } for p in m["players"]]).join(phys, on="id")
    for col in ["psv99", "timetosprint_top3"]:          # same fallback as the notebook: position-group median, then league median
        pl[col] = pl[col].fillna(pl.groupby("position_group")[col].transform("median")).fillna(phys[col].median())
    pl["vmax"] = (pl.psv99 / 3.6).round(4)
    pl["amax"] = np.clip((25 / 3.6) / pl.timetosprint_top3, 3.0, 7.0).round(4)

    pp = ev[ev.event_type == "player_possession"].sort_values("frame_start")
    goals = ev.loc[ev.game_interruption_after == "goal_for", ["team_id", "frame_end"]].drop_duplicates()
    # team possessions = runs of consecutive player possessions by the same team in the same period
    run_id = ((pp.team_id != pp.team_id.shift()) | (pp.period != pp.period.shift())).cumsum()
    seqs = []
    for _, g in pp.groupby(run_id):
        last = g.iloc[-1]
        goal = bool(((goals.team_id == last.team_id) & (goals.frame_end >= g.frame_start.iloc[0])
                     & (goals.frame_end <= last.frame_end + 50)).any())
        shot = (g.end_type == "shot").any()
        epv = g[["possession_epv_for_start", "possession_epv_for_end"]].max().max()
        names = []
        for n in g.player_name:
            if not names or names[-1] != n:
                names.append(n)
        seqs.append({
            "start": int(g.frame_start.iloc[0]), "end": int(last.frame_end), "period": int(last.period),
            "team_id": int(last.team_id), "clock": seconds_label(g.minute_start.iloc[0], g.second_start.iloc[0]),
            "minute": int(g.minute_start.iloc[0]), "n": len(g), "players": names,
            "outcome": "goal" if goal else "shot" if shot else str(last.end_type),
            "max_epv": None if pd.isna(epv) else round(float(epv), 4),
            "possessions": [{"start": int(r.frame_start), "end": int(r.frame_end), "player": r.player_name,
                             "end_type": r.end_type, "pass_outcome": None if pd.isna(r.pass_outcome) else r.pass_outcome,
                             "target": None if pd.isna(r.player_targeted_name) else r.player_targeted_name}
                            for r in g.itertuples()],
        })
    home, away = m["home_team"], m["away_team"]
    out = {
        "id": int(mid), "date": m["date_time"], "score": [m["home_team_score"], m["away_team_score"]],
        "home": {k: home[k] for k in ("id", "name", "short_name", "acronym")},
        "away": {k: away[k] for k in ("id", "name", "short_name", "acronym")},
        "home_team_side": m["home_team_side"], "pitch": [m["pitch_length"], m["pitch_width"]],
        "periods": [{"period": p["period"], "start": p["start_frame"], "end": p["end_frame"]} for p in m["match_periods"]],
        "players": pl[["id", "name", "number", "team_id", "role", "gk", "vmax", "amax"]].to_dict("records"),
        "sequences": seqs,
    }
    json.dump(out, open(OUT / "match" / f"{mid}.json", "w"), separators=(",", ":"), default=lambda o: o.item())
    index.append({"id": int(mid), "label": f"{home['short_name']} {m['home_team_score']}–{m['away_team_score']} {away['short_name']}",
                  "date": m["date_time"][:10], "round": m["competition_round"]["round_number"],
                  "goals": sum(s["outcome"] == "goal" for s in seqs), "test_match": mid in vm["test_matches"]})
    print(mid, out["home"]["acronym"], "v", out["away"]["acronym"], len(seqs), "sequences",
          sum(s["outcome"] == "goal" for s in seqs), "goals")

index.sort(key=lambda r: r["date"])
json.dump(index, open(OUT / "matches.json", "w"), indent=1)
print("wrote", OUT)
