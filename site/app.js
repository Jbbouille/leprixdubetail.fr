"use strict";

// Présentation des indicateurs (l'ordre ici est l'ordre d'affichage)
const META = {
  veau_boucherie: { nom: "Veau de boucherie", sous: "Prix moyen, entrée abattoir" },
  veau_14j: { nom: "Petit veau (14 j à 4 sem.)", sous: "Prix moyen des mâles, marchés aux bestiaux" },
  gros_bovins: { nom: "Gros bovins", sous: "Vaches, génisses, bœufs, jeunes bovins — prix moyen" },
  gros_bovins_siqo: { nom: "Bœuf Label rouge, AOP, IGP", sous: "Gros bovins sous signe de qualité — mensuel" },
  gros_bovins_bio: { nom: "Bœuf bio", sous: "Gros bovins bio — mensuel" },
  agneau: { nom: "Agneau", sous: "Prix moyen, entrée abattoir" },
  porc: { nom: "Porc charcutier", sous: "Référence nationale, classe E" },
  chevreau: { nom: "Chevreau", sous: "Vif, 8 à 11 kg — cotation saisonnière" },
};

const ONGLETS = {
  veau_boucherie_pmp: "Veau de boucherie",
  veau_boucherie: "Veau par qualité",
  veau_14j: "Petits veaux",
  veau_14j_races: "Petits veaux par race",
  veau_14j_laitiers: "Petits veaux laitiers",
  gros_bovins: "Gros bovins",
  agneau: "Agneaux",
  porc: "Porc",
};

const FICHIERS = [
  ["indicateurs.csv", "Prix de référence par espèce (celui des cartes)"],
  ["veaux_boucherie.csv", "Veaux de boucherie par région, couleur, conformation"],
  ["veaux_boucherie_pmp.csv", "Veaux de boucherie — prix moyens pondérés"],
  ["veaux_14j.csv", "Petits veaux — moyennes nationales"],
  ["veaux_14j_marches.csv", "Petits veaux par marché aux bestiaux"],
  ["veaux_14j_marches_effectifs.csv", "Petits veaux — effectifs et tendances des marchés"],
  ["gros_bovins_abattoir.csv", "Gros bovins (standard, SIQO, bio) par catégorie et classe"],
  ["gros_bovins_abattoir_pmp.csv", "Gros bovins — prix moyens pondérés"],
  ["gros_bovins_abattoir_regions.csv", "Gros bovins par région"],
  ["gros_bovins_grille_ue.csv", "Gros bovins — grille communautaire"],
  ["gros_bovins_maigres.csv", "Bovins maigres (broutards) par marché, race, âge, poids"],
  ["ovins.csv", "Agneaux et brebis par zone et poids"],
  ["ovins_pmp.csv", "Ovins — prix moyens pondérés"],
  ["porcs.csv", "Porc charcutier par région et classe"],
  ["caprins.csv", "Chevreau vif"],
];

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MOIS_LONGS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const state = { series: [], serie: null, mode: "temps", range: "", model: null, tables: [], table: 0 };

// ------------------------------------------------------------------ outils

const $ = (sel) => document.querySelector(sel);
const parseDate = (s) => new Date(s + "T00:00:00");
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) node.append(c instanceof Node ? c : document.createTextNode(c));
  return node;
}

function digits(unite) {
  return unite.includes("tête") || unite.includes("100 kg") ? 0 : 2;
}

function fmtNum(v, unite, signed = false) {
  const d = digits(unite);
  const s = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(Math.abs(v));
  if (!signed) return (v < 0 ? "−" : "") + s;
  return (v > 0 ? "+" : v < 0 ? "−" : "") + s;
}

function sens(v) {
  if (v == null) return "flat";
  return v > 0 ? "up" : v < 0 ? "down" : "flat";
}

function fmtDate(d, withYear = true) {
  return `${d.getDate()} ${MOIS_COURTS[d.getMonth()]}${withYear ? " " + d.getFullYear() : ""}`;
}

