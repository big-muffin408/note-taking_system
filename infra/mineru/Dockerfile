# Official MinerU Docker deployment pattern.
# Source reference:
# https://opendatalab.github.io/MinerU/quick_start/docker_deployment/
FROM vllm/vllm-openai:v0.11.2

ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV UV_LINK_MODE=copy
ENV MINERU_MODEL_SOURCE=${MINERU_MODEL_SOURCE:-modelscope}

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 fonts-noto-cjk fontconfig \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,target=/root/.cache/pip \
    --mount=type=cache,target=/root/.cache/uv \
    python3 -m pip install -U pip uv \
    && uv pip install --system -U "mineru[core]"

EXPOSE 8000
CMD ["mineru-api", "--host", "0.0.0.0", "--port", "8000"]
