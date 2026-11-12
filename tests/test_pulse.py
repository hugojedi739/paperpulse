"""GET /api/community/pulse: top 5 de la semana (solo cuentas de ≥ 500 €), últimos hilos de personas y traders activos."""
import os
import sys
import time
from contextlib import closing
from unittest import mock

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import db  # noqa: E402
from backend.community import api as community_api, forum, moderation, pulse, ranking  # noqa: E402
from backend.trading import ledger  # noqa: E402
from test_community import Base, DAY  # noqa: E402

from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402


class PulseBase(Base):
    def setUp(self):
        super().setUp()
        pulse.reset_cache()
        self.api = TestClient(Starlette(routes=community_api.routes), base_url="http://testserver")
        self.addCleanup(self.api.close)

    def get(self):
        return self.api.get("/api/community/pulse")

    def trader(self, alias, eur=None, **kw):
        """Usuario con cuenta (de `eur` € si se indica, como si la hubiera elegido) y una compra hecha."""
        uid = self.user(alias, **kw)
        if eur is not None:
            ledger.start_account(uid, eur, "EUR")
        self.buy(uid, f"{alias.lower()}-0001")
        return uid

    def row(self, query, *args):
        with closing(db.connect()) as conn:
            r = conn.execute(query, args).fetchone()
            return dict(r) if r else None

    def sql(self, query, *args):
        with closing(db.connect()) as conn:
            conn.execute(query, args)


class EmptyTest(PulseBase):
    def test_comunidad_vacia_no_enseña_nada_ni_ceros(self):
        r = self.get()
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertEqual((d["topWeek"], d["latestThreads"], d["activeTraders7d"], d["empty"]), ([], [], None, True))

    def test_los_hilos_automaticos_por_activo_no_cuentan_como_actividad(self):
        with db.transaction() as conn:
            forum.ensure_asset_threads(conn)
        with closing(db.connect()) as conn:
            self.assertGreater(conn.execute("SELECT COUNT(*) FROM threads WHERE symbol IS NOT NULL").fetchone()[0], 5)
        d = self.get().json()
        self.assertEqual((d["latestThreads"], d["empty"]), ([], True))

    def test_el_contador_solo_no_basta_para_mostrar_la_seccion(self):
        for n in ("Aaa", "Bbb", "Ccc"):
            self.trader(n, eur=100)  # tres traders activos, pero ninguno cumple el mínimo de saldo del top
        d = self.get().json()
        self.assertEqual((d["topWeek"], d["activeTraders7d"], d["empty"]), ([], 3, True))


class ThreadsTest(PulseBase):
    def test_ultimos_tres_con_titulo_y_categoria_mas_recientes_primero(self):
        ana = self.user("Ana")
        ids = []
        for i, cat in enumerate(("estrategias", "novatos", "noticias", "estrategias")):
            ids.append(forum.create_thread(ana, cat, f"Hilo número {i}", f"texto del hilo {i}")["threadId"])
            self.sql("UPDATE threads SET created_at = ? WHERE id = ?", int(time.time()) - (10 - i) * 60, ids[-1])
        d = self.get().json()
        self.assertEqual([t["title"] for t in d["latestThreads"]], ["Hilo número 3", "Hilo número 2", "Hilo número 1"])
        first = d["latestThreads"][0]
        self.assertEqual((first["categorySlug"], first["id"]), ("estrategias", ids[3]))
        self.assertTrue(first["categoryName"])
        self.assertEqual(set(first), {"id", "title", "categorySlug", "categoryName", "createdAt"})  # nada de autor ni texto
        self.assertFalse(d["empty"])

    def test_incluye_las_operaciones_compartidas(self):
        ana = self.user("Ana")
        forum.create_thread(ana, "novatos", "Mi duda del día", "texto")
        shared = forum.share_fill(ana, self.buy(ana, "ana-0001"), "Entrada")
        self.sql("UPDATE threads SET created_at = created_at + 100 WHERE fill_id IS NOT NULL")
        d = self.get().json()
        self.assertEqual(d["latestThreads"][0]["id"], shared["threadId"])
        self.assertEqual(d["latestThreads"][0]["categorySlug"], "operaciones")  # categoría de las operaciones compartidas

    def test_ocultos_y_de_cuentas_eliminadas_no_salen(self):
        ana, luis, admin = self.user("Ana"), self.user("Luis"), self.user("Jefa", admin=True)
        visible = forum.create_thread(ana, "novatos", "Visible para todos", "primer texto")["threadId"]
        oculto = forum.create_thread(ana, "novatos", "Este lo oculta moderación", "segundo texto")["threadId"]
        with closing(db.connect()) as conn:
            post = conn.execute("SELECT first_post_id FROM threads WHERE id = ?", (oculto,)).fetchone()[0]
        moderation.hide_post(admin, post, "Spam o promoción")
        d = self.get().json()
        self.assertEqual([t["id"] for t in d["latestThreads"]], [visible])

    def test_no_se_publica_el_texto_de_los_mensajes(self):
        ana = self.user("Ana")
        forum.create_thread(ana, "novatos", "Pregunta", "SECRETO-DEL-CUERPO")
        self.assertNotIn("SECRETO-DEL-CUERPO", self.get().text)


