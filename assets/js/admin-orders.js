(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let orders = [];
  let statusFilter = "";
  let unsubscribe = null;

  document.addEventListener("DOMContentLoaded", () => {
    initTabs();

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
        },
        (err) => {
          setAuthStatus("err", "Error leyendo pedidos: " + err.message);
        }
      );
  }

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
    });
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
          <select id="status-${o.docId}" class="order-status-select">
            ${["pendiente", "confirmado", "enviado", "entregado", "cancelado"]
              .map((s2) => `<option value="${s2}" ${o.status === s2 ? "selected" : ""}>${capitalize(s2)}</option>`)
              .join("")}
          </select>
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
