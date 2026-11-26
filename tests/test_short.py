"""Short en «Mi cuenta» (cuenta del servidor): apertura, cierre, comisiones, cierre forzoso, Stop Loss / Take Profit invertidos,
long y short en el mismo activo, patrimonio y clasificación, migración 0017 y que el long no cambia.

Cifras de partida (ver test_trading.py): saldo 10.000 USD, comisión 10 bps, deslizamiento 0, BTC a 100 USD, tipo de cambio 1.
Un Short de 10 BTC a 100 aparta 1.000 USD de garantía y cobra 1,00 USD de comisión: el efectivo queda en 8.999,00 USD.
"""
import os
import sys
import unittest
from contextlib import closing
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import _local_db  # noqa: F401,E402
from test_trading import ApiBase, Base, P, T0  # noqa: E402

from backend import db  # noqa: E402
from backend.community import ranking  # noqa: E402
from backend.trading import ledger, prices, rules  # noqa: E402
from backend.trading.rules import E8, OrderError  # noqa: E402

INITIAL = 1_000_000  # céntimos


class ShortBase(Base):
    def short(self, coid, qty="10", now=T0, symbol="BTC", **extra):
        return self.order(coid, symbol=symbol, side="sell", qty=qty, now=now, direction="short", **extra)

    def cover(self, coid, qty="10", now=T0, symbol="BTC"):
        return self.order(coid, symbol=symbol, side="buy", qty=qty, now=now, direction="short")

    def srow(self, symbol="BTC"):
        return self.row("SELECT * FROM short_positions WHERE user_id = ? AND symbol = ?", self.uid, symbol)

    def exits(self, symbol="BTC"):
        return self.row("SELECT * FROM position_exits WHERE user_id = ? AND symbol = ?", self.uid, symbol)

    def equity(self, price):
        """Efectivo + garantía ± resultado del corto (+ largas) al precio dado, sin comisión de cierre."""
        total = self.cash()
        s = self.srow()
        if s:
            total += rules.short_value_cents(s["margin_cents"], s["qty_e8"], P(price), E8)
        p = self.row("SELECT * FROM positions WHERE user_id = ? AND symbol = 'BTC'", self.uid)
        if p:
            total += rules.notional_cents(p["qty_e8"], P(price), E8, round_up=False)
        return total


