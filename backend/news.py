"""Noticias financieras reales (RSS) con filtro positivo de temas y clasificación."""
import sys
import time
import asyncio
import datetime
import re
import html
import urllib.request
import email.utils
import xml.etree.ElementTree as ET
from typing import Dict, Any, List, Tuple

from starlette.responses import JSONResponse

from backend.security import IP_STOCK_CALLS, check_ip_rate_limit, get_client_ip

# ==============================================================================
# Feed de Noticias Financieras Reales (CoinDesk + Google News Economía/Bolsa)
# ==============================================================================
MAX_FEED_BYTES = 3_000_000  # un feed mayor se corta (y el XML truncado se descarta): acota memoria ante un origen anómalo
NEWS_CACHE = {
    "timestamp": 0,
    "articles": []
}

def safe_http_url(url: str) -> str:
    """Devuelve la URL solo si es http(s); evita esquemas como javascript: en enlaces de terceros."""
    url = (url or "").strip()
    return url if re.match(r"^https?://", url, re.I) else ""

def clean_html_text(raw_text: str) -> str:
    """Elimina etiquetas HTML y entidades para titulares y resúmenes limpios."""
    if not raw_text:
        return ""
    clean = re.sub(r'<[^>]+>', ' ', raw_text)
    clean = html.unescape(clean)
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean

def parse_rss_datetime(date_str: str) -> str:
    """Convierte fechas RFC 2822 a ISO 8601 con fallback seguro."""
    if not date_str:
        return datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        dt = email.utils.parsedate_to_datetime(date_str)
        return dt.isoformat()
    except Exception:
        return datetime.datetime.now(datetime.timezone.utc).isoformat()

# ==============================================================================
# Filtro de Noticias Financieras y Clasificación por Temas Reales
# ==============================================================================
FINANCIAL_TOPICS = {
    "crypto": [
        r"\bbitcoin\b", r"\bbtc\b", r"\bethereum\b", r"\beth\b", r"\bsolana\b", r"\bsol\b",
        r"\bcripto\b", r"\bcrypto\b", r"\bcriptomoneda[s]?\b", r"\bblockchain\b",
        r"\bbinance\b", r"\bcoinbase\b", r"\bhalving\b", r"\betf[s]?\b", r"\btoken[s]?\b",
        r"\bcardano\b", r"\bripple\b", r"\bxrp\b", r"\bdogecoin\b"
    ],
    "stocks": [
        r"\bbolsa\b", r"\bbolsas\b", r"\bacci[oó]n\b", r"\bacciones\b", r"\bibex\b", r"\bibex 35\b",
        r"\bwall street\b", r"\bnasdaq\b", r"\bnyse\b", r"\bdow jones\b", r"\beurostoxx\b",
        r"\bdax\b", r"\bbme\b", r"\bcnmv\b", r"\bsec\b", r"\bs&p\b", r"\bs&p 500\b",
        r"\bdividendo[s]?\b", r"\bearnings\b",
        r"\bbpa\b", r"\bebitda\b", r"\bcapitalizac[ií][oó]n\b", r"\bopa\b", r"\bfusi[oó]n\b",
        r"\badquisici[oó]n\b", r"\bjunta de accionistas\b", r"\bsalida a bolsa\b", r"\bipo\b",
        r"\bsantander\b", r"\bbbva\b", r"\binditex\b", r"\brepsol\b", r"\btelef[oó]nica\b",
        r"\biberdrola\b", r"\bcaixabank\b", r"\bapple\b", r"\bnvidia\b", r"\btesla\b",
        r"\bmicrosoft\b", r"\bamazon\b", r"\bgoogle\b", r"\balphabet\b", r"\bmeta\b"
    ],
    "economy": [
        r"\btipo[s]? de inter[eé]s\b", r"\btasa[s]? de inter[eé]s\b",
        r"\binflac[ií][oó]n\b", r"\bipc\b", r"\bdeflac[ií][oó]n\b", r"\bestanflac[ií][oó]n\b",
        r"\bbce\b", r"\bfed\b", r"\breserva federal\b", r"\bbanco central\b", r"\bpol[ií]tica monetaria\b",
        r"\beuribor\b", r"\bdeuda\b", r"\bbono[s]?\b", r"\btesoro\b", r"\brendimiento[s]?\b",
        r"\bpib\b", r"\brecesi[oó]n\b", r"\bcrecimiento econ[oó]mico\b", r"\bempleo\b", r"\bdesempleo\b",
        r"\barancel\b", r"\baranceles\b", r"\bcomercio exterior\b", r"\bexportac[ií][oó]n\b",
        r"\bexportaciones\b", r"\bimportac[ií][oó]n\b", r"\bimportaciones\b",
        r"\bpetr[oó]leo\b", r"\bbrent\b", r"\bcrudo\b", r"\bgas natural\b", r"\boro\b",
        r"\bdivisa[s]?\b", r"\bd[oó]lar\b", r"\beuro[s]?\b", r"\bforex\b",
        r"\bcotizac[ií][oó]n\b", r"\bcotiza[n]?\b",
        r"\binversi[oó]n\b", r"\binversores\b", r"\bmercado financiero\b", r"\bmercados financieros\b",
        r"\bclima econ[oó]mico\b", r"\bclima empresarial\b", r"\bclima de inversi[oó]n\b", r"\bclima de negocios\b"
    ]
}

