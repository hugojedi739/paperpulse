"""Uso y límites del asistente IA guardados en la base de datos (válidos con varias instancias, p. ej. Vercel).

- ai_usage: una fila por respuesta (tokens de entrada, salida, razonamiento y caché). Sin IP, usuario ni texto.
- ai_limits: contadores por minuto y por día de cada cliente, identificado por un HMAC de la IP con una sal diaria.
- ai_challenges_used: uso único de los desafíos anti-bot.
Todas las funciones son bloqueantes: llámalas con run_in_threadpool.
"""
import datetime
import hashlib
import hmac
import sys
import time
from contextlib import closing
from typing import Dict, List, Optional

from backend import db
from backend.config import DAILY_GLOBAL_TOKEN_LIMIT, DAILY_USER_CHAT_REQUESTS, DAILY_USER_TOKEN_LIMIT

CHAT_CALLS_PER_MINUTE = 20
USAGE_RETENTION_DAYS = 90

# Precio por millón de tokens (entrada, salida). Solo para estimar el coste en el panel.
PRICES = {"claude-haiku-5-5": (0.10, 0.50), "claude-sonnet-5-5": (2.00, 10.00), "claude-opus-5-5": (4.00, 20.00)}

_secret_cache: Dict[str, bytes] = {}


def today() -> str:
    return datetime.datetime.now(datetime.timezone.utc).date().isoformat()


def secret() -> bytes:
    """Secreto del servidor (generado por la migración 0010). Igual en todas las instancias."""
    if "ai" not in _secret_cache:
        with closing(db.connect()) as conn:
            row = conn.execute("SELECT value FROM server_secrets WHERE name = 'ai'").fetchone()
        _secret_cache["ai"] = bytes.fromhex(row[0])
    return _secret_cache["ai"]


def client_key(ip: str, day: str) -> str:
    return hmac.new(secret(), f"{day}|{ip}".encode(), hashlib.sha256).hexdigest()[:32]


def _global_tokens(conn, day: str) -> int:
    row = conn.execute("SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM ai_usage WHERE day = ? AND kind = 'ai'", (day,)).fetchone()
    return int(row[0])


def admit(ip: str, uses_ai: bool) -> Optional[str]:
    """Comprueba los límites y, si se admite la petición, la cuenta. Devuelve None o el mensaje de error (HTTP 429).

    Todas las peticiones cuentan para el límite por minuto; solo las que llaman a la IA cuentan para los diarios."""
    day = today()
    client = client_key(ip, day)
    minute = f"m:{int(time.time() // 60)}"

    def run(conn):
        row = conn.execute("SELECT requests FROM ai_limits WHERE client = ? AND period = ?", (client, minute)).fetchone()
        if row and row[0] >= CHAT_CALLS_PER_MINUTE:
            return "Has alcanzado el límite de preguntas por minuto. Por favor, espera unos segundos."
        if uses_ai:
            daily = conn.execute("SELECT requests, tokens FROM ai_limits WHERE client = ? AND period = ?", (client, f"d:{day}")).fetchone()
            if daily and daily[0] >= DAILY_USER_CHAT_REQUESTS:
                return "Has alcanzado el límite diario de mensajes para tu sesión. Se restablecerá a las 00:00 UTC."
            if _global_tokens(conn, day) >= DAILY_GLOBAL_TOKEN_LIMIT:
                return "Se ha alcanzado el límite diario de consultas de IA. El servicio se restablecerá a las 00:00 UTC."
            if daily and daily[1] >= DAILY_USER_TOKEN_LIMIT:
                return "Has alcanzado tu límite diario de consumo de IA. Se restablecerá a las 00:00 UTC."
            conn.execute("INSERT INTO ai_limits (client, period, requests) VALUES (?, ?, 1) "
                         "ON CONFLICT(client, period) DO UPDATE SET requests = requests + 1", (client, f"d:{day}"))
        conn.execute("INSERT INTO ai_limits (client, period, requests) VALUES (?, ?, 1) "
                     "ON CONFLICT(client, period) DO UPDATE SET requests = requests + 1", (client, minute))
        return None

    return db.retry_transaction(run)