class OpenCloseTest(ShortBase):
    def test_apertura_aparta_el_100_por_100_y_cobra_comision(self):
        order, created = self.short("short-0001")
        self.assertTrue(created)
        self.assertEqual((order["status"], order["direction"]), ("filled", "short"))
        self.assertEqual(order["fill"]["notionalCents"], 100_000)
        self.assertEqual(order["fill"]["feeCents"], 100)  # 0,10 % de 1.000 USD
        self.assertEqual(self.cash(), INITIAL - 100_000 - 100)
        s = self.srow()
        self.assertEqual((s["margin_cents"], s["cost_cents"], s["qty_e8"], s["avg_price_e8"]), (100_000, 100_100, P(10), P(100)))
        self.assertIsNone(self.row("SELECT * FROM positions WHERE user_id = ?", self.uid))  # no es una larga
        self.assertIsNotNone(self.exits(), "todo corto tiene fila de seguimiento (liquidación)")

    def test_saldo_insuficiente_no_cambia_nada(self):
        with self.assertRaisesRegex(OrderError, "Saldo insuficiente"):
            self.short("short-0001", qty="100")  # 10.000 USD de garantía + comisión > 10.000 USD
        self.assertEqual(self.cash(), INITIAL)
        self.assertEqual((self.count("orders"), self.count("fills"), self.count("short_positions")), (0, 0, 0))

    def test_saldo_justo_si_cubre_garantia_mas_comision(self):
        self.short("short-0001", qty="99.9")  # 9.990 + 9,99 de comisión
        self.assertEqual(self.cash(), INITIAL - 999_000 - 999)

    def test_las_ordenes_pendientes_reservan_saldo_y_cuentan_para_abrir(self):
        self.order("compra-0001", type_="limit", qty="50", trigger="90")  # reserva 4.500 USD + comisión
        with self.assertRaisesRegex(OrderError, "Saldo insuficiente"):
            self.short("short-0001", qty="60")  # 6.000 + 6 > 10.000 − 4.504,5

    def test_cierre_con_ganancia(self):
        self.short("short-0001")
        self.market.last["BTC"] = P(90)
        order, _ = self.cover("cover-0001")
        f = order["fill"]
        self.assertEqual((f["notionalCents"], f["feeCents"]), (90_000, 90))
        self.assertEqual(f["pnlCents"], 10_000 - 100 - 90)  # +100 € por bajar 10 × 10 unidades, menos las dos comisiones
        self.assertEqual(self.cash(), INITIAL + 9_810)
        self.assertIsNone(self.srow())
        self.assertIsNone(self.exits())

    def test_cierre_con_perdida(self):
        self.short("short-0001")
        self.market.last["BTC"] = P(110)
        order, _ = self.cover("cover-0001")
        self.assertEqual(order["fill"]["pnlCents"], -10_000 - 100 - 110)
        self.assertEqual(self.cash(), INITIAL - 10_210)

    def test_la_perdida_maxima_es_la_garantia_mas_la_comision_de_apertura(self):
        self.short("short-0001")
        self.market.last["BTC"] = P(500)  # muy por encima de la liquidación (sin que el servidor la haya cerrado aún)
        order, _ = self.cover("cover-0001")
        self.assertEqual(order["fill"]["pnlCents"], -100_100)
        self.assertEqual(self.cash(), INITIAL - 100_100)
        self.assertGreaterEqual(self.cash(), 0)

    def test_cierre_parcial_y_ampliacion(self):
        self.short("short-0001", qty="10")
        self.short("short-0002", qty="10")  # amplía a precio 100: misma entrada media
        s = self.srow()
        self.assertEqual((s["qty_e8"], s["margin_cents"]), (P(20), 200_000))
        self.market.last["BTC"] = P(90)
        order, _ = self.cover("cover-0001", qty="5")
        self.assertEqual(order["fill"]["pnlCents"], 5_000 - 50 - 45)  # 5 de 20 unidades: un cuarto de la comisión de apertura (200) y la de cierre (45)
        s = self.srow()
        self.assertEqual((s["qty_e8"], s["margin_cents"], s["cost_cents"]), (P(15), 150_000, 150_150))
        self.assertIsNotNone(self.exits(), "sigue abierto: conserva el seguimiento")

    def test_cerrar_lo_que_no_se_tiene(self):
        with self.assertRaisesRegex(OrderError, "No tienes un Short abierto"):
            self.cover("cover-0001")
        self.short("short-0001", qty="10")
        with self.assertRaisesRegex(OrderError, "más unidades"):
            self.cover("cover-0002", qty="11")

    def test_minimo_por_orden(self):
        with self.assertRaisesRegex(OrderError, "mínimo"):
            self.short("short-0001", qty="0.01")

    def test_mercado_cerrado_aplica_las_mismas_reglas_que_long(self):
        self.market.open["SAN"] = False
        with self.assertRaisesRegex(OrderError, "Mercado cerrado"):
            self.short("short-0001", symbol="SAN", qty="100")

    def test_idempotencia_y_conflicto_de_direccion(self):
        a, created = self.short("short-0001")
        b, created2 = self.short("short-0001")
        self.assertEqual((created, created2, a["id"]), (True, False, b["id"]))
        self.assertEqual(self.count("short_positions"), 1)
        with self.assertRaisesRegex(OrderError, "ya se usó"):
            self.order("short-0001", side="sell", qty="10")  # misma clave, otra dirección

    def test_un_short_solo_va_a_mercado_y_la_direccion_se_valida(self):
        with self.assertRaisesRegex(OrderError, "a mercado"):
            self.order("short-0001", side="sell", type_="limit", trigger="120", qty="10", direction="short")
        with self.assertRaisesRegex(OrderError, "dirección"):
            self.order("short-0002", side="sell", qty="10", direction="lateral")


