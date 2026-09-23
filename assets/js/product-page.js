(function () {
  "use strict";

  const scriptEl = document.currentScript;
  const productId = scriptEl.dataset.productId;
  let mainProduct = null;

  document.addEventListener("DOMContentLoaded", () => {
    bindGallery();
    bindQtyAndAdd();
    loadData();
  });

  async function fetchJSON(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error("No se pudo cargar " + path);
    return res.json();
  }

  async function loadData() {
    try {
      const [products, store] = await Promise.all([
        fetchJSON("/data/products.json"),
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
    return `https://wa.me/${phone.replace("+", "")}?text=${encodeURIComponent(msg)}`;
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
    document.querySelectorAll("#product-thumbs img").forEach((th) => {
      th.addEventListener("click", () => {
        if (!main) return;
        main.src = th.dataset.full || th.src;
        document.querySelectorAll("#product-thumbs img").forEach((t) => t.classList.remove("active"));
        th.classList.add("active");
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