function periodeLabel(p) {
  if (p.mois) return `${MOIS_LONGS[p.mois - 1].replace(/^./, (c) => c.toUpperCase())} ${p.annee}`;
  const a = parseDate(p.debut), b = parseDate(p.fin);
  const debut = a.getMonth() === b.getMonth() ? String(a.getDate()) : fmtDate(a, a.getFullYear() !== b.getFullYear());
  return `Semaine ${p.semaine} · du ${debut} au ${fmtDate(b)}`;
}

function uniteCourte(unite) {
  return unite.replace("€/", "€ / ");
}

// ------------------------------------------------------------------ cartes

function sparkline(points) {
  const pts = points.slice(-26).map((p) => p.prix);
  const w = 110, h = 34, pad = 3;
  const min = Math.min(...pts), max = Math.max(...pts);
  const x = (i) => pad + (i * (w - 2 * pad)) / Math.max(pts.length - 1, 1);
  const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - 2 * pad);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = pts.length - 1;
  const end = `M${x(last).toFixed(1)},${y(pts[last]).toFixed(1)}h0`;
  // L'SVG s'étire sur toute la largeur de la carte : traits à épaisseur fixe, point final
  // dessiné comme une extrémité ronde pour ne pas être déformé en ellipse
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${css("--green")}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <path d="${end}" stroke="${css("--green")}" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}

function deltaBadge(prix, variation, unite) {
  const s = sens(variation);
  if (variation == null) return el("span", { class: "delta flat" }, "—");
  if (variation === 0) return el("span", { class: "delta flat" }, "= stable");
  const pct = (variation / (prix - variation)) * 100;
  const arrow = s === "up" ? "▲" : "▼";
  return el("span", { class: `delta ${s}`, title: "Écart avec la période précédente" },
    `${arrow} ${fmtNum(variation, unite, true)} € (${pct > 0 ? "+" : "−"}${Math.abs(pct).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %)`);
}

function renderCards() {
  const box = $("#cards");
  box.innerHTML = "";
  const now = Date.now();
  for (const s of state.series) {
    const last = s.dernier;
    const meta = META[s.id] || { nom: s.libelle, sous: "" };
    const ageJours = (now - parseDate(last.fin)) / 864e5;
    const stale = ageJours > (s.periodicite === "mensuelle" ? 75 : 40);
    const card = el("a", {
      class: "card" + (stale ? " stale" : ""), href: `essentiel.html?serie=${s.id}`,
      "aria-label": `${meta.nom} : voir le détail du prix`,
    },
      el("div", { class: "card-top" },
        el("span", { class: "tag" }, s.espece),
        el("span", { class: "card-period" }, s.periodicite === "mensuelle" ? "Mensuel" : `Semaine ${last.semaine}`)),
      el("div", { class: "card-title" }, meta.nom),
      el("div", { class: "card-price" }, fmtNum(last.prix, s.unite), el("small", {}, uniteCourte(s.unite))),
    );
    card.insertAdjacentHTML("beforeend", sparkline(s.points));
    card.append(el("div", { class: "card-foot" }, deltaBadge(last.prix, last.variation, s.unite)));
    card.append(el("div", { class: "card-note" },
      stale ? `Dernière cotation : ${periodeLabel(last).replace(/^Semaine \d+ · /, "")}` : meta.sous));
    box.append(card);
  }
}

// ------------------------------------------------------------------ graphique

function selectSerie(id) {
  state.serie = state.series.find((s) => s.id === id) || state.series[0];
  const meta = META[state.serie.id] || {};
  if ($("#indicateur")) $("#indicateur").value = state.serie.id;
  $("#serie-titre").textContent = `${state.serie.libelle} · en ${state.serie.unite}` +
    (state.serie.periodicite === "mensuelle" ? " · cotation mensuelle" : "");
  document.title = `${meta.nom || state.serie.libelle} — évolution du prix — Le Prix du Bétail`;
  renderChart();
}

