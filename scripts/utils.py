import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity

def compute_similarity(df):
    df.dropna(axis=1, inplace = True)
    feature_cols = df.drop(columns = ["player_name", 'player_name',
 'player_short_name',
 'player_id',
 'team_name',
 'team_id',
 'competition_name',
 'competition_id',
 'season_name',
 'season_id',
 'position_group','unique_id']).columns.tolist()
    similarity_matrix = cosine_similarity(df[feature_cols])
    similarity_df = pd.DataFrame(
        similarity_matrix,
        index=df['unique_id'],
        columns=df['unique_id']
    )
    return similarity_df


def get_similar_players(df, similarity_df, player_name, position_group, top_n=5, filter_col=None):
    """
    df            : DataFrame with player info
    similarity_df : Precomputed similarity DataFrame
    player_name   : str - player to compare
    top_n         : int - number of similar players to return
    filter_col    : str or None - optional column to filter by (e.g., 'team_name', 'position_group')
    """
    player_key = f"{player_name} ({position_group})"

    if player_key not in similarity_df.index:
        raise ValueError(f"Player '{player_name}' with position_group '{position_group}' not found.")


    sims = similarity_df.loc[player_key]

    # Drop self
    sims = sims.drop(player_key)

    # Apply optional filter
    if filter_col is not None:
        target_value = df.loc[df['unique_id'] == player_key, filter_col].values[0]
        filtered_players = df.loc[df[filter_col] == target_value, 'unique_id']
        sims = sims.loc[sims.index.intersection(filtered_players)]

    # Sort descending and take top_n
    top_similar = sims.sort_values(ascending=False).head(top_n)

    # Build readable result table
    result = (
        df[['unique_id','player_name', 'team_name', 'position_group']]
        .set_index('unique_id')
        .loc[top_similar.index]
        .assign(similarity=top_similar.values)
    )

    return result.reset_index(drop = False)