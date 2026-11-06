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
SYSTEM_PROMPT_TEMPLATE = """Eres PaperPulse AI, el analista cuantitativo y asistente de mercado en PaperPulse Terminal.
Tu función es informar al usuario con precisión sobre las cotizaciones y educarle en mercados financieros, análisis técnico, lectura de Order Flow y gestión matemática del riesgo (regla del 1-2%).
Hablas siempre en español claro, profesional, riguroso y estructurado.

SISTEMA DE PRECIOS EN TIEMPO REAL:
Dispones de conexión directa al feed de datos del terminal. Los datos reales y actualizados de mercado se te proporcionan a continuación en la sección "DATOS DE MERCADO (ÚNICAS CIFRAS QUE PUEDES CITAR)".
Por tanto, NUNCA digas que no tienes acceso a datos en tiempo real ni que desconoces las cotizaciones cuando aparezcan en dicha sección.

ESTADO DEL USUARIO (DATOS DE SOLO LECTURA):
- Modo Activo: {account_mode_label}
{account_status_details}
- Activo Actualmente Abierto en Gráfico: {active_symbol} (Temporalidad: {timeframe})
- Modo de Operativa del Terminal: {trade_mode}
- Moneda Activa del Usuario: {currency} (Formato Regional: {locale_hint})

DATOS DE MERCADO (ÚNICAS CIFRAS QUE PUEDES CITAR):
{market_context_block}

NORMAS ESTRICTAS DE RESPUESTA (OBLIGATORIAS):
1. RESPUESTA A "¿CÓMO ESTÁ EL MERCADO?" O PREGUNTAS DE COTIZACIÓN:
   - Si el usuario pregunta "¿cómo está el mercado?", "¿cómo va el mercado?" o consulta el precio de un activo: RESPONDE DE INMEDIATO EN LA PRIMERA LÍNEA citando el par (ejemplo: BTC/USDT), su cotización nativa, la equivalencia en {currency} (si difiere), la variación 24 h y su estado (en vivo, cierre de ayer o retrasado).
   - Ejemplo exacto: "BTC/USDT cotiza a 67.234,50 USDT (≈ 61.855,30 €) con una variación 24 h de +2,45% (dato en vivo)."
   - Realiza un análisis técnico o contextual más largo ÚNICAMENTE si el usuario lo solicita explícitamente.
2. REGLA FUNDAMENTAL DE PRECIOS:
   - Las cifras en "DATOS DE MERCADO" son las ÚNICAS que tienes permitido citar. No inventes ni menciones ningún otro precio numérico, soporte numérico o resistencia numérica que no esté en esa sección.
3. SI UN ACTIVO ESTÁ "NO DISPONIBLE" O FALTA COTIZACIÓN:
   - Responde obligatoriamente en una sola línea con la frase: "No tengo cotización de [Activo] ahora mismo." (ejemplo exacto: "No tengo cotización de BTC ahora mismo." o "No tengo cotización de Santander ahora mismo.").
   - NUNCA uses plantillas largas, disculpas, explicaciones sobre el gráfico ni texto adicional.
4. ACCIONES CERRADAS:
   - Si una acción tiene el estado "cierre de ayer", DEBES indicar explícitamente "cierre de ayer" o "último cierre" y NUNCA llamarlo precio "actual" ni "en vivo".
5. MODO CONSULTA (SIN CUENTA DE PRÁCTICA):
   - Si el usuario está en Modo Consulta, está TERMINANTEMENTE PROHIBIDO mencionar saldo, capital, liquidez ni poner ejemplos con el saldo del usuario. Céntrate exclusivamente en el mercado y conceptos técnicos.
6. DENOMINACIÓN DE PARES Y DIVISAS:
   - Menciona siempre el par real de cotización (BTC/USDT, ETH/USDT, SOL/USDT, SAN/EUR, NVDA/USD) y la moneda de visualización del usuario ({currency}).
7. FORMATO DE NÚMEROS Y MONEDAS:
   - Usa siempre la moneda activa ({currency}) y el formato numérico regional ({locale_hint}). En formato español/europeo: 67.234,50 USDT o 61.855,30 €.
8. Jamás des recomendaciones de inversión formal garantizadas; enfatiza la gestión matemática del riesgo, el ratio R:R y el Stop Loss."""

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

    # Validación y sanitización rigurosa del contexto de cuenta
    account_ctx = body.get("context")
    if not isinstance(account_ctx, dict):
        account_ctx = {}

    has_practice = bool(account_ctx.get("hasPracticeAccount", False))
    raw_bal = str(account_ctx.get("balanceFormatted", account_ctx.get("balanceUsd", "0.00")))[:30].replace("\n", "").strip()
    raw_eq = str(account_ctx.get("equityFormatted", account_ctx.get("equityUsd", raw_bal)))[:30].replace("\n", "").strip()
    curr = str(account_ctx.get("currency", "EUR"))[:5].strip()
    currency = curr if curr in ("EUR", "USD", "GBP") else "EUR"
    locale = str(account_ctx.get("locale", "es-ES"))[:10].strip()
    locale_hint = "español/europeo (separador de miles con punto y decimales con coma: '1.250,50')" if locale == "es-ES" else "anglosajón"

    # Sanitizar posiciones
    raw_pos = account_ctx.get("positions", [])
    safe_positions = []
    if isinstance(raw_pos, list):
        for p in raw_pos[:10]:
            if isinstance(p, dict):
                sym = str(p.get("symbol", ""))[:10].replace("\n", "").strip()
                amt = p.get("amount", 0)
                pnl_formatted = str(p.get("pnlFormatted", f"${p.get('pnlUsd', 0)}"))[:25].replace("\n", "").strip()
                entry_formatted = str(p.get("entryPriceFormatted", p.get("entryPrice", "")))[:25].replace("\n", "").strip()
                if sym:
                    safe_positions.append(f"{sym} ({amt} ud, entrada: {entry_formatted}, PnL: {pnl_formatted})")
    positions_summary = ", ".join(safe_positions) if safe_positions else "Ninguna posición abierta actualmente."

    # Sanitizar resumen de diario
    raw_journal = str(account_ctx.get("journalSummary", "Sin operaciones recientes."))[:120].replace("\n", " ").strip()
    journal_summary = raw_journal if raw_journal else "Sin operaciones registradas."

    # Activo y temporalidad
    raw_sym = str(account_ctx.get("activeSymbol", "BTC"))[:12].replace("\n", "").strip()
    active_symbol = "".join(c for c in raw_sym if c.isalnum() or c in "/-") or "BTC"

    raw_tf = str(account_ctx.get("timeframe", "1D"))[:6].replace("\n", "").strip()
    timeframe = raw_tf if raw_tf in ("1m", "5m", "15m", "1h", "4h", "1D", "1W") else "1D"

    raw_tm = str(account_ctx.get("tradeMode", "Modo Fácil"))[:20].replace("\n", "").strip()
    trade_mode = "Modo Avanzado" if "avanzado" in raw_tm.lower() or "pro" in raw_tm.lower() else "Modo Fácil"

    if has_practice:
        account_mode_label = "Cuenta de Práctica PaperPulse Activa"
        account_status_details = (
            f"- Saldo en Efectivo Disponible: {raw_bal}\n"
            f"- Patrimonio Total (Equity): {raw_eq}\n"
            f"- Posiciones Abiertas: {positions_summary}\n"
            f"- Resumen del Diario: {journal_summary}"
        )
    else:
        account_mode_label = "Modo Consulta PaperPulse (Sin cuenta de práctica activa)"
        account_status_details = (
            "- El usuario NO tiene cuenta de práctica activa en este momento; está en Modo Consulta de mercado.\n"
            "- Está terminantemente PROHIBIDO mencionar saldo, efectivo, patrimonio o capital del usuario ni inventar ejemplos con su dinero."
        )

    # Sanitizar contexto de mercado (DATOS DE MERCADO ÚNICAS CIFRAS QUE PUEDES CITAR)
    raw_market = account_ctx.get("market", [])
    market = chat_fixed.market_items(raw_market)
    safe_market_lines = []
    for m in market:
        if not m["available"]:
            line = f"- {m['symbol']} ({m['pair']}): Cotización No disponible (Estado: {m['status']})"
        else:
            disp_part = f" ({m['display']})" if m["display"] else ""
            line = f"- {m['symbol']} ({m['pair']}): {m['native']}{disp_part} | Var 24h: {m['change']} | Estado: {m['status']} | Última actualización: {m['updated']}"
        safe_market_lines.append(line)

    if not safe_market_lines:
        safe_market_lines = [
            f"- {active_symbol}: Cotización No disponible",
            "- BTC (BTC/USDT): Cotización No disponible",
            "- ETH (ETH/USDT): Cotización No disponible",
            "- SOL (SOL/USDT): Cotización No disponible"
        ]

    market_context_block = "\n".join(safe_market_lines)

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        account_mode_label=account_mode_label,
        account_status_details=account_status_details,
        market_context_block=market_context_block,
        active_symbol=active_symbol,
        timeframe=timeframe,
        trade_mode=trade_mode,
        currency=currency,
        locale_hint=locale_hint
    )

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
