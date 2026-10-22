# -*- coding: utf-8 -*-
"""
Script de Preparación y Compilación para Despliegues Estáticos (Vercel / Netlify / Cloudflare Pages)
===================================================================================================
En entornos estáticos sin server.py (como Vercel Static), este script se ejecuta durante
el paso de 'build' ('python build.py' o configurado en vercel.json) para:
1. Reemplazar 'https://paperpulse.app/' en public/index.html y public/manifest.json
   por el dominio real de producción especificado en APP_DOMAIN o VERCEL_PROJECT_PRODUCTION_URL.
2. Garantizar que los enlaces canónicos, Open Graph y Manifest apunten al dominio correcto.
"""

import os
import sys

def build_static():
    app_domain = os.environ.get("APP_DOMAIN") or os.environ.get("VERCEL_PROJECT_PRODUCTION_URL") or os.environ.get("VERCEL_URL")
    if not app_domain:
        print("[Build Static] AVISO: Variable APP_DOMAIN o VERCEL_URL no detectada. Manteniendo dominio por defecto.")
        return 0

    if not app_domain.startswith("http://") and not app_domain.startswith("https://"):
        app_domain = f"https://{app_domain}"
    app_domain = app_domain.rstrip("/")

    print(f"[Build Static] Configurando dominio de despliegue: {app_domain}")

    files_to_process = [
        "public/index.html",
        "public/manifest.json"
    ]

    for filepath in files_to_process:
        if not os.path.exists(filepath):
            continue
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        updated = content.replace("https://paperpulse.app/", f"{app_domain}/")
        updated = updated.replace("https://paperpulse.app", app_domain)

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(updated)
        print(f"  [OK] Actualizado {filepath} con canonical a {app_domain}")

    print("[Build Static] Compilación estática completada con éxito.")
    return 0

if __name__ == "__main__":
    sys.exit(build_static())
