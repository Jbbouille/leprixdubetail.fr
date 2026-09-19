"""Transforme les CSV bruts FranceAgriMer (data/raw/) en données propres (data/processed/).

Les fichiers d'origine sont des « tableaux mis en page » (plusieurs blocs, en-têtes
sur deux lignes, cotation et variation sur des lignes alternées...). Chaque type de
fichier a donc son propre parseur, qui produit des lignes « longues » :
une ligne = une période + des dimensions + un prix (+ sa variation).

Sorties (UTF-8, séparateur virgule) :
  - un CSV détaillé par jeu de données ;
  - indicateurs.csv / indicateurs.json : un prix de référence par espèce et par période,
    pour l'affichage sur le site.
"""

from __future__ import annotations

import csv
import io
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Callable, Iterable, Iterator

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT_DIR = ROOT / "data" / "processed"

Rows = list[list[str]]

# --------------------------------------------------------------------------- #
# Outils communs
# --------------------------------------------------------------------------- #

MOIS = {
    "janvier": 1, "fevrier": 2, "février": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6,
    "juillet": 7, "aout": 8, "août": 8, "septembre": 9, "octobre": 10, "novembre": 11,
    "decembre": 12, "décembre": 12,
}


@dataclass(frozen=True)
class Periode:
    annee: int
    semaine: int | None
    mois: int | None
    date_debut: date
    date_fin: date

    def as_dict(self) -> dict:
        return {
            "annee": self.annee,
            "semaine": self.semaine if self.semaine is not None else "",
            "mois": self.mois if self.mois is not None else "",
            "date_debut": self.date_debut.isoformat(),
            "date_fin": self.date_fin.isoformat(),
        }


def read_rows(path: Path) -> Rows:
    text = path.read_bytes().decode("cp1252", errors="replace")
    text = chr(10).join(text.splitlines())  # fins de ligne mixtes CRLF / CR / LF
    rows = []
    for row in csv.reader(io.StringIO(text), delimiter=";"):
        rows.append([re.sub(r"\s+", " ", cell).strip() for cell in row])
    return rows


def cell(row: list[str], i: int) -> str:
    return row[i] if i < len(row) else ""


def num(value: str) -> float | None:
    value = value.replace("\xa0", "").replace(" ", "")
    if not value:
        return None
    try:
        return float(value.replace(",", "."))
    except ValueError:
        return None


def parse_periode(rows: Rows) -> Periode | None:
    for row in rows[:8]:
        line = " ".join(row)
        m = re.search(r"SEMAINE\D*?(\d+) DU (\d\d/\d\d/\d{4}) AU (\d\d/\d\d/\d{4})", line)
        if m:
            semaine = int(m.group(1))
            debut = datetime.strptime(m.group(2), "%d/%m/%Y").date()
            fin = datetime.strptime(m.group(3), "%d/%m/%Y").date()
            # Les semaines à cheval sur deux années appartiennent à l'année de leur numéro
            annee = debut.year if semaine >= 50 else fin.year
            return Periode(annee, semaine, None, debut, fin)
        m = re.search(r"MOIS DE (\S+) (\d{4})", line, re.IGNORECASE)
        if m and m.group(1).lower() in MOIS:
            annee, mois = int(m.group(2)), MOIS[m.group(1).lower()]
            debut = date(annee, mois, 1)
            fin = date(annee + (mois == 12), mois % 12 + 1, 1)
            fin = date.fromordinal(fin.toordinal() - 1)
            return Periode(annee, None, mois, debut, fin)
    return None


def find_row(rows: Rows, predicate: Callable[[list[str]], bool], start: int = 0) -> int:
    for i in range(start, len(rows)):
        if predicate(rows[i]):
            return i
    return -1


def ffill(values: list[str], length: int = 0) -> list[str]:
    """Propage les en-têtes fusionnés vers la droite, jusqu'à `length` colonnes."""
    out, last = [], ""
    for v in values + [""] * (length - len(values)):
        last = v or last
        out.append(last)
    return out


