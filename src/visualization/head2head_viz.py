import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
from matplotlib.patches import Rectangle

def plot_head2head(
    df: pd.DataFrame,
    category_column: str = "category",
    metrics = None,
    metric_labels = None,
    x_label = None,
    percentage_metrics = None,   # optional (just affects % suffix)
    xaxis: str = "auto",                            # 'auto' or 'fixed'
    center_gap = None,                # None -> auto; else fixed px in data coords
    winner_color_left: str = "#00C800",             # green (left winner)
    winner_color_right: str = "#00C800",            # green (right winner)
    loser_color: str = "#D9D9D9",                   # light gray (loser)
    edgecolor: str = "#2B2B2B",
    title_left = None,
    title_right = None,
    unit = None
) -> tuple[plt.Figure, plt.Axes]:
    """
    Mirrored horizontal bars with a central label panel and winner coloring.
    Assumes metric values are in [0, 100].
    """

    # --- categories ---
    cats = df[category_column].unique()
    if len(cats) != 2:
        raise ValueError("DataFrame must contain exactly two categories to compare.")
    cat_left, cat_right = cats
    title_left = title_left or f"{cat_left}"
    title_right = title_right or f"{cat_right}"

    # --- metrics ---
    if metrics is None:
        metrics = df.select_dtypes(include="number").columns.tolist()
        if category_column in metrics:
            metrics.remove(category_column)
    if metric_labels is None:
        metric_labels = {m: m.replace("_", " ").title() for m in metrics}
    pct_set = set(percentage_metrics or [])

    # --- assemble plotting dataframe (preserve input order) ---
    rows = []
    for m in metrics:  # <- iterate in the order given by the caller
        lval = float(df.loc[df[category_column] == cat_left, m].values[0])
        rval = float(df.loc[df[category_column] == cat_right, m].values[0])
        rows.append({"metric": m, "label": metric_labels.get(m, m), "L": lval, "R": rval})
    d = pd.DataFrame(rows)
    d["L"] = d["L"].fillna(0.0)
    d["R"] = d["R"].fillna(0.0)

    # --- figure ---
    fig, ax = plt.subplots(figsize=(14, max(5, len(metrics) * 0.65)), constrained_layout=True)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")
    y = np.arange(len(d))

    # --- scaling / gap ---
    vmax = float(max(d["L"].max(), d["R"].max()))
    if center_gap is None:
        gap = max(8.0, 0.35 * (vmax if xaxis == "auto" else 100.0))
    else:
        gap = float(center_gap)

    # choose nice tick max (nearest 10 up, at least 40 to match the style)
    tick_max = 100.0 if xaxis == "fixed" else max(40.0, 10.0 * np.ceil(vmax / 10.0))
    pad = 8.0
    xmax = gap + tick_max + pad
    ax.set_xlim(-xmax, xmax)

    # --- grid (vertical) ---
    left_ticks = [-gap - t for t in [tick_max, 30, 20, 10] if t <= tick_max]
    right_ticks = [ gap + t for t in [10, 20, 30, tick_max] if t <= tick_max]
    grid_ticks = sorted(left_ticks + right_ticks)
    for xt in grid_ticks:
        ax.axvline(xt, color="#EAEAEA", linewidth=1.0, zorder=0)

    # --- central label panel ---
    panel_w = gap * 1.15  # slightly wider than the actual gap
    panel_left = -panel_w / 2
    panel = Rectangle((panel_left, -0.75), panel_w, len(d) - 0.5 + 1.5,
                      facecolor="white", edgecolor="none", zorder=1)
    ax.add_patch(panel)
    # black vertical panel edges (like in the reference)
    ax.axvline(-gap, color="black", linewidth=2.0, zorder=2)
    ax.axvline( gap, color="black", linewidth=2.0, zorder=2)

    # --- bars with winner logic ---
    bar_h = 0.6
    for i, r in d.iterrows():
        lval, rval = r["L"], r["R"]
        if lval > rval:
            lcol, rcol = winner_color_left, loser_color
        elif rval > lval:
            lcol, rcol = loser_color, winner_color_right
        else:
            lcol = rcol = loser_color  # tie → neutral both

        ax.barh(i, -lval, left=-gap, height=bar_h, color=lcol, edgecolor=edgecolor, zorder=3)
        ax.barh(i,  rval, left= gap, height=bar_h, color=rcol, edgecolor=edgecolor, zorder=3)

    # --- metric labels inside center panel ---
    for i, r in d.iterrows():
        ax.text(0, i, r["label"], ha="center", va="center",
                fontsize=12, fontweight="bold", color="#1F2937", zorder=4)

    # --- value labels at bar ends ---
    label_pad = 0.012 * (2 * xmax)
    for i, r in d.iterrows():
        suf = "" if unit is None else unit
        ax.text(-gap - r["L"] - label_pad, i, f"{r['L']:.1f}{suf}",
                ha="right", va="center", fontsize=11, fontweight="bold", color="#111827",
                path_effects=[pe.withStroke(linewidth=2.0, foreground="white")], zorder=5)
        ax.text( gap + r["R"] + label_pad, i, f"{r['R']:.1f}{suf}",
                ha="left", va="center", fontsize=11, fontweight="bold", color="#111827",
                path_effects=[pe.withStroke(linewidth=2.0, foreground="white")], zorder=5)

    ax.invert_yaxis()

    # --- titles above each side ---
    top_y = -0.8
    ax.text(-gap - tick_max * 0.5, top_y, f"{title_left}",
            ha="center", va="bottom", fontsize=18, fontweight="bold", color="#0B3D2E")
    ax.text( gap + tick_max * 0.5, top_y, f"{title_right}",
            ha="center", va="bottom", fontsize=18, fontweight="bold", color="#0B3D2E")

    # --- bottom x-axis labels (percentages near edges) ---
    ax.set_yticks([])
    ax.set_xticks(left_ticks + [0] + right_ticks)

    xticklabels = []
    for x in left_ticks:
        xticklabels.append(f"{int(abs(x + gap))}{suf}")  # convert position back to % from gap
    xticklabels.append("")  # center
    for x in right_ticks:
        xticklabels.append(f"{int(x - gap)}{suf}")
    ax.set_xticklabels(xticklabels, fontsize=11, color="#111827")

    # bottom main axis title
    ax.set_xlabel(x_label, fontsize=16, fontweight="bold", color="#111827", labelpad=12)

    # cosmetics
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.tick_params(axis="x", length=6, color="#111827")

    return fig, ax

