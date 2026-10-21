import asyncio
import json
import subprocess
import time
import urllib.request
import websockets

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

async def eval_js(ws_url, expr):
    async with websockets.connect(ws_url) as ws:
        msg_id = 1
        req = {
            "id": msg_id,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expr,
                "returnByValue": True,
                "awaitPromise": True
            }
        }
        await ws.send(json.dumps(req))
        resp = await ws.recv()
        data = json.loads(resp)
        return data.get("result", {}).get("result", {}).get("value")

def test_screen(width=440, height=956, view="trading", theme="dark"):
    port = 9444
    url = f"http://localhost:8000/?view={view}&theme={theme}"
    cmd = [
        CHROME_PATH,
        "--headless=new",
        f"--remote-debugging-port={port}",
        f"--window-size={width},{height}",
        "--no-sandbox",
        "--disable-gpu",
    ]
    if width <= 500:
        cmd.append("--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
    cmd.append(url)
    proc = subprocess.Popen(cmd)
    try:
        time.sleep(3)
        with urllib.request.urlopen(f"http://localhost:{port}/json") as res:
            tabs = json.loads(res.read().decode())
            target_tab = None
            for t in tabs:
                if t.get("type") == "page" and "localhost:8000" in t.get("url", ""):
                    target_tab = t
                    break
            if not target_tab and tabs:
                target_tab = tabs[0]
            ws_url = target_tab["webSocketDebuggerUrl"]

        js_script = """
        (() => {
            const docW = document.documentElement.clientWidth;
            const scrollW = document.documentElement.scrollWidth;
            const overflowing = [];
            document.querySelectorAll('*').forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.right > docW + 1) {
                    overflowing.push({
                        tag: el.tagName,
                        id: el.id,
                        cls: el.className ? String(el.className).substring(0, 50) : '',
                        right: Math.round(r.right),
                        width: Math.round(r.width),
                        left: Math.round(r.left)
                    });
                }
            });

            // Check touch targets on navbar and bottom bar
            const smallTargets = [];
            const interactiveSelectors = [
                '.navbar button', '.navbar .avatar', '.navbar a',
                '.mobile-bottom-nav a', '.mobile-bottom-nav button',
                '.symbol-pill', '.time-btn', '.chart-indicator-btn'
            ];
            document.querySelectorAll(interactiveSelectors.join(',')).forEach(el => {
                if (el.offsetParent !== null) { // visible
                    const r = el.getBoundingClientRect();
                    if (r.width < 44 || r.height < 44) {
                        smallTargets.push({
                            tag: el.tagName,
                            id: el.id,
                            cls: String(el.className).substring(0, 30),
                            w: Math.round(r.width),
                            h: Math.round(r.height),
                            text: el.innerText ? el.innerText.trim().substring(0, 20) : ''
                        });
                    }
                }
            });

            // Chart container height ratio
            const chart = document.getElementById('main-chart-container') || document.querySelector('.main-chart-container');
            const chartHeight = chart ? chart.getBoundingClientRect().height : 0;
            const winHeight = window.innerHeight;

            return {
                docW,
                scrollW,
                hasOverflow: scrollW > docW,
                overflowingCount: overflowing.length,
                overflowingSample: overflowing.slice(0, 10),
                smallTargetsCount: smallTargets.length,
                smallTargetsSample: smallTargets.slice(0, 10),
                chartHeight,
                winHeight,
                chartRatio: Math.round((chartHeight / winHeight) * 100) + '%'
            };
        })()
        """
        result = asyncio.run(eval_js(ws_url, js_script))
        return result
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except Exception:
            pass

if __name__ == "__main__":
    for w, h in [(375, 667), (390, 844), (440, 956)]:
        res = test_screen(w, h, "trading")
        print(f"\n--- Screen {w}x{h} (Trading) ---")
        print(json.dumps(res, indent=2))