class DineroTest(ShortBase):
    def test_el_dinero_ni_se_crea_ni_se_destruye(self):
        """Patrimonio = efectivo + valor del corto. Abrir solo cuesta la comisión; después se mueve con el precio y,
        al cerrar, el efectivo final es el inicial más el resultado menos las dos comisiones."""
        self.short("short-0001")
        self.assertEqual(self.equity(100), INITIAL - 100)  # solo la comisión de apertura
        self.assertEqual(self.equity(90), INITIAL - 100 + 10_000)
        self.assertEqual(self.equity(110), INITIAL - 100 - 10_000)
        self.assertEqual(self.equity(250), INITIAL - 100 - 100_000)  # tope: pierde la garantía y no más
        self.market.last["BTC"] = P(95)
        order, _ = self.cover("cover-0001")
        pnl = order["fill"]["pnlCents"]
        self.assertEqual(self.cash(), INITIAL + pnl)
        self.assertEqual(pnl, 5_000 - 100 - 95)  # (100 − 95) × 10 USD = 50 USD, menos 1,00 y 0,95 de comisiones

    def test_long_y_short_cuadran_juntos(self):
        self.order("largo-0001", symbol="SAN", qty="100")  # 100 SAN a 5 EUR × 1,10 = 550 USD + comisión
        self.short("short-0001", qty="10")
        cash_before = self.cash()
        self.cover("cover-0001")  # mismo precio: solo comisiones
        self.assertEqual(self.cash(), cash_before + 100_000 - 100)  # recupera la garantía menos la comisión de cierre
        self.assertEqual(self.count("short_positions"), 0)

    def test_una_orden_larga_sigue_igual(self):
        order, _ = self.order("largo-0001", qty="2")
        self.assertEqual((order["direction"], order["fill"]["notionalCents"], order["fill"]["feeCents"]), ("long", 20_000, 20))
        self.assertEqual(self.cash(), INITIAL - 20_020)
        sell, _ = self.order("venta-0001", side="sell", qty="2")
        self.assertEqual(sell["fill"]["pnlCents"], -20 - 20)
        self.assertEqual(self.cash(), INITIAL - 40)
        self.assertEqual(self.count("short_positions"), 0)


class MismoActivoTest(ShortBase):
    def test_no_se_puede_abrir_short_con_un_long_abierto(self):
        self.order("largo-0001", qty="1")
        with self.assertRaisesRegex(OrderError, "Long abierto en BTC"):
            self.short("short-0001")
        self.assertEqual(self.count("short_positions"), 0)

    def test_no_se_puede_abrir_long_con_un_short_abierto(self):
        self.short("short-0001")
        with self.assertRaisesRegex(OrderError, "Short abierto en BTC"):
            self.order("largo-0001", qty="1")
        with self.assertRaisesRegex(OrderError, "Short abierto en BTC"):
            self.order("limite-0001", type_="limit", qty="1", trigger="90")  # ni siquiera como orden pendiente
        self.assertEqual(self.count("positions"), 0)

    def test_vender_largo_sin_largo_pero_con_short_explica_el_camino(self):
        self.short("short-0001")
        with self.assertRaisesRegex(OrderError, "venta en corto"):
            self.order("venta-0001", side="sell", qty="1")

    def test_activos_distintos_si_pueden_convivir(self):
        self.order("largo-0001", symbol="SAN", qty="100")
        self.short("short-0001")
        self.assertEqual((self.count("positions"), self.count("short_positions")), (1, 1))


class SalidasValidacionTest(ShortBase):
    def test_short_stop_por_encima_y_take_por_debajo(self):
        order, _ = self.short("short-0001", stopLoss="110", takeProfit="90")
        self.assertEqual((order["stopLoss"], order["takeProfit"]), (110, 90))
        e = self.exits()
        self.assertEqual((e["direction"], e["stop_e8"], e["take_e8"]), ("short", P(110), P(90)))

    def test_short_rechaza_niveles_en_el_lado_equivocado(self):
        for extra, msg in (({"stopLoss": "95"}, "Stop Loss debe estar por encima"), ({"stopLoss": "100"}, "por encima"),
                           ({"takeProfit": "105"}, "Take Profit debe estar por debajo"), ({"takeProfit": "100"}, "por debajo"),
                           ({"stopLoss": "200"}, "liquidación"), ({"stopLoss": "250"}, "liquidación")):
            with self.assertRaisesRegex(OrderError, msg, msg=str(extra)):
                self.short(f"short-{abs(hash(str(extra))) % 10**8:08d}", **extra)
        self.assertEqual((self.count("orders"), self.count("short_positions"), self.cash()), (0, 0, INITIAL))

    def test_long_rechaza_niveles_en_el_lado_equivocado(self):
        for extra, msg in (({"stopLoss": "105"}, "Stop Loss debe estar por debajo"), ({"takeProfit": "95"}, "Take Profit debe estar por encima")):
            with self.assertRaisesRegex(OrderError, msg):
                self.order(f"largo-{abs(hash(str(extra))) % 10**8:08d}", qty="1", **extra)
        self.assertEqual((self.count("orders"), self.count("positions")), (0, 0))

    def test_niveles_ilegibles(self):
        with self.assertRaisesRegex(OrderError, "Stop Loss"):
            self.short("short-0001", stopLoss="abc")
        with self.assertRaisesRegex(OrderError, "Take Profit"):
            self.short("short-0002", takeProfit="-3")

    def test_sin_niveles_no_los_pide(self):
        self.short("short-0001", stopLoss="", takeProfit=0)
        e = self.exits()
        self.assertEqual((e["stop_e8"], e["take_e8"]), (None, None))

    def test_las_funciones_puras(self):
        with self.assertRaises(OrderError):
            rules.validate_exits("short", P(100), P(99), None)
        rules.validate_exits("short", P(100), P(150), P(50))
        rules.validate_exits("long", P(100), P(50), P(150))
        self.assertEqual(rules.liquidation_price_e8(P(100)), P(200))
        self.assertEqual(rules.short_payout_cents(100_000, 300_000, 5), 0)  # nunca negativo