def price(prix: float | None, variation: float | None = None, **dims) -> dict | None:
    # Une cellule vide ou à 0 signifie « pas de cotation cette semaine »
    if not prix:
        return None
    return {**dims, "prix": prix, "variation": "" if variation is None else variation}


# --------------------------------------------------------------------------- #
# Parseurs (chacun reçoit les lignes du fichier et renvoie des dicts de prix)
# --------------------------------------------------------------------------- #


def pmp_blocks(rows: Rows) -> Iterator[dict]:
    """Blocs « libellés / Cot;Var / valeurs » (prix moyens pondérés)."""
    for i in range(len(rows) - 2):
        labels, head, values = rows[i], rows[i + 1], rows[i + 2]
        if cell(head, 0) not in ("Cot", "Cot.") or num(cell(values, 0)) is None:
            continue
        for j, label in enumerate(labels):
            if label:
                p = price(num(cell(values, j)), num(cell(values, j + 1)), categorie=label)
                if p:
                    yield p


def parse_veaux_boucherie(rows: Rows, mode: str) -> Iterator[dict]:
    i = find_row(rows, lambda r: cell(r, 0) == "REGIONS")
    if i < 0:
        return
    confs = rows[i + 1][2:]
    couleurs = ffill(rows[i][2:], len(confs))
    j = i + 2
    while j + 1 < len(rows) and cell(rows[j], 0):
        cot, var = rows[j], rows[j + 1]
        if cell(cot, 1) or cell(var, 1) != "Var.":
            j += 1
            continue
        for k, (couleur, conf) in enumerate(zip(couleurs, confs)):
            p = price(num(cell(cot, k + 2)), num(cell(var, k + 2)), mode=mode,
                      region=cot[0], couleur=couleur, conformation=conf,
                      unite="EUR/kg carcasse")
            if p:
                yield p
        j += 2


def parse_veaux_pmp(rows: Rows) -> Iterator[dict]:
    for p in pmp_blocks(rows):
        label = p["categorie"].upper()
        if "100" in label:
            p["unite"] = "EUR/100 kg vif" if "VIF" in label else "EUR/100 kg net"
        else:
            p["unite"] = "EUR/kg carcasse"
        yield p


def parse_veaux14j_synthese(rows: Rows) -> tuple[list[dict], list[dict]]:
    prix, marches = [], []

    i = find_row(rows, lambda r: cell(r, 0) == "MARCHES")
    if i >= 0:
        for r in rows[i + 1:]:
            if not cell(r, 0):
                break
            marches.append({
                "marche": r[0],
                "date_marche": cell(r, 1)[:10],
                "effectif": num(cell(r, 2)) if num(cell(r, 2)) is not None else "",
                "variation_effectif": num(cell(r, 3)) if num(cell(r, 3)) is not None else "",
                "tendance": cell(r, 4),
            })

    i = find_row(rows, lambda r: cell(r, 0).startswith("SUPERIEUR/ELEVAGE"))
    if i >= 0:
        for r in rows[i + 2:i + 4]:
            if cell(r, 0) in ("MALES", "FEMELLES"):
                p = price(num(cell(r, 1)), num(cell(r, 2)), categorie="Élevage supérieur",
                          sexe="Mâle" if r[0] == "MALES" else "Femelle", poids="")
                if p:
                    prix.append(p)

    i = find_row(rows, lambda r: cell(r, 0).startswith("RACES LAITIERES MALES"))
    if i >= 0:
        groups, poids, values = rows[i], rows[i + 1], rows[i + 2]
        for k in range(0, len(poids), 2):
            if not poids[k] or poids[k].upper().startswith("VAR"):
                continue
            group = next((groups[g] for g in range(k, -1, -1) if cell(groups, g)), "")
            p = price(num(cell(values, k)), num(cell(values, k + 1)),
                      categorie="Engraissement laitier (assez bonne conformation)",
                      sexe="Femelle" if "FEMELLE" in group else "Mâle",
                      poids=re.sub(r"\s*kg$", "", poids[k]) + " kg")
            if p:
                prix.append(p)

    i = find_row(rows, lambda r: cell(r, 0).startswith("PRIX MOYEN PONDERE DES VEAUX MALES"))
    if i >= 0 and i + 2 < len(rows):
        r = rows[i + 2]
        p = price(num(cell(r, 1)), num(cell(r, 2)),
                  categorie="Prix moyen pondéré (0,3 élevage + 0,7 engraissement)",
                  sexe="Mâle", poids="")
        if p:
            prix.append(p)

    for p in prix:
        p["unite"] = "EUR/tête"
    return prix, marches


