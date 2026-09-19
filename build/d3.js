// Modules D3 utilisés par site/app.js pour le graphique de la page Évolution.
// Construire avec : bun run build:d3
import { scaleLinear } from "d3-scale";
import { line, area, curveMonotoneX } from "d3-shape";
import { axisBottom, axisLeft } from "d3-axis";
import { select, pointer } from "d3-selection";
import { bisector, extent } from "d3-array";

// app.js utilise la variable globale d3
window.d3 = { scaleLinear, line, area, curveMonotoneX, axisBottom, axisLeft, select, pointer, bisector, extent };