class CierresAutomaticosTest(ShortBase):
    def resolve(self, now=T0 + 3600):
        return ledger.resolve(self.uid, now, force=True)

    def test_stop_loss_del_short_cierra_al_subir(self):
        self.short("short-0001", stopLoss="110", takeProfit="80")
        self.market.bar("BTC", "1m", T0 + 60, 100, 109, 99)  # no toca nada
        self.market.bar("BTC", "1m", T0 + 120, 105, 112, 104)  # toca 110
        events = self.resolve()
        self.assertEqual([e["type"] for e in events], ["filled"])
        self.assertEqual(events[0]["reason"], "stop")
        self.assertIsNone(self.srow())
        f = events[0]["order"]["fill"]
        self.assertEqual((f["source"], f["price"], f["direction"]), ("stop loss", 110, "short"))
        self.assertEqual(f["pnlCents"], -10_000 - 100 - 110)
        self.assertEqual(self.cash(), INITIAL - 10_210)
        self.assertIn("Stop Loss", events[0]["order"]["reason"])

    def test_take_profit_del_short_cierra_al_bajar(self):
        self.short("short-0001", stopLoss="110", takeProfit="90")
        self.market.bar("BTC", "1m", T0 + 60, 95, 96, 89)  # toca 90
        events = self.resolve()
        self.assertEqual(events[0]["reason"], "take")
        self.assertEqual(events[0]["order"]["fill"]["price"], 90)
        self.assertEqual(self.cash(), INITIAL + 9_810)

    def test_hueco_a_favor_del_take_se_ejecuta_a_la_apertura(self):
        self.short("short-0001", takeProfit="90")
        self.market.bar("BTC", "1m", T0 + 60, 85, 86, 84)  # abre muy por debajo del take
        events = self.resolve()
        self.assertEqual(events[0]["order"]["fill"]["price"], 85)

    def test_misma_vela_toca_stop_y_take_gana_lo_peor(self):
        self.short("short-0001", stopLoss="110", takeProfit="90")
        self.market.bar("BTC", "1m", T0 + 60, 100, 111, 89)
        self.assertEqual(self.resolve()[0]["reason"], "stop")

    def test_cierre_forzoso_por_liquidacion_registra_el_motivo(self):
        self.short("short-0001")  # sin SL: solo la liquidación a 200
        self.market.bar("BTC", "1m", T0 + 60, 100, 150, 99)
        self.assertEqual(self.resolve(T0 + 120), [], "a 150 aún no se liquida")
        self.assertIsNotNone(self.srow())
        self.market.bar("BTC", "1m", T0 + 120, 150, 230, 149)  # cruza 200
        events = self.resolve(T0 + 3600)
        self.assertEqual((events[0]["type"], events[0]["forced"], events[0]["reason"]), ("filled", True, "liquidation"))
        f = events[0]["order"]["fill"]
        self.assertEqual((f["source"], f["price"]), ("liquidación", 200))  # cierra a 2 × la entrada, no a 230
        self.assertEqual(f["pnlCents"], -100_100)  # pierde toda la garantía y la comisión de apertura, nada más
        self.assertEqual(self.cash(), INITIAL - 100_100)
        self.assertIn("Cierre forzoso", events[0]["order"]["reason"])
        self.assertIsNone(self.srow())
        self.assertEqual(self.row("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND client_order_id LIKE 'auto-%'", self.uid)["n"], 1)

    def test_hueco_por_encima_de_la_liquidacion_no_pierde_mas_que_la_garantia(self):
        self.short("short-0001")
        self.market.bar("BTC", "1m", T0 + 60, 300, 320, 290)
        events = self.resolve()
        self.assertEqual(events[0]["order"]["fill"]["price"], 200)
        self.assertEqual(self.cash(), INITIAL - 100_100)

    def test_stop_loss_y_take_profit_del_long(self):
        self.order("largo-0001", qty="10", stopLoss="95", takeProfit="120")
        self.market.bar("BTC", "1m", T0 + 60, 99, 100, 94)  # toca el stop
        events = self.resolve()
        self.assertEqual(events[0]["reason"], "stop")
        f = events[0]["order"]["fill"]
        self.assertEqual((f["source"], f["price"], f["direction"]), ("stop loss", 95, "long"))
        self.assertEqual(self.count("positions"), 0)
        self.assertIsNone(self.exits())

    def test_no_cierra_por_velas_anteriores_a_la_apertura(self):
        self.market.bar("BTC", "1m", T0 - 600, 100, 300, 10)  # antes de abrir
        self.short("short-0001")
        self.assertEqual(self.resolve(), [])
        self.assertIsNotNone(self.srow())

    def test_las_ventas_pendientes_se_cancelan_al_cerrar_un_long_por_stop(self):
        self.order("largo-0001", qty="10", stopLoss="95")
        self.order("venta-0001", side="sell", type_="limit", qty="10", trigger="150")
        self.market.bar("BTC", "1m", T0 + 60, 99, 100, 90)
        events = self.resolve()
        self.assertEqual(events[0]["reason"], "stop")
        self.assertEqual(self.row("SELECT status FROM orders WHERE client_order_id = 'venta-0001'")["status"], "cancelled")

    def test_los_cierres_automaticos_no_cuentan_como_orden_stop_colocada(self):
        from backend.retention import onboarding
        self.short("short-0001", stopLoss="110")
        self.market.bar("BTC", "1m", T0 + 60, 100, 112, 99)
        self.resolve()
        with closing(db.connect()) as conn:
            self.assertFalse(onboarding._done(conn, self.uid, None)["first_stop"])
            self.assertTrue(onboarding._done(conn, self.uid, None)["first_buy"])
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM achievements WHERE user_id = ? AND code = 'first_stop'", (self.uid,)).fetchone()[0], 0)


