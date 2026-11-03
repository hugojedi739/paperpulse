# ==============================================================================
# PaperPulse Terminal — Imagen de Producción
# ==============================================================================
#   docker build -t paperpulse .
#   docker run --env-file .env -p 8000:8000 paperpulse
# ==============================================================================

FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py ./
COPY backend ./backend
COPY frontend ./frontend

RUN useradd --create-home --uid 10001 app && mkdir -p /app/data && chown app:app /app/data
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health', timeout=4)"

CMD ["python", "server.py"]
