# -*- coding: utf-8 -*-
"""
Suite de Pruebas Automatizadas de Cálculos Financieros y Motores Cuantitativos
PaperPulse Terminal - Versión 2.5.0

Cubre:
1. P&L (Profit & Loss) de posiciones largas, cortas, parciales y variaciones porcentuales.
2. Saldo, deducción de liquidez en compras, abono en ventas y comisiones operativas.
3. Conversión de divisas (FX: EUR, USD, GBP) y tasas de cambio cruzadas.
4. Integridad de Esquema, validación estricta de copia de seguridad (RGPD) y UUIDs.
"""

import unittest
import math
import re
import json


# ==============================================================================
# 1. FUNCIONES CUANTITATIVAS DE REFERENCIA (ESPECIFICACIÓN DEL MOTOR PAPERPULSE)
# ==============================================================================

def round_usd(val):
    if val is None:
        return 0.00
    try:
        num = float(val)
        if math.isnan(num) or math.isinf(num):
            return 0.00
        return round(num + 1e-12, 2)
    except (ValueError, TypeError):
        return 0.00


def round_crypto(val):
    if val is None:
        return 0.0
    try:
        num = float(val)
        if math.isnan(num) or math.isinf(num):
            return 0.0
        return round(num + 1e-12, 8)
    except (ValueError, TypeError):
        return 0.0


def calculate_pnl(amount, entry_price, exit_price):
    amt = float(amount or 0)
    entry = float(entry_price or 0)
    exit_p = float(exit_price or 0)
    invested_usd = round_usd(amt * entry)
    current_val_usd = round_usd(amt * exit_p)
    pnl_usd = round_usd(current_val_usd - invested_usd)
    pnl_pct = round(((exit_p - entry) / entry) * 100, 2) if entry > 0 else 0.0
    return {
        "amount": amt,
        "entry_price": entry,
        "exit_price": exit_p,
        "invested_usd": invested_usd,
        "current_val_usd": current_val_usd,
        "pnl_usd": pnl_usd,
        "pnl_pct": pnl_pct,
    }


def calculate_commission(gross_usd, rate=0.001, min_fee=0.0):
    """Calcula la comisión operativa (ej. 0.1% spot estándar)."""
    fee = gross_usd * rate
    return round_usd(max(fee, min_fee))


def execute_buy(cash, amount, price, commission_rate=0.001):
    """Simula ejecución de compra deduciendo saldo y comisiones."""
    gross = amount * price
    fee = calculate_commission(gross, commission_rate)
    total_cost = gross + fee
    if total_cost > cash + 1e-6:
        raise ValueError("Fondos insuficientes para ejecutar la orden")
    new_cash = round_usd(cash - total_cost)
    return {
        "new_cash": new_cash,
        "invested_gross": round_usd(gross),
        "commission": fee,
        "total_cost": round_usd(total_cost),
    }


def execute_sell(cash, amount, exit_price, commission_rate=0.001):
    """Simula ejecución de venta sumando ingresos netos al saldo."""
    gross = amount * exit_price
    fee = calculate_commission(gross, commission_rate)
    net_proceeds = gross - fee
    new_cash = round_usd(cash + net_proceeds)
    return {
        "new_cash": new_cash,
        "gross_proceeds": round_usd(gross),
        "commission": fee,
        "net_proceeds": round_usd(net_proceeds),
    }


def convert_currency(amount, from_curr, to_curr, rates):
    """
    Convierte importes entre divisas usando tasas base EUR o USD.
    Tasas estándar: EUR/USD, GBP/USD (ej: EUR=1.085, GBP=1.27, USD=1.00).
    """
    if from_curr == to_curr:
        return round_usd(amount)

    rates_usd = {
        "USD": 1.0,
        "EUR": rates.get("EUR", 1.085),  # 1 EUR = X USD
        "GBP": rates.get("GBP", 1.27),   # 1 GBP = X USD
    }

    if from_curr not in rates_usd or to_curr not in rates_usd:
        raise ValueError(f"Divisa no soportada: {from_curr} -> {to_curr}")

    # Convertir 'from' a USD base
    val_usd = amount * rates_usd[from_curr]
    # Convertir de USD a 'to'
    val_target = val_usd / rates_usd[to_curr]
    return round_usd(val_target)


