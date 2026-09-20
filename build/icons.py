"""Génère le favicon SVG et les icônes PNG de l'application (PWA).

Le dessin (tête de vache stylisée) est décrit une seule fois ci-dessous, puis rendu
en SVG (favicon) et en PNG (icônes installables), pour que les deux soient identiques.

    python build/icons.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

SITE = Path(__file__).resolve().parent.parent / "site"

VERT = "#2b7a3d"
BLANC = "#ffffff"
GRIS = "#c9d0d6"
GRIS_CLAIR = "#dfe4e8"
ENCRE = "#1d2125"

# Dessin dans un carré de 64 × 64, repris tel quel par les deux rendus
OREILLES = [(9, 20, 25, 32), (39, 20, 55, 32)]           # ellipses (x0, y0, x1, y1)
TETE = (15, 16, 49, 47)                                   # rectangle arrondi, rayon 12
MUSEAU = (22, 34, 42, 50)                                 # ellipse
YEUX = [(24, 27), (40, 27)]                               # centres, rayon 2.6
NASEAUX = [(28.5, 42), (35.5, 42)]                        # centres, rayon 1.8


def svg() -> str:
    o = [f'<ellipse cx="{(a + c) / 2}" cy="{(b + d) / 2}" rx="{(c - a) / 2}" ry="{(d - b) / 2}" fill="{GRIS_CLAIR}"/>'
         for a, b, c, d in OREILLES]
    x0, y0, x1, y1 = TETE
    tete = f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="12" fill="{BLANC}"/>'
    a, b, c, d = MUSEAU
    museau = f'<ellipse cx="{(a + c) / 2}" cy="{(b + d) / 2}" rx="{(c - a) / 2}" ry="{(d - b) / 2}" fill="{GRIS}"/>'
    yeux = [f'<circle cx="{x}" cy="{y}" r="2.6" fill="{ENCRE}"/>' for x, y in YEUX]
    naseaux = [f'<circle cx="{x}" cy="{y}" r="1.8" fill="{ENCRE}"/>' for x, y in NASEAUX]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n'
        f'  <rect width="64" height="64" rx="14" fill="{VERT}"/>\n'
        '  <!-- tête de vache stylisée -->\n  '
        + "\n  ".join(o + [tete, museau] + yeux + naseaux)
        + "\n</svg>\n"
    )


def png(taille: int, *, arrondi: bool, marge: float) -> Image.Image:
    """`marge` : part du côté laissée libre autour du dessin (zone de sécurité des icônes
    « maskable », qu'Android rogne en cercle ou en carré arrondi selon le téléphone)."""
    img = Image.new("RGBA", (taille, taille), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if arrondi:
        d.rounded_rectangle((0, 0, taille - 1, taille - 1), radius=taille * 14 / 64, fill=VERT)
    else:
        d.rectangle((0, 0, taille, taille), fill=VERT)

    dessin = taille * (1 - 2 * marge)
    k = dessin / 64
    decal = taille * marge

    def box(v):
        return [decal + c * k for c in v]

    for e in OREILLES:
        d.ellipse(box(e), fill=GRIS_CLAIR)
    x0, y0, x1, y1 = box(TETE)
    d.rounded_rectangle((x0, y0, x1, y1), radius=12 * k, fill=BLANC)
    d.ellipse(box(MUSEAU), fill=GRIS)
    for cx, cy in YEUX:
        x, y = decal + cx * k, decal + cy * k
        d.ellipse((x - 2.6 * k, y - 2.6 * k, x + 2.6 * k, y + 2.6 * k), fill=ENCRE)
    for cx, cy in NASEAUX:
        x, y = decal + cx * k, decal + cy * k
        d.ellipse((x - 1.8 * k, y - 1.8 * k, x + 1.8 * k, y + 1.8 * k), fill=ENCRE)
    return img


def main() -> None:
    (SITE / "favicon.svg").write_text(svg(), encoding="utf-8")
    png(192, arrondi=True, marge=0).save(SITE / "icon-192.png")
    png(512, arrondi=True, marge=0).save(SITE / "icon-512.png")
    # Icône « maskable » : fond plein et dessin réduit, pour survivre au rognage
    png(512, arrondi=False, marge=0.14).save(SITE / "icon-maskable-512.png")
    png(180, arrondi=False, marge=0.06).save(SITE / "apple-touch-icon.png")
    print("favicon.svg, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png")


if __name__ == "__main__":
    main()
