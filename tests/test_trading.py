"""Tests de la cuenta del servidor: ejecución, saldo, mercado cerrado, idempotencia, límite/stop y manipulación."""
import os
import sys
import tempfile
import unittest
from contextlib import closing
from unittest import mock

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import auth, db, http, security, settings  # noqa: E402
from backend.trading import api as trading_api, ledger, prices, rules  # noqa: E402
from backend.trading.rules import E8, OrderError  # noqa: E402

from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

P = lambda x: int(round(x * E8))  # precio/cantidad decimal -> entero 1e-8
T0 = 1_750_000_000 // 3600 * 3600  # una hora en punto: velas alineadas
ENV = {"TRADING_INITIAL_BALANCE_USD": "10000", "TRADING_FEE_BPS": "10", "TRADING_SLIPPAGE_BPS": "0"}


class FakeMarket:
    """Sustituye a backend.trading.prices: el test decide cotización, horario, tipo de cambio y velas."""

    def __init__(self):
        self.last = {"BTC": P(100), "SAN": P(5), "AAPL": P(200)}
        self.open = {"BTC": True, "SAN": True, "AAPL": True}
        self.fx = {"USDT": E8, "USD": E8, "EUR": P(1.10)}
        self.bars = {}  # (symbol, interval) -> [{time, open, high, low}]
        self.calls = []

    def bar(self, symbol, interval, t, o, h, low):
        self.bars.setdefault((symbol, interval), []).append({"time": t, "open": P(o), "high": P(h), "low": P(low)})

    def patch(self):
        def candles(symbol, interval, limit, end):
            self.calls.append((symbol, interval, end))
            return sorted((c for c in self.bars.get((symbol, interval), []) if c["time"] < end), key=lambda c: c["time"])[-limit:]

        def last(symbol):
            if self.last.get(symbol) is None:
                raise OrderError("Sin cotización")
            return self.last[symbol]

        return [
            mock.patch.object(prices, "last_price_e8", side_effect=last),
            mock.patch.object(prices, "market_open", side_effect=lambda s: (self.open[s], "cerrado por pruebas")),
            mock.patch.object(prices, "fx_e8", side_effect=lambda q: self.fx[q]),
            mock.patch.object(prices, "candles", side_effect=candles),
        ]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db.USE_TURSO = False
        db.DB_PATH = os.path.join(self.tmp.name, "test.db")
        db.init_db()
        http._LIMITS.clear()
        security.IP_TRADING_CALLS.clear()
        security.USER_TRADING_CALLS.clear()
        ledger._last_resolve.clear()
        self.env = mock.patch.dict(os.environ, ENV)
        self.env.start()
        settings._cache["time"] = 0
        self.market = FakeMarket()
        self.patches = self.market.patch()
        for p in self.patches:
            p.start()
        self.uid = db.create_user("ana@example.com", "secreto123", "Ana")["id"]
        ledger.portfolio(self.uid)  # crea la cuenta con el saldo inicial (10.000 USD)

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.env.stop()
        settings._cache["time"] = 0
        self.tmp.cleanup()

    # utilidades
    def order(self, coid, symbol="BTC", side="buy", type_="market", qty="1", trigger=None, now=T0, **extra):
        req = {"clientOrderId": coid, "symbol": symbol, "side": side, "type": type_, "quantity": qty, **extra}
        if trigger is not None:
            req["triggerPrice"] = trigger
        return ledger.place_order(self.uid, req, now=now)

    def row(self, sql, *args):
        with closing(db.connect()) as conn:
            r = conn.execute(sql, args).fetchone()
            return dict(r) if r else None

    def cash(self):
        return self.row("SELECT cash_cents FROM accounts WHERE user_id = ?", self.uid)["cash_cents"]

    def count(self, table):
        with closing(db.connect()) as conn:
            return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (self.uid,)).fetchone()[0]


