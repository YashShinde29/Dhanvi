# Build from the repository root: docker build -f apps/admin-web/Dockerfile .
FROM node:22-alpine AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/user-web/package.json apps/user-web/
COPY apps/admin-web/package.json apps/admin-web/
COPY packages/ui/package.json packages/ui/
COPY packages/api-client/package.json packages/api-client/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/features/package.json packages/features/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /workspace
COPY --from=dependencies /workspace/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin-web ./apps/admin-web
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api/v1
ARG NEXT_PUBLIC_USER_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_ADMIN_URL=http://localhost:3001
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_MIN_GROUP_MEMBERS=20
ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV NEXT_PUBLIC_MIN_GROUP_MEMBERS=$NEXT_PUBLIC_MIN_GROUP_MEMBERS
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL NEXT_PUBLIC_USER_APP_URL=$NEXT_PUBLIC_USER_APP_URL NEXT_PUBLIC_ADMIN_URL=$NEXT_PUBLIC_ADMIN_URL
RUN npm run build --workspace @dhanvi/admin-web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
# Standalone output is traced from the workspace root, so the server lives under apps/admin-web.
COPY --from=build --chown=nextjs:nodejs /workspace/apps/admin-web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /workspace/apps/admin-web/.next/static ./apps/admin-web/.next/static
COPY --from=build --chown=nextjs:nodejs /workspace/apps/admin-web/public ./apps/admin-web/public
USER nextjs
EXPOSE 3001
CMD ["node", "apps/admin-web/server.js"]
