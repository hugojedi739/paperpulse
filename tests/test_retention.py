"""Tests de retención: notificaciones, logros, racha (hora de Madrid), onboarding, retos mensuales y cron."""
import datetime
import os
import sys
import time
import unittest
from contextlib import closing
from unittest import mock

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import db, http  # noqa: E402
from backend.community import api as community_api, forum, moderation, profiles, ranking  # noqa: E402
from backend.retention import achievements, api as retention_api, challenges, notifications, onboarding, streak  # noqa: E402
from backend.trading import api as trading_api, ledger  # noqa: E402
from test_community import Base as CommunityBase  # noqa: E402
from test_trading import T0, P  # noqa: E402

from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

DAY = 86400


class Base(CommunityBase):
    def client(self, uid=None):
        app = Starlette(routes=community_api.routes + trading_api.routes + retention_api.routes)
        c = TestClient(app, base_url="http://testserver")
        if uid:
            c.cookies.set(http.COOKIE, db.create_session(uid))
        self.addCleanup(c.close)
        return c

    def notes(self, uid):
        return notifications.list_for(uid)["items"]

    def kinds(self, uid):
        return sorted(n["kind"] for n in self.notes(uid))


class NotificationsTest(Base):
    def test_respuesta_seguidor_y_ocultacion_avisan_a_la_persona_correcta(self):
        autor, otro, admin = self.user("Autor"), self.user("Otro"), self.user("Jefa", admin=True)
        tid = self.thread(autor)
        forum.reply(autor, tid, "Respondo en mi propio hilo")  # no se avisa a uno mismo
        self.assertEqual(self.kinds(autor), ["achievement"])  # solo el logro «Voz propia»
        pid = forum.reply(otro, tid, "Buen enfoque")["postId"]
        self.assertIn("reply", self.kinds(autor))
        self.assertEqual(self.kinds(otro), [])
        profiles.follow(otro, "Autor", True)
        profiles.follow(otro, "Autor", True)  # repetir no duplica el aviso
        self.assertEqual(self.kinds(autor).count("follower"), 1)
        moderation.hide_post(admin, pid, "Sin aportar")
        self.assertEqual(self.kinds(otro), ["hidden"])
        self.assertEqual(self.kinds(admin), [])

    def test_orden_limite_ejecutada_con_velas_notifica_y_la_inmediata_no(self):
        uid = self.user("Ana")
        self.buy(uid, "ana-0001")  # a mercado: el usuario ya lo ve en pantalla
        self.assertNotIn("order", self.kinds(uid))
        ledger.place_order(uid, {"clientOrderId": "ana-lim-001", "symbol": "BTC", "side": "buy", "type": "limit", "quantity": "1", "triggerPrice": "90"}, now=T0)
        self.market.bar("BTC", "1m", T0 + 60, 99, 99, 89.5)
        ledger.resolve(uid, now=T0 + 300, force=True)
        order = [n for n in self.notes(uid) if n["kind"] == "order"]
        self.assertEqual(len(order), 1)
        self.assertIn("límite ejecutada", order[0]["title"])
        self.assertEqual(order[0]["link"], "/trade/BTC")

    def test_alerta_de_precio_valida_y_sin_html(self):
        uid = self.user("Ana")
        c = self.client(uid)
        self.assertEqual(c.post("/api/notifications/alert", json={"symbol": "btc", "condition": "above", "target": 80000}).status_code, 200)
        for bad in ({"symbol": "<script>", "condition": "above", "target": 1}, {"symbol": "BTC", "condition": "x", "target": 1},
                    {"symbol": "BTC", "condition": "above", "target": "1"}, {"symbol": "BTC", "condition": "above", "target": -5}):
            self.assertEqual(c.post("/api/notifications/alert", json=bad).status_code, 400, bad)
        n = [x for x in self.notes(uid) if x["kind"] == "alert"]
        self.assertEqual(len(n), 1)
        self.assertIn("80000", n[0]["body"])

    def test_nadie_ve_ni_modifica_notificaciones_ajenas(self):
        ana, luis = self.user("Ana"), self.user("Luis")
        with db.transaction() as conn:
            notifications.notify(conn, ana, "reply", "Para Ana", "texto", "/community/forum")
        nid = self.notes(ana)[0]["id"]
        c = self.client(luis)
        self.assertEqual(c.get("/api/notifications").json()["items"], [])
        self.assertEqual(c.post("/api/notifications/read", json={"ids": [nid]}).json()["unread"], 0)
        self.assertEqual(c.delete(f"/api/notifications/{nid}").status_code, 200)
        self.assertEqual(c.post("/api/notifications/clear", json={"all": True}).status_code, 200)
        self.assertEqual(len(self.notes(ana)), 1)  # intacta y sigue sin leer
        self.assertEqual(notifications.list_for(ana)["unread"], 1)
        self.assertEqual(self.client().get("/api/notifications").status_code, 401)

    def test_leer_borrar_paginar_y_limites(self):
        uid = self.user("Ana")
        with db.transaction() as conn:
            for i in range(25):
                notifications.notify(conn, uid, "reply", f"Aviso {i}", "x" * 500, "https://evil.example")
        page1 = notifications.list_for(uid, limit=20)
        self.assertEqual((len(page1["items"]), page1["hasMore"], page1["unread"]), (20, True, 25))
        self.assertEqual(len(page1["items"][0]["body"]), 300)  # texto acotado
        self.assertEqual(page1["items"][0]["link"], "")  # solo enlaces internos
        page2 = notifications.list_for(uid, before=page1["items"][-1]["id"], limit=20)
        self.assertEqual((len(page2["items"]), page2["hasMore"]), (5, False))
        c = self.client(uid)
        self.assertEqual(c.post("/api/notifications/read", json={"ids": [page1["items"][0]["id"]]}).json()["unread"], 24)
        self.assertEqual(c.post("/api/notifications/read", json={"all": True}).json()["unread"], 0)
        self.assertEqual(c.post("/api/notifications/read", json={"ids": "no"}).status_code, 400)
        self.assertEqual(c.delete(f"/api/notifications/{page1['items'][0]['id']}").json()["unread"], 0)
        self.assertEqual(len(notifications.list_for(uid, limit=50)["items"]), 24)
        with db.transaction() as conn:
            for i in range(250):
                notifications.notify(conn, uid, "reply", f"Más {i}")
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM notifications WHERE user_id = ?", uid), notifications.MAX_PER_USER)

    def test_se_borran_a_los_60_dias(self):
        uid = self.user("Ana")
        with db.transaction() as conn:
            notifications.notify(conn, uid, "reply", "Vieja")
            notifications.notify(conn, uid, "reply", "Reciente")
            conn.execute("UPDATE notifications SET created_at = ? WHERE title = 'Vieja'", (int(time.time()) - 61 * DAY,))
        self.assertEqual(notifications.cleanup(), 1)
        self.assertEqual([n["title"] for n in self.notes(uid)], ["Reciente"])

    def test_si_la_transaccion_se_deshace_la_notificacion_tambien(self):
        uid = self.user("Ana")
        with self.assertRaises(RuntimeError), db.transaction() as conn:
            notifications.notify(conn, uid, "reply", "No debe quedar")
            raise RuntimeError("fallo")
        self.assertEqual(self.notes(uid), [])