class PortfolioYClasificacionTest(ShortBase):
    def test_la_cartera_distingue_shorts_y_el_historial_los_cierres(self):
        self.short("short-0001", stopLoss="110")
        p = ledger.portfolio(self.uid)
        pos = p["positions"][0]
        self.assertEqual((pos["direction"], pos["quantity"], pos["avgPrice"], pos["marginCents"], pos["stopLoss"], pos["liquidationPrice"]),
                         ("short", 10, 100, 100_000, 110, 200))
        self.assertEqual(p["account"]["cashCents"], INITIAL - 100_100)
        self.market.last["BTC"] = P(90)
        self.cover("cover-0001")
        p = ledger.portfolio(self.uid)
        self.assertEqual(p["positions"], [])
        self.assertEqual([(t["direction"], t["pnlCents"]) for t in p["trades"]], [("short", 9_810)])

    def test_la_clasificacion_cuenta_el_short_con_el_signo_correcto(self):
        self.short("short-0001")
        for price, expected in ((90, INITIAL - 100 + 10_000), (110, INITIAL - 100 - 10_000), (100, INITIAL - 100)):
            with mock.patch.object(prices, "valuation_prices", side_effect=lambda syms, p=price: {s: (P(p), E8) for s in syms}):
                ranking.compute(T0 + 10)
            self.assertEqual(self.row("SELECT equity_cents FROM leaderboard WHERE user_id = ? AND period = 'total'", self.uid)["equity_cents"], expected, price)


