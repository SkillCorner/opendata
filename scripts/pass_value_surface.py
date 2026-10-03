"""Pass-value surface for one frozen attacking frame.

Trains two models on observed passing options from every open-data match
except 1886347, then scores real teammate destinations and a 2 m grid for
B. Gibson's reception that becomes a shot (match 1886347, ~02:22).

expected EPV = P(completed) * EPV if the ball arrives
"""

from __future__ import annotations

import json
from pathlib import Path

import imageio_ffmpeg
import matplotlib

matplotlib.rcParams["animation.ffmpeg_path"] = imageio_ffmpeg.get_ffmpeg_exe()

import matplotlib.pyplot as plt
import matplotlib.patheffects as path_effects
import numpy as np
import pandas as pd
from matplotlib.animation import FFMpegWriter, FuncAnimation
from matplotlib.colors import Normalize
from mplsoccer import Pitch
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score

MATCH_ID = 1886347
HOLD_OUT = 1886347
DEMO_POSSESSION = "8_30"
VIDEO_START_POSSESSION = "8_29"
STANDARD_LENGTH = 105.0
STANDARD_WIDTH = 68.0
GRID_STEP = 2.0
FPS = 10

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
MATCHES_JSON = DATA / "matches.json"
OUT_DIR = ROOT / "output"
FIG_PATH = OUT_DIR / "pass_value_1886347_gibson.png"
GRID_PATH = OUT_DIR / "pass_value_1886347_gibson.csv"
VIDEO_PATH = OUT_DIR / "pass_value_1886347_gibson.mp4"
CACHE_PATH = OUT_DIR / "pass_value_training_cache.pkl"

FEATURE_COLS = [
    "ball_x",
    "ball_y",
    "dest_x",
    "dest_y",
    "pass_distance",
    "pass_angle",
    "pass_forward",
    "dest_dist_to_goal",
    "dest_angle_to_goal",
    "nearest_opp_dist",
    "nearest_team_dist",
    "opponents_in_lane",
    "n_opponents_ahead_end",
    "last_line_break_num",
    "interplayer_distance",
]


def match_ids() -> list[int]:
    return [row["id"] for row in json.loads(MATCHES_JSON.read_text(encoding="utf-8"))]


def load_meta(match_id: int) -> dict:
    path = DATA / "matches" / str(match_id) / f"{match_id}_match.json"
    return json.loads(path.read_text(encoding="utf-8"))


def scale_xy(x, y, pitch_length: float, pitch_width: float):
    return (
        x * STANDARD_LENGTH / pitch_length,
        y * STANDARD_WIDTH / pitch_width,
    )


def goal_xy(attacking_side: str) -> tuple[float, float]:
    # SkillCorner origin is pitch centre; attack left_to_right aims at +x.
    if attacking_side == "left_to_right":
        return STANDARD_LENGTH / 2.0, 0.0
    return -STANDARD_LENGTH / 2.0, 0.0


def angle_between(ax, ay, bx, by) -> float:
    return float(np.arctan2(by - ay, bx - ax))


def dist(ax, ay, bx, by) -> float:
    return float(np.hypot(bx - ax, by - ay))


def opponents_in_lane(ball, dest, opponents, corridor: float = 2.0) -> int:
    bx, by = ball
    dx, dy = dest
    length = dist(bx, by, dx, dy)
    if length < 1e-6:
        return 0
    ux, uy = (dx - bx) / length, (dy - by) / length
    count = 0
    for ox, oy in opponents:
        proj = (ox - bx) * ux + (oy - by) * uy
        if proj <= 0 or proj >= length:
            continue
        perp = abs((ox - bx) * (-uy) + (oy - by) * ux)
        if perp <= corridor:
            count += 1
    return count


def last_line_break_to_num(value) -> float:
    mapping = {"first": 1.0, "second_last": 2.0, "last": 3.0}
    if pd.isna(value):
        return 0.0
    return mapping.get(str(value), 0.0)


