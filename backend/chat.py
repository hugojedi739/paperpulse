"""Asistente con Claude: streaming SSE, desafío anti-bot y control de gasto."""
import os
import sys
import json
import time
import asyncio
import hmac
import hashlib
import secrets
from typing import Dict

from starlette.responses import JSONResponse, StreamingResponse

from backend import settings
from backend.config import ANTHROPIC_MAX_TOKENS, DAILY_GLOBAL_TOKEN_LIMIT, DAILY_USER_CHAT_REQUESTS, DAILY_USER_TOKEN_LIMIT, DEBUG
from backend.security import (
    IP_CHALLENGE_CALLS, IP_CHAT_CALLS, IP_DAILY_DATA, USAGE_STATS,
    check_date_rollover, check_ip_rate_limit, get_client_ip, record_token_usage,
)

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
# 8. Desafío Criptográfico Anti-Bot para Chat
# ==============================================================================
CHAT_CHALLENGE_SECRET = os.getenv("CHAT_CHALLENGE_SECRET", secrets.token_hex(32))
ACTIVE_CHALLENGES: Dict[str, float] = {}

def cleanup_expired_challenges():
    now = time.time()
    expired = [sig for sig, ts in ACTIVE_CHALLENGES.items() if now - ts > 300]
    for sig in expired:
        ACTIVE_CHALLENGES.pop(sig, None)

