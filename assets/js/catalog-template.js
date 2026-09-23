// Plantilla compartida para el catálogo de la portada (chips de categoría y
// tarjetas de producto). La usan tanto assets/js/main.js (navegador, para
// repintar tras filtrar/buscar/ordenar) como admin.js y
// scripts/generate-product-pages.js, que la usan para dejar precalculado en
// index.html el estado inicial "Todo" del catálogo. Sin esto, el grid nace
// vacío y se rellena por JavaScript tras cargar data/products.json: ese
// cambio de altura de golpe en <main> es el que provocaba el salto de diseño
// (CLS) que señalaba PageSpeed, con independencia de si había o no tarjetas
// "esqueleto" reservando hueco (la altura final nunca coincidía con la del
// esqueleto).
(function (root) {
  "use strict";

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeAttr(str) {
    return escapeHtml(str);
  }

  // Ruta de la miniatura (~500px) de una foto de producto: se usa en el grid
  // del catálogo y en la tira de miniaturas del modal, donde nunca hace falta
  // la imagen a tamaño completo (esa se reserva para la vista principal).
  function thumbPath(path) {
    if (!path) return "";
    var i = path.lastIndexOf(".");
    return i === -1 ? path + "-thumb" : path.slice(0, i) + "-thumb" + path.slice(i);
  }

  function formatPrice(n) {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
  }

  function effectivePrice(p) {
    var pct = Number(p.discountPercent) || 0;
    return pct > 0 ? Math.round(p.price * (1 - pct / 100) * 100) / 100 : p.price;
  }

  function isOutOfStock(p) {
    return typeof p.stock === "number" && p.stock <= 0;
  }

  function categoryList(products) {
    var seen = {};
    products.forEach(function (p) {
      seen[p.category] = true;
    });
    return ["Todo"].concat(Object.keys(seen).sort());
  }

  function buildChipsHtml(products, activeCategory) {
    var active = activeCategory || "Todo";
    return categoryList(products)
      .map(function (c) {
        return (
          '<button class="chip' +
          (c === active ? " active" : "") +
          '" data-cat="' +
          escapeAttr(c) +
          '">' +
          escapeHtml(c) +
          "</button>"
        );
      })
      .join("");
  }

  function buildCardHtml(p) {
    var img = (p.images && p.images[0]) || "";
    var outOfStock = isOutOfStock(p);
    var hasDiscount = Number(p.discountPercent) > 0;
    return (
      '\n      <article class="card' +
      (outOfStock ? " out-of-stock" : "") +
      '">\n        <div class="card-img' +
      (outOfStock ? " has-stock-badge" : "") +
      '" data-open="' +
      p.id +
      '">\n          ' +
      (outOfStock ? '<span class="badge-outofstock">Sin stock</span>\n          ' : "") +
      (hasDiscount ? '<span class="badge-discount">-' + p.discountPercent + '%</span>\n          ' : "") +
      '<span class="card-cat">' +
      escapeHtml(p.subcategory || p.category) +
      '</span>\n          <img src="' +
      thumbPath(img) +
      '" alt="' +
      escapeAttr(p.title) +
      '" loading="lazy">\n        </div>\n        <div class="card-body">\n          <h3 class="card-title">' +
      (p.slug
        ? '<a href="productos/' + escapeAttr(p.slug) + '.html">' + escapeHtml(p.title) + "</a>"
        : escapeHtml(p.title)) +
      '</h3>\n          <div class="card-price">' +
      (hasDiscount
        ? '<span class="price-old">' + formatPrice(p.price) + "</span> " + formatPrice(effectivePrice(p))
        : formatPrice(p.price)) +
      '</div>\n          <div class="card-actions">\n            <button class="btn btn-outline" data-open="' +
      p.id +
      '">Más info</button>\n            ' +
      (outOfStock
        ? '<button class="btn btn-outline" disabled>Sin stock</button>'
        : '<button class="btn btn-primary" data-add="' + p.id + '">Añadir</button>') +
      "\n          </div>\n        </div>\n      </article>\n    "
    );
  }

  function buildGridHtml(products) {
    return products.map(buildCardHtml).join("");
  }

  function resultsCountText(count) {
    return count + " producto" + (count === 1 ? "" : "s");
  }

  function replaceBetweenMarkers(html, startMarker, endMarker, inner) {
    var escapedStart = startMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var pattern = new RegExp(escapedStart + "[\\s\\S]*?" + escapedEnd);
    if (!pattern.test(html)) {
      throw new Error("No se han encontrado los marcadores " + startMarker + " / " + endMarker + " en el HTML.");
    }
    return html.replace(pattern, startMarker + inner + endMarker);
  }

  // Sustituye, dentro del HTML de la portada, el estado inicial "Todo" del
  // catálogo (chips de categoría, contador de resultados y tarjetas) por el
  // que corresponde a `products`.
  function injectHomepageMarkup(html, products) {
    html = replaceBetweenMarkers(html, "<!--HA:CHIPS_START-->", "<!--HA:CHIPS_END-->", buildChipsHtml(products, "Todo"));
    html = replaceBetweenMarkers(html, "<!--HA:COUNT_START-->", "<!--HA:COUNT_END-->", resultsCountText(products.length));
    html = replaceBetweenMarkers(html, "<!--HA:GRID_START-->", "<!--HA:GRID_END-->", buildGridHtml(products));
    return html;
  }

  var api = {
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    thumbPath: thumbPath,
    formatPrice: formatPrice,
    effectivePrice: effectivePrice,
    isOutOfStock: isOutOfStock,
    categoryList: categoryList,
    buildChipsHtml: buildChipsHtml,
    buildCardHtml: buildCardHtml,
    buildGridHtml: buildGridHtml,
    resultsCountText: resultsCountText,
    injectHomepageMarkup: injectHomepageMarkup,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.HA_CATALOG_TEMPLATE = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