def load_tracking_frames(match_id: int, needed: set[int]) -> dict[int, dict]:
    path = DATA / "matches" / str(match_id) / f"{match_id}_tracking_extrapolated.jsonl"
    found = {}
    if not needed:
        return found
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            frame = row.get("frame")
            if frame in needed:
                found[frame] = row
                if len(found) == len(needed):
                    break
    return found


def lineup_maps(meta: dict) -> dict[int, dict]:
    return {
        player["id"]: {
            "number": player["number"],
            "team_id": player["team_id"],
            "name": player["short_name"],
        }
        for player in meta["players"]
    }


def players_at_frame(frame_row: dict, lineup: dict, pitch_length: float, pitch_width: float):
    players = []
    for player in frame_row.get("player_data") or []:
        if player.get("x") is None or player["player_id"] not in lineup:
            continue
        x, y = scale_xy(player["x"], player["y"], pitch_length, pitch_width)
        info = lineup[player["player_id"]]
        players.append(
            {
                "player_id": player["player_id"],
                "team_id": info["team_id"],
                "number": info["number"],
                "name": info["name"],
                "x": x,
                "y": y,
            }
        )
    return players


def context_features(
    ball_x: float,
    ball_y: float,
    dest_x: float,
    dest_y: float,
    passer_team_id: int,
    players: list[dict],
    attacking_side: str,
    n_opponents_ahead_end: float,
    last_line_break,
    interplayer_distance: float,
) -> dict:
    gx, gy = goal_xy(attacking_side)
    teammates = [(p["x"], p["y"]) for p in players if p["team_id"] == passer_team_id]
    opponents = [(p["x"], p["y"]) for p in players if p["team_id"] != passer_team_id]
    nearest_opp = min((dist(dest_x, dest_y, ox, oy) for ox, oy in opponents), default=np.nan)
    nearest_team = min(
        (
            dist(dest_x, dest_y, tx, ty)
            for tx, ty in teammates
            if dist(dest_x, dest_y, tx, ty) > 0.5
        ),
        default=np.nan,
    )
    forward_sign = 1.0 if attacking_side == "left_to_right" else -1.0
    return {
        "ball_x": ball_x,
        "ball_y": ball_y,
        "dest_x": dest_x,
        "dest_y": dest_y,
        "pass_distance": dist(ball_x, ball_y, dest_x, dest_y),
        "pass_angle": angle_between(ball_x, ball_y, dest_x, dest_y),
        "pass_forward": float((dest_x - ball_x) * forward_sign > 0),
        "dest_dist_to_goal": dist(dest_x, dest_y, gx, gy),
        "dest_angle_to_goal": angle_between(dest_x, dest_y, gx, gy),
        "nearest_opp_dist": nearest_opp,
        "nearest_team_dist": nearest_team,
        "opponents_in_lane": opponents_in_lane((ball_x, ball_y), (dest_x, dest_y), opponents),
        "n_opponents_ahead_end": float(n_opponents_ahead_end)
        if pd.notna(n_opponents_ahead_end)
        else np.nan,
        "last_line_break_num": last_line_break_to_num(last_line_break),
        "interplayer_distance": float(interplayer_distance)
        if pd.notna(interplayer_distance)
        else np.nan,
    }


