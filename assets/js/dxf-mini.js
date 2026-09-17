(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HA_DXF = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

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

  function getVal(pairs, code) {
    for (const [c, v] of pairs) if (c === code) return v;
    return undefined;
  }
  function getAll(pairs, code) {
    return pairs.filter(([c]) => c === code).map(([, v]) => v);
  }

  function buildEntities(records) {
    const entities = [];
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
        const xs = getAll(rec.pairs, 10).map(parseFloat);
        const ys = getAll(rec.pairs, 20).map(parseFloat);
        const flags = parseInt(getVal(rec.pairs, 70) || "0", 10);
        const points = xs.map((x, idx) => [x, ys[idx]]);
        entities.push({ type: "LWPOLYLINE", points, closed: (flags & 1) === 1 });
        i++;
      } else if (rec.type === "POLYLINE") {
        const flags = parseInt(getVal(rec.pairs, 70) || "0", 10);
        const points = [];
        let j = i + 1;
        while (j < records.length && records[j].type === "VERTEX") {
          const vx = parseFloat(getVal(records[j].pairs, 10));
          const vy = parseFloat(getVal(records[j].pairs, 20));
          if (!isNaN(vx) && !isNaN(vy)) points.push([vx, vy]);
          j++;
        }
        if (j < records.length && records[j].type === "SEQEND") j++;
        entities.push({ type: "LWPOLYLINE", points, closed: (flags & 1) === 1 });
        i = j;
      } else {
        i++;
      }
    }
    return entities;
  }

  function parseDXF(text) {
    const pairs = parseDxfPairs(text);
    const records = splitIntoRecords(pairs);
    const entityRecords = extractEntitiesSection(records);
    return buildEntities(entityRecords);
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

  return { parseDXF, computeBounds, renderDxfToCanvas };
});