class DivisasTest(ShortBase):
    """Cuenta abierta en euros y activos cotizados en otra divisa. El libro contable guarda TODOS los importes en céntimos de USD
    (el saldo elegido en euros se convierte una vez al abrir la cuenta); los precios van en la divisa del activo y cada orden
    guarda el tipo de cambio de su ejecución (fx), igual que en un Long."""

    def setUp(self):
        super().setUp()
        self.eva = db.create_user("eva@example.com", "secreto123", "Eva")["id"]
        ledger.start_account(self.eva, 1000, "EUR")  # 1.000 € a 1,10 USD/€ = 1.100 USD

    def op(self, coid, symbol, side, qty, now=T0):
        return ledger.place_order(self.eva, {"clientOrderId": coid, "symbol": symbol, "side": side, "type": "market", "quantity": qty,
                                             "direction": "short"}, now=now)[0]

    def cash_eva(self):
        return self.row("SELECT cash_cents FROM accounts WHERE user_id = ?", self.eva)["cash_cents"]

    def test_cuenta_en_euros_short_de_un_activo_en_usd(self):
        self.assertEqual(self.cash_eva(), 110_000)  # 1.100 USD
        a = ledger.portfolio(self.eva)["account"]
        self.assertEqual((a["initialInputCents"], a["initialCurrency"]), (100_000, "EUR"))  # lo elegido, para mostrarlo en euros
        # Apertura: 2 AAPL a 200 USD = 400 USD de garantía (sin conversión: ya es USD) y 0,40 USD de comisión
        o = self.op("eur-short-0001", "AAPL", "sell", "2")
        self.assertEqual((o["fill"]["price"], o["fill"]["fx"], o["fill"]["notionalCents"], o["fill"]["feeCents"]), (200, 1, 40_000, 40))
        self.assertEqual(self.cash_eva(), 110_000 - 40_000 - 40)
        pos = ledger.portfolio(self.eva)["positions"][0]
        self.assertEqual((pos["direction"], pos["quote"], pos["marginCents"], pos["liquidationPrice"]), ("short", "USD", 40_000, 400))
        # Cierre a 180: recompra 360 USD (+0,36 de comisión). Devuelve 2·400 − 360 − 0,36 = 439,64 USD
        self.market.last["AAPL"] = P(180)
        c = self.op("eur-short-0002", "AAPL", "buy", "2")
        self.assertEqual((c["fill"]["notionalCents"], c["fill"]["feeCents"], c["fill"]["pnlCents"]), (36_000, 36, 3_924))
        self.assertEqual(self.cash_eva(), 110_000 + 3_924)  # el efectivo final es el inicial más el resultado, en USD
        # En euros (al cambio de 1,10): +35,67 €
        self.assertEqual(round(3_924 / 100 / 1.10, 2), 35.67)

    def test_activo_en_euros_el_cambio_de_cada_ejecucion_entra_en_el_resultado(self):
        """SAN cotiza en EUR: la garantía se fija a 1,10 al abrir y la recompra se valora al cambio del cierre (1,20)."""
        o = self.op("eur-short-0003", "SAN", "sell", "100")  # 100 × 5 € × 1,10 = 550 USD
        self.assertEqual((o["fill"]["price"], o["fill"]["fx"], o["fill"]["notionalCents"], o["fill"]["feeCents"]), (5, 1.1, 55_000, 55))
        self.market.fx["EUR"] = P(1.20)
        c = self.op("eur-short-0004", "SAN", "buy", "100")  # el precio no se mueve (5 €), el euro sube
        self.assertEqual((c["fill"]["fx"], c["fill"]["notionalCents"], c["fill"]["feeCents"]), (1.2, 60_000, 60))
        # Devuelve 2·550 − 600 − 0,60 = 499,40 USD; resultado = 499,40 − 550,55 = −51,15 USD (−50 USD por el tipo de cambio, más comisiones)
        self.assertEqual(c["fill"]["pnlCents"], -5_115)
        self.assertEqual(self.cash_eva(), 110_000 - 5_115)

    def test_el_short_de_un_activo_en_euros_sin_saldo_en_usd_suficiente(self):
        with self.assertRaisesRegex(OrderError, "Saldo insuficiente"):
            self.op("eur-short-0005", "SAN", "sell", "250")  # 250 × 5 × 1,10 = 1.375 USD > 1.100 USD


