FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4174
ENV DATABASE_PATH=/app/data/app.db

COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/index.html ./index.html

VOLUME ["/app/data"]
EXPOSE 4174
CMD ["npm", "start"]
