(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const CORREOS_TRACKING_URL = "https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=";
  let orders = [];
  let catalogProducts = [];
  let statusFilter = "";
  let unsubscribe = null;
  let editingDocId = null;
  let itemRows = [];

  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    loadCatalog();
    resetOrderForm();

    if (!window.HA_FIREBASE_ENABLED) {
      $("orders-auth-status").innerHTML =
        '<div class="status-msg info">Todavía no has conectado la base de datos de pedidos. Sigue las instrucciones del README (assets/js/firebase-config.js) para activarla.</div>';
      $("orders-login-btn").disabled = true;
      return;
    }

    if (!firebase.apps.length) firebase.initializeApp(window.HA_FIREBASE_CONFIG);

    $("orders-login-btn").addEventListener("click", login);
    $("orders-password").addEventListener("keydown", (e) => {
      if (e.key === "Enter") login();
    });
    $("orders-logout-btn").addEventListener("click", () => firebase.auth().signOut());
    document.querySelectorAll(".status-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        statusFilter = btn.dataset.status;
        document.querySelectorAll(".status-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderOrders();
      });
    });
    $("print-confirmed-btn").addEventListener("click", printConfirmedOrders);
    $("order-add-item").addEventListener("click", () => {
      itemRows.push({ productId: null, title: "", price: 0, qty: 1, discountPercent: 0 });
      renderItemRows();
    });
    $("order-save").addEventListener("click", saveOrder);
    $("order-cancel").addEventListener("click", resetOrderForm);
    $("o-shipping-cost").addEventListener("input", updateOrderFormSubtotal);
    $("revenue-from").addEventListener("change", renderRevenue);
    $("revenue-to").addEventListener("change", renderRevenue);

    firebase.auth().onAuthStateChanged((user) => {
      if (user) {
        $("orders-login").querySelector(".field-row").style.display = "none";
        $("orders-login-btn").style.display = "none";
        $("orders-logout-btn").style.display = "inline-block";
        setAuthStatus("ok", `Sesión iniciada como ${user.email}`);
        $("orders-panel").style.display = "block";
        subscribeOrders();
      } else {
        $("orders-login").querySelector(".field-row").style.display = "grid";
        $("orders-login-btn").style.display = "inline-block";
        $("orders-logout-btn").style.display = "none";
        $("orders-panel").style.display = "none";
        if (unsubscribe) unsubscribe();
        orders = [];
      }
    });
  });

  function initTabs() {
    document.querySelectorAll(".admin-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".admin-tab").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".admin-tab-panel").forEach((p) => (p.style.display = "none"));
        btn.classList.add("active");
        document.getElementById(btn.dataset.tab).style.display = "block";
      });
    });
  }

  async function login() {
    const email = $("orders-email").value.trim();
    const password = $("orders-password").value;
    if (!email || !password) {
      setAuthStatus("err", "Introduce email y contraseña.");
      return;
    }
    setAuthStatus("info", "Entrando...");
    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
    } catch (e) {
      setAuthStatus("err", "No se pudo iniciar sesión: " + e.message);
    }
  }

  function setAuthStatus(type, msg) {
    $("orders-auth-status").innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
  }

  async function loadCatalog() {
    try {
      const res = await fetch("data/products.json?v=" + Date.now(), { cache: "no-store" });
      catalogProducts = await res.json();
    } catch (e) {
      catalogProducts = [];
    }
    renderItemRows();
  }

  function subscribeOrders() {
    if (unsubscribe) unsubscribe();
    const db = firebase.firestore();
    unsubscribe = db
      .collection("orders")
      .orderBy("createdAt", "desc")
      .onSnapshot(
        (snap) => {
          orders = snap.docs.map((d) => ({ docId: d.id, ...d.data() }));
          renderOrders();
          renderRevenue();
        },
        (err) => {
          setAuthStatus("err", "Error leyendo pedidos: " + err.message);
        }
      );
  }

  /* ---------------- LIST + REVENUE ---------------- */

  function renderOrders() {
    const list = statusFilter ? orders.filter((o) => o.status === statusFilter) : orders;
    $("orders-count").textContent = orders.length;
    const pending = orders.filter((o) => o.status === "pendiente").length;
    const badge = $("orders-pending-badge");
    if (pending > 0) {
      badge.textContent = pending;
      badge.style.display = "inline-flex";
    } else {
      badge.style.display = "none";
    }
    $("confirmed-count").textContent = orders.filter((o) => o.status === "confirmado").length;
    $("count-all").textContent = orders.length;
    ["pendiente", "confirmado", "enviado", "entregado", "cancelado"].forEach((s2) => {
      const el = $("count-" + s2);
      if (el) el.textContent = orders.filter((o) => o.status === s2).length;
    });

    if (!list.length) {
      $("orders-list").innerHTML = '<div class="empty-state">No hay pedidos que mostrar.</div>';
      return;
    }

    $("orders-list").innerHTML = list.map(orderCard).join("");

    list.forEach((o) => {
      const sel = document.getElementById(`status-${o.docId}`);
      if (sel) sel.addEventListener("change", () => updateStatus(o.docId, sel.value));
      const editBtn = document.getElementById(`edit-${o.docId}`);
      if (editBtn) editBtn.addEventListener("click", () => editOrder(o.docId));
      const delBtn = document.getElementById(`del-${o.docId}`);
      if (delBtn) delBtn.addEventListener("click", () => deleteOrder(o.docId));
      const labelBtn = document.getElementById(`label-${o.docId}`);
      if (labelBtn) labelBtn.addEventListener("click", () => printLabel(o.docId));
      const albaranBtn = document.getElementById(`albaran-${o.docId}`);
      if (albaranBtn) albaranBtn.addEventListener("click", () => printAlbaran(o.docId));
      const waAlbaranBtn = document.getElementById(`wa-albaran-${o.docId}`);
      if (waAlbaranBtn) waAlbaranBtn.addEventListener("click", () => sendAlbaranWhatsApp(o.docId));
    });
  }

  function renderRevenue() {
    const from = $("revenue-from").value ? new Date($("revenue-from").value + "T00:00:00") : null;
    const to = $("revenue-to").value ? new Date($("revenue-to").value + "T23:59:59") : null;
    const included = orders.filter((o) => {
      if (o.status === "cancelado") return false;
      const created = o.createdAt ? new Date(o.createdAt) : null;
      if (!created) return false;
      if (from && created < from) return false;
      if (to && created > to) return false;
      return true;
    });
    const total = included.reduce((s, o) => s + orderTotal(o), 0);
    $("revenue-total").textContent = formatPrice(total);
    $("revenue-count").textContent = included.length;
  }

  function orderTotal(o) {
    if (typeof o.total === "number") return o.total;
    return (Number(o.subtotal) || 0) + (Number(o.shippingCost) || 0);
  }

  function orderCard(o) {
    const date = formatDate(o.createdAt);
    const status = o.status || "pendiente";
    const shippingCost = Number(o.shippingCost) || 0;
    const itemsSum = (o.items || []).reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    const total = orderTotal(o);
    const itemsHtml = (o.items || [])
      .map(
        (it) => `
        <div class="order-item-row">
          ${it.image ? `<img src="${escapeAttr(it.image)}" alt="">` : `<div class="order-item-noimg"></div>`}
          <span class="oi-name">${Number(it.qty) || 0}× ${escapeHtml(it.title)}${it.discountPercent ? ` <span class="oi-discount-tag">-${Number(it.discountPercent) || 0}%</span>` : ""}</span>
          <span class="oi-total">${formatPrice(it.price * it.qty)}</span>
        </div>`
      )
      .join("");
    const c = o.customer || {};
    const s = o.shipping || {};
    const waHref = c.phone ? `https://wa.me/${waPhoneDigits(c.phone)}` : null;

    return `
      <article class="order-card status-${escapeAttr(status)}">
        <div class="order-card-head">
          <div class="order-head-title">
            <b>${escapeHtml(o.orderCode || o.docId)}</b>
            <span class="status-pill status-pill-${escapeAttr(status)}">${escapeHtml(capitalize(status))}</span>
            <span class="order-date">${date}</span>
          </div>
          <div class="order-head-actions">
            <select id="status-${escapeAttr(o.docId)}" class="order-status-select">
              ${["pendiente", "confirmado", "enviado", "entregado", "cancelado"]
                .map((s2) => `<option value="${s2}" ${status === s2 ? "selected" : ""}>${capitalize(s2)}</option>`)
                .join("")}
            </select>
            <button class="small-btn" id="label-${escapeAttr(o.docId)}" type="button" title="Imprimir etiqueta de envío">🏷️ Etiqueta</button>
            <button class="small-btn" id="albaran-${escapeAttr(o.docId)}" type="button" title="Descargar albarán en PDF">📄 Albarán</button>
            ${c.phone ? `<button class="small-btn" id="wa-albaran-${escapeAttr(o.docId)}" type="button" title="Enviar el albarán por WhatsApp al cliente">📲 Albarán WhatsApp</button>` : ""}
            ${o.trackingNumber ? `<a class="small-btn" href="${escapeAttr(CORREOS_TRACKING_URL + encodeURIComponent(o.trackingNumber))}" target="_blank" rel="noopener" title="Ver seguimiento del envío en Correos">🚚 Seguimiento</a>` : ""}
            <button class="small-btn" id="edit-${escapeAttr(o.docId)}" type="button">✏️ Editar</button>
            <button class="small-btn danger" id="del-${escapeAttr(o.docId)}" type="button">🗑️ Borrar</button>
          </div>
        </div>
        <div class="order-card-body">
          <div class="order-items-block">
            <div class="order-items">${itemsHtml}</div>
            <div class="order-totals">
              <div class="order-total-row"><span>Productos</span><span>${formatPrice(itemsSum)}</span></div>
              ${shippingCost > 0 ? `<div class="order-total-row"><span>Envío</span><span>${formatPrice(shippingCost)}</span></div>` : ""}
              <div class="order-total-row order-total-grand"><span>Total</span><b>${formatPrice(total)}</b></div>
            </div>
          </div>
          <div class="order-customer">
            <div class="order-customer-name">${escapeHtml(c.name || "-")}</div>
            <div class="order-customer-line">📞 ${escapeHtml(c.phone || "-")} ${waHref ? `· <a href="${waHref}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</div>
            ${c.email ? `<div class="order-customer-line">✉️ ${escapeHtml(c.email)}</div>` : ""}
            <div class="order-customer-line order-address">📍 ${escapeHtml(s.address || "")}, ${escapeHtml(s.postalCode || "")} ${escapeHtml(s.city || "")} ${s.province ? "(" + escapeHtml(s.province) + ")" : ""}</div>
            ${o.paymentMethod ? `<div class="order-customer-line">💳 ${escapeHtml(paymentLabel(o.paymentMethod))}</div>` : ""}
            ${s.notes ? `<div class="order-notes">📝 ${escapeHtml(s.notes)}</div>` : ""}
          </div>
        </div>
      </article>
    `;
  }

  async function updateStatus(docId, status) {
    try {
      await firebase.firestore().collection("orders").doc(docId).update({ status });
    } catch (e) {
      alert("No se pudo actualizar el estado: " + e.message);
    }
  }

  const ALBARAN_STYLE = `
    body{font-family:Arial,Helvetica,sans-serif;color:#222;padding:24px}
    .albaran{max-width:720px;margin:0 auto 40px;page-break-after:always}
    .albaran:last-child{page-break-after:auto}
    .albaran-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #245F96;padding-bottom:14px;margin-bottom:16px}
    .albaran-brand{font-size:20px;font-weight:800;color:#245F96}
    .albaran-brand-sub{font-size:11.5px;color:#666;margin-top:2px}
    .albaran-doc{text-align:right;font-size:12.5px;color:#444}
    .albaran-doc-title{font-weight:700;font-size:14px;color:#111;margin-bottom:4px}
    .albaran-customer{font-size:13px;line-height:1.6;margin-bottom:18px}
    .albaran-notes{font-style:italic;color:#555;margin-top:4px}
    .albaran-table{width:100%;border-collapse:collapse;font-size:13px}
    .albaran-table th,.albaran-table td{padding:8px 6px;border-bottom:1px solid #ddd;text-align:left}
    .albaran-discount-tag{display:inline-block;background:#c0392b;color:#fff;font-size:10.5px;font-weight:800;border-radius:999px;padding:1px 7px;margin-left:4px}
    .albaran-table .num{text-align:right}
    .albaran-table tfoot td{border-bottom:none;padding-top:8px}
    .albaran-total-row td{font-weight:800;font-size:14.5px;border-top:2px solid #245F96;padding-top:10px}
    .albaran-footer{margin-top:24px;font-size:11.5px;color:#777;text-align:center}
    @media print{ .albaran{margin-bottom:0} }
  `;

  function albaranHtml(o) {
    const c = o.customer || {};
    const s = o.shipping || {};
    const shippingCost = Number(o.shippingCost) || 0;
    const itemsSum = (o.items || []).reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    const total = orderTotal(o);
    const rows = (o.items || [])
      .map(
        (it) => `<tr><td>${escapeHtml(it.title)}${it.discountPercent ? ` <span class="albaran-discount-tag">-${Number(it.discountPercent) || 0}%</span>` : ""}</td><td class="num">${Number(it.qty) || 0}</td><td class="num">${formatPrice(it.price)}</td><td class="num">${formatPrice(it.price * it.qty)}</td></tr>`
      )
      .join("");
    return `
    <section class="albaran">
      <div class="albaran-header">
        <div>
          <div class="albaran-brand">HezurAdar</div>
          <div class="albaran-brand-sub">Legazpi, Gipuzkoa · hezuradar@gmail.com</div>
        </div>
        <div class="albaran-doc">
          <div class="albaran-doc-title">Albarán de entrega</div>
          <div>Pedido ${escapeHtml(o.orderCode || o.docId)}</div>
          <div>${formatDate(o.createdAt)}</div>
        </div>
      </div>
      <div class="albaran-customer">
        <div><b>${escapeHtml(c.name || "-")}</b></div>
        <div>${escapeHtml(s.address || "")}, ${escapeHtml(s.postalCode || "")} ${escapeHtml(s.city || "")} ${s.province ? "(" + escapeHtml(s.province) + ")" : ""}</div>
        <div>${c.phone ? "Tel: " + escapeHtml(c.phone) : ""}${c.email ? " · " + escapeHtml(c.email) : ""}</div>
        ${o.paymentMethod ? `<div>Forma de pago: ${escapeHtml(paymentLabel(o.paymentMethod))}</div>` : ""}
        ${s.notes ? `<div class="albaran-notes">Notas: ${escapeHtml(s.notes)}</div>` : ""}
      </div>
      <table class="albaran-table">
        <thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Importe</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr><td colspan="3">Productos</td><td class="num">${formatPrice(itemsSum)}</td></tr>
          ${shippingCost > 0 ? `<tr><td colspan="3">Envío</td><td class="num">${formatPrice(shippingCost)}</td></tr>` : ""}
          <tr class="albaran-total-row"><td colspan="3">Total</td><td class="num">${formatPrice(total)}</td></tr>
        </tfoot>
      </table>
      <div class="albaran-footer">Gracias por su compra.</div>
    </section>`;
  }

  function openPrintWindow(title, bodyHtml) {
    const win = window.open("", "_blank", "width=800,height=600");
    if (!win) {
      alert("El navegador ha bloqueado la ventana de impresión. Permite las ventanas emergentes para esta página.");
      return;
    }
    win.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>${ALBARAN_STYLE}</style>
</head><body>
${bodyHtml}
<script>window.onload = function(){ window.print(); };<\/script>
</body></html>`);
    win.document.close();
  }

  function printAlbaran(docId) {
    const o = orders.find((x) => x.docId === docId);
    if (!o) return;
    openPrintWindow(`Albarán ${o.orderCode || o.docId}`, albaranHtml(o));
  }

  function albaranWhatsAppText(o) {
    const c = o.customer || {};
    const s = o.shipping || {};
    const shippingCost = Number(o.shippingCost) || 0;
    const itemsSum = (o.items || []).reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    const total = orderTotal(o);
    const lines = (o.items || [])
      .map((it) => `- ${it.qty}x ${it.title} — ${formatPrice(it.price * it.qty)}`)
      .join("\n");
    return [
      `📄 *Albarán de entrega · Pedido ${o.orderCode || o.docId}*`,
      "",
      "Productos:",
      lines,
      "",
      `Productos: ${formatPrice(itemsSum)}`,
      shippingCost > 0 ? `Envío: ${formatPrice(shippingCost)}` : null,
      `Total: ${formatPrice(total)}`,
      "",
      "Enviar a:",
      c.name || "",
      `${s.address || ""}, ${s.postalCode || ""} ${s.city || ""}${s.province ? " (" + s.province + ")" : ""}`,
      "",
      "Gracias por su compra — HezurAdar",
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  function sendAlbaranWhatsApp(docId) {
    const o = orders.find((x) => x.docId === docId);
    if (!o) return;
    const c = o.customer || {};
    if (!c.phone) {
      alert("Este pedido no tiene teléfono de cliente.");
      return;
    }
    const phone = waPhoneDigits(c.phone);
    const text = albaranWhatsAppText(o);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank");
  }

  function labelBlockHtml(o) {
    const c = o.customer || {};
    const s = o.shipping || {};
    return `
      <div class="to-caption">Enviar a</div>
      <div class="to">
        <b>${escapeHtml(c.name || "")}</b>
        ${escapeHtml(s.address || "")}<br>
        ${escapeHtml(s.postalCode || "")} ${escapeHtml(s.city || "")}<br>
        ${s.province ? escapeHtml(s.province) + "<br>" : ""}
        ${c.phone ? "Tel: " + escapeHtml(c.phone) : ""}
      </div>
      <div class="code">Pedido ${escapeHtml(o.orderCode || o.docId)}</div>
    `;
  }

  function printConfirmedOrders() {
    const confirmed = orders.filter((o) => o.status === "confirmado");
    if (!confirmed.length) {
      alert("No hay pedidos confirmados para imprimir.");
      return;
    }
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      alert("El navegador ha bloqueado la ventana de impresión. Permite las ventanas emergentes para esta página.");
      return;
    }
    const labelsHtml = confirmed
      .map((o) => `<div class="label"><span class="label-order-code">${escapeHtml(o.orderCode || o.docId)}</span>${labelBlockHtml(o)}</div>`)
      .join("");
    win.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Etiquetas de envío — pedidos confirmados</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;padding:22px;color:#111}
  h1{font-size:15px;margin:0 0 18px}
  .label-sheet{display:grid;grid-template-columns:1fr 1fr;gap:22px}
  .label{
    position:relative;border:2px solid #111;border-radius:10px;padding:20px 18px;
    break-inside:avoid;page-break-inside:avoid;
  }
  .label-order-code{
    position:absolute;top:-11px;left:14px;background:#fff;padding:0 8px;
    font-size:10.5px;font-weight:800;letter-spacing:.04em;color:#245F96;
  }
  .to-caption{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#666;margin-bottom:6px}
  .to{font-size:15px;line-height:1.5}
  .to b{font-size:19px;display:block;margin-bottom:6px}
  .code{margin-top:14px;font-size:10.5px;color:#666}
  @media print{
    body{padding:8px}
    h1{display:none}
    .label-sheet{gap:16px}
  }
</style>
</head><body>
  <h1>Etiquetas de envío — pedidos confirmados (${confirmed.length})</h1>
  <div class="label-sheet">${labelsHtml}</div>
  <script>window.onload = function(){ window.print(); };<\/script>
</body></html>`);
    win.document.close();
  }

  function printLabel(docId) {
    const o = orders.find((x) => x.docId === docId);
    if (!o) return;
    const win = window.open("", "_blank", "width=480,height=360");
    if (!win) {
      alert("El navegador ha bloqueado la ventana de impresión. Permite las ventanas emergentes para esta página.");
      return;
    }
    win.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Etiqueta ${escapeHtml(o.orderCode || o.docId)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;padding:22px;color:#111}
  .label{border:2px solid #111;border-radius:10px;padding:22px;max-width:420px}
  .to-caption{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#666;margin-bottom:6px}
  .to{font-size:16px;line-height:1.55}
  .to b{font-size:21px;display:block;margin-bottom:8px}
  .code{margin-top:18px;font-size:11px;color:#666}
  @media print{ body{padding:0} .label{border:none} }
</style>
</head><body>
  <div class="label">${labelBlockHtml(o)}</div>
  <script>window.onload = function(){ window.print(); };<\/script>
</body></html>`);
    win.document.close();
  }

  async function deleteOrder(docId) {
    const o = orders.find((x) => x.docId === docId);
    if (!o) return;
    if (!confirm(`¿Borrar el pedido ${o.orderCode || docId}? Esta acción no se puede deshacer.`)) return;
    try {
      await firebase.firestore().collection("orders").doc(docId).delete();
      if (editingDocId === docId) resetOrderForm();
    } catch (e) {
      alert("No se pudo borrar el pedido: " + e.message);
    }
  }

  /* ---------------- CREATE / EDIT FORM ---------------- */

  function resetOrderForm() {
    editingDocId = null;
    itemRows = [{ productId: null, title: "", price: 0, qty: 1, discountPercent: 0 }];
    $("order-form-title").textContent = "Nuevo pedido";
    $("o-status").value = "pendiente";
    ["o-code", "o-tracking", "o-payment", "o-name", "o-phone", "o-email", "o-city", "o-address", "o-postal", "o-province", "o-notes"].forEach(
      (id) => ($(id).value = "")
    );
    $("o-shipping-cost").value = "";
    $("order-cancel").style.display = "none";
    renderItemRows();
    setOrderFormStatus("", "");
  }

  function editOrder(docId) {
    const o = orders.find((x) => x.docId === docId);
    if (!o) return;
    editingDocId = docId;
    const c = o.customer || {};
    const s = o.shipping || {};
    $("order-form-title").textContent = "Editar pedido";
    $("o-status").value = o.status || "pendiente";
    $("o-code").value = o.orderCode || "";
    $("o-tracking").value = o.trackingNumber || "";
    $("o-payment").value = o.paymentMethod || "";
    $("o-name").value = c.name || "";
    $("o-phone").value = c.phone || "";
    $("o-email").value = c.email || "";
    $("o-city").value = s.city || "";
    $("o-address").value = s.address || "";
    $("o-postal").value = s.postalCode || "";
    $("o-province").value = s.province || "";
    $("o-notes").value = s.notes || "";
    $("o-shipping-cost").value = o.shippingCost || "";
    itemRows = (o.items || []).map((it) => ({
      productId: it.id || null,
      title: it.title,
      price: it.price,
      qty: it.qty,
      discountPercent: Number(it.discountPercent) || 0,
    }));
    if (!itemRows.length) itemRows = [{ productId: null, title: "", price: 0, qty: 1, discountPercent: 0 }];
    $("order-cancel").style.display = "inline-block";
    renderItemRows();
    setOrderFormStatus("", "");
    document.getElementById("order-form-title").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function isCustomRow(row) {
    return !row.productId || !catalogProducts.some((p) => p.id === row.productId);
  }

  function productOptionsHtml(selectedId) {
    return catalogProducts
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(
        (p) =>
          `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.title)} — ${formatPrice(p.price)}${p.discountPercent ? ` (-${p.discountPercent}%)` : ""}</option>`
      )
      .join("");
  }

  function renderItemRows() {
    $("order-items-rows").innerHTML = itemRows
      .map((row, i) => {
        const custom = isCustomRow(row);
        return `
      <div class="order-item-edit-row">
        <div class="oi-main">
          <label>Producto</label>
          <select class="oi-product" data-i="${i}">
            <option value="__custom__" ${custom ? "selected" : ""}>Producto personalizado…</option>
            ${productOptionsHtml(custom ? null : row.productId)}
          </select>
          ${
            custom
              ? `<input type="text" class="oi-title-custom" data-i="${i}" placeholder="Nombre del producto" value="${escapeAttr(row.title)}">`
              : ""
          }
        </div>
        <div class="oi-sub">
          <div class="oi-field">
            <label>Precio (€)</label>
            <input type="number" min="0" step="0.01" placeholder="0,00" value="${Number(row.price) || 0}" data-i="${i}" class="oi-price">
          </div>
          <div class="oi-field">
            <label>Cantidad</label>
            <input type="number" min="1" step="1" placeholder="1" value="${Number(row.qty) || 1}" data-i="${i}" class="oi-qty">
          </div>
          <button type="button" class="small-btn danger oi-remove" data-i="${i}" title="Eliminar línea">✕ Quitar</button>
        </div>
      </div>
    `;
      })
      .join("");

    $("order-items-rows").querySelectorAll(".oi-product").forEach((sel) => {
      sel.addEventListener("change", () => {
        const i = parseInt(sel.dataset.i, 10);
        if (sel.value === "__custom__") {
          itemRows[i].productId = null;
        } else {
          const p = catalogProducts.find((x) => x.id === sel.value);
          if (p) {
            const pct = Number(p.discountPercent) || 0;
            itemRows[i].productId = p.id;
            itemRows[i].title = p.title;
            itemRows[i].price = pct > 0 ? Math.round(p.price * (1 - pct / 100) * 100) / 100 : p.price;
            itemRows[i].discountPercent = pct;
          }
        }
        renderItemRows();
      });
    });
    $("order-items-rows").querySelectorAll(".oi-title-custom").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = parseInt(inp.dataset.i, 10);
        itemRows[i].title = inp.value;
      });
    });
    $("order-items-rows").querySelectorAll(".oi-price,.oi-qty").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = parseInt(inp.dataset.i, 10);
        const field = inp.classList.contains("oi-price") ? "price" : "qty";
        itemRows[i][field] = parseFloat(inp.value) || 0;
        updateOrderFormSubtotal();
      });
    });
    $("order-items-rows").querySelectorAll(".oi-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.i, 10);
        itemRows.splice(i, 1);
        if (!itemRows.length) itemRows = [{ productId: null, title: "", price: 0, qty: 1, discountPercent: 0 }];
        renderItemRows();
      });
    });
    updateOrderFormSubtotal();
  }

  function updateOrderFormSubtotal() {
    const itemsTotal = itemRows.reduce((s, r) => s + (Number(r.price) || 0) * (Number(r.qty) || 0), 0);
    const shippingCost = Number($("o-shipping-cost").value) || 0;
    $("order-form-items-total").textContent = formatPrice(itemsTotal);
    $("order-form-shipping-total").textContent = formatPrice(shippingCost);
    $("order-form-subtotal").textContent = formatPrice(itemsTotal + shippingCost);
  }

  async function saveOrder() {
    const name = $("o-name").value.trim();
    const phone = $("o-phone").value.trim();
    if (!name || !phone) {
      setOrderFormStatus("err", "El nombre y el teléfono del cliente son obligatorios.");
      return;
    }
    const validItems = itemRows.filter((r) => r.title.trim() && r.qty > 0);
    if (!validItems.length) {
      setOrderFormStatus("err", "Añade al menos un producto con título y cantidad.");
      return;
    }
    const subtotal = validItems.reduce((s, r) => s + (Number(r.price) || 0) * (Number(r.qty) || 0), 0);
    const shippingCost = Number($("o-shipping-cost").value) || 0;
    const existing = editingDocId ? orders.find((x) => x.docId === editingDocId) : null;

    const order = {
      orderCode: $("o-code").value.trim() || (existing && existing.orderCode) || genOrderCode(),
      trackingNumber: $("o-tracking").value.trim(),
      paymentMethod: $("o-payment").value,
      createdAt: (existing && existing.createdAt) || new Date().toISOString(),
      status: $("o-status").value,
      items: validItems.map((r) => {
        const p = r.productId ? catalogProducts.find((x) => x.id === r.productId) : null;
        return {
          id: r.productId || null,
          title: r.title.trim(),
          price: Number(r.price) || 0,
          originalPrice: p ? Number(p.price) : Number(r.price) || 0,
          discountPercent: Number(r.discountPercent) || 0,
          qty: Number(r.qty) || 1,
          image: (p && p.images && p.images[0]) || "",
        };
      }),
      subtotal,
      shippingCost,
      total: subtotal + shippingCost,
      customer: {
        name,
        phone,
        email: $("o-email").value.trim(),
      },
      shipping: {
        address: $("o-address").value.trim(),
        postalCode: $("o-postal").value.trim(),
        city: $("o-city").value.trim(),
        province: $("o-province").value.trim(),
        notes: $("o-notes").value.trim(),
      },
    };

    setOrderFormStatus("info", "Guardando...");
    $("order-save").disabled = true;
    try {
      const db = firebase.firestore();
      if (editingDocId) {
        await db.collection("orders").doc(editingDocId).set(order);
        setOrderFormStatus("ok", "Pedido actualizado.");
      } else {
        await db.collection("orders").add(order);
        setOrderFormStatus("ok", "Pedido creado.");
      }
      resetOrderForm();
    } catch (e) {
      setOrderFormStatus("err", "No se pudo guardar el pedido: " + e.message);
    } finally {
      $("order-save").disabled = false;
    }
  }

  function setOrderFormStatus(type, msg) {
    $("order-form-status").innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
  }

  function genOrderCode() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `HA-${ymd}-${rand}`;
  }

  /* ---------------- UTIL ---------------- */

  function paymentLabel(method) {
    return { paypal: "PayPal", bizum: "Bizum", otros: "Otros" }[method] || method;
  }
  function waPhoneDigits(phone) {
    let digits = String(phone || "").replace(/[^\d+]/g, "");
    const hadPlus = digits.startsWith("+");
    digits = digits.replace(/\+/g, "");
    if (!hadPlus && digits.length === 9) {
      // Número español sin prefijo de país (p.ej. 653 71 34 28): se asume +34.
      digits = "34" + digits;
    }
    return digits;
  }
  function formatDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
    } catch (e) {
      return iso;
    }
  }
  function formatPrice(n) {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
  }
  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }
  function escapeAttr(str) {
    return escapeHtml(str);
  }
})();
