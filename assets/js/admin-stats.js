(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const DESIGN_KINDS = { "placa-personalizada": true, "pua-personalizada": true };
  const isDesignOrder = (o) => !!DESIGN_KINDS[o && o.kind];
  const PAGE_LABELS = { inicio: "Inicio", placa: "Personaliza tu placa", pua: "Personaliza tus púas" };
  const STATUS_ORDER = ["pendiente", "confirmado", "enviado", "entregado", "cancelado"];
  const STATUS_LABELS = { pendiente: "Pendiente", confirmado: "Confirmado", enviado: "Enviado", entregado: "Entregado", cancelado: "Cancelado" };
  // Mismos tonos que las etiquetas de estado de la pestaña Pedidos (DESIGN.md): el color
  // identifica el estado, pero siempre va acompañado de su nombre.
  const STATUS_COLORS = { pendiente: "#c98a00", confirmado: "#4076AA", enviado: "#4a3592", entregado: "#1c7a3f", cancelado: "#b3261e" };

  const C = {
    primary: "#4076AA",
    primaryWash: "rgba(64,118,170,.10)",
    ink: "#1c2b36",
    text: "#33424c",
    muted: "#62727d",
    grid: "#eef2f5",
  };

  const DAY_MS = 24 * 60 * 60 * 1000;
  const charts = {};
  let analyticsDays = [];
  let visitsLoaded = false;
  let allOrders = null;
  let rangeDays = 30;
  let soldMetric = "units";

  document.addEventListener("DOMContentLoaded", () => {
    bindControls();
    if (!window.HA_FIREBASE_ENABLED) return;
    if (!firebase.apps.length) firebase.initializeApp(window.HA_FIREBASE_CONFIG);

    firebase.auth().onAuthStateChanged((user) => {
      if (user) {
        $("stats-login-notice").style.display = "none";
        $("stats-panel").style.display = "block";
        loadAnalyticsDaily();
      } else {
        $("stats-login-notice").style.display = "block";
        $("stats-panel").style.display = "none";
      }
    });

    if (window.HA_LATEST_ORDERS) onOrdersReady(window.HA_LATEST_ORDERS);
    window.addEventListener("ha-orders-updated", (e) => onOrdersReady(e.detail.orders));
  });

  function bindControls() {
    document.querySelectorAll(".stats-range button").forEach((btn) => {
      btn.addEventListener("click", () => {
        rangeDays = Number(btn.dataset.days) || 0;
        setActive(".stats-range button", btn);
        renderAll();
      });
    });
    document.querySelectorAll(".seg-toggle button").forEach((btn) => {
      btn.addEventListener("click", () => {
        soldMetric = btn.dataset.metric;
        setActive(".seg-toggle button", btn);
        if (allOrders) renderTopSold(currentRange());
      });
    });
  }

  function setActive(selector, activeBtn) {
    document.querySelectorAll(selector).forEach((b) => {
      b.classList.toggle("active", b === activeBtn);
      b.setAttribute("aria-pressed", b === activeBtn ? "true" : "false");
    });
  }

  /* ---------------- DATOS ---------------- */

  // Se cargan hasta 366 días de visitas para poder comparar 90 días con los 90 anteriores
  // y para la vista "Todo".
  async function loadAnalyticsDaily() {
    try {
      const db = firebase.firestore();
      const snap = await db
        .collection("analytics_daily")
        .orderBy(firebase.firestore.FieldPath.documentId(), "desc")
        .limit(366)
        .get();
      analyticsDays = snap.docs.map((d) => ({ date: d.id, ...d.data() })).reverse();
      $("stats-visits-notice").style.display = snap.empty ? "block" : "none";
    } catch (e) {
      console.error("No se pudieron cargar las estadísticas de visitas:", e);
      $("stats-visits-notice").style.display = "block";
    }
    visitsLoaded = true;
    renderAll();
  }

  function onOrdersReady(orders) {
    allOrders = orders || [];
    renderAll();
  }

  // Periodo seleccionado como claves de día [start, end] (ambas incluidas) y el periodo
  // anterior de la misma duración para las comparaciones. "Todo" empieza en el primer
  // pedido o la primera visita registrada y no tiene periodo anterior.
  function currentRange() {
    const today = startOfDay(new Date());
    const endKey = dateKeyFromDate(today);
    if (rangeDays > 0) {
      const start = new Date(today.getTime() - (rangeDays - 1) * DAY_MS);
      const prevEnd = new Date(start.getTime() - DAY_MS);
      const prevStart = new Date(prevEnd.getTime() - (rangeDays - 1) * DAY_MS);
      return {
        startKey: dateKeyFromDate(start),
        endKey,
        prevStartKey: dateKeyFromDate(prevStart),
        prevEndKey: dateKeyFromDate(prevEnd),
        label: `Últimos ${rangeDays} días · ${formatLongDate(start)} – ${formatLongDate(today)}`,
        compareLabel: `vs ${rangeDays} días anteriores`,
      };
    }
    const firstKeys = [];
    (allOrders || []).forEach((o) => o.createdAt && firstKeys.push(dateKeyFromIso(o.createdAt)));
    if (analyticsDays.length) firstKeys.push(analyticsDays[0].date);
    firstKeys.sort();
    const startKey = firstKeys[0] || endKey;
    return {
      startKey,
      endKey,
      prevStartKey: null,
      prevEndKey: null,
      label: `Todo el histórico · desde ${formatLongDate(parseKey(startKey))}`,
      compareLabel: "",
    };
  }

  const inKeyRange = (key, a, b) => !!key && !!a && key >= a && key <= b;

  function ordersIn(startKey, endKey) {
    return (allOrders || []).filter((o) => inKeyRange(dateKeyFromIso(o.createdAt), startKey, endKey));
  }

  function summarize(startKey, endKey) {
    const orders = ordersIn(startKey, endKey);
    const sales = orders.filter((o) => !isDesignOrder(o));
    const design = orders.filter(isDesignOrder);
    const billed = sales.filter((o) => o.status !== "cancelado");
    const revenue = billed.reduce((s, o) => s + orderTotal(o), 0);
    const visits = analyticsDays
      .filter((d) => inKeyRange(d.date, startKey, endKey))
      .reduce((s, d) => s + (Number(d.visits) || 0), 0);
    return {
      orders,
      sales,
      billed,
      revenue,
      salesCount: sales.length,
      designCount: design.length,
      avg: billed.length ? revenue / billed.length : 0,
      visits,
      conversion: visits ? ((sales.length + design.length) / visits) * 100 : null,
    };
  }

  /* ---------------- RENDER ---------------- */

  function renderAll() {
    if (!allOrders) return;
    const r = currentRange();
    $("stats-range-label").textContent = r.label;

    const cur = summarize(r.startKey, r.endKey);
    const prev = r.prevStartKey ? summarize(r.prevStartKey, r.prevEndKey) : null;

    $("stat-revenue").textContent = formatPrice(cur.revenue);
    $("stat-orders").textContent = formatInt(cur.salesCount);
    $("stat-avg").textContent = formatPrice(cur.avg);
    $("stat-design").textContent = formatInt(cur.designCount);
    $("stat-visits").textContent = visitsLoaded ? formatInt(cur.visits) : "…";
    $("stat-conversion").textContent = cur.conversion === null ? "-" : `${formatDecimal(cur.conversion)} %`;

    setDelta("delta-revenue", cur.revenue, prev && prev.revenue, r.compareLabel);
    setDelta("delta-orders", cur.salesCount, prev && prev.salesCount, r.compareLabel);
    setDelta("delta-avg", cur.avg, prev && prev.avg, r.compareLabel);
    const visitCompare = visitsLoaded ? r.compareLabel : "";
    setDelta("delta-visits", cur.visits, prev && prev.visits, visitCompare);
    setDelta("delta-conversion", cur.conversion, prev && prev.conversion, visitCompare, true);

    const buckets = buildBuckets(r.startKey, r.endKey);
    renderRevenue(buckets, cur.billed);
    renderSparks(buckets, cur);
    renderStatus(cur.sales);
    renderTopSold(r);
    renderTraffic(buckets, r);
  }

  // Si el periodo es largo (vista "Todo" con más de 92 días), la facturación se agrupa por
  // meses: 300 columnas de un píxel no se leen.
  function buildBuckets(startKey, endKey) {
    const start = parseKey(startKey);
    const end = parseKey(endKey);
    const spanDays = Math.round((end - start) / DAY_MS) + 1;
    const monthly = spanDays > 92;
    const list = [];
    const index = {};
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + DAY_MS)) {
      const dayKey = dateKeyFromDate(d);
      const key = monthly ? dayKey.slice(0, 7) : dayKey;
      if (!(key in index)) {
        index[key] = list.length;
        list.push({ key, date: new Date(d), revenue: 0, orders: 0, visits: 0 });
      }
    }
    return { monthly, list, find: (dayKey) => list[index[monthly ? dayKey.slice(0, 7) : dayKey]] };
  }

  function renderRevenue(buckets, billed) {
    billed.forEach((o) => {
      const b = buckets.find(dateKeyFromIso(o.createdAt));
      if (b) {
        b.revenue += orderTotal(o);
        b.orders += 1;
      }
    });
    const list = buckets.list;
    const total = list.reduce((s, b) => s + b.revenue, 0);
    const avg = list.length ? total / list.length : 0;
    const best = list.reduce((m, b) => (b.revenue > (m ? m.revenue : 0) ? b : m), null);
    const active = list.filter((b) => b.revenue > 0).length;
    const unit = buckets.monthly ? "mes" : "día";

    $("revenue-title").textContent = buckets.monthly ? "Facturación por mes" : "Facturación por día";
    $("revenue-avg-day").textContent = formatPrice(avg);
    $("revenue-avg-day").previousElementSibling.textContent = `Media por ${unit}`;
    $("revenue-best-day").previousElementSibling.textContent = `Mejor ${unit}`;
    $("revenue-best-day").textContent = best ? `${formatPrice(best.revenue)} · ${bucketLabel(best, buckets.monthly)}` : "-";
    $("revenue-active-days").previousElementSibling.textContent = buckets.monthly ? "Meses con ventas" : "Días con ventas";
    $("revenue-active-days").textContent = `${active} de ${list.length}`;

    upsertChart("chart-revenue", {
      type: "bar",
      data: {
        labels: list.map((b) => bucketTick(b, buckets.monthly)),
        datasets: [
          {
            label: "Facturación",
            data: list.map((b) => b.revenue),
            backgroundColor: C.primary,
            hoverBackgroundColor: "#245F96",
            borderRadius: { topLeft: 4, topRight: 4 },
            borderSkipped: "start",
            maxBarThickness: 24,
            categoryPercentage: 0.8,
            barPercentage: 0.9,
          },
        ],
      },
      options: {
        ...baseCartesian((v) => formatPriceShort(v)),
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle(),
            callbacks: {
              title: (items) => bucketLabel(list[items[0].dataIndex], buckets.monthly, true),
              label: (item) => `Facturación: ${formatPrice(item.raw)}`,
              afterLabel: (item) => {
                const n = list[item.dataIndex].orders;
                return `${n} ${n === 1 ? "pedido" : "pedidos"}`;
              },
            },
          },
          avgLine: { value: avg, label: `Media ${formatPrice(avg)}` },
        },
      },
      plugins: [avgLinePlugin],
    });
  }

  function renderSparks(buckets, cur) {
    const visitsByKey = {};
    analyticsDays.forEach((d) => (visitsByKey[d.date] = Number(d.visits) || 0));
    const ordersPerBucket = buckets.list.map(() => 0);
    const visitsPerBucket = buckets.list.map(() => 0);
    const idx = new Map(buckets.list.map((b, i) => [b, i]));
    cur.sales.forEach((o) => {
      const b = buckets.find(dateKeyFromIso(o.createdAt));
      if (b) ordersPerBucket[idx.get(b)] += 1;
    });
    Object.entries(visitsByKey).forEach(([k, v]) => {
      const b = buckets.find(k);
      if (b) visitsPerBucket[idx.get(b)] += v;
    });
    $("spark-revenue").innerHTML = sparkSvg(buckets.list.map((b) => b.revenue));
    $("spark-orders").innerHTML = sparkSvg(ordersPerBucket);
    $("spark-visits").innerHTML = visitsLoaded ? sparkSvg(visitsPerBucket) : "";
  }

  function renderStatus(sales) {
    const counts = {};
    const amounts = {};
    sales.forEach((o) => {
      const s = STATUS_LABELS[o.status] ? o.status : "pendiente";
      counts[s] = (counts[s] || 0) + 1;
      amounts[s] = (amounts[s] || 0) + orderTotal(o);
    });
    const total = sales.length;

    // "Por gestionar" se calcula sobre todos los pedidos, no solo los del periodo: un
    // pedido pendiente de hace tres meses sigue necesitando atención.
    const open = (allOrders || []).filter((o) => !isDesignOrder(o) && (!o.status || o.status === "pendiente" || o.status === "confirmado"));
    const todo = $("status-todo");
    if (open.length) {
      const pend = open.filter((o) => !o.status || o.status === "pendiente").length;
      todo.hidden = false;
      todo.innerHTML =
        `<b>${open.length}</b> ${open.length === 1 ? "pedido por gestionar" : "pedidos por gestionar"} ahora ` +
        `<span>(${pend} ${pend === 1 ? "pendiente" : "pendientes"}, ${open.length - pend} por enviar · ${formatPrice(open.reduce((s, o) => s + orderTotal(o), 0))})</span>`;
    } else {
      todo.hidden = true;
    }

    const bar = $("status-bar");
    const list = $("status-list");
    if (!total) {
      bar.innerHTML = "";
      bar.setAttribute("aria-label", "Sin pedidos en el periodo");
      list.innerHTML = `<li class="stats-empty">No hay pedidos en este periodo.</li>`;
      return;
    }
    const keys = STATUS_ORDER.filter((k) => counts[k]);
    bar.innerHTML = keys
      .map((k) => `<span style="flex:${counts[k]};background:${STATUS_COLORS[k]}" title="${STATUS_LABELS[k]}: ${counts[k]}"></span>`)
      .join("");
    bar.setAttribute("aria-label", keys.map((k) => `${STATUS_LABELS[k]} ${counts[k]}`).join(", "));
    list.innerHTML = STATUS_ORDER.map((k) => {
      const n = counts[k] || 0;
      const pct = Math.round((n / total) * 100);
      return `<li class="${n ? "" : "is-zero"}">
          <span class="status-dot" style="background:${STATUS_COLORS[k]}"></span>
          <span class="status-name">${STATUS_LABELS[k]}</span>
          <span class="status-amount">${n ? formatPrice(amounts[k]) : ""}</span>
          <span class="status-count"><b>${n}</b><small>${pct}&nbsp;%</small></span>
        </li>`;
    }).join("") + `<li class="status-total"><span class="status-name">Total</span><span class="status-count"><b>${total}</b></span></li>`;
  }

  function renderTopSold(r) {
    const totals = {};
    ordersIn(r.startKey, r.endKey)
      .filter((o) => !isDesignOrder(o) && o.status !== "cancelado")
      .forEach((o) => {
        (o.items || []).forEach((it) => {
          const key = it.id || it.title;
          if (!key) return;
          const row = totals[key] || (totals[key] = { label: it.title || key, image: it.image || "", units: 0, revenue: 0 });
          const qty = Number(it.qty) || 0;
          row.units += qty;
          row.revenue += (Number(it.price) || 0) * qty;
          if (!row.image && it.image) row.image = it.image;
        });
      });
    const byUnits = soldMetric === "units";
    $("top-sold-sub").textContent = byUnits ? "Por unidades, pedidos no cancelados" : "Por facturación, pedidos no cancelados";
    const rows = Object.values(totals)
      .sort((a, b) => (byUnits ? b.units - a.units || b.revenue - a.revenue : b.revenue - a.revenue || b.units - a.units))
      .slice(0, 10)
      .map((row) => ({
        label: row.label,
        image: row.image,
        value: byUnits ? row.units : row.revenue,
        display: byUnits ? `${row.units} ud.` : formatPrice(row.revenue),
        sub: byUnits ? formatPrice(row.revenue) : `${row.units} ud.`,
      }));
    renderRankList("top-sold-list", rows, "Todavía no hay ventas en este periodo.", true);
  }

  function renderTraffic(buckets, r) {
    const days = analyticsDays.filter((d) => inKeyRange(d.date, r.startKey, r.endKey));
    const byKey = {};
    days.forEach((d) => (byKey[d.date] = Number(d.visits) || 0));
    const list = buckets.list.map((b) => ({ ...b, visits: 0 }));
    const idx = new Map(buckets.list.map((b, i) => [b.key, i]));
    Object.entries(byKey).forEach(([k, v]) => {
      const i = idx.get(buckets.monthly ? k.slice(0, 7) : k);
      if (i !== undefined) list[i].visits += v;
    });

    upsertChart("chart-visits", {
      type: "line",
      data: {
        labels: list.map((b) => bucketTick(b, buckets.monthly)),
        datasets: [
          {
            label: "Visitas",
            data: list.map((b) => b.visits),
            borderColor: C.primary,
            backgroundColor: C.primaryWash,
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: C.primary,
            pointHoverBorderColor: "#fff",
            pointHoverBorderWidth: 2,
          },
        ],
      },
      options: {
        ...baseCartesian((v) => formatInt(v)),
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle(),
            callbacks: {
              title: (items) => bucketLabel(list[items[0].dataIndex], buckets.monthly, true),
              label: (item) => `${formatInt(item.raw)} visitas`,
            },
          },
        },
      },
      plugins: [crosshairPlugin],
    });

    const pageTotals = {};
    const viewTotals = {};
    const viewTitles = {};
    days.forEach((d) => {
      Object.entries(d.pages || {}).forEach(([k, v]) => (pageTotals[k] = (pageTotals[k] || 0) + (Number(v) || 0)));
      Object.entries(d.productViews || {}).forEach(([k, v]) => (viewTotals[k] = (viewTotals[k] || 0) + (Number(v) || 0)));
      Object.entries(d.productTitles || {}).forEach(([k, t]) => (viewTitles[k] = t));
    });
    const pageSum = Object.values(pageTotals).reduce((s, v) => s + v, 0);
    renderRankList(
      "pages-list",
      Object.entries(pageTotals)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ label: PAGE_LABELS[k] || k, value: v, display: formatInt(v), sub: `${Math.round((v / pageSum) * 100)} %` })),
      "Sin visitas registradas en este periodo."
    );
    renderRankList(
      "top-viewed-list",
      Object.entries(viewTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([id, v]) => ({ label: viewTitles[id] || id, value: v, display: `${formatInt(v)} vistas` })),
      "Sin vistas de producto en este periodo."
    );
  }

  /* ---------------- PIEZAS DE UI ---------------- */

  // Ranking en HTML en vez de barras de Chart.js: los nombres de producto son largos y así
  // se leen completos, con la barra proporcional debajo.
  function renderRankList(id, rows, emptyText, withImage) {
    const el = $(id);
    if (!rows.length) {
      el.innerHTML = `<li class="stats-empty">${emptyText}</li>`;
      return;
    }
    const max = Math.max(...rows.map((r) => r.value)) || 1;
    el.innerHTML = rows
      .map((r, i) => {
        const pct = Math.max(2, (r.value / max) * 100);
        const img = withImage
          ? r.image
            ? `<img class="rank-img" src="${escapeAttr(r.image)}" alt="" loading="lazy">`
            : `<span class="rank-img rank-img-empty"></span>`
          : "";
        return `<li class="rank-row${withImage ? " has-img" : ""}">
            <span class="rank-pos">${i + 1}</span>
            ${img}
            <div class="rank-main">
              <div class="rank-top">
                <span class="rank-name" title="${escapeAttr(r.label)}">${escapeHtml(r.label)}</span>
                <span class="rank-value">${r.display}${r.sub ? `<small>${r.sub}</small>` : ""}</span>
              </div>
              <div class="rank-track"><span style="width:${pct}%"></span></div>
            </div>
          </li>`;
      })
      .join("");
  }

  function setDelta(id, cur, prev, compareLabel, isPoints) {
    const el = $(id);
    if (!el) return;
    if (prev === null || prev === undefined || cur === null || cur === undefined || !compareLabel) {
      el.innerHTML = "";
      return;
    }
    let text;
    let dir;
    if (isPoints) {
      const diff = cur - prev;
      dir = Math.abs(diff) < 0.05 ? 0 : Math.sign(diff);
      text = `${diff > 0 ? "+" : ""}${formatDecimal(diff)} pp`;
    } else if (!prev) {
      dir = cur > 0 ? 1 : 0;
      text = cur > 0 ? "Nuevo" : "=";
    } else {
      const pct = ((cur - prev) / prev) * 100;
      dir = Math.abs(pct) < 0.5 ? 0 : Math.sign(pct);
      text = `${pct > 0 ? "+" : ""}${Math.round(pct)} %`;
    }
    const arrow = dir > 0 ? "▲" : dir < 0 ? "▼" : "•";
    el.className = `kpi-delta ${dir > 0 ? "is-up" : dir < 0 ? "is-down" : "is-flat"}`;
    el.innerHTML = `<span>${arrow} ${text}</span> ${compareLabel}`;
  }

  function sparkSvg(values) {
    if (!values.length) return "";
    const w = 120;
    const h = 32;
    const max = Math.max(...values) || 1;
    const step = values.length > 1 ? w / (values.length - 1) : 0;
    const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 6)]);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${d}L${w},${h}L0,${h}Z" fill="${C.primaryWash}"/>
        <path d="${d}" fill="none" stroke="${C.primary}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg>`;
  }

  /* ---------------- CHART.JS: helpers comunes ---------------- */

  function upsertChart(canvasId, config) {
    if (typeof Chart === "undefined") return;
    const el = $(canvasId);
    if (!el) return;
    if (charts[canvasId]) charts[canvasId].destroy();
    charts[canvasId] = new Chart(el.getContext("2d"), config);
  }

  function baseCartesian(tickFormatter) {
    const font = { family: "Inter, system-ui, sans-serif", size: 11 };
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      scales: {
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: C.grid, drawTicks: false },
          ticks: { color: C.muted, font, padding: 8, maxTicksLimit: 5, precision: 0, callback: (v) => tickFormatter(v) },
        },
        x: {
          border: { color: "#e1e8ed" },
          grid: { display: false },
          ticks: { color: C.muted, font, maxRotation: 0, autoSkip: true, autoSkipPadding: 12 },
        },
      },
    };
  }

  function tooltipStyle() {
    return {
      backgroundColor: "#fff",
      titleColor: C.ink,
      bodyColor: C.text,
      footerColor: C.muted,
      borderColor: "#e1e8ed",
      borderWidth: 1,
      padding: 10,
      cornerRadius: 8,
      displayColors: false,
      titleFont: { family: "Inter, system-ui, sans-serif", weight: "600", size: 12 },
      bodyFont: { family: "Inter, system-ui, sans-serif", size: 12 },
      caretSize: 5,
    };
  }

  // Línea de referencia con la media del periodo, con su etiqueta al final.
  const avgLinePlugin = {
    id: "avgLine",
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts || !opts.value) return;
      const y = chart.scales.y.getPixelForValue(opts.value);
      const { left, right } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = C.muted;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      const tw = ctx.measureText(opts.label).width;
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.fillRect(right - tw - 8, y - 17, tw + 8, 15);
      ctx.fillStyle = C.text;
      ctx.textAlign = "right";
      ctx.fillText(opts.label, right - 4, y - 5);
      ctx.restore();
    },
  };

  // Línea vertical fina en el punto activo del gráfico de visitas.
  const crosshairPlugin = {
    id: "crosshair",
    afterDatasetsDraw(chart) {
      const active = chart.tooltip && chart.tooltip.getActiveElements();
      if (!active || !active.length) return;
      const x = active[0].element.x;
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = "#c9d4db";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  /* ---------------- FORMATO Y FECHAS ---------------- */

  function bucketTick(b, monthly) {
    if (monthly) return b.date.toLocaleDateString("es-ES", { month: "short", year: "2-digit" });
    return `${b.date.getDate()}/${b.date.getMonth() + 1}`;
  }

  function bucketLabel(b, monthly, long) {
    if (!b) return "";
    if (monthly) return b.date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    return b.date.toLocaleDateString("es-ES", long ? { weekday: "long", day: "numeric", month: "long" } : { day: "numeric", month: "short" });
  }

  function formatLongDate(d) {
    return d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function parseKey(key) {
    const [y, m, d] = String(key).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function dateKeyFromDate(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function dateKeyFromIso(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? "" : dateKeyFromDate(d);
  }

  function orderTotal(o) {
    if (typeof o.total === "number") return o.total;
    return (Number(o.subtotal) || 0) + (Number(o.shippingCost) || 0);
  }

  function formatPrice(n) {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
  }

  function formatPriceShort(n) {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
  }

  function formatInt(n) {
    return new Intl.NumberFormat("es-ES").format(Math.round(n || 0));
  }

  function formatDecimal(n) {
    return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n || 0);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  const escapeAttr = escapeHtml;
})();