def build_training_table(ids: list[int]) -> pd.DataFrame:
    rows = []
    for match_id in ids:
        print(f"building rows for {match_id}")
        meta = load_meta(match_id)
        lineup = lineup_maps(meta)
        pitch_length = float(meta["pitch_length"])
        pitch_width = float(meta["pitch_width"])
        events = pd.read_csv(
            DATA / "matches" / str(match_id) / f"{match_id}_dynamic_events.csv",
            low_memory=False,
        )
        options = events[events["event_type"] == "passing_option"].copy()
        possessions = events[events["event_type"] == "player_possession"][
            ["event_id", "pass_reception_epv_for", "possession_epv_against_start"]
        ].rename(
            columns={
                "event_id": "associated_player_possession_event_id",
                "pass_reception_epv_for": "reception_epv",
                "possession_epv_against_start": "epv_against",
            }
        )
        options = options.merge(
            possessions, on="associated_player_possession_event_id", how="left"
        )
        needed = set(int(f) for f in options["frame_start"].dropna().astype(int).unique())
        tracking = load_tracking_frames(match_id, needed)

        for option in options.itertuples(index=False):
            frame = int(option.frame_start)
            frame_row = tracking.get(frame)
            if frame_row is None:
                continue
            if pd.isna(option.x_end) or pd.isna(option.y_end):
                continue
            if pd.isna(option.player_in_possession_x_start) or pd.isna(
                option.player_in_possession_y_start
            ):
                continue
            ball_x, ball_y = scale_xy(
                option.player_in_possession_x_start,
                option.player_in_possession_y_start,
                pitch_length,
                pitch_width,
            )
            dest_x, dest_y = scale_xy(option.x_end, option.y_end, pitch_length, pitch_width)
            players = players_at_frame(frame_row, lineup, pitch_length, pitch_width)
            feats = context_features(
                ball_x,
                ball_y,
                dest_x,
                dest_y,
                int(option.team_id),
                players,
                option.attacking_side,
                option.n_opponents_ahead_end,
                option.last_line_break,
                option.interplayer_distance,
            )
            rows.append(
                {
                    "match_id": match_id,
                    "event_id": option.event_id,
                    "frame_start": frame,
                    "team_id": int(option.team_id),
                    "player_id": int(option.player_id),
                    "targeted": bool(option.targeted),
                    "received": bool(option.received),
                    "xpass_completion": float(option.xpass_completion),
                    "xthreat": float(option.xthreat),
                    "reception_epv": float(option.reception_epv)
                    if pd.notna(option.reception_epv)
                    else np.nan,
                    "epv_against": float(option.epv_against)
                    if pd.notna(option.epv_against)
                    else np.nan,
                    "attacking_side": option.attacking_side,
                    **feats,
                }
            )
    return pd.DataFrame(rows)


def train_models(table: pd.DataFrame):
    usable = table[table["xpass_completion"].notna()].copy()
    train = usable[usable["match_id"] != HOLD_OUT].copy()
    test = usable[usable["match_id"] == HOLD_OUT].copy()

    completion = HistGradientBoostingRegressor(
        max_depth=5, learning_rate=0.08, max_iter=200, random_state=0
    )
    completion.fit(train[FEATURE_COLS], train["xpass_completion"])

    value_train = train[train["received"] & train["reception_epv"].notna()]
    value = HistGradientBoostingRegressor(
        max_depth=5, learning_rate=0.08, max_iter=200, random_state=0
    )
    value.fit(value_train[FEATURE_COLS], value_train["reception_epv"])

    metrics = {}
    if not test.empty:
        pred_c = completion.predict(test[FEATURE_COLS])
        metrics["completion_mae"] = mean_absolute_error(test["xpass_completion"], pred_c)
        metrics["completion_r2"] = r2_score(test["xpass_completion"], pred_c)
        value_test = test[test["received"] & test["reception_epv"].notna()]
        if not value_test.empty:
            pred_v = value.predict(value_test[FEATURE_COLS])
            metrics["reception_epv_mae"] = mean_absolute_error(
                value_test["reception_epv"], pred_v
            )
            metrics["reception_epv_r2"] = r2_score(value_test["reception_epv"], pred_v)
    metrics["n_train"] = len(train)
    metrics["n_value_train"] = len(value_train)
    metrics["n_test"] = len(test)
    return completion, value, metrics


def expected_epv(completion_model, value_model, feature_frame: pd.DataFrame) -> pd.Series:
    p_complete = np.clip(completion_model.predict(feature_frame[FEATURE_COLS]), 0.0, 1.0)
    epv_if = np.clip(value_model.predict(feature_frame[FEATURE_COLS]), 0.0, None)
    return pd.Series(p_complete * epv_if, index=feature_frame.index), pd.Series(
        p_complete, index=feature_frame.index
    ), pd.Series(epv_if, index=feature_frame.index)


