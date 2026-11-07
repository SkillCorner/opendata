FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY app ./app
COPY data/matches.json ./data/matches.json
COPY data/matches ./data/matches
COPY data/aggregates/aus1league_physicalaggregates_20242025.csv ./data/aggregates/aus1league_physicalaggregates_20242025.csv
COPY notebooks/fitted/pitch_control_settings.json ./notebooks/fitted/pitch_control_settings.json
COPY notebooks/fitted/value_model.json ./notebooks/fitted/value_model.json
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "app/server.mjs"]
