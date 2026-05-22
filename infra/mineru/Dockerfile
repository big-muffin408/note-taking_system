# Official MinerU Docker deployment pattern.
# Source reference:
# https://opendatalab.github.io/MinerU/quick_start/docker_deployment/
ARG VLLM_BASE_IMAGE=vllm/vllm-openai:v0.8.5
FROM ${VLLM_BASE_IMAGE}

ARG VLLM_BASE_IMAGE
ARG APT_MIRROR=
ARG MINERU_VERSION=3.1.4
ARG MINERU_MODEL_SOURCE=modelscope
ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV UV_LINK_MODE=copy
ENV MINERU_MODEL_SOURCE=${MINERU_MODEL_SOURCE}
ENV VLLM_BASE_IMAGE=${VLLM_BASE_IMAGE}

ENTRYPOINT []

RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|http://archive.ubuntu.com/ubuntu|${APT_MIRROR}/ubuntu|g; s|http://security.ubuntu.com/ubuntu|${APT_MIRROR}/ubuntu|g" /etc/apt/sources.list; \
    fi \
    && printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n' > /etc/apt/apt.conf.d/80-retries \
    && apt-get update \
    && apt-get install -y --no-install-recommends --fix-missing libgl1 libglib2.0-0 fonts-noto-cjk fontconfig \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,target=/root/.cache/pip \
    --mount=type=cache,target=/root/.cache/uv \
    python3 -m pip install -U pip uv \
    && printf 'torch==2.6.0\ntorchvision==0.21.0\ntriton==3.2.0\n' > /tmp/mineru-constraints.txt \
    && uv pip install --system -U -c /tmp/mineru-constraints.txt "mineru[core]==${MINERU_VERSION}"

EXPOSE 8000
CMD ["mineru-api", "--host", "0.0.0.0", "--port", "8000"]
