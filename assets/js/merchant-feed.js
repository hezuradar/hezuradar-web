// Feed de productos para Google Merchant Center (fichas gratuitas en Google Shopping).
// Genera /merchant-feed.xml en formato RSS 2.0 con los atributos g: de Google.
// Se usa desde scripts/generate-product-pages.js (Node) y desde admin.js (navegador),
// igual que el sitemap. Recibe la plantilla de fichas para reutilizar precio y stock.
(function (root) {
  "use strict";

  var BRAND = "HezurAdar";
  // Máximos de Merchant Center: 150 caracteres de título, 5000 de descripción y
  // 10 imágenes adicionales.
  var MAX_TITLE = 150;
  var MAX_DESCRIPTION = 5000;
  var MAX_EXTRA_IMAGES = 10;

  function escapeXml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
    });
  }

  function plainText(str, max) {
    return String(str || "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function money(value) {
    return Number(value).toFixed(2) + " EUR";
  }

  function tag(name, value) {
    return "      <" + name + ">" + escapeXml(value) + "</" + name + ">\n";
  }

  /**
   * @param {Array<object>} products catálogo (data/products.json)
   * @param {object} template API de product-page-template.js (SITE_URL, effectivePrice, isOutOfStock)
   * @returns {string} XML del feed
   */
  function buildMerchantFeed(products, template) {
    var site = template.SITE_URL;
    var items = (products || [])
      .filter(function (p) {
        return p.slug && p.images && p.images.length;
      })
      .map(function (p) {
        var sale = template.effectivePrice(p);
        var images = p.images.map(function (im) {
          return site + "/" + im;
        });
        var type = p.subcategory ? p.category + " > " + p.subcategory : p.category;
        var xml = "    <item>\n";
        xml += tag("g:id", p.sku || p.id);
        xml += tag("title", plainText(p.title, MAX_TITLE));
        xml += tag("description", plainText(p.description || p.title, MAX_DESCRIPTION));
        xml += tag("link", site + "/productos/" + p.slug + ".html");
        xml += tag("g:image_link", images[0]);
        images.slice(1, 1 + MAX_EXTRA_IMAGES).forEach(function (url) {
          xml += tag("g:additional_image_link", url);
        });
        xml += tag("g:availability", template.isOutOfStock(p) ? "out_of_stock" : "in_stock");
        xml += tag("g:price", money(p.price));
        if (sale < p.price) xml += tag("g:sale_price", money(sale));
        xml += tag("g:condition", "new");
        xml += tag("g:brand", BRAND);
        // Piezas artesanales sin GTIN: la referencia propia hace de código del fabricante.
        if (p.sku) xml += tag("g:mpn", p.sku);
        xml += tag("g:identifier_exists", "no");
        if (type) xml += tag("g:product_type", type);
        return xml + "    </item>\n";
      });
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
      "  <channel>\n" +
      "    <title>HezurAdar</title>\n" +
      "    <link>" + site + "/</link>\n" +
      "    <description>Hueso, cuerno y madre perla para luthería, y púas de material natural.</description>\n" +
      items.join("") +
      "  </channel>\n" +
      "</rss>\n"
    );
  }

  var api = { buildMerchantFeed: buildMerchantFeed };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.HA_MERCHANT_FEED = api;
  }
})(typeof window !== "undefined" ? window : this);
