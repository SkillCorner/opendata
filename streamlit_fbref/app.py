# app.py
import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
from sklearn.metrics.pairwise import cosine_similarity

# Assumes df has columns: ['player_name', 'team_name', 'position', 'position_group', feature1,...,featureN]
df = pd.read_csv("../data/all_leagues_merged_final_df.csv")

aggregation_dict = {
    # ⏱️ Temps de Jeu -> SOMME
    'Playing Time MP': 'sum',
    'Playing Time Starts': 'sum',
    'Playing Time Min': 'sum',
    'Playing Time 90s': 'sum',
    '90s': 'sum',

    # 🥅 Performance & Totaux Bruts -> SOMME
    'Performance Gls': 'sum',
    'Performance Ast': 'sum',
    'Performance G+A': 'sum',
    'Performance G-PK': 'sum',
    'Performance PK': 'sum',
    'Performance PKatt': 'sum',
    'Performance CrdY': 'sum',
    'Performance CrdR': 'sum',

    # 🎯 Expected (Qualité) -> SOMME
    'Expected xG': 'sum',
    'Expected npxG': 'sum',
    'Expected xAG': 'sum',
    'Expected npxG+xAG': 'sum',

    # ⚽ Tirs Standard -> SOMME
    'Standard Gls': 'sum',
    'Standard Sh': 'sum',
    'Standard SoT': 'sum',
    'Standard FK': 'sum',
    'Standard PK': 'sum',
    'Standard PKatt': 'sum',

    # ⚔️ Actions Défensives -> SOMME
    'Tackles Tkl': 'sum',
    'Tackles TklW': 'sum',
    'Tackles Def 3rd': 'sum',
    'Tackles Mid 3rd': 'sum',
    'Tackles Att 3rd': 'sum',
    'Challenges Tkl': 'sum',
    'Challenges Att': 'sum',
    'Challenges Lost': 'sum',
    'Blocks Blocks': 'sum',
    'Blocks Sh': 'sum',
    'Blocks Pass': 'sum',
    'Int': 'sum',
    'Tkl+Int': 'sum',
    'Clr': 'sum',
    'Err': 'sum',

    # ⚙️ Passes (Volume et Distance) -> SOMME
    'Total Cmp': 'sum',
    'Total Att': 'sum',
    'Total TotDist': 'sum',
    'Total PrgDist': 'sum',
    'Short Cmp': 'sum',
    'Short Att': 'sum',
    'Medium Cmp': 'sum',
    'Medium Att': 'sum',
    'Long Cmp': 'sum',
    'Long Att': 'sum',
    'Ast': 'sum',
    'xAG': 'sum',
    'Expected xA': 'sum',
    'Expected A-xAG': 'sum',
    'KP': 'sum',
    '1/3': 'sum',
    'PPA': 'sum',
    'CrsPA': 'sum',
    'PrgP': 'sum',

    # 🏋️ Duels Physiques -> SOMME
    'Aerial Duels Won': 'sum',
    'Aerial Duels Lost': 'sum',

    # 🏃 Possession & Carries (Volume et Distance) -> SOMME
    'Touches Touches': 'sum',
    'Touches Def Pen': 'sum',
    'Touches Def 3rd': 'sum',
    'Touches Mid 3rd': 'sum',
    'Touches Att 3rd': 'sum',
    'Touches Att Pen': 'sum',
    'Touches Live': 'sum',
    'Take-Ons Att': 'sum',
    'Take-Ons Succ': 'sum',
    'Take-Ons Tkld': 'sum',
    'Carries Carries': 'sum',
    'Carries TotDist': 'sum',
    'Carries PrgDist': 'sum',
    'Carries PrgC': 'sum',
    'Carries 1/3': 'sum',
    'Carries CPA': 'sum',
    'Carries Mis': 'sum',
    'Carries Dis': 'sum',
    'Receiving Rec': 'sum',
    'Receiving PrgR': 'sum',

    # 📊 Pourcentages et Taux /90 -> MOYENNE
    'Total Cmp%': 'mean',
    'Short Cmp%': 'mean',
    'Medium Cmp%': 'mean',
    'Standard Sh/90': 'mean',
    'Standard SoT/90': 'mean',
    'Per 90 Minutes Gls': 'mean',
    'Per 90 Minutes Ast': 'mean',
    'Per 90 Minutes G+A': 'mean',
    'Per 90 Minutes G-PK': 'mean',
    'Per 90 Minutes G+A-PK': 'mean',
    'Per 90 Minutes xG': 'mean',
    'Per 90 Minutes xAG': 'mean',
    'Per 90 Minutes xG+xAG': 'mean',
    'Per 90 Minutes npxG': 'mean',
    'Per 90 Minutes npxG+xAG': 'mean',
    'Progression PrgC': 'mean',
    'Progression PrgP':'mean',
    'Progression PrgR':'mean',
    'Valeur marchande (euros)': lambda x: x.iloc[-1],
    'league': lambda x: x.iloc[-1],
    'pos': lambda x: x.iloc[-1],
    'nation': lambda x: x.iloc[-1],
    'team': lambda x: x.iloc[-1],
    'age': lambda x: x.iloc[-1],
}

