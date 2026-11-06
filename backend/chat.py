"""Asistente con Claude: streaming SSE, desafío anti-bot y control de gasto."""
import sys
import json
import time
import asyncio
import hmac
import hashlib
import secrets

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse, StreamingResponse

from backend import ai_usage, chat_fixed, settings
from backend.config import ANTHROPIC_MAX_TOKENS, DEBUG
from backend.security import IP_CHALLENGE_CALLS, USAGE_STATS, check_ip_rate_limit, get_client_ip

try:
    import anthropic
except ImportError:
    anthropic = None

# ==============================================================================
# 8. Chat con Claude AI (Streaming SSE, Historial, Seguridad y Control de Gasto)
# ==============================================================================
# Texto fijo del prompt: idéntico en todas las peticiones (los datos de cada conversación van detrás, en context_block).
SYSTEM_PROMPT = """Eres el asistente de PaperPulse, un simulador educativo de trading con dinero virtual y cotizaciones reales. Ayudas a entender el mercado, el análisis técnico, los tipos de orden y la gestión del riesgo. Respondes en español claro.

Normas:
- Cifras: cita solo los precios y variaciones de «Datos de mercado», al final de este mensaje; son datos reales del terminal. No inventes otros precios, soportes, resistencias ni objetivos. En los ejemplos didácticos usa números redondos y di que son ejemplos.
- Si preguntan por una cotización, dala en la primera línea: par, precio en su moneda, equivalencia en la moneda del usuario si es distinta, variación en 24 h y estado. Ejemplo: «BTC/USDT cotiza a 67.234,50 USDT (≈ 61.855,30 €), +2,45 % en 24 h (dato en vivo).»
- Si el activo no está en los datos o no tiene cotización, responde solo: «No tengo cotización de <activo> ahora mismo.»
- Si el estado es «cierre de ayer», dilo así; no lo presentes como precio actual ni en vivo.
- No recomiendes comprar, vender ni mantener ningún activo, ni prometas resultados. Si te lo piden, explica cómo decidir con método: stop-loss, arriesgar un 1-2 % del capital por operación y relación riesgo/beneficio.
- Usa los datos de la cuenta solo si el usuario tiene cuenta de práctica; en modo consulta no menciones saldo ni hagas ejemplos con su dinero.
- Formato: números con el formato regional indicado en los datos. El chat solo muestra párrafos, listas, **negrita** y *cursiva*: no uses tablas ni títulos."""


def context_block(ctx: dict, market: list) -> str:
    """Datos de la conversación (cuenta, gráfico, moneda y cotizaciones), ya saneados. Va al final del prompt."""
    lines = ["", "", "Datos de esta conversación"]
    if ctx["has_practice"]:
        lines.append(f"- Cuenta de práctica: efectivo {ctx['balance']}, patrimonio {ctx['equity']}.")
        lines.append(f"- Posiciones abiertas: {ctx['positions']}.")
        lines.append(f"- Diario: {ctx['journal']}.")
    else:
        lines.append("- Modo consulta: el usuario no tiene cuenta de práctica.")
    lines.append(f"- Gráfico abierto: {ctx['symbol']} ({ctx['timeframe']}).")
    lines.append(f"- Moneda del usuario: {ctx['currency']}. Formato numérico: {ctx['number_format']}.")
    lines += ["", "Datos de mercado (par: precio · variación 24 h · estado · hora):"]
    for m in market:
        if m["available"]:
            disp = f" ({m['display']})" if m["display"] else ""
            lines.append(f"- {m['pair']}: {m['native']}{disp} · {m['change']} · {m['status']} · {m['updated']}")
        else:
            lines.append(f"- {m['pair']}: sin cotización")
    if not market:
        lines.append(f"- {ctx['symbol']}: sin cotización")
    return "\n".join(lines)

# ==============================================================================
# Desafío anti-bot. Firmado con el secreto del servidor (igual en todas las instancias) y de un solo uso
# (ai_challenges_used en la base de datos), así que funciona aunque el desafío y la pregunta lleguen a instancias distintas.
# ==============================================================================
CHALLENGE_TTL = 300


def _sign(message: bytes) -> str:
    return hmac.new(ai_usage.secret(), message, hashlib.sha256).hexdigest()


async def api_chat_challenge(request):
    """Genera un desafío criptográfico efímero anti-bots para peticiones de chat."""
    client_ip = get_client_ip(request)
    if not check_ip_rate_limit(client_ip, IP_CHALLENGE_CALLS, max_calls_per_minute=30):
        return JSONResponse({"error": "Demasiadas solicitudes."}, status_code=429, headers={"Retry-After": "60"})
    now = int(time.time())
    nonce = secrets.token_hex(8)
    signature = await run_in_threadpool(_sign, f"{client_ip}:{now}:{nonce}".encode("utf-8"))
    return JSONResponse({"status": "ok", "challenge": f"{now}:{nonce}:{signature}"})


