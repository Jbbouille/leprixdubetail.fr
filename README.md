# Le Prix du Bétail — données

Cotations hebdomadaires des viandes publiées par FranceAgriMer (RNM) sur
[Visionet](https://visionet.franceagrimer.fr), récupérées et remises en forme automatiquement.

## Fonctionnement

L'action GitHub [`donnees-franceagrimer.yml`](.github/workflows/donnees-franceagrimer.yml)
tourne chaque samedi matin (et à la demande, via *Run workflow*) :

1. `scripts/fetch.py` liste les fichiers publiés dans les 11 rubriques « cotations en format csv »
   et télécharge ceux qui manquent dans `data/raw/` (via les ZIP hebdomadaires, puis fichier par fichier).
2. `scripts/transform.py` relit tous les fichiers bruts et régénère `data/processed/`.
3. S'il y a du nouveau, le résultat est commité.

En local :

```bash
pip install -r requirements.txt
python scripts/fetch.py
python scripts/transform.py
```

## Site web

Le site statique est dans `site/` (HTML, CSS et JavaScript, sans étape de build). Il lit
`data/indicateurs.json` et `data/details.json`, et propose aussi les CSV en téléchargement.

L'action [`site.yml`](.github/workflows/site.yml) le publie sur GitHub Pages à chaque modification
du site et après chaque mise à jour des données, en copiant `data/processed/` dans `site/data/`.

Le graphique de la page Évolution est dessiné en SVG avec quelques modules de
[D3](https://d3js.org) (échelles, courbes, axes, sélection), regroupés dans `site/d3.min.js`
(≈ 15 Ko compressés). Ce fichier est commité ; pour le reconstruire, par exemple après une mise à jour de D3 :

```bash
bun install
bun run build:d3
```

La liste des fonctions D3 exposées est dans [`build/d3.js`](build/d3.js).

Pour le prévisualiser en local :

```bash
mkdir -p site/data && cp data/processed/*.json data/processed/*.csv site/data/
python -m http.server 8765 --directory site
```

## Données produites (`data/processed/`)

Tous les fichiers sont en UTF-8, séparateur virgule, au format long : une ligne = une période
(`annee`, `semaine` ou `mois`, `date_debut`, `date_fin`) + des dimensions + `prix`, `variation`, `unite`.

| Fichier | Contenu |
|---|---|
| `indicateurs.csv` / `indicateurs.json` | Un prix de référence par espèce et par période (pour le site) |
| `details.json` | Tableaux croisés de la dernière semaine, prêts à afficher (pour le site) |
| `veaux_boucherie.csv` | Veaux de boucherie par mode d'élevage, région, couleur, conformation |
| `veaux_boucherie_pmp.csv` | Prix moyens pondérés des veaux de boucherie |
| `veaux_14j.csv` | Veaux de 14 jours à 4 semaines : moyennes nationales et prix moyen pondéré |
| `veaux_14j_marches.csv` | Veaux de 14 jours par marché, type racial, sexe, conformation ou poids |
| `veaux_14j_marches_effectifs.csv` | Effectifs et tendances des marchés de petits veaux |
| `gros_bovins_abattoir.csv` | Gros bovins entrée abattoir (standard, SIQO, bio) par catégorie et classe |
| `gros_bovins_abattoir_pmp.csv` | Prix moyens pondérés des gros bovins |
| `gros_bovins_abattoir_regions.csv` | Gros bovins standard par région |
| `gros_bovins_grille_ue.csv` | Grille communautaire (catégorie × conformation × état d'engraissement) |
| `gros_bovins_maigres.csv` / `_tendances.csv` | Bovins maigres par marché, race, sexe, âge, poids |
| `ovins.csv` / `ovins_pmp.csv` | Agneaux et brebis par zone et poids ; prix moyens pondérés |
| `porcs.csv` | Porc charcutier par région et classe (E, S) + référence nationale |
| `caprins.csv` | Chevreau vif (cotation saisonnière, de novembre à avril environ) |

Les rubriques **équidés** et **gros bovins vifs** sont téléchargées mais ne contiennent aucun prix
(modèles vides, publication arrêtée en février 2026).

Source : FranceAgriMer — RNM. Les semaines manquantes correspondent à des semaines sans publication
(par exemple les moyennes nationales des petits veaux, suspendues pendant l'épizootie de FCO à l'automne 2024).
