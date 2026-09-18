"""Télécharge les nouvelles cotations CSV publiées par FranceAgriMer (Visionet).

1. On liste les fichiers publiés dans chaque rubrique.
2. On télécharge les ZIP hebdomadaires/mensuels « toutes espèces » pas encore
   traités (beaucoup plus rapide que fichier par fichier) et on range leurs CSV.
3. On télécharge un par un les CSV listés qui manquent encore.

Les CSV sont stockés tels quels (encodage d'origine cp1252) dans data/raw/.
"""

from __future__ import annotations

import io
import re
import sys
import time
import zipfile
from pathlib import Path
from urllib.parse import quote

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
ZIPS_DONE = RAW_DIR / "zips_traites.txt"

SITE = "https://visionet.franceagrimer.fr"
LIST_URL = f"{SITE}/Pages/SeriesChronologiquesDetail.aspx"
DOC_URL = f"{SITE}/Pages/OpenDocument.aspx"
BASE_PATH = "Statistiques/productions animales/viandes/cotations en format csv"
ZIP_RUBRIQUE = "ZIP csv toutes espèces"

# Nom de la rubrique sur Visionet -> dossier local
RUBRIQUES = {
    "caprins": "caprins",
    "équidés": "equides",
    "Gros bovins entrée abattoir STD": "gros-bovins-abattoir-std",
    "Gros bovins entrée abattoir SIQO": "gros-bovins-abattoir-siqo",
    "Gros bovins entrée abattoir BIO": "gros-bovins-abattoir-bio",
    "gros bovins maigres": "gros-bovins-maigres",
    "gros bovins vifs": "gros-bovins-vifs",
    "ovins de boucherie": "ovins",
    "porcs charcutiers": "porcs",
    "veaux de 14 jours à 4 semaines": "veaux-14j",
    "veaux de boucherie": "veaux-boucherie",
}
AUTRES = "autres"  # CSV trouvés dans un ZIP mais listés dans aucune rubrique

HEADERS = {"User-Agent": "leprixdubetail.fr (collecte des cotations publiques FranceAgriMer)"}


def series_key(name: str) -> str:
    """'COT-VRO-veaux_PMP-A26-S37.csv' -> 'cot-vro-veaux_pmp'."""
    return re.sub(r"-A\d+-[SM]\d+.*$", "", name, flags=re.IGNORECASE).lower()


def list_files(session: requests.Session, rubrique: str, ext: str) -> list[str]:
    resp = session.post(
        LIST_URL,
        data={
            "niveau": "1",
            "dossierRacine": "cotations en format csv",
            "menuId": "",
            "menuTitre": rubrique,
            "menuUrl": f"{BASE_PATH}/{rubrique}",
            "niveauMax": "False",
        },
        timeout=300,
    )
    resp.raise_for_status()
    pattern = re.compile(rf'fileurl="[^"]*/([^"/]+?\.{ext})&telecharger', re.IGNORECASE)
    return sorted(set(pattern.findall(resp.content.decode("utf-8", "replace"))))


def download(session: requests.Session, rubrique: str, name: str) -> bytes | None:
    fileurl = quote(f"{BASE_PATH}/{rubrique}/{name}", safe="")
    resp = session.get(f"{DOC_URL}?fileurl={fileurl}&telechargersanscomptage=oui", timeout=120)
    resp.raise_for_status()
    # Un fichier listé mais absent renvoie une page HTML d'erreur au lieu du fichier
    if resp.headers.get("Content-Type", "").startswith("text/html"):
        return None
    return resp.content


def main() -> int:
    session = requests.Session()
    session.headers.update(HEADERS)
    errors = 0
    new_files = 0

    # 1. Inventaire des rubriques
    listed: dict[str, list[str]] = {}
    folder_for_series: dict[str, str] = {}
    for rubrique, folder in RUBRIQUES.items():
        try:
            names = list_files(session, rubrique, "csv")
        except requests.RequestException as exc:
            print(f"[ERREUR] liste {rubrique}: {exc}", file=sys.stderr)
            errors += 1
            continue
        listed[rubrique] = names
        for n in names:
            folder_for_series[series_key(n)] = folder
        print(f"{rubrique}: {len(names)} fichiers publiés")

    if not listed:
        print("Aucune rubrique n'a pu être listée", file=sys.stderr)
        return 1

    def target_path(name: str) -> Path:
        return RAW_DIR / folder_for_series.get(series_key(name), AUTRES) / name

    # 2. ZIP « toutes espèces » pas encore traités
    done = set(ZIPS_DONE.read_text(encoding="utf-8").split()) if ZIPS_DONE.exists() else set()
    try:
        zips = [z for z in list_files(session, ZIP_RUBRIQUE, "zip") if z not in done]
    except requests.RequestException as exc:
        print(f"[ERREUR] liste des ZIP: {exc}", file=sys.stderr)
        zips = []
    print(f"{len(zips)} ZIP à traiter")
    for zname in zips:
        try:
            content = download(session, ZIP_RUBRIQUE, zname)
            if content is None:
                continue
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                for member in zf.namelist():
                    name = Path(member).name
                    if not name.lower().endswith(".csv"):
                        continue
                    path = target_path(name)
                    if not path.exists():
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(zf.read(member))
                        new_files += 1
        except requests.RequestException as exc:
            print(f"  [ERREUR] {zname}: {exc}", file=sys.stderr)
            errors += 1
            continue
        except zipfile.BadZipFile:
            # Archive corrompue côté FranceAgriMer : l'étape 3 récupère ses CSV un par un
            print(f"  [ignoré] {zname}: archive illisible")
        done.add(zname)
    ZIPS_DONE.parent.mkdir(parents=True, exist_ok=True)
    ZIPS_DONE.write_text("\n".join(sorted(done)) + "\n", encoding="utf-8")

    # 3. CSV listés mais toujours absents : téléchargement unitaire
    for rubrique, names in listed.items():
        missing = [n for n in names if not target_path(n).exists()]
        if missing:
            print(f"{rubrique}: {len(missing)} fichier(s) à télécharger un par un")
        for name in missing:
            try:
                content = download(session, rubrique, name)
            except requests.RequestException as exc:
                print(f"  [ERREUR] {name}: {exc}", file=sys.stderr)
                errors += 1
                continue
            if content is None:
                print(f"  [ignoré] {name}: pas de CSV disponible")
                continue
            path = target_path(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            new_files += 1
            time.sleep(0.2)  # rester courtois avec le serveur

    print(f"{new_files} nouveau(x) fichier(s), {errors} erreur(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
