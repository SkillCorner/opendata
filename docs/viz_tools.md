# 🛠️ Interactive Visualization Tools

SkillCorner Open Data includes standalone, browser-based HTML applications that allow you to interactively explore tracking data and dynamic events in any browser—without installing Python or running a local server.

---

## 💻 Available Tools

You can find these tools in the repository under the `viz_tools/` directory:

| Tool Name | File Path | Supported Datasets | Key Features |
|---|---|---|---|
| **SkillCorner Tracking Viewer** | `viz_tools/SkillCorner_Tracking_Viewer.html` | `*_tracking_extrapolated.jsonl`<br>`*_match.json` | 2D Pitch Animation, Convex Hulls, Player Trails, Playback Controls (0.25x-4x), Live Roster Inspector |
| **Dynamic Events Explorer** | `viz_tools/Dynamic_Events_Explorer.html` | `*_dynamic_events.csv`<br>`*_phases_of_play.csv` | Spatial Run & Event Vectors, Phases of Play Timeline, Multi-Criteria Filters, Searchable Data Grid |

---

## 🚀 Getting Started

1. **Clone the Repository** or download the `viz_tools/` folder.
2. **Double-click** either HTML tool (`SkillCorner_Tracking_Viewer.html` or `Dynamic_Events_Explorer.html`) to open it in Chrome, Firefox, Safari, or Edge.
3. **Drag and Drop** open match dataset files from `data/matches/1886347/` directly into the browser window.
