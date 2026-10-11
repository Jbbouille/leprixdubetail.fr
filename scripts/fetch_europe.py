"""Collecte les prix européens de la viande (portail agridata de la Commission européenne).

Source : https://agridata.ec.europa.eu — données réutilisables sous licence CC BY 4.0.

Contrairement aux fichiers FranceAgriMer, l'API est stable et interrogeable par année :
inutile de conserver les réponses brutes. Le script écrit directement les données
normalisées dans data/processed/europe.csv (une ligne = un pays, une catégorie, une
semaine) en fusionnant avec l'existant, puis un europe.json compact pour le site.

Les prix sont convertis en euros par kilo, pour être comparables aux cotations françaises.

    python scripts/fetch_europe.py
"""

from __future__ import annotations

import csv
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "processed"
CSV_DIR = OUT_DIR / "europe"   # un fichier par année : seul celui en cours change chaque semaine
JSON = OUT_DIR / "europe.json"

API = "https://api.tech.ec.europa.eu/agrifood/api"
# L'API renvoie tout son historique (jusqu'à 1991 pour certains secteurs) : on garde tout
# dans les CSV, mais le fichier du site se limite aux dernières années.
ANNEES_SITE = 6
# Historique visé pour les secteurs dont l'API respecte le filtre d'années (bovins)
ANNEE_MIN = 2015

# Pays suivis : la France, ses principaux voisins producteurs, et la moyenne UE
PAYS = ["EU", "FR", "DE", "ES", "IT", "IE", "NL", "PL", "BE"]

# Secteurs de l'API -> libellé du site
SECTEURS = {
    "beef": "Gros bovins",
    "pigmeat": "Porc",
    "sheepAndGoat": "Ovins",
    "liveAnimal": "Animaux vifs",
}

HEADERS = {"Accept": "application/json",
           "User-Agent": "leprixdubetail.fr (comparaison des cotations européennes)"}

CHAMPS = ["secteur", "pays", "categorie", "code", "conformation", "etat_engraissement",
          "annee", "semaine", "date_debut", "date_fin", "prix", "unite"]

# Séries retenues pour le site (le CSV, lui, garde tout) : une cotation représentative
# par catégorie, pour rester lisible et léger
SERIES_SITE = {
    ("beef", "ACZURO"): "Gros bovins mâles (prix indicatif)",
    ("beef", "AR3"): "Jeunes bovins R3",
    ("beef", "DO3"): "Vaches O3",
    ("beef", "DR3"): "Vaches R3",
    ("beef", "ER3"): "Génisses R3",
    ("beef", "CALVES-LT8MONTHS"): "Veaux abattus de moins de 8 mois",
    ("pigmeat", "E"): "Porc classe E",
    ("pigmeat", "Piglet"): "Porcelets",
    ("sheepAndGoat", "Heavy Lamb"): "Agneau lourd",
    ("liveAnimal", "Male Calves Dairy Type"): "Veaux mâles laitiers",
    ("liveAnimal", "Male Calves Beef Type"): "Veaux mâles viande",
    ("liveAnimal", "Young Store Cattle"): "Jeunes bovins maigres",
    ("liveAnimal", "Yearling Male Store Cattle"): "Broutards mâles",
    ("liveAnimal", "Yearling Female Store Cattle"): "Broutardes",
}

# Codes de la grille communautaire : catégorie + conformation + état d'engraissement
# (par exemple DR3 = vache, conformation R, état 3)
CODE_EUROP = re.compile(r"^([A-Z])([SEUROP])([1-5])$")


def nombre(prix: str) -> float | None:
    """'€559.00' ou '1 234,50' -> 559.0"""
    texte = re.sub(r"[^\d,.\-]", "", str(prix)).replace(",", ".")
    try:
        return float(texte)
    except ValueError:
        return None


def normalise(unite: str, prix: float) -> tuple[float, str]:
    """Ramène tout en euros par kilo (ou par tête pour les porcelets)."""
    u = (unite or "").lower()
    if "head" in u or u.strip() == "p":   # « €/head » (veaux vifs), « P » (porcelets)
        return prix, "EUR/tête"
    if "100" in u:
        return prix / 100, "EUR/kg"
    return prix, "EUR/kg"


def categorie(ligne: dict) -> str:
    return str(ligne.get("category") or ligne.get("product") or ligne.get("pigClass") or "")


def code(ligne: dict) -> str:
    """Code de la cotation : grille EUROP pour les bovins, classe ou produit sinon."""
    return str(ligne.get("productCode") or ligne.get("pigClass") or categorie(ligne) or "")


def cle(r: dict) -> tuple:
    return (r["secteur"], r["pays"], r["code"], r["annee"], r["semaine"])


