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

const state = { series: [], serie: null, mode: "temps", range: 0, chart: null, tables: [], table: 0 };

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
      class: "card" + (stale ? " stale" : ""), href: `evolution.html?serie=${s.id}`,
      "aria-label": `${meta.nom} : voir l'évolution du prix`,
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
  $("#indicateur").value = state.serie.id;
  const meta = META[state.serie.id] || {};
  $("#serie-titre").textContent = `${state.serie.libelle} · en ${state.serie.unite}` +
    (state.serie.periodicite === "mensuelle" ? " · cotation mensuelle" : "");
  document.title = `${meta.nom || state.serie.libelle} — évolution du prix — Le Prix du Bétail`;
  // Garder la viande choisie dans l'adresse, pour pouvoir partager le lien
  const url = new URL(location.href);
  url.searchParams.set("serie", state.serie.id);
  history.replaceState(null, "", url);
  renderChart();
}

function yearColors(n) {
  // Années passées en gris, année en cours en vert
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? css("--green") : css("--past")));
}

function renderChart() {
  const s = state.serie;
  if (!s) return;
  if (!window.Chart) {
    $(".chart-box").innerHTML = '<p class="error">Le graphique n\'a pas pu être chargé.</p>';
    return;
  }
  const mensuel = s.periodicite === "mensuelle";
  const ink = css("--ink-soft"), line = css("--line");
  Chart.defaults.font.family = css("--sans") || "Inter, sans-serif";
  Chart.defaults.color = ink;

  let data, options;
  const baseScales = {
    y: {
      grid: { color: line }, border: { display: false },
      ticks: { callback: (v) => fmtNum(v, s.unite) + " €" },
      title: { display: true, text: s.unite },
    },
  };
  const tooltip = {
    backgroundColor: css("--surface"), titleColor: css("--ink"), bodyColor: css("--ink"),
    borderColor: line, borderWidth: 1, padding: 10,
  };

  document.querySelectorAll("#periodes button").forEach((b) => (b.disabled = state.mode === "annees"));

  if (state.mode === "temps") {
    let pts = s.points;
    if (state.range) {
      const lim = parseDate(pts[pts.length - 1].debut).getTime() - state.range * 7 * 864e5;
      pts = pts.filter((p) => parseDate(p.debut).getTime() > lim);
    }
    data = {
      labels: pts.map((p) => {
        const d = parseDate(p.debut);
        return mensuel ? `${MOIS_COURTS[d.getMonth()]} ${d.getFullYear()}` : fmtDate(d);
      }),
      datasets: [{
        label: s.libelle, data: pts.map((p) => p.prix),
        borderColor: css("--green"), backgroundColor: css("--green-soft"),
        fill: true, tension: 0.25, pointRadius: pts.length > 60 ? 0 : 2.5, pointHoverRadius: 4, borderWidth: 2,
      }],
    };
    options = {
      scales: { ...baseScales, x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } } },
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltip, callbacks: {
          title: (items) => periodeLabel(pts[items[0].dataIndex]),
          label: (item) => {
            const p = pts[item.dataIndex];
            const v = p.variation == null ? "" : `  (${fmtNum(p.variation, s.unite, true)} €)`;
            return ` ${fmtNum(p.prix, s.unite)} ${s.unite}${v}`;
          },
        } },
      },
    };
  } else {
    const years = [...new Set(s.points.map((p) => p.annee))].sort();
    const n = mensuel ? 12 : 53;
    const colors = yearColors(years.length);
    data = {
      labels: Array.from({ length: n }, (_, i) => (mensuel ? MOIS_COURTS[i] : `S${i + 1}`)),
      datasets: years.map((y, k) => {
        const row = Array(n).fill(null);
        for (const p of s.points) if (p.annee === y) row[(mensuel ? p.mois : p.semaine) - 1] = p.prix;
        const current = k === years.length - 1;
        // L'année en cours ressort ; les années passées s'estompent avec l'ancienneté
        const alpha = current ? 1 : 0.3 + 0.5 * (k / Math.max(years.length - 1, 1));
        return {
          label: String(y), data: row, spanGaps: true, tension: 0.25, pointRadius: 0, pointHoverRadius: 4,
          borderColor: withAlpha(colors[k], alpha), backgroundColor: withAlpha(colors[k], alpha),
          borderWidth: current ? 3 : 1.6, order: current ? 0 : 1,
        };
      }),
    };
    options = {
      scales: { ...baseScales, x: { grid: { display: false }, ticks: { maxTicksLimit: 13, maxRotation: 0 } } },
      plugins: {
        legend: { position: "top", align: "end", labels: { boxWidth: 14, boxHeight: 3 } },
        tooltip: { ...tooltip, mode: "index", intersect: false, callbacks: {
          title: (items) => (mensuel ? MOIS_LONGS[items[0].dataIndex] : `Semaine ${items[0].dataIndex + 1}`),
          label: (item) => item.raw == null ? null : ` ${item.dataset.label} : ${fmtNum(item.raw, s.unite)} ${s.unite}`,
        } },
      },
    };
  }

  options = { ...options, responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    interaction: { mode: state.mode === "annees" ? "index" : "nearest", intersect: false } };

  if (state.chart) state.chart.destroy();
  state.chart = new Chart($("#chart"), { type: "line", data, options });
  renderStats();
}

