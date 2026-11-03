"""Se importa antes que backend en cada test: vacía las variables de Turso para que los tests nunca toquen una base remota.

backend.config carga .env con setdefault, así que una variable ya definida (aunque vacía) gana.
"""
import os

os.environ["TURSO_DATABASE_URL"] = ""
os.environ["TURSO_AUTH_TOKEN"] = ""