class RulesTest(unittest.TestCase):
    def test_redondeo_nunca_favorece_al_usuario(self):
        # 1 unidad a 0,123456789 USD = 12,3456789 céntimos
        self.assertEqual(rules.notional_cents(E8, 12345678, E8, round_up=True), 13)
        self.assertEqual(rules.notional_cents(E8, 12345678, E8, round_up=False), 12)
        self.assertEqual(rules.fee_cents(1001, 10), 2)  # 1,001 céntimos de comisión -> 2

    def test_parse_e8(self):
        self.assertEqual(rules.parse_e8("0.5", "x", 10**20), 50_000_000)
        self.assertEqual(rules.parse_e8("0,000000019", "x", 10**20), 1)  # se trunca a 8 decimales
        for bad in ("-1", "0", "NaN", "Infinity", "1e400", True, None, [], "abc"):
            with self.assertRaises(OrderError, msg=repr(bad)):
                rules.parse_e8(bad, "x", 10**20)

    def test_reglas_de_vela_con_huecos(self):
        c = {"open": P(95), "high": P(99), "low": P(94)}
        self.assertEqual(rules.candle_fill_price("buy", "limit", P(100), c, 0), P(95))  # hueco a favor: a la apertura
        self.assertEqual(rules.candle_fill_price("sell", "stop", P(100), c, 0), P(95))  # hueco en contra: a la apertura
        self.assertIsNone(rules.candle_fill_price("sell", "limit", P(100), c, 0))
        c = {"open": P(98), "high": P(101), "low": P(97)}
        self.assertEqual(rules.candle_fill_price("sell", "limit", P(100), c, 0), P(100))  # dentro de la vela: al nivel
        self.assertEqual(rules.candle_fill_price("buy", "stop", P(100), c, 50), P(100.5))  # stop + 0,5 % de deslizamiento


class ExecutionTest(Base):
    def test_compra_a_mercado_al_precio_del_servidor(self):
        order, created = self.order("orden-0001", qty="2")
        self.assertTrue(created)
        self.assertEqual(order["status"], "filled")
        self.assertEqual(order["fill"]["price"], 100)
        # 2 × 100 USD = 20.000 céntimos + 0,10 % de comisión (20 céntimos)
        self.assertEqual(order["fill"]["notionalCents"], 20_000)
        self.assertEqual(order["fill"]["feeCents"], 20)
        self.assertEqual(self.cash(), 1_000_000 - 20_020)
        pos = self.row("SELECT * FROM positions WHERE user_id = ?", self.uid)
        self.assertEqual((pos["qty_e8"], pos["cost_cents"], pos["avg_price_e8"]), (2 * E8, 20_020, P(100)))

    def test_venta_con_resultado_neto_de_comisiones(self):
        self.order("orden-0001", qty="2")
        self.market.last["BTC"] = P(150)
        order, _ = self.order("orden-0002", side="sell", qty="1")
        fill = order["fill"]
        self.assertEqual(fill["notionalCents"], 15_000)
        self.assertEqual(fill["feeCents"], 15)
        self.assertEqual(fill["costBasisCents"], 10_010)  # la mitad del coste (con su comisión)
        self.assertEqual(fill["pnlCents"], 15_000 - 15 - 10_010)
        self.assertEqual(self.cash(), 1_000_000 - 20_020 + 14_985)

    def test_activo_en_euros_se_convierte_a_usd(self):
        order, _ = self.order("orden-0001", symbol="SAN", qty="100")  # 100 × 5 EUR × 1,10 = 550 USD
        self.assertEqual(order["fill"]["notionalCents"], 55_000)

    def test_saldo_insuficiente_no_deja_rastro(self):
        with self.assertRaisesRegex(OrderError, "Saldo insuficiente"):
            self.order("orden-0001", qty="100")  # 10.000 USD + comisión > 10.000 USD
        self.assertEqual(self.cash(), 1_000_000)
        self.assertEqual(self.count("orders"), 0)
        self.assertEqual(self.count("fills"), 0)

    def test_minimo_por_orden(self):
        with self.assertRaisesRegex(OrderError, "mínimo"):
            self.order("orden-0001", qty="0.01")  # 1 USD

    def test_no_se_vende_lo_que_no_se_tiene(self):
        with self.assertRaisesRegex(OrderError, "corto"):
            self.order("orden-0001", side="sell", qty="1")
        self.order("orden-0002", qty="1")
        self.order("orden-0003", side="sell", type_="limit", qty="1", trigger="200")  # bloquea la unidad
        with self.assertRaisesRegex(OrderError, "corto"):
            self.order("orden-0004", side="sell", qty="1")

    def test_mercado_cerrado(self):
        self.market.open["AAPL"] = False
        with self.assertRaisesRegex(OrderError, "Mercado cerrado"):
            self.order("orden-0001", symbol="AAPL", qty="1")
        # Una orden límite sí se acepta: queda pendiente para la próxima sesión, sin mirar la cotización
        self.market.last["AAPL"] = None
        order, _ = self.order("orden-0002", symbol="AAPL", type_="limit", qty="1", trigger="190")
        self.assertEqual(order["status"], "open")

    def test_ejecucion_atomica(self):
        """Si algo falla después de mover el saldo, la transacción se deshace entera."""
        real = ledger.execute

        def broken(conn, *a, **k):
            real(conn, *a, **k)  # saldo, posición, fill y orden ya escritos...
            raise RuntimeError("fallo simulado")  # ...y aun así no debe quedar nada

        with mock.patch.object(ledger, "execute", broken), self.assertRaises(RuntimeError):
            self.order("orden-0001", qty="1")
        self.assertEqual(self.cash(), 1_000_000)
        for table in ("orders", "fills", "positions"):
            self.assertEqual(self.count(table), 0, table)