class MigracionTest(unittest.TestCase):
    """0017 solo añade, no toca filas existentes, es idempotente y el código anterior sigue funcionando con ella."""

    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        db.USE_TURSO = False
        db.DB_PATH = os.path.join(self.tmp.name, "m.db")

    def at_version_16(self):
        with closing(db.connect()) as conn:
            for sql in db.load_migrations()[:16]:
                for stmt in db.split_statements(sql):
                    conn.execute(stmt)
            conn.execute("PRAGMA user_version = 16")
            conn.execute("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (1, 'a@b.c', 'A', 'x', 1)")
            conn.execute("INSERT INTO accounts (user_id, cash_cents, initial_cents, created_at, updated_at) VALUES (1, 500, 1000, 1, 1)")
            conn.execute("INSERT INTO positions VALUES (1, 'BTC', 100000000, 10000, 10000000000, 1, 1)")
            conn.execute("INSERT INTO orders (user_id, client_order_id, symbol, side, type, qty_e8, status, checked_until, created_at, updated_at) "
                         "VALUES (1, 'viejo-0001', 'BTC', 'buy', 'market', 100000000, 'filled', 1, 1, 1)")
            conn.execute("INSERT INTO fills (order_id, user_id, symbol, side, qty_e8, price_e8, fx_e8, notional_cents, fee_cents, source, executed_at) "
                         "VALUES (1, 1, 'BTC', 'buy', 100000000, 10000000000, 100000000, 10000, 10, 'cotización', 1)")

    def snapshot(self, conn):
        return {t: [tuple(r) for r in conn.execute(f"SELECT * FROM {t} ORDER BY 1, 2").fetchall()] for t in ("accounts", "positions")}

    def test_solo_anade_y_no_toca_las_filas_existentes(self):
        self.at_version_16()
        with closing(db.connect()) as conn:
            antes = self.snapshot(conn)
            orders_before = [tuple(r)[:12] for r in conn.execute("SELECT * FROM orders").fetchall()]
        db.init_db()
        with closing(db.connect()) as conn:
            self.assertEqual(self.snapshot(conn), antes)
            self.assertEqual([tuple(r)[:12] for r in conn.execute("SELECT * FROM orders").fetchall()], orders_before)
            self.assertEqual(conn.execute("SELECT direction, stop_e8 FROM orders").fetchone()[:], ("long", None))
            self.assertEqual(conn.execute("SELECT direction FROM fills").fetchone()[0], "long")
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM short_positions").fetchone()[0], 0)
        self.assertEqual(db.schema_status()["current"], len(db.load_migrations()))

    def test_el_codigo_anterior_sigue_funcionando_con_ella(self):
        """Lo que hacía la versión anterior (insertar la posición por posición de columna, órdenes y ejecuciones por nombre,
        sin las columnas nuevas) sigue valiendo tras aplicar 0017: es lo que permite volver atrás."""
        self.at_version_16()
        db.init_db()
        with closing(db.connect()) as conn:
            conn.execute("INSERT INTO positions VALUES (1, 'ETH', 100000000, 10000, 10000000000, 1, 1)")
            conn.execute("INSERT INTO orders (user_id, client_order_id, symbol, side, type, qty_e8, status, checked_until, created_at, updated_at) "
                         "VALUES (1, 'viejo-0002', 'ETH', 'sell', 'market', 100000000, 'filled', 1, 1, 1)")
            conn.execute("INSERT INTO fills (order_id, user_id, symbol, side, qty_e8, price_e8, fx_e8, notional_cents, fee_cents, source, executed_at) "
                         "VALUES (2, 1, 'ETH', 'sell', 100000000, 10000000000, 100000000, 10000, 10, 'cotización', 2)")
            self.assertEqual(conn.execute("SELECT direction FROM fills WHERE order_id = 2").fetchone()[0], "long")
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM positions").fetchone()[0], 2)

    def test_idempotente_y_resistente_a_la_carrera_de_arranque(self):
        self.at_version_16()
        db.init_db()
        # Otra instancia ya la aplicó y esta ve una versión antigua: repetirla no debe fallar ni duplicar columnas
        with closing(db.connect()) as conn:
            conn.execute("PRAGMA user_version = 16")
        db.init_db()
        with closing(db.connect()) as conn:
            cols = [r[1] for r in conn.execute("PRAGMA table_info(orders)")]
            self.assertEqual(cols.count("direction"), 1)
        self.assertEqual(db.schema_status()["current"], len(db.load_migrations()))

    def carrera(self, error):
        """La «otra instancia» aplica la migración y sube la versión justo cuando esta falla con `error`."""
        self.at_version_16()
        real_apply = db._apply_statement
        state = {"done": False}

        def racing(conn, statement):
            if not state["done"]:
                state["done"] = True
                other = db.connect()
                try:
                    for stmt in db.split_statements(db.load_migrations()[16]):
                        real_apply(other, stmt)
                    other.execute("PRAGMA user_version = 17")
                finally:
                    other.close()
                raise error
            real_apply(conn, statement)

        return mock.patch.object(db, "_apply_statement", racing)

    def test_solo_tolera_los_errores_de_la_carrera_de_arranque(self):
        for message in ("duplicate column name: direction", "table short_positions already exists", "database is locked"):
            with self.subTest(message):
                self.setUp()  # base nueva en cada vuelta
                with self.carrera(RuntimeError(message)), mock.patch.object(db.time, "sleep"):
                    db.init_db()  # no lanza: otra instancia la aplicó y la versión ya la incluye
                self.assertEqual(db.schema_status()["current"], len(db.load_migrations()))

    def test_cualquier_otro_error_sigue_tumbando_el_arranque(self):
        for message in ("near \"ALTER\": syntax error", "UNIQUE constraint failed: users.email", "disk I/O error", "fallo real"):
            with self.subTest(message):
                self.setUp()
                # Aunque otra instancia hubiera subido la versión, un error que no es de la carrera no se traga
                with self.carrera(RuntimeError(message)), mock.patch.object(db.time, "sleep"):
                    with self.assertRaises(RuntimeError) as ctx:
                        db.init_db()
                self.assertEqual(str(ctx.exception), message)

    def test_error_de_carrera_pero_sin_que_nadie_la_haya_aplicado_sigue_siendo_error(self):
        self.at_version_16()
        with mock.patch.object(db, "_apply_statement", side_effect=RuntimeError("database is locked")), mock.patch.object(db.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "locked"):
                db.init_db()
        self.assertEqual(db.schema_status()["current"], 16, "se deshizo: la migración no quedó a medias")

    def test_un_error_real_sigue_siendo_un_error(self):
        self.at_version_16()
        with mock.patch.object(db, "_apply_statement", side_effect=RuntimeError("fallo real")), mock.patch.object(db.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "fallo real"):
                db.init_db()
        self.assertEqual(db.schema_status()["current"], 16)

    def test_is_migration_race(self):
        for m in ("duplicate column name: x", "table t already exists", "database is locked", "SQLITE_BUSY"):
            self.assertTrue(db.is_migration_race(RuntimeError(m)), m)
        for m in ("syntax error", "no such table: x", "UNIQUE constraint failed", ""):
            self.assertFalse(db.is_migration_race(RuntimeError(m)), m)