def parse_veaux14j_marches(rows: Rows) -> Iterator[dict]:
    i = find_row(rows, lambda r: cell(r, 1) == "RACES" and cell(r, 2) == "SEXE")
    if i < 0:
        return
    header = rows[i]
    cols = {k: h for k, h in enumerate(header) if k >= 4 and h and h.lower() != "variation"}
    k_var = next((k for k, h in enumerate(header) if h.lower() == "variation"), None)
    for r in rows[i + 1:]:
        if cell(r, 0) != "VEAUX":
            continue
        type_racial = r[-1] if r and r[-1] else next((c for c in reversed(r) if c), "")
        # Colonne CONFORMATION : lettre EUROP pour les races à viande, tranche de poids sinon
        classe = cell(r, 3)
        is_poids = "KG" in classe.upper()
        for k, marche in cols.items():
            national = marche.upper().startswith("MOYENNE")
            p = price(num(cell(r, k)), num(cell(r, k_var)) if national and k_var else None,
                      type_racial=type_racial.title(),
                      sexe={"MALE": "Mâle", "FEMELLE": "Femelle"}.get(cell(r, 2), cell(r, 2)),
                      conformation="" if is_poids else classe,
                      poids=classe.lower() if is_poids else "",
                      marche="MOYENNE NATIONALE" if national else marche, unite="EUR/tête")
            if p:
                yield p


def parse_gros_bovins_national(rows: Rows, qualite: str) -> tuple[list[dict], list[dict]]:
    i = find_row(rows, lambda r: cell(r, 0) in ("E", "U", "U+") and cell(r, 1) == "Cot")
    if i < 2:
        return [], []
    types = rows[i - 1][2:]
    cats = ffill(rows[i - 2][2:], len(types))
    out = []
    j = i
    while j + 1 < len(rows) and cell(rows[j], 1) == "Cot":
        cot, var = rows[j], rows[j + 1]
        for k, (cat, typ) in enumerate(zip(cats, types)):
            if not typ:
                continue
            p = price(num(cell(cot, k + 2)), num(cell(var, k + 2)), qualite=qualite,
                      categorie=cat, type=typ, classe=cot[0], unite="EUR/kg net")
            if p:
                out.append(p)
        j += 2
    pmp = []
    k = find_row(rows, lambda r: cell(r, 0) == "PMP" and cell(r, 1).startswith("Var"))
    if k >= 0 and k + 1 < len(rows):
        p = price(num(cell(rows[k + 1], 0)), num(cell(rows[k + 1], 1)))
        if p:
            pmp.append(p)
    return out, pmp


def parse_gros_bovins_regional(rows: Rows) -> Iterator[dict]:
    i = find_row(rows, lambda r: cell(r, 2) == "Cot" and cell(r, 0))
    if i < 2:
        return
    types = rows[i - 1][3:]
    cats = ffill(rows[i - 2][3:], len(types))
    j = i
    while j + 1 < len(rows) and cell(rows[j], 2) == "Cot":
        cot, var = rows[j], rows[j + 1]
        for k, (cat, typ) in enumerate(zip(cats, types)):
            if not typ:
                continue
            p = price(num(cell(cot, k + 3)), num(cell(var, k + 3)), region=cot[0],
                      categorie=cat, type=typ, classe=cot[1], unite="EUR/kg net")
            if p:
                yield p
        j += 2


