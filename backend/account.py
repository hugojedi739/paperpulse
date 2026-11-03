"""Cuenta del usuario: aceptación de términos, descarga de datos (RGPD, portabilidad) y borrado con anonimización.

Borrar la cuenta NO borra la fila de `users`: se queda como «tombstone» anonimizado (sin email, nombre ni contraseña,
desactivado). Así el foro conserva su integridad (los hilos y respuestas de otras personas que cuelgan de un hilo o
mensaje suyo no desaparecen en cascada), mientras que se borran sus datos personales, su cuenta de práctica, sus
mensajes (se vacían), su perfil y todo lo demás.
"""
import json
import time
from contextlib import closing
from typing import Dict

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.routing import Route

from backend import db
from backend.community.api import _guard
from backend.db import transaction
from backend.http import allow, error, ok, read_json

# Versión de los textos legales (términos, privacidad, normas). Si cambian de forma relevante, súbela: a las
# cuentas con otra versión se les pide aceptar de nuevo. Debe coincidir con LEGAL_VERSION de frontend/js/lib/legal-content.js.
LEGAL_VERSION = "2026-11-borrador-1"
MIN_AGE = 14


def accept_terms(user_id: int) -> Dict:
    now = int(time.time())
    with transaction() as conn:
        conn.execute("UPDATE users SET terms_version = ?, terms_accepted_at = ?, age_confirmed_at = COALESCE(age_confirmed_at, ?) WHERE id = ?",
                     (LEGAL_VERSION, now, now, user_id))
    return db.get_user(user_id)


def _rows(conn, sql: str, *args):
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def export_data(user_id: int) -> Dict:
    """Todo lo que el servidor guarda del usuario, en JSON. No incluye contraseñas, tokens de sesión ni datos de otras personas
    (los seguidores se dan solo como número; a quién sigues, por alias)."""
    with closing(db.connect()) as conn:
        u = conn.execute("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL", (user_id,)).fetchone()
        if not u:
            return {}
        one = lambda sql, *a: conn.execute(sql, a).fetchone()
        pd = one("SELECT payload, updated_at FROM practice_data WHERE user_id = ?", user_id)
        ledgers = [r["id"] for r in conn.execute("SELECT id FROM users WHERE owner_id = ?", (user_id,))]
        ledger_ids = [user_id, *ledgers]

        def trading(lid):
            return {"account": _rows(conn, "SELECT * FROM accounts WHERE user_id = ?", lid), "positions": _rows(conn, "SELECT * FROM positions WHERE user_id = ?", lid),
                    "orders": _rows(conn, "SELECT * FROM orders WHERE user_id = ? ORDER BY id", lid), "fills": _rows(conn, "SELECT * FROM fills WHERE user_id = ? ORDER BY id", lid)}

        return {
            "format": "paperpulse-export-v1", "exportedAt": int(time.time()), "units": "importes en céntimos de USD; cantidades, precios y tipos de cambio en unidades de 1e-8",
            "account": {
                "id": u["id"], "email": u["email"], "name": u["name"], "createdAt": u["created_at"], "lastLoginAt": u["last_login_at"], "role": u["role"],
                "emailVerified": bool(u["email_verified"]), "hasPassword": bool(u["password_hash"]), "termsVersion": u["terms_version"],
                "termsAcceptedAt": u["terms_accepted_at"], "ageConfirmedAt": u["age_confirmed_at"], "suspendedUntil": u["suspended_until"],
                "providers": [r["provider"] for r in conn.execute("SELECT provider FROM identities WHERE user_id = ?", (user_id,))],
            },
            "profile": (lambda p: dict(p) if p else None)(one("SELECT alias, bio, is_private, created_at, updated_at FROM profiles WHERE user_id = ?", user_id)),
            "practiceBackup": {"updatedAt": pd["updated_at"], "data": json.loads(pd["payload"])} if pd else None,
            "serverAccount": trading(user_id),
            "challengeAccounts": [dict(trading(lid), challenge=r["slug"]) for lid, r in
                                  ((r["ledger_id"], r) for r in conn.execute("SELECT e.ledger_id, c.slug FROM challenge_entries e JOIN challenges c ON c.id = e.challenge_id WHERE e.user_id = ?", (user_id,)))],
            "forum": {
                "threads": _rows(conn, "SELECT id, category_id, title, status, fill_id, created_at FROM threads WHERE author_id = ? ORDER BY id", user_id),
                "posts": _rows(conn, "SELECT id, thread_id, body, score, status, created_at FROM posts WHERE author_id = ? ORDER BY id", user_id),
                "votesCast": _rows(conn, "SELECT post_id, value, created_at FROM votes WHERE user_id = ?", user_id),
                "reportsMade": _rows(conn, "SELECT post_id, reason, details, status, created_at FROM reports WHERE reporter_id = ?", user_id),
            },
            "following": [r["alias"] for r in conn.execute("SELECT p.alias FROM follows f JOIN profiles p ON p.user_id = f.followee_id WHERE f.follower_id = ?", (user_id,))],
            "followersCount": one("SELECT COUNT(*) FROM follows WHERE followee_id = ?", user_id)[0],
            "contactMessages": _rows(conn, "SELECT reason, message, created_at FROM contact_messages WHERE user_id = ? ORDER BY id", user_id),
            "notifications": _rows(conn, "SELECT kind, title, body, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id", user_id),
            "achievements": _rows(conn, "SELECT code, earned_at FROM achievements WHERE user_id = ?", user_id),
            "tradingDays": [r["day"] for r in conn.execute("SELECT day FROM trading_days WHERE user_id = ? ORDER BY day", (user_id,))],
            "equitySnapshots": _rows(conn, "SELECT day, equity_cents FROM equity_snapshots WHERE user_id = ? ORDER BY day", user_id),
        }