# --- Compute similarity matrix once ---
def compute_similarity(df, feature_cols):

    clean_features = df[feature_cols].dropna(axis=1)

    df = df.copy()

    sim_matrix = cosine_similarity(clean_features)
    sim_df = pd.DataFrame(sim_matrix, index=df['player'],
                          columns=df['player'])

    return sim_df, df, clean_features.columns


def feature_contributions(df, player1, player2, feature_cols):
    # Extraire les vecteurs
    v1 = df.loc[df['player'] == player1, feature_cols].values.flatten()
    v2 = df.loc[df['player'] == player2, feature_cols].values.flatten()

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

# --- Function to get top similar players ---
def get_similar_players(df, similarity_df, player_name, top_n=5, filter_cols = None):
    if player_name not in similarity_df.index:
        return pd.DataFrame()  # empty

    sims = similarity_df.loc[player_name].drop(player_name, errors="ignore")
    filtered_ids = set(df["player"])
    for filter_col in filter_cols:

        if filter_col is None or filter_col not in df.columns:
            continue

        else:
            if filter_col == "Valeur marchande (euros)":
                continue
            else:
                target_value = df.loc[df['player'] == player_name, filter_col].values[0]
                current_filtered = set(df.loc[df[filter_col] == target_value, 'player'])

        # Intersection progressive
        filtered_ids &= current_filtered

        sims = sims.loc[sims.index.intersection(filtered_ids)]

    top_similar = sims.sort_values(ascending=False).head(top_n)

    player_info = df[['player', 'pos', 'nation', 'Valeur marchande (euros)',
                      'team', 'age', 'Performance G+A', 'Expected xG', 'Playing Time MP']].set_index('player')
    result = player_info.loc[top_similar.index].assign(similarity=top_similar.values)
    return result.reset_index(drop=False), sims

# --- Streamlit App ---
st.title("Player Similarity Explorer")

# Step 1: select season (multiplie choice possible)
selected_seasons = st.multiselect("Select one or different season:", df['season'].unique(), default = df['season'].unique().tolist())

# S'assurer que l'utilisateur a sélectionné au moins une saison avant de filtrer
if selected_seasons:
    # Utilisation de .isin() pour filtrer le DataFrame
    df = df[df['season'].isin(selected_seasons)]
else:
    # Gérer le cas où aucune saison n'est sélectionnée (ex: afficher un message d'erreur ou le DataFrame vide)
    st.warning("Please select at least one season.")
    df = pd.DataFrame() # Créer un DataFrame vide


selected_stats = st.selectbox("Select specific stats you are interested in:", ["All stats", "Offensive stats", "Defensive stats", "Physical stats"])
if selected_stats == "All stats":

    feature_cols = df.drop(columns = ["league",
        'team',
        'player',
        'nation',
        'pos',
        'age',
        'born',
        'Valeur marchande (euros)',
        'season']).columns.tolist()
