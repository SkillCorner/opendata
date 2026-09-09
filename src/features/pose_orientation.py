"""Shoulder orientation from body-pose data — a worked example.

This is a baseline to show how to work with body pose and deduce vectors,
including the gating such a feature needs in practice. Read it and adapt it.

The angle is the ground-plane direction the shoulders face: the left→right
shoulder axis rotated by +90 degrees. 0 degrees points along +x on the pitch,
counter-clockwise is positive, and the range is (-180, 180].

Five things are gated, because each produces a plausible-looking but wrong
number if ignored:

1. **Pose must exist.** ``joints`` is ``None`` for undetected players.
2. **Both shoulders must be present** in that player's joint dictionary.
3. **The shoulders must not coincide.** When the two points collapse, the
   perpendicular is undefined and ``atan2`` returns noise.
4. **The shoulder width must be anatomically plausible.** A collapsed pose
   still yields an angle, just a meaningless one.
5. **The estimate must be accurate enough.** Each joint carries
   ``p90_mae_cm``; a shoulder measured to +/-40 cm cannot support an angle.

Note that ``z`` is not used here at all: it is accurate relative to the
player's centroid rather than in the pitch coordinate system, so only ``x`` and
``y`` are meaningful for a ground-plane heading.

One caveat if you go on to differentiate this: at 25 fps, a couple of degrees
of frame-to-frame jitter becomes tens of degrees per second, so a raw turn rate
is noise-dominated. Smooth the heading before reading anything into how fast a
player is turning, and remember the -180/180 wrap.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from typing import Any

import pandas as pd

LEFT_SHOULDER = "lShoulder"
RIGHT_SHOULDER = "rShoulder"

#: Below this shoulder width (metres) the perpendicular is undefined.
MIN_SHOULDER_WIDTH_M = 1e-6

#: Anatomically plausible shoulder width, in metres. Estimates outside this are
#: a collapsed or stretched pose, not a real posture, and the angle they give is
#: noise even though the maths succeeds.
PLAUSIBLE_WIDTH_M = (0.15, 0.60)

#: Default accuracy gate. Joints are typically 7-15 cm; 15 keeps most frames.
DEFAULT_MAX_ERR_CM = 15.0

POSE_FPS = 25
TRACKING_FPS = 10

COLUMNS = [
    "frame", "frame_10fps", "period", "t_s", "player_id",
    "shoulder_deg", "shoulder_width_m", "shoulder_err_cm", "is_reliable",
    "l_shoulder_x", "l_shoulder_y", "r_shoulder_x", "r_shoulder_y",
]


def shoulder_orientation_deg(lx: float, ly: float, rx: float, ry: float) -> float | None:
    """Ground-plane angle the shoulders face, in degrees.

    Args:
        lx: Left shoulder x, in metres.
        ly: Left shoulder y, in metres.
        rx: Right shoulder x, in metres.
        ry: Right shoulder y, in metres.

    Returns:
        The heading in (-180, 180], or None when the two shoulders coincide so
        closely that the perpendicular is undefined.
    """
    # Forward is the left->right axis rotated +90 degrees.
    fx, fy = -(ry - ly), rx - lx
    if math.hypot(fx, fy) < MIN_SHOULDER_WIDTH_M:
        return None
    return math.degrees(math.atan2(fy, fx))


def fold_to_tracking_frame(pose_frame: int) -> int:
    """Fold a 25 fps pose frame onto the 10 fps tracking grid.

    Args:
        pose_frame: Frame number on the pose clock.

    Returns:
        The nearest tracking frame, rounded half-up to match the frame grid
        used by the tracking, events and phases files.
    """
    return math.floor(pose_frame * (TRACKING_FPS / POSE_FPS) + 0.5)


def _shoulder_row(record: dict[str, Any], player: dict[str, Any],
                  max_err_cm: float) -> dict[str, Any] | None:
    """Build one output row for one player in one frame, or None if unusable.

    Args:
        record: A whole pose frame.
        player: One entry from the frame's ``player_data``.
        max_err_cm: Accuracy gate applied to the worse of the two shoulders.

    Returns:
        A row dict, or None when the player has no pose at all or is missing a
        shoulder. Rows that fail only the accuracy or width gate are returned
        with ``is_reliable`` set to False, so callers can see what was dropped.
    """
    joints = player.get("joints")
    if not joints:                                    # gate 1: no pose
        return None
    left, right = joints.get(LEFT_SHOULDER), joints.get(RIGHT_SHOULDER)
    if not left or not right:                         # gate 2: shoulder missing
        return None

    lx, ly, _ = left["xyz"]
    rx, ry, _ = right["xyz"]
    angle = shoulder_orientation_deg(lx, ly, rx, ry)  # gate 3: degenerate width
    width = math.hypot(rx - lx, ry - ly)
    err = max(left.get("p90_mae_cm") or math.inf,
              right.get("p90_mae_cm") or math.inf)

    frame = record["frame"]
    return {
        "frame": frame,
        "frame_10fps": fold_to_tracking_frame(frame),
        "period": record.get("period"),
        "t_s": frame / POSE_FPS,
        "player_id": player["player_id"],
        "shoulder_deg": angle,
        "shoulder_width_m": width,
        "shoulder_err_cm": None if err == math.inf else err,
        # gates 4 and 5, reported rather than silently dropped
        "is_reliable": (angle is not None
                        and PLAUSIBLE_WIDTH_M[0] <= width <= PLAUSIBLE_WIDTH_M[1]
                        and err <= max_err_cm),
        "l_shoulder_x": lx, "l_shoulder_y": ly,
        "r_shoulder_x": rx, "r_shoulder_y": ry,
    }


def shoulder_table(records: Iterable[dict[str, Any]],
                   max_err_cm: float = DEFAULT_MAX_ERR_CM) -> pd.DataFrame:
    """Compute shoulder orientation for every player in every frame.

    Args:
        records: Pose frames, e.g. from ``src.data.pose_loading.iter_sample``.
        max_err_cm: Accuracy gate on the worse of the two shoulder joints.

    Returns:
        Long format, one row per player per frame that had both shoulders,
        sorted by player then frame. Use the ``is_reliable`` column to filter;
        it is left to the caller so the discarded rows remain visible.
    """
    rows = [
        row
        for record in records
        for player in (record.get("player_data") or [])
        if (row := _shoulder_row(record, player, max_err_cm)) is not None
    ]
    if not rows:
        return pd.DataFrame(columns=COLUMNS)
    return (pd.DataFrame(rows, columns=COLUMNS)
            .sort_values(["player_id", "frame"], ignore_index=True))


def gating_report(records: Iterable[dict[str, Any]],
                  max_err_cm: float = DEFAULT_MAX_ERR_CM) -> pd.DataFrame:
    """Count what each gate removed, so coverage is explicit rather than assumed.

    Args:
        records: Pose frames.
        max_err_cm: Accuracy gate on the worse of the two shoulder joints.

    Returns:
        One row per gate with the count reaching it and the count it dropped.
    """
    seen = no_pose = missing_shoulder = degenerate = implausible = too_noisy = kept = 0
    for record in records:
        for player in record.get("player_data") or []:
            seen += 1
            joints = player.get("joints")
            if not joints:
                no_pose += 1
                continue
            left, right = joints.get(LEFT_SHOULDER), joints.get(RIGHT_SHOULDER)
            if not left or not right:
                missing_shoulder += 1
                continue
            lx, ly, _ = left["xyz"]
            rx, ry, _ = right["xyz"]
            if shoulder_orientation_deg(lx, ly, rx, ry) is None:
                degenerate += 1
                continue
            width = math.hypot(rx - lx, ry - ly)
            if not PLAUSIBLE_WIDTH_M[0] <= width <= PLAUSIBLE_WIDTH_M[1]:
                implausible += 1
                continue
            err = max(left.get("p90_mae_cm") or math.inf,
                      right.get("p90_mae_cm") or math.inf)
            if err > max_err_cm:
                too_noisy += 1
                continue
            kept += 1
    return pd.DataFrame(
        [
            {"gate": "player-frames seen", "dropped": 0, "remaining": seen},
            {"gate": "no pose (undetected)", "dropped": no_pose,
             "remaining": seen - no_pose},
            {"gate": "a shoulder missing", "dropped": missing_shoulder,
             "remaining": seen - no_pose - missing_shoulder},
            {"gate": "shoulders coincide", "dropped": degenerate,
             "remaining": seen - no_pose - missing_shoulder - degenerate},
            {"gate": f"width outside {PLAUSIBLE_WIDTH_M[0]}-{PLAUSIBLE_WIDTH_M[1]} m",
             "dropped": implausible,
             "remaining": seen - no_pose - missing_shoulder - degenerate - implausible},
            {"gate": f"error > {max_err_cm:.0f} cm", "dropped": too_noisy,
             "remaining": kept},
        ]
    )