// Durée de chaque période, en semaines (clé = valeur du paramètre « periode » de l'adresse)
const PERIODES = { "3a": 156, "1a": 52, "6m": 26, "3m": 13 };

// Garder viande, période et vue dans l'adresse, pour pouvoir partager le lien tel quel
function syncUrl() {
  const url = new URL(location.href);
  url.searchParams.set("serie", state.serie.id);
  if (state.range) url.searchParams.set("periode", state.range);
  else url.searchParams.delete("periode");
  if (state.mode === "annees") url.searchParams.set("vue", "annees");
  else url.searchParams.delete("vue");
  history.replaceState(null, "", url);
}

function setMode(mode) {
  state.mode = mode === "annees" ? "annees" : "temps";
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.mode));
}

function setRange(range) {
  state.range = range in PERIODES ? range : "";
  document.querySelectorAll("[data-range]").forEach((b) => b.classList.toggle("on", b.dataset.range === state.range));
}

// Numéro de la semaine qui contient le 1er de chaque mois (graduations de la vue par année)
const SEMAINE_DEBUT_MOIS = [1, 5, 9, 14, 18, 22, 27, 31, 35, 40, 44, 48];

function capitalize(t) {
  return t.replace(/^./, (c) => c.toUpperCase());
}

// Graduations de l'axe du temps : un libellé tous les 1, 2, 6 ou 12 mois selon la durée affichée,
// l'année écrite au passage de janvier
function timeTicks(x0, x1) {
  const jours = (x1 - x0) / 864e5;
  const pas = jours <= 200 ? 1 : jours <= 400 ? 2 : jours <= 1600 ? 6 : 12;
  const d = new Date(x0);
  const cur = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  while (cur.getMonth() % pas) cur.setMonth(cur.getMonth() + 1);
  const ticks = [];
  for (; cur.getTime() <= x1; cur.setMonth(cur.getMonth() + pas)) {
    const m = cur.getMonth();
    ticks.push({ x: cur.getTime(), label: m === 0 ? String(cur.getFullYear()) : MOIS_COURTS[m] });
  }
  return ticks;
}

// Cotations de la période choisie (« » = tout l'historique)
function pointsPeriode(s, range) {
  if (!range) return s.points;
  const lim = parseDate(s.points[s.points.length - 1].debut).getTime() - PERIODES[range] * 7 * 864e5;
  return s.points.filter((p) => parseDate(p.debut).getTime() > lim);
}

// Données du graphique selon le mode : une série (chronologique) ou une série par année
function buildModel(s) {
  const mensuel = s.periodicite === "mensuelle";
  if (state.mode === "temps") {
    const pts = pointsPeriode(s, state.range);
    const points = pts.map((p) => ({ x: parseDate(p.debut).getTime(), prix: p.prix, p }));
    const domain = d3.extent(points, (d) => d.x);
    return { series: [{ label: s.libelle, current: true, area: true, points }], domain, ticks: timeTicks(...domain) };
  }
  const years = [...new Set(s.points.map((p) => p.annee))].sort();
  const series = years.map((y, k) => ({
    label: String(y),
    current: k === years.length - 1,
    // L'année en cours ressort ; les années passées s'estompent avec l'ancienneté
    opacity: k === years.length - 1 ? 1 : 0.35 + 0.45 * (k / Math.max(years.length - 1, 1)),
    points: s.points.filter((p) => p.annee === y).map((p) => ({ x: mensuel ? p.mois : p.semaine, prix: p.prix, p })),
  }));
  const ticks = mensuel
    ? MOIS_COURTS.map((m, i) => ({ x: i + 1, label: m }))
    : SEMAINE_DEBUT_MOIS.map((w, i) => ({ x: w, label: MOIS_COURTS[i] }));
  return { series, domain: mensuel ? [1, 12] : [1, 53], ticks };
}