async def api_chat_challenge(request):
    """Genera un desafío criptográfico efímero anti-bots para peticiones de chat."""
    client_ip = get_client_ip(request)
    if not check_ip_rate_limit(client_ip, IP_CHALLENGE_CALLS, max_calls_per_minute=30):
        return JSONResponse({"error": "Demasiadas solicitudes."}, status_code=429, headers={"Retry-After": "60"})
    now = int(time.time())
    nonce = secrets.token_hex(8)
    message = f"{client_ip}:{now}:{nonce}".encode("utf-8")
    signature = hmac.new(CHAT_CHALLENGE_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()

    cleanup_expired_challenges()
    if len(ACTIVE_CHALLENGES) >= 10000:
        ACTIVE_CHALLENGES.pop(next(iter(ACTIVE_CHALLENGES)))
    ACTIVE_CHALLENGES[signature] = now

    token = f"{now}:{nonce}:{signature}"
    return JSONResponse({"status": "ok", "challenge": token})

async def api_chat_stream(request):
    """Endpoint SSE para chat con Claude Haiku 5.5 con streaming y límites estrictos."""
    client_ip = get_client_ip(request)
    check_date_rollover()

    # 1. Validación de tamaño de cuerpo (anti-DDoS: máx 32KB)
    content_length = request.headers.get("content-length")
    if content_length and (not content_length.isdigit() or int(content_length) > 32768):
        return JSONResponse({"error": "Petición demasiado grande."}, status_code=413)

    # 2. Rate limit por minuto
    if not check_ip_rate_limit(client_ip, IP_CHAT_CALLS, max_calls_per_minute=20):
        return JSONResponse({
            "error": "Has alcanzado el límite de preguntas por minuto. Por favor, espera unos segundos."
        }, status_code=429, headers={"Retry-After": "60"})

    # 3. Límite diario de peticiones por usuario/IP
    today = USAGE_STATS["today"]
    ip_rec = IP_DAILY_DATA.setdefault(client_ip, {"date": today, "chat_count": 0, "tokens": 0})
    if ip_rec["date"] != today:
        ip_rec["date"] = today
        ip_rec["chat_count"] = 0
        ip_rec["tokens"] = 0

    if ip_rec["chat_count"] >= DAILY_USER_CHAT_REQUESTS:
        return JSONResponse({
            "error": "Has alcanzado el límite diario de mensajes para tu sesión. Se restablecerá a las 00:00 UTC."
        }, status_code=429, headers={"Retry-After": "60"})

    # 4. Límite diario global de tokens
    if USAGE_STATS["daily_total_tokens"] >= DAILY_GLOBAL_TOKEN_LIMIT:
        return JSONResponse({
            "error": "Se ha alcanzado el límite diario de consultas de IA. El servicio se restablecerá a las 00:00 UTC."
        }, status_code=429, headers={"Retry-After": "60"})

    # 5. Límite diario de tokens por usuario
    if ip_rec["tokens"] >= DAILY_USER_TOKEN_LIMIT:
        return JSONResponse({
            "error": "Has alcanzado tu límite diario de consumo de IA. Se restablecerá a las 00:00 UTC."
        }, status_code=429, headers={"Retry-After": "60"})

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
        if abs(now - token_ts) > 300:
            return JSONResponse({"error": "El desafío anti-bot ha caducado. Por favor, reenvía tu mensaje."}, status_code=403)
        expected_msg = f"{client_ip}:{ts_str}:{nonce}".encode("utf-8")
        expected_sig = hmac.new(CHAT_CHALLENGE_SECRET.encode("utf-8"), expected_msg, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return JSONResponse({"error": "Firma del desafío anti-bot incorrecta."}, status_code=403)
        if signature not in ACTIVE_CHALLENGES:
            return JSONResponse({"error": "El desafío anti-bot ya fue utilizado o ha expirado."}, status_code=403)
        # Consumir desafío (uso único)
        ACTIVE_CHALLENGES.pop(signature, None)
    except Exception:
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
    safe_market_lines = []
    if isinstance(raw_market, list):
        for item in raw_market[:6]:  # longitud limitada (máximo 6 activos)
            if isinstance(item, dict):
                m_sym = "".join(c for c in str(item.get("symbol", ""))[:10] if c.isalnum() or c in "/-").upper()
                m_pair = "".join(c for c in str(item.get("pair", ""))[:15] if c.isalnum() or c in "/-").upper() or f"{m_sym}/USDT"
                
                raw_p_native = str(item.get("priceNativeFormatted", item.get("price", "No disponible")))[:30].replace("\n", "").strip()
                raw_p_disp = str(item.get("priceDisplayFormatted", ""))[:35].replace("\n", "").strip()
                raw_chg = str(item.get("change24h", "No disponible"))[:15].replace("\n", "").strip()
                raw_upd = str(item.get("lastUpdate", "No disponible"))[:15].replace("\n", "").strip()
                raw_st = str(item.get("status", "No disponible"))[:30].replace("\n", "").strip()

                if raw_p_native in ("No disponible", "0", "0.00", ""):
                    line = f"- {m_sym} ({m_pair}): Cotización No disponible (Estado: {raw_st})"
                else:
                    disp_part = f" ({raw_p_disp})" if raw_p_disp and raw_p_disp != raw_p_native and "No disponible" not in raw_p_disp else ""
                    line = f"- {m_sym} ({m_pair}): {raw_p_native}{disp_part} | Var 24h: {raw_chg} | Estado: {raw_st} | Última actualización: {raw_upd}"
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

    USAGE_STATS["chat_requests"] += 1
    ip_rec["chat_count"] += 1

    # Cabeceras anti-buffering
    sse_headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Content-Type": "text/event-stream; charset=utf-8"
    }

    # Si no hay clave real de Anthropic, usar flujo local seguro (sin exponer secretos en producción)
    api_key = settings.get("anthropic_api_key")
    if not api_key or not anthropic:
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

    # Llamada real con Streaming a Anthropic con claude-haiku-5-5
    async def anthropic_stream():
        try:
            # Timeout de 45 segundos
            client = anthropic.AsyncAnthropic(api_key=api_key, timeout=45.0)
            async with client.messages.stream(
                model=settings.get("anthropic_model"),
                max_tokens=ANTHROPIC_MAX_TOKENS,
                system=system_prompt,
                messages=anthropic_messages
            ) as stream:
                async for text in stream.text_stream:
                    if await request.is_disconnected():
                        print(f"[Chat] Cliente {client_ip} cerró la conexión. Abortando streaming para proteger tokens.", file=sys.stderr)
                        break
                    yield f"data: {json.dumps({'text': text})}\n\n"

                # Obtener mensaje final y registrar consumo exacto de tokens
                try:
                    final_msg = await stream.get_final_message()
                    if final_msg and final_msg.usage:
                        in_tok = final_msg.usage.input_tokens
                        out_tok = final_msg.usage.output_tokens
                        record_token_usage(client_ip, in_tok, out_tok)

                        # Detectar si se cortó por max_tokens
                        if getattr(final_msg, 'stop_reason', None) == "max_tokens":
                            yield f"data: {json.dumps({'truncated': True, 'text': ''})}\n\n"
                except Exception as usage_err:
                    print(f"[Chat] Error extrayendo usage: {usage_err}", file=sys.stderr)

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
