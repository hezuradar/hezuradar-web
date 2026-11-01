(function () {
  "use strict";

  const LS_CART = "ha_cart";
  // Gastos de envío. En España, 1 pieza va por correo ordinario y 2 o más certificado.
  // Fuera de España, Paq Light Internacional de Correos (tarifa 2026, PVP con IVA) según
  // la zona del país y el peso del pedido, hasta 2 kg.
  const DOMESTIC_RATES = { single: 1.5, multi: 5.5 };
  const INTERNATIONAL_RATES = {
    EU1: [[250, 15.04], [750, 16.73], [1000, 18.6], [1500, 22.09], [2000, 25.7]],
    EU2: [[250, 19.15], [750, 24.01], [1000, 27.25], [1500, 32.8], [2000, 38.31]],
    AM: [[250, 18.39], [750, 22.97], [1000, 29.82], [1500, 32.29], [2000, 35.54]],
    ASOC: [[250, 19.72], [750, 24.62], [1000, 30.13], [1500, 34.45], [2000, 37.7]],
    AF: [[250, 16.58], [750, 17.46], [1000, 22.97], [1500, 26.93], [2000, 30.13]],
  };
  // Peso aproximado por pieza: la madre perla 45 g; cejuelas, selletas y el resto, 25 g.
  const PIECE_WEIGHT_G = 25;
  const PIECE_WEIGHT_BY_CATEGORY_G = { "Madre perla y abalone": 45 };
  const SHIPPING_LABELS = { single: "Envío ordinario", multi: "Envío certificado", international: "Paq Light Internacional" };
  // Zonas de Correos: A (Europa cercana) → EU1; B y B2 (resto de Europa y norte del Magreb)
  // → EU2; C (América) → AM; D y D2 (Asia, Oriente Medio y Oceanía) → ASOC; E (África) → AF.
  const ZONE_EU1 = "AT BE CH DE DK FR GB GG GI GR IE IM IT JE LU NL NO PT SE".split(" ");
  const ZONE_EU2 = (
    "AD AL AX BA BG BY CY CZ DZ EE FI FO GL HR HU IS LI LT LV MA MC MD ME MK MT PL RO RS RU SI SK SM TN TR UA VA"
  ).split(" ");
  const ZONE_AM = (
    "AG AI AR AW BB BL BM BO BQ BR BS BZ CA CL CO CR CU CW DM DO EC FK GD GF GP GT GY HN HT JM KN KY LC MF MQ " +
    "MS MX NI PA PE PM PR PY SR SV SX TC TT US UY VC VE VG VI"
  ).split(" ");
  const ZONE_AF = (
    "AO BF BI BJ BW CD CF CG CI CM CV DJ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MG ML MR MU MW MZ NA NE " +
    "NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TZ UG YT ZA ZM ZW"
  ).split(" ");
  const COUNTRY_CODES = (
    "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM " +
    "FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM " +
    "JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO " +
    "MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT " +
    "PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM " +
    "TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" ");
  const MAX_QTY = 999;
  // firestore.rules no admite pedidos de más de 50 líneas.
  const MAX_LINES = 50;
  let cart = loadCart();
  let view = "cart"; // 'cart' | 'checkout' | 'success'
  let lastOrder = null;
  let submitting = false;
  // Pedido en curso: se reutilizan el código y el ID del documento en los reintentos
  // para que un pedido que llegó tarde a Firestore no se guarde dos veces.
  let pendingOrder = null;
  let lastFocus = null;
  // País de envío (código ISO) elegido en el checkout; la cesta lo usa para el resumen.
  let country = "ES";

  document.addEventListener("DOMContentLoaded", () => {
    updateBadge();
    const btn = document.getElementById("cart-btn");
    if (btn) btn.addEventListener("click", () => openDrawer("cart"));
    // Un pedido que no se pudo guardar en una visita anterior se reintenta al volver.
    if (readUnsaved().length) setTimeout(flushUnsaved, 4000);
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
    pendingOrder = null;
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
    else if (cart.length >= MAX_LINES) {
      announce("La cesta admite como máximo " + MAX_LINES + " productos distintos.");
      return;
    } else cart.push({ id, qty: Math.min(qty, max) });
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
  function internationalZone(code) {
    if (ZONE_EU1.includes(code)) return "EU1";
    if (ZONE_EU2.includes(code)) return "EU2";
    if (ZONE_AM.includes(code)) return "AM";
    return ZONE_AF.includes(code) ? "AF" : "ASOC";
  }
  function cartWeight() {
    return lines().reduce((s, l) => s + (PIECE_WEIGHT_BY_CATEGORY_G[l.product.category] || PIECE_WEIGHT_G) * l.qty, 0);
  }
  // Coste y modalidad del envío para lo que hay en la cesta y el país elegido. Por encima
  // de 2 kg Correos no admite Paq Light: el coste queda a confirmar (cost null).
  function shippingQuote() {
    const n = count();
    if (n <= 0) return { cost: 0, label: "" };
    if (country !== "ES") {
      const weight = cartWeight();
      const band = INTERNATIONAL_RATES[internationalZone(country)].find(([max]) => weight <= max);
      if (!band) return { cost: null, label: "Envío a confirmar", kind: "international", weight };
      return { cost: band[1], label: SHIPPING_LABELS.international, kind: "international", weight };
    }
    const kind = n === 1 ? "single" : "multi";
    return { cost: DOMESTIC_RATES[kind], label: SHIPPING_LABELS[kind], kind };
  }
  function shippingCost() {
    return shippingQuote().cost || 0;
  }

  function formatWeight(g) {
    return g >= 1000 ? `${(g / 1000).toLocaleString("es-ES", { maximumFractionDigits: 2 })} kg` : `${g} g`;
  }

  // Idioma que ha elegido el cliente (assets/js/i18n.js).
  function uiLang() {
    return (window.HA_I18N && window.HA_I18N.lang) || "es";
  }
  const countryNames = {};
  // Nombre del país en el idioma de la web; el pedido se guarda siempre en español.
  function countryName(code, lang) {
    const l = lang || uiLang();
    if (!countryNames[l]) {
      try {
        countryNames[l] = new Intl.DisplayNames([l], { type: "region" });
      } catch (e) {
        countryNames[l] = { of: (c) => c };
      }
    }
    return countryNames[l].of(code) || code;
  }
  // España primero y el resto por orden alfabético.
  function countryOptionsHtml() {
    const others = COUNTRY_CODES.filter((c) => c !== "ES")
      .map((c) => ({ code: c, name: countryName(c) }))
      .sort((a, b) => a.name.localeCompare(b.name, uiLang()));
    return [{ code: "ES", name: countryName("ES") }]
      .concat(others)
      .map((c) => `<option value="${c.code}"${c.code === country ? " selected" : ""}>${escapeHtml(c.name)}</option>`)
      .join("");
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
      if (e.target.id === "cart-backdrop" && !submitting) closeDrawer();
    });
    // Con el pedido en marcha no se cierra ni se cambia de vista (como con Escape): el
    // resultado, o el error, se muestra en el checkout al terminar.
    document.getElementById("cart-close").addEventListener("click", () => {
      if (!submitting) closeDrawer();
    });
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
        <div class="field cart-country">
          <label for="cart-country">Enviar a</label>
          <select id="cart-country" autocomplete="country">${countryOptionsHtml()}</select>
        </div>
        <div class="cart-totals" aria-live="polite">${shippingSummaryHtml()}</div>
        <button class="btn btn-primary" id="go-checkout" style="width:100%">Finalizar pedido</button>
      </div>
    `;
  }

  function shippingSummaryHtml() {
    const q = shippingQuote();
    if (q.cost === null) {
      return `
        <div class="cart-mini-line"><span>Subtotal</span><span>${formatPrice(subtotal())}</span></div>
        <div class="cart-mini-line"><span>${q.label} (${escapeHtml(countryName(country))})</span><span>—</span></div>
        <div class="cart-subtotal"><span>Total sin envío</span><b>${formatPrice(subtotal())}</b></div>
        <p class="help-text">El pedido pesa unos ${formatWeight(q.weight)} y supera los 2 kg del Paq Light Internacional: te confirmaremos el coste del envío por paquetería antes de que pagues.</p>
      `;
    }
    if (q.cost <= 0) {
      return `<div class="cart-subtotal"><span>Subtotal</span><b>${formatPrice(subtotal())}</b></div>`;
    }
    const note =
      q.kind === "single"
        ? "Una pieza se envía por correo ordinario, sin número de seguimiento. A partir de dos piezas, certificado."
        : country === "ES"
        ? "Envío por correo certificado, con número de seguimiento."
        : `Los envíos fuera de España van por Paq Light Internacional de Correos, con número de seguimiento. Peso aproximado del pedido: ${formatWeight(q.weight)}.`;
    return `
      <div class="cart-mini-line"><span>Subtotal</span><span>${formatPrice(subtotal())}</span></div>
      <div class="cart-mini-line"><span>${q.label} (${escapeHtml(countryName(country))})</span><span>${formatPrice(q.cost)}</span></div>
      <div class="cart-subtotal"><span>Total</span><b>${formatPrice(subtotal() + q.cost)}</b></div>
      <p class="help-text">${note}</p>
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
          <div class="cart-totals" aria-live="polite">${shippingSummaryHtml()}</div>
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
          <label for="co-country">País *</label>
          <select required name="country" id="co-country" autocomplete="country">${countryOptionsHtml()}</select>
        </div>
        <div class="field">
          <label for="co-address">Dirección de envío *</label>
          <input required name="address" id="co-address" autocomplete="street-address" maxlength="290" placeholder="Calle, número, piso">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="co-postal">Código postal *</label>
            <input required name="postalCode" id="co-postal" autocomplete="postal-code" maxlength="19" placeholder="28013">
          </div>
          <div class="field">
            <label for="co-city">Ciudad *</label>
            <input required name="city" id="co-city" autocomplete="address-level2" maxlength="119" placeholder="Madrid">
          </div>
        </div>
        <div class="field">
          <label for="co-province">Provincia</label>
          <input name="province" id="co-province" autocomplete="address-level1" maxlength="119" placeholder="Madrid">
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
      : `No hemos podido enviarte el email de confirmación, pero el pedido está registrado: ${whatsappEnabled() ? "te escribiremos por WhatsApp" : "nos pondremos en contacto contigo"}.`;
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
    const totals = document.querySelector("#cart-root .cart-totals");
    if (totals) totals.innerHTML = shippingSummaryHtml();
  }

  // Desplegable de país de la cesta o del checkout: recalcula el envío al momento.
  function bindCountrySelect(id) {
    const select = document.getElementById(id);
    if (!select) return;
    select.addEventListener("change", () => {
      country = COUNTRY_CODES.includes(select.value) ? select.value : "ES";
      pendingOrder = null;
      refreshSummary();
    });
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
      bindCountrySelect("cart-country");
      const goCheckout = document.getElementById("go-checkout");
      if (goCheckout) goCheckout.addEventListener("click", () => openDrawer("checkout"));
    } else if (view === "checkout") {
      const emailInput = document.getElementById("co-email");
      emailInput.addEventListener("input", () => {
        if (emailInput.value.trim()) showCaptcha();
      });
      document.getElementById("back-to-cart").addEventListener("click", () => {
        if (!submitting) openDrawer("cart");
      });
      document.getElementById("checkout-form").addEventListener("submit", onSubmitCheckout);
      bindCountrySelect("co-country");
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
        el.innerHTML = `<p class="help-text" role="alert">No se ha podido cargar la verificación «No soy un robot». Recarga la página o deja el email vacío: te confirmaremos el pedido ${whatsappEnabled() ? "por WhatsApp" : "por teléfono"}.</p>`;
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

  // Pedidos que no llegaron a Firestore (sin conexión, tiempo agotado...): se guardan en el
  // navegador del cliente y se reintentan con el mismo ID, para que no se pierdan del panel
  // aunque el aviso por email y WhatsApp sí haya salido.
  const LS_UNSAVED = "ha_unsaved_orders";
  const RETRY_DELAYS_MS = [8000, 30000, 90000];
  const MAX_UNSAVED_ATTEMPTS = 6;
  let flushing = false;

  function readUnsaved() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_UNSAVED));
      return Array.isArray(raw) ? raw.filter((e) => e && typeof e.docId === "string" && e.order) : [];
    } catch (e) {
      return [];
    }
  }

  function writeUnsaved(list) {
    try {
      if (list.length) localStorage.setItem(LS_UNSAVED, JSON.stringify(list));
      else localStorage.removeItem(LS_UNSAVED);
    } catch (e) {
      // Sin almacenamiento solo quedan los reintentos mientras la página siga abierta.
    }
  }

  function queueUnsaved(docId, order, maybeSaved) {
    if (!docId) return;
    const rest = readUnsaved().filter((e) => e.docId !== docId);
    writeUnsaved(rest.concat({ docId, order, attempts: 0, maybeSaved: !!maybeSaved }));
  }

  async function flushUnsaved() {
    if (flushing || !window.HA_DB || !window.HA_DB.saveOrder) return;
    flushing = true;
    try {
      for (const entry of readUnsaved()) {
        let keep = null;
        try {
          await window.HA_DB.saveOrder(entry.order, { id: entry.docId });
        } catch (err) {
          const timedOut = err && err.code === "timeout";
          // Si un intento anterior se quedó sin respuesta y ahora las reglas rechazan el
          // mismo documento, es que aquel sí llegó (solo el admin puede modificarlo).
          const alreadyThere = entry.maybeSaved && /permission/i.test(String((err && (err.code || err.message)) || ""));
          const attempts = (entry.attempts || 0) + 1;
          if (!alreadyThere && attempts < MAX_UNSAVED_ATTEMPTS) {
            keep = { ...entry, attempts, maybeSaved: entry.maybeSaved || timedOut };
          } else if (!alreadyThere) {
            console.error("Pedido " + entry.order.orderCode + " sin guardar tras varios intentos:", err);
          }
        }
        const rest = readUnsaved().filter((e) => e.docId !== entry.docId);
        writeUnsaved(keep ? rest.concat(keep) : rest);
      }
    } finally {
      flushing = false;
    }
  }

  // El contacto por WhatsApp se puede desactivar desde el panel (whatsappEnabled en
  // data/store.json; year.js lo refleja en <html> y expone HA_whatsappEnabled).
  function whatsappEnabled() {
    if (window.HA && window.HA.store && window.HA.store.whatsappEnabled === false) return false;
    return !window.HA_whatsappEnabled || window.HA_whatsappEnabled();
  }

  function whatsappUrl(order) {
    if (!whatsappEnabled()) return "";
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
    const waWindow = whatsappEnabled() ? window.open("", "_blank") : null;

    try {
      const orderLines = lines();
      const orderSubtotal = subtotal();
      country = COUNTRY_CODES.includes(data.country) ? data.country : "ES";
      const quote = shippingQuote();
      const orderShipping = quote.cost || 0;
      // Mismo código e ID de documento en los reintentos de este pedido (ver pendingOrder).
      if (!pendingOrder) {
        pendingOrder = {
          orderCode: genOrderCode(),
          docId: window.HA_DB && window.HA_DB.newOrderId ? window.HA_DB.newOrderId() : null,
          maybeSaved: false,
        };
      }
      // Copia local: tocar la cesta (aquí o en otra pestaña) pone pendingOrder a null.
      const po = pendingOrder;
      const order = {
        orderCode: po.orderCode,
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
        // Idioma de la web al comprar: el Apps Script escribe en él el email al cliente.
        lang: uiLang(),
        customer: { name: data.name.trim(), phone: data.phone.trim(), email },
        shipping: {
          address: data.address.trim(),
          postalCode: data.postalCode.trim(),
          city: data.city.trim(),
          province: (data.province || "").trim(),
          country: countryName(country, "es"),
          method: quote.label,
          notes: (data.notes || "").trim(),
        },
      };

      // Base de datos y aviso por email al negocio van en paralelo: si uno de los dos
      // se cuelga o falla, el otro sigue llegando.
      const [saved, mailed] = await Promise.allSettled([
        window.HA_DB && window.HA_DB.saveOrder
          ? window.HA_DB.saveOrder(order, { id: po.docId })
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
        if (po.maybeSaved && /permission/i.test(String(err.code || err.message))) orderId = po.docId;
        if (err.code === "timeout") po.maybeSaved = true;
        if (!orderId && mailed.status === "fulfilled") {
          // El cliente verá el pedido como hecho (el aviso al negocio salió) pero no consta en
          // el panel: se guarda una copia limpia (sin los campos que se añaden más abajo) para
          // reintentarlo y se avisa al negocio con el motivo. Si el aviso también falló, no se
          // da el pedido por hecho y el cliente reintenta con el mismo ID.
          queueUnsaved(po.docId, JSON.parse(JSON.stringify(order)), po.maybeSaved);
          RETRY_DELAYS_MS.forEach((ms) => setTimeout(flushUnsaved, ms));
          order.notRegistered = String(err.code || err.message || "desconocido").slice(0, 120);
          if (window.HA_EMAIL && window.HA_EMAIL.sendOrderEmail) {
            window.HA_EMAIL.sendOrderEmail({ ...order }).catch((e) => console.error("No se pudo enviar el aviso de pedido sin registrar:", e));
          }
        }
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
      setCheckoutStatus("err", "Ha habido un error al tramitar el pedido. Inténtalo de nuevo o escríbenos " + (whatsappEnabled() ? "por WhatsApp." : "por email."));
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
      order.notRegistered ? "⚠️ No se pudo registrar en el panel: añadirlo a mano." : null,
      uiLang() === "en" ? "🌐 El cliente ha comprado con la web en inglés." : null,
      "",
      "Productos:",
      lines,
      "",
      `Subtotal: ${formatPrice(order.subtotal)}`,
      order.shippingCost ? `${s.method || "Envío"}: ${formatPrice(order.shippingCost)}` : s.method ? `${s.method} (más de 2 kg)` : null,
      order.shippingCost ? `Total: ${formatPrice(order.total)}` : null,
      "",
      `Forma de pago: ${PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod || "-"}`,
      "",
      "Datos de envío:",
      `Nombre: ${c.name}`,
      `Teléfono: ${c.phone}`,
      c.email ? `Email: ${c.email}` : null,
      `Dirección: ${s.address}, ${s.postalCode} ${s.city}${s.province ? " (" + s.province + ")" : ""}${s.country ? ", " + s.country : ""}`,
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