function renderChart() {
  const s = state.serie;
  if (!s) return;
  const box = $("#chart");
  if (!window.d3) {
    box.innerHTML = `<p class="error">Le graphique n'a pas pu être chargé.</p>`;
    return;
  }
  document.querySelectorAll("#periodes button").forEach((b) => (b.disabled = state.mode === "annees"));
  syncUrl();
  state.model = buildModel(s);
  renderLegend(state.model);
  drawChart();
  renderStats();
}

function renderLegend(model) {
  const box = $("#legende");
  if (!box) return; // page « L'essentiel » : pas de comparaison des années
  box.hidden = state.mode !== "annees";
  box.innerHTML = "";
  if (box.hidden) return;
  for (const se of model.series) {
    const sw = el("span", { class: "sw" + (se.current ? " current" : "") });
    sw.style.opacity = se.opacity;
    box.append(el("span", { class: "item" }, sw, se.label));
  }
}

function drawChart() {
  const s = state.serie, model = state.model, box = $("#chart");
  const W = box.clientWidth, H = box.clientHeight;
  if (!W || !H) return;
  const petit = W < 500;
  const M = { top: 10, right: petit ? 6 : 14, bottom: 30, left: 0 };
  const mensuel = s.periodicite === "mensuelle";

  d3.select(box).select("svg").remove();
  const all = model.series.flatMap((se) => se.points);
  const [lo, hi] = d3.extent(all, (d) => d.prix);
  const pad = (hi - lo) * 0.08 || hi * 0.05 || 1;
  const y = d3.scaleLinear().domain([lo - pad, hi + pad]).nice().range([H - M.bottom, M.top]);
  const nbTicksY = H < 340 ? 4 : 6;
  // Sur mobile, pas de « € » sur l'axe : l'unité est déjà dans le titre du graphique
  const fmtY = (v) => (petit ? fmtNum(v, s.unite) : `${fmtNum(v, s.unite)} €`);

  const svg = d3.select(box).insert("svg", ":first-child")
    .attr("class", "chart-svg").attr("width", W).attr("height", H);

  // Marge gauche ajustée à la largeur réelle des libellés de l'axe Y
  const probe = svg.append("g").attr("class", "axis");
  const largeurs = y.ticks(nbTicksY).map((v) => probe.append("text").text(fmtY(v)).node().getComputedTextLength());
  probe.remove();
  M.left = Math.ceil(Math.max(0, ...largeurs)) + 12;
  const x = d3.scaleLinear().domain(model.domain).range([M.left, W - M.right]);

  // Axe Y avec la grille horizontale
  svg.append("g").attr("class", "axis axis-y").attr("transform", `translate(${M.left},0)`)
    .call(d3.axisLeft(y).ticks(nbTicksY).tickSize(-(W - M.left - M.right)).tickPadding(8).tickFormat(fmtY))
    .call((g) => g.select(".domain").remove());

  // Axe X : on espace les libellés s'ils sont trop serrés (mobile)
  let ticks = model.ticks.filter((t) => t.x >= model.domain[0] && t.x <= model.domain[1]);
  const tropSerre = () => ticks.length > 1 && (W - M.left - M.right) / ticks.length < 46;
  // Les années (libellés numériques) sont gardées en priorité sur les mois
  if (tropSerre() && ticks.filter((t) => /^\d{4}$/.test(t.label)).length > 1) ticks = ticks.filter((t) => /^\d{4}$/.test(t.label));
  while (tropSerre()) ticks = ticks.filter((_, i) => i % 2 === 0);
  svg.append("g").attr("class", "axis axis-x").attr("transform", `translate(0,${H - M.bottom})`)
    .call(d3.axisBottom(x).tickValues(ticks.map((t) => t.x)).tickFormat((_, i) => ticks[i].label)
      .tickSize(0).tickPadding(10));

  // Courbes : années passées d'abord, année en cours par-dessus
  const ordered = [...model.series].sort((a, b) => a.current - b.current);
  const lineGen = d3.line().x((d) => x(d.x)).y((d) => y(d.prix)).curve(d3.curveMonotoneX);
  const areaGen = d3.area().x((d) => x(d.x)).y0(H - M.bottom).y1((d) => y(d.prix)).curve(d3.curveMonotoneX);
  for (const se of ordered) {
    if (se.area) svg.append("path").attr("class", "area").attr("d", areaGen(se.points));
    svg.append("path")
      .attr("class", `line ${se.current ? "current" : "past"}${state.mode === "annees" ? " annees" : ""}`)
      .attr("stroke-opacity", se.opacity ?? 1)
      .attr("d", lineGen(se.points));
    // Sur une période courte, chaque cotation est marquée d'un point
    if (state.mode === "temps" && se.points.length <= 60) {
      svg.append("g").selectAll("circle").data(se.points).join("circle")
        .attr("class", "pt").attr("r", 2.5).attr("cx", (d) => x(d.x)).attr("cy", (d) => y(d.prix));
    }
  }

  // Survol : ligne verticale, points et infobulle
  const focus = svg.append("g").attr("class", "focus").style("display", "none");
  const focusLine = focus.append("line").attr("class", "focus-line").attr("y1", M.top).attr("y2", H - M.bottom);
  const dots = focus.selectAll("circle").data(ordered).join("circle")
    .attr("r", 4).attr("class", (se) => `dot ${se.current ? "current" : "past"}`);
  const tip = $("#infobulle");

  function show(event) {
    const [mx] = d3.pointer(event, svg.node());
    const xv = x.invert(mx);
    let xi, titre, rows;
    if (state.mode === "temps") {
      const pts = model.series[0].points;
      const d = pts[d3.bisector((p) => p.x).center(pts, xv)];
      xi = d.x;
      // « S44 » plutôt que « Semaine 44 » : l'infobulle reste étroite
      titre = periodeLabel(d.p).replace(/^Semaine /, "S");
      rows = [{ se: model.series[0], d }];
    } else {
      xi = Math.round(Math.min(model.domain[1], Math.max(model.domain[0], xv)));
      titre = mensuel ? capitalize(MOIS_LONGS[xi - 1]) : `S${xi}`;
      rows = model.series.map((se) => ({ se, d: se.points.find((p) => p.x === xi) })).filter((r) => r.d).reverse();
    }
    const px = x(xi);
    focus.style("display", null);
    focusLine.attr("x1", px).attr("x2", px);
    dots.each(function (se) {
      const r = rows.find((row) => row.se === se);
      d3.select(this).style("display", r ? null : "none").attr("cx", px).attr("cy", r ? y(r.d.prix) : 0);
    });

    tip.innerHTML = "";
    tip.append(el("b", {}, titre));
    for (const { se, d } of rows) {
      const v = state.mode === "temps" && d.p.variation != null
        ? el("span", { class: `d ${sens(d.p.variation)}` },
          ` ${d.p.variation === 0 ? "=" : fmtNum(d.p.variation, s.unite, true) + " €"}`)
        : "";
      const label = state.mode === "annees" ? el("span", { class: "annee" }, `${se.label} : `) : "";
      tip.append(el("div", { class: se.current ? "row current" : "row" }, label, `${fmtNum(d.prix, s.unite)} ${s.unite}`, v));
    }
    tip.hidden = false;
    const tw = tip.offsetWidth;
    let left = px + 14;
    if (left + tw > W - 4) left = Math.max(4, px - 14 - tw);
    tip.style.left = `${left}px`;
    tip.style.top = `${M.top}px`;
  }

  function hide(event) {
    // Au doigt, l'infobulle reste affichée après avoir levé le doigt ;
    // elle se ferme en touchant ailleurs ou en faisant défiler la page (voir main)
    if (event && event.pointerType && event.pointerType !== "mouse") return;
    focus.style("display", "none");
    tip.hidden = true;
  }
  state.hideTip = () => hide();

  svg.append("rect").attr("class", "overlay")
    .attr("x", M.left).attr("y", M.top).attr("width", W - M.left - M.right).attr("height", H - M.top - M.bottom)
    .on("pointermove", show).on("pointerdown", show).on("pointerleave", hide);
  tip.hidden = true;
}