def parse_gros_bovins_ue(rows: Rows, qualite: str) -> Iterator[dict]:
    i = find_row(rows, lambda r: "ETATS D'ENGRAISSEMENT" in " ".join(r))
    if i < 0:
        return
    etats = rows[i + 1]
    for r in rows[i + 2:]:
        if not (cell(r, 0).isdigit() and cell(r, 2)):
            continue
        for k in range(4, len(etats)):
            if etats[k]:
                p = price(num(cell(r, k)), qualite=qualite, categorie=r[2].capitalize(),
                          conformation=r[3], etat_engraissement=etats[k], unite="EUR/kg carcasse")
                if p:
                    yield p


def parse_gros_bovins_maigres(rows: Rows) -> tuple[list[dict], list[dict]]:
    i = find_row(rows, lambda r: cell(r, 0) == "RACES")
    if i < 0:
        return [], []
    sexes = rows[i + 1][3:]
    races = ffill(rows[i][3:], len(sexes))
    ages = rows[i + 2][3:]
    by_marche: dict[str, dict] = {}
    for r in rows[i + 3:]:
        if not cell(r, 0) or len(r) < 4:
            continue
        m = by_marche.setdefault(r[0], {"tendance": cell(r, 1), "rows": []})
        m["rows"].append(r)
    prix, tendances = [], []
    for marche, m in by_marche.items():
        tendances.append({"marche": marche, "tendance": m["tendance"]})
        poids = next((r[3:] for r in m["rows"] if r[2].lower() == "tonnage"), [])
        rs = m["rows"]
        for j, r in enumerate(rs):
            classe = r[2]
            if classe.lower() in ("var.", "tonnage"):
                continue
            var = rs[j + 1] if j + 1 < len(rs) and rs[j + 1][2].lower() == "var." else []
            for k in range(len(races)):
                sexe = cell(sexes, k)
                p = price(num(cell(r, k + 3)), num(cell(var, k + 3)), marche=marche,
                          race=races[k].title(), sexe={"M": "Mâle", "F": "Femelle"}.get(sexe, sexe),
                          age_mois=cell(ages, k).lstrip("*"), classe=classe,
                          poids_kg=num(cell(poids, k)) or "", unite="EUR/kg vif")
                if p:
                    prix.append(p)
    return prix, tendances


def parse_ovins(rows: Rows) -> Iterator[dict]:
    for i, r in enumerate(rows):
        if cell(r, 0) not in ("AGNEAUX", "BREBIS"):
            continue
        espece = r[0].capitalize()
        head, poids = rows[i + 1], rows[i + 2]
        zones = ffill(head[2:], len(poids) - 2)
        j = i + 3
        while j + 1 < len(rows) and cell(rows[j], 1) and cell(rows[j], 0) not in ("AGNEAUX", "BREBIS"):
            cot, var = rows[j], rows[j + 1]
            if (cot[0], cot[1]) != (var[0], var[1]):
                j += 1
                continue
            for k, zone in enumerate(zones):
                p = price(num(cell(cot, k + 2)), num(cell(var, k + 2)), espece=espece,
                          etat_engraissement=cot[0].capitalize(), conformation=cot[1],
                          zone=zone.title(), poids=cell(poids, k + 2).lower(),
                          unite="EUR/kg carcasse")
                if p:
                    yield p
            j += 2


def parse_ovins_pmp(rows: Rows) -> Iterator[dict]:
    i = find_row(rows, lambda r: cell(r, 0).startswith("Cot"))
    if i < 1:
        return
    labels, cot = rows[i - 1], rows[i]
    var = rows[i + 1] if i + 1 < len(rows) else []
    for k, label in enumerate(labels):
        if label:
            value = num(cell(cot, k))
            # 0 = pas de cotation cette semaine (brebis notamment)
            if value:
                yield {"categorie": label, "prix": value,
                       "variation": "" if num(cell(var, k)) is None else num(cell(var, k)),
                       "unite": "EUR/kg carcasse"}