def frame_context(
    events: pd.DataFrame,
    meta: dict,
    lineup: dict,
    tracking: dict[int, dict],
    frame: int,
):
    pitch_length = float(meta["pitch_length"])
    pitch_width = float(meta["pitch_width"])
    frame_row = tracking.get(frame)
    if frame_row is None:
        return None

    possessions = events[events["event_type"] == "player_possession"]
    active = possessions[
        (possessions["frame_start"] <= frame) & (possessions["frame_end"] >= frame)
    ]
    if active.empty:
        poss_id = (frame_row.get("possession") or {}).get("player_id")
        if poss_id is None:
            return None
        nearby = possessions[
            (possessions["player_id"] == poss_id)
            & (possessions["frame_start"] <= frame + 20)
            & (possessions["frame_end"] >= frame - 20)
        ]
        if nearby.empty:
            return None
        possession = nearby.iloc[(nearby["frame_start"] - frame).abs().argmin()]
    else:
        possession = active.iloc[0]

    players = players_at_frame(frame_row, lineup, pitch_length, pitch_width)
    passer_id = int(possession.player_id)
    if not any(p["player_id"] == passer_id for p in players):
        return None

    ball_raw = frame_row["ball_data"]
    if ball_raw.get("x") is None:
        carrier = next(p for p in players if p["player_id"] == passer_id)
        ball_x, ball_y = carrier["x"], carrier["y"]
    else:
        ball_x, ball_y = scale_xy(ball_raw["x"], ball_raw["y"], pitch_length, pitch_width)

    options = events[
        (events["event_type"] == "passing_option")
        & (events["associated_player_possession_event_id"] == possession.event_id)
        & (events["frame_start"] <= frame)
        & (events["frame_end"].fillna(events["frame_start"]) >= frame)
    ].copy()
    if options.empty:
        options = events[
            (events["event_type"] == "passing_option")
            & (events["associated_player_possession_event_id"] == possession.event_id)
        ].copy()

    return {
        "meta": meta,
        "lineup": lineup,
        "pitch_length": pitch_length,
        "pitch_width": pitch_width,
        "possession": possession,
        "frame": frame,
        "timestamp": frame_row.get("timestamp"),
        "frame_row": frame_row,
        "players": players,
        "ball_x": ball_x,
        "ball_y": ball_y,
        "attacking_side": possession.attacking_side,
        "passer_team_id": int(possession.team_id),
        "passer_id": passer_id,
        "options": options,
    }


def demo_frame_context():
    meta = load_meta(MATCH_ID)
    lineup = lineup_maps(meta)
    events = pd.read_csv(
        DATA / "matches" / str(MATCH_ID) / f"{MATCH_ID}_dynamic_events.csv",
        low_memory=False,
    )
    possession = events[
        (events["event_type"] == "player_possession") & (events["event_id"] == DEMO_POSSESSION)
    ].iloc[0]
    frame = int(possession.frame_start)
    tracking = load_tracking_frames(MATCH_ID, {frame})
    return frame_context(events, meta, lineup, tracking, frame)


