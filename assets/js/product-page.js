(function () {
  "use strict";

  const scriptEl = document.currentScript;
  const productId = scriptEl.dataset.productId;
  let mainProduct = null;

  document.addEventListener("DOMContentLoaded", () => {
    bindGallery();
    bindQtyAndAdd();
    trackView();
    loadData();
  });

  // Vista de la ficha para las estadísticas del panel (el título sale del <h1>,
  // así no hay que esperar a data/products.json).
  function trackView() {
    try {
      const h1 = document.querySelector(".product-info-page h1");
      if (window.HA_ANALYTICS) window.HA_ANALYTICS.trackProductView(productId, h1 ? h1.textContent.trim() : "");
    } catch (e) {
      // Las estadísticas nunca deben interrumpir la visita.
    }
  }

  // data/products.json con la versión del catálogo que dejó escrita el generador
  // (meta "ha-catalog-version"): con ella vale la caché normal del navegador y,
  // al cambiar el catálogo, cambia la URL. Sin esa meta se revalida siempre.
  function catalogUrl(path) {
    const meta = document.querySelector('meta[name="ha-catalog-version"]');
    const version = meta && meta.content;
    return version ? path + "?v=" + encodeURIComponent(version) : path;
  }

  async function fetchJSON(path) {
    const res = await fetch(path, path.indexOf("?v=") === -1 ? { cache: "no-cache" } : undefined);
    if (!res.ok) throw new Error("No se pudo cargar " + path);
    return res.json();
  }

  async function loadData() {
    try {
      const [products, store] = await Promise.all([
        fetchJSON(catalogUrl("/data/products.json")),
        fetchJSON("/data/store.json"),
      ]);
      window.HA = window.HA || {};
      window.HA.products = products;
      window.HA.store = store;
      window.HA.waLink = waLink;
      window.HA.formatPrice = formatPrice;
      window.HA.effectivePrice = effectivePrice;
      window.HA.isOutOfStock = isOutOfStock;
      document.dispatchEvent(new CustomEvent("ha:ready"));
      mainProduct = products.find((p) => p.id === productId) || null;
      syncStockUI();
    } catch (e) {
      console.error(e);
    }
  }

  function waLink(phone, text) {
    const msg = text || "Hola, estoy interesado en vuestros productos.";
    return `https://api.whatsapp.com/send?phone=${phone.replace("+", "")}&text=${encodeURIComponent(msg)}`;
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

  function syncStockUI() {
    if (!mainProduct || !isOutOfStock(mainProduct)) return;
    const addBtn = document.getElementById("product-add-btn");
    const qtyInput = document.getElementById("product-qty");
    const dec = document.getElementById("product-qty-dec");
    const inc = document.getElementById("product-qty-inc");
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.textContent = "Sin stock";
    }
    [qtyInput, dec, inc].forEach((el) => el && (el.disabled = true));
  }

  function bindGallery() {
    const main = document.getElementById("product-main-img");
    const thumbs = document.querySelectorAll("#product-thumbs .thumb-btn");
    thumbs.forEach((th) => {
      th.addEventListener("click", () => {
        if (!main || !th.dataset.full) return;
        main.src = th.dataset.full;
        thumbs.forEach((t) => {
          const active = t === th;
          t.classList.toggle("active", active);
          t.setAttribute("aria-pressed", String(active));
          const img = t.querySelector("img");
          if (img) img.classList.toggle("active", active);
        });
      });
    });
  }

  function bindQtyAndAdd() {
    const qtyInput = document.getElementById("product-qty");
    const dec = document.getElementById("product-qty-dec");
    const inc = document.getElementById("product-qty-inc");
    if (dec)
      dec.addEventListener("click", () => {
        qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
      });
    if (inc)
      inc.addEventListener("click", () => {
        qtyInput.value = (parseInt(qtyInput.value, 10) || 1) + 1;
      });
    const addBtn = document.getElementById("product-add-btn");
    if (addBtn)
      addBtn.addEventListener("click", () => {
        const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
        if (window.HA && window.HA.cart) window.HA.cart.add(productId, qty);
      });
  }
})();
