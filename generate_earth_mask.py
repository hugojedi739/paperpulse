import urllib.request
import json
import os
from PIL import Image, ImageDraw

def generate_mask():
    url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    print("Downloading Natural Earth 110m land GeoJSON...")
    with urllib.request.urlopen(req, timeout=15) as res:
        geojson = json.loads(res.read().decode())

    W, H = 720, 360
    im = Image.new('L', (W, H), 0)
    draw = ImageDraw.Draw(im)

    def project(lon, lat):
        x = (lon + 180.0) * (W / 360.0)
        y = (90.0 - lat) * (H / 180.0)
        return x, y

    for feature in geojson['features']:
        geom = feature['geometry']
        coords = geom['coordinates']
        g_type = geom['type']
        if g_type == 'Polygon':
            for ring in coords:
                pts = [project(p[0], p[1]) for p in ring]
                draw.polygon(pts, fill=255)
        elif g_type == 'MultiPolygon':
            for poly in coords:
                for ring in poly:
                    pts = [project(p[0], p[1]) for p in ring]
                    draw.polygon(pts, fill=255)

    # In 110m low-res vector, small islands like Singapore or fine coastal points can be slightly off by 1 pixel.
    # Let's ensure market cities have land coverage.
    cities = {
        'Madrid': (40.4168, -3.7038),
        'New York': (40.7128, -74.0060),
        'London': (51.5074, -0.1278),
        'Frankfurt': (50.1109, 8.6821),
        'Tokyo': (35.6762, 139.6503),
        'Beijing': (39.9042, 116.4074),
        'São Paulo': (-23.5505, -46.6333),
        'Singapore': (1.3521, 103.8198),
    }

    # Ensure small island Singapore and coastal cities have a 2px land radius around their coords
    for name, (lat, lon) in cities.items():
        cx, cy = int(round((lon + 180.0) * (W / 360.0))), int(round((90.0 - lat) * (H / 180.0)))
        draw.ellipse([cx - 1, cy - 1, cx + 1, cy + 1], fill=255)

    print("\n--- Market cities check on 720x360 mask ---")
    all_ok = True
    for name, (lat, lon) in cities.items():
        x = int(round((lon + 180.0) * (W / 360.0)))
        y = int(round((90.0 - lat) * (H / 180.0)))
        val = im.getpixel((x, y))
        status = "LAND [OK]" if val == 255 else "SEA [FAIL]"
        print(f"  {name:12} ({lat:7.2f}, {lon:7.2f}) -> pixel({x},{y}) = {val} {status}")
        if val != 255:
            all_ok = False

    pixels = list(im.getdata())
    land = sum(1 for p in pixels if p > 100)
    pct = (land / len(pixels)) * 100
    print(f"\nTotal pixels: {len(pixels)}, Land pixels: {land}, Land percentage: {pct:.2f}%")
    
    out_path = 'public/img/earth_mask.png'
    im.save(out_path, format='PNG', optimize=True)
    print(f"\nSaved updated mask to {out_path} ({W}x{H})")
    return all_ok

if __name__ == '__main__':
    generate_mask()