FINANCIAL_FEED_CATEGORIES = {
    "crypto": {"crypto", "cryptocurrency", "bitcoin", "blockchain", "altcoin", "web3", "defi"},
    "stocks": {"stocks", "equities", "markets", "bursatil", "mercados", "acciones", "wall street"},
    "economy": {"business", "economy", "economics", "finance", "finanzas", "economía", "macro"}
}

def is_financial_headline(title: str, feed_categories: List[str] = None) -> Tuple[bool, str]:
    """Determina si un titular es genuinamente financiero utilizando temas permitidos y categorías oficiales."""
    if not title:
        return False, "economy"

    lower_title = title.lower()
    categories_clean = [c.lower().strip() for c in (feed_categories or []) if c]

    # 1. Comprobar categorías oficiales del feed
    for cat_name, keywords in FINANCIAL_FEED_CATEGORIES.items():
        if any(cat in keywords or any(kw in cat for kw in keywords) for cat in categories_clean):
            return True, cat_name

    # 2. Comprobar patrones financieros permitidos
    for cat_name, patterns in FINANCIAL_TOPICS.items():
        for pat in patterns:
            if re.search(pat, lower_title, re.IGNORECASE):
                # Refinar: si es catalogado como economy pero menciona stocks o crypto
                if cat_name == "economy":
                    if any(re.search(p, lower_title, re.IGNORECASE) for p in FINANCIAL_TOPICS["stocks"]):
                        return True, "stocks"
                    if any(re.search(p, lower_title, re.IGNORECASE) for p in FINANCIAL_TOPICS["crypto"]):
                        return True, "crypto"
                return True, cat_name

    return False, "economy"

