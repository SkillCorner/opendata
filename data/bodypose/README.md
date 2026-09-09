# Body Pose

Body Pose follows a structure that is similar to XY Tracking data. It is enriching the 2D tracking file with 29 key points, or "joints", per player, positioned on the pitch with 3D coordinates. The file is at 25 FPS, with the standard 2D XY positions interpolated to fit in the same frame rate. Each key point estimation is associated to a predicted error, in centimeters. This error is defined so that 90% of estimated key points are sitting within this error radius of the joint position, relative to the player's pose.

## Limitations

* Body Pose is only provided for detected players.
* Position on the z-axis is accurate relatively to the player's centroid, but not necessarily in the pitch coordinate system. This will come with future Body Pose enhancements.
* XY Tracking data and Body Pose are generated separately. This can cause minor misalignments between the XY attributes (positions, `is_detected` flag) and the Body Pose joints.

## Where the data lives

The full files are around 3.3 GB of JSON per match, which is too large to ship in this repository. They are hosted on the Hugging Face Hub:

**[huggingface.co/datasets/SkillCorner/opendata-bodypose](https://huggingface.co/datasets/SkillCorner/opendata-bodypose)**

Two matches are available, both of which also have tracking, dynamic events and phases of play in this repository:

| Match | Fixture | Date |
|---|---|---|
| 1925299 | Brisbane Roar v Perth Glory | 2024-12-21 |
| 1996435 | Sydney FC v Adelaide United | 2025-02-01 |

## Sample in this repository

`sample_1925299_phase406.jsonl.gz` contains a single phase of play — a 12.3 second Brisbane Roar quick break from the second half — so the tutorials run without downloading a full match.

| | |
|---|---|
| Pose frames | 309 |
| Tracking frames covered | 49795–49918 |
| Joint observations | 143,637 |
| Size | 1.8 MB gzipped |

It is here for testing, not as a miniature match. Code that only ever runs against this sample
will break on a full match, which has:

* **two periods**, not one — the sample sits entirely inside the second half
* **players entering and leaving**, as substitutions happen and detections come and go
* **long stretches with no pose at all** — across a full match only about a third of
  player-frames carry joints

Run against a full match before relying on anything.

## The 29 joints

`nose`, `neck`, `lEye`, `rEye`, `lEar`, `rEar`, `lShoulder`, `rShoulder`, `lElbow`, `rElbow`, `lWrist`, `rWrist`, `lThumb`, `rThumb`, `lPinky`, `rPinky`, `midHip`, `lHip`, `rHip`, `lKnee`, `rKnee`, `lAnkle`, `rAnkle`, `lHeel`, `rHeel`, `lBigToe`, `rBigToe`, `lSmallToe`, `rSmallToe`

## Record structure

```json
{
  "frame": 124487,
  "timestamp": "00:49:47.48",
  "period": 2,
  "ball_data": {"x": 0.35, "y": -22.22, "z": 7.074, "is_detected": true},
  "possession": {"player_id": null, "group": "away team"},
  "image_corners_projection": {"x_top_left": -44.26, "...": "..."},
  "player_data": [
    {
      "player_id": 809166,
      "x": -17.36,
      "y": -22.06,
      "is_detected": true,
      "joints": {
        "lAnkle": {"xyz": [-25.042, 0.86, 0.204], "p90_mae_cm": 12.39},
        "...": "..."
      }
    }
  ]
}
```

A player's `joints` field is `null` when pose was not resolved for them in that frame, even though their `x`/`y` may still be present.

## Frame rate

Body Pose is at **25 FPS**. The tracking, dynamic events and phases of play files in this repository are at **10 FPS**, so frame numbers are not interchangeable:

```
pose_frame = 2.5 * tracking_frame
```

Every 5th pose frame lands exactly on an even-numbered tracking frame. Those are the frames where the two align without interpolation.

## `MANIFEST.json`

You do not need to open or edit this file — the helpers in `src/data/pose_loading.py` read it for
you. It records where the full files live and what each one should look like when it arrives:

* `hf_dataset`, `hf_revision`, `base_url` — which Hugging Face dataset to download from, and which
  version of it. `main` means "whatever is currently published".
* `files` — each archive's size in bytes and its `sha256`, a fingerprint of the file's contents.
  `verify_download` recalculates that fingerprint to confirm the download arrived complete and
  uncorrupted.
* `matches`, `sample` — the fixtures covered, and what the committed sample contains.

## Loading

See `src/data/pose_loading.py` for helpers, and the tutorial in `notebooks/tutorials/05_Body_Pose/`.

### The sample committed here

No download, no dependencies beyond pandas:

```python
from src.data.pose_loading import iter_sample, joints_to_frame

joints = joints_to_frame(iter_sample())     # 143,637 rows, one per joint per player per frame
```

### A full match from Hugging Face

`download_match` fetches the archive to a directory of your choosing and skips the download if the
file is already there at the right size. `verify_download` is the stricter check — it reads the
whole file and compares its fingerprint to `MANIFEST.json`, so run it once after downloading.
`iter_match` then streams frames straight out of the zip, without extracting 3.3 GB to disk.

```python
from src.data.pose_loading import download_match, iter_match, verify_download

archive = download_match(1925299, dest_dir="pose_data")   # ~600 MB, once

if not verify_download(archive):
    print("checksum mismatch — delete the file and run download_match again")

for frame in iter_match(archive):   # streams, constant memory
    for player in frame["player_data"]:
        if player["joints"]:
            shoulders = player["joints"]["lShoulder"]["xyz"]
```

Process frame by frame rather than building a list — a whole match is roughly 45 million joint
observations and will not fit comfortably in memory as Python objects.

### Straight from the Hub, without this repo

The files are plain HTTP, so nothing here is required:

```python
import io, json, zipfile, urllib.request

URL = ("https://huggingface.co/datasets/SkillCorner/opendata-bodypose"
       "/resolve/main/raw/1925299.jsonl.zip")

with urllib.request.urlopen(URL) as response:
    blob = io.BytesIO(response.read())

with zipfile.ZipFile(blob) as zf, zf.open("1925299.jsonl") as fh:
    for line in fh:
        frame = json.loads(line)
```

Or with `huggingface_hub` if you prefer caching and resume:

```python
from huggingface_hub import hf_hub_download

path = hf_hub_download(
    repo_id="SkillCorner/opendata-bodypose",
    filename="raw/1925299.jsonl.zip",
    repo_type="dataset",
)
```