def parse_porcs(rows: Rows) -> Iterator[dict]:
    for r in rows:
        if cell(r, 0).isdigit() and cell(r, 5):
            region, siege, off = r[1], r[3], 6
        elif cell(r, 4) == "REFERENCE NATIONALE":
            region, siege, off = "RÉFÉRENCE NATIONALE", "", 6
        else:
            continue
        for classe, k in (("E", off), ("S", off + 2)):
            p = price(num(cell(r, k)), num(cell(r, k + 1)), region=region, siege=siege.title(),
                      classe=classe, unite="EUR/kg carcasse")
            if p:
                yield p


def parse_caprins(rows: Rows) -> Iterator[dict]:
    i = find_row(rows, lambda r: cell(r, 0) == "POIDS")
    if i < 0:
        return
    for r in rows[i + 1:]:
        if not cell(r, 0):
            break
        p = price(num(cell(r, 1)), num(cell(r, 2)), poids=r[0],
                  variation_pct="" if num(cell(r, 3)) is None else num(cell(r, 3)),
                  commentaire=cell(r, 4), unite="EUR/kg vif")
        if p:
            yield p


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #

class Collector:
    """Accumule les lignes par jeu de données, dédoublonnées par période + dimensions."""

    def __init__(self) -> None:
        self.data: dict[str, dict[tuple, dict]] = defaultdict(dict)

    def add(self, dataset: str, periode: Periode, rows: Iterable[dict], source: str) -> None:
        for row in rows:
            full = {**periode.as_dict(), **row, "source": source}
            key = tuple((k, v) for k, v in full.items() if k not in ("prix", "variation", "source")
                        and not k.startswith("variation") and k not in ("tendance", "effectif", "commentaire"))
            self.data[dataset][key] = full  # le fichier le plus récent l'emporte

    def rows(self, dataset: str) -> list[dict]:
        return sorted(self.data[dataset].values(), key=lambda r: (r["date_debut"],))


def series_of(name: str) -> str:
    return re.sub(r"-A\d+-[SM]\d+.*$", "", name, flags=re.IGNORECASE).lower()


def process(col: Collector) -> None:
    # Tri sur le texte du chemin (sensible à la casse) : même ordre sous Windows et Linux,
    # donc des fichiers de sortie identiques en local et dans GitHub Actions
    for path in sorted(RAW_DIR.rglob("*.csv"), key=lambda p: p.relative_to(RAW_DIR).as_posix()):
        rows = read_rows(path)
        periode = parse_periode(rows)
        if periode is None:
            print(f"[ignoré] période introuvable : {path.name}", file=sys.stderr)
            continue
        s, src = series_of(path.name), path.name

        if s == "cot-vro-veaux_bouch_pis":
            col.add("veaux_boucherie", periode, parse_veaux_boucherie(rows, "Élevés au pis"), src)
            col.add("veaux_boucherie_pmp", periode,
                    ({**p, "categorie": p["categorie"] + " (ÉLEVÉS AU PIS)"} for p in parse_veaux_pmp(rows)), src)
        elif s == "cot-vro-veaux_bouch_non_pis":
            col.add("veaux_boucherie", periode, parse_veaux_boucherie(rows, "Non élevés au pis"), src)
            col.add("veaux_boucherie_pmp", periode,
                    ({**p, "categorie": p["categorie"] + " (NON ÉLEVÉS AU PIS)"} for p in parse_veaux_pmp(rows)), src)
        elif s == "cot-vro-veaux_bouch_synthese":
            col.add("veaux_boucherie", periode, parse_veaux_boucherie(rows, "Ensemble"), src)
            col.add("veaux_boucherie_pmp", periode, parse_veaux_pmp(rows), src)
        elif s == "cot-vro-veaux_pmp":
            col.add("veaux_boucherie_pmp", periode, parse_veaux_pmp(rows), src)
        elif s == "cot-vro-veaux14j_synthese":
            prix, marches = parse_veaux14j_synthese(rows)
            col.add("veaux_14j", periode, prix, src)
            col.add("veaux_14j_marches_effectifs", periode, marches, src)
        elif s in ("cot-vro-veaux14j_9_marches", "cot-vro-veaux14j_marches"):
            col.add("veaux_14j_marches", periode, parse_veaux14j_marches(rows), src)
        elif s in ("cot-vro-gbst_nationale", "cot-vro-gbsi_nationale", "cot-vro-gbbi_nationale"):
            qualite = {"gbst": "Standard", "gbsi": "SIQO (hors bio)", "gbbi": "Bio"}[s[8:12]]
            detail, pmp = parse_gros_bovins_national(rows, qualite)
            col.add("gros_bovins_abattoir", periode, detail, src)
            col.add("gros_bovins_abattoir_pmp", periode, ({**p, "qualite": qualite, "unite": "EUR/kg net"} for p in pmp), src)
        elif s == "cot-vro-gbst_regionale":
            col.add("gros_bovins_abattoir_regions", periode, parse_gros_bovins_regional(rows), src)
        elif s in ("cot-vro-gbea_communautaire", "cot-vro-gbbi_prix_ue"):
            qualite = "Bio" if "gbbi" in s else "Standard"
            col.add("gros_bovins_grille_ue", periode, parse_gros_bovins_ue(rows, qualite), src)
        elif s == "cot-vro-gb_maigres":
            prix, tendances = parse_gros_bovins_maigres(rows)
            col.add("gros_bovins_maigres", periode, prix, src)
            col.add("gros_bovins_maigres_tendances", periode, tendances, src)
        elif s == "cot-vro-ovins_synthese":
            col.add("ovins", periode, parse_ovins(rows), src)
        elif s == "cot-vro-ovins_pmp":
            col.add("ovins_pmp", periode, parse_ovins_pmp(rows), src)
        elif s == "cot-vbl-porc":
            col.add("porcs", periode, parse_porcs(rows), src)
        elif s == "cot-vro-caprins":
            col.add("caprins", periode, parse_caprins(rows), src)
        # équidés et gros bovins vifs : modèles publiés sans aucune valeur, rien à extraire


