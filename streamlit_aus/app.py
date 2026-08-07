# app.py
import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
from sklearn.metrics.pairwise import cosine_similarity

# Assumes df has columns: ['player_name', 'team_name', 'position', 'position_group', feature1,...,featureN]
df = pd.read_csv("../data/aggregates/aus1league_physicalaggregates_20242025_midfielders.csv")

# --- Clean text columns (remove extra spaces) ---
text_cols = ['player_name', 'position_group', 'team_name']
for col in text_cols:
    df[col] = df[col].astype(str).str.replace(r'\s+', ' ', regex=True).str.strip()

df['unique_id'] = df['player_name'] + " (" + df['position_group'] + ")"

# --- Compute similarity matrix once ---
def compute_similarity(df):
    for col in df.columns.tolist():
        if col.endswith("full_all"):
            df.drop(columns = [col], inplace = True)

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
    clean_features = df[feature_cols].dropna(axis=1)

    df = df.copy()
    df['unique_id'] = df['player_name'] + " (" + df['position_group'] + ")"

    sim_matrix = cosine_similarity(clean_features)
    sim_df = pd.DataFrame(sim_matrix, index=df['unique_id'], columns=df['unique_id'])

    return sim_df, df, clean_features.columns

similarity_df, df, feature_cols = compute_similarity(df)

# --- Function to get top similar players ---
def get_similar_players(df, similarity_df, player_name, position_group, top_n=5, filter_col=None):
    player_key = f"{player_name} ({position_group})"
    if player_key not in similarity_df.index:
        return pd.DataFrame()  # empty

    sims = similarity_df.loc[player_key].drop(player_key, errors="ignore")

    if filter_col is not None:
        target_value = df.loc[df['unique_id'] == player_key, filter_col].values[0]
        filtered_ids = df.loc[df[filter_col] == target_value, 'unique_id']
        sims = sims.loc[sims.index.intersection(filtered_ids)]

    top_similar = sims.sort_values(ascending=False).head(top_n)

    player_info = df[['unique_id', 'player_name', 'team_name', 'position_group']].set_index('unique_id')
    result = player_info.loc[top_similar.index].assign(similarity=top_similar.values)
    return result.reset_index(drop=False)

def feature_contributions(df, player1, position_group1, player2, position_group2, feature_cols):
    # Extraire les vecteurs
    player_key_1 = f"{player1} ({position_group1})"
    player_key_2 = f"{player2} ({position_group2})"
    v1 = df.loc[df['unique_id'] == player_key_1, feature_cols].values.flatten()
    v2 = df.loc[df['unique_id'] == player_key_2, feature_cols].values.flatten()

    # Calculer la contribution brute
    contributions = v1 * v2

    # Normalisation (comme dans la cosine similarity)
    norm_factor = np.linalg.norm(v1) * np.linalg.norm(v2)
    contributions_normalized = contributions / norm_factor

    # Mettre dans un DataFrame
    contrib_df = pd.DataFrame({
        'feature': feature_cols,
        'contribution': contributions_normalized
    }).sort_values(by='contribution', ascending=False)

    return contrib_df

# --- Streamlit App ---
st.title("Player Similarity Explorer")

# Step 1: select player
player_name = st.selectbox("Select a player:", df['player_name'].unique())

# Step 2: show available positions for that player
positions_available = df[df['player_name'] == player_name]['position_group'].unique()
position_group = st.selectbox("Select the position/group for this player:", positions_available)

# Step 3: optional filter
filter_option = st.selectbox("Optional filter:", [None, "position_group", "team_name"])

# Step 4: number of top similar players to show
top_n = st.slider("Number of similar players to show:", min_value=1, max_value=20, value=5)

# Step 5: compute similarity
if st.button("Find similar players"):
    similar_players = get_similar_players(df, similarity_df, player_name, position_group, top_n, filter_col=filter_option)

    if similar_players.empty:
        st.write("No similar players found with these filters.")
    else:
        st.write(f"Top {top_n} players similar to {player_name} ({position_group}):")
        st.dataframe(similar_players)

        contribs = feature_contributions(df, player_name, position_group, similar_players.iloc[0]["player_name"], similar_players.iloc[0]["position_group"], feature_cols)

        top = contribs.head(10)

        # Créer un barplot horizontal
        fig = px.bar(
            top,
            x='contribution',
            y='feature',
            orientation='h',
            title=f"Top 10 features contributing to similarity between {player_name} and {similar_players.iloc[0]["player_name"]}",
            labels={'contribution': 'Normalized contribution', 'feature': 'Feature'},
            text='contribution'
        )

        fig.update_layout(yaxis={'categoryorder':'total ascending'})
        fig.update_traces(texttemplate='%{text:.3f}', textposition='outside')

        # Affichage dans Streamlit
        st.plotly_chart(fig, use_container_width=True)