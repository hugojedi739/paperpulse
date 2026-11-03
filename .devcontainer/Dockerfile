# ==============================================================================
# PaperPulse Terminal — Imagen de Desarrollo (Dev Container)
# ==============================================================================
# Incluye todo lo necesario para desarrollar y ejecutar los tests sin instalar
# nada en el equipo anfitrión: Python, dependencias y Chromium (capturas con
# `npm run screenshots`). Node.js se añade como feature.
# ==============================================================================

FROM mcr.microsoft.com/devcontainers/python:3.13

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt

ENV CHROME_PATH=/usr/bin/chromium \
    LANGUAGE=es_ES \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