def delete_account(user_id: int) -> None:
    """Borra o anonimiza todos los datos del usuario (ver el docstring del módulo). Una sola transacción."""
    now = int(time.time())
    with transaction() as conn:
        u = conn.execute("SELECT id, owner_id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not u or u["owner_id"]:
            return
        run = lambda sql, *a: conn.execute(sql, a)
        run("DELETE FROM users WHERE owner_id = ?", user_id)  # cuentas de retos (en cascada: cuentas, órdenes, ejecuciones, posiciones)
        # Los hilos de operaciones compartidas cuelgan de un fill (ON DELETE CASCADE): se desvinculan antes de borrar el fill
        run("UPDATE threads SET fill_id = NULL WHERE fill_id IN (SELECT id FROM fills WHERE user_id = ?)", user_id)
        run("DELETE FROM contact_messages WHERE user_id = ?", user_id)  # mensajes que envió con sesión
        run("DELETE FROM orders WHERE user_id = ?", user_id)  # y sus ejecuciones
        run("DELETE FROM positions WHERE user_id = ?", user_id)
        run("DELETE FROM accounts WHERE user_id = ?", user_id)
        # Sus votos a otros mensajes: se quita su efecto en la puntuación
        run("UPDATE posts SET score = score - (SELECT v.value FROM votes v WHERE v.post_id = posts.id AND v.user_id = ?) "
            "WHERE id IN (SELECT post_id FROM votes WHERE user_id = ?)", user_id, user_id)
        for sql in ("DELETE FROM votes WHERE user_id = ?", "DELETE FROM follows WHERE follower_id = ? OR followee_id = ?",
                    "DELETE FROM reports WHERE reporter_id = ?"):
            run(sql, *(user_id,) * sql.count("?"))
        # Su contenido: los mensajes se vacían y los hilos pasan a «eliminados»; los de otras personas siguen donde estaban
        run("UPDATE posts SET body = '', status = 'deleted', updated_at = ? WHERE author_id = ?", now, user_id)
        run("UPDATE threads SET title = 'Hilo eliminado', status = 'deleted' WHERE author_id = ?", user_id)
        run("UPDATE reports SET post_body = NULL, post_author_alias = NULL WHERE post_author_id = ?", user_id)  # copia de sus textos
        for table in ("profiles", "notifications", "achievements", "trading_days", "onboarding", "equity_snapshots", "leaderboard",
                      "challenge_entries", "challenge_scores", "practice_data", "sessions", "identities"):
            run(f"DELETE FROM {table} WHERE user_id = ?", user_id)
        run("UPDATE users SET email = ?, name = 'Usuario eliminado', password_hash = '', disabled = 1, role = 'user', email_verified = 0, "
            "suspended_until = NULL, suspension_reason = NULL, last_login_at = NULL, terms_version = NULL, terms_accepted_at = NULL, "
            "age_confirmed_at = NULL, deleted_at = ? WHERE id = ?", f"eliminado-{user_id}@eliminado.invalid", now, user_id)


# ---------------------------------------------------------------- API
async def api_terms(request):
    user, err = await _guard(request, "act", True)
    if err:
        return err
    body, err = await read_json(request, limit=512)
    if err:
        return err
    if body.get("acceptTerms") is not True or body.get("ageConfirmed") is not True:
        return error(f"Debes aceptar los términos y la política de privacidad y confirmar que tienes al menos {MIN_AGE} años.", 400)
    return ok({"user": await run_in_threadpool(accept_terms, user["id"])})


async def api_export(request):
    user, err = await _guard(request, "read", True)
    if err:
        return err
    if not allow(f"export:{user['id']}", 3):
        return error("Demasiadas descargas seguidas. Espera un minuto.", 429)
    data = await run_in_threadpool(export_data, user["id"])
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="paperpulse-mis-datos.json"', "Cache-Control": "no-store"})


routes = [
    Route("/api/account/terms", api_terms, methods=["POST"]),
    Route("/api/account/export", api_export, methods=["GET"]),
]
