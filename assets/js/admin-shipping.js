(function () {
  "use strict";

  // Pestaña «Envíos» del panel: importa el Excel de control de facturas de Correos,
  // guarda los envíos en Firestore y muestra el gasto por periodo, zona, destino y tramo
  // de peso. Los cálculos viven en shipping-costs.js (HA_SHIPPING) y la lectura del Excel
  // en xlsx-mini.js (HA_XLSX).
  //
  // Colecciones (solo administradores, ver firestore.rules):
  //   shipping_costs/{nº seguimiento}  un documento por envío
  //   shipping_invoices/{AAAA-MM}      resumen de cada factura importada
  //
  // Publica los envíos en window.HA_LATEST_SHIPMENTS y el evento «ha-shipments-updated»
  // para que la pestaña Pedidos sume el gasto de envíos en su filtro de fechas.

  const SHIP = window.HA_SHIPPING;
  const XLSX = window.HA_XLSX;
  const COSTS = "shipping_costs";
  const INVOICES = "shipping_invoices";
  const BATCH_LIMIT = 450;
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const CORREOS_TRACKING_URL = "https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=";

  const $ = (id) => document.getElementById(id);

  let shipments = [];
  let invoices = [];
  let orders = [];
  let pending = null;
  let unsubs = [];

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("tab-shipping")) return;
    bindControls();
    if (!window.HA_FIREBASE_ENABLED || !SHIP || !XLSX) return;
    if (!firebase.apps.length) firebase.initializeApp(window.HA_FIREBASE_CONFIG);

    const watchAuth = () =>
      firebase.auth().onAuthStateChanged((user) => {
        $("shipping-login-notice").style.display = user ? "none" : "block";
        $("shipping-panel").style.display = user ? "block" : "none";
        if (user) subscribe();
        else stop();
      });
    // Igual que en admin-orders.js: nada de datos hasta iniciar sesión en el panel.
    if (window.HA_ADMIN_UNLOCKED) watchAuth();
    else window.addEventListener("ha-admin-unlocked", watchAuth, { once: true });

    if (window.HA_LATEST_ORDERS) orders = window.HA_LATEST_ORDERS;
    window.addEventListener("ha-orders-updated", (e) => {
      orders = (e.detail && e.detail.orders) || [];
      render();
    });
  });

  function bindControls() {
    $("ship-file").addEventListener("change", onFileChosen);
    $("ship-save").addEventListener("click", savePending);
    $("ship-discard").addEventListener("click", discardPending);
    ["ship-from", "ship-to", "ship-invoice"].forEach((id) => $(id).addEventListener("change", render));
    $("ship-clear-range").addEventListener("click", () => {
      $("ship-from").value = "";
      $("ship-to").value = "";
      $("ship-invoice").value = "";
      render();
    });
    $("ship-invoices-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-delete-invoice]");
      if (btn) deleteInvoice(btn.dataset.deleteInvoice);
      const view = e.target.closest("[data-view-invoice]");
      if (view) {
        $("ship-invoice").value = view.dataset.viewInvoice;
        render();
      }
    });
  }

  /* ---------------- Firestore ---------------- */

  function subscribe() {
    stop();
    const db = firebase.firestore();
    unsubs.push(
      db.collection(COSTS).onSnapshot(
        (snap) => {
          shipments = snap.docs.map((d) => normalizeShipment(d.data())).filter(Boolean);
          shipments.sort((a, b) => b.date.localeCompare(a.date) || a.tracking.localeCompare(b.tracking));
          window.HA_LATEST_SHIPMENTS = shipments;
          window.dispatchEvent(new CustomEvent("ha-shipments-updated", { detail: { shipments } }));
          setStatus("ship-list-status", "", "");
          render();
        },
        (err) => setStatus("ship-list-status", "err", "Error leyendo los envíos: " + errText(err))
      )
    );
    unsubs.push(
      db.collection(INVOICES).onSnapshot(
        (snap) => {
          invoices = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
          invoices.sort((a, b) => String(b.id).localeCompare(String(a.id)));
          renderInvoiceOptions();
          render();
        },
        (err) => setStatus("ship-list-status", "err", "Error leyendo las facturas: " + errText(err))
      )
    );
  }

  function stop() {
    unsubs.forEach((u) => u());
    unsubs = [];
    shipments = [];
    invoices = [];
    window.HA_LATEST_SHIPMENTS = [];
    window.dispatchEvent(new CustomEvent("ha-shipments-updated", { detail: { shipments: [] } }));
  }

  // Fuerza tipos al leer: un documento a medias no debe romper la pantalla.
  function normalizeShipment(d) {
    if (!d || typeof d.tracking !== "string" || typeof d.date !== "string") return null;
    const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
    const str = (v) => (typeof v === "string" ? v : "");
    return {
      date: d.date,
      tracking: d.tracking,
      destination: str(d.destination),
      zone: str(d.zone),
      weight: str(d.weight),
      tier: str(d.tier),
      service: str(d.service),
      orderRef: str(d.orderRef),
      notes: str(d.notes),
      invoiceId: str(d.invoiceId),
      gross: num(d.gross),
      discount: num(d.discount),
      net: num(d.net),
      fuel: num(d.fuel),
      base: num(d.base),
      vat: num(d.vat),
      total: num(d.total),
    };
  }

  // Ejecuta las escrituras en lotes (Firestore admite hasta 500 por lote).
  async function commitInChunks(ops) {
    const db = firebase.firestore();
    for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(batch, db));
      await batch.commit();
    }
  }

  /* ---------------- Importación ---------------- */

  async function onFileChosen(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    discardPending();
    if (!/\.xlsx$/i.test(file.name)) {
      return setStatus("ship-import-status", "err", "Elige un fichero de Excel .xlsx (no .xls ni .csv).");
    }
    if (file.size > MAX_FILE_BYTES) {
      return setStatus("ship-import-status", "err", "El fichero pesa demasiado (máximo 5 MB).");
    }
    setStatus("ship-import-status", "info", "Leyendo " + file.name + "…");
    try {
      const workbook = await XLSX.readWorkbook(await file.arrayBuffer());
      const result = SHIP.parseWorkbook(workbook);
      if (!result.shipments.length) {
        return setStatus("ship-import-status", "err", result.errors.join(" "));
      }
      pending = Object.assign(result, { fileName: file.name });
      setStatus("ship-import-status", "", "");
      renderPreview();
    } catch (err) {
      setStatus("ship-import-status", "err", "No se ha podido leer el Excel: " + errText(err));
    }
  }

  function discardPending() {
    pending = null;
    $("ship-preview").hidden = true;
    $("ship-preview-body").innerHTML = "";
  }

  function renderPreview() {
    const inv = pending.invoice;
    const exists = invoices.some((i) => i.id === inv.id);
    const issues = pending.errors.map((m) => `<li class="is-err">${escapeHtml(m)}</li>`)
      .concat(pending.warnings.map((m) => `<li>${escapeHtml(m)}</li>`));
    $("ship-preview-body").innerHTML = `
      <dl class="stats-facts">
        <div><dt>Factura</dt><dd>${escapeHtml(inv.period)}</dd></div>
        <div><dt>Envíos</dt><dd>${inv.count}</dd></div>
        <div><dt>Fechas</dt><dd>${formatDay(inv.fromDate)} – ${formatDay(inv.toDate)}</dd></div>
        <div><dt>Base imponible</dt><dd>${formatPrice(inv.base)}</dd></div>
        <div><dt>IVA</dt><dd>${formatPrice(inv.vat)}</dd></div>
        <div><dt>Total factura</dt><dd>${formatPrice(inv.total)}</dd></div>
      </dl>
      ${issues.length ? `<ul class="ship-issues">${issues.join("")}</ul>` : ""}
      ${exists ? `<p class="status-msg info">Ya hay una factura de ${escapeHtml(inv.period)}: al guardar se sustituyen sus envíos por los de este Excel.</p>` : ""}`;
    $("ship-save").textContent = exists ? "Sustituir factura" : "Guardar envíos";
    $("ship-preview").hidden = false;
  }

  async function savePending() {
    if (!pending) return;
    const { invoice, shipments: rows, fileName } = pending;
    const btn = $("ship-save");
    btn.disabled = true;
    setStatus("ship-import-status", "info", "Guardando " + rows.length + " envíos…");
    try {
      const FieldValue = firebase.firestore.FieldValue;
      const keep = new Set(rows.map((s) => SHIP.docIdFor(s.tracking)));
      // Al reimportar una factura, los envíos que ya no están en el Excel se borran.
      const stale = shipments.filter((s) => s.invoiceId === invoice.id && !keep.has(SHIP.docIdFor(s.tracking)));
      const ops = rows.map((s) => (batch, db) =>
        batch.set(db.collection(COSTS).doc(SHIP.docIdFor(s.tracking)), Object.assign({}, s, { importedAt: FieldValue.serverTimestamp() }))
      );
      stale.forEach((s) => ops.push((batch, db) => batch.delete(db.collection(COSTS).doc(SHIP.docIdFor(s.tracking)))));
      ops.push((batch, db) =>
        batch.set(db.collection(INVOICES).doc(invoice.id), Object.assign({}, invoice, {
          fileName: String(fileName || "").slice(0, 200),
          importedAt: FieldValue.serverTimestamp(),
        }))
      );
      await commitInChunks(ops);
      setStatus("ship-import-status", "ok", `Factura de ${invoice.period} guardada: ${rows.length} envíos, ${formatPrice(invoice.total)}.`);
      discardPending();
    } catch (err) {
      setStatus("ship-import-status", "err", "No se han podido guardar los envíos: " + errText(err));
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteInvoice(id) {
    const inv = invoices.find((i) => i.id === id);
    const rows = shipments.filter((s) => s.invoiceId === id);
    const label = inv ? inv.period : id;
    if (!confirm(`¿Borrar la factura de ${label} y sus ${rows.length} envíos? Podrás volver a importarla desde el Excel.`)) return;
    try {
      const ops = rows.map((s) => (batch, db) => batch.delete(db.collection(COSTS).doc(SHIP.docIdFor(s.tracking))));
      ops.push((batch, db) => batch.delete(db.collection(INVOICES).doc(id)));
      await commitInChunks(ops);
      if ($("ship-invoice").value === id) $("ship-invoice").value = "";
      setStatus("ship-import-status", "ok", `Factura de ${label} borrada.`);
    } catch (err) {
      setStatus("ship-import-status", "err", "No se ha podido borrar la factura: " + errText(err));
    }
  }

  /* ---------------- Pintado ---------------- */

  function filtered() {
    const inv = $("ship-invoice").value;
    const list = SHIP.filterByRange(shipments, $("ship-from").value, $("ship-to").value);
    return inv ? list.filter((s) => s.invoiceId === inv) : list;
  }

  function render() {
    if (!$("shipping-panel")) return;
    const list = filtered();
    const sum = SHIP.summarize(list);
    renderKpis(sum);
    renderRank("ship-by-zone", sum.byZone, "Sin envíos en el periodo", (g) => `Zona ${g.key}`);
    renderRank("ship-by-destination", sum.byDestination.slice(0, 15), "Sin envíos en el periodo", (g) => g.key);
    renderRank("ship-by-tier", sum.byTier, "Sin envíos en el periodo", (g) => g.key);
    renderInvoices();
    renderTable(list);
    $("ship-range-label").textContent = rangeLabel(list);
  }

  function renderKpis(sum) {
    $("ship-kpi-total").textContent = formatPrice(sum.total);
    $("ship-kpi-count").textContent = sum.count;
    $("ship-kpi-avg").textContent = formatPrice(sum.avg);
    $("ship-kpi-discount").textContent = formatPrice(sum.discount);
    $("ship-kpi-fuel").textContent = formatPrice(sum.fuel);
    $("ship-kpi-vat").textContent = formatPrice(sum.vat);
  }

  function renderRank(id, rows, emptyText, labelFn) {
    const el = $(id);
    if (!rows.length) {
      el.innerHTML = `<li class="stats-empty">${emptyText}</li>`;
      return;
    }
    const max = Math.max(...rows.map((r) => r.total)) || 1;
    el.innerHTML = rows
      .map((g, i) => {
        const pct = Math.max(2, (g.total / max) * 100);
        const label = labelFn(g);
        return `<li class="rank-row">
            <span class="rank-pos">${i + 1}</span>
            <div class="rank-main">
              <div class="rank-top">
                <span class="rank-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
                <span class="rank-value">${formatPrice(g.total)}<small>${g.count} ${g.count === 1 ? "envío" : "envíos"} · ${formatPrice(g.avg)}/envío</small></span>
              </div>
              <div class="rank-track"><span style="width:${pct}%"></span></div>
            </div>
          </li>`;
      })
      .join("");
  }

  function renderInvoiceOptions() {
    const sel = $("ship-invoice");
    const current = sel.value;
    sel.innerHTML = '<option value="">Factura: todas</option>' +
      invoices.map((i) => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.period || i.id)}</option>`).join("");
    sel.value = invoices.some((i) => i.id === current) ? current : "";
  }

  function renderInvoices() {
    const el = $("ship-invoices-list");
    if (!invoices.length) {
      el.innerHTML = '<li class="stats-empty">Todavía no has importado ninguna factura.</li>';
      return;
    }
    el.innerHTML = invoices
      .map((i) => {
        const diff = SHIP.round2((Number(i.total) || 0) - (Number(i.computedTotal) || 0));
        const check = Math.abs(diff) > SHIP.INVOICE_TOLERANCE
          ? `<span class="ship-badge is-warn" title="La suma de los envíos no coincide con el total de la factura">Descuadre ${formatPrice(diff)}</span>`
          : '<span class="ship-badge">Cuadra</span>';
        return `<li class="ship-invoice-row">
            <div class="ship-invoice-main">
              <b>${escapeHtml(i.period || i.id)}</b> ${check}
              <small>${Number(i.count) || 0} envíos · ${formatDay(i.fromDate)} – ${formatDay(i.toDate)}${i.fileName ? " · " + escapeHtml(i.fileName) : ""}</small>
            </div>
            <span class="ship-invoice-total">${formatPrice(i.total)}</span>
            <button type="button" class="small-btn" data-view-invoice="${escapeHtml(i.id)}">Ver</button>
            <button type="button" class="small-btn" data-delete-invoice="${escapeHtml(i.id)}" aria-label="Borrar la factura de ${escapeHtml(i.period || i.id)}">Borrar</button>
          </li>`;
      })
      .join("");
  }

  function renderTable(list) {
    const byTracking = SHIP.ordersByTracking(orders);
    $("ship-count").textContent = list.length;
    if (!list.length) {
      $("ship-table-body").innerHTML = '<tr><td colspan="9" class="stats-empty">No hay envíos con estos filtros.</td></tr>';
      return;
    }
    $("ship-table-body").innerHTML = list
      .map((s) => {
        const order = byTracking.get(SHIP.docIdFor(s.tracking));
        const charged = order && typeof order.shippingCost === "number" ? order.shippingCost : null;
        const ref = order ? order.orderCode || "" : s.orderRef;
        const balance = charged == null ? "" : `<small class="${charged - s.total < 0 ? "is-neg" : "is-pos"}">cobrado ${formatPrice(charged)}</small>`;
        return `<tr>
            <td class="m">${formatDay(s.date)}</td>
            <td><a href="${CORREOS_TRACKING_URL + encodeURIComponent(s.tracking)}" target="_blank" rel="noopener" title="Seguimiento en Correos">${escapeHtml(s.tracking)}</a></td>
            <td>${escapeHtml(s.destination)}</td>
            <td class="m">${escapeHtml(s.zone)}</td>
            <td class="m">${escapeHtml(s.tier || s.weight)}</td>
            <td class="num">${formatPrice(s.net)}</td>
            <td class="num">${formatPrice(s.fuel)}</td>
            <td class="num"><b>${formatPrice(s.total)}</b>${balance}</td>
            <td>${escapeHtml(ref) || '<span class="muted">—</span>'}</td>
          </tr>`;
      })
      .join("");
  }

  function rangeLabel(list) {
    const from = $("ship-from").value;
    const to = $("ship-to").value;
    if (from || to) return `Del ${from ? formatDay(from) : "inicio"} al ${to ? formatDay(to) : "último envío"}`;
    if (!list.length) return "Todo el histórico";
    return `Todo el histórico (${formatDay(list[list.length - 1].date)} – ${formatDay(list[0].date)})`;
  }

  /* ---------------- Utilidades ---------------- */

  function setStatus(id, type, msg) {
    $(id).innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
  }

  function errText(err) {
    return err && err.message ? err.message : String(err);
  }

  function formatDay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
  }

  function formatPrice(n) {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }
})();