def record(ip: str, kind: str, model: str = "", effort: str = "", usage=None, truncated: bool = False) -> None:
    """Guarda el consumo de una respuesta (kind 'ai' o 'fixed') y lo suma al contador diario del cliente."""
    day = today()
    details = getattr(usage, "output_tokens_details", None) if usage else None
    vals = {
        "input": getattr(usage, "input_tokens", 0) or 0,
        "output": getattr(usage, "output_tokens", 0) or 0,
        "thinking": getattr(details, "thinking_tokens", 0) or 0,
        "cache_read": getattr(usage, "cache_read_input_tokens", 0) or 0,
        "cache_write": getattr(usage, "cache_creation_input_tokens", 0) or 0,
    }
    # Para los topes cuenta todo lo que se factura como entrada (también la caché) y la salida
    total = vals["input"] + vals["cache_read"] + vals["cache_write"] + vals["output"]

    def run(conn):
        before = _global_tokens(conn, day)
        conn.execute("INSERT INTO ai_usage (created_at, day, kind, model, effort, input_tokens, output_tokens, thinking_tokens, "
                     "cache_read_tokens, cache_write_tokens, truncated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     (int(time.time()), day, kind, model, effort, vals["input"] + vals["cache_read"] + vals["cache_write"], vals["output"],
                      vals["thinking"], vals["cache_read"], vals["cache_write"], int(truncated)))
        if total:
            conn.execute("INSERT INTO ai_limits (client, period, tokens) VALUES (?, ?, ?) "
                         "ON CONFLICT(client, period) DO UPDATE SET tokens = tokens + excluded.tokens", (client_key(ip, day), f"d:{day}", total))
        return before

    before = db.retry_transaction(run)
    limit = DAILY_GLOBAL_TOKEN_LIMIT * 0.8
    if before < limit <= before + total:
        print(f"[ALERTA] Consumo diario de IA al 80 % del límite global ({before + total}/{DAILY_GLOBAL_TOKEN_LIMIT} tokens).", file=sys.stderr)


def consume_challenge(signature: str, expires_at: int) -> bool:
    """Marca un desafío como usado. False si ya se había usado (en esta u otra instancia)."""
    try:
        with db.transaction() as conn:
            conn.execute("INSERT INTO ai_challenges_used (signature, expires_at) VALUES (?, ?)", (signature, expires_at))
        return True
    except Exception as exc:  # noqa: BLE001  (libsql lanza ValueError genérico en conflictos de clave)
        if db.is_integrity_error(exc):
            return False
        raise


def summary(day: Optional[str] = None) -> Dict:
    """Consumo del día para el panel y /api/health."""
    day = day or today()
    with closing(db.connect()) as conn:
        rows = conn.execute("SELECT kind, model, COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), "
                            "COALESCE(SUM(thinking_tokens), 0), COALESCE(SUM(cache_read_tokens), 0), COALESCE(SUM(truncated), 0) "
                            "FROM ai_usage WHERE day = ? GROUP BY kind, model", (day,)).fetchall()
    ai = [r for r in rows if r[0] == "ai"]
    ai_requests = sum(r[2] for r in ai)
    tin, tout = sum(r[3] for r in ai), sum(r[4] for r in ai)
    cost = sum((r[3] - r[6]) * PRICES.get(r[1], (0, 0))[0] / 1e6 + r[6] * PRICES.get(r[1], (0, 0))[0] * 0.1 / 1e6
               + r[4] * PRICES.get(r[1], (0, 0))[1] / 1e6 for r in ai)
    return {
        "day": day,
        "chatRequests": sum(r[2] for r in rows),
        "aiRequests": ai_requests,
        "fixedAnswers": sum(r[2] for r in rows if r[0] == "fixed"),
        "inputTokens": tin,
        "outputTokens": tout,
        "thinkingTokens": sum(r[5] for r in ai),
        "truncated": sum(r[7] for r in ai),
        "tokensToday": tin + tout,
        "avgTokensPerAiRequest": round((tin + tout) / ai_requests) if ai_requests else 0,
        "costTodayUsd": round(cost, 5),
    }


def history(days: int = 14) -> List[Dict]:
    """Consumo por día de los últimos `days` días (incluido hoy), con ceros en los días sin actividad. Para el panel."""
    end = datetime.datetime.now(datetime.timezone.utc).date()
    start = end - datetime.timedelta(days=days - 1)
    with closing(db.connect()) as conn:
        rows = conn.execute("SELECT day, kind, COUNT(*), COALESCE(SUM(input_tokens + output_tokens), 0) FROM ai_usage "
                            "WHERE day >= ? GROUP BY day, kind", (start.isoformat(),)).fetchall()
    by_day = {(r[0], r[1]): (r[2], r[3]) for r in rows}
    out = []
    for i in range(days):
        d = (start + datetime.timedelta(days=i)).isoformat()
        out.append({"day": d, "aiRequests": by_day.get((d, "ai"), (0, 0))[0], "fixedAnswers": by_day.get((d, "fixed"), (0, 0))[0],
                    "tokens": by_day.get((d, "ai"), (0, 0))[1]})
    return out


def cleanup() -> Dict:
    """Para el cron diario: borra contadores de días y minutos pasados, desafíos caducados y uso antiguo."""
    day = today()
    old = (datetime.date.fromisoformat(day) - datetime.timedelta(days=USAGE_RETENTION_DAYS)).isoformat()
    with db.transaction() as conn:
        a = conn.execute("DELETE FROM ai_limits WHERE period < ? OR (period LIKE 'm:%' AND period < ?)",
                         (f"d:{day}", f"m:{int(time.time() // 60) - 1}")).rowcount
        b = conn.execute("DELETE FROM ai_challenges_used WHERE expires_at < ?", (int(time.time()),)).rowcount
        c = conn.execute("DELETE FROM ai_usage WHERE day < ?", (old,)).rowcount
    return {"aiLimitsDeleted": a, "aiChallengesDeleted": b, "aiUsageDeleted": c}