class TopTest(PulseBase):
    def test_top5_de_la_semana_con_alias_y_rentabilidad(self):
        for i, name in enumerate(("Uno", "Dos", "Tres")):
            self.trader(name, eur=1000)
        self.market.last["BTC"] = P(110)  # +10 % sobre lo comprado: sube el patrimonio de los tres por igual
        d = self.get().json()
        self.assertEqual(len(d["topWeek"]), 3)
        self.assertEqual([e["rank"] for e in d["topWeek"]], [1, 2, 3])
        self.assertTrue(all(isinstance(e["returnPct"], float) for e in d["topWeek"]))
        lb = {e["alias"]: e["returnPct"] for e in ranking.leaderboard("7d", 50, 0)["entries"]}
        self.assertEqual({e["alias"]: e["returnPct"] for e in d["topWeek"]}, lb)  # los mismos números que la clasificación
        self.assertFalse(d["empty"])

    def test_como_mucho_cinco(self):
        for i in range(7):
            self.trader(f"Trader{i}", eur=1000)
        self.assertEqual(len(self.get().json()["topWeek"]), 5)

    def test_solo_cuentas_que_empezaron_con_al_menos_500_euros_en_el_limite(self):
        self.trader("Pequena", eur=499.99)
        self.trader("Justa", eur=500)
        self.trader("Grande", eur=20000)
        names = {e["alias"] for e in self.get().json()["topWeek"]}
        self.assertEqual(names, {"Justa", "Grande"})

    def test_las_cuentas_anteriores_cuentan_por_su_saldo_en_usd_convertido(self):
        antigua = self.trader("Antigua")  # saldo del panel: 10.000 USD, sin importe elegido
        self.assertIsNone(self.row("SELECT initial_input_cents FROM accounts WHERE user_id = ?", antigua)["initial_input_cents"])
        self.assertIn("Antigua", {e["alias"] for e in self.get().json()["topWeek"]})
        pulse.reset_cache()
        self.sql("UPDATE accounts SET initial_cents = 54999, cash_cents = 54000 WHERE user_id = ?", antigua)  # 499,99 € a 1,10
        ranking._state["computed_at"] = 0
        self.assertNotIn("Antigua", {e["alias"] for e in self.get().json()["topWeek"]})

    def test_privados_y_suspendidos_no_salen(self):
        self.trader("Publico", eur=1000)
        self.trader("Privada", eur=1000, private=True)
        susp = self.trader("Suspendido", eur=1000)
        moderation.suspend(self.user("Jefa", admin=True), susp, 7, "Spam")
        self.assertEqual({e["alias"] for e in self.get().json()["topWeek"]}, {"Publico"})

    def test_sin_tipo_de_cambio_no_falla_la_home(self):
        self.trader("Antigua")
        pulse.reset_cache()
        with mock.patch.object(pulse.prices, "fx_e8", side_effect=RuntimeError("sin red")):
            r = self.get()
        self.assertEqual(r.status_code, 200)
        self.assertIn("Antigua", {e["alias"] for e in r.json()["topWeek"]})

    def test_nada_de_emails_ni_ids_de_usuario(self):
        self.trader("Ana", eur=1000)
        text = self.get().text
        self.assertNotIn("@", text)
        for banned in ("userId", "user_id", "email", "cashCents", "initial"):
            self.assertNotIn(banned, text)


class ActiveTradersTest(PulseBase):
    def test_solo_se_publica_a_partir_de_tres(self):
        self.trader("Ana", eur=1000)
        self.trader("Luis", eur=1000)
        self.assertIsNone(self.get().json()["activeTraders7d"])
        pulse.reset_cache()
        self.trader("Eva", eur=1000)
        self.assertEqual(self.get().json()["activeTraders7d"], 3)

    def test_cuenta_personas_no_operaciones_y_solo_la_ultima_semana(self):
        ana = self.trader("Ana", eur=1000)
        self.buy(ana, "ana-0002")
        self.buy(ana, "ana-0003")
        luis, eva, viejo = self.trader("Luis", eur=1000), self.trader("Eva", eur=1000), self.trader("Viejo", eur=1000)
        self.sql("UPDATE fills SET executed_at = ? WHERE user_id = ?", int(time.time()) - 8 * DAY, viejo)
        self.assertEqual(self.get().json()["activeTraders7d"], 3)  # Ana (3 operaciones) cuenta una vez; el de hace 8 días no

    def test_no_cuentan_desactivados_ni_usuarios_sombra(self):
        a, b, c, d_ = (self.trader(n, eur=1000) for n in ("Aaa", "Bbb", "Ccc", "Ddd"))
        self.sql("UPDATE users SET disabled = 1 WHERE id = ?", d_)
        self.assertEqual(self.get().json()["activeTraders7d"], 3)
        pulse.reset_cache()
        self.sql("UPDATE users SET owner_id = ? WHERE id = ?", a, c)  # como un usuario sombra de reto
        self.assertIsNone(self.get().json()["activeTraders7d"])


class CacheTest(PulseBase):
    def test_se_calcula_una_vez_cada_cinco_minutos(self):
        with mock.patch.object(pulse, "compute", wraps=pulse.compute) as spy:
            self.get(); self.get(); self.get()
            self.assertEqual(spy.call_count, 1)
            with mock.patch.object(pulse.time, "time", return_value=time.time() + pulse.CACHE_SECONDS + 1):
                self.get()
            self.assertEqual(spy.call_count, 2)

    def test_cabeceras_para_que_el_cdn_la_cachee_tambien(self):
        h = self.get().headers["cache-control"]
        self.assertIn("public", h)
        self.assertIn("s-maxage=300", h)
        self.assertNotIn("no-store", h)

    def test_es_publica_sin_sesion_pero_con_limite_de_ritmo(self):
        from backend import security
        security.IP_COMMUNITY_CALLS.clear()
        codes = [self.get().status_code for _ in range(community_api.LIMITS["read"]["ip"] + 5)]
        self.assertEqual(codes[0], 200)
        self.assertIn(429, codes)


P = lambda x: int(round(x * 10**8))

if __name__ == "__main__":
    import unittest
    unittest.main()