function withAlpha(color, a) {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a.toFixed(2)})`;
}

function renderStats() {
  const s = state.serie, pts = s.points, last = pts[pts.length - 1];
  const lim = parseDate(last.debut).getTime() - 365 * 864e5;
  const year = pts.filter((p) => parseDate(p.debut).getTime() > lim);
  const min = year.reduce((a, b) => (b.prix < a.prix ? b : a));
  const max = year.reduce((a, b) => (b.prix > a.prix ? b : a));
  const avg = year.reduce((a, b) => a + b.prix, 0) / year.length;
  const ago = pts.find((p) => p.annee === last.annee - 1 && (s.periodicite === "mensuelle" ? p.mois === last.mois : p.semaine === last.semaine));
  const u = s.unite;
  const stat = (b, span) => el("div", { class: "stat" }, el("b", {}, b), el("span", {}, span));
  const box = $("#stats");
  box.innerHTML = "";
  box.append(
    stat(`${fmtNum(last.prix, u)} €`, `Dernière cotation (${s.periodicite === "mensuelle" ? periodeLabel(last) : "sem. " + last.semaine})`),
    stat(`${fmtNum(avg, u)} €`, "Moyenne sur 12 mois"),
    stat(`${fmtNum(min.prix, u)} – ${fmtNum(max.prix, u)} €`, "Plus bas – plus haut sur 12 mois"),
  );
  if (ago) {
    const d = last.prix - ago.prix;
    const pct = (d / ago.prix) * 100;
    box.append(stat(`${fmtNum(d, u, true)} € (${pct >= 0 ? "+" : "−"}${Math.abs(pct).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %)`,
      "Par rapport à l'an dernier, même période"));
  }
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
      el("tr", {}, el("th", {}, ""), ...t.colonnes.map((c) => el("th", {}, c.split(" — ")[1]))));
  } else {
    thead = el("thead", {}, el("tr", {}, el("th", {}, ""),
      ...t.colonnes.map((c) => el("th", {}, simple ? `Prix (${unite})` : c))));
  }
  const tbody = el("tbody", {}, ...t.lignes.map((ligne, i) => el("tr", {}, el("th", {}, ligne),
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

  // Page « Évolution des prix »
  const select = $("#indicateur");
  for (const s of state.series) select.append(el("option", { value: s.id }, (META[s.id] || {}).nom || s.libelle));
  select.addEventListener("change", () => selectSerie(select.value));

  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    state.mode = b.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("on", x === b));
    renderChart();
  }));
  document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
    state.range = Number(b.dataset.range);
    document.querySelectorAll("[data-range]").forEach((x) => x.classList.toggle("on", x === b));
    renderChart();
  }));

  selectSerie(new URLSearchParams(location.search).get("serie") || state.series[0].id);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderChart);
}

main();