def lire_csv() -> dict[tuple, dict]:
    lignes: dict[tuple, dict] = {}
    for fichier in sorted(CSV_DIR.glob("prix-*.csv")):
        with fichier.open(encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                # la grille est redéduite du code à chaque lecture : les années déjà
                # collectées profitent ainsi des corrections de décodage
                grille = CODE_EUROP.match(r["code"])
                r["conformation"] = grille.group(2) if grille else ""
                r["etat_engraissement"] = grille.group(3) if grille else ""
                lignes[cle(r)] = r
    return lignes


def collecter(session: requests.Session, secteur: str, annees: list[int]) -> list[dict]:
    resp = session.get(
        f"{API}/{secteur}/prices",
        params={"memberStateCodes": ",".join(PAYS), "years": ",".join(map(str, annees))},
        timeout=180,
    )
    resp.raise_for_status()
    lignes = []
    for r in resp.json():
        prix = nombre(r.get("price"))
        debut, fin = r.get("beginDate"), r.get("endDate")
        if prix is None or not debut or not fin:
            continue
        d = datetime.strptime(debut, "%d/%m/%Y").date()
        f = datetime.strptime(fin, "%d/%m/%Y").date()
        semaine = int(r.get("weekNumber") or 0)
        valeur, unite = normalise(r.get("unit", ""), prix)
        c = code(r)
        grille = CODE_EUROP.match(c)
        lignes.append({
            "secteur": secteur,
            "pays": r.get("memberStateCode", ""),
            "categorie": categorie(r),
            "code": c,
            "conformation": grille.group(2) if grille else "",
            "etat_engraissement": grille.group(3) if grille else "",
            # l'année suit le numéro de semaine, comme pour les cotations françaises
            "annee": str(d.year if semaine >= 50 else f.year),
            "semaine": str(semaine),
            "date_debut": d.isoformat(),
            "date_fin": f.isoformat(),
            "prix": f"{valeur:.4f}".rstrip("0").rstrip("."),
            "unite": unite,
        })
    return lignes


def ecrire_csv(lignes: dict[tuple, dict]) -> int:
    CSV_DIR.mkdir(parents=True, exist_ok=True)
    par_annee: dict[str, list[dict]] = {}
    for r in lignes.values():
        par_annee.setdefault(r["annee"], []).append(r)
    for annee, rows in par_annee.items():
        rows.sort(key=lambda r: (r["secteur"], r["pays"], r["code"], r["date_debut"]))
        with (CSV_DIR / f"prix-{annee}.csv").open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=CHAMPS, lineterminator="\n")
            w.writeheader()
            w.writerows(rows)
    return len(par_annee)


def ecrire_json(lignes: dict[tuple, dict]) -> dict:
    """Séries alignées sur une liste de semaines commune, comme veaux_races.json."""
    limite = date.today().year - ANNEES_SITE + 1
    rows = [r for r in lignes.values() if (r["secteur"], r["code"]) in SERIES_SITE
            and int(r["semaine"]) > 0 and int(r["annee"]) >= limite]
    # Une semaine = une (année, numéro) ; les dates varient d'un pays à l'autre
    periodes: dict[tuple, dict] = {}
    for r in rows:
        p = periodes.setdefault((int(r["annee"]), int(r["semaine"])),
                                {"annee": int(r["annee"]), "semaine": int(r["semaine"]),
                                 "debut": r["date_debut"], "fin": r["date_fin"]})
        p["debut"] = min(p["debut"], r["date_debut"])
        p["fin"] = max(p["fin"], r["date_fin"])
    semaines = sorted(periodes.values(), key=lambda p: (p["annee"], p["semaine"]))
    index = {(p["annee"], p["semaine"]): i for i, p in enumerate(semaines)}

    series: dict[tuple, dict] = {}
    for r in rows:
        k = (r["secteur"], r["code"], r["pays"])
        serie = series.setdefault(k, {
            "secteur": r["secteur"], "code": r["code"],
            "libelle": SERIES_SITE[(r["secteur"], r["code"])], "pays": r["pays"],
            "unite": r["unite"], "prix": [None] * len(semaines),
        })
        serie["prix"][index[(int(r["annee"]), int(r["semaine"]))]] = float(r["prix"])

    data = {
        "source": "Commission européenne — portail agridata (CC BY 4.0)",
        "secteurs": SECTEURS,
        "semaines": semaines,
        "series": sorted(series.values(), key=lambda s: (s["secteur"], s["code"], s["pays"])),
    }
    JSON.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return data


def main() -> int:
    session = requests.Session()
    session.headers.update(HEADERS)
    lignes = lire_csv()
    connues = len(lignes)

    # On ne réinterroge que l'année en cours et la précédente ; l'historique plus ancien
    # est déjà dans le CSV (et ne change plus)
    annee = date.today().year

    # Années déjà collectées, par secteur : on complète l'historique manquant une fois
    # pour toutes, puis on ne redemande que l'année en cours et la précédente.
    presentes: dict[str, set[int]] = {}
    for r in lignes.values():
        presentes.setdefault(r["secteur"], set()).add(int(r["annee"]))

    erreurs = 0
    for secteur in SECTEURS:
        manquantes = [a for a in range(ANNEE_MIN, annee + 1) if a not in presentes.get(secteur, set())]
        annees = sorted({*manquantes, annee - 1, annee})
        try:
            nouvelles = collecter(session, secteur, annees)
        except (requests.RequestException, ValueError) as exc:
            print(f"[ERREUR] {secteur}: {exc}", file=sys.stderr)
            erreurs += 1
            continue
        for r in nouvelles:
            lignes[cle(r)] = r
        print(f"{secteur}: {len(nouvelles)} cotations reçues")

    if erreurs == len(SECTEURS):
        print("Aucun secteur n'a pu être collecté", file=sys.stderr)
        return 1

    fichiers = ecrire_csv(lignes)
    data = ecrire_json(lignes)
    print(f"data/processed/europe/ : {len(lignes)} lignes ({len(lignes) - connues} nouvelles), "
          f"{fichiers} fichiers annuels")
    print(f"europe.json: {len(data['series'])} séries, {len(data['semaines'])} semaines")
    return 0


if __name__ == "__main__":
    sys.exit(main())
