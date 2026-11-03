"""Punto de entrada: `python server.py` (desarrollo) o `uvicorn server:app` (producción, Vercel).

El código del backend está en backend/ y el frontend en frontend/. Ver README.md.
"""
import socket
import sys

from backend.app import app  # noqa: F401  (Vercel y uvicorn buscan `app` aquí)
from backend.config import PORT

if __name__ == "__main__":
    import uvicorn

    # Socket dual-stack (IPv4 + IPv6); SO_REUSEADDR permite reiniciar sin esperar a TIME_WAIT
    try:
        sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        sock.bind(("::", PORT))
        uvicorn.Server(uvicorn.Config(app, log_level="info", proxy_headers=True)).run(sockets=[sock])
    except OSError as e:
        print(f"[Server] Socket dual-stack no disponible ({e}); usando IPv4", file=sys.stderr)
        uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
