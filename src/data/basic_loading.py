import os
import pandas as pd

match_id = 1886347

# Resolve data directory absolute path relative to this script
base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
data_dir = os.path.join(base_dir, "data")

# Dynamic Events
de_match = pd.read_csv(os.path.join(data_dir, "matches", str(match_id), f"{match_id}_dynamic_events.csv"))

# Phases of Play
pop_match = pd.read_csv(os.path.join(data_dir, "matches", str(match_id), f"{match_id}_phases_of_play.csv"))

# Tracking Data
tracking_data = pd.read_json(
    os.path.join(data_dir, "matches", str(match_id), f"{match_id}_tracking_extrapolated.jsonl"), lines=True
)