class IdempotencyTest(Base):
    def test_reintento_no_ejecuta_dos_veces(self):
        first, created1 = self.order("reintento-1", qty="1")
        second, created2 = self.order("reintento-1", qty="1")
        self.assertTrue(created1)
        self.assertFalse(created2)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(self.count("fills"), 1)
        self.assertEqual(self.cash(), 1_000_000 - 10_010)

    def test_misma_clave_con_otros_datos(self):
        self.order("reintento-1", qty="1")
        with self.assertRaises(ledger.Conflict):
            self.order("reintento-1", qty="2")

    def test_carrera_entre_dos_peticiones(self):
        """Dos peticiones con la misma clave pasan a la vez la comprobación previa: decide el índice UNIQUE."""
        self.order("reintento-1", qty="1")
        real = ledger._existing
        # La segunda petición «no ve» la primera en la comprobación previa (llegaron a la vez), llega al INSERT,
        # choca con UNIQUE(user_id, client_order_id) y entonces devuelve la orden existente
        with mock.patch.object(ledger, "_existing", side_effect=[None, real(self.uid, "reintento-1")]):
            order, created = self.order("reintento-1", qty="1")
        self.assertFalse(created)
        self.assertEqual(self.count("fills"), 1)
        self.assertEqual(self.cash(), 1_000_000 - 10_010)


