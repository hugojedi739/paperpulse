# -*- coding: utf-8 -*-
"""
Suite de Pruebas Automatizadas del Filtro Positivo de Noticias Financieras
PaperPulse Terminal
========================================================================
Verifica:
1. Aceptación de titulares financieros válidos (bolsa, acciones, bitcoin, tipos de interés,
   inflación, dividendos, resultados, OPA, etc.).
2. Aceptación de titulares que mencionan palabras que antes eran bloqueadas erróneamente
   por coincidencia parcial ("clima de inversión", "pesca de oportunidades", etc.).
3. Rechazo estricto de titulares irrelevantes (recetas, moda, deportes, farándula, horóscopos).
4. Correcta categorización ('crypto', 'stocks', 'economy') y soporte de categorías del feed.
"""

import unittest
from server import is_financial_headline

class TestNewsFilter(unittest.TestCase):

    def test_01_valid_financial_headlines_accepted(self):
        """Verifica que titulares financieros reales son aceptados correctamente."""
        valid_headlines = [
            ("El Ibex 35 sube un 0,5% impulsado por los resultados de Banco Santander", "stocks"),
            ("La Fed mantiene los tipos de interés ante la persistencia de la inflación", "economy"),
            ("Inditex bate récord de ventas y eleva su dividendo un 15%", "stocks"),
            ("El BCE abre la puerta a una nueva bajada de tipos de interés en diciembre", "economy"),
            ("Bitcoin supera los 68.000 dólares impulsado por la entrada en ETFs al contado", "crypto"),
            ("Nvidia presenta resultados trimestrales récord y bate previsiones de Wall Street", "stocks"),
            ("BBVA eleva su beneficio atribuido un 24% y mejora previsiones para 2026", "stocks"),
            ("El IPC de la eurozona desciende hasta el objetivo del 2% en septiembre", "economy"),
            ("Telefónica acelera su plan estratégico y confirma el pago del dividendo", "stocks"),
            ("Ethereum sube con fuerza tras el incremento de transacciones en la red", "crypto"),
            ("La CNMV autoriza la OPA voluntaria sobre las acciones de la compañía", "stocks"),
            ("El barril de petróleo Brent cotiza a la baja por el aumento de inventarios", "economy"),
        ]

        for title, expected_cat in valid_headlines:
            with self.subTest(title=title):
                is_fin, cat = is_financial_headline(title)
                self.assertTrue(is_fin, f"Titular válido descartado erróneamente: '{title}'")
                self.assertEqual(cat, expected_cat, f"Categoría incorrecta para '{title}'. Esperada {expected_cat}, obtenida {cat}")

    def test_02_previously_false_negatives_now_accepted(self):
        """Verifica que titulares financieros legítimos con palabras como 'clima' no son descartados."""
        subtle_headlines = [
            ("El clima de inversión en Europa mejora tras los datos de inflación", "economy"),
            ("El clima empresarial se recupera gracias a la estabilidad de tipos de interés", "economy"),
            ("Los fondos pescan gangas en la bolsa española tras la corrección", "stocks"),
            ("La moda del trading algorítmico impulsa los volúmenes en Wall Street", "stocks")
        ]

        for title, expected_cat in subtle_headlines:
            with self.subTest(title=title):
                is_fin, cat = is_financial_headline(title)
                self.assertTrue(is_fin, f"Titular financiero descartado por coincidencia parcial: '{title}'")

    def test_03_irrelevant_headlines_rejected(self):
        """Verifica que noticias sin relación con mercados ni finanzas son rechazadas."""
        irrelevant_headlines = [
            "La nueva moda de vestidos de verano para la temporada que viene",
            "Los mejores consejos para una jornada de pesca deportiva en el río",
            "Receta de tarta de manzana casera con el mejor sabor tradicional",
            "El Real Madrid prepara un nuevo fichaje estelar para la delantera",
            "Pronóstico del tiempo y alerta meteorológica por fuertes lluvias este fin de semana",
            "Entrevista exclusiva con la celebridad del momento en la alfombra roja",
            "Horóscopo semanal: lo que los astros deparan a cada signo del zodiaco",
            "Gran fiesta gastronómica y concurso de paellas en las fiestas del pueblo",
            "El festival de música confirma su cartel completo de artistas",
            "Descubre los secretos de belleza para el cuidado diario de la piel"
        ]

        for title in irrelevant_headlines:
            with self.subTest(title=title):
                is_fin, _ = is_financial_headline(title)
                self.assertFalse(is_fin, f"Titular irrelevante admitido erróneamente: '{title}'")

    def test_04_feed_category_support(self):
        """Verifica que las categorías oficiales del feed RSS permiten validar y clasificar noticias."""
        # Titular con texto ambiguo pero con categoría oficial del feed 'markets'
        is_fin, cat = is_financial_headline("Análisis matinal de la apertura europea", feed_categories=["markets"])
        self.assertTrue(is_fin)
        self.assertEqual(cat, "stocks")

        # Titular con categoría 'crypto'
        is_fin, cat = is_financial_headline("Resumen semanal de la industria de activos digitales", feed_categories=["cryptocurrency"])
        self.assertTrue(is_fin)
        self.assertEqual(cat, "crypto")

if __name__ == "__main__":
    unittest.main()