def _too_many(message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=429, headers={"Retry-After": "60"})


async def api_chat_stream(request):
    """Endpoint SSE del asistente: streaming, límites globales (en la base de datos) y registro del consumo."""
    client_ip = get_client_ip(request)

    # Tamaño del cuerpo (máx. 32 KB)
    content_length = request.headers.get("content-length")
    if content_length and (not content_length.isdigit() or int(content_length) > 32768):
        return JSONResponse({"error": "Petición demasiado grande."}, status_code=413)

    # Leer JSON del cuerpo con control de errores
    try:
        body_bytes = await request.body()
        if len(body_bytes) > 32768:
            return JSONResponse({"error": "Petición demasiado grande."}, status_code=413)
        body = json.loads(body_bytes.decode('utf-8'))
    except Exception:
        return JSONResponse({"error": "Petición JSON inválida."}, status_code=400)

    user_message = str(body.get("message", "")).strip()
    if not user_message:
        return JSONResponse({"error": "El mensaje no puede estar vacío."}, status_code=400)

    if len(user_message) > 2500:
        return JSONResponse({"error": "El mensaje supera el límite permitido de 2,500 caracteres."}, status_code=400)

    # Verificación Anti-bot (Desafío Criptográfico o Token de Seguridad)
    challenge_token = request.headers.get("x-chat-challenge", "") or str(body.get("challenge", "")).strip()
    if not challenge_token:
        return JSONResponse({"error": "Verificación anti-bot requerida para enviar mensajes al asistente."}, status_code=403)
    try:
        parts = challenge_token.split(":")
        if len(parts) != 3:
            return JSONResponse({"error": "Desafío de seguridad con formato inválido."}, status_code=403)
        ts_str, nonce, signature = parts
        token_ts = int(ts_str)
        now = int(time.time())
        if abs(now - token_ts) > CHALLENGE_TTL:
            return JSONResponse({"error": "El desafío anti-bot ha caducado. Por favor, reenvía tu mensaje."}, status_code=403)
        expected_sig = await run_in_threadpool(_sign, f"{client_ip}:{ts_str}:{nonce}".encode("utf-8"))
        if not hmac.compare_digest(signature, expected_sig):
            return JSONResponse({"error": "Firma del desafío anti-bot incorrecta."}, status_code=403)
        # Consumir desafío (uso único, también entre instancias)
        if not await run_in_threadpool(ai_usage.consume_challenge, signature, token_ts + CHALLENGE_TTL):
            return JSONResponse({"error": "El desafío anti-bot ya fue utilizado o ha expirado."}, status_code=403)
    except Exception as exc:
        print(f"[Chat] Error verificando el desafío: {type(exc).__name__}: {exc}", file=sys.stderr)
        return JSONResponse({"error": "Error durante la verificación anti-bot."}, status_code=403)

    # Contexto enviado por el navegador: todo se sanea y se acota antes de llegar al prompt
    account_ctx = body.get("context")
    if not isinstance(account_ctx, dict):
        account_ctx = {}

    def clean(value, limit):
        return str(value if value is not None else "").replace("\n", " ").replace("\r", " ")[:limit].strip()

    has_practice = bool(account_ctx.get("hasPracticeAccount", False))
    raw_bal = clean(account_ctx.get("balanceFormatted", account_ctx.get("balanceUsd", "0.00")), 30)
    raw_eq = clean(account_ctx.get("equityFormatted", account_ctx.get("equityUsd", raw_bal)), 30)
    curr = clean(account_ctx.get("currency", "EUR"), 5)
    currency = curr if curr in ("EUR", "USD", "GBP") else "EUR"
    locale = clean(account_ctx.get("locale", "es-ES"), 10)

    safe_positions = []
    raw_pos = account_ctx.get("positions", [])
    if isinstance(raw_pos, list):
        for p in raw_pos[:10]:
            if isinstance(p, dict):
                sym = "".join(c for c in clean(p.get("symbol", ""), 10) if c.isalnum() or c in "/-")
                amt = clean(p.get("amount", 0), 20)
                entry = clean(p.get("entryPriceFormatted", p.get("entryPrice", "")), 25)
                pnl = clean(p.get("pnlFormatted", p.get("pnlUsd", "")), 25)
                if sym:
                    safe_positions.append(f"{sym} {amt} ud., entrada {entry}, resultado {pnl}")

    active_symbol = "".join(c for c in clean(account_ctx.get("activeSymbol", "BTC"), 12) if c.isalnum() or c in "/-") or "BTC"
    timeframe = "".join(c for c in clean(account_ctx.get("timeframe", "1D"), 4) if c.isalnum()) or "1D"
    raw_market = account_ctx.get("market", [])
    market = chat_fixed.market_items(raw_market)

    system_prompt = SYSTEM_PROMPT + context_block({
        "has_practice": has_practice, "balance": raw_bal, "equity": raw_eq,
        "positions": "; ".join(safe_positions) or "ninguna",
        "journal": clean(account_ctx.get("journalSummary", ""), 120) or "sin operaciones",
        "symbol": active_symbol, "timeframe": timeframe, "currency": currency,
        "number_format": "1.250,50 (español)" if locale == "es-ES" else "1,250.50 (inglés)",
    }, market)

    # Validar y formatear historial de conversación (hasta 8 mensajes anteriores)
    raw_history = body.get("history", [])
    valid_messages = []
    if isinstance(raw_history, list):
        for h in raw_history[-8:]:
            if isinstance(h, dict):
                role = h.get("role")
                content = str(h.get("content", "")).strip()
                if role in ("user", "assistant") and content:
                    valid_messages.append({"role": role, "content": content[:2500]})

    # Asegurar alternancia correcta de roles requerida por Anthropic
    anthropic_messages = []
    expected_role = "user"
    for m in valid_messages:
        if m["role"] == expected_role:
            anthropic_messages.append(m)
            expected_role = "assistant" if expected_role == "user" else "user"
        elif anthropic_messages and anthropic_messages[-1]["role"] == m["role"]:
            # Fusionar mensajes consecutivos del mismo rol
            anthropic_messages[-1]["content"] += f"\n\n{m['content']}"

    # Añadir mensaje actual del usuario
    if anthropic_messages and anthropic_messages[-1]["role"] == "user":
        anthropic_messages[-1]["content"] += f"\n\n{user_message}"
    else:
        anthropic_messages.append({"role": "user", "content": user_message})

    # Las sugerencias del chat (texto exacto de los botones) se responden con texto fijo, sin llamar a la IA
    fixed = chat_fixed.answer(user_message, raw_market)

    # Límites globales (por minuto, diarios por cliente y tope diario de tokens), guardados en la base de datos
    api_key = settings.get("anthropic_api_key")
    uses_ai = fixed is None and bool(api_key and anthropic)
    refused = await run_in_threadpool(ai_usage.admit, client_ip, uses_ai)
    if refused:
        return _too_many(refused)

    # Cabeceras anti-buffering
    sse_headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Content-Type": "text/event-stream; charset=utf-8"
    }

    if fixed is not None:
        await run_in_threadpool(ai_usage.record, client_ip, "fixed")

        async def fixed_stream():
            yield f"data: {json.dumps({'text': fixed})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(fixed_stream(), media_type="text/event-stream", headers=sse_headers)

    # Si no hay clave real de Anthropic, usar flujo local seguro (sin exponer secretos en producción)
    if not uses_ai:
        await run_in_threadpool(ai_usage.record, client_ip, "fixed")

        async def mock_stream():
            yield f"data: {json.dumps({'text': '👋 **PaperPulse AI (Modo Servidor Local)**:\n\n'})}\n\n"
            await asyncio.sleep(0.04)

            u_lower = user_message.lower()
            is_market_query = any(w in u_lower for w in ["mercado", "como esta", "cómo está", "precio", "cotiza", "cotizacion", "cotización", "btc", "bitcoin", "eth", "sol", "san", "nvda", "santander", "apple"])

            if is_market_query:
                target_item = None
                if isinstance(raw_market, list) and raw_market:
                    if any(w in u_lower for w in ["btc", "bitcoin"]):
                        target_item = next((it for it in raw_market if isinstance(it, dict) and it.get("symbol") == "BTC"), None)
                    elif any(w in u_lower for w in ["eth", "ethereum"]):
                        target_item = next((it for it in raw_market if isinstance(it, dict) and it.get("symbol") == "ETH"), None)
                    elif any(w in u_lower for w in ["sol", "solana"]):
                        target_item = next((it for it in raw_market if isinstance(it, dict) and it.get("symbol") == "SOL"), None)
                    elif any(w in u_lower for w in ["san", "santander"]):
                        target_item = next((it for it in raw_market if isinstance(it, dict) and it.get("symbol") == "SAN"), None)
                    elif any(w in u_lower for w in ["nvda", "nvidia"]):
                        target_item = next((it for it in raw_market if isinstance(it, dict) and it.get("symbol") == "NVDA"), None)
                    elif active_symbol:
                        target_item = next((it for it in raw_market if isinstance(it, dict) and it.get("symbol") == active_symbol), None)

                    if not target_item:
                        target_item = raw_market[0]

                if not target_item or str(target_item.get("price", "")).strip() in ("No disponible", "0", "") or target_item.get("priceNativeFormatted") in ("No disponible", ""):
                    sym_name = (target_item.get("symbol") if target_item else active_symbol) or "BTC"
                    response_text = f"No tengo cotización de {sym_name} ahora mismo."
                else:
                    pair = target_item.get("pair", f"{target_item.get('symbol')}/USDT")
                    p_native = target_item.get("priceNativeFormatted")
                    p_disp = target_item.get("priceDisplayFormatted", "")
                    disp_str = f" ({p_disp})" if p_disp and p_disp != p_native and "No disponible" not in p_disp else ""
                    chg = target_item.get("change24h", "No disponible")
                    st = target_item.get("status", "en vivo")
                    if st == "cierre de ayer":
                        response_text = f"{pair} se sitúa en {p_native}{disp_str} (cierre de ayer), con una variación de {chg}."
                    else:
                        response_text = f"{pair} cotiza a {p_native}{disp_str} con una variación 24 h de {chg} (dato {st})."
            elif has_practice:
                response_text = (
                    f"Detecto que tu saldo disponible es de **{raw_bal}** (patrimonio total de **{raw_eq}**) y estás analizando **{active_symbol}**.\n\n"
                    "Recuerda mantener tu riesgo por operación en un **1-2%** como marca la regla cuantitativa de gestión del riesgo."
                )
            else:
                response_text = (
                    f"Estás en **Modo Consulta** analizando el activo **{active_symbol}**.\n\n"
                    "Si deseas simular compras y ventas con capital virtual, puedes pulsar en **Empezar a practicar** para crear una cuenta con saldo ficticio."
                )

            # En modo desarrollo exclusivamente, añadir nota para el desarrollador
            if DEBUG:
                response_text += "\n\n*(Nota de desarrollo: Configura la clave de Anthropic en el panel de administración o en .env para activar el asistente en vivo)*"

            for word in response_text.split(" "):
                if await request.is_disconnected():
                    break
                yield f"data: {json.dumps({'text': word + ' '})}\n\n"
                await asyncio.sleep(0.02)
            yield "data: [DONE]\n\n"

        return StreamingResponse(mock_stream(), media_type="text/event-stream", headers=sse_headers)

    model = settings.get("anthropic_model")
    request_params = {"model": model, "max_tokens": ANTHROPIC_MAX_TOKENS, "system": system_prompt, "messages": anthropic_messages}

    # Llamada real con streaming a Anthropic
    async def anthropic_stream():
        try:
            # Timeout de 45 segundos
            client = anthropic.AsyncAnthropic(api_key=api_key, timeout=45.0)
            async with client.messages.stream(**request_params) as stream:
                async for text in stream.text_stream:
                    if await request.is_disconnected():
                        print(f"[Chat] Cliente {client_ip} cerró la conexión. Abortando streaming para proteger tokens.", file=sys.stderr)
                        break
                    yield f"data: {json.dumps({'text': text})}\n\n"

                # Mensaje final: registrar el consumo exacto en la base de datos
                try:
                    final_msg = await stream.get_final_message()
                    truncated = getattr(final_msg, "stop_reason", None) == "max_tokens"
                    effort = (request_params.get("output_config") or {}).get("effort", "")
                    await run_in_threadpool(ai_usage.record, client_ip, "ai", model, effort, final_msg.usage, truncated)
                    if truncated:
                        yield f"data: {json.dumps({'truncated': True, 'text': ''})}\n\n"
                except Exception as usage_err:
                    print(f"[Chat] Error registrando el consumo: {usage_err}", file=sys.stderr)

            yield "data: [DONE]\n\n"

        except anthropic.RateLimitError:
            yield f"data: {json.dumps({'error': 'Límite de cuota temporal de Anthropic alcanzado. Por favor, reintenta en unos instantes.'})}\n\n"
            yield "data: [DONE]\n\n"
        except anthropic.AuthenticationError as auth_err:
            print(f"[Seguridad] Error de autenticación en Anthropic API: {auth_err}", file=sys.stderr)
            yield f"data: {json.dumps({'error': 'El asistente no está disponible ahora mismo.'})}\n\n"
            yield "data: [DONE]\n\n"
        except asyncio.TimeoutError:
            print(f"[Chat] Timeout superado en llamada a Anthropic para IP {client_ip}", file=sys.stderr)
            yield f"data: {json.dumps({'error': 'Tiempo de respuesta del asistente agotado. Inténtalo de nuevo.'})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            USAGE_STATS["errors"] += 1
            # Nunca enviar la excepción interna al navegador
            print(f"[Chat Error] Excepción en asistente: {type(e).__name__}: {e}", file=sys.stderr)
            yield f"data: {json.dumps({'error': 'El asistente no está disponible ahora mismo.'})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(anthropic_stream(), media_type="text/event-stream", headers=sse_headers)
