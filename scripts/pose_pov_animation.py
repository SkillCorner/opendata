"""Top-down 2D animation of the Brisbane body-pose sample phase.

Uses match 1925299 sample (quick break, ~12 s). Players are drawn on a
SkillCorner pitch with kit colours, shirt numbers, and names. The ball carrier
is ringed in yellow (tagged possession, or nearest player to the ball when
possession is missing).
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import imageio_ffmpeg
import matplotlib

matplotlib.rcParams["animation.ffmpeg_path"] = imageio_ffmpeg.get_ffmpeg_exe()

import matplotlib.pyplot as plt
import matplotlib.patheffects as path_effects
import numpy as np
from matplotlib.animation import FFMpegWriter, FuncAnimation
from mplsoccer import Pitch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.data.pose_loading import iter_sample  # noqa: E402

MATCH_ID = 1925299
FPS = 12.5
FRAME_STRIDE = 2

OUT = ROOT / "output" / "brisbane_pose_2d.mp4"
META_PATH = ROOT / "data" / "matches" / str(MATCH_ID) / f"{MATCH_ID}_match.json"


def load_meta():
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    lineup = {
        p["id"]: {
            "name": p["short_name"],
            "number": p["number"],
            "team_id": p["team_id"],
        }
        for p in meta["players"]
    }
    return meta, lineup


def choose_carrier(players: list, possession: dict, ball: dict):
    poss_id = (possession or {}).get("player_id")
    by_id = {p["player_id"]: p for p in players}
    if poss_id is not None:
        carrier = by_id.get(poss_id)
        if carrier is not None and carrier.get("x") is not None:
            return carrier, False

    if ball.get("x") is None:
        return None, True
    ranked = []
    for player in players:
        if player.get("x") is None:
            continue
        dist = math.hypot(player["x"] - ball["x"], player["y"] - ball["y"])
        ranked.append((dist, player))
    if not ranked:
        return None, True
    ranked.sort(key=lambda item: item[0])
    return ranked[0][1], True


def prepare_frames(meta, lineup):
    frames = []
    for row in list(iter_sample())[::FRAME_STRIDE]:
        players = []
        for player in row.get("player_data") or []:
            if player.get("x") is None or player["player_id"] not in lineup:
                continue
            info = lineup[player["player_id"]]
            players.append(
                {
                    "player_id": player["player_id"],
                    "x": player["x"],
                    "y": player["y"],
                    "name": info["name"],
                    "number": info["number"],
                    "team_id": info["team_id"],
                    "has_pose": bool(player.get("joints")),
                }
            )
        ball = row.get("ball_data") or {}
        carrier, inferred = choose_carrier(
            row.get("player_data") or [], row.get("possession") or {}, ball
        )
        frames.append(
            {
                "timestamp": row.get("timestamp"),
                "players": players,
                "ball": ball,
                "carrier_id": None if carrier is None else carrier["player_id"],
                "carrier_inferred": inferred,
            }
        )
    return frames


def render(frames, meta, lineup):
    home_id = meta["home_team"]["id"]
    home_color = meta["home_team_kit"]["jersey_color"]
    away_color = meta["away_team_kit"]["jersey_color"]
    home_number = meta["home_team_kit"]["number_color"]
    away_number = meta["away_team_kit"]["number_color"]

    pitch = Pitch(
        pitch_type="skillcorner",
        pitch_length=meta["pitch_length"],
        pitch_width=meta["pitch_width"],
        pitch_color="#1a3d2b",
        line_color="white",
        line_alpha=0.9,
        linewidth=1.2,
    )
    fig, ax = pitch.draw(figsize=(12.8, 7.2))
    fig.patch.set_facecolor("#0e1a14")

    home_dots = ax.scatter([], [], s=220, c=home_color, edgecolors="white", linewidths=1.0, zorder=3)
    away_dots = ax.scatter([], [], s=220, c=away_color, edgecolors="#1a1a1a", linewidths=1.0, zorder=3)
    carrier_ring = ax.scatter(
        [], [], s=420, facecolors="none", edgecolors="#f5d76e", linewidths=2.2, zorder=5
    )
    ball_dot = ax.scatter([], [], s=55, c="#f5d76e", edgecolors="#333333", linewidths=0.5, zorder=6)
    title = fig.text(0.03, 0.96, "", color="white", fontsize=13, ha="left", va="top")
    dynamic = []

    def clear_dynamic():
        nonlocal dynamic
        for artist in dynamic:
            artist.remove()
        dynamic = []

    def update(i):
        clear_dynamic()
        frame = frames[i]
        home_xy, away_xy = [], []
        for player in frame["players"]:
            point = (player["x"], player["y"])
            if player["team_id"] == home_id:
                home_xy.append(point)
            else:
                away_xy.append(point)
            number_color = home_number if player["team_id"] == home_id else away_number
            dynamic.append(
                ax.text(
                    player["x"],
                    player["y"],
                    str(player["number"]),
                    color=number_color,
                    ha="center",
                    va="center",
                    fontsize=7,
                    fontweight="bold",
                    zorder=4,
                )
            )
            dynamic.append(
                ax.text(
                    player["x"],
                    player["y"] - 2.2,
                    player["name"],
                    color="white",
                    ha="center",
                    va="top",
                    fontsize=6,
                    zorder=4,
                    path_effects=[path_effects.withStroke(linewidth=2, foreground="#0e1a14")],
                )
            )

        home_dots.set_offsets(np.array(home_xy) if home_xy else np.empty((0, 2)))
        away_dots.set_offsets(np.array(away_xy) if away_xy else np.empty((0, 2)))

        carrier = next((p for p in frame["players"] if p["player_id"] == frame["carrier_id"]), None)
        if carrier is None:
            carrier_ring.set_offsets(np.empty((0, 2)))
            carrier_label = "no carrier"
        else:
            carrier_ring.set_offsets([[carrier["x"], carrier["y"]]])
            tag = "inferred" if frame["carrier_inferred"] else "on ball"
            carrier_label = f"#{carrier['number']} {carrier['name']} ({tag})"

        ball = frame["ball"]
        if ball.get("x") is None:
            ball_dot.set_offsets(np.empty((0, 2)))
        else:
            ball_dot.set_offsets([[ball["x"], ball["y"]]])

        title.set_text(
            f"{meta['home_team']['short_name']} vs {meta['away_team']['short_name']}  ·  "
            f"{frame['timestamp']}  ·  {carrier_label}"
        )
        return home_dots, away_dots, carrier_ring, ball_dot

    anim = FuncAnimation(fig, update, frames=len(frames), interval=1000 / FPS, blit=False)
    OUT.parent.mkdir(exist_ok=True)
    writer = FFMpegWriter(
        fps=FPS,
        codec="libx264",
        bitrate=2400,
        extra_args=["-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"],
    )
    anim.save(OUT, writer=writer, dpi=100)
    plt.close(fig)
    print(f"wrote {OUT} ({len(frames)} frames @ {FPS} fps)")


def main():
    meta, lineup = load_meta()
    frames = prepare_frames(meta, lineup)
    render(frames, meta, lineup)


if __name__ == "__main__":
    main()