class AchievementsTest(Base):
    def test_logros_de_operar_foro_y_seguidores_son_idempotentes(self):
        uid, fan = self.user("Ana"), self.user("Fan")
        self.buy(uid, "ana-0001", qty="2")
        self.assertEqual({a["code"] for a in self.earned(uid)}, {"first_trade"})
        ledger.place_order(uid, {"clientOrderId": "ana-stop-01", "symbol": "BTC", "side": "sell", "type": "stop", "quantity": "1", "triggerPrice": "50"})
        self.market.last["BTC"] = P(120)
        self.sell(uid, "ana-0002")
        self.thread(uid)
        profiles.follow(fan, "Ana", True)
        self.assertEqual({a["code"] for a in self.earned(uid)}, {"first_trade", "first_stop", "first_win", "first_thread", "first_follower"})
        before = len(self.notes(uid))
        with db.transaction() as conn:
            achievements.evaluate(conn, uid)
            self.assertFalse(achievements.grant(conn, uid, "first_trade"))
        self.assertEqual(len(self.notes(uid)), before)  # ni logros repetidos ni avisos repetidos
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM achievements WHERE user_id = ?", uid), 5)
        public = profiles.public("Ana", None)
        self.assertEqual({a["code"] for a in public["achievements"]}, {"first_trade", "first_stop", "first_win", "first_thread", "first_follower"})
        self.assertNotIn("@", str(public))

    def earned(self, uid):
        with closing(db.connect()) as conn:
            return achievements.earned(conn, uid)

    def test_diez_operaciones_y_perfil_privado_sin_logros_publicos(self):
        uid = self.user("Ana", private=True)
        for i in range(5):
            self.buy(uid, f"ana-b{i}-0001", qty="0.1" if i else "1")
            self.sell(uid, f"ana-s{i}-0001", qty="0.1" if i else "1")
        self.assertIn("ten_trades", {a["code"] for a in self.earned(uid)})
        self.assertNotIn("achievements", profiles.public("Ana", self.user("Otro")))  # perfil privado: nada

    def test_rachas_de_ganadoras_y_resistencia(self):
        self.assertEqual(achievements.longest_win_run([1, 1, -1, 1, 1, 1, 1, 1, -2]), 5)
        self.assertEqual(achievements.longest_win_run([1, 1, 1, 1]), 4)
        self.assertTrue(achievements.survived_drop([100, 105, 94, 90, 106]))  # cae >10 % desde 105 y recupera 105
        self.assertFalse(achievements.survived_drop([100, 105, 94, 90, 100]))  # cae pero no recupera el máximo
        self.assertFalse(achievements.survived_drop([100, 95, 99, 104]))  # nunca cae un 10 %
        self.assertTrue(achievements.survived_drop([100, 80, 120, 115]))  # cae un 20 % y supera el máximo anterior (100)
        uid = self.user("Ana")
        self.buy(uid, "ana-0001", qty="10")
        now = int(time.time())
        with closing(db.connect()) as conn:
            for d, eq in ((10, 1_000_000), (8, 1_100_000), (6, 960_000), (4, 990_000), (2, 1_110_000)):
                conn.execute("INSERT INTO equity_snapshots VALUES (?, ?, ?, ?)", (uid, ranking.day_of(now - d * DAY), eq, now))
        ranking.compute(now)
        self.assertIn("survive_drop", {a["code"] for a in self.earned(uid)})


