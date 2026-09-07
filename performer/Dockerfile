FROM node:22 AS builder

WORKDIR /app

COPY . .

RUN npm ci --ignore-scripts

WORKDIR /app/performer

RUN npm install --unsafe-perm

RUN mkdir -p src/proto

RUN npx grpc_tools_node_protoc \
        --plugin=protoc-gen-ts=./node_modules/.bin/protoc-gen-ts \
        --ts_out=grpc_js:./src/proto \
        --js_out=import_style=commonjs,binary:./src/proto \
        --grpc_out=grpc_js:./src/proto \
        -I ./proto/columnar \
        -I ./proto \
        ./proto/columnar/*.proto \
        ./proto/shared.echo.proto

ENV NODE_ENV=production

RUN npm run build
RUN npm prune --omit=dev
RUN npm --prefix /app prune --omit=dev

FROM node:22-slim AS testing

ARG SDK=insights-node

LABEL org.opencontainers.image.title="${SDK}-fit-performer" \
      org.opencontainers.image.description="Couchbase Node.js Operational Insights Client FIT performer (gRPC server)"

WORKDIR /app

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/performer/package.json ./performer/package.json
COPY --from=builder /app/performer/node_modules ./performer/node_modules
COPY --from=builder /app/performer/src/build ./performer/src/build
COPY --from=builder /app/performer/src/proto ./performer/src/proto

WORKDIR /app/performer

ENTRYPOINT ["node", "src/build/performer.js"]
