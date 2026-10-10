(function () {
  "use strict";

  const LS_CART = "ha_cart";
  const SHIPPING_COST = 5.5;
  const SHIPPING_FREE_MAX_ITEMS = 1;
  const MAX_QTY = 999;
  let cart = loadCart();
  let view = "cart"; // 'cart' | 'checkout' | 'success'
  let lastOrder = null;
  let submitting = false;
  // Pedido en curso: se reutilizan el código y el ID del documento en los reintentos
  // para que un pedido que llegó tarde a Firestore no se guarde dos veces.
  let pendingOrder = null;
  let lastFocus = null;

  document.addEventListener("DOMContentLoaded", () => {
    updateBadge();
    const btn = document.getElementById("cart-btn");
    if (btn) btn.addEventListener("click", () => openDrawer("cart"));
  });
  document.addEventListener("ha:ready", () => {
    pruneCart();
    updateBadge();
    // Si la cesta se abrió antes de que llegara el catálogo, se veía vacía: se repinta.
    if (document.getElementById("cart-backdrop") && view === "cart") renderDrawer();
  });
  // Otra pestaña (o volver con "atrás" tras un pedido) puede haber cambiado la cesta.
  window.addEventListener("storage", (e) => {
    if (e.key === LS_CART) reloadCart();
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) reloadCart();
  });

  function reloadCart() {
    cart = loadCart();
    pruneCart();
    updateBadge();
    if (document.getElementById("cart-backdrop") && view === "cart") renderDrawer();
  }

  function validQty(q) {
    return Number.isInteger(q) && q > 0;
  }
  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_CART));
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((c) => c && typeof c.id === "string" && validQty(c.qty))
        .map((c) => ({ id: c.id, qty: Math.min(c.qty, MAX_QTY) }));
    } catch (e) {
      return [];
    }
  }
  // Sin almacenamiento (modo privado, cuota llena) la cesta sigue funcionando en memoria.
  function persist() {
    try {
      localStorage.setItem(LS_CART, JSON.stringify(cart));
    } catch (e) {
      console.warn("No se pudo guardar la cesta en este navegador:", e);
    }
    updateBadge();
  }

  // Quita de la cesta lo que ya no existe en el catálogo y ajusta las cantidades al stock.
  // Solo se hace con el catálogo cargado, para no vaciar la cesta mientras llega.
  function pruneCart() {
    const products = getProducts();
    if (!products.length) return;
    const before = JSON.stringify(cart);
    cart = cart
      .map((c) => {
        const p = products.find((x) => x.id === c.id);
        if (!p || isOutOfStock(p)) return null;
        return { id: c.id, qty: Math.min(c.qty, maxQtyFor(p)) };
      })
      .filter(Boolean);
    if (JSON.stringify(cart) !== before) persist();
  }

  function isOutOfStock(p) {
    return !!(window.HA && window.HA.isOutOfStock && window.HA.isOutOfStock(p));
  }
  // `stock: null` en products.json significa sin límite.
  function maxQtyFor(p) {
    return typeof p.stock === "number" && p.stock > 0 ? Math.min(p.stock, MAX_QTY) : MAX_QTY;
  }

  function add(id, qty) {
    qty = Math.max(1, parseInt(qty, 10) || 1);
    const products = getProducts();
    const product = products.find((x) => x.id === id);
    // Con el catálogo cargado no se admite un producto que ya no existe o está agotado.
    if (products.length && (!product || isOutOfStock(product))) return;
    const line = cart.find((c) => c.id === id);
    const max = product ? maxQtyFor(product) : MAX_QTY;
    if (line) line.qty = Math.min(line.qty + qty, max);
    else cart.push({ id, qty: Math.min(qty, max) });
    pendingOrder = null;
    persist();
    announce(`${product ? product.title : "Producto"} añadido a la cesta. Cesta: ${count()} artículos.`);
    openDrawer("cart");
  }
  function setQty(id, qty, focusSel) {
    const line = cart.find((c) => c.id === id);
    if (!line) return;
    if (qty <= 0) return removeItem(id);
    const product = getProducts().find((x) => x.id === id);
    line.qty = Math.min(qty, product ? maxQtyFor(product) : MAX_QTY);
    pendingOrder = null;
    persist();
    renderDrawer(focusSel);
  }
  function removeItem(id) {
    const idx = lines().findIndex((l) => l.id === id);
    cart = cart.filter((c) => c.id !== id);
    pendingOrder = null;
    persist();
    // El foco pasa a la línea siguiente (o a la anterior, o al título si no queda ninguna).
    const rest = lines();
    const next = rest[Math.min(idx, rest.length - 1)];
    renderDrawer(next ? `[data-remove="${cssEscape(next.id)}"]` : "#cart-title");
  }
  function clearCart() {
    cart = [];
    persist();
  }
  // Se cuenta sobre las líneas válidas: un producto borrado del catálogo no suma envío.
  function count() {
    return getProducts().length ? lines().reduce((s, l) => s + l.qty, 0) : cart.reduce((s, c) => s + c.qty, 0);
  }
  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");
  }
  function round2(n) {
    return Math.round(n * 100) / 100;
  }
  function getProducts() {
    return (window.HA && window.HA.products) || [];
  }
  function effectivePrice(p) {
    if (window.HA && window.HA.effectivePrice) return window.HA.effectivePrice(p);
    return p.price;
  }
  // Precio unitario para `qty` unidades, con los precios por cantidad del producto
  // (assets/js/catalog-template.js); sin esa plantilla cargada, el precio normal.
  function unitPrice(p, qty) {
    const CT = window.HA_CATALOG_TEMPLATE;
    return CT && CT.unitPriceFor ? CT.unitPriceFor(p, qty) : effectivePrice(p);
  }

  function lines() {
    const products = getProducts();
    return cart
      .map((c) => {
        const p = products.find((x) => x.id === c.id);
        if (!p) return null;
        const price = unitPrice(p, c.qty);
        const tierApplied = price < effectivePrice(p);
        return { id: c.id, qty: c.qty, product: p, price, tierApplied, lineTotal: Math.round(price * c.qty * 100) / 100 };
      })
      .filter(Boolean);
  }
  function subtotal() {
    return round2(lines().reduce((s, l) => s + l.lineTotal, 0));
  }
  function shippingCost() {
    return count() > SHIPPING_FREE_MAX_ITEMS ? SHIPPING_COST : 0;
  }

  function updateBadge() {
    const badge = document.getElementById("cart-badge");
    const n = count();
    const btn = document.getElementById("cart-btn");
    if (btn) btn.setAttribute("aria-label", n > 0 ? `Cesta, ${n} ${n === 1 ? "artículo" : "artículos"}` : "Cesta vacía");
    if (!badge) return;
    badge.textContent = n;
    badge.style.display = n > 0 ? "flex" : "none";
  }

  // Aviso para lectores de pantalla (región viva oculta) al añadir a la cesta.
  function announce(msg) {
    let el = document.getElementById("cart-announcer");
    if (!el) {
      el = document.createElement("div");
      el.id = "cart-announcer";
      el.className = "visually-hidden";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = "";
    setTimeout(() => (el.textContent = msg), 50);
  }

  function formatPrice(n) {
    if (window.HA && window.HA.formatPrice) return window.HA.formatPrice(n);
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
  }

  // Las rutas de imagen en products.json son relativas a la raíz del sitio (p.ej.
  // "images/products/x.jpg"). El drawer del carrito puede abrirse desde páginas
  // que no están en la raíz (p.ej. /productos/<slug>.html), así que se normalizan
  // a absolutas para que no se resuelvan mal según la carpeta de la página actual.
  function imgSrc(path) {
    return path ? "/" + String(path).replace(/^\/+/, "") : "";
  }

  // Lo que queda detrás del panel no se puede enfocar ni leer mientras está abierto.
  function setBackgroundInert(on) {
    // El aviso para lectores de pantalla (#cart-announcer) tiene que seguir activo.
    document.querySelectorAll("body > *:not(#cart-root):not(#cart-announcer):not(script)").forEach((el) => {
      if (on) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    });
  }

  function openDrawer(v) {
    const wasOpen = !!document.getElementById("cart-backdrop");
    if (!wasOpen) lastFocus = document.activeElement;
    view = v || "cart";
    // El checkout necesita el SDK de Firebase para guardar el pedido: se va cargando ya.
    if (view === "checkout" && window.HA_DB && window.HA_DB.preload) window.HA_DB.preload();
    renderDrawer("#cart-title");
    document.body.style.overflow = "hidden";
    setBackgroundInert(true);
  }
  function closeDrawer() {
    const root = document.getElementById("cart-root");
    const backdrop = root ? document.getElementById("cart-backdrop") : null;
    document.body.style.overflow = "";
    setBackgroundInert(false);
    document.removeEventListener("keydown", onDrawerKeydown);
    // Si lo que tenía el foco ya no existe (p.ej. el botón de la ficha rápida), al botón de la cesta.
    const back = lastFocus && document.contains(lastFocus) ? lastFocus : document.getElementById("cart-btn");
    if (back && back.focus) back.focus();
    lastFocus = null;
    if (!backdrop) {
      if (root) root.innerHTML = "";
      return;
    }
    backdrop.classList.add("closing");
    setTimeout(() => {
      if (backdrop.parentNode === root) root.innerHTML = "";
    }, 220);
  }

  // Escape cierra; Tab no sale del panel.
  function onDrawerKeydown(e) {
    const drawer = document.querySelector("#cart-root .cart-drawer");
    if (!drawer) return;
    if (e.key === "Escape") {
      e.preventDefault();
      // Con el pedido en marcha no se cierra: al terminar se volvería a abrir solo.
      if (!submitting) closeDrawer();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])')].filter(
      (el) => el.offsetParent !== null
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // focusSel: selector del elemento que debe recibir el foco tras repintar (el panel
  // se vuelve a generar entero en cada cambio y, sin esto, el foco se perdería).
  function renderDrawer(focusSel) {
    const root = document.getElementById("cart-root");
    if (!root) return;
    let inner;
    if (view === "success") inner = successTemplate();
    else if (view === "checkout") inner = checkoutTemplate();
    else inner = cartTemplate();

    const wasOpen = !!document.getElementById("cart-backdrop");
    const isCheckout = view === "checkout" ? " checkout-view" : "";
    root.innerHTML = `
      <div class="cart-backdrop${isCheckout}${wasOpen ? " no-anim" : ""}" id="cart-backdrop">
        <aside class="cart-drawer${isCheckout}" role="dialog" aria-modal="true" aria-labelledby="cart-title">
          <button class="modal-close" id="cart-close" aria-label="Cerrar la cesta">&times;</button>
          <div class="cart-scroll">${inner}</div>
        </aside>
      </div>
    `;
    document.getElementById("cart-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "cart-backdrop") closeDrawer();
    });
    document.getElementById("cart-close").addEventListener("click", closeDrawer);
    document.removeEventListener("keydown", onDrawerKeydown);
    document.addEventListener("keydown", onDrawerKeydown);
    bindViewEvents();
    // Varios selectores separados por "|" = por orden de preferencia.
    const target = focusSel && focusSel.split("|").map((sel) => root.querySelector(sel)).find(Boolean);
    if (target) target.focus();
  }

  function cartTemplate() {
    const list = lines();
    if (!list.length) {
      return `
        <h3 id="cart-title" tabindex="-1">Tu cesta</h3>
        <div class="empty-state">Tu cesta está vacía.</div>
      `;
    }
    return `
      <h3 id="cart-title" tabindex="-1">Tu cesta</h3>
      <div class="cart-lines">
        ${list
          .map(
            (l) => `
          <div class="cart-line">
            <img src="${imgSrc(l.product.images && l.product.images[0])}" alt="">
            <div class="cart-line-info">
              <div class="cart-line-title">${escapeHtml(l.product.title)}</div>
              <div class="cart-line-price" data-price="${escapeHtml(l.id)}">${linePriceHtml(l)}</div>
              <div class="qty-stepper qty-stepper-sm">
                <button type="button" data-dec="${escapeHtml(l.id)}" aria-label="Quitar una unidad de ${escapeHtml(l.product.title)}">&minus;</button>
                <input type="number" min="1" max="${maxQtyFor(l.product)}" inputmode="numeric" value="${l.qty}" data-qty="${escapeHtml(l.id)}" aria-label="Cantidad de ${escapeHtml(l.product.title)}">
                <button type="button" data-inc="${escapeHtml(l.id)}" aria-label="Añadir una unidad de ${escapeHtml(l.product.title)}"${
                  l.qty >= maxQtyFor(l.product) ? " disabled" : ""
                }>+</button>
              </div>
            </div>
            <button type="button" class="cart-line-remove" data-remove="${escapeHtml(l.id)}" aria-label="Quitar ${escapeHtml(l.product.title)} de la cesta">&times;</button>
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
      <h3 id="cart-title" tabindex="-1">Revisa y confirma tu pedido</h3>
      <div class="checkout-order-card">
        <div class="checkout-order-lines">
          ${list
            .map(
              (l) => `
            <div class="checkout-order-line">
              <img src="${imgSrc(l.product.images && l.product.images[0])}" alt="">
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
      <form id="checkout-form" novalidate>
        <h4 class="checkout-section-title">Tus datos</h4>
        <p class="help-text">Los campos marcados con * son obligatorios.</p>
        <div class="field">
          <label for="co-name">Nombre y apellidos *</label>
          <input required name="name" id="co-name" autocomplete="name" maxlength="190" placeholder="Nombre completo">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="co-phone">Teléfono *</label>
            <input required name="phone" id="co-phone" type="tel" autocomplete="tel" maxlength="39" placeholder="+34 600 000 000">
          </div>
          <div class="field">
            <label for="co-email">Email</label>
            <input type="email" name="email" id="co-email" autocomplete="email" maxlength="190" placeholder="tucorreo@ejemplo.com">
          </div>
        </div>
        <div class="field">
          <label for="co-address">Dirección de envío *</label>
          <input required name="address" id="co-address" autocomplete="street-address" maxlength="290" placeholder="Calle, número, piso">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="co-postal">Código postal *</label>
            <input required name="postalCode" id="co-postal" autocomplete="postal-code" maxlength="19" placeholder="20230">
          </div>
          <div class="field">
            <label for="co-city">Ciudad *</label>
            <input required name="city" id="co-city" autocomplete="address-level2" maxlength="119" placeholder="Legazpi">
          </div>
        </div>
        <div class="field">
          <label for="co-province">Provincia</label>
          <input name="province" id="co-province" autocomplete="address-level1" maxlength="119" placeholder="Gipuzkoa">
        </div>
        <div class="field">
          <label for="co-notes">Notas del pedido (opcional)</label>
          <textarea name="notes" id="co-notes" maxlength="990" placeholder="Instrucciones de entrega, preferencias..."></textarea>
        </div>

        <fieldset class="payment-fieldset" id="co-payment">
          <legend class="checkout-section-title">Forma de pago *</legend>
          <div class="payment-methods">
            ${PAYMENT_METHODS.map(
              (p) => `
              <label class="payment-method-btn">
                <input type="radio" name="paymentMethod" value="${p.value}" required>
                <img src="${imgSrc(p.img)}" alt="${escapeHtml(p.label)}">
              </label>
            `
            ).join("")}
          </div>
        </fieldset>

        <p class="help-text checkout-legal">Al confirmar aceptas las <a href="/condiciones.html" target="_blank" rel="noopener">condiciones de venta</a>
        (incluido el derecho de desistimiento de 14 días) y el tratamiento de tus datos según la
        <a href="/privacidad.html" target="_blank" rel="noopener">política de privacidad</a>.</p>
        <div id="co-captcha-wrap" class="field" hidden>
          <span class="help-text">Para enviarte la confirmación por email, marca la casilla:</span>
          <div id="co-captcha"></div>
        </div>
        <div id="checkout-status"></div>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button type="button" class="btn btn-outline" id="back-to-cart">Volver a la cesta</button>
          <button type="submit" class="btn btn-primary" id="confirm-order" style="flex:1">Confirmar pedido con obligación de pago</button>
        </div>
      </form>
    `;
  }

  function successTemplate() {
    const email = lastOrder && lastOrder.customerEmailRequested && lastOrder.customer && lastOrder.customer.email;
    const waUrl = lastOrder && lastOrder.waUrl;
    return `
      <h3 id="cart-title" tabindex="-1">¡Pedido enviado!</h3>
      <div class="status-msg ok" role="status">Pedido ${escapeHtml((lastOrder && lastOrder.orderCode) || "")} recibido.</div>
      <p>Tu pedido será tramitado, nos pondremos en contacto contigo en breve para concretar los
      detalles pendientes, gracias por tu compra.</p>
      ${
        waUrl
          ? `<p class="help-text">Envíanos el resumen por WhatsApp para confirmarlo (si no se ha abierto solo, usa este botón):</p>
      <a class="btn btn-whatsapp" href="${escapeHtml(waUrl)}" target="_blank" rel="noopener" style="width:100%;margin-bottom:10px">Enviar el pedido por WhatsApp<span class="visually-hidden"> (se abre en una pestaña nueva)</span></a>`
          : ""
      }
      ${email ? `<p class="help-text" id="customer-email-status" aria-live="polite">Enviando la confirmación a <b>${escapeHtml(email)}</b>…</p>` : ""}
      <button class="btn btn-primary" id="continue-shopping" style="width:100%">Seguir comprando</button>
    `;
  }

  function setCustomerEmailStatus(ok, email) {
    const el = document.getElementById("customer-email-status");
    if (!el) return;
    el.innerHTML = ok
      ? `Te hemos enviado la confirmación a <b>${escapeHtml(email)}</b>.`
      : `No hemos podido enviarte el email de confirmación, pero el pedido está registrado: te escribiremos por WhatsApp.`;
  }

  function linePriceHtml(l) {
    return `${
      l.product.discountPercent || l.tierApplied
        ? `<span class="price-old">${formatPrice(l.product.price)}</span> ${formatPrice(l.price)}`
        : formatPrice(l.price)
    }${l.tierApplied ? ` <span class="help-text">· precio por cantidad</span>` : ""}`;
  }

  function refreshSummary() {
    lines().forEach((l) => {
      const el = document.querySelector(`#cart-root [data-price="${cssEscape(l.id)}"]`);
      if (el) el.innerHTML = linePriceHtml(l);
    });
    const summary = document.querySelector("#cart-root .cart-summary");
    if (!summary) return;
    const btn = document.getElementById("go-checkout");
    summary.querySelectorAll(":scope > :not(#go-checkout)").forEach((el) => el.remove());
    summary.insertAdjacentHTML("afterbegin", shippingSummaryHtml());
    if (btn) summary.appendChild(btn);
  }

  function bindViewEvents() {
    if (view === "cart") {
      document.querySelectorAll("[data-inc]").forEach((b) =>
        b.addEventListener("click", () => {
          const id = b.dataset.inc;
          const line = cart.find((c) => c.id === id);
          setQty(id, (line ? line.qty : 0) + 1, `[data-inc="${cssEscape(id)}"]:not([disabled])|[data-qty="${cssEscape(id)}"]`);
        })
      );
      document.querySelectorAll("[data-dec]").forEach((b) =>
        b.addEventListener("click", () => {
          const id = b.dataset.dec;
          const line = cart.find((c) => c.id === id);
          setQty(id, (line ? line.qty : 1) - 1, `[data-dec="${cssEscape(id)}"]`);
        })
      );
      // Al escribir la cantidad a mano no se repinta todo el panel (eso se comería el
      // clic en +/− que dispara el "change" al perder el foco): solo cantidades y totales.
      document.querySelectorAll("[data-qty]").forEach((inp) =>
        inp.addEventListener("change", () => {
          const line = cart.find((c) => c.id === inp.dataset.qty);
          if (!line) return;
          const product = getProducts().find((x) => x.id === line.id);
          line.qty = Math.min(Math.max(1, parseInt(inp.value, 10) || 1), product ? maxQtyFor(product) : MAX_QTY);
          inp.value = line.qty;
          pendingOrder = null;
          persist();
          refreshSummary();
        })
      );
      document.querySelectorAll("[data-remove]").forEach((b) =>
        b.addEventListener("click", () => removeItem(b.dataset.remove))
      );
      const goCheckout = document.getElementById("go-checkout");
      if (goCheckout) goCheckout.addEventListener("click", () => openDrawer("checkout"));
    } else if (view === "checkout") {
      const emailInput = document.getElementById("co-email");
      emailInput.addEventListener("input", () => {
        if (emailInput.value.trim()) showCaptcha();
      });
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

  // reCAPTCHA v2 (assets/js/drive-export.js -> recaptchaSiteKey). Solo se carga si el
  // cliente escribe su email: sin email no hay confirmación que proteger.
  let captchaWidgetId = null;
  let captchaLoading = false;
  function captchaSiteKey() {
    return (window.HA_DRIVE && window.HA_DRIVE.recaptchaSiteKey) || "";
  }
  function showCaptcha() {
    const key = captchaSiteKey();
    const wrap = document.getElementById("co-captcha-wrap");
    if (!key || !wrap) return;
    wrap.hidden = false;
    const render = () => {
      const el = document.getElementById("co-captcha");
      // Ya pintada en este formulario (el <p> es el aviso de error de carga, se sustituye).
      if (!el || (el.childElementCount && !el.querySelector(":scope > p"))) return;
      el.innerHTML = "";
      captchaWidgetId = window.grecaptcha.render(el, { sitekey: key });
    };
    if (window.grecaptcha && window.grecaptcha.render) return render();
    window.haRecaptchaReady = render;
    if (captchaLoading) return;
    captchaLoading = true;
    const sc = document.createElement("script");
    sc.src = "https://www.google.com/recaptcha/api.js?onload=haRecaptchaReady&render=explicit&hl=es";
    sc.async = true;
    // Bloqueador o sin red: sin casilla no se puede pedir la confirmación, así que se explica.
    sc.onerror = () => {
      captchaLoading = false;
      sc.remove();
      const el = document.getElementById("co-captcha");
      if (el && !el.childElementCount) {
        el.innerHTML = `<p class="help-text" role="alert">No se ha podido cargar la verificación «No soy un robot». Recarga la página o deja el email vacío: te confirmaremos el pedido por WhatsApp.</p>`;
      }
    };
    document.head.appendChild(sc);
  }
  function captchaToken() {
    if (captchaWidgetId === null || !window.grecaptcha) return "";
    return window.grecaptcha.getResponse(captchaWidgetId) || "";
  }

  const REQUIRED_FIELDS = [
    ["name", "co-name", "tu nombre"],
    ["phone", "co-phone", "un teléfono"],
    ["address", "co-address", "la dirección"],
    ["postalCode", "co-postal", "el código postal"],
    ["city", "co-city", "la ciudad"],
  ];

  // Marca el campo con error y lo enlaza con el mensaje para los lectores de pantalla.
  function markInvalid(form, invalidIds) {
    form.querySelectorAll("[aria-invalid]").forEach((el) => {
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
    });
    invalidIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.setAttribute("aria-invalid", "true");
      el.setAttribute("aria-describedby", "checkout-status");
    });
    const first = invalidIds.length && document.getElementById(invalidIds[0]);
    if (first) first.focus();
  }

  function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("Tiempo de espera agotado"), { code: "timeout" })), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  function whatsappUrl(order) {
    const phone = (window.HA && window.HA.store && window.HA.store.whatsapp) || "";
    if (!phone) return "";
    return `https://api.whatsapp.com/send?phone=${phone.replace(/[^\d]/g, "")}&text=${encodeURIComponent(buildWhatsAppMessage(order))}`;
  }

  async function onSubmitCheckout(e) {
    e.preventDefault();
    if (submitting) return;
    const form = e.target;
    if (!lines().length) {
      setCheckoutStatus("err", "Tu cesta está vacía o el catálogo todavía no ha cargado. Espera un momento y vuelve a intentarlo.");
      return;
    }
    const data = Object.fromEntries(new FormData(form).entries());
    const missing = REQUIRED_FIELDS.filter(([key]) => !String(data[key] || "").trim());
    if (missing.length) {
      setCheckoutStatus("err", `Falta ${missing.map((m) => m[2]).join(", ")}.`);
      markInvalid(form, missing.map((m) => m[1]));
      return;
    }
    const email = String(data.email || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setCheckoutStatus("err", "El email no parece correcto. Revísalo o déjalo vacío.");
      markInvalid(form, ["co-email"]);
      return;
    }
    if (!data.paymentMethod) {
      setCheckoutStatus("err", "Elige una forma de pago.");
      markInvalid(form, []);
      const firstRadio = form.querySelector('input[name="paymentMethod"]');
      if (firstRadio) firstRadio.focus();
      return;
    }
    markInvalid(form, []);
    const token = email && captchaSiteKey() ? captchaToken() : "";
    if (email && captchaSiteKey() && !token) {
      showCaptcha();
      setCheckoutStatus("err", "Marca la casilla «No soy un robot» para recibir la confirmación por email (o deja el email vacío).");
      return;
    }

    submitting = true;
    const submitBtn = document.getElementById("confirm-order");
    if (submitBtn) submitBtn.disabled = true;
    setCheckoutStatus("info", "Procesando pedido...");

    // Se abre ya (de forma síncrona, dentro del gesto de clic) para que los
    // navegadores móviles no bloqueen la ventana emergente tras los `await` siguientes.
    const waWindow = window.open("", "_blank");

    try {
      const orderLines = lines();
      const orderSubtotal = subtotal();
      const orderShipping = shippingCost();
      // Mismo código e ID de documento en los reintentos de este pedido (ver pendingOrder).
      if (!pendingOrder) {
        pendingOrder = {
          orderCode: genOrderCode(),
          docId: window.HA_DB && window.HA_DB.newOrderId ? window.HA_DB.newOrderId() : null,
          maybeSaved: false,
        };
      }
      const order = {
        orderCode: pendingOrder.orderCode,
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
        total: round2(orderSubtotal + orderShipping),
        paymentMethod: data.paymentMethod,
        customer: { name: data.name.trim(), phone: data.phone.trim(), email },
        shipping: {
          address: data.address.trim(),
          postalCode: data.postalCode.trim(),
          city: data.city.trim(),
          province: (data.province || "").trim(),
          notes: (data.notes || "").trim(),
        },
      };

      // Base de datos y aviso por email al negocio van en paralelo: si uno de los dos
      // se cuelga o falla, el otro sigue llegando.
      const [saved, mailed] = await Promise.allSettled([
        window.HA_DB && window.HA_DB.saveOrder
          ? window.HA_DB.saveOrder(order, { id: pendingOrder.docId })
          : Promise.reject(new Error("Base de datos no disponible")),
        window.HA_EMAIL && window.HA_EMAIL.sendOrderEmail
          ? withTimeout(window.HA_EMAIL.sendOrderEmail(order), 15000)
          : Promise.reject(new Error("Email no disponible")),
      ]);

      let orderId = saved.status === "fulfilled" ? saved.value : null;
      if (!orderId) {
        const err = saved.reason || {};
        console.error("No se pudo guardar el pedido en la base de datos:", err);
        // Un intento anterior se quedó sin respuesta y ahora las reglas rechazan el mismo
        // documento: es que aquel guardado sí llegó (solo el admin puede modificarlo).
        if (pendingOrder.maybeSaved && /permission/i.test(String(err.code || err.message))) orderId = pendingOrder.docId;
        if (err.code === "timeout") pendingOrder.maybeSaved = true;
      }
      if (mailed.status === "rejected") console.error("No se pudo enviar el email del pedido:", mailed.reason);

      const waUrl = whatsappUrl(order);
      if (!orderId && mailed.status === "rejected") {
        // No ha llegado nada al negocio: no se da el pedido por hecho ni se vacía la cesta.
        if (waWindow) waWindow.close();
        setCheckoutStatus(
          "err",
          "No hemos podido registrar tu pedido (puede ser la conexión). Inténtalo de nuevo en un momento" +
            (waUrl ? " o envíanoslo por WhatsApp con este enlace:" : "."),
          waUrl
        );
        return;
      }

      // La confirmación al cliente la envía el Apps Script leyendo el pedido guardado.
      order.customerEmailRequested = !!(orderId && token);
      order.waUrl = waUrl;
      if (waUrl && waWindow) waWindow.location.href = waUrl;
      else if (waWindow) waWindow.close();

      lastOrder = order;
      pendingOrder = null;
      clearCart();
      openDrawer("success");

      if (order.customerEmailRequested && window.HA_DRIVE) {
        window.HA_DRIVE.confirmCustomerEmail(orderId, token).then((ok) => setCustomerEmailStatus(ok, email));
      }
    } catch (err) {
      console.error("Error al tramitar el pedido:", err);
      if (waWindow) waWindow.close();
      setCheckoutStatus("err", "Ha habido un error al tramitar el pedido. Inténtalo de nuevo o escríbenos por WhatsApp.");
    } finally {
      submitting = false;
      const btn = document.getElementById("confirm-order");
      if (btn) btn.disabled = false;
    }
  }

  function setCheckoutStatus(type, msg, linkUrl) {
    const el = document.getElementById("checkout-status");
    if (!el) return;
    const link = linkUrl
      ? ` <a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener">Enviar el pedido por WhatsApp<span class="visually-hidden"> (se abre en una pestaña nueva)</span></a>`
      : "";
    el.innerHTML = msg ? `<div class="status-msg ${type}" role="${type === "err" ? "alert" : "status"}">${escapeHtml(msg)}${link}</div>` : "";
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