def fetch_real_news_sync() -> List[Dict[str, Any]]:
    """Consulta feeds RSS oficiales de información financiera (CoinDesk + Google News Economía/Bolsa).
    Cero noticias inventadas, solo titulares reales, medio oficial, enlace original y fecha verificada."""
    articles = []
    seen_urls = set()
    art_id = 1

    # 1. Criptomonedas: CoinDesk RSS Oficial
    try:
        req = urllib.request.Request(
            "https://www.coindesk.com/arc/outboundfeeds/rss/",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PaperPulseTerminal/2.4"}
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            root = ET.fromstring(resp.read(MAX_FEED_BYTES))
            items = root.findall(".//item")
            for item in items[:20]:
                title = clean_html_text(item.findtext("title", ""))
                link = item.findtext("link", "").strip()
                pub_date = parse_rss_datetime(item.findtext("pubDate", ""))
                desc = clean_html_text(item.findtext("description", ""))
                creator = clean_html_text(item.findtext("{http://purl.org/dc/elements/1.1/}creator", "")) or "CoinDesk"

                img_url = ""
                media_content = item.find("{http://search.yahoo.com/mrss/}content")
                if media_content is not None and media_content.get("url"):
                    img_url = media_content.get("url")

                if title and link and link not in seen_urls:
                    seen_urls.add(link)
                    articles.append({
                        "id": art_id,
                        "title": title,
                        "excerpt": desc[:220] + ("..." if len(desc) > 220 else ""),
                        "category": "crypto",
                        "source": "CoinDesk",
                        "author": creator,
                        "date": pub_date,
                        "url": safe_http_url(link),
                        "imageUrl": safe_http_url(img_url)
                    })
                    art_id += 1
    except Exception as e:
        print(f"[News] Error consultando feed de CoinDesk: {e}", file=sys.stderr)

    # 2. Bolsa y Economía en Español: Google News Business España
    try:
        req = urllib.request.Request(
            "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=es&gl=ES&ceid=ES:es",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PaperPulseTerminal/2.4"}
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            root = ET.fromstring(resp.read(MAX_FEED_BYTES))
            items = root.findall(".//item")
            for item in items[:25]:
                raw_title = clean_html_text(item.findtext("title", ""))
                link = item.findtext("link", "").strip()
                pub_date = parse_rss_datetime(item.findtext("pubDate", ""))

                source_el = item.find("source")
                source_name = source_el.text.strip() if (source_el is not None and source_el.text) else "Google News"

                title = raw_title
                if " - " in title:
                    parts = title.rsplit(" - ", 1)
                    title = parts[0].strip()
                    if not source_name or source_name == "Google News":
                        source_name = parts[1].strip()

                # Extracción de categorías oficiales del feed RSS
                feed_categories = [c.text.strip().lower() for c in item.findall("category") if c is not None and c.text]

                # Filtro positivo de relevancia financiera basado en temas permitidos y categorías del feed
                is_fin, cat = is_financial_headline(title, feed_categories)
                if not is_fin:
                    continue

                if title and link and link not in seen_urls:
                    seen_urls.add(link)
                    articles.append({
                        "id": art_id,
                        "title": title,
                        "excerpt": f"Información de mercado y actualidad económica reportada por {source_name}.",
                        "category": cat,
                        "source": source_name,
                        "author": source_name,
                        "date": pub_date,
                        "url": safe_http_url(link),
                        "imageUrl": ""
                    })
                    art_id += 1
    except Exception as e:
        print(f"[News] Error consultando feed de Google News: {e}", file=sys.stderr)

    # Ordenar cronológicamente descendente
    articles.sort(key=lambda x: x["date"], reverse=True)
    for i, a in enumerate(articles, 1):
        a["id"] = i

    return articles

async def api_news(request):
    """Retorna noticias financieras y de criptomonedas 100% reales desde fuentes oficiales."""
    client_ip = get_client_ip(request)
    if not check_ip_rate_limit(client_ip, IP_STOCK_CALLS, max_calls_per_minute=120):
        return JSONResponse({"status": "error", "error": "Límite de peticiones excedido por minuto (máx. 120)."}, status_code=429, headers={"Retry-After": "60"})

    now = time.time()
    if now - NEWS_CACHE["timestamp"] < 900 and NEWS_CACHE["articles"]:
        articles = NEWS_CACHE["articles"]
    else:
        loop = asyncio.get_running_loop()
        fresh_articles = await loop.run_in_executor(None, fetch_real_news_sync)
        if fresh_articles:
            NEWS_CACHE["articles"] = fresh_articles
            NEWS_CACHE["timestamp"] = now
            articles = fresh_articles
        else:
            articles = NEWS_CACHE["articles"]

    category = request.query_params.get("category", "all").lower().strip()
    if category != "all":
        filtered = [a for a in articles if a["category"] == category]
    else:
        filtered = articles

    return JSONResponse({
        "status": "success",
        "count": len(filtered),
        "updated_at": NEWS_CACHE["timestamp"],
        "articles": filtered
    })