class PendingOrdersTest(Base):
    def test_limite_reserva_y_cancelar_libera(self):
        order, _ = self.order("orden-0001", type_="limit", qty="10", trigger="90")
        self.assertEqual(order["status"], "open")
        self.assertEqual(order["reservedCents"], 90_000 + 90)
        with self.assertRaisesRegex(OrderError, "Saldo insuficiente"):
            self.order("orden-0002", qty="95")  # el efectivo reservado no está disponible
        ledger.cancel_order(self.uid, order["id"])
        self.assertEqual(ledger.portfolio(self.uid)["account"]["availableCents"], 1_000_000)

    def test_limite_cruzado_se_ejecuta_al_momento_al_precio_de_mercado(self):
        order, _ = self.order("orden-0001", type_="limit", qty="1", trigger="120")  # compra con límite > mercado
        self.assertEqual(order["status"], "filled")
        self.assertEqual(order["fill"]["price"], 100)

    def test_limite_se_ejecuta_con_las_velas(self):
        order, _ = self.order("orden-0001", type_="limit", qty="1", trigger="90", now=T0)
        self.market.bar("BTC", "1m", T0, 100, 101, 99)
        self.market.bar("BTC", "1m", T0 + 60, 99, 99, 89.5)  # toca 90 dentro de la vela
        events = ledger.resolve(self.uid, now=T0 + 300, force=True)
        self.assertEqual([e["type"] for e in events], ["filled"])
        fill = events[0]["order"]["fill"]
        self.assertEqual((fill["price"], fill["executedAt"], fill["source"]), (90, T0 + 60, "vela 1m"))

    def test_hueco_de_precio(self):
        self.order("orden-0001", qty="1")
        self.order("orden-0002", side="sell", type_="stop", qty="1", trigger="95", now=T0)
        self.order("orden-0003", type_="limit", qty="1", trigger="96", now=T0)
        self.market.bar("BTC", "1m", T0, 100, 100, 99)
        self.market.bar("BTC", "1m", T0 + 60, 90, 91, 89)  # abre muy por debajo de ambos niveles
        ledger.resolve(self.uid, now=T0 + 300, force=True)
        stop = self.row("SELECT f.* FROM fills f JOIN orders o ON o.id = f.order_id WHERE o.client_order_id = 'orden-0002'")
        limit = self.row("SELECT f.* FROM fills f JOIN orders o ON o.id = f.order_id WHERE o.client_order_id = 'orden-0003'")
        self.assertEqual(stop["price_e8"], P(90))  # el stop no protege del hueco: vende a la apertura
        self.assertEqual(limit["price_e8"], P(90))  # el límite se beneficia: compra a la apertura

    def test_velas_anteriores_a_la_orden_no_cuentan(self):
        """El precio tocó el nivel a las 00:10, pero la orden se colocó a las 00:30: no debe ejecutarse."""
        placed = T0 + 1800
        self.order("orden-0001", type_="limit", qty="1", trigger="90", now=placed)
        now = placed + 20 * 3600  # 20 h después: se usan velas de 5m
        self.market.bar("BTC", "5m", T0 + 600, 95, 95, 85)  # antes de colocar la orden
        for i in range(6, 6 + 239):
            self.market.bar("BTC", "5m", T0 + i * 300, 100, 101, 99)
        events = ledger.resolve(self.uid, now=now, force=True)
        self.assertEqual(events, [])
        self.assertEqual(self.row("SELECT status FROM orders")["status"], "open")

    def test_orden_colocada_a_mitad_de_vela_gruesa(self):
        """Con velas de 5m, la vela que contiene la colocación se revisa en 1m y solo después de la orden."""
        placed = T0 + 120
        self.order("orden-0001", type_="limit", qty="1", trigger="90", now=placed)
        self.market.bar("BTC", "5m", T0, 95, 95, 85)  # 00:00-00:05: tocó 85, pero ¿antes o después de las 00:02?
        self.market.bar("BTC", "1m", T0 + 60, 95, 95, 85)  # 00:01: antes de la orden -> no cuenta
        self.market.bar("BTC", "1m", T0 + 180, 95, 95, 89)  # 00:03: después -> se ejecuta
        for i in range(1, 250):
            self.market.bar("BTC", "5m", T0 + i * 300, 100, 101, 99)
        events = ledger.resolve(self.uid, now=T0 + 20 * 3600, force=True)
        self.assertEqual(events[0]["order"]["fill"]["executedAt"], T0 + 180)

    def test_stop_sin_saldo_al_ejecutar_se_rechaza(self):
        order, _ = self.order("orden-0001", type_="stop", qty="50", trigger="110", now=T0)
        self.order("orden-0002", qty="44")  # usa casi todo el efectivo libre (quedan ~90 USD)
        self.market.bar("BTC", "1m", T0 + 60, 150, 150, 150)  # hueco: abre a 150, muy por encima de lo reservado
        events = ledger.resolve(self.uid, now=T0 + 300, force=True)
        self.assertEqual(events[0]["type"], "rejected")
        self.assertEqual(ledger.portfolio(self.uid)["account"]["reservedCents"], 0)

    def test_caducidad(self):
        self.order("orden-0001", type_="limit", qty="1", trigger="50", now=T0)
        events = ledger.resolve(self.uid, now=T0 + ledger.ORDER_TTL + 10, force=True)
        self.assertEqual([e["type"] for e in events], ["expired"])

    def test_orden_cronologica_entre_ordenes(self):
        """Dos compras pendientes que no caben juntas: se ejecuta la que se activó antes, aunque se colocara después."""
        self.order("orden-0001", type_="limit", qty="60", trigger="90", now=T0)
        self.market.last["BTC"] = P(120)
        self.order("orden-0002", type_="stop", qty="30", trigger="130", now=T0)
        self.order("orden-0003", qty="1")  # gasta casi todo lo libre
        self.market.bar("BTC", "1m", T0 + 60, 120, 131, 120)  # primero se activa el stop
        self.market.bar("BTC", "1m", T0 + 120, 100, 100, 89)  # después el límite
        events = ledger.resolve(self.uid, now=T0 + 600, force=True)
        self.assertEqual([(e["type"], e["order"]["clientOrderId"]) for e in events],
                         [("filled", "orden-0002"), ("filled", "orden-0001")])


