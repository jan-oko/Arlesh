# syntax=docker/dockerfile:1.7
#
# arlesh-server: the HTTP service over a board (crates/arlesh-py, `arlesh[server]`).
#
#   docker build -f docker/server.Dockerfile -t arlesh-server .     # context: the repository root
#
# Two stages. The first builds the wheel with maturin, always on the BUILD platform and
# cross-compiling to the image's platform with zig as the linker, so a linux/arm64 image is not
# compiled under QEMU. The second is a slim Python that installs the wheel and runs as a user
# with no privileges. The database lives on the volume /data.

ARG PYTHON=3.12

FROM --platform=$BUILDPLATFORM python:${PYTHON}-slim-bookworm AS wheel

ARG TARGETARCH
ENV CARGO_HOME=/usr/local/cargo \
    RUSTUP_HOME=/usr/local/rustup \
    PATH=/usr/local/cargo/bin:$PATH

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir "maturin[zig]>=1.9,<2" \
 && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none

WORKDIR /src
# The workspace manifest names src-tauri as a member, so cargo wants its manifest and sources
# present even though only arlesh-py is built.
COPY rust-toolchain.toml Cargo.toml Cargo.lock ./
COPY .cargo .cargo
COPY src-tauri src-tauri
COPY crates crates

# rustup reads /src/rust-toolchain.toml: the pinned toolchain, and the target for this image.
RUN case "$TARGETARCH" in \
      amd64) echo x86_64-unknown-linux-gnu > /rust-target ;; \
      arm64) echo aarch64-unknown-linux-gnu > /rust-target ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && rustup target add "$(cat /rust-target)"

# manylinux_2_28 is far below bookworm's glibc (2.36), so the wheel runs in the runtime stage.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/src-tauri/target \
    maturin build --release --locked --zig \
      --manifest-path crates/arlesh-py/Cargo.toml \
      --target "$(cat /rust-target)" --compatibility manylinux_2_28 \
      --out /wheels


FROM python:${PYTHON}-slim-bookworm

# The commit the image was built from, which /health reports.
ARG ARLESH_COMMIT=unknown
ENV ARLESH_COMMIT=${ARLESH_COMMIT} \
    ARLESH_DATABASE_URL=sqlite:////data/arlesh.db \
    ARLESH_SERVER__HOST=0.0.0.0 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN --mount=type=bind,from=wheel,source=/wheels,target=/wheels \
    pip install "$(ls /wheels/*.whl)[server]"

RUN useradd --system --uid 10001 --home-dir /data --shell /usr/sbin/nologin arlesh \
 && mkdir /data \
 && chown arlesh:arlesh /data

USER arlesh
WORKDIR /data
VOLUME /data
# The user's day is kept in ARLESH_TIME_ZONE (an IANA name such as Europe/Berlin); unset it is this
# container's own zone, UTC. The zone database is built into the server, so tzdata is not needed.
# The default port; ARLESH_SERVER__PORT changes it (publish that one instead).
EXPOSE 4750

# /health sits behind the bearer token, so an answer of any kind (200, or 401 without a token)
# proves the server is up; only a refused connection or a timeout is unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import os, sys, urllib.error, urllib.request\ntry:\n    urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('ARLESH_SERVER__PORT', '4750'), timeout=4)\nexcept urllib.error.HTTPError:\n    pass\nexcept Exception:\n    sys.exit(1)"]

ENTRYPOINT ["arlesh-server"]
