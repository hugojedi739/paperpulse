# -*- coding: utf-8 -*-
"""
Generación y Validación de la Máscara de Tierra (Earth Mask)
PaperPulse Terminal - Globo 3D

Reglas estrictas:
1. Versión fija del conjunto de datos Natural Earth (v5.1.2, no master).
2. Comprobación de ciudades ANTES de pintar nada.
3. Prohibido pintar puntos artificiales/falsos de tierra sobre el mapa.
4. Si una coordenada cae en el mar, buscar la tierra más cercana para ajustar el marcador en el globo.
5. Guardar el resultado formal de la comprobación en 'earth_mask_check.json'.
"""

import urllib.request
import json
import os
import sys
import math
import datetime
from PIL import Image, ImageDraw

NATURAL_EARTH_VERSION = "v5.1.2"
GEOJSON_URL = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{NATURAL_EARTH_VERSION}/geojson/ne_110m_land.geojson"

MARKET_CITIES = {
    'Madrid': (40.4168, -3.7038),
    'New York': (40.7128, -74.0060),
    'London': (51.5074, -0.1278),
    'Frankfurt': (50.1109, 8.6821),
    'Tokyo': (35.6762, 139.6503),
    'Beijing': (39.9042, 116.4074),
    'São Paulo': (-23.5505, -46.6333),
    'Singapore': (1.3521, 103.8198),
}

def project(lon, lat, width=720, height=360):
    x = int(round((lon + 180.0) * (width / 360.0)))
    y = int(round((90.0 - lat) * (height / 180.0)))
    x = max(0, min(width - 1, x))
    y = max(0, min(height - 1, y))
    return x, y

def unproject(x, y, width=720, height=360):
    lon = (x * 360.0 / width) - 180.0
    lat = 90.0 - (y * 180.0 / height)
    return lat, lon

def find_nearest_land(im, start_x, start_y, max_search_radius=15):
    """Encuentra el píxel de tierra (valor 255) más cercano en un radio dado sin alterar la imagen."""
    width, height = im.size
    best_dist = float('inf')
    best_pixel = None

    for r in range(1, max_search_radius + 1):
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                nx, ny = start_x + dx, start_y + dy
                if 0 <= nx < width and 0 <= ny < height:
                    if im.getpixel((nx, ny)) == 255:
                        dist = math.hypot(dx, dy)
                        if dist < best_dist:
                            best_dist = dist
                            best_pixel = (nx, ny)
        if best_pixel is not None:
            break

    return best_pixel, best_dist

def generate_mask(out_path="public/img/earth_mask.png", check_report_path="earth_mask_check.json"):
    print(f"Descargando GeoJSON Natural Earth {NATURAL_EARTH_VERSION}...")
    req = urllib.request.Request(GEOJSON_URL, headers={"User-Agent": "PaperPulseMaskGenerator/2.5"})
    with urllib.request.urlopen(req, timeout=20) as res:
        geojson = json.loads(res.read().decode())

    W, H = 720, 360
    im = Image.new('L', (W, H), 0)
    draw = ImageDraw.Draw(im)

    def to_canvas(lon, lat):
        return (lon + 180.0) * (W / 360.0), (90.0 - lat) * (H / 180.0)

    # 1. Dibujar polígonos de tierra oficiales exclusivamente
    for feature in geojson['features']:
        geom = feature['geometry']
        coords = geom['coordinates']
        g_type = geom['type']
        if g_type == 'Polygon':
            for ring in coords:
                pts = [to_canvas(p[0], p[1]) for p in ring]
                draw.polygon(pts, fill=255)
        elif g_type == 'MultiPolygon':
            for poly in coords:
                for ring in poly:
                    pts = [to_canvas(p[0], p[1]) for p in ring]
                    draw.polygon(pts, fill=255)

    # CERO manipulación del mapa: NO se pintan círculos ni píxeles artificiales de tierra.

    # 2. Comprobación estricta de las ciudades de mercado sobre la tierra real
    print(f"\n--- Comprobación de ciudades de mercado sobre máscara pura {W}x{H} ({NATURAL_EARTH_VERSION}) ---")
    results = {}
    all_ok = True

    for name, (lat, lon) in MARKET_CITIES.items():
        x, y = project(lon, lat, W, H)
        val = im.getpixel((x, y))
        is_land = (val == 255)

        city_result = {
            "latitude": lat,
            "longitude": lon,
            "pixel_x": x,
            "pixel_y": y,
            "pixel_value": val,
            "is_land": is_land,
            "adjusted": False
        }

        if is_land:
            status = "TIERRA [OK]"
            print(f"  {name:12} ({lat:7.2f}, {lon:7.2f}) -> pixel({x},{y}) = {val} {status}")
        else:
            status = "MAR [AJUSTE REQUERIDO]"
            all_ok = False
            nearest_pixel, dist = find_nearest_land(im, x, y, max_search_radius=15)
            if nearest_pixel:
                adj_lat, adj_lon = unproject(nearest_pixel[0], nearest_pixel[1], W, H)
                city_result["adjusted"] = True
                city_result["adjusted_latitude"] = round(adj_lat, 4)
                city_result["adjusted_longitude"] = round(adj_lon, 4)
                city_result["nearest_land_pixel"] = nearest_pixel
                city_result["pixel_distance"] = round(dist, 2)
                print(f"  {name:12} ({lat:7.2f}, {lon:7.2f}) -> pixel({x},{y}) = {val} {status}. Ajuste recomendado: ({adj_lat:.4f}, {adj_lon:.4f}) a dist {dist:.1f}px")
            else:
                print(f"  {name:12} ({lat:7.2f}, {lon:7.2f}) -> pixel({x},{y}) = {val} {status}. No se encontró tierra cercana.")

        results[name] = city_result

    # 3. Métricas de cobertura de tierra
    raw_bytes = im.tobytes()
    land_pixels = raw_bytes.count(b'\xff') if isinstance(raw_bytes, bytes) else sum(1 for p in raw_bytes if p == 255)
    pct = (land_pixels / len(raw_bytes)) * 100
    print(f"\nTotal píxeles: {len(raw_bytes)}, Píxeles tierra: {land_pixels}, Porcentaje tierra: {pct:.2f}%")

    # 4. Guardar imagen de máscara limpia y no trucada
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    im.save(out_path, format='PNG', optimize=True)
    print(f"Máscara guardada en {out_path} ({W}x{H})")

    # 5. Guardar informe formal de verificación
    report = {
        "dataset": "Natural Earth 110m Land",
        "dataset_version": NATURAL_EARTH_VERSION,
        "source_url": GEOJSON_URL,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "resolution": {"width": W, "height": H},
        "land_percentage": round(pct, 2),
        "total_pixels": len(raw_bytes),
        "land_pixels": land_pixels,
        "all_cities_on_land": all_ok,
        "cities": results
    }

    with open(check_report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"Resultado de comprobación guardado en {check_report_path}")

    return all_ok

if __name__ == '__main__':
    ok = generate_mask()
    if not ok:
        print("[AVISO] Algunas coordenadas requirieron ajuste para coincidir con tierra.", file=sys.stderr)