class ApiTest(Base):
    def setUp(self):
        super().setUp()
        app = Starlette(routes=auth.build_routes(lambda r: "1.2.3.4") + trading_api.routes)
        self.client = TestClient(app, base_url="http://testserver")
        db.delete_user(self.uid)
        r = self.client.post("/api/auth/register", json={"email": "ana@example.com", "password": "secreto123", "name": "Ana"})
        self.assertEqual(r.status_code, 201, r.text)
        self.uid = self.client.get("/api/auth/me").json()["user"]["id"]

    def tearDown(self):
        self.client.close()
        super().tearDown()

    def post(self, **body):
        return self.client.post("/api/orders", json={"clientOrderId": "api-orden-1", "symbol": "BTC", "side": "buy",
                                                     "type": "market", "quantity": "1", **body})

    def test_requiere_sesion(self):
        with TestClient(Starlette(routes=trading_api.routes)) as anon:
            self.assertEqual(anon.get("/api/portfolio").status_code, 401)

    def test_cuenta_nueva_con_saldo_configurado(self):
        data = self.client.get("/api/portfolio").json()
        self.assertEqual(data["account"]["cashCents"], 1_000_000)
        self.assertEqual(data["positions"], [])

    def test_el_cliente_no_puede_fijar_precio_ni_saldo(self):
        # Campos inventados por un cliente malicioso: se ignoran
        r = self.post(price="0.01", triggerPrice="0.01", cashCents=10**12, balanceUsd=10**9, fee=0, executedAt=1)
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["order"]["fill"]["price"], 100)
        # La copia de /api/data (modo local sincronizado) no toca la cuenta del servidor
        self.client.put("/api/data", json={"data": {"app": "PaperPulse", "account": {"balanceUsd": 10**9}}})
        self.assertEqual(self.client.get("/api/portfolio").json()["account"]["cashCents"], 1_000_000 - 10_010)

    def test_entradas_invalidas(self):
        for body, msg in [({"quantity": "-1"}, "mayor que cero"), ({"quantity": "NaN"}, "válido"), ({"side": "short"}, "lado"),
                          ({"type": "iceberg"}, "tipo"), ({"symbol": "FAKECOIN"}, "activo"), ({"clientOrderId": "x"}, "clientOrderId"),
                          ({"type": "limit"}, "activación")]:
            r = self.post(**body)
            self.assertEqual(r.status_code, 400, body)
            self.assertIn(msg, r.json()["error"], body)
        self.assertEqual(self.count("orders"), 0)

    def test_idempotencia_por_api(self):
        self.assertEqual(self.post().status_code, 201)
        r = self.post()
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["replayed"])
        self.assertEqual(self.post(quantity="2").status_code, 409)

    def test_no_se_ven_ni_cancelan_ordenes_ajenas(self):
        otro = db.create_user("otro@example.com", "secreto123", "Otro")["id"]
        ajena, _ = ledger.place_order(otro, {"clientOrderId": "ajena-0001", "symbol": "BTC", "side": "buy", "type": "limit",
                                             "quantity": "1", "triggerPrice": "50"})
        self.assertEqual(self.client.delete(f"/api/orders/{ajena['id']}").status_code, 404)
        self.assertEqual(self.client.get("/api/orders").json()["orders"], [])

    def test_csrf(self):
        r = self.client.post("/api/orders", json={}, headers={"Origin": "https://malicioso.example"})
        self.assertEqual(r.status_code, 403)

    def test_limite_por_usuario(self):
        codes = [self.client.get("/api/portfolio").status_code for _ in range(trading_api.LIMITS["read"]["user"] + 1)]
        self.assertEqual(codes[-1], 429)
        self.assertNotIn(429, codes[:-1])

    def test_diario_saneado(self):
        order_id = self.post().json()["order"]["id"]
        r = self.client.patch(f"/api/orders/{order_id}", json={"journal": {"notes": "Hola\x00\x07 <script>x</script>" + "a" * 2000, "setup": 5}})
        journal = r.json()["order"]["journal"]
        self.assertTrue(journal["notes"].startswith("Hola <script>"))  # se guarda el texto; el frontend lo escapa al pintar
        self.assertEqual(len(journal["notes"]), 1000)
        self.assertEqual(journal["setup"], "5")


if __name__ == "__main__":
    unittest.main()
