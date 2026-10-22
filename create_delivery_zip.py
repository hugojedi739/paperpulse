import zipfile
import os

zip_path = "paperpulse_entrega_final.zip"
print(f"Creando paquete de entrega: {zip_path}")

with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    # 1. styles.css
    css_src = os.path.join("public", "css", "styles.css")
    if os.path.exists(css_src):
        zf.write(css_src, arcname="styles.css")
        zf.write(css_src, arcname="public/css/styles.css")
        print("  + styles.css")

    # 2. Carpeta img/ completa
    img_dir = os.path.join("public", "img")
    for root, dirs, files in os.walk(img_dir):
        for f in files:
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, "public")
            zf.write(full_path, arcname=rel_path)
            zf.write(full_path, arcname=f"public/{rel_path}")
            print(f"  + {rel_path}")

    # 3. Pruebas
    tests = [
        "tests/test_calculations.js",
        "tests/test_calculations.py",
        "tests/test_news_filter.py"
    ]
    for t in tests:
        if os.path.exists(t):
            zf.write(t, arcname=t)
            zf.write(t, arcname=os.path.basename(t))
            print(f"  + {t}")

    # 4. Carpeta screenshots/ completa
    screens_dir = "screenshots"
    for f in os.listdir(screens_dir):
        if f.endswith(".png"):
            full_path = os.path.join(screens_dir, f)
            zf.write(full_path, arcname=f"screenshots/{f}")
            print(f"  + screenshots/{f}")

    # 5. Informes
    reports = [
        "mobile_verification_report.json",
        "earth_mask_check.json"
    ]
    for r in reports:
        if os.path.exists(r):
            zf.write(r, arcname=r)
            print(f"  + {r}")

print(f"\nPaquete creado con éxito: {os.path.abspath(zip_path)} ({os.path.getsize(zip_path)} bytes)")
