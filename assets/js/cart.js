(function () {
  "use strict";

  const LS_CART = "ha_cart";
  const SHIPPING_COST = 5.5;
  const SHIPPING_FREE_MAX_ITEMS = 2;
  let cart = loadCart();
  let view = "cart"; // 'cart' | 'checkout' | 'success'
  let lastOrder = null;
  let submitting = false;

  document.addEventListener("DOMContentLoaded", () => {
    updateBadge();
    const btn = document.getElementById("cart-btn");
    if (btn) btn.addEventListener("click", () => openDrawer("cart"));
  });
  document.addEventListener("ha:ready", updateBadge);

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_CART));
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  }
  function persist() {
    localStorage.setItem(LS_CART, JSON.stringify(cart));
    updateBadge();
  }

  function add(id, qty) {
    const product = getProducts().find((x) => x.id === id);
    if (product && window.HA && window.HA.isOutOfStock && window.HA.isOutOfStock(product)) return;
    const line = cart.find((c) => c.id === id);
    if (line) line.qty += qty;
    else cart.push({ id, qty });
    persist();
    openDrawer("cart");
  }
  function setQty(id, qty) {
    const line = cart.find((c) => c.id === id);
    if (!line) return;
    if (qty <= 0) return removeItem(id);
    line.qty = qty;
    persist();
    renderDrawer();
  }
  function removeItem(id) {
    cart = cart.filter((c) => c.id !== id);
    persist();
    renderDrawer();
  }
  function clearCart() {
    cart = [];
    persist();
  }
  function count() {
    return cart.reduce((s, c) => s + c.qty, 0);
  }
  function getProducts() {
    return (window.HA && window.HA.products) || [];
  }
  function effectivePrice(p) {
    if (window.HA && window.HA.effectivePrice) return window.HA.effectivePrice(p);
    return p.price;
  }

  function lines() {
    const products = getProducts();
    return cart
      .map((c) => {
        const p = products.find((x) => x.id === c.id);
        if (!p) return null;
        const price = effectivePrice(p);
        return { id: c.id, qty: c.qty, product: p, price, lineTotal: price * c.qty };
      })
      .filter(Boolean);
  }
  function subtotal() {
    return lines().reduce((s, l) => s + l.lineTotal, 0);
  }
  function shippingCost() {
    return count() > SHIPPING_FREE_MAX_ITEMS ? SHIPPING_COST : 0;
  }

  function updateBadge() {
    const badge = document.getElementById("cart-badge");
    if (!badge) return;
    const n = count();
    badge.textContent = n;
    badge.style.display = n > 0 ? "flex" : "none";
  }

  function formatPrice(n) {
    if (window.HA && window.HA.formatPrice) return window.HA.formatPrice(n);
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
  }

  function openDrawer(v) {
    view = v || "cart";
    renderDrawer();
    document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    const root = document.getElementById("cart-root");
    if (root) root.innerHTML = "";
    document.body.style.overflow = "";
  }

  function renderDrawer() {
    const root = document.getElementById("cart-root");
    if (!root) return;
    let inner;
    if (view === "success") inner = successTemplate();
    else if (view === "checkout") inner = checkoutTemplate();
    else inner = cartTemplate();

    const isCheckout = view === "checkout" ? " checkout-view" : "";
    root.innerHTML = `
      <div class="cart-backdrop${isCheckout}" id="cart-backdrop">
        <aside class="cart-drawer${isCheckout}">
          <button class="modal-close" id="cart-close" aria-label="Cerrar">&times;</button>
          ${inner}
        </aside>
      </div>
    `;
    document.getElementById("cart-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "cart-backdrop") closeDrawer();
    });
    document.getElementById("cart-close").addEventListener("click", closeDrawer);
    bindViewEvents();
  }

  function cartTemplate() {
    const list = lines();
    if (!list.length) {
      return `
        <h3>Tu cesta</h3>
        <div class="empty-state">Tu cesta está vacía.</div>
      `;
    }
    return `
      <h3>Tu cesta</h3>
      <div class="cart-lines">
        ${list
          .map(
            (l) => `
          <div class="cart-line">
            <img src="${(l.product.images && l.product.images[0]) || ""}" alt="">
            <div class="cart-line-info">
              <div class="cart-line-title">${escapeHtml(l.product.title)}</div>
              <div class="cart-line-price">${
                l.product.discountPercent
                  ? `<span class="price-old">${formatPrice(l.product.price)}</span> ${formatPrice(l.price)}`
                  : formatPrice(l.price)
              }</div>
              <div class="qty-stepper qty-stepper-sm">
                <button type="button" data-dec="${l.id}">&minus;</button>
                <input type="number" min="1" value="${l.qty}" data-qty="${l.id}">
                <button type="button" data-inc="${l.id}">+</button>
              </div>
            </div>
            <button class="cart-line-remove" data-remove="${l.id}" aria-label="Quitar">&times;</button>
          </div>
        `
          )
          .join("")}
      </div>
      <div class="cart-summary">
        ${shippingSummaryHtml()}
        <button class="btn btn-primary" id="go-checkout" style="width:100%">Finalizar pedido</button>
      </div>
    `;
  }

  function shippingSummaryHtml() {
    const shipping = shippingCost();
    if (shipping <= 0) {
      return `
        <div class="cart-subtotal"><span>Subtotal</span><b>${formatPrice(subtotal())}</b></div>
        <p class="help-text">Los gastos de envío se confirman por WhatsApp.</p>
      `;
    }
    return `
      <div class="cart-mini-line"><span>Subtotal</span><span>${formatPrice(subtotal())}</span></div>
      <div class="cart-mini-line"><span>Envío certificado</span><span>${formatPrice(shipping)}</span></div>
      <div class="cart-subtotal"><span>Total</span><b>${formatPrice(subtotal() + shipping)}</b></div>
    `;
  }

  const PAYMENT_METHODS = [
    { value: "paypal", label: "PayPal", img: "images/site/payment/paypal.png" },
    { value: "bizum", label: "Bizum", img: "images/site/payment/bizum.png" },
    { value: "otros", label: "Otros", img: "images/site/payment/otros.png" },
  ];
  const PAYMENT_LABELS = PAYMENT_METHODS.reduce((m, p) => ((m[p.value] = p.label), m), {});

  function checkoutTemplate() {
    const list = lines();
    return `
      <h3>Revisa y confirma tu pedido</h3>
      <div class="checkout-order-card">
        <div class="checkout-order-lines">
          ${list
            .map(
              (l) => `
            <div class="checkout-order-line">
              <img src="${(l.product.images && l.product.images[0]) || ""}" alt="">
              <div class="checkout-order-line-info">
                <div class="checkout-order-line-title">${escapeHtml(l.product.title)}</div>
                <div class="checkout-order-line-qty">${l.qty} × ${formatPrice(l.price)}</div>
              </div>
              <div class="checkout-order-line-price">${formatPrice(l.lineTotal)}</div>
            </div>
          `
            )
            .join("")}
        </div>
        <div class="cart-summary cart-summary-compact">
          ${shippingSummaryHtml()}
        </div>
      </div>
      <form id="checkout-form">
        <h4 class="checkout-section-title">Tus datos</h4>
        <div class="field">
          <label>Nombre y apellidos *</label>
          <input required name="name" id="co-name" placeholder="Nombre completo">
        </div>
        <div class="field-row">
          <div class="field">
            <label>Teléfono *</label>
            <input required name="phone" id="co-phone" placeholder="+34 600 000 000">
          </div>
          <div class="field">
            <label>Email</label>
            <input type="email" name="email" id="co-email" placeholder="tucorreo@ejemplo.com">
          </div>
        </div>
        <div class="field">
          <label>Dirección de envío *</label>
          <input required name="address" id="co-address" placeholder="Calle, número, piso">
        </div>
        <div class="field-row">
          <div class="field">
            <label>Código postal *</label>
            <input required name="postalCode" id="co-postal" placeholder="20230">
          </div>
          <div class="field">
            <label>Ciudad *</label>
            <input required name="city" id="co-city" placeholder="Legazpi">
          </div>
        </div>
        <div class="field">
          <label>Provincia</label>
          <input name="province" id="co-province" placeholder="Gipuzkoa">
        </div>
        <div class="field">
          <label>Notas del pedido (opcional)</label>
          <textarea name="notes" id="co-notes" placeholder="Instrucciones de entrega, preferencias..."></textarea>
        </div>

        <h4 class="checkout-section-title">Forma de pago *</h4>
        <div class="payment-methods">
          ${PAYMENT_METHODS.map(
            (p) => `
            <label class="payment-method-btn">
              <input type="radio" name="paymentMethod" value="${p.value}" required>
              <img src="${p.img}" alt="${escapeHtml(p.label)}">
            </label>
          `
          ).join("")}
        </div>

        <div id="checkout-status"></div>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button type="button" class="btn btn-outline" id="back-to-cart">Volver a la cesta</button>
          <button type="submit" class="btn btn-primary" id="confirm-order" style="flex:1">Confirmar pedido</button>
        </div>
      </form>
    `;
  }

  function successTemplate() {
    const email = lastOrder && lastOrder.customer && lastOrder.customer.email;
    return `
      <h3>¡Pedido enviado!</h3>
      <div class="status-msg ok">Pedido ${escapeHtml((lastOrder && lastOrder.orderCode) || "")} recibido.</div>
      <p>Tu pedido será tramitado, nos pondremos en contacto contigo en breve para concretar los
      detalles pendientes, gracias por tu compra.</p>
      <p class="help-text">Hemos abierto WhatsApp con el resumen de tu pedido. Si no se ha abierto
      automáticamente, contáctanos directamente para confirmarlo.${
        email ? ` También te hemos enviado la confirmación a <b>${escapeHtml(email)}</b>.` : ""
      }</p>
      <button class="btn btn-primary" id="continue-shopping" style="width:100%">Seguir comprando</button>
    `;
  }

  function bindViewEvents() {
    if (view === "cart") {
      document.querySelectorAll("[data-inc]").forEach((b) =>
        b.addEventListener("click", () => {
          const line = cart.find((c) => c.id === b.dataset.inc);
          setQty(b.dataset.inc, (line ? line.qty : 0) + 1);
        })
      );
      document.querySelectorAll("[data-dec]").forEach((b) =>
        b.addEventListener("click", () => {
          const line = cart.find((c) => c.id === b.dataset.dec);
          setQty(b.dataset.dec, (line ? line.qty : 1) - 1);
        })
      );
      document.querySelectorAll("[data-qty]").forEach((inp) =>
        inp.addEventListener("change", () => {
          setQty(inp.dataset.qty, Math.max(1, parseInt(inp.value, 10) || 1));
        })
      );
      document.querySelectorAll("[data-remove]").forEach((b) =>
        b.addEventListener("click", () => removeItem(b.dataset.remove))
      );
      const goCheckout = document.getElementById("go-checkout");
      if (goCheckout) goCheckout.addEventListener("click", () => openDrawer("checkout"));
    } else if (view === "checkout") {
      document.getElementById("back-to-cart").addEventListener("click", () => openDrawer("cart"));
      document.getElementById("checkout-form").addEventListener("submit", onSubmitCheckout);
      document.querySelectorAll('input[name="paymentMethod"]').forEach((input) => {
        input.addEventListener("change", () => {
          document.querySelectorAll(".payment-method-btn").forEach((btn) => btn.classList.remove("selected"));
          input.closest(".payment-method-btn").classList.add("selected");
        });
      });
    } else if (view === "success") {
      document.getElementById("continue-shopping").addEventListener("click", closeDrawer);
    }
  }

  async function onSubmitCheckout(e) {
    e.preventDefault();
    if (submitting) return;
    if (!lines().length) return;
    const form = e.target;
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.name || !data.phone || !data.address || !data.postalCode || !data.city) {
      setCheckoutStatus("err", "Rellena los campos obligatorios (*).");
      return;
    }
    if (!data.paymentMethod) {
      setCheckoutStatus("err", "Elige una forma de pago.");
      return;
    }
    submitting = true;
    const submitBtn = document.getElementById("confirm-order");
    if (submitBtn) submitBtn.disabled = true;
    setCheckoutStatus("info", "Procesando pedido...");

    // Se abre ya (de forma síncrona, dentro del gesto de clic) para que los
    // navegadores móviles no bloqueen la ventana emergente tras los `await` siguientes.
    const waWindow = window.open("", "_blank");

    const orderLines = lines();
    const orderSubtotal = subtotal();
    const orderShipping = shippingCost();
    const order = {
      orderCode: genOrderCode(),
      createdAt: new Date().toISOString(),
      status: "pendiente",
      items: orderLines.map((l) => ({
        id: l.product.id,
        title: l.product.title,
        price: l.price,
        originalPrice: l.product.price,
        discountPercent: Number(l.product.discountPercent) || 0,
        qty: l.qty,
        image: (l.product.images && l.product.images[0]) || "",
      })),
      subtotal: orderSubtotal,
      shippingCost: orderShipping,
      total: orderSubtotal + orderShipping,
      paymentMethod: data.paymentMethod,
      customer: { name: data.name.trim(), phone: data.phone.trim(), email: (data.email || "").trim() },
      shipping: {
        address: data.address.trim(),
        postalCode: data.postalCode.trim(),
        city: data.city.trim(),
        province: (data.province || "").trim(),
        notes: (data.notes || "").trim(),
      },
    };

    try {
      if (window.HA_DB && window.HA_DB.saveOrder) {
        await window.HA_DB.saveOrder(order);
      }
    } catch (err) {
      console.error("No se pudo guardar el pedido en la base de datos:", err);
    }

    try {
      if (window.HA_EMAIL && window.HA_EMAIL.sendOrderEmail) {
        await window.HA_EMAIL.sendOrderEmail(order);
      }
    } catch (err) {
      console.error("No se pudo enviar el email del pedido:", err);
    }

    try {
      if (window.HA_EMAIL && window.HA_EMAIL.sendCustomerOrderEmail) {
        await window.HA_EMAIL.sendCustomerOrderEmail(order);
      }
    } catch (err) {
      console.error("No se pudo enviar el email de confirmación al cliente:", err);
    }

    const phone = (window.HA && window.HA.store && window.HA.store.whatsapp) || "";
    const text = buildWhatsAppMessage(order);
    if (phone) {
      const waUrl = `https://wa.me/${phone.replace("+", "")}?text=${encodeURIComponent(text)}`;
      if (waWindow) {
        waWindow.location.href = waUrl;
      } else {
        // La ventana previa fue bloqueada igualmente: último intento.
        window.open(waUrl, "_blank");
      }
    } else if (waWindow) {
      waWindow.close();
    }

    lastOrder = order;
    clearCart();
    submitting = false;
    if (submitBtn) submitBtn.disabled = false;
    openDrawer("success");
  }

  function setCheckoutStatus(type, msg) {
    const el = document.getElementById("checkout-status");
    if (!el) return;
    el.innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
  }

  function buildWhatsAppMessage(order) {
    const lines = order.items
      .map((it) => `- ${it.qty}x ${it.title}${it.discountPercent ? ` (-${it.discountPercent}%)` : ""} — ${formatPrice(it.price * it.qty)}`)
      .join("\n");
    const s = order.shipping;
    const c = order.customer;
    return [
      `🛒 *Nuevo pedido ${order.orderCode}*`,
      "",
      "Productos:",
      lines,
      "",
      `Subtotal: ${formatPrice(order.subtotal)}`,
      order.shippingCost ? `Envío certificado: ${formatPrice(order.shippingCost)}` : null,
      order.shippingCost ? `Total: ${formatPrice(order.total)}` : null,
      "",
      `Forma de pago: ${PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod || "-"}`,
      "",
      "Datos de envío:",
      `Nombre: ${c.name}`,
      `Teléfono: ${c.phone}`,
      c.email ? `Email: ${c.email}` : null,
      `Dirección: ${s.address}, ${s.postalCode} ${s.city}${s.province ? " (" + s.province + ")" : ""}`,
      s.notes ? `Notas: ${s.notes}` : null,
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  function genOrderCode() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `HA-${ymd}-${rand}`;
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

  window.HA = window.HA || {};
  window.HA.cart = { add, setQty, removeItem, clearCart, count, lines, subtotal, openDrawer, closeDrawer };
})();