class StreakTest(Base):
    def test_dias_en_hora_de_madrid_y_racha(self):
        madrid = lambda y, m, d, h=12: int(datetime.datetime(y, m, d, h, tzinfo=streak.MADRID).timestamp())
        # 28/03 23:30 UTC = 29/03 00:30 en Madrid (CET): cuenta como día 29, no 28
        self.assertEqual(streak.day_of(int(datetime.datetime(2026, 3, 28, 23, 30, tzinfo=datetime.timezone.utc).timestamp())), "2026-03-29")
        uid = self.user("Ana")
        with db.transaction() as conn:
            for d in (1, 2, 3, 5, 6):
                streak.record(conn, uid, madrid(2026, 5, d))
            streak.record(conn, uid, madrid(2026, 5, 6, 20))  # mismo día: no suma
            at = madrid(2026, 5, 6, 22)
            self.assertEqual(streak.current(conn, uid, at), {"current": 2, "best": 3})
            self.assertEqual(streak.current(conn, uid, madrid(2026, 5, 7))["current"], 2)  # hoy aún no operó: no pierde la racha
            self.assertEqual(streak.current(conn, uid, madrid(2026, 5, 8))["current"], 0)  # pasó un día entero sin operar
        for d in (7, 8, 9, 10, 11, 12):
            with db.transaction() as conn:
                streak.record(conn, uid, madrid(2026, 5, d))
        with db.transaction() as conn:
            achievements.evaluate(conn, uid)
        self.assertIn("trading_week", {a["code"] for a in AchievementsTest.earned(self, uid)})

    def test_operar_registra_el_dia(self):
        uid = self.user("Ana")
        self.buy(uid, "ana-0001")
        with closing(db.connect()) as conn:
            self.assertEqual(streak.current(conn, uid)["current"], 1)
            self.assertEqual(profiles.public("Ana", None)["streak"], 1)


class OnboardingTest(Base):
    def test_pasos_saltar_y_logro(self):
        uid = self.user("Ana")
        st = onboarding.state(uid)
        self.assertEqual([s["done"] for s in st["steps"]], [False, False, False])
        self.assertTrue(st["visible"])
        self.assertTrue(onboarding.act(uid, "skip")["skipped"])
        self.assertFalse(onboarding.state(uid)["visible"])
        onboarding.act(uid, "reopen")
        self.buy(uid, "ana-0001")
        ledger.place_order(uid, {"clientOrderId": "ana-stop-01", "symbol": "BTC", "side": "sell", "type": "stop", "quantity": "1", "triggerPrice": "50"})
        self.assertEqual([s["done"] for s in onboarding.state(uid)["steps"]], [True, True, False])
        done = onboarding.act(uid, "visit-forum")
        self.assertTrue(done["completed"] and not done["visible"])
        onboarding.state(uid)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM achievements WHERE user_id = ? AND code = 'onboarding_done'", uid), 1)
        with self.assertRaises(ValueError):
            onboarding.act(uid, "hackear")

    def test_resumen_requiere_sesion(self):
        uid = self.user("Ana")
        self.assertEqual(self.client().get("/api/retention/summary").status_code, 401)
        data = self.client(uid).get("/api/retention/summary").json()
        self.assertEqual(set(data), {"streak", "achievements", "onboarding"})
        self.assertEqual(len(data["achievements"]), len(achievements.CATALOG))


