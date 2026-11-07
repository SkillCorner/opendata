# Pitch Model Lab

An interactive viewer that plays back SkillCorner tracking and compares the two versions of the defensive-shape models
from `notebooks/defensive_shape_integrity.ipynb`, frame by frame:

| Layer | v0 | v2 |
|---|---|---|
| **Pitch control** (P_att or P_succ) | literature settings (0.5 s reaction, 15 m/s ball, σ 0.45, …) | 10 settings fitted on 15 matches (`notebooks/fitted/pitch_control_settings.json`) |
| **EPV** | location only (`V_loc`) | location × defensive-context multiplier (`notebooks/fitted/value_model.json`) |
| **Gain** | v0 P_succ × v0 value | v2 P_succ × v2 value |
| **Integrity** (protection) | v0 P_succ, weighted by `V_loc` | v2 P_succ, weighted by `V_loc` |

**Integrity** is the notebook's protection score (Section 5, definition chosen in Section 8b): how well the defence
denies passes into the space from 5 m behind the ball to goal, I = Σ V_loc·(1 − P_succ) / Σ V_loc over that zone.
The layer shows 1 − P_succ in the zone (faded where the space is worth little), each pitch shows the frame's I,
and a timeline under the player plots I for both versions across the clip (click it to jump). On Perth's goal the
viewer reproduces the notebook's v2 values exactly: 0.861 → 0.561 → 0.575 → 0.620.

Views: side by side, single model, or the difference v2 − v0. Hover a pitch to read both models' values at one spot.

## How it works

- `server.mjs` (Node 22, no dependencies) serves the page and `/api/clip/<match>?start=&end=`. Tracking is not in the
  image: it is read from the repo's Git LFS media URL with HTTP range requests (binary search on byte offset, then only
  the clip is downloaded, ~1–2 s). If a real tracking file is present locally under `data/matches/`, it is read from disk.
- `public/model.js` is a line-for-line JavaScript port of the notebook's `pitch_control`, `time_to_reach`, the protection score and
  `context_value`. Two web workers (one per version) compute every frame of the clip in the browser, starting at the
  playhead. `test/model.test.mjs` checks the port against the Python model (`scripts/make_fixtures.py`): worst
  difference 5e-7.
- `data/` is built by `scripts/build_data.py` from the match files, the physical aggregates and the fitted model files:
  each player's top speed / acceleration and every team-possession sequence (goals, shots, high-EPV chains).

Surfaces are always from the attacking team's point of view (the sequence's team; **Swap** flips it).
Run credit is not applied: on a free-playing frame there is no known receiver.

## Run locally

```bash
cd model_viewer
npm start            # http://localhost:3000
npm test             # model parity + clip API
```

After the fitted models or event data change: `python model_viewer/scripts/build_data.py` (and
`python model_viewer/scripts/make_fixtures.py` to refresh the parity fixtures), from the repo root.

## Deploy on Railway

Create a **new service** from this repository and set its **Root Directory** to `/model_viewer`. Railway picks up
`model_viewer/Dockerfile` and `model_viewer/railway.json` (health check `/health`). No variables are needed;
`TRACKING_REF` (default `main`) chooses the branch or commit tracking is read from. Then generate a domain.
The existing Pitch Tiles service is unaffected.
