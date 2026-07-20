FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.9.9 /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 libjpeg62-turbo libopenjp2-7 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml uv.lock /app/
RUN uv sync --frozen --no-dev --no-install-project
COPY app /app/app
COPY canon /app/canon
COPY render /app/render
COPY scripts /app/scripts
EXPOSE 7860
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--app-dir", "/app", "--host", "0.0.0.0", "--port", "7860"]