elif selected_stats == "Offensive stats":
    feature_cols = [
    # Performance & Tirs Réels
    'Performance Gls', 'Performance Ast', 'Performance G+A', 'Performance G-PK',
    'Performance PK', 'Performance PKatt',
    'Standard Gls', 'Standard Sh', 'Standard SoT', 'Standard Sh/90', 'Standard SoT/90',
    # Expected (Qualité)
    'Expected xG', 'Expected npxG', 'Expected xAG', 'Expected npxG+xAG',
    'Per 90 Minutes Gls', 'Per 90 Minutes Ast', 'Per 90 Minutes G+A', 'Per 90 Minutes G-PK',
    'Per 90 Minutes G+A-PK', 'Per 90 Minutes xG', 'Per 90 Minutes xAG',
    'Per 90 Minutes xG+xAG', 'Per 90 Minutes npxG', 'Per 90 Minutes npxG+xAG',
    # Passes Créatives & Progression Offensive
    'Ast', 'xAG', 'Expected xA', 'Expected A-xAG', 'KP', '1/3', 'PPA', 'CrsPA',
    'Touches Att 3rd', 'Touches Att Pen',
    'Carries 1/3', 'Carries CPA'
]
elif selected_stats == "Defensive stats":
    feature_cols = [
    # Tacles & Interventions
    'Tackles Tkl', 'Tackles TklW', 'Tackles Def 3rd', 'Tackles Mid 3rd',
    'Tackles Att 3rd', 'Challenges Tkl', 'Challenges Att', 'Challenges Lost',
    'Int', 'Tkl+Int', 'Clr',
    # Blocs & Erreurs
    'Blocks Blocks', 'Blocks Sh', 'Blocks Pass', 'Err',
    # Indiscipline
    'Performance CrdY', 'Performance CrdR',
    # Positionnement
    'Touches Def Pen', 'Touches Def 3rd'
]
else :
    feature_cols = [
    # Temps de Jeu (souvent exclu des scores, mais utile pour le filtrage)
    'Playing Time MP', 'Playing Time Starts', 'Playing Time Min', 'Playing Time 90s', '90s',
    # Duels Physiques
    'Aerial Duels Won', 'Aerial Duels Lost',
    # Progression & Réception
    'Progression PrgC', 'Progression PrgP', 'Progression PrgR',
    'PrgP', 'Receiving Rec', 'Receiving PrgR',
    # Touches, Carries & Dribbles
    'Touches Touches', 'Touches Mid 3rd', 'Touches Live',
    'Take-Ons Att', 'Take-Ons Succ', 'Take-Ons Tkld',
    'Carries Carries', 'Carries TotDist', 'Carries PrgDist', 'Carries PrgC',
    'Carries Mis', 'Carries Dis',
    # Distribution (Volume & Distance)
    'Total Cmp', 'Total Att', 'Total Cmp%', 'Total TotDist', 'Total PrgDist',
    'Short Cmp', 'Short Att', 'Short Cmp%', 'Medium Cmp', 'Medium Att', 'Medium Cmp%',
    'Long Cmp', 'Long Att', 'Standard FK', # FK est un événement de passe/tir
]

# Step 1: select player
player_name = st.selectbox("Select a player:", df['player'].unique())

# Step 3: optional filter
filter_options = st.multiselect("Optional filter:", [None, "pos", "team", "Valeur marchande (euros)"], default= None)

if "Valeur marchande (euros)" in filter_options:
    target_value = st.slider ("Valeur marchande cible : ",
                                min_value=0.0,
                                max_value=150.0,
                                value=10.0,
                                step=0.5
                            ) * 1_000_000
    tolerance = st.slider("Tolérance autour de la valeur marchande (en millions d'euros) :",
                                min_value=0.5,
                                max_value=10.0,
                                value=2.5,
                                step=0.5
                            ) * 1_000_000
    min_val = target_value - tolerance
    max_val = target_value + tolerance
    df = pd.concat([df[df["player"] == player_name],
                    df[(df['Valeur marchande (euros)'] >= min_val) &
                       (df['Valeur marchande (euros)'] <= max_val)]])


