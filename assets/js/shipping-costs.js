(function () {
  "use strict";

  // Gastos de envío con Correos: convierte el Excel de control de facturas
  // (hojas «Envios» y «Resumen», plantilla Control_envios_Correos_Hezur_Adar.xlsx) en
  // envíos con su coste, y los resume por periodo, zona y destino. Lógica pura, sin DOM,
  // para poder probarla con Node (tests/shipping-costs.test.js). La pantalla vive en
  // admin-shipping.js.
  //
  // Los importes se recalculan siempre igual que las fórmulas de la plantilla, porque
  // Excel no siempre guarda el valor calculado de una fórmula (y entonces se lee 0):
  //   neto        = bruto - descuento
  //   combustible = neto / suma de netos × suplemento de combustible de la factura
  //   base        = neto + combustible
  //   IVA         = redondeo(base × tipo de IVA, 2)
  //   coste final = base + IVA

  const DEFAULT_VAT_RATE = 0.21;
  const MAX_ROWS = 2000;
  const MAX_TEXT = 200;
  // Diferencia admitida entre la suma de los envíos y el total de la factura (redondeos).
  const INVOICE_TOLERANCE = 0.05;

  const MONTHS = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  };

  // Columnas de la hoja Envios: se reconocen por el texto de la cabecera, no por su
  // posición, para que añadir o mover columnas en el Excel no rompa la importación.
  const COLUMNS = {
    date: ["fecha"],
    tracking: ["seguimiento", "tracking"],
    destination: ["destino", "provincia"],
    zone: ["zona"],
    weight: ["peso"],
    tier: ["tramo"],
    service: ["servicio", "producto"],
    gross: ["bruto"],
    discount: ["descuento"],
    orderRef: ["cliente", "pedido"],
    notes: ["observaciones", "notas"],
  };

  // Etiquetas de la hoja Resumen (columna A) -> campo de la factura.
  const SUMMARY_LABELS = {
    period: ["periodo"],
    fuel: ["combustible"],
    base: ["base imponible"],
    vatRate: ["tipo iva"],
    vat: ["iva factura"],
    total: ["total factura"],
  };

  function normalizeText(s) {
    return String(s == null ? "" : s)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanText(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;
  }

  // Número del Excel o texto con coma decimal («6,37 €»). Devuelve null si no lo es.
  function toNumber(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    const s = String(v == null ? "" : v).replace(/[€\s]/g, "");
    if (!s) return null;
    const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
    const n = Number(normalized);
    return isFinite(n) ? n : null;
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function isoDate(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  // «08/10/2026», «8-10-26», «2026-10-08» o número de serie de Excel -> «2026-10-08».
  function toIsoDate(v) {
    if (typeof v === "number" && v > 20000 && v < 80000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
      return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
    const s = String(v == null ? "" : v).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
    if (m) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return isoDate(y, Number(m[2]), Number(m[1]));
    }
    return null;
  }

  // «Octubre 2026» -> «2026-10»; null si el texto no es un mes reconocible.
  function periodMonth(text) {
    const n = normalizeText(text);
    const year = /(\d{4})/.exec(n);
    const month = Object.keys(MONTHS).find((name) => n.includes(name));
    return year && month ? `${year[1]}-${pad2(MONTHS[month])}` : null;
  }

  function findSheet(sheets, wanted) {
    const key = Object.keys(sheets || {}).find((name) => normalizeText(name) === wanted);
    return key ? sheets[key] : null;
  }

  function mapColumns(header) {
    const map = {};
    header.forEach((cell, idx) => {
      const h = normalizeText(cell);
      if (!h) return;
      Object.keys(COLUMNS).forEach((field) => {
        if (map[field] == null && COLUMNS[field].some((word) => h.includes(word))) map[field] = idx;
      });
    });
    return map;
  }

  function parseSummary(rows) {
    const out = {};
    (rows || []).forEach((row) => {
      const label = normalizeText(row && row[0]);
      if (!label) return;
      Object.keys(SUMMARY_LABELS).forEach((field) => {
        if (out[field] != null) return;
        if (!SUMMARY_LABELS[field].some((word) => label.includes(word))) return;
        out[field] = field === "period" ? cleanText(row[1]) : toNumber(row[1]);
      });
    });
    return out;
  }

  function cell(row, idx) {
    return idx == null || !row ? null : row[idx];
  }

  // Lee las filas de la hoja Envios. Devuelve los envíos (aún sin combustible ni IVA)
  // y los avisos de las filas que no se han podido leer.
  function parseShipmentRows(rows) {
    const errors = [];
    const headerIdx = rows.findIndex((r) => (r || []).some((c) => normalizeText(c).includes("seguimiento")));
    if (headerIdx < 0) {
      return { items: [], errors: ["No se encuentra la cabecera «Nº seguimiento» en la hoja Envios."] };
    }
    const cols = mapColumns(rows[headerIdx]);
    ["date", "gross", "discount"].forEach((field) => {
      if (cols[field] == null) errors.push(`Falta la columna «${COLUMNS[field][0]}» en la hoja Envios.`);
    });
    if (errors.length) return { items: [], errors };

    const items = [];
    const seen = new Set();
    rows.slice(headerIdx + 1, headerIdx + 1 + MAX_ROWS).forEach((row, i) => {
      const line = headerIdx + i + 2;
      const tracking = cleanText(cell(row, cols.tracking)).replace(/\s/g, "").toUpperCase();
      if (!tracking) return;
      const date = toIsoDate(cell(row, cols.date));
      const gross = toNumber(cell(row, cols.gross));
      const discount = toNumber(cell(row, cols.discount)) || 0;
      if (!date) return errors.push(`Fila ${line} (${tracking}): fecha no válida.`);
      if (gross == null || gross < 0 || discount < 0 || discount > gross) {
        return errors.push(`Fila ${line} (${tracking}): importes no válidos.`);
      }
      if (seen.has(tracking)) return errors.push(`Fila ${line}: el envío ${tracking} está repetido.`);
      seen.add(tracking);
      items.push({
        date,
        tracking,
        destination: cleanText(cell(row, cols.destination)),
        zone: cleanText(cell(row, cols.zone)).toUpperCase(),
        weight: cleanText(cell(row, cols.weight)),
        tier: cleanText(cell(row, cols.tier)),
        service: cleanText(cell(row, cols.service)),
        gross,
        discount,
        orderRef: cleanText(cell(row, cols.orderRef)),
        notes: cleanText(cell(row, cols.notes)),
      });
    });
    return { items, errors };
  }

  // Reparte el combustible en proporción al neto y calcula IVA y coste final.
  function computeCosts(items, fuel, vatRate) {
    const nets = items.map((s) => s.gross - s.discount);
    const netSum = nets.reduce((a, b) => a + b, 0);
    return items.map((s, i) => {
      const net = nets[i];
      const fuelShare = netSum > 0 ? (net / netSum) * fuel : 0;
      const base = net + fuelShare;
      const vat = round2(base * vatRate);
      return Object.assign({}, s, {
        net: round2(net),
        fuel: round2(fuelShare),
        base: round2(base),
        vat,
        total: round2(base + vat),
      });
    });
  }

  // Reparte entre los envíos los céntimos de diferencia con el total de la factura (el IVA
  // de la factura se redondea sobre el total y el de cada envío por separado), de uno en
  // uno empezando por los de mayor base. Solo si la diferencia es de redondeo.
  function reconcileCents(shipments, targetTotal) {
    const diffCents = Math.round((targetTotal - sumField(shipments, "total")) * 100);
    if (!diffCents || Math.abs(diffCents) > INVOICE_TOLERANCE * 100 || !shipments.length) return shipments;
    const step = diffCents > 0 ? 0.01 : -0.01;
    const order = shipments.map((s, i) => i).sort((a, b) => shipments[b].base - shipments[a].base);
    const out = shipments.map((s) => Object.assign({}, s));
    for (let n = 0; n < Math.abs(diffCents); n++) {
      const s = out[order[n % order.length]];
      s.vat = round2(s.vat + step);
      s.total = round2(s.total + step);
    }
    return out;
  }

  function monthOf(isoDay) {
    return String(isoDay || "").slice(0, 7);
  }

  function sumField(list, field) {
    return round2(list.reduce((a, s) => a + (Number(s[field]) || 0), 0));
  }

  function buildInvoice(id, period, shipments, summary, fuel, vatRate) {
    const dates = shipments.map((s) => s.date).sort();
    const computedTotal = sumField(shipments, "total");
    return {
      id,
      period: period || id,
      fromDate: dates[0],
      toDate: dates[dates.length - 1],
      count: shipments.length,
      gross: sumField(shipments, "gross"),
      discount: sumField(shipments, "discount"),
      fuel: round2(fuel),
      vatRate,
      base: summary.base > 0 ? round2(summary.base) : sumField(shipments, "base"),
      vat: summary.vat > 0 ? round2(summary.vat) : sumField(shipments, "vat"),
      total: summary.total > 0 ? round2(summary.total) : computedTotal,
      computedTotal,
    };
  }

  // Interpreta el libro leído con HA_XLSX.readWorkbook().
  // Devuelve { invoice, shipments, errors, warnings }.
  function parseWorkbook(workbook) {
    const sheets = (workbook && workbook.sheets) || {};
    const envios = findSheet(sheets, "envios");
    if (!envios) {
      return { invoice: null, shipments: [], errors: ["El Excel no tiene la hoja «Envios»."], warnings: [] };
    }
    const summary = parseSummary(findSheet(sheets, "resumen"));
    const parsed = parseShipmentRows(envios);
    const warnings = [];
    if (!parsed.items.length) {
      const errors = parsed.errors.length ? parsed.errors : ["La hoja Envios no tiene envíos."];
      return { invoice: null, shipments: [], errors, warnings };
    }

    const fuel = summary.fuel > 0 ? summary.fuel : 0;
    const vatRate = summary.vatRate > 0 && summary.vatRate < 1 ? summary.vatRate : DEFAULT_VAT_RATE;
    if (!(summary.vatRate > 0)) warnings.push("No se encuentra el tipo de IVA en la hoja Resumen: se usa el 21 %.");

    const firstDate = parsed.items.map((s) => s.date).sort()[0];
    const id = periodMonth(summary.period) || monthOf(firstDate);
    let shipments = computeCosts(parsed.items, fuel, vatRate).map((s) => Object.assign(s, { invoiceId: id }));
    if (summary.total > 0) shipments = reconcileCents(shipments, round2(summary.total));
    const invoice = buildInvoice(id, summary.period, shipments, summary, fuel, vatRate);
    if (Math.abs(invoice.total - invoice.computedTotal) > INVOICE_TOLERANCE) {
      warnings.push(
        `La suma de los envíos (${invoice.computedTotal.toFixed(2)} €) no cuadra con el total de la factura (${invoice.total.toFixed(2)} €).`
      );
    }
    return { invoice, shipments, errors: parsed.errors, warnings };
  }

  // Envíos con fecha dentro de [from, to] («AAAA-MM-DD», cualquiera de los dos vacío).
  function filterByRange(shipments, from, to) {
    return (shipments || []).filter((s) => (!from || s.date >= from) && (!to || s.date <= to));
  }

  function groupBy(shipments, keyFn) {
    const groups = new Map();
    shipments.forEach((s) => {
      const key = keyFn(s) || "Sin dato";
      const g = groups.get(key) || { key, count: 0, total: 0, net: 0 };
      groups.set(key, { key, count: g.count + 1, total: g.total + (s.total || 0), net: g.net + (s.net || 0) });
    });
    return Array.from(groups.values())
      .map((g) => ({ key: g.key, count: g.count, total: round2(g.total), net: round2(g.net), avg: round2(g.total / g.count) }))
      .sort((a, b) => b.total - a.total || b.count - a.count || a.key.localeCompare(b.key, "es"));
  }

  // Totales y desgloses de una lista de envíos (ya filtrada por fechas).
  function summarize(shipments) {
    const list = shipments || [];
    const total = sumField(list, "total");
    return {
      count: list.length,
      gross: sumField(list, "gross"),
      discount: sumField(list, "discount"),
      net: sumField(list, "net"),
      fuel: sumField(list, "fuel"),
      vat: sumField(list, "vat"),
      total,
      avg: list.length ? round2(total / list.length) : 0,
      byZone: groupBy(list, (s) => s.zone),
      byDestination: groupBy(list, (s) => s.destination),
      byTier: groupBy(list, (s) => s.tier || s.weight),
      byMonth: groupBy(list, (s) => monthOf(s.date)).sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  // Id de documento de Firestore para un envío: el nº de seguimiento, así reimportar la
  // misma factura actualiza los envíos en vez de duplicarlos.
  function docIdFor(tracking) {
    return String(tracking || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 100);
  }

  // Nº de seguimiento -> pedido de la tienda que lo lleva (campo trackingNumber).
  function ordersByTracking(orders) {
    const map = new Map();
    (orders || []).forEach((o) => {
      const t = docIdFor(o && o.trackingNumber);
      if (t) map.set(t, o);
    });
    return map;
  }

  window.HA_SHIPPING = {
    parseWorkbook,
    computeCosts,
    filterByRange,
    summarize,
    docIdFor,
    ordersByTracking,
    toIsoDate,
    toNumber,
    periodMonth,
    round2,
    INVOICE_TOLERANCE,
  };
})();
