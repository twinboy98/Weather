FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=5
WORKDIR /workspace

COPY pyproject.toml README.md ./
COPY apps/api ./apps/api
COPY config ./config
# The API, migration, and worker services do not import the optional analytics
# stack. Keeping DuckDB/Polars/PyArrow/SciPy out of this runtime image avoids
# downloading hundreds of megabytes during a normal application build.
RUN pip install --no-cache-dir "."

ENV PYTHONPATH=/workspace/apps/api
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
