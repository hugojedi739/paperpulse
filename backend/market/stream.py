"""WebSocket de mercado en vivo: /ws/market.

El navegador abre un único socket con el backend y usa el mismo protocolo que Binance:
  → {"method": "SUBSCRIBE", "params": ["btcusdt@ticker", "btcusdt@kline_1h", "stocks"], "id": 1}
  ← {"stream": "btcusdt@ticker", "data": {...}}
El backend mantiene una sola conexión con Binance para todos los clientes (suscripciones con recuento de
referencias, agrupadas para respetar el límite de 5 mensajes/s) y reenvía cada mensaje a quien lo pidió.
El stream especial "stocks" recibe las cotizaciones de bolsa cada 5 s.
"""
import asyncio
import json
import re
import sys
import time
from typing import Dict, Optional, Set

import websockets
from starlette.websockets import WebSocket, WebSocketDisconnect

from backend.market.stocks import fetch_live_stock_quotes
from backend.security import cleanup_stale_ip_data, get_client_ip

UPSTREAM = "wss://data-stream.binance.vision/stream"
STREAM_RE = re.compile(r"^[a-z0-9]{2,20}@(ticker|kline_(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)|depth(5|10|20)(@100ms)?)$")
STOCKS = "stocks"
MAX_CLIENTS, MAX_PER_IP, MAX_STREAMS_PER_CLIENT, MAX_UPSTREAM_STREAMS = 200, 6, 80, 900
FLUSH_EVERY = 0.5  # 2 mensajes (SUBSCRIBE + UNSUBSCRIBE) cada 0,5 s: dentro del límite de Binance


class Client:
    def __init__(self, ws: WebSocket, ip: str):
        self.ws, self.ip = ws, ip
        self.streams: Set[str] = set()
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=300)

    def push(self, text: str) -> None:
        try:
            self.queue.put_nowait(text)
        except asyncio.QueueFull:  # cliente lento: se descartan mensajes antes que bloquear al resto
            pass

    async def writer(self) -> None:
        while True:
            await self.ws.send_text(await self.queue.get())


class Hub:
    def __init__(self):
        self.clients: Set[Client] = set()
        self.refs: Dict[str, Set[Client]] = {}
        self.upstream_streams: Set[str] = set()
        self.upstream = None
        self.task: Optional[asyncio.Task] = None
        self.connected_at = 0.0
        self.messages = 0

    # ---------------------------------------------------------- clientes
    def wanted(self) -> Set[str]:
        return {s for s, c in self.refs.items() if c and s != STOCKS}

    def subscribe(self, client: Client, streams) -> None:
        for s in streams:
            if len(client.streams) >= MAX_STREAMS_PER_CLIENT:
                break
            if s != STOCKS and (not STREAM_RE.match(s) or (s not in self.refs and len(self.refs) >= MAX_UPSTREAM_STREAMS)):
                continue
            client.streams.add(s)
            self.refs.setdefault(s, set()).add(client)
            if s == STOCKS:
                asyncio.create_task(send_stock_snapshot(client))
        self.ensure_upstream()

    def unsubscribe(self, client: Client, streams) -> None:
        for s in streams:
            client.streams.discard(s)
            subs = self.refs.get(s)
            if subs is not None:
                subs.discard(client)
                if not subs:
                    del self.refs[s]

    def remove(self, client: Client) -> None:
        self.unsubscribe(client, list(client.streams))
        self.clients.discard(client)

    def publish(self, stream: str, text: str) -> None:
        for c in self.refs.get(stream, ()):
            c.push(text)

    # ---------------------------------------------------------- conexión con Binance
    def ensure_upstream(self) -> None:
        if self.wanted() and (self.task is None or self.task.done()):
            self.task = asyncio.create_task(self.run_upstream())

    async def run_upstream(self) -> None:
        delay = 1
        while self.wanted():
            streams = sorted(self.wanted())[:200]  # el resto se suscribe por mensaje tras conectar
            flusher = None
            try:
                async with websockets.connect(f"{UPSTREAM}?streams={'/'.join(streams)}", ping_interval=20, max_size=2**22, open_timeout=10) as up:
                    self.upstream, self.upstream_streams, self.connected_at = up, set(streams), time.time()
                    delay = 1
                    flusher = asyncio.create_task(self.flush(up))
                    async for raw in up:
                        stream = stream_of(raw)
                        if stream:
                            self.messages += 1
                            self.publish(stream, raw)
            except Exception as e:
                print(f"[Stream] Conexión con Binance perdida: {type(e).__name__}: {e}", file=sys.stderr)
            finally:
                self.upstream, self.upstream_streams = None, set()
                if flusher:
                    flusher.cancel()
            if not self.wanted():
                break
            await asyncio.sleep(delay)
            delay = min(30, delay * 2)

    async def flush(self, up) -> None:
        """Sincroniza las suscripciones de Binance con las que piden los clientes, por lotes."""
        req = 1
        while True:
            await asyncio.sleep(FLUSH_EVERY)
            wanted = self.wanted()
            add, drop = sorted(wanted - self.upstream_streams)[:200], sorted(self.upstream_streams - wanted)[:200]
            if not wanted:
                await up.close()
                return
            for method, params in (("SUBSCRIBE", add), ("UNSUBSCRIBE", drop)):
                if params:
                    await up.send(json.dumps({"method": method, "params": params, "id": req}))
                    req += 1
            self.upstream_streams = (self.upstream_streams | set(add)) - set(drop)