// Libellé de la période choisie, pour les encarts sous le graphique
const PERIODES_LIBELLES = { "3a": "sur 3 ans", "1a": "sur 12 mois", "6m": "sur 6 mois", "3m": "sur 3 mois" };

function renderStats() {
  if (!$("#stats")) return renderResume(); // page « L'essentiel » : un résumé à la place des encarts
  const s = state.serie, u = s.unite;
  // Même sélection que le graphique ; la vue par année porte sur tout l'historique
  const pts = pointsPeriode(s, state.mode === "temps" ? state.range : "");
  const first = pts[0], last = pts[pts.length - 1];
  const min = pts.reduce((a, b) => (b.prix < a.prix ? b : a));
  const max = pts.reduce((a, b) => (b.prix > a.prix ? b : a));
  const avg = pts.reduce((a, b) => a + b.prix, 0) / pts.length;
  const range = state.mode === "temps" ? state.range : "";
  const d0 = parseDate(first.debut);
  const surPeriode = PERIODES_LIBELLES[range] || `depuis ${MOIS_COURTS[d0.getMonth()]} ${d0.getFullYear()}`;

  const stat = (b, span) => el("div", { class: "stat" }, el("b", {}, b), el("span", {}, span));
  const box = $("#stats");
  box.innerHTML = "";
  box.append(
    stat(`${fmtNum(last.prix, u)} €`, `Dernière cotation (${s.periodicite === "mensuelle"
      ? periodeLabel(last)
      : libellePeriode(last)})`),
    stat(`${fmtNum(avg, u)} €`, `Moyenne ${surPeriode}`),
    stat(`${fmtNum(min.prix, u)} – ${fmtNum(max.prix, u)} €`, `Plus bas – plus haut ${surPeriode}`),
  );
  if (pts.length > 1) {
    const d = last.prix - first.prix;
    const pct = (d / first.prix) * 100;
    box.append(stat(`${fmtNum(d, u, true)} € (${pct >= 0 ? "+" : "−"}${Math.abs(pct).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %)`,
      `Évolution ${surPeriode}`));
  }
}

