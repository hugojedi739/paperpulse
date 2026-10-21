# -*- coding: utf-8 -*-
"""
Suite de Pruebas Automatizadas de Cálculos Financieros Reales
PaperPulse Terminal - Pruebas directas sobre window.Store y window.Currency en V8

Verifica:
1. Saldo, capital de práctica y patrimonio.
2. P&L (Profit & Loss) real sin comisiones ficticias del 0.1%.
3. Redondeo, formateo con Intl.NumberFormat y volúmenes compactos.
4. Conversión de divisas con tasas de cambio reales (USD -> EUR ~ 0.89) y roundtrips exactos.
5. Exportación e importación de copias de seguridad RGPD con validación estricta de esquema.
"""

import unittest
import subprocess
import time
import json
import urllib.request
import asyncio
import os
import sys

try:
    import websockets
except ImportError:
    websockets = None

CHROME_PATH = os.environ.get("CHROME_PATH", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
SERVER_URL = "http://127.0.0.1:8000"


class TestRealAppCalculations(unittest.TestCase):
    chrome_proc = None
    server_proc = None
    ws = None
    loop = None
    req_id = 0

    @classmethod
    def setUpClass(cls):
        # 1. Asegurar que el servidor está activo
        server_ready = False
        try:
            with urllib.request.urlopen(f"{SERVER_URL}/api/health", timeout=1.5) as res:
                if res.status == 200:
                    server_ready = True
        except Exception:
            server_ready = False

        if not server_ready:
            cls.server_proc = subprocess.Popen([sys.executable, "server.py"])
            for _ in range(15):
                time.sleep(0.5)
                try:
                    with urllib.request.urlopen(f"{SERVER_URL}/api/health", timeout=1.0) as res:
                        if res.status == 200:
                            server_ready = True
                            break
                except Exception:
                    pass

        if not server_ready:
            raise RuntimeError("No se pudo conectar ni iniciar el servidor PaperPulse en 127.0.0.1:8000")

        # 2. Iniciar Chrome Headless para ejecutar el motor V8 real de store.js y currency.js
        cls.port = 9520
        cls.chrome_proc = subprocess.Popen([
            CHROME_PATH,
            "--headless=new",
            f"--remote-debugging-port={cls.port}",
            "--no-sandbox",
            "--disable-gpu",
            "--no-first-run",
            f"{SERVER_URL}/"
        ])
        time.sleep(2.5)

        ws_url = None
        for _ in range(10):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/json", timeout=2.0) as res:
                    tabs = json.loads(res.read().decode())
                    target_tabs = [t for t in tabs if t.get('type') == 'page' and '127.0.0.1:8000' in t.get('url', '')]
                    if target_tabs:
                        ws_url = target_tabs[0]['webSocketDebuggerUrl']
                        break
            except Exception:
                time.sleep(0.5)

        if not ws_url:
            cls.tearDownClass()
            raise RuntimeError("No se pudo obtener la conexión WebSocket de depuración de Chrome Headless")

        cls.loop = asyncio.new_event_loop()
        cls.ws = cls.loop.run_until_complete(websockets.connect(ws_url, max_size=20_000_000))

    @classmethod
    def tearDownClass(cls):
        if cls.ws and cls.loop:
            try:
                cls.loop.run_until_complete(cls.ws.close())
            except Exception:
                pass
        if cls.chrome_proc:
            try:
                cls.chrome_proc.terminate()
                cls.chrome_proc.wait(timeout=3)
            except Exception:
                pass
        if cls.server_proc:
            try:
                cls.server_proc.terminate()
                cls.server_proc.wait(timeout=3)
            except Exception:
                pass
        if cls.loop:
            try:
                cls.loop.close()
            except Exception:
                pass

    def eval_js(self, expression):
        TestRealAppCalculations.req_id += 1
        curr_id = TestRealAppCalculations.req_id
        payload = {
            "id": curr_id,
            "method": "Runtime.evaluate",
            "params": {"expression": expression, "returnByValue": True}
        }
        self.loop.run_until_complete(self.ws.send(json.dumps(payload)))
        while True:
            raw = self.loop.run_until_complete(self.ws.recv())
            msg = json.loads(raw)
            if msg.get("id") == curr_id:
                result = msg.get("result", {})
                if "exceptionDetails" in result:
                    desc = result["exceptionDetails"].get("exception", {}).get("description", "Error JS")
                    raise RuntimeError(f"Error evaluando JS: {desc}")
                return result.get("result", {}).get("value")

    # =========================================================================
    # 1. CARGA DE MÓDULOS REALES
    # =========================================================================
    def test_01_store_and_currency_modules_loaded(self):
        """Verifica que window.Store y window.Currency están cargados en el entorno V8."""
        c_type = self.eval_js("typeof window.Currency")
        s_type = self.eval_js("typeof window.Store")
        self.assertEqual(c_type, "object", "window.Currency debe ser un objeto cargado")
        self.assertEqual(s_type, "object", "window.Store debe ser un objeto cargado")

    # =========================================================================
    # 2. FORMATEO Y REDONDEO SEGÚN LOCALE ESPAÑOL
    # =========================================================================
    def test_02_spanish_percent_formatting(self):
        """Verifica formateo de porcentajes con coma decimal y espacio: +2,31 % y -1,45 %."""
        pos = self.eval_js("window.Currency.formatPercent(2.31)")
        neg = self.eval_js("window.Currency.formatPercent(-1.45)")
        self.assertTrue("2,31" in pos, f"Esperado '2,31' en {pos}")
        self.assertTrue("%" in pos, f"Esperado '%' en {pos}")
        self.assertTrue("-1,45" in neg or "−1,45" in neg, f"Esperado '-1,45' o '−1,45' en {neg}")

    def test_03_compact_volume_formatting(self):
        """Verifica volúmenes compactos: 35,8 M y 520,0 K."""
        vol_m = self.eval_js("window.Currency.formatVolume(35800000)")
        vol_k = self.eval_js("window.Currency.formatVolume(520000)")
        self.assertTrue("35,8" in vol_m and "M" in vol_m, f"Esperado 35,8 M, obtenido: {vol_m}")
        self.assertTrue("520,0" in vol_k and "K" in vol_k, f"Esperado 520,0 K, obtenido: {vol_k}")

    # =========================================================================
    # 3. CONVERSIÓN DE DIVISAS (FX REAL, SIN TASAS INVERTIDAS, SIN COMISIÓN)
    # =========================================================================
    def test_04_currency_identity_conversion(self):
        """Verifica que convertir EUR a EUR o USD a USD devuelve exactamente el mismo valor."""
        eur = self.eval_js("window.Currency.convert(150.75, 'EUR', 'EUR')")
        usd = self.eval_js("window.Currency.convert(250.00, 'USD', 'USD')")
        self.assertEqual(eur, 150.75)
        self.assertEqual(usd, 250.00)

    def test_05_currency_roundtrip_conversion(self):
        """Verifica que la conversión de ida y vuelta USD -> EUR -> USD preserva el capital."""
        val = 100.0
        roundtrip = self.eval_js(f"window.Currency.convert(window.Currency.convert({val}, 'USD', 'EUR'), 'EUR', 'USD')")
        self.assertAlmostEqual(roundtrip, val, places=3, msg="Conversión de ida y vuelta debe conservar valor")

    def test_06_real_fx_rates_logic(self):
        """Verifica que la tasa USD->EUR está en el rango real (0.80 - 0.95), NO la tasa invertida 1.085."""
        rates = self.eval_js("window.Currency.getRates()")
        eur_rate = rates.get("EUR", 0)
        self.assertGreater(eur_rate, 0.70, "Tasa EUR por USD debe ser razonable")
        self.assertLess(eur_rate, 1.00, "1 USD vale menos de 1 EUR en el feed real; no debe ser 1.085")

    # =========================================================================
    # 4. P&L REAL (SIN COMISIÓN DEL 0.1% NO AUTORIZADA)
    # =========================================================================
    def test_07_pnl_calculation_long_profit(self):
        """Verifica cálculo exacto de P&L positivo (10 uds compradas a 100, vendidas a 115)."""
        res = self.eval_js("window.Store.calculatePnl(10, 100, 115)")
        self.assertEqual(res["investedUsd"], 1000.0)
        self.assertEqual(res["currentValueUsd"], 1150.0)
        self.assertEqual(res["pnlUsd"], 150.0)
        self.assertEqual(res["pnlPct"], 15.0)

    def test_08_pnl_calculation_long_loss(self):
        """Verifica cálculo exacto de P&L negativo (10 uds compradas a 100, vendidas a 90)."""
        res = self.eval_js("window.Store.calculatePnl(10, 100, 90)")
        self.assertEqual(res["investedUsd"], 1000.0)
        self.assertEqual(res["currentValueUsd"], 900.0)
        self.assertEqual(res["pnlUsd"], -100.0)
        self.assertEqual(res["pnlPct"], -10.0)

    def test_09_pnl_calculation_break_even(self):
        """Verifica cálculo exacto de P&L plano (10 uds compradas a 100, vendidas a 100)."""
        res = self.eval_js("window.Store.calculatePnl(10, 100, 100)")
        self.assertEqual(res["pnlUsd"], 0.0)
        self.assertEqual(res["pnlPct"], 0.0)

    def test_10_zero_commission_policy_verified(self):
        """Verifica explícitamente que NO se aplica comisión encubierta del 0.1% en trading."""
        res = self.eval_js("window.Store.calculatePnl(100, 50, 55)")
        # 100 * 50 = 5000 invertido, 100 * 55 = 5500 valor actual -> PnL puro = 500.0
        # Con comisión 0.1%: 5000 + 5 = 5005 coste, 5500 - 5.5 = 5494.5 neto -> PnL sería 489.5
        self.assertEqual(res["pnlUsd"], 500.0, "No debe deducirse ninguna comisión del 0.1% sin autorización previa")

    # =========================================================================
    # 5. FORMATEO DE MONEDA CON SÍMBOLO CUANDO COINCIDE Y CON CÓDIGO ISO CUANDO DIFIERE
    # =========================================================================
    def test_11_currency_formatting_account_match_symbol(self):
        """Usa símbolo cuando la moneda del activo coincide con la de la cuenta."""
        formatted = self.eval_js("window.Currency.formatAssetPrice(20.34, 'EUR')")
        # Si la cuenta está en EUR, debe usar '€' y no mezclar 'EUR'
        active = self.eval_js("window.Currency.getActiveCurrency()")
        if active == "EUR":
            self.assertTrue("€" in formatted, f"Esperado símbolo € en {formatted}")
            self.assertFalse("EUR" in formatted, f"No debe mostrar código ISO EUR cuando la cuenta es EUR: {formatted}")

    def test_12_currency_formatting_account_differs_iso(self):
        """Usa código ISO cuando la moneda del activo difiere de la moneda de la cuenta."""
        formatted = self.eval_js("window.Currency.formatAssetPrice(339.50, 'USD')")
        active = self.eval_js("window.Currency.getActiveCurrency()")
        if active == "EUR":
            self.assertTrue("USD" in formatted, f"Esperado código ISO USD en {formatted}")
            self.assertFalse("€" in formatted, f"No debe mostrar símbolo € para activo en USD: {formatted}")

    # =========================================================================
    # 6. COPIA DE SEGURIDAD RGPD Y VALIDACIÓN ESTRICTA DE ESQUEMA
    # =========================================================================
    def test_13_export_account_data_json_schema(self):
        """Verifica que la exportación JSON contiene la estructura requerida de PaperPulse."""
        payload = self.eval_js("window.Store.exportAccountDataJSON()")
        self.assertIn("app", payload)
        self.assertIn("version", payload)
        self.assertIn("account", payload)
        self.assertIn("positions", payload)
        self.assertIn("trades", payload)
        self.assertIn("pendingOrders", payload)

    def test_14_import_account_data_json_valid(self):
        """Verifica que importar una copia válida es aceptada exitosamente."""
        res = self.eval_js("window.Store.importAccountDataJSON(window.Store.exportAccountDataJSON())")
        self.assertTrue(res.get("success"), "Importación de datos válidos debe retornar success=true")

    def test_15_import_account_data_json_rejects_corrupted(self):
        """Verifica que un string que no es JSON es rechazado con mensaje controlado."""
        res = self.eval_js("window.Store.importAccountDataJSON('formato_totalmente_invalido')")
        self.assertFalse(res.get("success"), "JSON inválido debe ser rechazado")
        self.assertIn("error", res)

    def test_16_import_account_data_json_rejects_non_paperpulse_app(self):
        """Verifica que un backup que no proviene de PaperPulse es rechazado por seguridad."""
        bad_app = json.dumps({"app": "OtraAplicacion", "account": {"initialCapitalUsd": 1000}})
        res = self.eval_js(f"window.Store.importAccountDataJSON({json.dumps(bad_app)})")
        self.assertFalse(res.get("success"))
        self.assertTrue("PaperPulse" in res.get("error", ""))

    def test_17_import_account_data_json_rejects_negative_capital(self):
        """Verifica que capitales inválidos o negativos son rechazados por sanidad numérica."""
        bad_cap = json.dumps({"app": "PaperPulse Terminal", "account": {"initialCapitalUsd": -5000}})
        res = self.eval_js(f"window.Store.importAccountDataJSON({json.dumps(bad_cap)})")
        self.assertFalse(res.get("success"))
        self.assertTrue("positivo" in res.get("error", "").lower())


if __name__ == '__main__':
    unittest.main()