def score_destinations(completion_model, value_model, ctx) -> tuple[pd.DataFrame, pd.DataFrame]:
    passer_team = ctx["passer_team_id"]
    teammates = [
        p for p in ctx["players"] if p["team_id"] == passer_team and p["player_id"] != ctx["passer_id"]
    ]
    option_by_player = {
        int(row.player_id): row for row in ctx["options"].itertuples(index=False)
    }

    teammate_rows = []
    for mate in teammates:
        option = option_by_player.get(mate["player_id"])
        feats = context_features(
            ctx["ball_x"],
            ctx["ball_y"],
            mate["x"],
            mate["y"],
            passer_team,
            ctx["players"],
            ctx["attacking_side"],
            option.n_opponents_ahead_end if option is not None else np.nan,
            option.last_line_break if option is not None else np.nan,
            option.interplayer_distance
            if option is not None
            else dist(ctx["ball_x"], ctx["ball_y"], mate["x"], mate["y"]),
        )
        teammate_rows.append(
            {
                "kind": "teammate",
                "player_id": mate["player_id"],
                "player_name": mate["name"],
                "number": mate["number"],
                "skillcorner_option": option is not None,
                **feats,
            }
        )
    teammates_df = pd.DataFrame(teammate_rows)
    if teammates_df.empty:
        teammates_df = pd.DataFrame(
            columns=FEATURE_COLS
            + [
                "kind",
                "player_id",
                "player_name",
                "number",
                "skillcorner_option",
                "p_complete",
                "epv_if_arrives",
                "expected_epv",
            ]
        )
    else:
        exp, p_c, epv = expected_epv(completion_model, value_model, teammates_df)
        teammates_df["p_complete"] = p_c
        teammates_df["epv_if_arrives"] = epv
        teammates_df["expected_epv"] = exp

    if ctx["attacking_side"] == "left_to_right":
        xs = np.arange(0.0, STANDARD_LENGTH / 2.0 + 1e-6, GRID_STEP)
    else:
        xs = np.arange(-STANDARD_LENGTH / 2.0, 0.0 + 1e-6, GRID_STEP)
    ys = np.arange(-STANDARD_WIDTH / 2.0 + 1.0, STANDARD_WIDTH / 2.0 - 1.0 + 1e-6, GRID_STEP)

    grid_rows = []
    for x in xs:
        for y in ys:
            feats = context_features(
                ctx["ball_x"],
                ctx["ball_y"],
                float(x),
                float(y),
                passer_team,
                ctx["players"],
                ctx["attacking_side"],
                np.nan,
                np.nan,
                dist(ctx["ball_x"], ctx["ball_y"], float(x), float(y)),
            )
            grid_rows.append({"kind": "grid", **feats})
    grid_df = pd.DataFrame(grid_rows)
    exp, p_c, epv = expected_epv(completion_model, value_model, grid_df)
    grid_df["p_complete"] = p_c
    grid_df["epv_if_arrives"] = epv
    grid_df["expected_epv"] = exp
    return teammates_df, grid_df


def _draw_players(ax, ctx, home_id, home_color, away_color, home_number, away_number):
    artists = []
    for player in ctx["players"]:
        color = home_color if player["team_id"] == home_id else away_color
        number_color = home_number if player["team_id"] == home_id else away_number
        edge = "white" if player["team_id"] == home_id else "#1a1a1a"
        size = 320 if player["player_id"] == ctx["passer_id"] else 220
        artists.append(
            ax.scatter(
                [player["x"]],
                [player["y"]],
                s=size,
                c=color,
                edgecolors="#f5d76e" if player["player_id"] == ctx["passer_id"] else edge,
                linewidths=2.0 if player["player_id"] == ctx["passer_id"] else 1.0,
                zorder=4,
            )
        )
        artists.append(
            ax.text(
                player["x"],
                player["y"],
                str(player["number"]),
                color=number_color,
                ha="center",
                va="center",
                fontsize=7,
                fontweight="bold",
                zorder=5,
            )
        )
        artists.append(
            ax.text(
                player["x"],
                player["y"] - 2.2,
                player["name"],
                color="white",
                ha="center",
                va="top",
                fontsize=6,
                zorder=5,
                path_effects=[path_effects.withStroke(linewidth=2, foreground="#0e1a14")],
            )
        )
    artists.append(
        ax.scatter(
            [ctx["ball_x"]],
            [ctx["ball_y"]],
            s=55,
            c="#f5d76e",
            edgecolors="#333333",
            linewidths=0.5,
            zorder=6,
        )
    )
    return artists