// ------------------------------------------------------------------ page « L'essentiel »

// Un prix, avec sa variation ; la couleur suit le sens : vert en hausse, rouge en baisse
function tuile(titre, valeur, variation, unite, detail, avecVariation = true) {
  const bloc = el("div", { class: "tuile" }, el("span", { class: "tuile-titre" }, titre));
  const sens = variation == null || variation === 0 ? "stable" : variation > 0 ? "hausse" : "baisse";
  bloc.append(el("b", { class: `tuile-valeur ${sens}` }, valeur));
  if (variation != null && avecVariation) {
    const fleche = variation > 0 ? "▲ " : variation < 0 ? "▼ " : "";
    bloc.append(el("span", { class: `tuile-var ${sens}` },
      variation === 0 ? "= stable" : `${fleche}${fmtNum(variation, unite, true)} €`));
  }
  if (detail) bloc.append(el("span", { class: "tuile-detail" }, detail));
  return bloc;
}

// « S38 · du 14 au 20 sept. 2026 » : c'est la semaine cotée, pas la date de publication
// (FranceAgriMer publie dès la fin des marchés, avant le dimanche)
function libellePeriode(p) {
  return periodeLabel(p).replace(/^Semaine /, "S");
}

function renderResume() {
  const s = state.serie, u = s.unite;
  const meta = META[s.id] || {};
  $("#essentiel-titre").textContent = meta.nom || s.libelle;
  // L'unité est rappelée sous le graphique, la source figure en pied de page
  $("#essentiel-sous").textContent = s.periodicite === "mensuelle" ? "Cotation mensuelle" : "Cotation hebdomadaire";
  document.title = `${meta.nom || s.libelle} — Le Prix du Bétail`;
  $("#lien-evolution").href = `evolution.html?serie=${s.id}`;

  const [avant, dernier] = s.points.slice(-2);
  const six = pointsPeriode(s, "6m");
  const moyenne = six.reduce((a, b) => a + b.prix, 0) / six.length;
  const evolution = six[six.length - 1].prix - six[0].prix;
  const pct = (evolution / six[0].prix) * 100;

  const box = $("#resume");
  box.innerHTML = "";
  box.append(
    tuile("Dernière cotation", `${fmtNum(dernier.prix, u)} €`, dernier.variation, u, libellePeriode(dernier)),
    tuile("Cotation précédente", `${fmtNum(avant.prix, u)} €`, avant.variation, u, libellePeriode(avant)),
    tuile("Moyenne sur 6 mois", `${fmtNum(moyenne, u)} €`, null, u, `${six.length} cotations`),
    tuile("Évolution sur 6 mois",
      `${evolution > 0 ? "▲ " : evolution < 0 ? "▼ " : ""}${fmtNum(evolution, u, true)} €`, evolution, u,
      `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % depuis ${fmtDate(parseDate(six[0].debut))}`,
      false),
  );
}

