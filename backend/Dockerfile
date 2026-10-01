# Dhanvi API + worker image (one image, two commands).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S dhanvi && adduser -S dhanvi -G dhanvi
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY sql ./sql
USER dhanvi
ENV PORT=3002
EXPOSE 3002
# API by default; the worker service overrides the command with `node dist/worker.js`.
CMD ["node", "dist/server.js"]