# Indicateurs de référence : (id, libellé, espèce, jeu de données, filtre, unité)
INDICATEURS = [
    ("veau_boucherie", "Veau de boucherie — prix moyen pondéré entrée abattoir", "Veau",
     "veaux_boucherie_pmp", lambda r: r["categorie"] == "ENTREE ABATTOIR", "€/kg carcasse"),
    ("veau_14j", "Veau de 14 jours à 4 semaines — prix moyen pondéré mâles", "Veau",
     "veaux_14j", lambda r: r["categorie"].startswith("Prix moyen pondéré"), "€/tête"),
    ("gros_bovins", "Gros bovins entrée abattoir — prix moyen pondéré", "Bœuf",
     "gros_bovins_abattoir_pmp", lambda r: r["qualite"] == "Standard", "€/kg net"),
    ("gros_bovins_siqo", "Gros bovins SIQO (Label rouge, AOP…) — prix moyen pondéré", "Bœuf",
     "gros_bovins_abattoir_pmp", lambda r: r["qualite"].startswith("SIQO"), "€/kg net"),
    ("gros_bovins_bio", "Gros bovins bio — prix moyen pondéré", "Bœuf",
     "gros_bovins_abattoir_pmp", lambda r: r["qualite"] == "Bio", "€/kg net"),
    ("agneau", "Agneau — prix moyen pondéré entrée abattoir", "Agneau",
     "ovins_pmp", lambda r: r["categorie"] == "P.M.P AGNEAUX", "€/kg carcasse"),
    ("porc", "Porc charcutier — référence nationale classe E", "Porc",
     "porcs", lambda r: r["region"] == "RÉFÉRENCE NATIONALE" and r["classe"] == "E", "€/kg carcasse"),
    ("chevreau", "Chevreau vif 8 à 11 kg — prix moyen", "Chevreau",
     "caprins", lambda r: True, "€/kg vif"),
]