def _draw_options(ax, ctx, teammates_df):
    artists = []
    if teammates_df.empty or teammates_df["expected_epv"].isna().all():
        return artists, None, None

    best_team = teammates_df.loc[teammates_df["expected_epv"].idxmax()]
    for _, row in teammates_df.iterrows():
        artists.append(
            ax.plot(
                [ctx["ball_x"], row["dest_x"]],
                [ctx["ball_y"], row["dest_y"]],
                color="#9fd3ff",
                lw=0.8,
                alpha=0.55,
                zorder=3,
            )[0]
        )
        artists.append(
            ax.text(
                row["dest_x"],
                row["dest_y"] + 1.6,
                f"{row['expected_epv']:.3f}",
                color="#dcefff",
                fontsize=7,
                ha="center",
                zorder=6,
            )
        )
    artists.append(
        ax.scatter(
            [best_team["dest_x"]],
            [best_team["dest_y"]],
            s=220,
            facecolors="none",
            edgecolors="#32FE6B",
            linewidths=2.4,
            zorder=7,
        )
    )
    artists.append(
        ax.plot(
            [ctx["ball_x"], best_team["dest_x"]],
            [ctx["ball_y"], best_team["dest_y"]],
            color="#32FE6B",
            lw=2.2,
            zorder=6,
        )[0]
    )
    return artists, best_team, None


def plot_surface(ctx, teammates_df: pd.DataFrame, grid_df: pd.DataFrame):
    meta = ctx["meta"]
    home_id = meta["home_team"]["id"]
    home_color = meta["home_team_kit"]["jersey_color"]
    away_color = meta["away_team_kit"]["jersey_color"]
    home_number = meta["home_team_kit"]["number_color"]
    away_number = meta["away_team_kit"]["number_color"]

    pitch = Pitch(
        pitch_type="skillcorner",
        pitch_length=STANDARD_LENGTH,
        pitch_width=STANDARD_WIDTH,
        pitch_color="#1a3d2b",
        line_color="white",
        line_alpha=0.85,
        linewidth=1.1,
    )
    fig, ax = pitch.draw(figsize=(13.5, 8.2))
    fig.patch.set_facecolor("#0e1a14")

    pivot = grid_df.pivot_table(index="dest_y", columns="dest_x", values="expected_epv")
    xs = pivot.columns.to_numpy()
    ys = pivot.index.to_numpy()
    xx, yy = np.meshgrid(xs, ys)
    vmax = max(float(grid_df["expected_epv"].quantile(0.98)), 1e-4)
    mesh = ax.pcolormesh(
        xx,
        yy,
        pivot.to_numpy(),
        shading="nearest",
        cmap="magma",
        norm=Normalize(vmin=0.0, vmax=vmax),
        alpha=0.72,
        zorder=2,
    )
    cbar = fig.colorbar(mesh, ax=ax, fraction=0.035, pad=0.02)
    cbar.set_label("expected EPV", color="white")
    cbar.ax.yaxis.set_tick_params(color="white")
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color="white")

    _draw_players(ax, ctx, home_id, home_color, away_color, home_number, away_number)
    option_artists, best_team, _ = _draw_options(ax, ctx, teammates_df)
    best_grid = grid_df.loc[grid_df["expected_epv"].idxmax()]
    ax.scatter(
        [best_grid["dest_x"]],
        [best_grid["dest_y"]],
        s=180,
        marker="X",
        c="#ff5a36",
        edgecolors="white",
        linewidths=0.8,
        zorder=7,
        label="best grid cell",
    )
    if best_team is not None:
        ax.scatter(
            [],
            [],
            s=220,
            facecolors="none",
            edgecolors="#32FE6B",
            linewidths=2.4,
            label=f"best teammate ({best_team['player_name']})",
        )

    passer_name = ctx["lineup"][ctx["passer_id"]]["name"]
    team_epv = (
        f"{best_team['expected_epv']:.3f}" if best_team is not None else "n/a"
    )
    ax.set_title(
        f"{meta['home_team']['short_name']} vs {meta['away_team']['short_name']}  ·  "
        f"{ctx['possession'].time_start}  ·  {passer_name} on the ball\n"
        f"best teammate expected EPV {team_epv}  ·  "
        f"best empty cell {best_grid['expected_epv']:.3f}",
        color="white",
        fontsize=12,
        pad=12,
    )
    legend = ax.legend(loc="upper left", frameon=False, labelcolor="white", fontsize=9)
    for text in legend.get_texts():
        text.set_color("white")

    OUT_DIR.mkdir(exist_ok=True)
    fig.savefig(FIG_PATH, dpi=160, facecolor=fig.get_facecolor(), bbox_inches="tight")
    plt.close(fig)
    return best_team, best_grid