class ChallengeTest(Base):
    def place(self, c, coid, side="buy", qty="1", symbol="BTC"):
        return c.post("/api/challenge/orders", json={"clientOrderId": coid, "symbol": symbol, "side": side, "type": "market", "quantity": qty})

    def test_los_meses_son_de_madrid(self):
        m = lambda y, mo, d, h, mi=0: int(datetime.datetime(y, mo, d, h, mi, tzinfo=datetime.timezone.utc).timestamp())
        # 31/05 22:30 UTC = 01/06 00:30 en Madrid (CEST): ya es junio
        self.assertEqual(challenges.month_bounds(m(2026, 5, 31, 22, 30))[0], "2026-06")
        self.assertEqual(challenges.month_bounds(m(2026, 5, 31, 21, 30))[0], "2026-05")
        self.assertEqual(challenges.month_bounds(m(2026, 12, 15, 12))[0], "2026-12")
        slug, start, end = challenges.month_bounds(m(2026, 12, 15, 12))
        self.assertEqual(datetime.datetime.fromtimestamp(end, streak.MADRID).strftime("%Y-%m-%d"), "2027-01-01")

    def test_cuenta_aparte_sin_tocar_la_normal_y_con_clasificacion_propia(self):
        ana, luis = self.user("Ana"), self.user("Luis")
        self.buy(ana, "ana-main-001")  # cuenta normal de Ana
        main_cash = self.scalar("SELECT cash_cents FROM accounts WHERE user_id = ?", ana)
        ca, cl = self.client(ana), self.client(luis)
        self.assertEqual(self.place(ca, "ana-reto-001").status_code, 404)  # sin apuntarse no hay cuenta de reto
        self.assertEqual(ca.post("/api/challenge/join").status_code, 200)
        self.assertEqual(ca.post("/api/challenge/join").status_code, 409)
        cl.post("/api/challenge/join")
        r = self.place(ca, "ana-reto-002", qty="10")
        self.assertEqual(r.status_code, 201, r.text)
        self.place(cl, "luis-reto-01", qty="10")
        self.market.last["BTC"] = P(120)
        self.place(cl, "luis-reto-02", side="sell", qty="10")  # Luis gana en el reto; Ana sigue con la posición
        # La cuenta normal de Ana no cambió, y el reto empezó con el mismo saldo para todos
        self.assertEqual(self.scalar("SELECT cash_cents FROM accounts WHERE user_id = ?", ana), main_cash)
        self.assertEqual(ca.get("/api/portfolio").json()["positions"][0]["quantity"], 1)
        pa, pl = ca.get("/api/challenge/portfolio").json(), cl.get("/api/challenge/portfolio").json()
        self.assertEqual(pa["account"]["initialCents"], pl["account"]["initialCents"])
        self.assertEqual(pa["positions"][0]["quantity"], 10)
        self.assertEqual(pl["positions"], [])
        ranking.compute()
        board = challenges.leaderboard(None, 50, 0)
        # Ana mantiene la posición (se valora a precio de mercado, sin comisión de venta); Luis ya vendió y pagó esa comisión
        self.assertEqual([e["alias"] for e in board["entries"]], ["Ana", "Luis"])
        self.assertTrue(board["entries"][0]["returnPct"] > board["entries"][1]["returnPct"] > 0)
        # Las cuentas de reto no entran en la clasificación principal ni en listados ni en estadísticas
        self.assertEqual([e["alias"] for e in ranking.leaderboard("total", 50, 0)["entries"]], ["Ana"])
        self.assertEqual(db.list_users()["total"], 2)
        self.assertEqual(db.stats()["users"], 2)
        me = challenges.status(luis)
        self.assertTrue(me["joined"] and me["me"]["trades"] == 2)
        self.assertEqual(me["participants"], 2)

    def test_privados_y_ajenos(self):
        ana, luis = self.user("Ana"), self.user("Luis", private=True)
        for uid in (ana, luis):
            self.client(uid).post("/api/challenge/join")
            self.place(self.client(uid), f"u{uid}-reto-0001")
        ranking.compute()
        self.assertEqual([e["alias"] for e in challenges.leaderboard(None, 50, 0)["entries"]], ["Ana"])
        # Una orden del reto de Luis no aparece en la cuenta normal de Ana
        self.assertEqual(self.client(ana).get("/api/orders").json()["orders"], [])
        # Un id de orden del reto de otro no se puede cancelar
        oid = self.client(luis).get("/api/challenge/orders").json()["orders"][0]["id"]
        self.assertEqual(self.client(ana).delete(f"/api/challenge/orders/{oid}").status_code, 404)

    def test_reto_terminado_no_admite_ordenes_y_queda_finalizado(self):
        ana = self.user("Ana")
        self.client(ana).post("/api/challenge/join")
        self.place(self.client(ana), "ana-reto-001")
        slug, start, end = challenges.month_bounds(time.time())
        with self.assertRaises(ledger.NotFound):  # pasado el fin de mes ya es otro reto, y no está apuntado
            challenges.ledger_for(ana, writing=True, at=end + 1)
        self.assertEqual(challenges.ledger_for(ana, writing=False), challenges.ledger_for(ana, writing=True))
        ranking.compute(end + 10)  # tras terminar el mes: se calcula una última vez y se congela
        self.assertEqual(self.scalar("SELECT finalized FROM challenges WHERE slug = ?", slug), 1)
        frozen = self.scalar("SELECT return_bps FROM challenge_scores")
        self.market.last["BTC"] = P(500)
        ranking.compute(end + 20)
        self.assertEqual(self.scalar("SELECT return_bps FROM challenge_scores"), frozen)

    def test_suspendidos_y_sin_perfil_no_se_apuntan(self):
        sin = db.create_user("sinperfil@example.com", "secreto123", "Sin")["id"]
        with self.assertRaises(common_Forbidden):
            challenges.join(sin)
        admin, ana = self.user("Jefa", admin=True), self.user("Ana")
        moderation.suspend(admin, ana, 3, "Spam")
        with self.assertRaises(common_Forbidden):
            challenges.join(ana)

    def test_borrar_la_cuenta_borra_la_cuenta_del_reto(self):
        ana = self.user("Ana")
        self.client(ana).post("/api/challenge/join")
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM users WHERE owner_id = ?", ana), 1)
        with closing(db.connect()) as conn:
            conn.execute("DELETE FROM users WHERE id = ?", (ana,))
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM users WHERE owner_id IS NOT NULL"), 0)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM accounts"), 0)