def build_indicateurs(col: Collector) -> list[dict]:
    out = []
    for ind_id, libelle, espece, dataset, keep, unite in INDICATEURS:
        for r in col.rows(dataset):
            if keep(r):
                out.append({
                    "indicateur": ind_id, "libelle": libelle, "espece": espece,
                    "annee": r["annee"], "semaine": r["semaine"], "mois": r["mois"],
                    "date_debut": r["date_debut"], "date_fin": r["date_fin"],
                    "prix": r["prix"], "variation": r["variation"], "unite": unite,
                })
    return out


def _latest(rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    last = max(r["date_debut"] for r in rows)
    return [r for r in rows if r["date_debut"] == last]


def _ordered(values: list[str], order: list[str]) -> list[str]:
    rank = {v: i for i, v in enumerate(order)}
    return sorted(values, key=lambda v: (rank.get(v, len(order)), values.index(v)))


def pivot(tid: str, titre: str, espece: str, unite: str, rows: list[dict],
          row_of: Callable[[dict], str], col_of: Callable[[dict], str],
          row_order: list[str] | None = None, col_order: list[str] | None = None,
          note: str = "") -> dict | None:
    """Tableau croisé de la dernière période disponible, prêt à afficher."""
    rows = _latest(rows)
    if not rows:
        return None
    lignes: list[str] = []
    colonnes: list[str] = []
    cells: dict[tuple[str, str], dict] = {}
    for r in rows:
        rk, ck = row_of(r), col_of(r)
        lignes += [rk] if rk not in lignes else []
        colonnes += [ck] if ck not in colonnes else []
        cells[(rk, ck)] = {"prix": r["prix"], "variation": r["variation"] if r["variation"] != "" else None}
    lignes = _ordered(lignes, row_order or [])
    colonnes = _ordered(colonnes, col_order or [])
    return {
        "id": tid, "titre": titre, "espece": espece, "unite": unite, "note": note,
        "periode": {"annee": rows[0]["annee"], "semaine": rows[0]["semaine"] or None,
                    "mois": rows[0]["mois"] or None, "debut": rows[0]["date_debut"],
                    "fin": rows[0]["date_fin"]},
        "lignes": lignes, "colonnes": colonnes,
        "valeurs": [[cells.get((a, b)) for b in colonnes] for a in lignes],
    }


EUROP = ["E", "U", "R", "O", "P"]
CLASSES_GB = [f"{c}{s}" for c in "EUROP" for s in "+=-"] + EUROP
CATEGORIES_GB = ["Jeunes bovins 8 à 24 mois", "Jeunes bovins 12 à 24 mois", "Taureaux",
                 "Boeufs", "Génisses", "Vaches"]


def build_details(col: Collector) -> list[dict]:
    veaux_pmp_labels = {"ENTREE ABATTOIR": "Ensemble des veaux de boucherie",
                        "NON ELEVES AU PIS": "Veaux non élevés au pis",
                        "ELEVES AU PIS": "Veaux élevés au pis (sous la mère)"}
    gb_std = [r for r in col.rows("gros_bovins_abattoir") if r["qualite"] == "Standard"]
    tables = [
        pivot("veau_boucherie_pmp", "Veaux de boucherie — prix moyens pondérés", "Veau",
              "€/kg carcasse",
              [r for r in col.rows("veaux_boucherie_pmp") if r["categorie"] in veaux_pmp_labels],
              lambda r: veaux_pmp_labels[r["categorie"]], lambda r: "Prix",
              row_order=list(veaux_pmp_labels.values())),
        pivot("veau_boucherie", "Veaux de boucherie — cotation nationale", "Veau", "€/kg carcasse",
              [r for r in col.rows("veaux_boucherie")
               if r["mode"] == "Ensemble" and r["region"] == "COTATION NATIONALE"],
              lambda r: r["couleur"].capitalize().replace("tres", "très"), lambda r: r["conformation"],
              row_order=["Blanc", "Rose très clair", "Rose clair", "Rose", "Rouge"], col_order=EUROP,
              note="Lignes : couleur de la viande. Colonnes : conformation (E = excellente … P = médiocre)."),
        pivot("veau_14j", "Veaux de 14 jours à 4 semaines — moyennes nationales", "Veau", "€/tête",
              col.rows("veaux_14j"),
              lambda r: " · ".join(x for x in (r["categorie"], r["sexe"], r["poids"]) if x),
              lambda r: "Prix"),
        pivot("gros_bovins", "Gros bovins entrée abattoir — cotation nationale", "Bœuf", "€/kg net",
              gb_std, lambda r: r["classe"], lambda r: f"{r['categorie']} — {r['type']}",
              row_order=CLASSES_GB,
              col_order=[f"{c} — {t}" for c in CATEGORIES_GB
                         for t in dict.fromkeys(r["type"] for r in gb_std if r["categorie"] == c)],
              note="Lignes : classe de conformation EUROP (+, =, - affinent la classe)."),
        pivot("agneau", "Agneaux — moyenne des régions", "Agneau", "€/kg carcasse",
              [r for r in col.rows("ovins") if r["espece"] == "Agneaux" and r["zone"] == "Moyennes Regions"],
              lambda r: f"{r['etat_engraissement']} · {r['conformation']}", lambda r: r["poids"],
              col_order=["13 a 16 kg", "16 a 19 kg", "19 a 22 kg", "+ de 22 kg"],
              note="Lignes : état d'engraissement et conformation. Colonnes : poids de carcasse."),
        pivot("porc", "Porc charcutier — cotations régionales", "Porc", "€/kg carcasse",
              col.rows("porcs"),
              lambda r: r["siege"] or "Référence nationale", lambda r: f"Classe {r['classe']}",
              row_order=["Rennes", "Nantes", "Lille", "Lyon", "Toulouse", "Référence nationale"],
              note="Lignes : siège de la commission régionale. Classes E et S : taux de muscle "
                   "(S = carcasse plus maigre)."),
    ]
    return [t for t in tables if t]


def write_csv(path: Path, rows: list[dict]) -> None:
    fields: list[str] = []
    for r in rows:
        fields += [k for k in r if k not in fields]
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({k: fmt(v) for k, v in r.items()})


def write_json(path: Path, data: dict) -> None:
    # JSON compact (sans indentation ni espaces) : ces fichiers sont chargés par le site ;
    # pour lire les données, les CSV sont plus pratiques
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def fmt(v):
    if isinstance(v, float):
        return f"{v:.3f}".rstrip("0").rstrip(".") if v != int(v) else str(int(v))
    return v


def main() -> int:
    col = Collector()
    process(col)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for dataset in sorted(col.data):
        rows = col.rows(dataset)
        write_csv(OUT_DIR / f"{dataset}.csv", rows)
        print(f"{dataset}: {len(rows)} lignes")

    indicateurs = build_indicateurs(col)
    write_csv(OUT_DIR / "indicateurs.csv", indicateurs)

    series: dict[str, dict] = {}
    for r in indicateurs:
        s = series.setdefault(r["indicateur"], {
            "id": r["indicateur"], "libelle": r["libelle"], "espece": r["espece"],
            "unite": r["unite"], "periodicite": "mensuelle" if r["mois"] != "" else "hebdomadaire",
            "points": [],
        })
        s["points"].append({
            "annee": r["annee"], "semaine": r["semaine"] or None, "mois": r["mois"] or None,
            "debut": r["date_debut"], "fin": r["date_fin"], "prix": r["prix"],
            "variation": r["variation"] if r["variation"] != "" else None,
        })
    for s in series.values():
        s["dernier"] = s["points"][-1] if s["points"] else None
    write_json(OUT_DIR / "indicateurs.json",
               {"source": "FranceAgriMer — RNM / Visionet", "indicateurs": list(series.values())})
    print(f"indicateurs: {len(indicateurs)} points, {len(series)} séries")

    details = build_details(col)
    write_json(OUT_DIR / "details.json", {"tableaux": details})
    print(f"details: {len(details)} tableaux")
    return 0


if __name__ == "__main__":
    sys.exit(main())
