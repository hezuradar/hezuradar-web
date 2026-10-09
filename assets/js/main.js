(function () {
  "use strict";

  const CT = window.HA_CATALOG_TEMPLATE;

  const state = {
    products: [],
    store: null,
    category: "Todo",
    subcategory: null,
    term: "",
    sort: "recent",
    // Hasta que llega data/products.json no se filtra: el grid precalculado de
    // index.html se queda tal cual (si no, la búsqueda vaciaría el catálogo y
    // mostraría "No hay productos" mientras carga).
    loaded: false,
  };

  // Elemento que tenía el foco al abrir el modal, para devolvérselo al cerrarlo.
  let modalOpener = null;

  const els = {};

  // Aviso oculto para lectores de pantalla en los enlaces que abren otra pestaña.
  const NEW_TAB_HTML = '<span class="visually-hidden"> (se abre en una pestaña nueva)</span>';

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheEls();
    bindEvents();
    // El grid y los chips llegan ya renderizados con el catálogo real desde
    // index.html (ver assets/js/catalog-template.js e injectHomepageMarkup):
    // los "esqueletos" solo hacen falta como red de seguridad si, por lo que
    // sea, ese HTML no se ha generado (p.ej. en local sin haber corrido el
    // script de build). Pintarlos también en el caso normal metería un salto
    // de diseño de más (real → esqueleto → real) en vez de evitarlo.
    const prerendered = els.grid.dataset.prerendered === "true";
    if (!prerendered) {
      renderSkeletonChips();
      renderSkeletonGrid();
    }
    try {
      const [products, store] = await Promise.all([
        fetchJSON(catalogUrl("data/products.json")),
        fetchJSON("data/store.json"),
      ]);
      state.products = products;
      state.store = store;
      state.loaded = true;
      // Lo que se haya escrito en el buscador (o lo que restaure el navegador al
      // volver atrás) mientras cargaba el catálogo se aplica ahora.
      state.term = normalizeText(els.search.value.trim());
      window.HA = window.HA || {};
      window.HA.products = products;
      window.HA.store = store;
      window.HA.waLink = waLink;
      window.HA.formatPrice = CT.formatPrice;
      window.HA.effectivePrice = CT.effectivePrice;
      window.HA.isOutOfStock = CT.isOutOfStock;
      document.dispatchEvent(new CustomEvent("ha:ready"));
      hydrateStore(store);
      buildCategoryChips();
      render();
    } catch (err) {
      if (!prerendered) {
        els.grid.innerHTML =
          '<div class="empty-state">No se ha podido cargar el catálogo. Comprueba que data/products.json existe.</div>';
      }
      console.error(err);
    }
  }

  function cacheEls() {
    els.grid = document.getElementById("product-grid");
    els.chips = document.getElementById("category-chips");
    els.subchips = document.getElementById("subcategory-chips");
    els.search = document.getElementById("search-input");
    els.sort = document.getElementById("sort-select");
    els.resultsCount = document.getElementById("results-count");
    els.modalRoot = document.getElementById("modal-root");
    els.waFloat = document.getElementById("wa-float");
    els.aboutText = document.getElementById("about-text");
    els.contactList = document.getElementById("contact-list");
    els.igLink = document.getElementById("instagram-link");
  }

  function bindEvents() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.getElementById("modal-backdrop")) closeModal();
    });
    els.search.addEventListener("input", (e) => {
      state.term = normalizeText(e.target.value.trim());
      if (state.loaded) render();
    });
    els.sort.addEventListener("change", (e) => {
      state.sort = e.target.value;
      if (state.loaded) render();
    });
  }

  // Minúsculas y sin tildes, para que buscar "pua" o "ambar" encuentre "púas" o "ámbar".
  function normalizeText(str) {
    return String(str || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  }

  // data/products.json con la versión del catálogo que dejó escrita el generador
  // (meta "ha-catalog-version"): así se puede usar la caché normal del navegador
  // y, al cambiar el catálogo, la URL cambia. Sin esa meta se revalida siempre.
  function catalogUrl(path) {
    const meta = document.querySelector('meta[name="ha-catalog-version"]');
    const version = meta && meta.content;
    return version ? path + "?v=" + encodeURIComponent(version) : path;
  }

  function hydrateStore(store) {
    if (!store) return;
    if (els.aboutText) renderAboutText(els.aboutText, store.aboutUs || "");
    if (els.waFloat && store.whatsapp) {
      els.waFloat.href = waLink(store.whatsapp, "Hola, tengo una consulta sobre vuestros productos.");
    }
    if (els.igLink && store.instagram) els.igLink.href = store.instagram;
    if (els.contactList) {
      els.contactList.innerHTML = `
        <li><b>Ubicación</b>Legazpi, Gipuzkoa (España)</li>
        <li><b>Email</b><a href="mailto:${escapeAttr(store.email)}">${escapeHtml(store.email)}</a></li>
        <li><b>WhatsApp</b><a href="${escapeAttr(waLink(store.whatsapp))}" target="_blank" rel="noopener">${escapeHtml(formatPhone(store.whatsapp))}${NEW_TAB_HTML}</a></li>
        <li><b>Instagram</b><a href="${escapeAttr(store.instagram)}" target="_blank" rel="noopener">@hezuradar${NEW_TAB_HTML}</a></li>
      `;
    }
  }

  function renderAboutText(el, text) {
    const marker = "\n\nAbout us\n\n";
    const idx = text.indexOf(marker);
    if (idx === -1) {
      el.lang = "es";
      el.textContent = text;
      return;
    }
    const es = text.slice(0, idx);
    const en = text.slice(idx + marker.length);
    el.innerHTML = "";
    const esEl = document.createElement("span");
    esEl.lang = "es";
    esEl.className = "about-text-block";
    esEl.textContent = es;
    const enEl = document.createElement("span");
    enEl.lang = "en";
    enEl.className = "about-text-block";
    enEl.textContent = en;
    el.append(esEl, enEl);
  }

  function waLink(phone, text) {
    const msg = text || "Hola, estoy interesado en vuestros productos.";
    return `https://api.whatsapp.com/send?phone=${phone.replace("+", "")}&text=${encodeURIComponent(msg)}`;
  }

  function formatPhone(p) {
    return p;
  }

  async function fetchJSON(path) {
    // Con versión en la URL vale la caché normal; sin ella, se revalida siempre.
    const res = await fetch(path, path.indexOf("?v=") === -1 ? { cache: "no-cache" } : undefined);
    if (!res.ok) throw new Error("No se pudo cargar " + path);
    return res.json();
  }

  function categoryTree() {
    const tree = {};
    state.products.forEach((p) => {
      if (!tree[p.category]) tree[p.category] = new Set();
      if (p.subcategory) tree[p.category].add(p.subcategory);
    });
    return tree;
  }

  function buildCategoryChips() {
    const tree = categoryTree();
    // Al repintar los chips se conserva el foco en el que se acaba de pulsar
    // (si no, quien navega con teclado vuelve al principio de la página).
    const focusedCat = els.chips.contains(document.activeElement) ? document.activeElement.dataset.cat : null;
    els.chips.innerHTML = CT.buildChipsHtml(state.products, state.category);
    if (focusedCat) {
      const again = Array.from(els.chips.querySelectorAll(".chip")).find((b) => b.dataset.cat === focusedCat);
      if (again) again.focus();
    }
    els.chips.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.category = btn.dataset.cat;
        state.subcategory = null;
        buildCategoryChips();
        buildSubChips(tree);
        render();
      });
    });
    buildSubChips(tree);
  }

  function buildSubChips(tree) {
    const subs = tree[state.category];
    if (!subs || subs.size === 0) {
      els.subchips.innerHTML = "";
      return;
    }
    const list = Array.from(subs).sort();
    const focusedSub = els.subchips.contains(document.activeElement) ? document.activeElement.dataset.sub : null;
    els.subchips.innerHTML = list
      .map(
        (s) =>
          `<button type="button" class="subchip${s === state.subcategory ? " active" : ""}" aria-pressed="${s === state.subcategory}" data-sub="${escapeAttr(s)}">${escapeHtml(s)}</button>`
      )
      .join("");
    els.subchips.querySelectorAll(".subchip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.subcategory = state.subcategory === btn.dataset.sub ? null : btn.dataset.sub;
        buildSubChips(tree);
        render();
      });
    });
    if (focusedSub) {
      const again = Array.from(els.subchips.querySelectorAll(".subchip")).find((b) => b.dataset.sub === focusedSub);
      if (again) again.focus();
    }
  }

  function getFiltered() {
    let list = state.products.slice();
    if (state.category !== "Todo") {
      list = list.filter((p) => p.category === state.category);
    }
    if (state.subcategory) {
      list = list.filter((p) => p.subcategory === state.subcategory);
    }
    if (state.term) {
      list = list.filter(
        (p) =>
          normalizeText(p.title).includes(state.term) ||
          normalizeText(p.description).includes(state.term)
      );
    }
    // Se ordena por el precio que paga el cliente (con el descuento aplicado).
    switch (state.sort) {
      case "price-asc":
        list.sort((a, b) => CT.effectivePrice(a) - CT.effectivePrice(b));
        break;
      case "price-desc":
        list.sort((a, b) => CT.effectivePrice(b) - CT.effectivePrice(a));
        break;
      case "name-asc":
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      default:
        break;
    }
    return list;
  }

  // Igual que renderSkeletonGrid, pero para los chips de categoría: también
  // arrancan vacíos y se rellenan tras cargar los datos, justo encima del
  // catálogo y siempre dentro del viewport inicial (a diferencia del grid,
  // que en buena parte queda fuera de pantalla al cargar).
  function renderSkeletonChips() {
    els.chips.innerHTML = Array.from(
      { length: 4 },
      () => '<span class="chip skeleton-line skeleton-chip" aria-hidden="true"></span>'
    ).join("");
  }

  // Ocupa de entrada, con marcadores de posición, aproximadamente el mismo
  // espacio que ocuparán las tarjetas reales una vez lleguen products.json y
  // las imágenes: sin esto, el grid arranca vacío y se llena de golpe al
  // terminar la carga, empujando "Quiénes somos" y el footer hacia abajo (el
  // salto de diseño que detectó PageSpeed).
  function skeletonCardTemplate() {
    return `
      <article class="card is-skeleton" aria-hidden="true">
        <div class="card-img skeleton-block"></div>
        <div class="card-body">
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-line skeleton-price"></div>
          <div class="skeleton-line skeleton-actions"></div>
        </div>
      </article>
    `;
  }

  function renderSkeletonGrid() {
    els.grid.innerHTML = Array.from({ length: 8 }, skeletonCardTemplate).join("");
  }

  function render() {
    const list = getFiltered();
    els.resultsCount.textContent = CT.resultsCountText(list.length);
    if (!list.length) {
      els.grid.innerHTML = '<div class="empty-state">No hay productos que coincidan con la búsqueda.</div>';
      return;
    }
    els.grid.innerHTML = CT.buildGridHtml(list);
    els.grid.querySelectorAll("[data-open]").forEach((el) => {
      el.addEventListener("click", () => openModal(el.dataset.open));
    });
    els.grid.querySelectorAll("[data-add]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (window.HA && window.HA.cart) window.HA.cart.add(el.dataset.add, 1);
      });
    });
  }

  function productWaLink(p) {
    const phone = state.store ? state.store.whatsapp : "";
    const url = window.location.origin + window.location.pathname + "#producto-" + p.id;
    const text = `Hola, estoy interesado en este producto: ${p.title} ${url}`;
    return waLink(phone, text);
  }

  function openModal(id) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    try {
      if (window.HA_ANALYTICS) window.HA_ANALYTICS.trackProductView(p.id, p.title);
    } catch (e) {
      // Las estadísticas nunca deben impedir abrir la ficha.
    }
    modalOpener = document.activeElement;
    const images = p.images && p.images.length ? p.images : [""];
    const outOfStock = CT.isOutOfStock(p);
    const hasDiscount = Number(p.discountPercent) > 0;
    els.modalRoot.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(p.title)}">
          <button class="modal-close" id="modal-close" aria-label="Cerrar">&times;</button>
          <div class="modal-scroll">
            <div class="modal-gallery">
              <img id="modal-main-img" src="${escapeAttr(images[0])}" alt="${escapeAttr(p.title)}">
              ${
                images.length > 1
                  ? `<div class="modal-thumbs">${images
                      .map(
                        (im, i) =>
                          `<button type="button" class="thumb-btn${i === 0 ? " active" : ""}" data-full="${escapeAttr(im)}" aria-label="Ver foto ${i + 1} de ${images.length}" aria-pressed="${i === 0}"><img src="${escapeAttr(CT.thumbPath(im))}" alt="" class="${i === 0 ? "active" : ""}"></button>`
                      )
                      .join("")}</div>`
                  : ""
              }
            </div>
            <div class="modal-info">
              <div class="modal-cat">${escapeHtml(p.category)}${p.subcategory ? " · " + escapeHtml(p.subcategory) : ""}</div>
              <h2>${escapeHtml(p.title)}</h2>
              <div class="modal-price">${
                hasDiscount
                  ? `<span class="price-old">${CT.formatPrice(p.price)}</span> ${CT.formatPrice(CT.effectivePrice(p))}`
                  : CT.formatPrice(p.price)
              }</div>
              ${CT.priceTiersHtml ? CT.priceTiersHtml(p) : ""}
              ${outOfStock ? `<div class="status-msg err">Sin stock disponible.</div>` : ""}
              <div class="modal-desc">${escapeHtml(p.description || "")}</div>
              <div class="modal-sku">Ref. ${escapeHtml(p.sku || "-")}</div>
              <div class="qty-stepper">
                <button type="button" id="modal-qty-dec" aria-label="Menos" ${outOfStock ? "disabled" : ""}>&minus;</button>
                <input type="number" id="modal-qty" value="1" min="1" inputmode="numeric" aria-label="Cantidad" ${outOfStock ? "disabled" : ""}>
                <button type="button" id="modal-qty-inc" aria-label="Más" ${outOfStock ? "disabled" : ""}>+</button>
              </div>
              <div class="modal-actions">
                <button class="btn btn-primary" id="modal-add-cart" ${outOfStock ? "disabled" : ""}>${outOfStock ? "Sin stock" : "Añadir a la cesta"}</button>
                <a class="btn btn-outline" target="_blank" rel="noopener" href="${escapeAttr(productWaLink(p))}">Consultar por WhatsApp${NEW_TAB_HTML}</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("modal-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "modal-backdrop") closeModal();
    });
    const thumbs = els.modalRoot.querySelectorAll(".modal-thumbs .thumb-btn");
    thumbs.forEach((th) => {
      th.addEventListener("click", () => {
        document.getElementById("modal-main-img").src = th.dataset.full;
        thumbs.forEach((t) => setThumbActive(t, t === th));
      });
    });
    const qtyInput = document.getElementById("modal-qty");
    document.getElementById("modal-qty-dec").addEventListener("click", () => {
      qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
    });
    document.getElementById("modal-qty-inc").addEventListener("click", () => {
      qtyInput.value = (parseInt(qtyInput.value, 10) || 1) + 1;
    });
    document.getElementById("modal-add-cart").addEventListener("click", () => {
      const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
      // Primero se cierra el modal y después se abre la cesta: al revés,
      // closeModal() devolvería el scroll al body con la cesta ya abierta y le
      // quitaría el foco. El foco lo gestiona la cesta, no se devuelve a la tarjeta.
      closeModal({ restoreFocus: false });
      if (window.HA && window.HA.cart) window.HA.cart.add(p.id, qty);
    });
    document.getElementById("modal-backdrop").addEventListener("keydown", trapFocus);
    document.body.style.overflow = "hidden";
    document.getElementById("modal-close").focus({ preventScroll: true });
  }

  function setThumbActive(btn, active) {
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
    const img = btn.querySelector("img");
    if (img) img.classList.toggle("active", active);
  }

  // Mantiene el foco dentro del modal mientras está abierto: Tab desde el último
  // control vuelve al primero y Mayús+Tab desde el primero va al último.
  function trapFocus(e) {
    if (e.key !== "Tab") return;
    const modal = els.modalRoot.querySelector(".modal");
    if (!modal) return;
    const focusables = Array.from(
      modal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  }

  function closeModal(options) {
    const backdrop = document.getElementById("modal-backdrop");
    if (!backdrop || backdrop.classList.contains("closing")) return;
    backdrop.classList.add("closing");
    document.body.style.overflow = "";
    const opener = modalOpener;
    modalOpener = null;
    setTimeout(() => {
      if (backdrop.parentNode === els.modalRoot) els.modalRoot.innerHTML = "";
    }, 160);
    // Se devuelve el foco al botón o la foto que abrió el modal (si sigue en la página).
    if ((!options || options.restoreFocus !== false) && opener && opener.isConnected && typeof opener.focus === "function") {
      opener.focus({ preventScroll: true });
    }
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
