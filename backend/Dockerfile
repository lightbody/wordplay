# --- build stage ---
FROM rust:slim-bookworm AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# backend/ is a Cargo workspace root (engine-core/ and wasm-engine/ are
# nested members). wasm-engine isn't a dependency of wordplay-backend --
# it's a separate wasm build target consumed by the frontend (see
# frontend/package.json's gen:wasm scripts) -- so only its Cargo.toml is
# needed here, to let the workspace manifest resolve; its real source never
# needs to enter this image.
COPY Cargo.toml Cargo.lock ./
COPY engine-core/Cargo.toml engine-core/Cargo.toml
COPY wasm-engine/Cargo.toml wasm-engine/Cargo.toml
RUN mkdir -p src engine-core/src wasm-engine/src \
    && echo 'fn main(){}' > src/main.rs \
    && echo '' > engine-core/src/lib.rs \
    && echo '' > wasm-engine/src/lib.rs
RUN cargo build --release -p wordplay-backend
RUN rm src/main.rs engine-core/src/lib.rs

# Build the real binary (assets/enable.txt is include_str!'d in via engine-core/assets)
COPY src ./src
COPY migrations ./migrations
COPY engine-core/src engine-core/src
COPY engine-core/assets engine-core/assets
RUN touch src/main.rs engine-core/src/lib.rs && cargo build --release -p wordplay-backend

# --- runtime stage ---
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/wordplay-backend ./wordplay-backend
COPY --from=builder /app/migrations ./migrations

ENV PORT=8080
EXPOSE 8080

CMD ["./wordplay-backend"]