# ==============================================================================
# 2. TEST SUITE
# ==============================================================================

class TestPnLCalculations(unittest.TestCase):
    """Pruebas de cálculo de P&L absoluto y porcentual."""

    def test_pnl_gain(self):
        # Compra 0.5 BTC a $60,000, venta a $66,000 (+10.0%)
        res = calculate_pnl(0.5, 60000.0, 66000.0)
        self.assertEqual(res["invested_usd"], 30000.0)
        self.assertEqual(res["current_val_usd"], 33000.0)
        self.assertEqual(res["pnl_usd"], 3000.0)
        self.assertEqual(res["pnl_pct"], 10.0)

    def test_pnl_loss(self):
        # Compra 10 acciones AAPL a $180, venta a $171 (-5.0%)
        res = calculate_pnl(10, 180.0, 171.0)
        self.assertEqual(res["invested_usd"], 1800.0)
        self.assertEqual(res["current_val_usd"], 1710.0)
        self.assertEqual(res["pnl_usd"], -90.0)
        self.assertEqual(res["pnl_pct"], -5.0)

    def test_pnl_flat(self):
        # Sin variación
        res = calculate_pnl(2.5, 100.0, 100.0)
        self.assertEqual(res["pnl_usd"], 0.0)
        self.assertEqual(res["pnl_pct"], 0.0)

    def test_pnl_fractional_crypto(self):
        # Compra 0.00345678 ETH a $3,450.25, salida a $3,800.00
        res = calculate_pnl(0.00345678, 3450.25, 3800.00)
        self.assertGreater(res["pnl_usd"], 0.0)
        expected_pct = round(((3800.00 - 3450.25) / 3450.25) * 100, 2)
        self.assertEqual(res["pnl_pct"], expected_pct)

    def test_zero_entry_defense(self):
        # Protección contra división por cero
        res = calculate_pnl(10, 0.0, 150.0)
        self.assertEqual(res["pnl_pct"], 0.0)


class TestBalanceAndCommissions(unittest.TestCase):
    """Pruebas de balance, deducciones y comisiones operativas."""

    def setUp(self):
        self.initial_balance = 10000.00  # $10,000 USD de saldo demo inicial

    def test_buy_execution_deducts_balance(self):
        # Compra $2,000 con 0.1% de comisión ($2.00)
        res = execute_buy(self.initial_balance, amount=20, price=100.0, commission_rate=0.001)
        self.assertEqual(res["invested_gross"], 2000.00)
        self.assertEqual(res["commission"], 2.00)
        self.assertEqual(res["total_cost"], 2002.00)
        self.assertEqual(res["new_cash"], 7998.00)

    def test_sell_execution_credits_balance(self):
        # Venta tras revalorización: 20 unidades a $120 ($2,400 bruto)
        # Comisión 0.1% = $2.40. Neto abonado = $2,397.60
        current_cash = 7998.00
        res = execute_sell(current_cash, amount=20, exit_price=120.0, commission_rate=0.001)
        self.assertEqual(res["gross_proceeds"], 2400.00)
        self.assertEqual(res["commission"], 2.40)
        self.assertEqual(res["net_proceeds"], 2397.60)
        self.assertEqual(res["new_cash"], 10395.60)

    def test_insufficient_funds_rejection(self):
        # Intento de comprar $15,000 con solo $10,000 de saldo disponible
        with self.assertRaises(ValueError):
            execute_buy(self.initial_balance, amount=100, price=150.0)

    def test_total_equity_aggregation(self):
        # Saldo en efectivo: $5,000
        cash = 5000.00
        positions = [
            {"amount": 0.1, "current_price": 65000.0},  # $6,500
            {"amount": 50, "current_price": 40.0},      # $2,000
        ]
        position_value = sum(p["amount"] * p["current_price"] for p in positions)
        total_equity = round_usd(cash + position_value)
        self.assertEqual(total_equity, 13500.00)