hub = Hub()


def stream_of(raw) -> Optional[str]:
    """Nombre del stream de un mensaje combinado de Binance sin decodificar todo el JSON."""
    if isinstance(raw, str) and raw.startswith('{"stream":"'):
        return raw[11:raw.find('"', 11)]
    try:
        return json.loads(raw).get("stream")
    except (ValueError, AttributeError):
        return None


async def send_stock_snapshot(client: Client) -> None:
    quotes = await asyncio.get_running_loop().run_in_executor(None, fetch_live_stock_quotes)
    client.push(json.dumps({"stream": STOCKS, "data": quotes}))


async def ws_market(websocket: WebSocket):
    ip = get_client_ip(websocket)
    if len(hub.clients) >= MAX_CLIENTS or sum(1 for c in hub.clients if c.ip == ip) >= MAX_PER_IP:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    client = Client(websocket, ip)
    hub.clients.add(client)
    writer = asyncio.create_task(client.writer())
    try:
        while True:
            text = await websocket.receive_text()
            if text == "ping":
                client.push("pong")
                continue
            try:
                msg = json.loads(text)
                method, params = msg.get("method"), msg.get("params")
            except (ValueError, AttributeError):
                continue
            if not isinstance(params, list):
                continue
            params = [p for p in params if isinstance(p, str)][:MAX_STREAMS_PER_CLIENT]
            if method == "SUBSCRIBE":
                hub.subscribe(client, params)
            elif method == "UNSUBSCRIBE":
                hub.unsubscribe(client, params)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[Stream] Cliente {ip}: {type(e).__name__}: {e}", file=sys.stderr)
    finally:
        writer.cancel()
        hub.remove(client)


async def stocks_broadcast_worker():
    """Bucle de fondo: cotizaciones de bolsa cada 5 s a los suscriptores de "stocks" y limpieza de memoria."""
    loop_count = 0
    while True:
        try:
            loop_count += 1
            if loop_count % 120 == 0:  # cada 10 minutos
                cleanup_stale_ip_data()
            if hub.refs.get(STOCKS):
                quotes = await asyncio.get_running_loop().run_in_executor(None, fetch_live_stock_quotes)
                hub.publish(STOCKS, json.dumps({"stream": STOCKS, "data": quotes}))
        except Exception as e:
            print(f"[Worker] Error en broadcast: {e}", file=sys.stderr)
        await asyncio.sleep(5)


def status() -> Dict:
    return {
        "clients": len(hub.clients), "streams": len(hub.refs), "upstreamConnected": hub.upstream is not None,
        "upstreamStreams": len(hub.upstream_streams), "messagesRelayed": hub.messages,
        "upstreamSince": int(hub.connected_at) if hub.upstream is not None else None,
    }
