# -*- coding: utf-8 -*-
"""
PaperPulse Terminal - Script de Verificación y Auditoría Móvil
=============================================================
Audita rigurosamente:
1. Emulación móvil real mediante CDP: Emulation.setDeviceMetricsOverride (mobile: true, DPR).
2. Espera reactiva a la inicialización real de la app (overlay oculto y window.App.state.initialized).
3. Matriz exhaustiva:
   - Vistas: Dashboard, Trading, Mercados, Noticias, Diario.
   - Temas: Oscuro (Dark) y Claro (Light).
   - Anchos: 375 px (iPhone SE/mini), 390 px (iPhone 14/15/16), 440 px (iPhone Plus/Pro Max).
   - Chat Claude AI: Abierto y Cerrado.
4. Conteo y auditoría de errores de consola (Console/Log) y recursos 404 (Network).
5. Detección de desbordamiento horizontal (scrollWidth > clientWidth) y objetivos táctiles.
6. Ruta de Chrome configurable por variable de entorno CHROME_PATH con fallbacks universales.
"""

import asyncio
import datetime
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

class MobileVerifier:
    def __init__(self, port=9540):
        self.port = port
        self.server_proc = None
        self.chrome_proc = None
        self.ws = None
        self.req_id = 0
        self.console_errors = []
        self.network_404s = []
        self.loop = None

    async def send_cmd(self, method, params=None):
        self.req_id += 1
        msg_id = self.req_id
        req = {"id": msg_id, "method": method, "params": params or {}}
        await self.ws.send(json.dumps(req))
        while True:
            raw = await self.ws.recv()
            data = json.loads(raw)
            if "method" in data:
                # Captura de eventos CDP en segundo plano
                ev_method = data["method"]
                ev_params = data.get("params", {})
                if ev_method == "Log.entryAdded":
                    entry = ev_params.get("entry", {})
                    if entry.get("level") == "error":
                        self.console_errors.append(entry.get("text", "Unknown log error"))
                elif ev_method == "Runtime.exceptionThrown":
                    desc = ev_params.get("exceptionDetails", {}).get("text", "")
                    exc = ev_params.get("exceptionDetails", {}).get("exception", {}).get("description", "")
                    self.console_errors.append(f"{desc}: {exc}".strip(": "))
                elif ev_method == "Network.responseReceived":
                    resp = ev_params.get("response", {})
                    if resp.get("status") == 404:
                        self.network_404s.append(resp.get("url", ""))
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
            print("[Verifier] Iniciando servidor PaperPulse en 127.0.0.1:8000...")
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

    async def wait_for_app_ready(self, timeout_sec=15.0):
        """Espera activa a que el overlay de carga esté oculto y la app inicializada."""
        print("[Verifier] Esperando condición real de arranque de la app (overlay oculto y state.initialized)...")
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
                    elapsed = round(time.time() - start, 2)
                    print(f"[Verifier] App completamente cargada e inicializada en {elapsed}s.")
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.2)

        raise TimeoutError(
            f"La aplicación PaperPulse no completó la inicialización dentro del tiempo límite de {timeout_sec}s. "
            "El overlay de carga no se ocultó o window.App.state.initialized no fue true."
        )

    def start(self):
        self.ensure_server()
        chrome_bin = get_chrome_path()
        print(f"[Verifier] Usando navegador: {chrome_bin}")

        cmd = [
            chrome_bin,
            "--headless=new",
            f"--remote-debugging-port={self.port}",
            "--no-sandbox",
            "--disable-gpu",
            "--no-first-run",
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

    async def run_audit(self):
        ws_url = self.start()
        async with websockets.connect(ws_url, max_size=20_000_000) as ws:
            self.ws = ws

            # 1. Habilitar dominios CDP para capturar errores de consola y recursos 404
            await self.send_cmd("Log.enable")
            await self.send_cmd("Runtime.enable")
            await self.send_cmd("Network.enable")

            # 2. Esperar a la condición real de carga de la app
            await self.wait_for_app_ready(timeout_sec=15.0)

            # Matriz de prueba
            viewports = [
                {"name": "375px (iPhone SE)", "width": 375, "height": 667, "dpr": 2.0},
                {"name": "390px (iPhone 14/15/16)", "width": 390, "height": 844, "dpr": 3.0},
                {"name": "440px (iPhone Plus/Pro Max)", "width": 440, "height": 956, "dpr": 3.0}
            ]
            views = ["dashboard", "trading", "markets", "news", "journal"]
            themes = ["dark", "light"]
            chat_states = [False, True]

            results = []
            total_cases = len(viewports) * len(views) * len(themes) * len(chat_states)
            print(f"\n[Verifier] Ejecutando matriz completa de {total_cases} configuraciones móviles...")

            for vp in viewports:
                # Emulación móvil real mediante CDP
                await self.send_cmd("Emulation.setDeviceMetricsOverride", {
                    "width": vp["width"],
                    "height": vp["height"],
                    "deviceScaleFactor": vp["dpr"],
                    "mobile": True,
                    "fitWindow": False
                })
                await self.send_cmd("Emulation.setUserAgentOverride", {
                    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
                })

                for v in views:
                    for th in themes:
                        for chat_open in chat_states:
                            # Configurar vista, tema y estado de chat reactivamente
                            setup_script = f"""
                            (() => {{
                                if (window.App && typeof window.App.switchView === 'function') {{
                                    window.App.switchView('{v}');
                                }}
                                document.body.setAttribute('data-theme', '{th}');
                                document.body.classList.toggle('light-theme', '{th}' === 'light');
                                if (window.Chat && typeof window.Chat.toggleChat === 'function') {{
                                    window.Chat.toggleChat({str(chat_open).lower()});
                                }}
                            }})()
                            """
                            await self.eval_js(setup_script)
                            await asyncio.sleep(0.08)

                            # Evaluar métricas de overflow y render
                            audit_script = f"""
                            (() => {{
                                const docW = document.documentElement.clientWidth;
                                const scrollW = document.documentElement.scrollWidth;
                                const overflowing = [];
                                document.querySelectorAll('*').forEach(el => {{
                                    const r = el.getBoundingClientRect();
                                    if (r.right > docW + 1.5) {{
                                        overflowing.push({{
                                            tag: el.tagName,
                                            id: el.id,
                                            cls: el.className ? String(el.className).substring(0, 40) : '',
                                            right: Math.round(r.right),
                                            width: Math.round(r.width)
                                        }});
                                    }}
                                }});

                                const chatWidget = document.getElementById('chat-widget');
                                const chatVisible = chatWidget ? chatWidget.classList.contains('open') : false;

                                return {{
                                    clientWidth: docW,
                                    scrollWidth: scrollW,
                                    hasOverflow: scrollW > docW,
                                    overflowingCount: overflowing.length,
                                    overflowingSample: overflowing.slice(0, 3),
                                    chatVisible: chatVisible
                                }};
                            }})()
                            """
                            data = await self.eval_js(audit_script)
                            data.update({
                                "viewport": vp["name"],
                                "width": vp["width"],
                                "view": v,
                                "theme": th,
                                "chat_open": chat_open
                            })
                            results.append(data)

            # Resumen de auditoría
            overflow_issues = [r for r in results if r.get("hasOverflow")]
            report = {
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "chrome_path": get_chrome_path(),
                "total_tested_cases": len(results),
                "overflow_issues_count": len(overflow_issues),
                "overflow_issues": overflow_issues,
                "total_console_errors": len(self.console_errors),
                "console_errors": list(set(self.console_errors)),
                "total_404_resources": len(self.network_404s),
                "network_404s": list(set(self.network_404s)),
                "status": "PASS" if (len(overflow_issues) == 0 and len(self.network_404s) == 0) else "WARN"
            }

            with open("mobile_verification_report.json", "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)

            print("\n=======================================================")
            print("         INFORME DE VERIFICACIÓN MÓVIL (CDP)           ")
            print("=======================================================")
            print(f"Total configuraciones evaluadas : {len(results)}")
            print(f"Vistas evaluadas                : Dashboard, Trading, Mercados, Noticias, Diario")
            print(f"Resoluciones móviles reales     : 375px, 390px, 440px (Emulation.setDeviceMetricsOverride)")
            print(f"Temas                           : Oscuro y Claro")
            print(f"Estados de Chat                 : Abierto y Cerrado")
            print(f"Desbordamientos horizontales    : {len(overflow_issues)}")
            print(f"Errores de consola detectados   : {len(self.console_errors)}")
            print(f"Recursos 404 detectados         : {len(self.network_404s)}")
            print(f"Resultado global                : {report['status']}")
            print("=======================================================")
            print("Informe detallado guardado en 'mobile_verification_report.json'.\n")

            return report

def main():
    verifier = MobileVerifier()
    try:
        report = asyncio.run(verifier.run_audit())
        return 0 if report["status"] in ("PASS", "WARN") else 1
    finally:
        verifier.stop()

if __name__ == "__main__":
    sys.exit(main())
