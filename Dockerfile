FROM emscripten/emsdk:4.0.10 AS engine
WORKDIR /src
COPY engine ./engine
RUN mkdir -p web/assets && bash engine/build.sh

FROM node:24-slim AS web
WORKDIR /src
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
COPY scripts ./scripts
COPY web ./web
COPY --from=engine /src/web/assets/engine.wasm ./web/assets/engine.wasm
RUN npm run build

FROM rust:1-slim-bookworm AS server
WORKDIR /src/server
COPY LICENSE /src/LICENSE
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/migrations ./migrations
COPY server/src ./src
RUN cargo build --release --locked --bin grafo-server

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin grafo
WORKDIR /app
COPY --from=server /src/server/target/release/grafo-server /usr/local/bin/grafo-server
COPY --from=web /src/web/dist ./web/dist
COPY server/migrations ./migrations
ENV GRAFO_BIND=0.0.0.0:8080 \
    GRAFO_STATIC_DIR=/app/web/dist \
    RUST_LOG=info
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=5 CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["/usr/local/bin/grafo-server"]
