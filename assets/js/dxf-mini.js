(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HA_DXF = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Factor de conversión a mm según la cabecera $INSUNITS del DXF. 0 o ausente se trata
  // como mm (lo habitual en archivos para corte/grabado láser).
  const INSUNITS_TO_MM = {
    1: 25.4, // pulgadas
    2: 304.8, // pies
    4: 1, // milímetros
    5: 10, // centímetros
    6: 1000, // metros
    8: 0.0000254, // micropulgadas
    9: 0.0254, // mils (milésimas de pulgada)
    10: 914.4, // yardas
    14: 100, // decímetros
  };

  // Tipos que se dibujan (o que forman parte de otra entidad) y por tanto no cuentan como omitidos.
  const HANDLED_TYPES = ["LINE", "CIRCLE", "ARC", "LWPOLYLINE", "POLYLINE", "VERTEX", "SEQEND", "ELLIPSE", "SPLINE"];

  const ARC_STEP_RAD = Math.PI / 36; // 5º por segmento al teselar arcos de polilínea y elipses

  function parseDxfPairs(text) {
    const lines = text.split(/\r\n|\r|\n/);
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = parseInt(lines[i].trim(), 10);
      const value = lines[i + 1] !== undefined ? lines[i + 1].trim() : "";
      if (!isNaN(code)) pairs.push([code, value]);
    }
    return pairs;
  }

  function splitIntoRecords(pairs) {
    const records = [];
    let currentType = null;
    let currentPairs = null;
    pairs.forEach(([code, value]) => {
      if (code === 0) {
        if (currentType) records.push({ type: currentType, pairs: currentPairs });
        currentType = value;
        currentPairs = [];
      } else if (currentPairs) {
        currentPairs.push([code, value]);
      }
    });
    if (currentType) records.push({ type: currentType, pairs: currentPairs });
    return records;
  }

  function extractEntitiesSection(records) {
    let start = -1;
    for (let i = 0; i < records.length; i++) {
      if (records[i].type === "SECTION" && records[i].pairs.some(([c, v]) => c === 2 && v === "ENTITIES")) {
        start = i + 1;
        break;
      }
    }
    if (start === -1) return [];
    let end = records.length;
    for (let i = start; i < records.length; i++) {
      if (records[i].type === "ENDSEC") {
        end = i;
        break;
      }
    }
    return records.slice(start, end);
  }

  // Lee $INSUNITS de la cabecera: es una variable (código 9) seguida de su valor (código 70).
  function readInsUnits(pairs) {
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i][0] === 9 && pairs[i][1] === "$INSUNITS") {
        for (let j = i + 1; j < pairs.length && pairs[j][0] !== 9 && pairs[j][0] !== 0; j++) {
          if (pairs[j][0] === 70) return parseInt(pairs[j][1], 10) || 0;
        }
        return 0;
      }
      // La cabecera termina con el primer ENDSEC; no hace falta recorrer el resto del archivo.
      if (pairs[i][0] === 0 && pairs[i][1] === "ENDSEC") break;
    }
    return 0;
  }

  function getVal(pairs, code) {
    for (const [c, v] of pairs) if (c === code) return v;
    return undefined;
  }
  function getAll(pairs, code) {
    return pairs.filter(([c]) => c === code).map(([, v]) => v);
  }
  function num(v, fallback) {
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  // Puntos intermedios del arco que describe un tramo de polilínea con "bulge" (código 42).
  // bulge = tan(θ/4), siendo θ el ángulo del arco (positivo: sentido antihorario). Devuelve
  // solo los puntos interiores (ni el inicial ni el final del tramo).
  function bulgeArcPoints(x1, y1, x2, y2, bulge) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const chord = Math.hypot(dx, dy);
    if (!bulge || !isFinite(bulge) || chord === 0) return [];
    const theta = 4 * Math.atan(bulge);
    // Distancia (con signo) del punto medio de la cuerda al centro, sobre la normal izquierda.
    const h = chord / (2 * Math.tan(theta / 2));
    const cx = (x1 + x2) / 2 + (-dy / chord) * h;
    const cy = (y1 + y2) / 2 + (dx / chord) * h;
    const r = Math.hypot(x1 - cx, y1 - cy);
    const a1 = Math.atan2(y1 - cy, x1 - cx);
    const steps = Math.max(4, Math.ceil(Math.abs(theta) / ARC_STEP_RAD));
    const out = [];
    for (let s = 1; s < steps; s++) {
      const a = a1 + (theta * s) / steps;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return out;
  }

  // Convierte los vértices ({x, y, bulge}) de una polilínea en una lista de puntos, sustituyendo
  // cada tramo con bulge por su arco teselado.
  function expandPolyline(vertices, closed) {
    const valid = vertices.filter((v) => !isNaN(v.x) && !isNaN(v.y));
    const points = [];
    valid.forEach((v, idx) => {
      points.push([v.x, v.y]);
      const next = idx + 1 < valid.length ? valid[idx + 1] : closed ? valid[0] : null;
      if (next && v.bulge) points.push(...bulgeArcPoints(v.x, v.y, next.x, next.y, v.bulge));
    });
    return points;
  }

  // Los vértices de LWPOLYLINE van seguidos en el mismo registro: cada código 10 abre un vértice
  // nuevo y los 20/42 que le siguen pertenecen a ese vértice.
  function lwpolylineVertices(pairs) {
    const vertices = [];
    let cur = null;
    pairs.forEach(([c, v]) => {
      if (c === 10) {
        cur = { x: parseFloat(v), y: NaN, bulge: 0 };
        vertices.push(cur);
      } else if (cur && c === 20) {
        cur.y = parseFloat(v);
      } else if (cur && c === 42) {
        cur.bulge = num(v, 0);
      }
    });
    return vertices;
  }

  // Elipse (o arco de elipse) teselada como polilínea. Parámetros en radianes; 0..2π = completa.
  function ellipsePoints(pairs) {
    const cx = num(getVal(pairs, 10), NaN);
    const cy = num(getVal(pairs, 20), NaN);
    const mx = num(getVal(pairs, 11), NaN);
    const my = num(getVal(pairs, 21), NaN);
    const ratio = num(getVal(pairs, 40), 1);
    let t0 = num(getVal(pairs, 41), 0);
    let t1 = num(getVal(pairs, 42), Math.PI * 2);
    if ([cx, cy, mx, my].some((v) => isNaN(v))) return null;
    // Centro y eje mayor van en coordenadas absolutas; el eje menor es extrusión × eje mayor,
    // así que con extrusión negativa (dibujo "en espejo") cambia de sentido.
    const flip = num(getVal(pairs, 230), 1) < 0 ? -1 : 1;
    while (t1 <= t0) t1 += Math.PI * 2;
    const full = Math.abs(t1 - t0 - Math.PI * 2) < 1e-6;
    // Semieje menor: perpendicular al mayor, escalado por la proporción.
    const nx = -my * ratio * flip;
    const ny = mx * ratio * flip;
    const steps = Math.max(8, Math.ceil((t1 - t0) / ARC_STEP_RAD));
    const points = [];
    for (let s = 0; s <= (full ? steps - 1 : steps); s++) {
      const t = t0 + ((t1 - t0) * s) / steps;
      points.push([cx + Math.cos(t) * mx + Math.sin(t) * nx, cy + Math.cos(t) * my + Math.sin(t) * ny]);
    }
    return { points, closed: full };
  }

  // SPLINE: si trae nudos y puntos de control coherentes se evalúa la curva B-spline (también
  // racional, con pesos) mediante el algoritmo de De Boor. Si no, se aproxima uniendo con rectas
  // sus puntos de ajuste o de control (y se avisa de ello).
  function splinePoints(pairs) {
    const degree = parseInt(getVal(pairs, 71) || "3", 10) || 3;
    const flags = parseInt(getVal(pairs, 70) || "0", 10);
    const knots = getAll(pairs, 40).map(parseFloat);
    const weights = getAll(pairs, 41).map(parseFloat);
    const ctrl = zipPoints(getAll(pairs, 10), getAll(pairs, 20));
    const fit = zipPoints(getAll(pairs, 11), getAll(pairs, 21));
    const closed = (flags & 1) === 1;

    const n = ctrl.length;
    if (n > degree && knots.length === n + degree + 1 && knots.every((k) => !isNaN(k))) {
      const w = weights.length === n ? weights : ctrl.map(() => 1);
      const tStart = knots[degree];
      const tEnd = knots[n];
      if (tEnd > tStart) {
        const samples = Math.min(2000, Math.max(32, n * 12));
        const points = [];
        for (let s = 0; s <= samples; s++) {
          const p = deBoor(degree, knots, ctrl, w, tStart + ((tEnd - tStart) * s) / samples);
          if (p) points.push(p);
        }
        if (points.length >= 2) return { points, closed, approximated: false };
      }
    }
    const base = fit.length >= 2 ? fit : ctrl;
    if (base.length < 2) return null;
    return { points: base, closed, approximated: true };
  }

  function zipPoints(xs, ys) {
    const out = [];
    for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
      const x = parseFloat(xs[i]);
      const y = parseFloat(ys[i]);
      if (!isNaN(x) && !isNaN(y)) out.push([x, y]);
    }
    return out;
  }

  function deBoor(p, U, P, W, t) {
    const n = P.length;
    let k = p;
    while (k < n - 1 && t >= U[k + 1]) k++;
    // Coordenadas homogéneas [x·w, y·w, w] para admitir curvas racionales (NURBS).
    const d = [];
    for (let j = 0; j <= p; j++) {
      const idx = j + k - p;
      const wj = isNaN(W[idx]) || W[idx] === 0 ? 1 : W[idx];
      d.push([P[idx][0] * wj, P[idx][1] * wj, wj]);
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const denom = U[j + 1 + k - r] - U[j + k - p];
        const alpha = denom === 0 ? 0 : (t - U[j + k - p]) / denom;
        d[j] = [
          (1 - alpha) * d[j - 1][0] + alpha * d[j][0],
          (1 - alpha) * d[j - 1][1] + alpha * d[j][1],
          (1 - alpha) * d[j - 1][2] + alpha * d[j][2],
        ];
      }
    }
    const res = d[p];
    if (!res[2]) return null;
    return [res[0] / res[2], res[1] / res[2]];
  }

  function buildEntities(records, report) {
    const entities = [];
    const skip = (type) => {
      report.skipped[type] = (report.skipped[type] || 0) + 1;
    };
    let i = 0;
    while (i < records.length) {
      const rec = records[i];
      if (rec.type === "LINE") {
        entities.push({
          type: "LINE",
          x1: parseFloat(getVal(rec.pairs, 10)),
          y1: parseFloat(getVal(rec.pairs, 20)),
          x2: parseFloat(getVal(rec.pairs, 11)),
          y2: parseFloat(getVal(rec.pairs, 21)),
        });
        i++;
      } else if (rec.type === "CIRCLE") {
        entities.push({
          type: "CIRCLE",
          cx: parseFloat(getVal(rec.pairs, 10)),
          cy: parseFloat(getVal(rec.pairs, 20)),
          r: parseFloat(getVal(rec.pairs, 40)),
        });
        i++;
      } else if (rec.type === "ARC") {
        entities.push({
          type: "ARC",
          cx: parseFloat(getVal(rec.pairs, 10)),
          cy: parseFloat(getVal(rec.pairs, 20)),
          r: parseFloat(getVal(rec.pairs, 40)),
          startAngle: parseFloat(getVal(rec.pairs, 50)),
          endAngle: parseFloat(getVal(rec.pairs, 51)),
        });
        i++;
      } else if (rec.type === "LWPOLYLINE") {
        const flags = parseInt(getVal(rec.pairs, 70) || "0", 10);
        const closed = (flags & 1) === 1;
        entities.push({ type: "LWPOLYLINE", points: expandPolyline(lwpolylineVertices(rec.pairs), closed), closed });
        i++;
      } else if (rec.type === "POLYLINE") {
        const flags = parseInt(getVal(rec.pairs, 70) || "0", 10);
        const closed = (flags & 1) === 1;
        const vertices = [];
        let j = i + 1;
        while (j < records.length && records[j].type === "VERTEX") {
          vertices.push({
            x: parseFloat(getVal(records[j].pairs, 10)),
            y: parseFloat(getVal(records[j].pairs, 20)),
            bulge: num(getVal(records[j].pairs, 42), 0),
          });
          j++;
        }
        if (j < records.length && records[j].type === "SEQEND") j++;
        entities.push({ type: "LWPOLYLINE", points: expandPolyline(vertices, closed), closed });
        i = j;
      } else if (rec.type === "ELLIPSE") {
        const el = ellipsePoints(rec.pairs);
        if (el) entities.push({ type: "LWPOLYLINE", points: el.points, closed: el.closed });
        else skip(rec.type);
        i++;
      } else if (rec.type === "SPLINE") {
        const sp = splinePoints(rec.pairs);
        if (sp) {
          entities.push({ type: "LWPOLYLINE", points: sp.points, closed: sp.closed });
          if (sp.approximated) report.approximated++;
        } else {
          skip(rec.type);
        }
        i++;
      } else {
        if (HANDLED_TYPES.indexOf(rec.type) === -1) skip(rec.type);
        i++;
      }
    }
    return entities;
  }

  // Devuelve las entidades dibujables y además información útil para el diseñador:
  // - unitsToMm: factor para pasar las unidades del dibujo a mm (según $INSUNITS).
  // - skipped: { TIPO: n } con las entidades que no se saben dibujar (TEXT, HATCH, INSERT...).
  // - approximated: nº de SPLINE que se han aproximado uniendo sus puntos con rectas.
  function parseDXFDetailed(text) {
    const pairs = parseDxfPairs(text);
    const insUnits = readInsUnits(pairs);
    const records = splitIntoRecords(pairs);
    const entityRecords = extractEntitiesSection(records);
    const report = { skipped: {}, approximated: 0 };
    const entities = buildEntities(entityRecords, report);
    return {
      entities,
      insUnits,
      unitsToMm: INSUNITS_TO_MM[insUnits] || 1,
      skipped: report.skipped,
      skippedCount: Object.keys(report.skipped).reduce((sum, k) => sum + report.skipped[k], 0),
      approximated: report.approximated,
    };
  }

  // Versión simple (compatibilidad): solo la lista de entidades.
  function parseDXF(text) {
    return parseDXFDetailed(text).entities;
  }

  function computeBounds(entities) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    function extend(x, y) {
      if (isNaN(x) || isNaN(y)) return;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    entities.forEach((e) => {
      if (e.type === "LINE") {
        extend(e.x1, e.y1);
        extend(e.x2, e.y2);
      } else if (e.type === "CIRCLE") {
        extend(e.cx - e.r, e.cy - e.r);
        extend(e.cx + e.r, e.cy + e.r);
      } else if (e.type === "ARC") {
        extend(e.cx - e.r, e.cy - e.r);
        extend(e.cx + e.r, e.cy + e.r);
      } else if (e.type === "LWPOLYLINE") {
        // Incluye los puntos de los arcos (bulge), elipses y splines ya teselados.
        e.points.forEach(([x, y]) => extend(x, y));
      }
    });
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
    return { minX, minY, maxX, maxY };
  }

  // Requiere un `document` (navegador). No se usa en los tests de parseo puro.
  function renderDxfToCanvas(entities, targetMax) {
    const bounds = computeBounds(entities);
    if (!bounds) return null;
    const w = Math.max(bounds.maxX - bounds.minX, 1e-6);
    const h = Math.max(bounds.maxY - bounds.minY, 1e-6);
    const scale = targetMax / Math.max(w, h);
    const pad = 10;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * scale) + pad * 2;
    canvas.height = Math.ceil(h * scale) + pad * 2;
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#141414";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    function toCanvas(x, y) {
      return [(x - bounds.minX) * scale + pad, canvas.height - ((y - bounds.minY) * scale + pad)];
    }

    entities.forEach((e) => {
      if (e.type === "LINE") {
        if ([e.x1, e.y1, e.x2, e.y2].some((v) => isNaN(v))) return;
        const [x1, y1] = toCanvas(e.x1, e.y1);
        const [x2, y2] = toCanvas(e.x2, e.y2);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (e.type === "CIRCLE") {
        if ([e.cx, e.cy, e.r].some((v) => isNaN(v))) return;
        const [cx, cy] = toCanvas(e.cx, e.cy);
        ctx.beginPath();
        ctx.arc(cx, cy, e.r * scale, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.type === "ARC") {
        if ([e.cx, e.cy, e.r, e.startAngle, e.endAngle].some((v) => isNaN(v))) return;
        const [cx, cy] = toCanvas(e.cx, e.cy);
        const startRad = (-e.endAngle * Math.PI) / 180;
        const endRad = (-e.startAngle * Math.PI) / 180;
        ctx.beginPath();
        ctx.arc(cx, cy, e.r * scale, startRad, endRad);
        ctx.stroke();
      } else if (e.type === "LWPOLYLINE") {
        const pts = e.points.filter(([x, y]) => !isNaN(x) && !isNaN(y));
        if (pts.length < 2) return;
        ctx.beginPath();
        pts.forEach(([x, y], idx) => {
          const [cx, cy] = toCanvas(x, y);
          if (idx === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        });
        if (e.closed) ctx.closePath();
        ctx.stroke();
      }
    });

    return canvas;
  }

  return { parseDXF, parseDXFDetailed, computeBounds, renderDxfToCanvas, INSUNITS_TO_MM };
});
