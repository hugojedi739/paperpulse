"""Tests de la comunidad: perfiles, clasificación, foro, votos, operaciones compartidas, seguidores y moderación."""
import os
import sys
import tempfile
import time
import unittest
from contextlib import closing
from unittest import mock

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import db, http, security, settings  # noqa: E402
from backend.community import api as community_api, common, forum, moderation, profiles, ranking, text  # noqa: E402
from backend.community.common import CommunityError, Conflict, Forbidden, NotFound, TooMany  # noqa: E402
from backend.trading import ledger, prices  # noqa: E402
from test_trading import ENV, FakeMarket, P  # noqa: E402

from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

DAY = 86400
XSS = '<script>alert("x")</script><img src=x onerror=alert(1)> https://evil.example/?a=<b>'


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db.USE_TURSO = False
        db.DB_PATH = os.path.join(self.tmp.name, "test.db")
        db.init_db()
        for store in (http._LIMITS, security.IP_COMMUNITY_CALLS, security.USER_COMMUNITY_CALLS,
                      security.IP_TRADING_CALLS, security.USER_TRADING_CALLS, ledger._last_resolve):
            store.clear()
        ranking._state["computed_at"] = 0
        self.env = mock.patch.dict(os.environ, {**ENV, "COMMUNITY_MIN_TRADES": "1"})
        self.env.start()
        settings._cache["time"] = 0
        self.market = FakeMarket()
        self.patches = self.market.patch() + [
            mock.patch.object(prices, "valuation_prices", side_effect=lambda syms: {s: (self.market.last[s], E8_FX[s]) for s in syms if self.market.last.get(s)}),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.env.stop()
        settings._cache["time"] = 0
        self.tmp.cleanup()

    # ---- utilidades
    def user(self, alias, private=False, days_old=3, admin=False):
        """Usuario con perfil. Por defecto con 3 días de antigüedad (sin las cuotas de cuenta nueva)."""
        uid = db.create_user(f"{alias.lower()}@example.com", "secreto123", alias)["id"]
        with closing(db.connect()) as conn:
            conn.execute("UPDATE users SET created_at = ?, role = ? WHERE id = ?", (int(time.time()) - days_old * DAY, "admin" if admin else "user", uid))
        profiles.save_mine(uid, {"alias": alias, "bio": f"Hola, soy {alias}", "isPrivate": private})
        return uid

    def buy(self, uid, coid, symbol="BTC", qty="1"):
        order, _ = ledger.place_order(uid, {"clientOrderId": coid, "symbol": symbol, "side": "buy", "type": "market", "quantity": qty})
        return self.fill_id(order["id"])

    def sell(self, uid, coid, symbol="BTC", qty="1"):
        order, _ = ledger.place_order(uid, {"clientOrderId": coid, "symbol": symbol, "side": "sell", "type": "market", "quantity": qty})
        return self.fill_id(order["id"])

    def fill_id(self, order_id):
        with closing(db.connect()) as conn:
            return conn.execute("SELECT id FROM fills WHERE order_id = ?", (order_id,)).fetchone()[0]

    def thread(self, uid, title="Mi estrategia de medias", body="Cruce de la media de 50 y 200.", cat="estrategias"):
        return forum.create_thread(uid, cat, title, body)["threadId"]

    def client(self, uid=None):
        app = Starlette(routes=community_api.routes)
        c = TestClient(app, base_url="http://testserver")
        if uid:
            c.cookies.set(http.COOKIE, db.create_session(uid))
        self.addCleanup(c.close)
        return c

    def scalar(self, sql, *args):
        with closing(db.connect()) as conn:
            return conn.execute(sql, args).fetchone()[0]


E8_FX = {"BTC": 10**8, "ETH": 10**8, "AAPL": 10**8, "SAN": 110_000_000}


class ProfileTest(Base):
    def test_alias_unico_sin_distinguir_mayusculas(self):
        self.user("Ana_1")
        otro = db.create_user("otra@example.com", "secreto123", "Otra")["id"]
        with self.assertRaisesRegex(Conflict, "en uso"):
            profiles.save_mine(otro, {"alias": "ana_1"})

    def test_formato_y_reservados(self):
        uid = db.create_user("x@example.com", "secreto123", "X")["id"]
        for bad in ("ab", "a" * 21, "con espacio", "eñe", "a-b", "<b>x</b>", "admin", "Moderador", "", None, 123):
            with self.assertRaises(CommunityError, msg=repr(bad)):
                profiles.save_mine(uid, {"alias": bad})
        with self.assertRaisesRegex(CommunityError, "bio"):
            profiles.save_mine(uid, {"alias": "valido_1", "bio": "x" * 281})

    def test_perfil_publico_sin_email(self):
        uid = self.user("Luis")
        self.buy(uid, "compra-0001")
        r = self.client().get("/api/community/profiles/Luis")
        data = r.json()
        self.assertEqual((data["alias"], data["trades"]), ("Luis", 1))
        self.assertNotIn("@", r.text)
        self.assertNotIn("email", r.text)
        self.assertNotIn("userId", r.text)

    def test_perfil_privado(self):
        self.user("Secreta", private=True)
        fan = self.user("Fan")
        r = self.client(fan).get("/api/community/profiles/Secreta").json()
        self.assertEqual(r, {"alias": "Secreta", "isPrivate": True})  # nada más
        self.assertEqual(self.client().get("/api/community/profiles?q=Sec").json()["profiles"], [])
        with self.assertRaises(Forbidden):
            profiles.follow(fan, "Secreta", True)

    def test_busqueda_trata_comodines_como_texto(self):
        self.user("a_b_c")
        self.user("axbxc")
        found = [p["alias"] for p in profiles.search("a_b", 10)["profiles"]]
        self.assertEqual(found, ["a_b_c"])  # «_» no es comodín de LIKE
        self.assertEqual(profiles.search("%", 10)["profiles"], [])


class LeaderboardTest(Base):
    def test_rentabilidad_con_posicion_abierta_a_precio_actual(self):
        ana, luis = self.user("Ana"), self.user("Luis")
        self.buy(ana, "ana-0001", qty="10")  # 1.000 USD + 1 USD de comisión
        self.buy(luis, "luis-0001", qty="10")
        self.market.last["BTC"] = P(110)  # +10 % sin vender: cuenta la posición abierta
        self.sell(luis, "luis-0002", qty="10")
        lb = ranking.leaderboard("total", 50, 0)["entries"]
        by = {e["alias"]: e for e in lb}
        # Ana: 9.000 - 1 (comisión) de efectivo + 10 × 110 = 10.099 -> +0,99 %
        self.assertEqual(by["Ana"]["returnPct"], 0.99)
        # Luis: vendió a 110 con comisión de 1,10: 10.000 - 1 - 1,10 + 100 = 10.097,90 -> +0,97 % (redondeo a la baja)
        self.assertEqual(by["Luis"]["returnPct"], 0.97)
        self.assertEqual([e["alias"] for e in lb], ["Ana", "Luis"])

    def test_privados_suspendidos_y_minimo_de_operaciones_fuera(self):
        pub, priv, susp, poco = self.user("Publico"), self.user("Privado", private=True), self.user("Suspendido"), self.user("Poco")
        admin = self.user("Jefa", admin=True)
        for uid, name in ((pub, "pub"), (priv, "priv"), (susp, "susp")):
            self.buy(uid, f"{name}-0001")
            self.buy(uid, f"{name}-0002")
        self.buy(poco, "poco-0001")
        moderation.suspend(admin, susp, 7, "Spam")
        with mock.patch.dict(os.environ, {"COMMUNITY_MIN_TRADES": "2"}):
            settings._cache["time"] = 0
            aliases = [e["alias"] for e in ranking.leaderboard("total", 50, 0)["entries"]]
        self.assertEqual(aliases, ["Publico"])
        # Hacerse privado tiene efecto al momento, sin esperar al recálculo
        profiles.save_mine(pub, {"alias": "Publico", "isPrivate": True})
        self.assertNotIn("Publico", [e["alias"] for e in ranking.leaderboard("total", 50, 0)["entries"]])

    def test_siete_dias_usa_la_instantanea(self):
        ana = self.user("Ana")
        self.buy(ana, "ana-0001", qty="10")
        now = int(time.time())
        with closing(db.connect()) as conn:
            conn.execute("UPDATE accounts SET created_at = ? WHERE user_id = ?", (now - 20 * DAY, ana))
            conn.execute("INSERT INTO equity_snapshots VALUES (?, ?, ?, ?)", (ana, ranking.day_of(now - 7 * DAY), 900_000, now))
        ranking.compute(now)
        e = ranking.leaderboard("7d", 50, 0)["entries"][0]
        # Patrimonio actual 999.900 céntimos frente a 900.000 hace 7 días -> +11,1 %
        self.assertEqual(e["returnPct"], 11.1)
        self.assertFalse(e["approximate"])

    def test_sin_precio_se_valora_a_coste_y_se_marca(self):
        ana = self.user("Ana")
        self.buy(ana, "ana-0001", qty="10")
        self.market.last["BTC"] = None  # el proveedor no da precio
        e = ranking.leaderboard("total", 50, 0)["entries"][0]
        self.assertTrue(e["approximate"])
        self.assertEqual(e["returnPct"], 0.0)


class ForumTest(Base):
    def test_categorias_e_hilos_de_activo(self):
        cats = {c["slug"]: c for c in forum.categories()["categories"]}
        self.assertTrue({"estrategias", "novatos", "analisis-tecnico", "noticias", "operaciones", "activos"} <= set(cats))
        self.assertEqual(cats["activos"]["threads"], len(prices.ASSETS))
        uid = self.user("Ana")
        tid = forum.asset_thread("btc")["threadId"]
        forum.reply(uid, tid, "¿Alguien más ve soporte en 60k?")
        with self.assertRaisesRegex(CommunityError, "no se pueden abrir"):
            forum.create_thread(uid, "activos", "Un hilo nuevo", "texto")

    def test_html_y_script_se_guardan_como_texto(self):
        uid = self.user("Ana")
        r = self.client(uid).post("/api/forum/threads", json={"category": "novatos", "title": "<b>Título</b> con <i>html</i>", "body": XSS})
        self.assertEqual(r.status_code, 200, r.text)
        tid = r.json()["threadId"]
        page = self.client().get(f"/api/forum/threads/{tid}")
        self.assertTrue(page.headers["content-type"].startswith("application/json"))
        data = page.json()
        self.assertEqual(data["firstPost"]["body"], XSS)  # idéntico: ni escapado ni recortado ni «limpiado»
        self.assertEqual(data["thread"]["title"], "<b>Título</b> con <i>html</i>")
        self.assertNotIn("&lt;", page.text)

    def test_caracteres_de_control_y_marcas_de_direccion_fuera(self):
        self.assertEqual(text.clean("hola‮adios\x00\x07 👨‍👩", "body"), "holaadios 👨‍👩")

    def test_limites_de_longitud(self):
        uid = self.user("Ana")
        c = self.client(uid)
        cases = [
            ("/api/forum/threads", {"category": "novatos", "title": "x" * 121, "body": "ok"}, "título"),
            ("/api/forum/threads", {"category": "novatos", "title": "Hola", "body": "ok"}, "corto"),
            ("/api/forum/threads", {"category": "novatos", "title": "Título válido", "body": "x" * 5001}, "largo"),
            ("/api/forum/threads", {"category": "novatos", "title": "Título válido", "body": "   \n  "}, "vacío"),
            ("/api/forum/threads", {"category": "novatos", "title": "Título válido", "body": ["no", "texto"]}, "texto"),
        ]
        for url, body, msg in cases:
            r = c.post(url, json=body)
            self.assertEqual(r.status_code, 400, (body, r.text))
            self.assertIn(msg, r.json()["error"])
        self.assertEqual(c.put("/api/community/me", json={"alias": "Ana", "bio": "b" * 281}).status_code, 400)
        c = self.client(self.user("Beto"))  # otro usuario: Ana ya ha gastado su cupo de publicaciones por minuto
        r = c.post("/api/forum/threads", content=b'{"body": "' + b"x" * 20000 + b'"}', headers={"Content-Type": "application/json"})
        self.assertEqual(r.status_code, 413)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM posts"), 0)

    def test_votos_uno_por_usuario_cambiar_y_quitar(self):
        autor, a, b = self.user("Autor"), self.user("Votante1"), self.user("Votante2")
        tid = self.thread(autor)
        pid = self.scalar("SELECT first_post_id FROM threads WHERE id = ?", tid)
        self.assertEqual(forum.vote(a, pid, 1)["score"], 1)
        self.assertEqual(forum.vote(a, pid, 1)["score"], 1)  # repetir no suma dos veces
        self.assertEqual(forum.vote(b, pid, 1)["score"], 2)
        self.assertEqual(forum.vote(a, pid, -1)["score"], 0)  # cambiar: de +1 a -1
        self.assertEqual(forum.vote(a, pid, 0)["score"], 1)  # quitar
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM votes WHERE post_id = ?", pid), 1)
        with self.assertRaises(Forbidden):
            forum.vote(autor, pid, 1)
        for bad in (2, "1", True, None):
            with self.assertRaises(CommunityError):
                forum.vote(a, pid, bad)

    def test_orden_y_paginacion(self):
        ana, beto, fan = self.user("Ana"), self.user("Beto"), self.user("Fan")  # 23 hilos: más que el cupo diario de una persona
        ids = [self.thread(ana if i % 2 else beto, title=f"Hilo número {i:02d}", body=f"Cuerpo {i}") for i in range(23)]
        forum.vote(fan, self.scalar("SELECT first_post_id FROM threads WHERE id = ?", ids[3]), 1)
        top = forum.list_threads("estrategias", "top", 1, None)
        self.assertEqual(top["threads"][0]["id"], ids[3])
        self.assertTrue(top["hasMore"])
        self.assertEqual(len(top["threads"]), forum.PAGE)
        page2 = forum.list_threads("estrategias", "top", 2, None)
        self.assertEqual(len(page2["threads"]), 3)
        self.assertFalse(page2["hasMore"])
        all_ids = {t["id"] for t in top["threads"]} | {t["id"] for t in page2["threads"]}
        self.assertEqual(all_ids, set(ids))
        with closing(db.connect()) as conn:
            conn.execute("UPDATE threads SET last_post_at = last_post_at + 100 WHERE id = ?", (ids[0],))
        self.assertEqual(forum.list_threads("estrategias", "recent", 1, None)["threads"][0]["id"], ids[0])

    def test_mensaje_duplicado(self):
        uid = self.user("Ana")
        tid = self.thread(uid)
        forum.reply(uid, tid, "Totalmente de acuerdo")
        with self.assertRaisesRegex(Conflict, "mismo mensaje"):
            forum.reply(uid, tid, "Totalmente de acuerdo")

    def test_sin_perfil_no_se_participa(self):
        uid = db.create_user("sinperfil@example.com", "secreto123", "Sin")["id"]
        with self.assertRaisesRegex(Forbidden, "perfil"):
            forum.create_thread(uid, "novatos", "Mi primera duda", "¿Cómo empiezo?")


class ShareTest(Base):
    def test_compartir_operacion_propia_con_datos_del_servidor(self):
        uid = self.user("Ana")
        self.buy(uid, "ana-0001", qty="2")
        self.market.last["BTC"] = P(120)
        fid = self.sell(uid, "ana-0002", qty="2")
        # El cliente intenta inventarse precio y resultado: se ignoran
        r = self.client(uid).post("/api/forum/share", json={"fillId": fid, "comment": "Salí en la resistencia", "price": 1, "pnlPct": 900})
        self.assertEqual(r.status_code, 200, r.text)
        t = forum.get_thread(r.json()["threadId"], "top", 1, None, False)
        trade = t["thread"]["trade"]
        self.assertEqual((trade["symbol"], trade["side"], trade["price"]), ("BTC", "sell", 120))
        self.assertEqual(trade["pnlPct"], 19.76)  # (240 - 0,24 - 200,20) / 200,20
        self.assertEqual(t["thread"]["title"], "Venta de BTC a 120,00 USDT (+19,76 %)")
        self.assertEqual(t["firstPost"]["body"], "Salí en la resistencia")
        self.assertEqual(t["thread"]["category"]["slug"], "operaciones")

    def test_no_se_comparten_operaciones_ajenas_ni_inventadas(self):
        ana, luis = self.user("Ana"), self.user("Luis")
        fid_luis = self.buy(luis, "luis-0001")
        for fid in (fid_luis, 99999, "1", None, True):
            with self.assertRaises(CommunityError, msg=repr(fid)):
                forum.share_fill(ana, fid, "Mira qué operación")
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM threads WHERE fill_id IS NOT NULL"), 0)

    def test_el_id_de_la_ejecucion_llega_al_cliente(self):
        uid = self.user("Ana")
        order, _ = ledger.place_order(uid, {"clientOrderId": "ana-0001", "symbol": "BTC", "side": "buy", "type": "market", "quantity": "1"})
        self.assertEqual(order["fill"]["id"], self.fill_id(order["id"]))
        self.assertEqual(forum.share_fill(uid, order["fill"]["id"], "Entrada")["threadId"] > 0, True)

    def test_cada_operacion_una_vez(self):
        uid = self.user("Ana")
        fid = self.buy(uid, "ana-0001")
        forum.share_fill(uid, fid, "")
        with self.assertRaisesRegex(Conflict, "Ya has compartido"):
            forum.share_fill(uid, fid, "otra vez")


class FollowFeedTest(Base):
    def test_feed_de_seguidos(self):
        ana, luis, eva = self.user("Ana"), self.user("Luis"), self.user("Eva")
        profiles.follow(ana, "Luis", True)
        profiles.follow(ana, "Luis", True)  # idempotente
        tid = self.thread(luis)
        forum.reply(eva, tid, "No me sale en el feed porque no la sigo")
        forum.share_fill(luis, self.buy(luis, "luis-0001"), "Entrada en BTC")
        items = profiles.feed(ana, None, 20)["items"]
        self.assertEqual([i["author"] for i in items], ["Luis", "Luis"])
        self.assertEqual(items[0]["trade"]["symbol"], "BTC")
        self.assertEqual(profiles.public("Luis", ana)["followers"], 1)
        profiles.follow(ana, "Luis", False)
        self.assertEqual(profiles.feed(ana, None, 20)["items"], [])
        with self.assertRaises(CommunityError):
            profiles.follow(ana, "Ana", True)


class ModerationTest(Base):
    def setUp(self):
        super().setUp()
        self.admin, self.autor, self.otro = self.user("Jefa", admin=True), self.user("Autor"), self.user("Otro")
        self.tid = self.thread(self.autor)
        self.pid = forum.reply(self.autor, self.tid, "Compra ya esta moneda, es seguro x100")["postId"]

    def test_suspendido_no_publica_vota_sigue_ni_denuncia(self):
        moderation.suspend(self.admin, self.otro, 3, "Spam repetido")
        actions = [
            lambda: forum.create_thread(self.otro, "novatos", "Un hilo nuevo", "texto"),
            lambda: forum.reply(self.otro, self.tid, "respuesta"),
            lambda: forum.vote(self.otro, self.pid, 1),
            lambda: profiles.follow(self.otro, "Autor", True),
            lambda: forum.report(self.otro, self.pid, "spam", ""),
            lambda: forum.share_fill(self.otro, self.buy(self.otro, "otro-0001"), "x"),
        ]
        for act in actions:
            with self.assertRaisesRegex(Forbidden, "suspendida"):
                act()
        self.assertIsNotNone(forum.get_thread(self.tid, "top", 1, self.otro, False))  # leer sí puede
        moderation.unsuspend(self.admin, self.otro, "Revisado")
        forum.vote(self.otro, self.pid, 1)
        with self.assertRaises(Forbidden):
            moderation.suspend(self.otro, self.admin, 1, "x")  # no se suspende a un admin (ni lo hace un no admin por API)

    def test_denunciar_ocultar_y_restaurar(self):
        forum.report(self.otro, self.pid, "estafa", "Promete beneficios garantizados")
        with self.assertRaises(Conflict):
            forum.report(self.otro, self.pid, "spam", "")  # una denuncia por usuario y mensaje
        items = moderation.list_reports("open", 25, 0)["items"]
        self.assertEqual((items[0]["postId"], items[0]["count"]), (self.pid, 1))
        moderation.hide_post(self.admin, self.pid, "Estafa")
        reply = forum.get_thread(self.tid, "top", 1, self.otro, False)["replies"][0]
        self.assertEqual((reply["body"], reply["status"]), (None, "hidden"))
        self.assertIn("moderación", reply["notice"])
        as_admin = forum.get_thread(self.tid, "top", 1, self.admin, True)["replies"][0]
        self.assertEqual(as_admin["body"], "Compra ya esta moneda, es seguro x100")  # el admin lo ve para revisarlo
        self.assertEqual(moderation.list_reports("open", 25, 0)["items"], [])  # ocultar resuelve las denuncias
        with self.assertRaises(Conflict):
            forum.vote(self.otro, self.pid, 1)
        moderation.restore_post(self.admin, self.pid, "Era una broma")
        self.assertEqual(forum.get_thread(self.tid, "top", 1, None, False)["replies"][0]["status"], "visible")
        actions = [i["action"] for i in moderation.moderation_log(50, None)["items"]]
        self.assertEqual(actions, ["restore_post", "hide_post"])

    def test_la_denuncia_conserva_el_texto_aunque_el_autor_lo_borre(self):
        forum.report(self.otro, self.pid, "estafa", "Promete beneficios")
        forum.delete_own(self.autor, self.pid)
        profiles.save_mine(self.autor, {"alias": "OtroNombre"})  # cambiar de alias tampoco borra el rastro
        item = moderation.list_reports("open", 25, 0)["items"][0]
        self.assertEqual(item["postStatus"], "deleted")
        self.assertIsNone(item["body"])  # el mensaje actual ya no tiene texto visible...
        self.assertEqual(item["reportedBody"], "Compra ya esta moneda, es seguro x100")  # ...pero la copia sí
        self.assertEqual(item["reportedAuthor"], "Autor")
        self.assertEqual(item["author"]["alias"], "OtroNombre")
        # El público sigue sin ver el texto borrado
        self.assertIsNone(forum.get_thread(self.tid, "top", 1, self.otro, False)["replies"][0]["body"])

    def test_ocultar_el_primer_mensaje_retira_el_hilo(self):
        first = self.scalar("SELECT first_post_id FROM threads WHERE id = ?", self.tid)
        moderation.hide_post(self.admin, first, "Fuera de tema")
        self.assertNotIn(self.tid, [t["id"] for t in forum.list_threads("estrategias", "recent", 1, None)["threads"]])
        with self.assertRaises(NotFound):
            forum.get_thread(self.tid, "top", 1, self.otro, False)
        forum.get_thread(self.tid, "top", 1, self.admin, True)

    def test_el_autor_borra_lo_suyo_y_solo_lo_suyo(self):
        with self.assertRaises(NotFound):
            forum.delete_own(self.otro, self.pid)
        forum.delete_own(self.autor, self.pid)
        reply = forum.get_thread(self.tid, "top", 1, self.admin, True)["replies"][0]
        self.assertEqual((reply["body"], reply["status"]), (None, "deleted"))  # ni el admin ve lo que el autor borró
        with self.assertRaises(Conflict):
            moderation.restore_post(self.admin, self.pid, "")
        self.assertEqual(moderation.moderation_log(50, None)["items"][0]["action"], "author_delete")
        first = self.scalar("SELECT first_post_id FROM threads WHERE id = ?", self.tid)
        forum.delete_own(self.autor, first)
        with self.assertRaises(Conflict):
            forum.reply(self.otro, self.tid, "¿Sigue abierto?")

    def test_endpoints_de_moderacion_solo_para_admins(self):
        app = Starlette(routes=community_api.routes)
        for uid, expected in ((self.otro, 403), (self.admin, 200)):
            with TestClient(app) as c:
                c.cookies.set(http.COOKIE, db.create_session(uid))
                self.assertEqual(c.get("/api/admin/reports").status_code, expected)
                self.assertEqual(c.post(f"/api/admin/posts/{self.pid}/hide", json={"reason": "x"}).status_code, expected)
                self.assertEqual(c.post(f"/api/admin/users/{self.autor}/suspend", json={"days": 1, "reason": "x"}).status_code, expected)
        with TestClient(app) as c:
            c.cookies.set(http.COOKIE, db.create_session(self.admin))
            self.assertEqual(c.post(f"/api/admin/posts/{self.pid}/borrar-todo", json={}).status_code, 404)

    def test_borrar_la_cuenta_borra_su_contenido(self):
        forum.vote(self.otro, self.pid, 1)
        profiles.follow(self.otro, "Autor", True)
        db.delete_user(self.autor)
        for table, col in (("profiles", "user_id"), ("threads", "author_id"), ("posts", "author_id"), ("follows", "followee_id")):
            self.assertEqual(self.scalar(f"SELECT COUNT(*) FROM {table} WHERE {col} = ?", self.autor), 0, table)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM votes"), 0)


class LimitsTest(Base):
    def test_limite_por_minuto_al_publicar(self):
        uid = self.user("Ana")
        tid = self.thread(uid)
        c = self.client(uid)
        codes = [c.post(f"/api/forum/threads/{tid}/posts", json={"body": f"Respuesta {i}"}).status_code
                 for i in range(community_api.LIMITS["post"]["user"] + 1)]
        self.assertEqual(codes[-1], 429)
        self.assertNotIn(429, codes[:-1])
        self.assertEqual(c.get(f"/api/forum/threads/{tid}").status_code, 200)  # leer tiene su propio cupo

    def test_cuentas_nuevas_tienen_cupo_diario_menor(self):
        nueva, veterana = self.user("Nueva", days_old=0), self.user("Veterana", days_old=30)
        tid = forum.asset_thread("BTC")["threadId"]
        for i in range(common.QUOTAS["new"]["posts"]):
            forum.reply(nueva, tid, f"Mensaje {i}")
        with self.assertRaisesRegex(TooMany, "cuentas nuevas"):
            forum.reply(nueva, tid, "Uno más")
        for i in range(common.QUOTAS["new"]["posts"] + 1):
            forum.reply(veterana, tid, f"Mensaje {i}")  # la veterana sí puede
        nueva2 = self.user("Nueva2", days_old=0)
        for i in range(common.QUOTAS["new"]["threads"]):
            self.thread(nueva2, title=f"Hilo nuevo {i}", body=f"Texto {i}")
        with self.assertRaisesRegex(TooMany, "hilos"):
            self.thread(nueva2, title="Uno de más", body="Texto extra")

    def test_borrar_no_devuelve_cupo(self):
        nueva = self.user("Nueva", days_old=0)
        tid = forum.asset_thread("ETH")["threadId"]
        for i in range(common.QUOTAS["new"]["posts"]):
            forum.delete_own(nueva, forum.reply(nueva, tid, f"Mensaje {i}")["postId"])
        with self.assertRaises(TooMany):
            forum.reply(nueva, tid, "Otro")


class PrivacyTest(Base):
    def test_ninguna_respuesta_publica_contiene_emails(self):
        ana, luis = self.user("Ana"), self.user("Luis", private=True)
        tid = self.thread(ana)
        forum.reply(luis, tid, "Respuesta de una cuenta privada")
        forum.share_fill(ana, self.buy(ana, "ana-0001"), "Compra")
        profiles.follow(luis, "Ana", True)
        c = self.client(luis)
        urls = ["/api/community/me", "/api/community/profiles?q=", "/api/community/profiles/Ana", "/api/community/profiles/Luis",
                "/api/community/following", "/api/community/feed", "/api/community/leaderboard",
                "/api/forum/categories", "/api/forum/categories/estrategias", "/api/forum/categories/operaciones", f"/api/forum/threads/{tid}"]
        for url in urls:
            r = c.get(url)
            self.assertEqual(r.status_code, 200, (url, r.text))
            self.assertNotIn("@example.com", r.text, url)
            self.assertNotIn('"email"', r.text, url)
            self.assertNotIn("cashCents", r.text, url)


if __name__ == "__main__":
    unittest.main()
