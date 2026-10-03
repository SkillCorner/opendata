"""Render the opening minutes of a match, with expected possession value.

Tracking is 10 fps. EPV is stored only at the start and end of each player
possession, so within a spell the line moves from the measured start to the
measured end. Between spells there is no value.
"""

import json
from pathlib import Path

import imageio_ffmpeg
import matplotlib

matplotlib.rcParams["animation.ffmpeg_path"] = imageio_ffmpeg.get_ffmpeg_exe()

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.animation import FFMpegWriter, FuncAnimation
from mplsoccer import Pitch

MATCH_ID = 1886347
SECONDS = 150
FPS = 10
MIN_PLAYERS = 18

ROOT = Path(__file__).resolve().parents[1]
MATCH_DIR = ROOT / "data" / "matches" / str(MATCH_ID)
OUT = ROOT / "output" / "auckland_newcastle_2m30_epv.mp4"


def load_meta():
    meta = json.loads((MATCH_DIR / f"{MATCH_ID}_match.json").read_text(encoding="utf-8"))
    lineup = {
        player["id"]: {
            "number": player["number"],
            "team_id": player["team_id"],
            "name": player["short_name"],
        }
        for player in meta["players"]
    }
    return meta, lineup


def load_frames(lineup):
    frames = []
    started = False
    path = MATCH_DIR / f"{MATCH_ID}_tracking_extrapolated.jsonl"
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            row = json.loads(line)
            if row.get("period") != 1:
                if started:
                    break
                continue
            known = [
                player
                for player in row.get("player_data") or []
                if player.get("x") is not None and player["player_id"] in lineup
            ]
            if not started:
                if len(known) < MIN_PLAYERS:
                    continue
                started = True
            frames.append(row)
            if len(frames) == SECONDS * FPS:
                break
    if len(frames) < SECONDS * FPS:
        raise RuntimeError(f"Only found {len(frames)} frames, expected {SECONDS * FPS}")
    return frames


def load_possessions(frames):
    first, last = frames[0]["frame"], frames[-1]["frame"]
    events = pd.read_csv(MATCH_DIR / f"{MATCH_ID}_dynamic_events.csv")
    spells = events[
        (events["event_type"] == "player_possession")
        & (events["period"] == 1)
        & (events["frame_end"] >= first)
        & (events["frame_start"] <= last)
        & events["possession_epv_for_start"].notna()
        & events["possession_epv_for_end"].notna()
    ]
    possessions = []
    for row in spells.itertuples(index=False):
        possessions.append(
            {
                "frame_start": int(row.frame_start),
                "frame_end": int(row.frame_end),
                "epv_start": float(row.possession_epv_for_start),
                "epv_end": float(row.possession_epv_for_end),
                "player_id": int(row.player_id) if pd.notna(row.player_id) else None,
                "team_id": int(row.team_id),
                "end_type": row.end_type,
            }
        )
    return possessions


def spell_at(possessions, frame):
    for spell in possessions:
        if spell["frame_start"] <= frame <= spell["frame_end"]:
            span = max(spell["frame_end"] - spell["frame_start"], 1)
            progress = (frame - spell["frame_start"]) / span
            value = spell["epv_start"] + progress * (spell["epv_end"] - spell["epv_start"])
            return spell, value, value - spell["epv_start"]
    return None, None, None


def split_teams(row, lineup, home_id):
    home_xy, home_nums, away_xy, away_nums = [], [], [], []
    for player in row["player_data"]:
        if player.get("x") is None:
            continue
        info = lineup.get(player["player_id"])
        if info is None:
            continue
        point = (player["x"], player["y"])
        if info["team_id"] == home_id:
            home_xy.append(point)
            home_nums.append(str(info["number"]))
        else:
            away_xy.append(point)
            away_nums.append(str(info["number"]))
    return home_xy, home_nums, away_xy, away_nums


def player_xy(row, player_id):
    for player in row["player_data"]:
        if player["player_id"] == player_id and player.get("x") is not None:
            return player["x"], player["y"]
    return None


