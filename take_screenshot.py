import os
import sys
import shutil
import tempfile
import subprocess
import time

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

def capture(url, out_path, width=1280, height=800, theme="dark"):
    tmp_out = os.path.join(tempfile.gettempdir(), f"shot_{int(time.time()*1000)}.png")
    full_url = f"{url}?theme={theme}" if "?" not in url else f"{url}&theme={theme}"
    
    cmd = [
        CHROME_PATH,
        "--headless=new",
        f"--screenshot={tmp_out}",
        f"--window-size={width},{height}",
        "--virtual-time-budget=3500",
        "--no-sandbox",
        "--disable-gpu",
        "--hide-scrollbars",
        full_url
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=20)
        if os.path.exists(tmp_out):
            os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
            shutil.copy(tmp_out, out_path)
            try:
                os.remove(tmp_out)
            except Exception:
                pass
            print(f"[OK] Captured: {out_path} ({width}x{height}, {theme})")
            return True
    except Exception as e:
        print(f"[ERROR] Failed capture {out_path}: {e}")
        return False

def capture_suite(prefix, base_url="http://localhost:8000/"):
    # Desktop dark & light
    capture(f"{base_url}?view=dashboard", f"screenshots/{prefix}_desktop_dark.png", width=1280, height=800, theme="dark")
    capture(f"{base_url}?view=dashboard", f"screenshots/{prefix}_desktop_light.png", width=1280, height=800, theme="light")
    # Markets view
    capture(f"{base_url}?view=markets", f"screenshots/{prefix}_markets_desktop_dark.png", width=1280, height=800, theme="dark")
    # Trading with Spanish stock
    capture(f"{base_url}?view=trading&symbol=SAN", f"screenshots/{prefix}_trading_san_dark.png", width=1280, height=800, theme="dark")
    # Mobile (iPhone 16 Pro Max 440x956 and 390x844) dark & light
    capture(f"{base_url}?view=dashboard", f"screenshots/{prefix}_mobile_440_dark.png", width=440, height=956, theme="dark")
    capture(f"{base_url}?view=dashboard", f"screenshots/{prefix}_mobile_440_light.png", width=440, height=956, theme="light")

if __name__ == "__main__":
    prefix = sys.argv[1] if len(sys.argv) > 1 else "shot"
    capture_suite(prefix)