df = df.groupby(["player", "born"]).agg(aggregation_dict).reset_index()

if "pos" in filter_options:
    df = df[df["pos"] == df[df["player"] == player_name]["pos"].iloc[0]]

if "team" in filter_options:
    df = df[df["team"] == df[df["player"] == player_name]["team"].iloc[0]]

# Step 4: number of top similar players to show
top_n = st.slider("Number of similar players to show:", min_value=1, max_value=20, value=5)


similarity_df, df, feature_cols = compute_similarity(df,feature_cols)
st.write(df[df["player"] == player_name])


# Step 5: compute similarity
if st.button("Find similar players"):
    similar_players, sims = get_similar_players(df, similarity_df, player_name, top_n, filter_cols=filter_options)

    st.markdown("""
        <style>
        div[data-testid="stExpander"] {
            border: 1px solid #E0E0E0;
            border-radius: 15px;
            padding: 8px;
            margin: 6px;
            background-color: #f9f9f9;
            transition: 0.2s ease-in-out;
        }
        div[data-testid="stExpander"]:hover {
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            background-color: #fff;
        }
        </style>
        """, unsafe_allow_html=True)
    main_player = df[df["player"] == player_name].iloc[0]

    st.markdown(f"""
<div class="player-card">
    <div class="player-title">{main_player['player']}</div>
    <div class="player-sub">{main_player['team']} — {main_player['pos']}</div>
    <div class="stats-grid">
        <div class="stat-box"><b>Valeur</b><br>{main_player['Valeur marchande (euros)']:,} €</div>
        <div class="stat-box"><b>G+A</b><br>{main_player['Performance G+A']}</div>
        <div class="stat-box"><b>xG</b><br>{main_player['Expected xG']:.2f}</div>
    </div>
</div>
""", unsafe_allow_html=True)

    st.markdown("---")
    st.markdown("<h3 style='text-align:center;'>🔍 Joueurs Similaires</h3>", unsafe_allow_html=True)


    contribs = feature_contributions(df, player_name, similar_players.iloc[0]["player"], feature_cols)

    top = contribs.head(10)

    # Créer un barplot horizontal
    fig = px.bar(
        top,
        x='contribution',
        y='feature',
        orientation='h',
        title=f"Top 10 features contributing to similarity between {player_name} and {similar_players.iloc[0]["player"]}",
        labels={'contribution': 'Normalized contribution', 'feature': 'Feature'},
        text='contribution'
    )

    fig.update_layout(yaxis={'categoryorder':'total ascending'})
    fig.update_traces(texttemplate='%{text:.3f}', textposition='outside')

    # Affichage dans Streamlit
    st.plotly_chart(fig, use_container_width=True)

    if similar_players.empty:
        st.write("No similar players found with these filters.")
    else:
        cols_per_row = 2
        for i in range(0, len(similar_players), cols_per_row):
            cols = st.columns(cols_per_row)

            for j, col in enumerate(cols):
                if i + j < len(similar_players):
                    player = similar_players.iloc[i + j]
                    with col:
                        with st.expander(
                            f"**{player['player']}** ({player['team']}) — {player['pos']}  "
                            f"🎯 *Sim: {player['similarity']:.2f}*"
                        ):
                            st.markdown(f"**Équipe :** {player['team']}")
                            st.markdown(f"**Poste :** {player['pos']}")
                            st.markdown(f"**Valeur marchande :** {player['Valeur marchande (euros)']:,} €")
                            st.markdown(f"**Buts + Passes :** {player['Performance G+A']}")
                            st.markdown(f"**xG :** {player['Expected xG']}")

