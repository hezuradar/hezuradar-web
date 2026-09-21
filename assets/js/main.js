(function () {
  "use strict";

  const state = {
    products: [],
    store: null,
    category: "Todo",
    subcategory: null,
    term: "",
    sort: "recent",
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheEls();
    bindEvents();
    try {
      const [products, store] = await Promise.all([
        fetchJSON("data/products.json"),
        fetchJSON("data/store.json"),
      ]);
      state.products = products;
      state.store = store;
      window.HA = window.HA || {};
      window.HA.products = products;
      window.HA.store = store;
      window.HA.waLink = waLink;
      window.HA.formatPrice = formatPrice;
      window.HA.effectivePrice = effectivePrice;
      window.HA.isOutOfStock = isOutOfStock;
      document.dispatchEvent(new CustomEvent("ha:ready"));
      hydrateStore(store);
      buildCategoryChips();
      render();
    } catch (err) {
      els.grid.innerHTML =
        '<div class="empty-state">No se ha podido cargar el catálogo. Comprueba que data/products.json existe.</div>';
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
    els.search.addEventListener("input", (e) => {
      state.term = e.target.value.trim().toLowerCase();
      render();
    });
    els.sort.addEventListener("change", (e) => {
      state.sort = e.target.value;
      render();
    });
  }

  function hydrateStore(store) {
    if (!store) return;
    if (els.aboutText) els.aboutText.textContent = store.aboutUs || "";
    if (els.waFloat && store.whatsapp) {
      els.waFloat.href = waLink(store.whatsapp, "Hola, tengo una consulta sobre vuestros productos.");
    }
    if (els.igLink && store.instagram) els.igLink.href = store.instagram;
    if (els.contactList) {
      els.contactList.innerHTML = `
        <li><b>Ubicación</b>Legazpi, Gipuzkoa (España)</li>
        <li><b>Email</b><a href="mailto:${escapeAttr(store.email)}">${escapeHtml(store.email)}</a></li>
        <li><b>WhatsApp</b><a href="${escapeAttr(waLink(store.whatsapp))}" target="_blank" rel="noopener">${escapeHtml(formatPhone(store.whatsapp))}</a></li>
        <li><b>Instagram</b><a href="${escapeAttr(store.instagram)}" target="_blank" rel="noopener">@hezuradar</a></li>
      `;
    }
  }

  function waLink(phone, text) {
    const msg = text || "Hola, estoy interesado en vuestros productos.";
    return `https://wa.me/${phone.replace("+", "")}?text=${encodeURIComponent(msg)}`;
  }

  function formatPhone(p) {
    return p;
  }

  async function fetchJSON(path) {
    const res = await fetch(path + "?v=" + Date.now(), { cache: "no-store" });
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
    const cats = ["Todo", ...Object.keys(tree).sort()];
    els.chips.innerHTML = cats
      .map(
        (c) =>
          `<button class="chip${c === state.category ? " active" : ""}" data-cat="${escapeAttr(c)}">${escapeHtml(c)}</button>`
      )
      .join("");
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
    els.subchips.innerHTML = list
      .map(
        (s) =>
          `<button class="subchip${s === state.subcategory ? " active" : ""}" data-sub="${escapeAttr(s)}">${escapeHtml(s)}</button>`
      )
      .join("");
    els.subchips.querySelectorAll(".subchip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.subcategory = state.subcategory === btn.dataset.sub ? null : btn.dataset.sub;
        buildSubChips(tree);
        render();
      });
    });
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
          p.title.toLowerCase().includes(state.term) ||
          (p.description || "").toLowerCase().includes(state.term)
      );
    }
    switch (state.sort) {
      case "price-asc":
        list.sort((a, b) => a.price - b.price);
        break;
      case "price-desc":
        list.sort((a, b) => b.price - a.price);
        break;
      case "name-asc":
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      default:
        break;
    }
    return list;
  }

  function render() {
    const list = getFiltered();
    els.resultsCount.textContent = `${list.length} producto${list.length === 1 ? "" : "s"}`;
    if (!list.length) {
      els.grid.innerHTML = '<div class="empty-state">No hay productos que coincidan con la búsqueda.</div>';
      return;
    }
    els.grid.innerHTML = list.map(cardTemplate).join("");
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

  function cardTemplate(p) {
    const img = (p.images && p.images[0]) || "";
    const outOfStock = isOutOfStock(p);
    const hasDiscount = Number(p.discountPercent) > 0;
    return `
      <article class="card${outOfStock ? " out-of-stock" : ""}">
        <div class="card-img${outOfStock ? " has-stock-badge" : ""}" data-open="${p.id}">
          ${outOfStock ? `<span class="badge-outofstock">Sin stock</span>` : ""}
          ${hasDiscount ? `<span class="badge-discount">-${p.discountPercent}%</span>` : ""}
          <span class="card-cat">${escapeHtml(p.subcategory || p.category)}</span>
          <img src="${img}" alt="${escapeAttr(p.title)}" loading="lazy">
        </div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(p.title)}</div>
          <div class="card-price">${
            hasDiscount
              ? `<span class="price-old">${formatPrice(p.price)}</span> ${formatPrice(effectivePrice(p))}`
              : formatPrice(p.price)
          }</div>
          <div class="card-actions">
            <button class="btn btn-outline" data-open="${p.id}">Más info</button>
            ${
              outOfStock
                ? `<button class="btn btn-outline" disabled>Sin stock</button>`
                : `<button class="btn btn-primary" data-add="${p.id}">Añadir</button>`
            }
          </div>
        </div>
      </article>
    `;
  }

  function productWaLink(p) {
    const phone = state.store ? state.store.whatsapp : "";
    const url = window.location.origin + window.location.pathname + "#producto-" + p.id;
    const text = `Hola, estoy interesado en este producto: ${p.title} ${url}`;
    return waLink(phone, text);
  }

  function formatPrice(n) {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
  }

  function effectivePrice(p) {
    const pct = Number(p.discountPercent) || 0;
    return pct > 0 ? Math.round(p.price * (1 - pct / 100) * 100) / 100 : p.price;
  }

  function isOutOfStock(p) {
    return typeof p.stock === "number" && p.stock <= 0;
  }

  function openModal(id) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    if (window.HA_ANALYTICS) window.HA_ANALYTICS.trackProductView(p.id, p.title);
    const images = p.images && p.images.length ? p.images : [""];
    const outOfStock = isOutOfStock(p);
    const hasDiscount = Number(p.discountPercent) > 0;
    els.modalRoot.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal">
          <button class="modal-close" id="modal-close" aria-label="Cerrar">&times;</button>
          <div class="modal-gallery">
            <img id="modal-main-img" src="${images[0]}" alt="${escapeAttr(p.title)}">
            ${
              images.length > 1
                ? `<div class="modal-thumbs">${images
                    .map(
                      (im, i) =>
                        `<img src="${im}" data-i="${i}" class="${i === 0 ? "active" : ""}">`
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
                ? `<span class="price-old">${formatPrice(p.price)}</span> ${formatPrice(effectivePrice(p))}`
                : formatPrice(p.price)
            }</div>
            ${outOfStock ? `<div class="status-msg err">Sin stock disponible.</div>` : ""}
            <div class="modal-desc">${escapeHtml(p.description || "")}</div>
            <div class="modal-sku">Ref. ${escapeHtml(p.sku || "-")}</div>
            <div class="qty-stepper">
              <button type="button" id="modal-qty-dec" aria-label="Menos" ${outOfStock ? "disabled" : ""}>&minus;</button>
              <input type="number" id="modal-qty" value="1" min="1" inputmode="numeric" ${outOfStock ? "disabled" : ""}>
              <button type="button" id="modal-qty-inc" aria-label="Más" ${outOfStock ? "disabled" : ""}>+</button>
            </div>
            <div class="modal-actions">
              <button class="btn btn-primary" id="modal-add-cart" ${outOfStock ? "disabled" : ""}>${outOfStock ? "Sin stock" : "Añadir a la cesta"}</button>
              <a class="btn btn-outline" target="_blank" rel="noopener" href="${productWaLink(p)}">Consultar por WhatsApp</a>
            </div>
          </div>
        </div>
      </div>
    `;
    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("modal-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "modal-backdrop") closeModal();
    });
    els.modalRoot.querySelectorAll(".modal-thumbs img").forEach((th) => {
      th.addEventListener("click", () => {
        document.getElementById("modal-main-img").src = th.src;
        els.modalRoot.querySelectorAll(".modal-thumbs img").forEach((t) => t.classList.remove("active"));
        th.classList.add("active");
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
      if (window.HA && window.HA.cart) window.HA.cart.add(p.id, qty);
      closeModal();
    });
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    const backdrop = document.getElementById("modal-backdrop");
    if (!backdrop) return;
    backdrop.classList.add("closing");
    document.body.style.overflow = "";
    setTimeout(() => {
      if (backdrop.parentNode === els.modalRoot) els.modalRoot.innerHTML = "";
    }, 160);
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
