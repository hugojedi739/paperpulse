"""Opinión de la comunidad por activo: voto alcista/bajista, límites, suspensiones, privacidad y datos de la cuenta."""
import os
import sys
import time
import unittest
from contextlib import closing

sys.path.insert(0, os.path.dirname(__file__))
from test_community import Base  # noqa: E402

from backend import account, db  # noqa: E402
from backend.community import sentiment  # noqa: E402
from backend.community.common import CommunityError, Forbidden, NotFound  # noqa: E402


class SentimentTests(Base):
    def test_votar_cambiar_y_retirar(self):
        a, b = self.user("Ana"), self.user("Beto")
        self.assertEqual(sentiment.get("btc", None)["total"], 0)
        r = sentiment.vote(a, "btc", 1)
        self.assertEqual((r["bullish"], r["bearish"], r["myVote"]), (1, 0, 1))
        sentiment.vote(a, "BTC", 1)  # repetir no suma dos veces
        self.assertEqual(sentiment.vote(b, "BTC", -1)["total"], 2)
        r = sentiment.vote(a, "BTC", -1)  # cambiar
        self.assertEqual((r["bullish"], r["bearish"], r["myVote"]), (0, 2, -1))
        r = sentiment.vote(a, "BTC", 0)  # retirar
        self.assertEqual((r["bullish"], r["bearish"], r["myVote"]), (0, 1, 0))
        self.assertEqual(sentiment.get("BTC", b)["myVote"], -1)
        self.assertEqual(sentiment.get("BTC", None)["myVote"], 0)

    def test_valores_y_simbolos_no_validos(self):
        a = self.user("Ana")
        for bad in (2, "1", None, True, 0.5):
            with self.assertRaises(CommunityError):
                sentiment.vote(a, "BTC", bad)
        for sym in ("NOEXISTE", "", "BTC; DROP TABLE asset_votes"):
            with self.assertRaises(NotFound):
                sentiment.vote(a, sym, 1)
            with self.assertRaises(NotFound):
                sentiment.get(sym, None)

    def test_el_reparto_no_revela_quien_voto(self):
        a = self.user("Ana", private=True)
        sentiment.vote(a, "ETH", 1)
        out = sentiment.get("ETH", None)
        self.assertEqual(set(out), {"symbol", "bullish", "bearish", "total", "myVote", "threadId"})
        self.assertNotIn("ana", str(out).lower())

    def test_suspendidos_no_votan_ni_cuentan(self):
        a, b = self.user("Ana"), self.user("Beto")
        sentiment.vote(a, "BTC", 1)
        sentiment.vote(b, "BTC", 1)
        with closing(db.connect()) as conn:
            conn.execute("UPDATE users SET suspended_until = ? WHERE id = ?", (int(time.time()) + 3600, b))
        self.assertEqual(sentiment.get("BTC", None)["bullish"], 1)  # su voto deja de contar
        with self.assertRaises(Forbidden):
            sentiment.vote(b, "BTC", -1)
        with closing(db.connect()) as conn:
            conn.execute("UPDATE users SET suspended_until = NULL WHERE id = ?", (b,))
        self.assertEqual(sentiment.get("BTC", None)["bullish"], 2)

    def test_exige_perfil(self):
        uid = db.create_user("sinperfil@example.com", "secreto123", "Sin")["id"]
        with self.assertRaises(Forbidden):
            sentiment.vote(uid, "BTC", 1)

    def test_enlace_al_hilo_del_activo(self):
        a = self.user("Ana")
        from backend.community import forum
        tid = forum.asset_thread("BTC")["threadId"]
        self.assertEqual(sentiment.vote(a, "BTC", 1)["threadId"], tid)

    def test_api_sesion_origen_y_limite_por_minuto(self):
        a = self.user("Ana")
        anon = self.client()
        self.assertEqual(anon.get("/api/assets/BTC/sentiment").status_code, 200)  # ver el reparto no exige sesión
        self.assertEqual(anon.put("/api/assets/BTC/sentiment", json={"value": 1}).status_code, 401)
        c = self.client(a)
        self.assertEqual(c.put("/api/assets/BTC/sentiment", json={"value": 1}, headers={"Origin": "https://evil.example"}).status_code, 403)
        self.assertEqual(c.put("/api/assets/NOPE/sentiment", json={"value": 1}).status_code, 404)
        r = c.put("/api/assets/BTC/sentiment", json={"value": 1})
        self.assertEqual((r.status_code, r.json()["myVote"]), (200, 1))
        codes = [c.put("/api/assets/BTC/sentiment", json={"value": 1}).status_code for _ in range(12)]
        self.assertIn(429, codes)

    def test_descarga_y_borrado_de_cuenta(self):
        a, b = self.user("Ana"), self.user("Beto")
        sentiment.vote(a, "BTC", 1)
        sentiment.vote(b, "BTC", -1)
        data = account.export_data(a)
        self.assertEqual([(v["symbol"], v["value"]) for v in data["assetVotes"]], [("BTC", 1)])
        account.delete_account(a)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM asset_votes WHERE user_id = ?", a), 0)
        out = sentiment.get("BTC", None)
        self.assertEqual((out["bullish"], out["bearish"]), (0, 1))  # los de otras personas siguen


if __name__ == "__main__":
    unittest.main()
