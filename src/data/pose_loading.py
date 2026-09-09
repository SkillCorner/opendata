"""Load SkillCorner body-pose data.

Pose data is large (about 3.3 GB of JSON per match) so it is hosted on the
Hugging Face Hub rather than in this repository. A single phase of play is
committed here as a sample so the tutorials run without a download.

Things to keep in mind:

* Pose runs at **25 fps**; the tracking data in this repo runs at **10 fps**.
  Use :func:`tracking_to_pose_frame` to convert between them. The 2D ``x``/``y``
  positions in the pose file are interpolated up to 25 fps.
* A player's ``joints`` field is ``None`` when pose could not be resolved for
  them in that frame, even though their ``x``/``y`` position may be present.
  Pose is only provided for detected players.
* ``z`` is accurate **relative to the player's centroid**, not in the pitch
  coordinate system, so it is not a height above the pitch surface and can be
  negative. Treat it as pose geometry, not elevation.
* Tracking and pose are generated separately, so expect minor misalignments
  between the ``x``/``y`` and ``is_detected`` attributes and the joints.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pandas as pd

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
BODYPOSE_DIR = DATA_DIR / "bodypose"
MANIFEST_PATH = BODYPOSE_DIR / "MANIFEST.json"
SAMPLE_PATH = BODYPOSE_DIR / "sample_1925299_phase406.jsonl.gz"


def manifest() -> dict[str, Any]:
    """Read the body-pose manifest.

    The manifest names the Hugging Face dataset and revision to fetch from,
    and records each file's size and SHA256 so a download can be verified
    against what was published.

    Returns:
        The parsed manifest.
    """
    return json.loads(MANIFEST_PATH.read_text())


HF_DATASET = "SkillCorner/opendata-bodypose"

POSE_FPS = 25
TRACKING_FPS = 10

#: The 29 joints present in every pose record.
JOINTS: tuple[str, ...] = (
    "nose", "neck", "lEye", "rEye", "lEar", "rEar",
    "lShoulder", "rShoulder", "lElbow", "rElbow", "lWrist", "rWrist",
    "lThumb", "rThumb", "lPinky", "rPinky",
    "midHip", "lHip", "rHip", "lKnee", "rKnee", "lAnkle", "rAnkle",
    "lHeel", "rHeel", "lBigToe", "rBigToe", "lSmallToe", "rSmallToe",
)

#: Pairs of joints to draw as bones when plotting a skeleton.
SKELETON: tuple[tuple[str, str], ...] = (
    ("nose", "neck"), ("nose", "lEye"), ("nose", "rEye"),
    ("lEye", "lEar"), ("rEye", "rEar"),
    ("neck", "lShoulder"), ("neck", "rShoulder"), ("neck", "midHip"),
    ("lShoulder", "lElbow"), ("lElbow", "lWrist"),
    ("rShoulder", "rElbow"), ("rElbow", "rWrist"),
    ("lWrist", "lThumb"), ("lWrist", "lPinky"),
    ("rWrist", "rThumb"), ("rWrist", "rPinky"),
    ("midHip", "lHip"), ("midHip", "rHip"),
    ("lHip", "lKnee"), ("lKnee", "lAnkle"),
    ("rHip", "rKnee"), ("rKnee", "rAnkle"),
    ("lAnkle", "lHeel"), ("lAnkle", "lBigToe"), ("lBigToe", "lSmallToe"),
    ("rAnkle", "rHeel"), ("rAnkle", "rBigToe"), ("rBigToe", "rSmallToe"),
)


def tracking_to_pose_frame(tracking_frame: int) -> float:
    """Convert a 10 fps tracking frame number to its 25 fps pose equivalent.

    Args:
        tracking_frame: Frame number on the tracking clock.

    Returns:
        The corresponding pose frame. Whole numbers only occur for even
        tracking frames; odd ones fall between two pose frames.
    """
    return tracking_frame * (POSE_FPS / TRACKING_FPS)


def pose_to_tracking_frame(pose_frame: int) -> float:
    """Convert a 25 fps pose frame number to its 10 fps tracking equivalent.

    Args:
        pose_frame: Frame number on the pose clock.

    Returns:
        The corresponding tracking frame, whole only when `pose_frame` is a
        multiple of 5.
    """
    return pose_frame * (TRACKING_FPS / POSE_FPS)


def iter_sample() -> Iterator[dict[str, Any]]:
    """Iterate the pose frames of the committed sample phase.

    The sample is one ``quick_break`` phase (index 406, period 2) from match
    1925299, covering tracking frames 49795-49918.

    Yields:
        One decoded pose record per frame.

    Raises:
        FileNotFoundError: If the sample file is missing from the repository.
    """
    if not SAMPLE_PATH.exists():
        raise FileNotFoundError(
            f"Sample not found at {SAMPLE_PATH}. Expected it to be committed "
            "in this repository under data/bodypose/."
        )
    with gzip.open(SAMPLE_PATH, "rt", encoding="utf-8") as fh:
        for line in fh:
            yield json.loads(line)


def download_match(match_id: int, dest_dir: Path | str = ".",
                   token: str | None = None) -> Path:
    """Download one match's full pose archive from the Hugging Face Hub.

    The archives are roughly 600 MB each, so this is deliberately explicit
    rather than something the other helpers do implicitly. The download is
    resumable in the sense that an already-complete file is left alone.

    Args:
        match_id: Match identifier, e.g. 1925299.
        dest_dir: Directory to write the archive into.
        token: Hugging Face token. Not needed for this dataset, which is
            public; falls back to the ``HF_TOKEN`` environment variable for
            private mirrors.

    Returns:
        Path to the downloaded ``.zip``.

    Raises:
        KeyError: If `match_id` is not in the manifest.
    """
    meta = manifest()
    if str(match_id) not in meta["matches"]:
        raise KeyError(
            f"{match_id} has no body pose. Available: {list(meta['matches'])}"
        )

    dest = Path(dest_dir).expanduser() / f"{match_id}.jsonl.zip"
    expected = meta["files"][f"raw/{match_id}.jsonl.zip"]["size_bytes"]
    if dest.exists() and dest.stat().st_size == expected:
        return dest

    url = f"{meta['base_url']}/raw/{match_id}.jsonl.zip"
    token = token or os.environ.get("HF_TOKEN")
    request = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}"} if token else {}
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".zip.part")
    with urllib.request.urlopen(request) as resp, tmp.open("wb") as out:
        while chunk := resp.read(1 << 20):
            out.write(chunk)
    tmp.replace(dest)
    return dest


def verify_download(path: Path | str) -> bool:
    """Check a downloaded archive against the SHA256 recorded in the manifest.

    Args:
        path: Path to a downloaded ``{match_id}.jsonl.zip``.

    Returns:
        True when the file's digest matches the manifest.
    """
    path = Path(path).expanduser()
    entry = manifest()["files"][f"raw/{path.name}"]
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest() == entry["sha256"]


def iter_match(archive: Path | str) -> Iterator[dict[str, Any]]:
    """Iterate pose frames from a downloaded match archive without extracting it.

    Args:
        archive: Path to a ``{match_id}.jsonl.zip`` from :func:`download_match`.

    Yields:
        One decoded pose record per frame.
    """
    import zipfile

    archive = Path(archive).expanduser()
    member = archive.name.replace(".zip", "")
    with zipfile.ZipFile(archive) as zf, zf.open(member) as fh:
        for line in fh:
            yield json.loads(line)


def joints_to_frame(records: Iterator[dict[str, Any]]) -> pd.DataFrame:
    """Flatten pose records into a long-format joint table.

    Args:
        records: Pose records, e.g. from :func:`iter_sample`.

    Returns:
        One row per joint per player per frame, with columns ``frame``,
        ``period``, ``player_id``, ``joint``, ``x``, ``y``, ``z`` and
        ``p90_mae_cm``. Players without resolved pose are skipped.
    """
    rows: list[dict[str, Any]] = []
    for rec in records:
        for player in rec.get("player_data") or []:
            joints = player.get("joints")
            if not joints:
                continue
            for name, joint in joints.items():
                x, y, z = joint["xyz"]
                rows.append({
                    "frame": rec["frame"],
                    "period": rec.get("period"),
                    "player_id": player["player_id"],
                    "joint": name,
                    "x": x, "y": y, "z": z,
                    "p90_mae_cm": joint.get("p90_mae_cm"),
                })
    return pd.DataFrame(rows)


def skeleton_segments(
    joints: pd.DataFrame, max_mae_cm: float | None = None
) -> list[tuple[tuple[float, float, float], tuple[float, float, float]]]:
    """Build drawable bone segments for one player in one frame.

    Args:
        joints: Rows for a single player and frame, as returned by
            :func:`joints_to_frame`.
        max_mae_cm: Drop joints whose error estimate exceeds this, so unreliable
            landmarks are not drawn. ``None`` keeps every joint.

    Returns:
        Pairs of ``(x, y, z)`` endpoints, one per bone whose both ends survive
        filtering.
    """
    if max_mae_cm is not None:
        joints = joints[joints["p90_mae_cm"] <= max_mae_cm]
    pos = {r.joint: (r.x, r.y, r.z) for r in joints.itertuples()}
    return [(pos[a], pos[b]) for a, b in SKELETON if a in pos and b in pos]