class ApiTest(ApiBase):
    """Recorrido por HTTP, con sesión: abrir un short, ver la cartera, y que el servidor valide los niveles."""

    def setUp(self):
        super().setUp()
        with db.transaction() as conn:
            ledger.ensure_account(conn, self.uid, T0)

    def post(self, **over):
        body = {"clientOrderId": f"api-{self.n:08d}", "symbol": "BTC", "side": "sell", "type": "market", "quantity": "10", "direction": "short", **over}
        self.n += 1
        return self.client.post("/api/orders", json=body)

    n = 1

    def test_recorrido_abrir_ver_y_cerrar(self):
        r = self.post(stopLoss="110", takeProfit="90")
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual((r.json()["order"]["direction"], r.json()["order"]["fill"]["direction"]), ("short", "short"))
        p = self.client.get("/api/portfolio").json()
        self.assertEqual([(x["direction"], x["stopLoss"], x["takeProfit"], x["liquidationPrice"]) for x in p["positions"]], [("short", 110, 90, 200)])
        self.market.last["BTC"] = P(95)
        r = self.post(side="buy")
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(self.client.get("/api/portfolio").json()["positions"], [])

    def test_el_servidor_rechaza_niveles_al_reves(self):
        r = self.post(stopLoss="90")
        self.assertEqual(r.status_code, 400)
        self.assertIn("por encima", r.json()["error"])
        self.assertEqual(self.count("short_positions"), 0)

    def test_saldo_insuficiente_es_400(self):
        r = self.post(quantity="500")
        self.assertEqual(r.status_code, 400)
        self.assertIn("Saldo insuficiente", r.json()["error"])


if __name__ == "__main__":
    unittest.main()
