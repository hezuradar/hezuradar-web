(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const CORREOS_TRACKING_URL = "https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=";
  // Pedidos que vienen del personalizador (placas, púas...): mismo formato de tarjeta,
  // solo cambia la etiqueta según el "kind" guardado en el pedido.
  const DESIGN_KINDS = {
    "placa-personalizada": "Placa personalizada",
    "pua-personalizada": "Púa personalizada",
  };
  const isDesignOrder = (o) => !!DESIGN_KINDS[o && o.kind];
  let orders = [];
  let catalogProducts = [];
  let statusFilter = "";
  let unsubscribe = null;
  let editingDocId = null;
  let itemRows = [];
  let expandedCustomerKey = null;
  let editingCustomerKey = null;
  let customerSort = { field: "lastOrderAt", dir: "desc" };
  const CUSTOMER_SORT_DEFAULT_DIR = {
    name: "asc",
    phone: "asc",
    address: "asc",
    orderCount: "desc",
    totalSpent: "desc",
    lastOrderAt: "desc",
  };
  const CUSTOMER_SORT_GETTERS = {
    name: (c) => (c.name || "").toLowerCase(),
    phone: (c) => c.phone || "",
    address: (c) => [c.address, c.postalCode, c.city].filter(Boolean).join(" ").toLowerCase(),
    orderCount: (c) => c.orderCount,
    totalSpent: (c) => c.totalSpent,
    lastOrderAt: (c) => c.lastOrderAt || "",
  };

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
    $("customer-filter").addEventListener("input", renderCustomers);
    $("o-customer-select").addEventListener("change", onCustomerSelectChange);
    document.querySelectorAll("#customers-thead-row [data-field]").forEach((th) => {
      th.addEventListener("click", () => {
        const field = th.dataset.field;
        if (customerSort.field === field) {
          customerSort.dir = customerSort.dir === "asc" ? "desc" : "asc";
        } else {
          customerSort.field = field;
          customerSort.dir = CUSTOMER_SORT_DEFAULT_DIR[field] || "asc";
        }
        updateCustomerSortArrows();
        renderCustomers();
      });
    });
    updateCustomerSortArrows();
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
        $("customers-panel").style.display = "block";
        $("customers-login-notice").style.display = "none";
        subscribeOrders();
      } else {
        $("orders-login").querySelector(".field-row").style.display = "grid";
        $("orders-login-btn").style.display = "inline-block";
        $("orders-logout-btn").style.display = "none";
        $("orders-panel").style.display = "none";
        $("customers-panel").style.display = "none";
        $("customers-login-notice").style.display = "block";
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
          renderCustomers();
          populateCustomerSelect();
          // Deja los pedidos disponibles para otras pestañas del panel (p.ej. Estadísticas)
          // sin que tengan que abrir su propia suscripción a Firestore.
          window.HA_LATEST_ORDERS = orders;
          window.dispatchEvent(new CustomEvent("ha-orders-updated", { detail: { orders } }));
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
      const resendEmailBtn = document.getElementById(`resend-email-${o.docId}`);
      if (resendEmailBtn) resendEmailBtn.addEventListener("click", () => resendCustomerEmail(o.docId));
      orderDesigns(o).forEach((ds, i) => {
        const viewDesignBtn = document.getElementById(`view-design-${o.docId}-${i}`);
        if (viewDesignBtn) viewDesignBtn.addEventListener("click", () => viewDesign(ds));
        const downloadBtn = document.getElementById(`download-design-${o.docId}-${i}`);
        if (downloadBtn) {
          downloadBtn.addEventListener("click", () => {
            const d = ds.design || {};
            downloadDesignFile(d.fileData, d.fileName, d.fileType);
          });
        }
      });
      const sendToCutBtn = document.getElementById(`send-to-cut-${o.docId}`);
      if (sendToCutBtn) sendToCutBtn.addEventListener("click", () => sendToCut(o.docId));
    });
  }

  // Convierte un data URL (base64) en un Blob decodificándolo a mano, sin usar fetch(): así no
  // depende de que "data:" esté permitido en connect-src del CSP de la página.
  function dataUrlToBlob(dataUrl, mimeType) {
    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.substring(5, comma); // p.ej. "application/pdf;base64"
    const type = mimeType || meta.replace(/;base64$/i, "") || "application/octet-stream";
    const binary = atob(dataUrl.substring(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  // Descarga el archivo original del cliente a partir del data URL guardado en el pedido.
  // Un <a href="data:..." download> directo falla en varios navegadores móviles (sobre todo
  // con tipos poco comunes como .dxf), así que se convierte a un Blob real antes de descargar,
  // que es el método con mejor soporte en iOS/Android.
  function downloadDesignFile(dataUrl, fileName, mimeType) {
    if (!dataUrl) return;
    try {
      const blob = dataUrlToBlob(dataUrl, mimeType);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "diseno";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      alert("No se pudo descargar el archivo: " + e.message);
    }
  }

  function viewDesign(ds) {
    const d = ds.design || {};
    if (!d.snapshot) return;
    const material = (ds.material && ds.material.label) || "";
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.innerHTML = `
      <div class="design-view-box">
        <button class="modal-close" id="design-view-close" aria-label="Cerrar">&times;</button>
        <div class="design-view-scroll">
          <img src="${escapeAttr(d.snapshot)}" alt="Diseño configurado por el cliente">
          <div class="design-view-caption">${escapeHtml(material)}${d.fileName ? " · " + escapeHtml(d.fileName) : ""}</div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    function close() {
      overlay.remove();
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector("#design-view-close").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
  }

  function renderRevenue() {
    const from = $("revenue-from").value ? new Date($("revenue-from").value + "T00:00:00") : null;
    const to = $("revenue-to").value ? new Date($("revenue-to").value + "T23:59:59") : null;
    const included = orders.filter((o) => {
      if (isDesignOrder(o)) return false;
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

  /* ---------------- CUSTOMERS (derivados de los pedidos) ---------------- */

  function customerKey(c) {
    const phone = waPhoneDigits(c.phone || "");
    if (phone) return "p:" + phone;
    const email = (c.email || "").trim().toLowerCase();
    if (email) return "e:" + email;
    const name = (c.name || "").trim().toLowerCase();
    return name ? "n:" + name : null;
  }

  function customersFromOrders() {
    const sorted = orders.slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const map = new Map();
    sorted.forEach((o) => {
      const c = o.customer || {};
      const s = o.shipping || {};
      const key = customerKey(c);
      if (!key) return;
      const prev = map.get(key) || { orderCount: 0, totalSpent: 0, firstOrderAt: o.createdAt };
      map.set(key, {
        key,
        name: c.name || prev.name || "",
        phone: c.phone || prev.phone || "",
        email: c.email || prev.email || "",
        address: s.address || prev.address || "",
        postalCode: s.postalCode || prev.postalCode || "",
        city: s.city || prev.city || "",
        province: s.province || prev.province || "",
        orderCount: prev.orderCount + 1,
        totalSpent: prev.totalSpent + (o.status === "cancelado" ? 0 : orderTotal(o)),
        firstOrderAt: prev.firstOrderAt || o.createdAt,
        lastOrderAt: o.createdAt,
      });
    });
    return Array.from(map.values()).sort((a, b) => String(b.lastOrderAt || "").localeCompare(String(a.lastOrderAt || "")));
  }

  function sortCustomers(list) {
    const getter = CUSTOMER_SORT_GETTERS[customerSort.field] || CUSTOMER_SORT_GETTERS.lastOrderAt;
    const dir = customerSort.dir === "asc" ? 1 : -1;
    return list.slice().sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      if (typeof av === "number" || typeof bv === "number") return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
      return String(av).localeCompare(String(bv), "es", { sensitivity: "base" }) * dir;
    });
  }

  function updateCustomerSortArrows() {
    document.querySelectorAll("#customers-thead-row [data-field]").forEach((th) => {
      const arrow = th.querySelector(".sort-arrow");
      if (!arrow) return;
      arrow.textContent = th.dataset.field === customerSort.field ? (customerSort.dir === "asc" ? " ▲" : " ▼") : "";
    });
  }

  function ordersForCustomer(key) {
    return orders
      .filter((o) => customerKey(o.customer || {}) === key)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  function renderCustomers() {
    const all = customersFromOrders();
    $("customers-count").textContent = all.length;
    const filter = ($("customer-filter").value || "").trim().toLowerCase();
    const filtered = filter
      ? all.filter(
          (c) =>
            c.name.toLowerCase().includes(filter) ||
            c.phone.toLowerCase().includes(filter) ||
            c.email.toLowerCase().includes(filter)
        )
      : all;
    const list = sortCustomers(filtered);
    if (!list.length) {
      $("customers-table-body").innerHTML = `<tr><td colspan="7" class="empty-state">No hay clientes que mostrar.</td></tr>`;
      return;
    }
    $("customers-table-body").innerHTML = list.map(customerRowsHtml).join("");

    list.forEach((c) => {
      const viewBtn = document.getElementById(`cust-view-${c.key}`);
      if (viewBtn)
        viewBtn.addEventListener("click", () => {
          expandedCustomerKey = expandedCustomerKey === c.key ? null : c.key;
          editingCustomerKey = null;
          renderCustomers();
        });
      const editBtn = document.getElementById(`cust-edit-${c.key}`);
      if (editBtn)
        editBtn.addEventListener("click", () => {
          editingCustomerKey = c.key;
          expandedCustomerKey = null;
          renderCustomers();
        });
      const delBtn = document.getElementById(`cust-del-${c.key}`);
      if (delBtn) delBtn.addEventListener("click", () => deleteCustomer(c.key));
      const mergeBtn = document.getElementById(`cust-merge-${c.key}`);
      if (mergeBtn) mergeBtn.addEventListener("click", () => mergePendingOrders(c.key));

      if (editingCustomerKey === c.key) {
        const saveBtn = document.getElementById(`cedit-save-${c.key}`);
        if (saveBtn) saveBtn.addEventListener("click", () => saveCustomerEdit(c.key));
        const cancelBtn = document.getElementById(`cedit-cancel-${c.key}`);
        if (cancelBtn)
          cancelBtn.addEventListener("click", () => {
            editingCustomerKey = null;
            renderCustomers();
          });
      }

      if (expandedCustomerKey === c.key) {
        ordersForCustomer(c.key).forEach((o) => {
          const openBtn = document.getElementById(`cust-order-open-${o.docId}`);
          if (openBtn) openBtn.addEventListener("click", () => openCustomerOrder(o.docId));
        });
      }
    });
  }

  function customerRowsHtml(c) {
    const key = escapeAttr(c.key);

    if (editingCustomerKey === c.key) {
      return `
        <tr>
          <td colspan="7">
            <div class="field-row">
              <div class="field"><label>Nombre *</label><input id="cedit-name-${key}" value="${escapeAttr(c.name)}"></div>
              <div class="field"><label>Teléfono *</label><input id="cedit-phone-${key}" value="${escapeAttr(c.phone)}"></div>
            </div>
            <div class="field-row">
              <div class="field"><label>Email</label><input id="cedit-email-${key}" type="email" value="${escapeAttr(c.email)}"></div>
              <div class="field"><label>Dirección</label><input id="cedit-address-${key}" value="${escapeAttr(c.address)}"></div>
            </div>
            <div class="field-row">
              <div class="field"><label>Código postal</label><input id="cedit-postal-${key}" value="${escapeAttr(c.postalCode)}"></div>
              <div class="field"><label>Ciudad</label><input id="cedit-city-${key}" value="${escapeAttr(c.city)}"></div>
              <div class="field"><label>Provincia</label><input id="cedit-province-${key}" value="${escapeAttr(c.province)}"></div>
            </div>
            <p class="help-text">Se actualizará en ${c.orderCount} pedido(s) de este cliente.</p>
            <div style="display:flex;gap:10px;margin-top:6px">
              <button class="btn btn-primary" id="cedit-save-${key}" type="button">Guardar</button>
              <button class="btn btn-outline" id="cedit-cancel-${key}" type="button">Cancelar</button>
            </div>
            <div id="cedit-status-${key}"></div>
          </td>
        </tr>`;
    }

    const waHref = c.phone ? `https://wa.me/${waPhoneDigits(c.phone)}` : null;
    const address = [c.address, [c.postalCode, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const mergeable = mergeablePendingOrders(c.key).length;
    const mainRow = `
      <tr>
        <td><b>${escapeHtml(c.name || "-")}</b></td>
        <td>
          ${c.phone ? `📞 ${escapeHtml(c.phone)}${waHref ? ` · <a href="${escapeAttr(waHref)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}<br>` : ""}
          ${c.email ? `✉️ ${escapeHtml(c.email)}` : ""}
        </td>
        <td>${escapeHtml(address)}${c.province ? ` (${escapeHtml(c.province)})` : ""}</td>
        <td>${c.orderCount}</td>
        <td>${formatPrice(c.totalSpent)}</td>
        <td>${formatDate(c.lastOrderAt)}</td>
        <td class="row-actions">
          <button class="small-btn" id="cust-view-${key}" type="button">📦 Pedidos</button>
          ${mergeable >= 2 ? `<button class="small-btn" id="cust-merge-${key}" type="button" title="Junta sus pedidos pendientes en uno solo, con un único envío">🔗 Agrupar pendientes (${mergeable})</button>` : ""}
          <button class="small-btn" id="cust-edit-${key}" type="button">✏️ Editar</button>
          <button class="small-btn danger" id="cust-del-${key}" type="button">🗑️ Borrar</button>
        </td>
      </tr>`;

    if (expandedCustomerKey !== c.key) return mainRow;

    const custOrders = ordersForCustomer(c.key);
    const detailRow = `
      <tr>
        <td colspan="7">
          <div style="display:flex;flex-direction:column;gap:6px">
            ${
              custOrders
                .map(
                  (o) => `
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--color-border)">
                <b>${escapeHtml(o.orderCode || o.docId)}</b>
                <span class="status-pill status-pill-${escapeAttr(o.status || "pendiente")}">${escapeHtml(capitalize(o.status || "pendiente"))}</span>
                <span>${formatDate(o.createdAt)}</span>
                <span>${formatPrice(orderTotal(o))}</span>
                <button class="small-btn" id="cust-order-open-${escapeAttr(o.docId)}" type="button">Ver / editar pedido</button>
              </div>`
                )
                .join("") || `<div class="empty-state">Sin pedidos.</div>`
            }
          </div>
        </td>
      </tr>`;
    return mainRow + detailRow;
  }

  function openCustomerOrder(docId) {
    document.querySelector('[data-tab="tab-orders"]').click();
    editOrder(docId);
  }

  async function deleteCustomer(key) {
    const c = customersFromOrders().find((x) => x.key === key);
    if (!c) return;
    const custOrders = ordersForCustomer(key);
    if (
      !confirm(
        `¿Borrar a "${c.name || c.phone || c.email}"? Se borrarán TODOS sus pedidos (${custOrders.length}) de forma permanente. Esta acción no se puede deshacer.`
      )
    )
      return;
    try {
      const db = firebase.firestore();
      const batch = db.batch();
      custOrders.forEach((o) => batch.delete(db.collection("orders").doc(o.docId)));
      await batch.commit();
      if (custOrders.some((o) => o.docId === editingDocId)) resetOrderForm();
      if (expandedCustomerKey === key) expandedCustomerKey = null;
      if (editingCustomerKey === key) editingCustomerKey = null;
    } catch (e) {
      alert("No se pudo borrar el cliente: " + e.message);
    }
  }

  // Diseños de un pedido: los del personalizador llevan uno (kind/material/design) y
  // los agrupados pueden llevar varios en designs[].
  function orderDesigns(o) {
    if (Array.isArray(o.designs)) return o.designs;
    if (!isDesignOrder(o)) return [];
    return [
      {
        kind: o.kind,
        orderCode: o.orderCode || o.docId,
        material: o.material || null,
        qty: ((o.items || [])[0] || {}).qty || 1,
        design: o.design || {},
        driveFolderUrl: o.driveFolderUrl || "",
      },
    ];
  }

  function mergeablePendingOrders(key) {
    return ordersForCustomer(key)
      .filter((o) => (o.status || "pendiente") === "pendiente")
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  // Suma en una sola línea el mismo producto al mismo precio y descuento.
  function mergeItems(items) {
    const out = [];
    items.forEach((it) => {
      const same = out.find(
        (x) =>
          (x.id || null) === (it.id || null) &&
          x.title === it.title &&
          Number(x.price) === Number(it.price) &&
          (Number(x.discountPercent) || 0) === (Number(it.discountPercent) || 0)
      );
      if (same) same.qty = (Number(same.qty) || 0) + (Number(it.qty) || 0);
      else out.push({ ...it });
    });
    return out;
  }

  // Firestore no admite documentos de más de 1 MiB; se deja margen para los nombres de campo.
  const MAX_ORDER_BYTES = 1000000;
  const docBytes = (obj) => new Blob([JSON.stringify(obj)]).size;

  // Se conserva el pedido más antiguo (su código y fecha) y los demás se borran. Los
  // datos del cliente se toman del más reciente, las notas se juntan y el envío se
  // cobra una sola vez (el más caro de los agrupados, para no quedarse corto). Los
  // diseños de placas/púas pasan a designs[], y sus líneas llevan el código del
  // pedido de origen para no confundir dos placas iguales al ponerles precio.
  async function mergePendingOrders(key) {
    const group = mergeablePendingOrders(key);
    if (group.length < 2) return;
    const [target, ...rest] = group;
    const newest = group[group.length - 1];
    const items = mergeItems(
      group.flatMap((o) =>
        (o.items || []).map((it) =>
          isDesignOrder(o) && !String(it.title).includes(o.orderCode) ? { ...it, title: `${it.title} · ${o.orderCode}` } : it
        )
      )
    );
    const subtotal = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    const shippingCost = Math.max(...group.map((o) => Number(o.shippingCost) || 0));
    const notes = [...new Set(group.map((o) => ((o.shipping && o.shipping.notes) || "").trim()).filter(Boolean))].join("\n");
    const codes = group.map((o) => o.orderCode || o.docId);
    const designs = group.flatMap(orderDesigns).map((ds) => ({ ...ds, design: { ...ds.design } }));

    const { docId, kind, design, material, ...base } = target;
    const merged = {
      ...base,
      items,
      subtotal,
      shippingCost,
      total: subtotal + shippingCost,
      paymentMethod: target.paymentMethod || (group.find((o) => o.paymentMethod) || {}).paymentMethod || "",
      customer: { ...(target.customer || {}), ...(newest.customer || {}) },
      shipping: { ...(target.shipping || {}), ...(newest.shipping || {}), notes },
      mergedFrom: [...(target.mergedFrom || []), ...rest.flatMap((o) => [...(o.mergedFrom || []), o.orderCode || o.docId])],
    };
    if (designs.length) merged.designs = designs;
    // Si alguno ya se exportó a Drive no se vuelve a mandar el aviso de pedido nuevo.
    const exportedAt = group.map((o) => o.driveExportedAt).find(Boolean);
    if (exportedAt) merged.driveExportedAt = exportedAt;

    // Si no cabe, se quitan los archivos originales que ya están en Drive (se enlaza la carpeta).
    const dropped = [];
    for (const ds of designs) {
      if (docBytes(merged) <= MAX_ORDER_BYTES) break;
      if (ds.design.fileData && ds.driveFolderUrl) {
        ds.design.fileData = null;
        ds.design.fileInDrive = true;
        dropped.push(ds.design.fileName || ds.orderCode);
      }
    }
    if (docBytes(merged) > MAX_ORDER_BYTES) {
      alert("No se pueden agrupar: los diseños juntos pesan más de lo que admite un pedido (1 MB).");
      return;
    }

    if (
      !confirm(
        `¿Agrupar ${group.length} pedidos pendientes (${codes.join(", ")}) en el pedido ${codes[0]}?\n\n` +
          `Total: ${formatPrice(subtotal + shippingCost)} (envío ${formatPrice(shippingCost)}, cobrado una sola vez).\n` +
          (designs.length ? `Incluye ${designs.length} diseño(s) personalizado(s).\n` : "") +
          (dropped.length ? `Para que quepa, estos archivos se quedan solo en Drive: ${dropped.join(", ")}.\n` : "") +
          `Los pedidos ${codes.slice(1).join(", ")} se borrarán.`
      )
    )
      return;

    try {
      const db = firebase.firestore();
      const batch = db.batch();
      batch.set(db.collection("orders").doc(target.docId), merged);
      rest.forEach((o) => batch.delete(db.collection("orders").doc(o.docId)));
      await batch.commit();
      if (group.some((o) => o.docId === editingDocId)) resetOrderForm();
      expandedCustomerKey = key;
    } catch (e) {
      alert("No se pudieron agrupar los pedidos: " + e.message);
    }
  }

  async function saveCustomerEdit(key) {
    const name = $(`cedit-name-${key}`).value.trim();
    const phone = $(`cedit-phone-${key}`).value.trim();
    if (!name || !phone) {
      setInlineStatus(`cedit-status-${key}`, "err", "El nombre y el teléfono son obligatorios.");
      return;
    }
    const email = $(`cedit-email-${key}`).value.trim();
    const address = $(`cedit-address-${key}`).value.trim();
    const postalCode = $(`cedit-postal-${key}`).value.trim();
    const city = $(`cedit-city-${key}`).value.trim();
    const province = $(`cedit-province-${key}`).value.trim();

    const custOrders = ordersForCustomer(key);
    const saveBtn = $(`cedit-save-${key}`);
    if (saveBtn) saveBtn.disabled = true;
    setInlineStatus(`cedit-status-${key}`, "info", "Guardando...");
    try {
      const db = firebase.firestore();
      const batch = db.batch();
      custOrders.forEach((o) => {
        batch.update(db.collection("orders").doc(o.docId), {
          "customer.name": name,
          "customer.phone": phone,
          "customer.email": email,
          "shipping.address": address,
          "shipping.postalCode": postalCode,
          "shipping.city": city,
          "shipping.province": province,
        });
      });
      await batch.commit();
      editingCustomerKey = null;
      renderCustomers();
    } catch (e) {
      setInlineStatus(`cedit-status-${key}`, "err", "No se pudo guardar: " + e.message);
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function setInlineStatus(elId, type, msg) {
    const el = $(elId);
    if (!el) return;
    el.innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
  }

  function populateCustomerSelect() {
    const sel = $("o-customer-select");
    const current = sel.value;
    const list = customersFromOrders();
    sel.innerHTML =
      '<option value="">— Nuevo cliente —</option>' +
      list
        .map(
          (c) =>
            `<option value="${escapeAttr(c.key)}">${escapeHtml(c.name || "(sin nombre)")}${c.phone ? " · " + escapeHtml(c.phone) : ""}</option>`
        )
        .join("");
    if (list.some((c) => c.key === current)) sel.value = current;
  }

  function onCustomerSelectChange() {
    const key = $("o-customer-select").value;
    if (!key) return;
    const c = customersFromOrders().find((x) => x.key === key);
    if (!c) return;
    $("o-name").value = c.name || "";
    $("o-phone").value = c.phone || "";
    $("o-email").value = c.email || "";
    $("o-address").value = c.address || "";
    $("o-postal").value = c.postalCode || "";
    $("o-city").value = c.city || "";
    $("o-province").value = c.province || "";
  }

  function orderCard(o) {
    const designs = orderDesigns(o);
    const design = designs.length > 0;
    const many = designs.length > 1;
    const designLabel = many ? `${designs.length} diseños personalizados` : design ? DESIGN_KINDS[designs[0].kind] || "Diseño personalizado" : "";
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
    const id = escapeAttr(o.docId);
    const designButtons = designs
      .map((ds, i) => {
        const d = ds.design || {};
        const n = many ? " " + (i + 1) : "";
        return (
          (d.snapshot ? `<button class="small-btn" id="view-design-${id}-${i}" type="button" title="Ver el diseño tal y como lo configuró el cliente">👁️ Ver diseño${n}</button>` : "") +
          (d.fileData ? `<button class="small-btn" id="download-design-${id}-${i}" type="button" title="Descargar el archivo original subido por el cliente">📥 Descargar archivo${n}</button>` : "")
        );
      })
      .join("");
    const designBlocks = designs
      .map((ds, i) => {
        const d = ds.design || {};
        const material = (ds.material && ds.material.label) || "Sin especificar";
        return `
            ${many ? `<div class="order-total-row" style="margin-top:${i ? 14 : 0}px"><b>Diseño ${i + 1} · ${escapeHtml(DESIGN_KINDS[ds.kind] || "Diseño")} · ${escapeHtml(ds.orderCode || "")}</b></div>` : ""}
            ${d.snapshot ? `<img src="${escapeAttr(d.snapshot)}" alt="Diseño configurado por el cliente" style="width:100%;max-width:220px;border-radius:10px;border:1px solid var(--color-border);margin-bottom:10px">` : ""}
            <div class="order-totals">
              <div class="order-total-row"><span>Material</span><b>${escapeHtml(material)}</b></div>
              ${many ? `<div class="order-total-row"><span>Cantidad</span><span>${Number(ds.qty) || 1}</span></div>` : ""}
              ${d.fileName ? `<div class="order-total-row"><span>Archivo</span><span>${escapeHtml(d.fileName)}</span></div>` : ""}
            </div>
            ${d.fileTooLargeToEmbed ? `<p class="help-text">El archivo original era demasiado grande para adjuntarlo aquí: pide al cliente que te lo reenvíe por WhatsApp o email.</p>` : ""}
            ${d.fileInDrive && ds.driveFolderUrl ? `<p class="help-text">El archivo original está en <a href="${escapeAttr(ds.driveFolderUrl)}" target="_blank" rel="noopener">su carpeta de Drive</a>.</p>` : ""}`;
      })
      .join("");
    const priced = itemsSum > 0;

    return `
      <article class="order-card status-${escapeAttr(status)}" id="order-card-${escapeAttr(o.docId)}">
        <div class="order-card-head">
          <div class="order-head-title">
            <b>${escapeHtml(o.orderCode || o.docId)}</b>
            <span class="status-pill status-pill-${escapeAttr(status)}">${escapeHtml(capitalize(status))}</span>
            ${design ? `<span class="status-pill" style="background:#eee7f6;color:#5b3fa0">🎨 ${escapeHtml(designLabel)}</span>` : ""}
            <span class="order-date">${date}</span>
          </div>
          <div class="order-head-actions">
            <select id="status-${escapeAttr(o.docId)}" class="order-status-select">
              ${["pendiente", "confirmado", "enviado", "entregado", "cancelado"]
                .map((s2) => `<option value="${s2}" ${status === s2 ? "selected" : ""}>${capitalize(s2)}</option>`)
                .join("")}
            </select>
            ${designButtons}
            ${design ? `<button class="small-btn" id="send-to-cut-${escapeAttr(o.docId)}" type="button" title="Sube el diseño, el archivo del cliente y la nota del pedido a la carpeta compartida de Drive">✂️ Enviar a cortar</button>` : ""}
            ${design && o.driveFolderUrl ? `<a class="small-btn" href="${escapeAttr(o.driveFolderUrl)}" target="_blank" rel="noopener" title="Abrir la carpeta del pedido en Drive">📁 Drive</a>` : ""}
            <button class="small-btn" id="label-${escapeAttr(o.docId)}" type="button" title="Imprimir etiqueta de envío">🏷️ Etiqueta</button>
            <button class="small-btn" id="albaran-${escapeAttr(o.docId)}" type="button" title="Descargar albarán en PDF">📄 Albarán</button>
            ${c.phone ? `<button class="small-btn" id="wa-albaran-${escapeAttr(o.docId)}" type="button" title="Enviar el presupuesto/albarán por WhatsApp al cliente">📲 ${design ? "Presupuesto" : "Albarán"} WhatsApp</button>` : ""}
            ${c.email ? `<button class="small-btn" id="resend-email-${escapeAttr(o.docId)}" type="button" title="Reenviar el email de confirmación al cliente">✉️ Reenviar email</button>` : ""}
            ${o.trackingNumber ? `<a class="small-btn" href="${escapeAttr(CORREOS_TRACKING_URL + encodeURIComponent(o.trackingNumber))}" target="_blank" rel="noopener" title="Ver seguimiento del envío en Correos">🚚 Seguimiento</a>` : ""}
            <button class="small-btn" id="edit-${escapeAttr(o.docId)}" type="button">✏️ Editar</button>
            <button class="small-btn danger" id="del-${escapeAttr(o.docId)}" type="button">🗑️ Borrar</button>
          </div>
        </div>
        <div class="order-card-body">
          <div class="order-items-block">
            ${designBlocks}
            ${
              design && !priced
                ? `<p class="help-text">Todavía sin presupuestar: pulsa "✏️ Editar" para introducir el precio de las unidades y el envío.</p>`
                : `<div class="order-items">${itemsHtml}</div>
            <div class="order-totals">
              <div class="order-total-row"><span>Productos</span><span>${formatPrice(itemsSum)}</span></div>
              ${shippingCost > 0 ? `<div class="order-total-row"><span>Envío</span><span>${formatPrice(shippingCost)}</span></div>` : ""}
              <div class="order-total-row order-total-grand"><span>Total</span><b>${formatPrice(total)}</b></div>
            </div>`
            }
          </div>
          <div class="order-customer">
            <div class="order-customer-name">${escapeHtml(c.name || "-")}</div>
            <div class="order-customer-line">📞 ${escapeHtml(c.phone || "-")} ${waHref ? `· <a href="${waHref}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</div>
            ${c.email ? `<div class="order-customer-line">✉️ ${escapeHtml(c.email)}</div>` : ""}
            ${s.address ? `<div class="order-customer-line order-address">📍 ${escapeHtml(s.address || "")}, ${escapeHtml(s.postalCode || "")} ${escapeHtml(s.city || "")} ${s.province ? "(" + escapeHtml(s.province) + ")" : ""}</div>` : ""}
            ${o.paymentMethod ? `<div class="order-customer-line">💳 ${escapeHtml(paymentLabel(o.paymentMethod))}</div>` : ""}
            ${s.notes ? `<div class="order-notes">📝 ${escapeHtml(s.notes)}</div>` : ""}
            ${o.mergedFrom && o.mergedFrom.length ? `<div class="order-customer-line">🔗 Agrupa también: ${escapeHtml(o.mergedFrom.join(", "))}</div>` : ""}
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
    .albaran-payment-note{margin-top:14px;padding:10px 12px;border:1px solid #245F96;border-radius:6px;background:#eaf2fb;font-size:12.5px;color:#1c2b36}
    @media print{ .albaran{margin-bottom:0} }
  `;

  function paymentInstructions(method) {
    const CONFIRM = "Te enviaremos la confirmación por WhatsApp en breve.";
    if (method === "bizum") return `Realiza el Bizum al número 653713428. ${CONFIRM}`;
    if (method === "paypal") return `Envía el pago de PayPal a hezuradar@gmail.com como familiar o amigo. ${CONFIRM}`;
    return null;
  }

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
      ${paymentInstructions(o.paymentMethod) ? `<div class="albaran-payment-note">${escapeHtml(paymentInstructions(o.paymentMethod))}</div>` : ""}
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
    const designs = orderDesigns(o);
    const design = designs.length > 0;
    const shippingCost = Number(o.shippingCost) || 0;
    const itemsSum = (o.items || []).reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    const total = orderTotal(o);
    const lines = (o.items || [])
      .map((it) => `▫️ ${it.qty}x ${it.title} — *${formatPrice(it.price * it.qty)}*`)
      .join("\n");
    const address = [s.address, [s.postalCode, s.city].filter(Boolean).join(" "), s.province]
      .filter(Boolean)
      .join(", ");

    return [
      design
        ? `🎨 *Presupuesto · ${designs.length > 1 ? "Diseños personalizados" : DESIGN_KINDS[designs[0].kind] || "Diseño personalizado"}*`
        : `📄 *Albarán de entrega*`,
      `Pedido ${o.orderCode || o.docId}`,
      "",
      ...designs.flatMap((ds) => [
        `🧩 Material: ${(ds.material && ds.material.label) || "-"}${designs.length > 1 ? ` (${ds.orderCode})` : ""}`,
        ds.design && ds.design.fileName ? `📎 Archivo: ${ds.design.fileName}` : null,
      ]),
      design ? "" : null,
      "🛒 *Detalle:*",
      lines,
      "―――――――――――――",
      `Subtotal: ${formatPrice(itemsSum)}`,
      shippingCost > 0 ? `Envío: ${formatPrice(shippingCost)}` : null,
      `*Total: ${formatPrice(total)}*`,
      "",
      paymentInstructions(o.paymentMethod) ? `💳 ${paymentInstructions(o.paymentMethod)}` : null,
      paymentInstructions(o.paymentMethod) ? "" : null,
      address ? "📍 *Enviar a:*" : null,
      address ? c.name || "" : null,
      address || null,
      "",
      "Gracias por confiar en HezurAdar 🦴",
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

  // Sube a la carpeta compartida de Drive (cliente/pedido) el diseño, el archivo
  // original del cliente y la nota del pedido en PDF, y abre la carpeta. Lo hace
  // la aplicación web de Apps Script (scripts/drive-export), que guarda además el
  // enlace en driveFolderUrl. Si ya se exportó al cerrar el pedido, lo reemplaza
  // con los datos actuales (p.ej. el precio del presupuesto).
  async function sendToCut(docId) {
    const o = orders.find((x) => x.docId === docId);
    if (!o) return;
    if (!window.HA_DRIVE || !window.HA_DRIVE.enabled) {
      alert("La exportación a Drive no está configurada todavía: sigue la sección 7 del README.");
      return;
    }
    const btn = document.getElementById(`send-to-cut-${docId}`);
    // La ventana se abre ya, dentro del clic, para que el navegador no la bloquee
    // al abrirla después de la espera.
    const win = window.open("", "_blank");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ Subiendo a Drive...";
    }
    try {
      const res = await window.HA_DRIVE.exportOrder(docId);
      if (win) win.location.href = res.folderUrl;
      if (res.fileMissing) {
        alert("Subido a Drive, pero falta el archivo original del cliente (era demasiado grande): pídeselo y añádelo a la carpeta.");
      }
    } catch (e) {
      if (win) win.close();
      alert("No se pudo subir a Drive: " + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "✂️ Enviar a cortar";
      }
    }
  }

  async function resendCustomerEmail(docId) {
    const o = orders.find((x) => x.docId === docId);
    if (!o) return;
    const c = o.customer || {};
    if (!c.email) {
      alert("Este pedido no tiene email de cliente.");
      return;
    }
    if (!window.HA_EMAIL || !window.HA_EMAIL.sendCustomerOrderEmail) {
      alert("El envío de email no está disponible en este panel.");
      return;
    }
    const btn = document.getElementById(`resend-email-${docId}`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Enviando...";
    }
    try {
      await window.HA_EMAIL.sendCustomerOrderEmail(o);
      alert(`Email de confirmación reenviado a ${c.email}.`);
    } catch (e) {
      alert("No se pudo enviar el email: " + ((e && (e.text || e.message)) || e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "✉️ Reenviar email";
      }
    }
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
    $("o-customer-select").value = "";
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
    $("o-customer-select").value = "";
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

    // Las solicitudes de diseño (placas, púas...) guardan además el material y el diseño
    // subido por el cliente: al editarlas (p.ej. para poner precio y envío) hay que
    // conservar esos campos, que el formulario de pedido normal no gestiona.
    if (existing && isDesignOrder(existing)) {
      order.kind = existing.kind;
      order.design = existing.design;
      order.material = existing.material;
    }
    // Lo mismo con los diseños de un pedido agrupado y con lo que guarda la exportación a Drive.
    if (existing) {
      ["designs", "mergedFrom", "driveFolderUrl", "driveExportedAt"].forEach((k) => {
        if (existing[k] !== undefined) order[k] = existing[k];
      });
    }

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
