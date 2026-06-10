# 构建上下文为仓库根目录（docker-compose.yml: context: .），以便引入 @notes/shared 工作区包
FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/document-service/package.json services/document-service/package.json
RUN npm ci --workspace @notes/shared --workspace @notes/document-service
COPY packages/shared packages/shared
COPY services/document-service services/document-service
RUN npm run build --workspace @notes/shared \
 && npm run build --workspace @notes/document-service

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/document-service/package.json services/document-service/package.json
RUN npm ci --omit=dev --workspace @notes/shared --workspace @notes/document-service
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/services/document-service/dist services/document-service/dist
WORKDIR /repo/services/document-service
EXPOSE 3002
CMD ["node", "dist/index.js"]
