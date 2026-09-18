(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const DESIGN_KINDS = { "placa-personalizada": true, "pua-personalizada": true };
  const isDesignOrder = (o) => !!DESIGN_KINDS[o && o.kind];
  const PAGE_LABELS = { inicio: "Inicio", placa: "Personaliza tu placa", pua: "Personaliza tus púas" };
  const STATUS_LABELS = { pendiente: "Pendiente", confirmado: "Confirmado", enviado: "Enviado", entregado: "Entregado", cancelado: "Cancelado" };
  const STATUS_COLORS = { pendiente: "#e6a53a", confirmado: "#4581B9", enviado: "#8e5fd1", entregado: "#2fa860", cancelado: "#c0392b" };
  const PALETTE = ["#4581B9", "#245F96", "#8e5fd1", "#2fa860", "#e6a53a", "#c0392b", "#3aa5a5", "#c15fae", "#7a8b96", "#b08d57"];

  const charts = {};
  let analyticsDays = [];
  let totalVisits30d = null;
  let ordersCount30d = null;
  let designCount30d = null;

  document.addEventListener("DOMContentLoaded", () => {
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

  /* ---------------- VISITAS (Firestore: analytics_daily) ---------------- */

  async function loadAnalyticsDaily() {
    try {
      const db = firebase.firestore();
      const snap = await db
        .collection("analytics_daily")
        .orderBy(firebase.firestore.FieldPath.documentId(), "desc")
        .limit(30)
        .get();
      analyticsDays = snap.docs.map((d) => ({ date: d.id, ...d.data() })).reverse();
      $("stats-visits-notice").style.display = snap.empty ? "block" : "none";
      renderVisitCharts();
    } catch (e) {
      console.error("No se pudieron cargar las estadísticas de visitas:", e);
      $("stats-visits-notice").style.display = "block";
    }
  }

  function renderVisitCharts() {
    totalVisits30d = analyticsDays.reduce((s, d) => s + (Number(d.visits) || 0), 0);
    $("stat-visits").textContent = totalVisits30d;
    maybeRenderConversion();

    upsertChart("chart-visits", {
      type: "line",
      data: {
        labels: analyticsDays.map((d) => formatDayLabel(d.date)),
        datasets: [
          {
            label: "Visitas",
            data: analyticsDays.map((d) => Number(d.visits) || 0),
            borderColor: "#4581B9",
            backgroundColor: "rgba(69,129,185,.15)",
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: baseLineOptions(),
    });

    const pageTotals = {};
    analyticsDays.forEach((d) => {
      Object.entries(d.pages || {}).forEach(([k, v]) => {
        pageTotals[k] = (pageTotals[k] || 0) + (Number(v) || 0);
      });
    });
    const pageKeys = Object.keys(pageTotals).filter((k) => pageTotals[k] > 0);
    upsertChart("chart-pages", {
      type: "doughnut",
      data: {
        labels: pageKeys.length ? pageKeys.map((k) => PAGE_LABELS[k] || k) : ["Sin datos"],
        datasets: [
          {
            data: pageKeys.length ? pageKeys.map((k) => pageTotals[k]) : [1],
            backgroundColor: pageKeys.length ? pageKeys.map((_, i) => PALETTE[i % PALETTE.length]) : ["#e1e8ed"],
          },
        ],
      },
      options: baseDoughnutOptions(),
    });

    const viewTotals = {};
    const viewTitles = {};
    analyticsDays.forEach((d) => {
      Object.entries(d.productViews || {}).forEach(([k, v]) => {
        viewTotals[k] = (viewTotals[k] || 0) + (Number(v) || 0);
      });
      Object.entries(d.productTitles || {}).forEach(([k, title]) => {
        viewTitles[k] = title;
      });
    });
    const topViewed = Object.entries(viewTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    upsertChart("chart-top-viewed", {
      type: "bar",
      data: {
        labels: topViewed.length ? topViewed.map(([id]) => viewTitles[id] || id) : ["Sin datos"],
        datasets: [
          {
            label: "Vistas",
            data: topViewed.length ? topViewed.map(([, v]) => v) : [0],
            backgroundColor: "#245F96",
          },
        ],
      },
      options: baseHBarOptions(),
    });
  }

  function formatDayLabel(dateKey) {
    const parts = String(dateKey).split("-");
    if (parts.length !== 3) return dateKey;
    return `${parts[2]}/${parts[1]}`;
  }

  /* ---------------- PEDIDOS (reutiliza los pedidos ya cargados por admin-orders.js) ---------------- */

  function onOrdersReady(orders) {
    const list = orders || [];
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const within30d = (o) => {
      const t = o.createdAt ? new Date(o.createdAt).getTime() : NaN;
      return !isNaN(t) && now - t <= THIRTY_DAYS;
    };

    const last30 = list.filter(within30d);
    const salesLast30 = last30.filter((o) => !isDesignOrder(o));
    const designLast30 = last30.filter(isDesignOrder);
    const billedLast30 = salesLast30.filter((o) => o.status !== "cancelado");

    ordersCount30d = salesLast30.length + designLast30.length;
    designCount30d = designLast30.length;

    const revenue30d = billedLast30.reduce((s, o) => s + orderTotal(o), 0);
    $("stat-orders").textContent = salesLast30.length;
    $("stat-design").textContent = designLast30.length;
    $("stat-revenue").textContent = formatPrice(revenue30d);
    $("stat-avg").textContent = formatPrice(billedLast30.length ? revenue30d / billedLast30.length : 0);
    maybeRenderConversion();

    // Facturación por día: se agrupan los mismos 30 días que muestra el gráfico de visitas,
    // o los últimos 30 días naturales si todavía no hay datos de visitas.
    const days = analyticsDays.length ? analyticsDays.map((d) => d.date) : lastNDateKeys(30);
    const revenueByDay = {};
    days.forEach((d) => (revenueByDay[d] = 0));
    billedLast30.forEach((o) => {
      const key = dateKeyFromIso(o.createdAt);
      if (key in revenueByDay) revenueByDay[key] += orderTotal(o);
    });
    upsertChart("chart-revenue", {
      type: "line",
      data: {
        labels: days.map(formatDayLabel),
        datasets: [
          {
            label: "Facturación",
            data: days.map((d) => revenueByDay[d] || 0),
            borderColor: "#2fa860",
            backgroundColor: "rgba(47,168,96,.15)",
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: baseLineOptions((v) => formatPrice(v)),
    });

    // Pedidos por estado: sobre todos los pedidos (no solo los últimos 30 días), para ver
    // de un vistazo el estado actual de todo el negocio.
    const statusCounts = {};
    list
      .filter((o) => !isDesignOrder(o))
      .forEach((o) => {
        const s = o.status || "pendiente";
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      });
    const statusKeys = Object.keys(STATUS_LABELS).filter((k) => statusCounts[k] > 0);
    upsertChart("chart-status", {
      type: "doughnut",
      data: {
        labels: statusKeys.length ? statusKeys.map((k) => STATUS_LABELS[k]) : ["Sin pedidos"],
        datasets: [
          {
            data: statusKeys.length ? statusKeys.map((k) => statusCounts[k]) : [1],
            backgroundColor: statusKeys.length ? statusKeys.map((k) => STATUS_COLORS[k]) : ["#e1e8ed"],
          },
        ],
      },
      options: baseDoughnutOptions(),
    });

    // Productos más vendidos (por unidades), sobre el histórico completo de pedidos no
    // cancelados: es la clasificación que interesa para decidir qué reponer o destacar.
    const soldTotals = {};
    const soldTitles = {};
    list
      .filter((o) => !isDesignOrder(o) && o.status !== "cancelado")
      .forEach((o) => {
        (o.items || []).forEach((it) => {
          const key = it.id || it.title;
          if (!key) return;
          soldTotals[key] = (soldTotals[key] || 0) + (Number(it.qty) || 0);
          soldTitles[key] = it.title || key;
        });
      });
    const topSold = Object.entries(soldTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    upsertChart("chart-top-sold", {
      type: "bar",
      data: {
        labels: topSold.length ? topSold.map(([id]) => soldTitles[id] || id) : ["Sin datos"],
        datasets: [
          {
            label: "Unidades vendidas",
            data: topSold.length ? topSold.map(([, v]) => v) : [0],
            backgroundColor: "#2fa860",
          },
        ],
      },
      options: baseHBarOptions(),
    });
  }

  function maybeRenderConversion() {
    const el = $("stat-conversion");
    if (totalVisits30d === null || ordersCount30d === null) return;
    if (!totalVisits30d) {
      el.textContent = "-";
      return;
    }
    el.textContent = `${((ordersCount30d / totalVisits30d) * 100).toFixed(1)}%`;
  }

  function lastNDateKeys(n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push(dateKeyFromDate(d));
    }
    return out;
  }

  function dateKeyFromDate(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function dateKeyFromIso(iso) {
    if (!iso) return "";
    return dateKeyFromDate(new Date(iso));
  }

  function orderTotal(o) {
    if (typeof o.total === "number") return o.total;
    return (Number(o.subtotal) || 0) + (Number(o.shippingCost) || 0);
  }

  function formatPrice(n) {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
  }

  /* ---------------- CHART.JS: helpers comunes ---------------- */

  function upsertChart(canvasId, config) {
    if (typeof Chart === "undefined") return;
    const el = $(canvasId);
    if (!el) return;
    if (charts[canvasId]) charts[canvasId].destroy();
    charts[canvasId] = new Chart(el.getContext("2d"), config);
  }

  function baseLineOptions(tickFormatter) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: tickFormatter ? { callback: (v) => tickFormatter(v) } : {} },
        x: { grid: { display: false } },
      },
    };
  }

  function baseDoughnutOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, padding: 10 } } },
    };
  }

  function baseHBarOptions() {
    return {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    };
  }
})();
