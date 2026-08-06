import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
from matplotlib.patches import Rectangle
from humanize import ordinal
import matplotlib.patheffects as pe

BUBBLE_MAX = 550

# Function to split a string sentence in the middle.
def split_string_with_new_line(string):
    """
    Split a long string into two lines in the middle.

    Parameters:
    - string (str): The input string to split.

    Returns:
    - new_string (str): The modified string with a line break in the middle.
    """
    whitespaces = [i for i, ltr in enumerate(string) if ltr == ' ']
    if len(whitespaces) > 0:
        string_middle = len(string) / 2
        middle_white_space = min(whitespaces, key=lambda x: abs(x - string_middle))
        new_string = ''.join((string[:middle_white_space], '\n', string[middle_white_space + 1:]))
        return new_string
    else:
        return string


def ranking_plot(df, questions, highlight_group,
                 data_point_label='player_name', data_point_id='player_name',
                 split_metric_char=25, user_circles=False, metric_labels=None,
                 rotate_col_titles=False, split_col_titles=False,
                 plot_title=None,
                 dark_mode=False,
                 figsize=(10,5),
                 invert_metric_ranks=None):
    # Define custom discrete colormap
    if invert_metric_ranks is None:
        invert_metric_ranks = []

    if dark_mode:
        colors = ['#FF1A1A', '#FDA4A4', '#D9D9D6', '#99E59A', '#00C800']
    else:
        colors = ['#FF1A1A', '#FDA4A4', '#D9D9D6', '#99E59A', '#00C800']
    cmap = ListedColormap(colors)
    # Define percentile bins
    bins = [-0.1, .2, .4, .6, .8, 1.1]

    metrics = []
    for k in questions.keys():
        metrics += questions[k]

    for m in metrics:
        df[m + '_pct_rank'] = df[m].rank(pct=True)

        if m in invert_metric_ranks:
            df[m + '_pct_rank'] = 1 - df[m + '_pct_rank']

        df[m + '_marker_size'] = df[m + '_pct_rank'] * BUBBLE_MAX
        # Bin the percentile ranks
        df[m + '_colour'] = pd.cut(df[m + '_pct_rank'], bins=bins, labels=False, right=True)

    plot_df = df[df[data_point_id].isin(highlight_group)].reset_index()

    if len(plot_df) > 7:
        PLAYER_SPACING = 9 / len(plot_df)
    else:
        PLAYER_SPACING = 9 / 7
    player_xpos = [i * PLAYER_SPACING for i in range(len(plot_df))]

    facecolor = 'black' if dark_mode else 'white'
    textcolor = 'white' if dark_mode else 'black'

    figsize = figsize
    RUN_LABEL_ADJUST = -2.5

    fig, ax = plt.subplots(figsize=figsize)
    fig.patch.set_facecolor(facecolor)
    ax.set_facecolor(facecolor)

    n_rows = [len(questions[key]) for key in questions.keys()]
    n_rows = len(questions.keys()) + sum(n_rows)

    i = n_rows - 1
    for key in questions.keys():
        ax.text(x=RUN_LABEL_ADJUST, y=i, s=key, fontweight='bold',
                fontsize=9, color=textcolor,
                ha='left', va='center', zorder=5,
                path_effects=[pe.withStroke(linewidth=1,
                                            foreground=facecolor,
                                            alpha=1)])
        i -= 1
        for metric in questions[key]:
            if metric_labels is not None:
                metric_label = metric_labels[metric]
            else:
                metric_label = metric.replace('count_', '')
                metric_label = metric_label.replace('_', ' ')
                metric_label = metric_label.title()
                metric_label = metric_label.replace('Per 30 Tip', 'P30 TIP')

            if len(metric_label) > split_metric_char:
                metric_label = split_string_with_new_line(metric_label)

            ax.text(x=RUN_LABEL_ADJUST, y=i, s=metric_label,
                    fontsize=8, color=textcolor,
                    ha='left', va='center', zorder=5,
                    path_effects=[pe.withStroke(linewidth=1,
                                                foreground=facecolor,
                                                alpha=1)])

            if user_circles:
                ax.axhline(y=i, alpha=0.2,
                           lw=.5, linestyle='--', zorder=2,
                           color=textcolor)

            else:
                ax.axhline(y=i - 0.35, alpha=0.2,
                           lw=.5, linestyle='--', zorder=4,
                           color=textcolor)

                ax.axhline(y=i + 0.35, alpha=0.2,
                           lw=.5, linestyle='--', zorder=4,
                           color=textcolor)

            if user_circles:
                ax.scatter(player_xpos, [i] * len(player_xpos), s=BUBBLE_MAX,
                           color=facecolor, zorder=3)

                ax.scatter(player_xpos, [i] * len(player_xpos), s=BUBBLE_MAX,
                           color=facecolor, alpha=.2,
                           lw=.5, linestyle='--', zorder=4,
                           edgecolor=textcolor)

                scatter = ax.scatter(player_xpos, [i] * len(player_xpos),
                                     s=plot_df[metric + '_marker_size'],
                                     c=plot_df[metric + '_colour'], cmap=cmap,
                                     alpha=1, zorder=5)
            else:
                for j in range(len(plot_df)):
                    ax.add_patch(
                        Rectangle((player_xpos[j] - (PLAYER_SPACING / 2), i - 0.35),
                                  width=PLAYER_SPACING * plot_df[metric + '_pct_rank'].iloc[j],
                                  facecolor=cmap.colors[plot_df[metric + '_colour'].iloc[j]],
                                  height=.7, zorder=3))

                    ax.text(x=player_xpos[j], y=i,
                            s=ordinal(round(plot_df[metric + '_pct_rank'].iloc[j] * 100)),
                            rotation=0, fontweight='bold', fontsize=7, zorder=6,
                            color=textcolor, ha='center', va='center',
                            path_effects=[pe.withStroke(linewidth=1,
                                                        foreground=facecolor,
                                                        alpha=1)])
            i -= 1

    text_objects = []
    for xpos, player_name in zip(player_xpos, plot_df[data_point_label]):
        if split_col_titles:
            title = split_string_with_new_line(player_name)
        else:
            title = player_name
        if rotate_col_titles:
            rotation = 45
        else:
            rotation = 0
        text_objects.append(ax.text(x=xpos, y=n_rows, s=title,
                                    rotation=rotation, fontweight='bold', fontsize=9,
                                    color=textcolor, ha='center', va='center',
                                    path_effects=[pe.withStroke(linewidth=1,
                                                                foreground=facecolor,
                                                                alpha=1)]))

        if user_circles:
            ax.axvline(x=xpos, alpha=0.2,
                       lw=.5, linestyle='--', zorder=2,
                       color=textcolor)
        else:
            ax.axvline(x=xpos - (PLAYER_SPACING / 2), alpha=0.2,
                       lw=.5, linestyle='--', zorder=4,
                       color=textcolor)

    # Check for overlapping column name labels.
    overlapping_col_name = False
    for i in range(len(text_objects)):
        if i != len(text_objects) - 1:
            # Get the end position of the text bounding box.
            bbox = text_objects[i].get_window_extent()
            x_end, _ = ax.transData.inverted().transform((bbox.x1, bbox.y1))
            # Get the start position of the next text bounding box.
            next_bbox = text_objects[i + 1].get_window_extent()
            x_start, _ = ax.transData.inverted().transform((next_bbox.x0, next_bbox.y0))

            if x_end >= x_start:
                overlapping_col_name = True

    # Loop over text objects and set rotation if overlap found.
    if overlapping_col_name:
        for text_object in text_objects:
            text_object.set_rotation(30)
            text_object.set_ha('left')

    if not user_circles:
        ax.axvline(x=player_xpos[-1] + (PLAYER_SPACING / 2), alpha=0.2,
                   lw=.5, linestyle='--', zorder=2,
                   color=textcolor)

    ax.set_ylim([-1, n_rows])

    ax.spines['bottom'].set_color('none')
    ax.spines['top'].set_color('none')
    ax.spines['left'].set_color('none')
    ax.spines['right'].set_color('none')
    ax.set_xticks([])
    ax.set_yticks([])

    # Add color bar
    if user_circles:
        cbar = plt.colorbar(scatter,
                            fraction=0.025,
                            aspect=10,
                            pad=0.01,
                            ticks=[0, .8, 1.6, 2.4, 3.2, 4])

        # Set color bar tick labels
        cbar.set_ticklabels(['0%', '20%', '40%',
                             '60%', '80%', '100%'],
                            fontsize=7)

        cbar.set_label('Percentile Rank',
                       fontsize=8, fontweight='bold')

    if len(plot_df) <= 6:
        for i in range(len(player_xpos), len(player_xpos)+(7-len(player_xpos))):
            ax.axvline(x=(i * PLAYER_SPACING) + (PLAYER_SPACING / 2), alpha=0.2,
                       lw=.5, linestyle='--', zorder=2,
                       color=textcolor)

    if plot_title is not None:
        ax.set_title(plot_title)

    plt.tight_layout()
    plt.show()

    return fig, ax