def main():
    meta, lineup = load_meta()
    frames = load_frames(lineup)
    possessions = load_possessions(frames)
    home_id = meta["home_team"]["id"]
    home_name = meta["home_team"]["short_name"]
    away_name = meta["away_team"]["short_name"]
    home_color = meta["home_team_kit"]["jersey_color"]
    away_color = meta["away_team_kit"]["jersey_color"]
    home_number_color = meta["home_team_kit"]["number_color"]
    away_number_color = meta["away_team_kit"]["number_color"]
    chart_home = "#7eb6ff"
    chart_away = "#f4f1e8"
    team_name = {home_id: home_name, meta["away_team"]["id"]: away_name}

    series = []
    for index, row in enumerate(frames):
        spell, value, _delta = spell_at(possessions, row["frame"])
        series.append((index / FPS, value, None if spell is None else spell["team_id"]))

    pitch = Pitch(
        pitch_type="skillcorner",
        pitch_length=meta["pitch_length"],
        pitch_width=meta["pitch_width"],
        pitch_color="#1a3d2b",
        line_color="white",
        line_alpha=0.9,
        linewidth=1.2,
    )
    fig = plt.figure(figsize=(13.6, 7.4))
    fig.patch.set_facecolor("#0e1a14")
    pitch_ax = fig.add_axes([0.025, 0.05, 0.62, 0.84])
    pitch.draw(ax=pitch_ax)
    epv_ax = fig.add_axes([0.70, 0.22, 0.27, 0.46])
    epv_ax.set_facecolor("#12261c")
    for spine in epv_ax.spines.values():
        spine.set_color("#3d5c4a")
    epv_ax.tick_params(colors="#d5ddd8", labelsize=8)
    epv_ax.set_xlim(0, SECONDS)
    epv_ax.set_ylim(0, 0.36)
    epv_ax.set_xlabel("seconds", color="#d5ddd8", fontsize=8)
    epv_ax.set_ylabel("EPV for the team on the ball", color="#d5ddd8", fontsize=8)
    epv_ax.set_title("Expected possession value", color="white", fontsize=11, pad=8)
    epv_ax.axhline(0.02, color="#3d5c4a", lw=0.6, zorder=0)
    home_line, = epv_ax.plot([], [], color=chart_home, lw=2.0, label=home_name)
    away_line, = epv_ax.plot([], [], color=chart_away, lw=2.0, label=away_name)
    cursor = epv_ax.axvline(0, color="#f5d76e", lw=0.8)
    epv_ax.legend(frameon=False, labelcolor="white", fontsize=8, loc="upper left")

    home_dots = pitch_ax.scatter([], [], s=260, c=home_color, edgecolors="white", linewidths=1.1, zorder=3)
    away_dots = pitch_ax.scatter([], [], s=260, c=away_color, edgecolors="#1a1a1a", linewidths=1.1, zorder=3)
    carrier = pitch_ax.scatter([], [], s=520, facecolors="none", edgecolors="#f5d76e", linewidths=2.0, zorder=6)
    ball_dot = pitch_ax.scatter([], [], s=55, c="#f5d76e", edgecolors="#333333", linewidths=0.5, zorder=5)
    home_labels = [
        pitch_ax.text(0, 0, "", color=home_number_color, ha="center", va="center", fontsize=7, fontweight="bold", zorder=4, visible=False)
        for _ in range(16)
    ]
    away_labels = [
        pitch_ax.text(0, 0, "", color=away_number_color, ha="center", va="center", fontsize=7, fontweight="bold", zorder=4, visible=False)
        for _ in range(16)
    ]
    title = fig.text(0.03, 0.955, "", color="white", fontsize=13, ha="left", va="top")
    epv_value = fig.text(0.70, 0.90, "EPV", color="white", fontsize=22, fontweight="bold", ha="left", va="top")
    epv_detail = fig.text(0.70, 0.82, "", color="#d5ddd8", fontsize=10, ha="left", va="top")

    def place(labels, points, numbers):
        for label in labels:
            label.set_visible(False)
        for label, point, number in zip(labels, points, numbers):
            label.set_position(point)
            label.set_text(number)
            label.set_visible(True)

    def trace(upto, team_id):
        xs, ys = [], []
        for second, value, owner in series[: upto + 1]:
            if owner == team_id and value is not None:
                xs.append(second)
                ys.append(value)
            elif xs:
                xs.append(second)
                ys.append(np.nan)
        return xs, ys

    def update(i):
        row = frames[i]
        home_xy, home_nums, away_xy, away_nums = split_teams(row, lineup, home_id)
        home_dots.set_offsets(np.array(home_xy) if home_xy else np.empty((0, 2)))
        away_dots.set_offsets(np.array(away_xy) if away_xy else np.empty((0, 2)))
        place(home_labels, home_xy, home_nums)
        place(away_labels, away_xy, away_nums)
        ball = row["ball_data"]
        if ball.get("x") is not None:
            ball_dot.set_offsets([[ball["x"], ball["y"]]])
        else:
            ball_dot.set_offsets(np.empty((0, 2)))

        spell, value, delta = spell_at(possessions, row["frame"])
        if spell and spell["player_id"] is not None:
            point = player_xy(row, spell["player_id"])
            carrier.set_offsets([point] if point else np.empty((0, 2)))
            who = lineup.get(spell["player_id"], {}).get("name", "")
            side = team_name.get(spell["team_id"], "")
            sign = "+" if delta >= 0 else ""
            epv_value.set_text(f"{value:.3f}")
            epv_value.set_color("#b6f0c2" if delta >= 0 else "#ffb4a8")
            ending = f"  ·  {spell['end_type'].replace('_', ' ')}" if row["frame"] == spell["frame_end"] else ""
            epv_detail.set_text(f"{who}  ·  {side}\nthis spell {sign}{delta:.3f}{ending}")
        else:
            carrier.set_offsets(np.empty((0, 2)))
            epv_value.set_text("—")
            epv_value.set_color("#d5ddd8")
            epv_detail.set_text("no player on the ball")

        home_line.set_data(*trace(i, home_id))
        away_line.set_data(*trace(i, meta["away_team"]["id"]))
        cursor.set_xdata([i / FPS, i / FPS])
        title.set_text(f"{home_name} vs {away_name}    {row['timestamp']}    1st half")
        return home_dots, away_dots, ball_dot

    anim = FuncAnimation(fig, update, frames=len(frames), interval=1000 / FPS, blit=False)
    OUT.parent.mkdir(exist_ok=True)
    writer = FFMpegWriter(
        fps=FPS,
        codec="libx264",
        bitrate=2400,
        extra_args=["-pix_fmt", "yuv420p"],
    )
    anim.save(OUT, writer=writer, dpi=80)
    plt.close(fig)
    print(f"wrote {OUT}")
    print(f"from {frames[0]['timestamp']} to {frames[-1]['timestamp']} ({len(frames)} frames, {len(possessions)} valued possessions)")


if __name__ == "__main__":
    main()