// ------------------------------------------------------------------ tableaux

function renderTabs() {
  const tabs = $("#tabs");
  tabs.innerHTML = "";
  state.tables.forEach((t, i) => {
    tabs.append(el("button", {
      type: "button", role: "tab", "aria-selected": String(i === state.table),
      onclick: () => { state.table = i; renderTabs(); renderTable(); },
    }, ONGLETS[t.id] || t.titre.split(" — ")[0]));
  });
}

// Grille EUROP : explication affichée au survol (et au focus clavier)
const CONFORMATION = {
  E: "E — conformation excellente", U: "U — très bonne", R: "R — bonne",
  O: "O — assez bonne", P: "P — médiocre",
};

function libelleConformation(texte) {
  const m = /^([EUROP])([+=-])?$/.exec(texte);
  if (!m) return null;
  const signe = { "+": " (haut de classe)", "=": " (milieu de classe)", "-": " (bas de classe)" };
  return CONFORMATION[m[1]] + (m[2] ? signe[m[2]] : "");
}

// Cellule d'en-tête, avec une aide au survol quand c'est une classe de conformation
function cellule(balise, texte, classe) {
  const aide = libelleConformation(texte);
  const attrs = classe ? { class: classe } : {};
  return aide
    ? el(balise, attrs, el("abbr", { class: "aide", title: aide }, texte))
    : el(balise, attrs, texte);
}

function renderTable() {
  const t = state.tables[state.table];
  const box = $("#table");
  box.innerHTML = "";
  if (!t) return;
  const simple = t.colonnes.length === 1;
  const unite = t.unite;

  // Colonnes « Catégorie — Type » : en-tête sur deux niveaux, catégories fusionnées
  const grouped = t.colonnes.every((c) => c.includes(" — "));
  let thead;
  if (grouped) {
    const groups = [];
    for (const c of t.colonnes) {
      const g = c.split(" — ")[0];
      if (groups.length && groups[groups.length - 1].g === g) groups[groups.length - 1].n++;
      else groups.push({ g, n: 1 });
    }
    thead = el("thead", {},
      el("tr", { class: "group" }, el("th", {}, ""), ...groups.map(({ g, n }) => el("th", { colspan: String(n) }, g))),
      el("tr", {}, el("th", {}, ""), ...t.colonnes.map((c) => cellule("th", c.split(" — ")[1]))));
  } else {
    thead = el("thead", {}, el("tr", {}, el("th", {}, ""),
      ...t.colonnes.map((c) => cellule("th", simple ? `Prix (${unite})` : c))));
  }
  const tbody = el("tbody", {}, ...t.lignes.map((ligne, i) => el("tr", {}, cellule("th", ligne),
    ...t.valeurs[i].map((v) => {
      if (!v) return el("td", { class: "empty" }, "·");
      const s = sens(v.variation);
      const delta = v.variation == null ? "" : v.variation === 0 ? "=" : fmtNum(v.variation, unite, true);
      return el("td", {}, el("span", { class: "v" }, fmtNum(v.prix, unite)), el("span", { class: `d ${s}` }, delta));
    }))));

  box.append(
    el("h3", {}, t.titre),
    el("p", { class: "table-meta" }, `${periodeLabel(t.periode)} · ${simple ? "" : "en " + unite}`.replace(/ · $/, "")),
    el("div", { class: "scroll" }, el("table", {}, thead, tbody)),
  );
  if (t.note) box.append(el("p", { class: "table-note" }, t.note));
}

