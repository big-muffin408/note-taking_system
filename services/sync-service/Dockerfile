# 构建上下文为仓库根目录（docker-compose.yml: context: .），以便引入 @notes/shared 工作区包
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/sync-service/package.json services/sync-service/package.json
RUN npm ci --workspace @notes/shared --workspace @notes/sync-service
COPY packages/shared packages/shared
COPY services/sync-service services/sync-service
RUN npm run build --workspace @notes/shared \
 && npm run build --workspace @notes/sync-service

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/sync-service/package.json services/sync-service/package.json
RUN npm ci --omit=dev --workspace @notes/shared --workspace @notes/sync-service
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/services/sync-service/dist services/sync-service/dist
WORKDIR /repo/services/sync-service
EXPOSE 3005
CMD ["node", "dist/index.js"]
