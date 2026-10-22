# -*- coding: utf-8 -*-
"""
PaperPulse Terminal - Captura Automatizada de Pantallas de Alta Precisión
========================================================================
1. Espera activa a que la app esté completamente cargada (sin spinners de carga).
2. Emulación móvil real mediante CDP: Emulation.setDeviceMetricsOverride (mobile: true, DPR).
3. Captura directa de vistas: Dashboard, Trading, Mercados, Noticias, Diario.
4. Modos: Oscuro (Dark) y Claro (Light), móvil (375, 390, 440 px) y escritorio (1280x800), chat abierto y cerrado.
5. Ruta de Chrome configurable vía variable de entorno CHROME_PATH.
"""

import asyncio
import base64
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

try:
    import websockets
except ImportError:
    websockets = None

SERVER_URL = "http://127.0.0.1:8000"

def get_chrome_path():
    env_path = os.environ.get("CHROME_PATH")
    if env_path and os.path.exists(env_path):
        return env_path
    win_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    for p in win_paths:
        if os.path.exists(p):
            return p
    for binary in ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]:
        found = shutil.which(binary)
        if found:
            return found
    mac_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if os.path.exists(mac_path):
        return mac_path
    return "chrome"

class ScreenshotCapturer:
    def __init__(self, port=9542):
        self.port = port
        self.server_proc = None
        self.chrome_proc = None
        self.ws = None
        self.req_id = 0

    async def send_cmd(self, method, params=None):
        self.req_id += 1
        msg_id = self.req_id
        req = {"id": msg_id, "method": method, "params": params or {}}
        await self.ws.send(json.dumps(req))
        while True:
            raw = await self.ws.recv()
            data = json.loads(raw)
            if data.get("id") == msg_id:
                return data.get("result", {})

    async def eval_js(self, expression):
        res = await self.send_cmd("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True
        })
        if "exceptionDetails" in res:
            err = res["exceptionDetails"].get("exception", {}).get("description", res["exceptionDetails"].get("text", "JS Error"))
            raise RuntimeError(f"Error evaluando JS: {err}")
        return res.get("result", {}).get("value")

    def ensure_server(self):
        server_ready = False
        try:
            with urllib.request.urlopen(f"{SERVER_URL}/api/health", timeout=1.2) as res:
                if res.status == 200:
                    server_ready = True
        except Exception:
            pass

        if not server_ready:
            print("[Capturer] Iniciando servidor PaperPulse en 127.0.0.1:8000...")
            self.server_proc = subprocess.Popen([sys.executable, "server.py"])
            for _ in range(20):
                time.sleep(0.4)
                try:
                    with urllib.request.urlopen(f"{SERVER_URL}/api/health", timeout=1.0) as res:
                        if res.status == 200:
                            server_ready = True
                            break
                except Exception:
                    pass

        if not server_ready:
            raise RuntimeError("No se pudo conectar con el servidor PaperPulse en 127.0.0.1:8000")

    def start(self):
        self.ensure_server()
        chrome_bin = get_chrome_path()
        print(f"[Capturer] Usando navegador: {chrome_bin}")

        cmd = [
            chrome_bin,
            "--headless=new",
            f"--remote-debugging-port={self.port}",
            "--no-sandbox",
            "--disable-gpu",
            "--no-first-run",
            "--hide-scrollbars",
            f"{SERVER_URL}/"
        ]
        self.chrome_proc = subprocess.Popen(cmd)
        time.sleep(2.0)

        ws_url = None
        for _ in range(12):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json", timeout=1.5) as res:
                    tabs = json.loads(res.read().decode())
                    targets = [t for t in tabs if t.get("type") == "page" and "127.0.0.1:8000" in t.get("url", "")]
                    if targets:
                        ws_url = targets[0]["webSocketDebuggerUrl"]
                        break
            except Exception:
                time.sleep(0.4)

        if not ws_url:
            self.stop()
            raise RuntimeError("No se pudo obtener WebSocketDebuggerUrl de Chrome")

        return ws_url

    def stop(self):
        if self.chrome_proc:
            try:
                self.chrome_proc.terminate()
                self.chrome_proc.wait(timeout=3)
            except Exception:
                pass
        if self.server_proc:
            try:
                self.server_proc.terminate()
                self.server_proc.wait(timeout=3)
            except Exception:
                pass

    async def wait_for_app_ready(self, timeout_sec=15.0):
        print("[Capturer] Esperando a que la app esté completamente cargada y sin overlay...")
        start = time.time()
        ready_expr = """
        Boolean(
            window.App &&
            window.App.state &&
            window.App.state.initialized === true &&
            document.getElementById('loading-overlay')?.classList.contains('hidden')
        )
        """
        while time.time() - start < timeout_sec:
            try:
                is_ready = await self.eval_js(ready_expr)
                if is_ready:
                    print(f"[Capturer] App lista en {round(time.time() - start, 2)}s.")
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.2)

        raise TimeoutError("La app no completó la inicialización a tiempo.")

    async def capture_png(self, out_path):
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        res = await self.send_cmd("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
        data = base64.b64decode(res["data"])
        with open(out_path, "wb") as f:
            f.write(data)
        print(f"  [OK] Captura guardada: {out_path}")

    async def run(self, out_dir="screenshots"):
        ws_url = self.start()
        async with websockets.connect(ws_url, max_size=20_000_000) as ws:
            self.ws = ws
            await self.send_cmd("Page.enable")
            await self.send_cmd("Runtime.enable")
            await self.wait_for_app_ready()

            # Matriz de capturas requerida
            # 1. Desktop 1280x800 (Dashboard, Trading, Mercados, Noticias, Diario) en Dark y Light
            print("\n[Capturer] Generando capturas de Escritorio (1280x800)...")
            await self.send_cmd("Emulation.setDeviceMetricsOverride", {
                "width": 1280,
                "height": 800,
                "deviceScaleFactor": 1.0,
                "mobile": False
            })

            views = ["dashboard", "trading", "markets", "news", "journal"]
            for th in ["dark", "light"]:
                for v in views:
                    setup_script = f"""
                    (() => {{
                        window.App.switchView('{v}');
                        document.body.setAttribute('data-theme', '{th}');
                        document.body.classList.toggle('light-theme', '{th}' === 'light');
                        if (window.Chat) window.Chat.toggleChat(false);
                    }})()
                    """
                    await self.eval_js(setup_script)
                    await asyncio.sleep(0.3)
                    await self.capture_png(f"{out_dir}/desktop_{v}_{th}.png")

            # 2. Captura con Chat abierto en escritorio
            await self.eval_js("window.Chat.toggleChat(true)")
            await asyncio.sleep(0.3)
            await self.capture_png(f"{out_dir}/desktop_chat_open_dark.png")
            await self.eval_js("window.Chat.toggleChat(false)")

            # 3. Mobile (375, 390, 440 px)
            mobile_widths = [
                ("375", 375, 667, 2.0),
                ("390", 390, 844, 3.0),
                ("440", 440, 956, 3.0)
            ]
            print("\n[Capturer] Generando capturas Móviles reales (Emulation.setDeviceMetricsOverride)...")
            await self.send_cmd("Emulation.setUserAgentOverride", {
                "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            })

            for label, w, h, dpr in mobile_widths:
                await self.send_cmd("Emulation.setDeviceMetricsOverride", {
                    "width": w,
                    "height": h,
                    "deviceScaleFactor": dpr,
                    "mobile": True,
                    "fitWindow": False
                })

                for v in views:
                    setup_script = f"""
                    (() => {{
                        window.App.switchView('{v}');
                        document.body.setAttribute('data-theme', 'dark');
                        document.body.classList.remove('light-theme');
                        if (window.Chat) window.Chat.toggleChat(false);
                    }})()
                    """
                    await self.eval_js(setup_script)
                    await asyncio.sleep(0.2)
                    await self.capture_png(f"{out_dir}/mobile_{label}_{v}_dark.png")

                # Captura con Chat Abierto en móvil
                chat_mobile_script = f"""
                (() => {{
                    window.App.switchView('dashboard');
                    if (window.Chat) window.Chat.toggleChat(true);
                }})()
                """
                await self.eval_js(chat_mobile_script)
                await asyncio.sleep(0.3)
                await self.capture_png(f"{out_dir}/mobile_{label}_chat_open_dark.png")
                await self.eval_js("window.Chat.toggleChat(false)")

            print(f"\n[Capturer] Todas las capturas generadas con éxito en '{out_dir}/'.")

def main():
    capturer = ScreenshotCapturer()
    try:
        asyncio.run(capturer.run())
        return 0
    finally:
        capturer.stop()

if __name__ == "__main__":
    sys.exit(main())