class CronTest(Base):
    def test_solo_con_clave_y_hace_la_limpieza(self):
        uid = self.user("Ana")
        with db.transaction() as conn:
            notifications.notify(conn, uid, "reply", "Vieja")
            conn.execute("UPDATE notifications SET created_at = 1")
        c = self.client()
        with mock.patch.object(retention_api, "ADMIN_API_KEY", "clave-larga-de-prueba"), mock.patch.dict(os.environ, {"CRON_SECRET": ""}):
            self.assertEqual(c.get("/api/cron/daily").status_code, 401)
            self.assertEqual(c.get("/api/cron/daily", headers={"X-Admin-Key": "otra"}).status_code, 401)
            self.assertEqual(c.get("/api/cron/daily", headers={"Authorization": "Bearer otra"}).status_code, 401)
            r = c.get("/api/cron/daily", headers={"Authorization": "Bearer clave-larga-de-prueba"})  # así llama Vercel Cron
            self.assertEqual((r.status_code, r.json()["notificationsDeleted"]), (200, 1))
            self.assertEqual(c.post("/api/cron/daily", headers={"X-Admin-Key": "clave-larga-de-prueba"}).status_code, 200)
        with mock.patch.object(retention_api, "ADMIN_API_KEY", ""), mock.patch.dict(os.environ, {"CRON_SECRET": ""}):
            self.assertEqual(c.get("/api/cron/daily", headers={"Authorization": "Bearer "}).status_code, 401)  # sin clave configurada: cerrado
        with mock.patch.object(retention_api, "ADMIN_API_KEY", ""), mock.patch.dict(os.environ, {"CRON_SECRET": "secreto-cron"}):
            self.assertEqual(c.get("/api/cron/daily", headers={"Authorization": "Bearer secreto-cron"}).status_code, 200)


from backend.community.common import Forbidden as common_Forbidden  # noqa: E402

if __name__ == "__main__":
    unittest.main()