// ------------------------------------------------------------------ téléchargements

function renderDownloads() {
  const ul = $("#downloads");
  for (const [f, desc] of FICHIERS) {
    ul.append(el("li", {}, el("a", { href: `data/${f}`, download: "" },
      el("span", { class: "desc" }, desc), el("span", { class: "file" }, f))));
  }
}

// ------------------------------------------------------------------ démarrage

async function main() {
  const dashboard = !!$("#cards");
  if ($("#downloads")) renderDownloads();
  if (!dashboard && !$("#chart")) return; // page « Comprendre et télécharger »
  try {
    const [ind, det] = await Promise.all([
      fetch("data/indicateurs.json?v=__VERSION__").then((r) => r.json()),
      dashboard ? fetch("data/details.json?v=__VERSION__").then((r) => r.json()) : { tableaux: [] },
    ]);
    const order = Object.keys(META);
    state.series = ind.indicateurs
      .filter((s) => s.points.length)
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    state.tables = det.tableaux;
  } catch (err) {
    const box = $("#cards") || $(".chart-box");
    box.innerHTML = `<p class="error">Les données n'ont pas pu être chargées. Réessayez dans un instant.</p>`;
    console.error(err);
    return;
  }

  if (dashboard) {
    const latest = state.series.reduce((a, s) => (s.dernier.fin > a ? s.dernier.fin : a), "");
    $("#maj").textContent = `Dernières données : ${fmtDate(parseDate(latest))}.`;
    renderCards();
    renderTabs();
    renderTable();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderCards);
    return;
  }

  const params = new URLSearchParams(location.search);

  // Page « L'essentiel » : tout vient de l'adresse, aucun réglage à l'écran
  if ($("#essentiel")) {
    setMode("temps");
    setRange(params.get("periode") || "6m");
    selectSerie(params.get("serie") || state.series[0].id);
    observerTailleEtInfobulle();
    return;
  }

  // Page « Évolution des prix »
  const select = $("#indicateur");
  for (const s of state.series) select.append(el("option", { value: s.id }, (META[s.id] || {}).nom || s.libelle));
  select.addEventListener("change", () => selectSerie(select.value));

  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    setMode(b.dataset.mode);
    renderChart();
  }));
  document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
    setRange(b.dataset.range);
    renderChart();
  }));

  // État initial repris de l'adresse (lien partagé)
  setMode(params.get("vue"));
  setRange(params.get("periode") || "");
  selectSerie(params.get("serie") || state.series[0].id);

  observerTailleEtInfobulle();
}

function observerTailleEtInfobulle() {
  // Le SVG a une taille fixe en pixels : on le redessine quand son conteneur change de taille
  let timer = 0;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => state.model && drawChart(), 60);
  }).observe($("#chart"));

  // Fermer l'infobulle (utile au doigt, où il n'y a pas de « sortie » du graphique) :
  // en touchant en dehors de la zone du graphique, ou quand la page défile
  const overlay = () => $("#chart .overlay");
  document.addEventListener("pointerdown", (e) => { if (e.target !== overlay()) state.hideTip?.(); });
  window.addEventListener("scroll", () => state.hideTip?.(), { passive: true });
}

main();

// Application installable : le service worker met le site en cache pour l'usage hors connexion
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