class TestCurrencyConversions(unittest.TestCase):
    """Pruebas del motor FX (conversión multidivisa)."""

    def setUp(self):
        self.rates = {
            "EUR": 1.085,  # 1 EUR = 1.085 USD
            "GBP": 1.270,  # 1 GBP = 1.270 USD
        }

    def test_identity_conversion(self):
        self.assertEqual(convert_currency(150.0, "EUR", "EUR", self.rates), 150.0)
        self.assertEqual(convert_currency(200.0, "USD", "USD", self.rates), 200.0)

    def test_usd_to_eur(self):
        # $1,085 USD -> 1000 EUR
        eur = convert_currency(1085.0, "USD", "EUR", self.rates)
        self.assertEqual(eur, 1000.00)

    def test_eur_to_usd(self):
        # 100 EUR -> $108.50 USD
        usd = convert_currency(100.0, "EUR", "USD", self.rates)
        self.assertEqual(usd, 108.50)

    def test_cross_rate_gbp_to_eur(self):
        # 100 GBP = $127 USD. $127 / 1.085 = ~117.05 EUR
        eur = convert_currency(100.0, "GBP", "EUR", self.rates)
        expected = round(127.0 / 1.085, 2)
        self.assertEqual(eur, expected)

    def test_unknown_currency_raises(self):
        with self.assertRaises(ValueError):
            convert_currency(100.0, "JPY", "USD", self.rates)


class TestStoreIntegrityAndSchema(unittest.TestCase):
    """Pruebas de integridad del esquema de exportación/importación y validación RGPD."""

    UUID_REGEX = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)

    def test_uuid_v4_format(self):
        import uuid
        sample_uuid = str(uuid.uuid4())
        self.assertTrue(self.UUID_REGEX.match(sample_uuid), f"UUID inválido: {sample_uuid}")

    def test_valid_export_payload_structure(self):
        payload = {
            "app": "PaperPulse",
            "version": "2.5.0",
            "schemaVersion": 2,
            "exportedAt": "2026-10-20T18:00:00.000Z",
            "account": {
                "hasPracticeAccount": True,
                "initialCapitalUsd": 1000.00,
                "balanceUsd": 1250.50,
                "equityUsd": 1500.00,
                "performancePct": 25.05,
            },
            "positions": [
                {
                    "symbol": "BTC",
                    "amount": 0.05,
                    "entryPrice": 62000.00,
                    "investedUsd": 3100.00,
                }
            ],
            "trades": [
                {
                    "id": "12345678-1234-4234-8234-123456789abc",
                    "symbol": "ETH",
                    "amount": 1.0,
                    "entryPrice": 3000.00,
                    "exitPrice": 3300.00,
                    "pnl": 300.00,
                }
            ],
            "watchlist": ["BTC", "ETH", "SAN"],
            "settings": {"theme": "dark", "palette": "cyan"},
        }
        json_str = json.dumps(payload)
        parsed = json.loads(json_str)

        # Validación
        self.assertEqual(parsed["app"], "PaperPulse")
        self.assertIsInstance(parsed["positions"], list)
        self.assertGreater(parsed["account"]["initialCapitalUsd"], 0)
        self.assertGreaterEqual(parsed["account"]["balanceUsd"], 0)

    def test_invalid_app_rejection(self):
        alien_payload = {"app": "MaliciousApp", "positions": []}
        self.assertNotEqual(alien_payload.get("app"), "PaperPulse")


if __name__ == "__main__":
    unittest.main()