def render_video(completion_model, value_model):
    meta = load_meta(MATCH_ID)
    lineup = lineup_maps(meta)
    events = pd.read_csv(
        DATA / "matches" / str(MATCH_ID) / f"{MATCH_ID}_dynamic_events.csv",
        low_memory=False,
    )
    possessions = events[events["event_type"] == "player_possession"]
    start = int(possessions.loc[possessions["event_id"] == VIDEO_START_POSSESSION, "frame_start"].iloc[0])
    end = int(possessions.loc[possessions["event_id"] == DEMO_POSSESSION, "frame_end"].iloc[0])
    frames = list(range(start, end + 1))
    tracking = load_tracking_frames(MATCH_ID, set(frames))

    scored = []
    vmax = 0.08
    for frame in frames:
        ctx = frame_context(events, meta, lineup, tracking, frame)
        if ctx is None:
            scored.append(None)
            continue
        teammates_df, grid_df = score_destinations(completion_model, value_model, ctx)
        vmax = max(vmax, float(grid_df["expected_epv"].quantile(0.98)))
        scored.append((ctx, teammates_df, grid_df))

    home_id = meta["home_team"]["id"]
    home_color = meta["home_team_kit"]["jersey_color"]
    away_color = meta["away_team_kit"]["jersey_color"]
    home_number = meta["home_team_kit"]["number_color"]
    away_number = meta["away_team_kit"]["number_color"]

    first = next(item for item in scored if item is not None)
    _, _, first_grid = first
    pivot0 = first_grid.pivot_table(index="dest_y", columns="dest_x", values="expected_epv")
    xs = pivot0.columns.to_numpy()
    ys = pivot0.index.to_numpy()
    xx, yy = np.meshgrid(xs, ys)

    pitch = Pitch(
        pitch_type="skillcorner",
        pitch_length=STANDARD_LENGTH,
        pitch_width=STANDARD_WIDTH,
        pitch_color="#1a3d2b",
        line_color="white",
        line_alpha=0.85,
        linewidth=1.1,
    )
    fig, ax = pitch.draw(figsize=(12.8, 7.2))
    fig.patch.set_facecolor("#0e1a14")
    mesh = ax.pcolormesh(
        xx,
        yy,
        pivot0.to_numpy(),
        shading="nearest",
        cmap="magma",
        norm=Normalize(vmin=0.0, vmax=vmax),
        alpha=0.72,
        zorder=2,
    )
    cbar = fig.colorbar(mesh, ax=ax, fraction=0.035, pad=0.02)
    cbar.set_label("expected EPV", color="white")
    cbar.ax.yaxis.set_tick_params(color="white")
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color="white")
    title = ax.set_title("", color="white", fontsize=12, pad=12)
    dynamic_artists = []

    def clear_dynamic():
        nonlocal dynamic_artists
        for artist in dynamic_artists:
            artist.remove()
        dynamic_artists = []

    def update(i):
        clear_dynamic()
        item = scored[i]
        if item is None:
            title.set_text(
                f"{meta['home_team']['short_name']} vs {meta['away_team']['short_name']}  ·  "
                f"frame {frames[i]}  ·  no player on the ball"
            )
            mesh.set_array(np.ma.masked_all(pivot0.to_numpy().shape).ravel())
            return [mesh, title]

        ctx, teammates_df, grid_df = item
        pivot = grid_df.pivot_table(index="dest_y", columns="dest_x", values="expected_epv")
        pivot = pivot.reindex(index=ys, columns=xs)
        mesh.set_array(np.ma.masked_invalid(pivot.to_numpy()).ravel())

        dynamic_artists.extend(
            _draw_players(ax, ctx, home_id, home_color, away_color, home_number, away_number)
        )
        option_artists, best_team, _ = _draw_options(ax, ctx, teammates_df)
        dynamic_artists.extend(option_artists)
        best_grid = grid_df.loc[grid_df["expected_epv"].idxmax()]
        dynamic_artists.append(
            ax.scatter(
                [best_grid["dest_x"]],
                [best_grid["dest_y"]],
                s=180,
                marker="X",
                c="#ff5a36",
                edgecolors="white",
                linewidths=0.8,
                zorder=7,
            )
        )
        passer_name = ctx["lineup"][ctx["passer_id"]]["name"]
        stamp = ctx["timestamp"] or ctx["possession"].time_start
        team_epv = (
            f"{best_team['expected_epv']:.3f}" if best_team is not None else "n/a"
        )
        title.set_text(
            f"{meta['home_team']['short_name']} vs {meta['away_team']['short_name']}  ·  "
            f"{stamp}  ·  {passer_name} on the ball\n"
            f"best teammate expected EPV {team_epv}  ·  "
            f"best empty cell {best_grid['expected_epv']:.3f}"
        )
        return [mesh, title, *dynamic_artists]

    anim = FuncAnimation(fig, update, frames=len(frames), interval=1000 / FPS, blit=False)
    OUT_DIR.mkdir(exist_ok=True)
    writer = FFMpegWriter(
        fps=FPS,
        codec="libx264",
        bitrate=2800,
        extra_args=["-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"],
    )
    anim.save(VIDEO_PATH, writer=writer, dpi=100)
    plt.close(fig)
    print(f"wrote {VIDEO_PATH} ({len(frames)} frames, {start}-{end})")


