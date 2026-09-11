(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let orders = [];
  let statusFilter = "";
  let unsubscribe = null;
  let editingDocId = null;
  let itemRows = [];

  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
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
    $("orders-status-filter").addEventListener("change", (e) => {
      statusFilter = e.target.value;
      renderOrders();
    });
    $("order-add-item").addEventListener("click", () => {
      itemRows.push({ title: "", price: 0, qty: 1 });
      renderItemRows();
    });
    $("order-save").addEventListener("click", saveOrder);
    $("order-cancel").addEventListener("click", resetOrderForm);
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
    const total = included.reduce((s, o) => s + (Number(o.subtotal) || 0), 0);
    $("revenue-total").textContent = formatPrice(total);
    $("revenue-count").textContent = included.length;
  }

  function orderCard(o) {
    const date = formatDate(o.createdAt);
    const itemsHtml = (o.items || [])
      .map((it) => `<div class="order-item-row"><span>${it.qty}× ${escapeHtml(it.title)}</span><span>${formatPrice(it.price * it.qty)}</span></div>`)
      .join("");
    const c = o.customer || {};
    const s = o.shipping || {};
    const waHref = c.phone
      ? `https://wa.me/${String(c.phone).replace(/[^\d+]/g, "").replace("+", "")}`
      : null;

    return `
      <article class="order-card status-${escapeAttr(o.status || "pendiente")}">
        <div class="order-card-head">
          <div>
            <b>${escapeHtml(o.orderCode || o.docId)}</b>
            <span class="order-date">${date}</span>
          </div>
          <div class="order-head-actions">
            <select id="status-${o.docId}" class="order-status-select">
              ${["pendiente", "confirmado", "enviado", "entregado", "cancelado"]
                .map((s2) => `<option value="${s2}" ${o.status === s2 ? "selected" : ""}>${capitalize(s2)}</option>`)
                .join("")}
            </select>
            <button class="small-btn" id="edit-${o.docId}" type="button">Editar</button>
            <button class="small-btn danger" id="del-${o.docId}" type="button">Borrar</button>
          </div>
        </div>
        <div class="order-card-body">
          <div class="order-items">${itemsHtml}</div>
          <div class="order-total">Subtotal: <b>${formatPrice(o.subtotal || 0)}</b></div>
          <div class="order-customer">
            <div><b>${escapeHtml(c.name || "-")}</b></div>
            <div>${escapeHtml(c.phone || "-")} ${waHref ? `· <a href="${waHref}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</div>
            ${c.email ? `<div>${escapeHtml(c.email)}</div>` : ""}
            <div class="order-address">${escapeHtml(s.address || "")}, ${escapeHtml(s.postalCode || "")} ${escapeHtml(s.city || "")} ${s.province ? "(" + escapeHtml(s.province) + ")" : ""}</div>
            ${s.notes ? `<div class="order-notes">Notas: ${escapeHtml(s.notes)}</div>` : ""}
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
    itemRows = [{ title: "", price: 0, qty: 1 }];
    $("order-form-title").textContent = "Nuevo pedido";
    $("o-status").value = "pendiente";
    ["o-code", "o-name", "o-phone", "o-email", "o-city", "o-address", "o-postal", "o-province", "o-notes"].forEach(
      (id) => ($(id).value = "")
    );
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
    $("o-name").value = c.name || "";
    $("o-phone").value = c.phone || "";
    $("o-email").value = c.email || "";
    $("o-city").value = s.city || "";
    $("o-address").value = s.address || "";
    $("o-postal").value = s.postalCode || "";
    $("o-province").value = s.province || "";
    $("o-notes").value = s.notes || "";
    itemRows = (o.items || []).map((it) => ({ title: it.title, price: it.price, qty: it.qty }));
    if (!itemRows.length) itemRows = [{ title: "", price: 0, qty: 1 }];
    $("order-cancel").style.display = "inline-block";
    renderItemRows();
    setOrderFormStatus("", "");
    document.getElementById("order-form-title").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderItemRows() {
    $("order-items-rows").innerHTML = itemRows
      .map(
        (row, i) => `
      <div class="order-item-edit-row">
        <input type="text" placeholder="Producto" value="${escapeAttr(row.title)}" data-field="title" data-i="${i}" class="oi-title">
        <input type="number" min="0" step="0.01" placeholder="Precio" value="${row.price}" data-field="price" data-i="${i}" class="oi-price">
        <input type="number" min="1" step="1" placeholder="Cant." value="${row.qty}" data-field="qty" data-i="${i}" class="oi-qty">
        <button type="button" class="small-btn danger oi-remove" data-i="${i}">✕</button>
      </div>
    `
      )
      .join("");

    $("order-items-rows").querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", () => {
        const i = parseInt(inp.dataset.i, 10);
        const field = inp.dataset.field;
        itemRows[i][field] = field === "title" ? inp.value : parseFloat(inp.value) || 0;
        updateOrderFormSubtotal();
      });
    });
    $("order-items-rows").querySelectorAll(".oi-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.i, 10);
        itemRows.splice(i, 1);
        if (!itemRows.length) itemRows = [{ title: "", price: 0, qty: 1 }];
        renderItemRows();
      });
    });
    updateOrderFormSubtotal();
  }

  function updateOrderFormSubtotal() {
    const total = itemRows.reduce((s, r) => s + (Number(r.price) || 0) * (Number(r.qty) || 0), 0);
    $("order-form-subtotal").textContent = formatPrice(total);
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
    const existing = editingDocId ? orders.find((x) => x.docId === editingDocId) : null;

    const order = {
      orderCode: $("o-code").value.trim() || (existing && existing.orderCode) || genOrderCode(),
      createdAt: (existing && existing.createdAt) || new Date().toISOString(),
      status: $("o-status").value,
      items: validItems.map((r) => ({
        id: (existing && existing.items && existing.items.find((x) => x.title === r.title)?.id) || null,
        title: r.title.trim(),
        price: Number(r.price) || 0,
        qty: Number(r.qty) || 1,
        image: (existing && existing.items && existing.items.find((x) => x.title === r.title)?.image) || "",
      })),
      subtotal,
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
