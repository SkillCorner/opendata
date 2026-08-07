# 🛠️ SkillCorner Open Data Visualization Tools

Interactive, browser-based visualizer applications for exploring SkillCorner Open Data without requiring Python or server setup. Simply double-click any `.html` file to open it in your web browser and drag-and-drop your dataset files.

---

## 🚀 Available Tools

### 1. 📍 [SkillCorner Tracking Viewer](SkillCorner_Tracking_Viewer.html)
- **File:** `SkillCorner_Tracking_Viewer.html`
- **Supported Datasets:** 
  - `*_tracking_extrapolated.jsonl` (Tracking Data)
  - `*_match.json` (Match Metadata)
- **Key Features:**
  - 🎬 **Full Animation Playback:** Play, pause, frame scrubber, playback speed multiplier (0.25x – 4x).
  - ⚽ **2D Pitch Rendering:** Player positions, jersey numbers, names, ball position.
  - 📊 **Tactical Overlays:** Voronoi diagram and pitch control
  - 🔍 **Interactive Roster & Inspector:** Highlight any player

---

### 2. ⚡ [Dynamic Events Explorer](Dynamic_Events_Explorer.html)
- **File:** `Dynamic_Events_Explorer.html`
- **Supported Datasets:**
  - `*_dynamic_events.csv` (Dynamic Events)
  - `*_phases_of_play.csv` (Phases of Play)
- **Key Features:**
  - 🗺️ **Spatial Event Pitch Map:** Visualize off-ball run vectors, passes, on ball engagements events, and average positions (start → end), grouped by position group. Compare two players in the head to head section
  - 🔎 **Multi-Criteria Filtering:** Filter events by category, phase type (`build_up`, `high_block`, etc.), team, period, and speed band.
  - 📋 **Summary Table** View summary stats for each player across all events

---

## 📖 How to Use

1. **Open the Tool:** Download or double-click `SkillCorner_Tracking_Viewer.html` or `Dynamic_Events_Explorer.html` to launch in your browser.
2. **Load Open Data:** Drag and drop sample files from `data/matches/1886347/` directly into the browser upload box.
3. **Explore & Analyze:** Use the control panels, filters, and animation scrubber to analyze tracking and tactical event data.
