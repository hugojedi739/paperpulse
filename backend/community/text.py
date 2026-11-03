"""Validación del texto que escriben los usuarios.

Política: el texto se guarda TAL CUAL (sin escapar HTML). Escapar aquí daría «&lt;» doble si alguien lo pinta
escapando otra vez, y no protegería a quien lo pinte con innerHTML. La protección contra XSS está en el frontend,
que muestra todo texto de usuario con textContent, y en la CSP estricta (sin scripts inline).

Aquí solo se normaliza (Unicode NFC), se quitan caracteres de control e invisibles peligrosos y se comprueban
longitudes. Si un texto es demasiado largo se rechaza (no se recorta en silencio).
"""
import re
import unicodedata

from backend.community.common import CommunityError

LIMITS = {
    "alias": (3, 20),
    "bio": (0, 280),
    "title": (5, 120),
    "body": (1, 5000),
    "comment": (0, 2000),
    "details": (0, 500),
    "reason": (0, 300),
}
NAMES = {"alias": "El alias", "bio": "La bio", "title": "El título", "body": "El mensaje", "comment": "El comentario",
         "details": "El detalle", "reason": "El motivo"}
ALIAS_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")
RESERVED_ALIASES = {"admin", "administrador", "administracion", "moderador", "moderacion", "mod", "paperpulse",
                    "sistema", "system", "root", "soporte", "support", "staff", "anonimo", "eliminado"}
ZWJ = "\u200d"  # se conserva: une emojis compuestos


class TextError(CommunityError):
    """Texto no válido (HTTP 400)."""


def clean(value, field: str, multiline: bool = True) -> str:
    """Normaliza y valida un texto. Lanza TextError con un mensaje para el usuario."""
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise TextError(f"{NAMES[field]} debe ser texto.")
    text = unicodedata.normalize("NFC", value).replace("\r\n", "\n").replace("\r", "\n")
    out = []
    for ch in text:
        cat = unicodedata.category(ch)
        if ch == "\n" and multiline:
            out.append(ch)
        elif ch == "\t":
            out.append(" ")
        elif cat in ("Cc", "Cs", "Co", "Cn") or (cat == "Cf" and ch != ZWJ):
            continue  # control, invisibles y marcas de dirección (U+202E...) que permiten disfrazar texto
        elif cat in ("Zl", "Zp"):
            out.append("\n" if multiline else " ")
        else:
            out.append(ch)
    text = "".join(out)
    if multiline:
        text = re.sub(r"[  ]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)  # como mucho una línea en blanco seguida
    else:
        text = re.sub(r"\s+", " ", text)
    text = text.strip()
    low, high = LIMITS[field]
    if len(text) < low:
        raise TextError(f"{NAMES[field]} es demasiado corto (mínimo {low} caracteres)." if low > 1 else f"{NAMES[field]} no puede estar vacío.")
    if len(text) > high:
        raise TextError(f"{NAMES[field]} es demasiado largo (máximo {high} caracteres; tiene {len(text)}).")
    return text


def alias(value) -> str:
    if not isinstance(value, str) or not ALIAS_RE.match(value.strip()):
        raise TextError("El alias debe tener entre 3 y 20 caracteres: letras sin tilde, números y guion bajo.")
    value = value.strip()
    if value.lower() in RESERVED_ALIASES:
        raise TextError("Ese alias está reservado. Elige otro.")
    return value
