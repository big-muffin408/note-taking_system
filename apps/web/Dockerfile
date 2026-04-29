FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
EXPOSE 5173
CMD ["npm", "run", "dev"]
