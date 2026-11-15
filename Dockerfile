# Compilación
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# Ejecución: el servidor generado no necesita node_modules ni dependencias nativas.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "build"]