def get_training_table(ids: list[int]) -> pd.DataFrame:
    import pickle

    if CACHE_PATH.exists():
        print(f"loading training cache {CACHE_PATH}")
        with CACHE_PATH.open("rb") as fh:
            return pickle.load(fh)
    table = build_training_table(ids)
    OUT_DIR.mkdir(exist_ok=True)
    with CACHE_PATH.open("wb") as fh:
        pickle.dump(table, fh, protocol=pickle.HIGHEST_PROTOCOL)
    print(f"wrote training cache {CACHE_PATH}")
    return table


def main():
    ids = match_ids()
    table = get_training_table(ids)
    print(f"training rows: {len(table)}")
    completion_model, value_model, metrics = train_models(table)
    print("hold-out metrics:", metrics)

    ctx = demo_frame_context()
    teammates_df, grid_df = score_destinations(completion_model, value_model, ctx)
    best_team, best_grid = plot_surface(ctx, teammates_df, grid_df)

    grid_out = grid_df[
        [
            "dest_x",
            "dest_y",
            "pass_distance",
            "p_complete",
            "epv_if_arrives",
            "expected_epv",
            "nearest_opp_dist",
            "opponents_in_lane",
        ]
    ].sort_values("expected_epv", ascending=False)
    grid_out.to_csv(GRID_PATH, index=False)

    print(f"wrote {FIG_PATH}")
    print(f"wrote {GRID_PATH}")
    print(
        "best teammate:",
        None if best_team is None else best_team["player_name"],
        None if best_team is None else float(best_team["expected_epv"]),
    )
    print(
        "best grid cell:",
        float(best_grid["dest_x"]),
        float(best_grid["dest_y"]),
        float(best_grid["expected_epv"]),
    )
    print("SkillCorner options on this possession:", len(ctx["options"]))
    render_video(completion_model, value_model)


if __name__ == "__main__":
    main()
