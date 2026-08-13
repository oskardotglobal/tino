FROM python:3.14-slim

# renovate: github-releases depName=typst/typst
ARG TYPST_VERSION=0.15.1

# renovate: github-releases depName=typstyle-rs/typstyle
ARG TYPSTYLE_VERSION=0.15.1

# renovate: github-releases depName=Myriad-Dreamin/tinymist
ARG TINYMIST_VERSION=0.15.2

# Populated automatically by BuildKit/buildx from the target platform.
ARG TARGETARCH
ARG TARGETVARIANT

WORKDIR /usr/src

COPY build/*.whl .
COPY tino/gitattributes /etc/gitattributes
RUN apt-get update && apt-get install -y --no-install-recommends curl git git-lfs xz-utils \
    && pip install --no-cache-dir *.whl \
    && rm -f *.whl \
    && case "$TARGETARCH/$TARGETVARIANT" in \
         amd64/*)   TYPST_TARGET=x86_64-unknown-linux-musl ;; \
         arm64/*)   TYPST_TARGET=aarch64-unknown-linux-musl ;; \
         arm/v7)    TYPST_TARGET=armv7-unknown-linux-musleabi ;; \
         riscv64/*) TYPST_TARGET=riscv64gc-unknown-linux-gnu ;; \
         *) echo "No Typst binary for target platform: '${TARGETARCH}/${TARGETVARIANT}'" >&2; exit 1 ;; \
       esac \
    && curl -sSfL https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${TYPST_TARGET}.tar.xz \
       | tar -xJ --strip-components=1 -C /usr/local/bin typst-${TYPST_TARGET}/typst \
    # The editor's language tooling — completion and code actions (tinymist),
    # formatting (typstyle) — is optional: TINO reports it as unavailable and
    # hides it in the UI when the binary is missing, so a platform without a
    # release is not a build failure. typstyle ships plain binaries, tinymist a
    # tarball.
    && case "$TARGETARCH/$TARGETVARIANT" in \
         amd64/*)   TINYMIST_TARGET=x86_64-unknown-linux-musl ;; \
         arm64/*)   TINYMIST_TARGET=aarch64-unknown-linux-musl ;; \
         arm/v7)    TINYMIST_TARGET=armv7-unknown-linux-musleabihf ;; \
         riscv64/*) TINYMIST_TARGET=riscv64gc-unknown-linux-musl ;; \
       esac \
    && if [ -n "$TINYMIST_TARGET" ]; then \
         curl -sSfL https://github.com/Myriad-Dreamin/tinymist/releases/download/v${TINYMIST_VERSION}/tinymist-${TINYMIST_TARGET}.tar.gz \
         | tar -xz --strip-components=1 -C /usr/local/bin tinymist-${TINYMIST_TARGET}/tinymist; \
       else \
         echo "No tinymist binary for '${TARGETARCH}/${TARGETVARIANT}' — completion disabled" >&2; \
       fi \
    && case "$TARGETARCH/$TARGETVARIANT" in \
         amd64/*) TYPSTYLE_TARGET=x86_64-unknown-linux-gnu ;; \
         arm64/*) TYPSTYLE_TARGET=aarch64-unknown-linux-gnu ;; \
         arm/v7)  TYPSTYLE_TARGET=arm-unknown-linux-gnueabihf ;; \
       esac \
    && if [ -n "$TYPSTYLE_TARGET" ]; then \
         curl -sSfLo /usr/local/bin/typstyle https://github.com/typstyle-rs/typstyle/releases/download/v${TYPSTYLE_VERSION}/typstyle-${TYPSTYLE_TARGET} \
         && chmod +x /usr/local/bin/typstyle; \
       else \
         echo "No typstyle binary for '${TARGETARCH}/${TARGETVARIANT}' — formatting disabled" >&2; \
       fi \
    && git lfs install --system \
    && git config --system core.attributesFile /etc/gitattributes \
    && apt-get purge -y --auto-remove xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r -g 1234 tino \
    && useradd -r -u 1234 -g 1234 -d /tino -m tino \
    && mkdir -p /data \
    && chown tino: /data

USER tino

WORKDIR /tino

VOLUME /data

ENV TINO_DATA_DIR=/data
ENV XDG_CACHE_HOME=/tmp/.cache

EXPOSE 5000

HEALTHCHECK --start-period=10s --start-interval=2s --interval=10s --timeout=10s --retries=3 \
    CMD curl -sfL http://127.0.0.1:5000/health

ENTRYPOINT ["gunicorn"]
CMD ["-k", "uvicorn.workers.UvicornWorker", "-w", "1", "-b", "0.0.0.0:5000", "--worker-tmp-dir", "/tmp", "--chdir", "/tmp", "tino:create_app()"]
