// Plantilla compartida para generar la página estática de un producto.
// Se usa tanto desde admin.js (navegador, al crear/editar/borrar un producto)
// como desde scripts/generate-product-pages.mjs (Node, migración/backfill).
(function (root) {
  "use strict";

  var SITE_URL = "https://hezuradar.com";
  var STANDARD_SHIPPING_EUR = "5.50"; // Coincide con SHIPPING_COST en assets/js/cart.js
  var RETURN_WINDOW_DAYS = 5;

  function slugify(str) {
    return String(str || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  function slugFor(product) {
    var shortId = String(product.id || "").split("-")[0] || "x";
    var base = slugify(product.title) || "producto";
    return base + "-" + shortId;
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeAttr(str) {
    return escapeHtml(str);
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

  function metaDescription(product) {
    var plain = String(product.description || "").replace(/\s+/g, " ").trim();
    if (!plain) {
      plain = (product.title || "") + " — hueso y cuerno natural para luthería, HezurAdar.";
    }
    return plain.length > 160 ? plain.slice(0, 157).trim() + "..." : plain;
  }

  function waLink(phone, text) {
    return "https://wa.me/" + String(phone || "").replace("+", "") + "?text=" + encodeURIComponent(text);
  }

  function buildProductJsonLd(product, canonicalUrl) {
    var images = (product.images || []).map(function (im) {
      return SITE_URL + "/" + im;
    });
    var data = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.title,
      image: images,
      description: metaDescription(product),
      sku: product.sku || undefined,
      category: product.subcategory ? product.category + " / " + product.subcategory : product.category,
      brand: { "@type": "Brand", name: "HezurAdar" },
      offers: {
        "@type": "Offer",
        url: canonicalUrl,
        priceCurrency: "EUR",
        price: effectivePrice(product).toFixed(2),
        availability: isOutOfStock(product) ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
        itemCondition: "https://schema.org/NewCondition",
        shippingDetails: {
          "@type": "OfferShippingDetails",
          shippingRate: { "@type": "MonetaryAmount", value: STANDARD_SHIPPING_EUR, currency: "EUR" },
          shippingDestination: { "@type": "DefinedRegion", addressCountry: "ES" },
        },
        hasMerchantReturnPolicy: {
          "@type": "MerchantReturnPolicy",
          applicableCountry: "ES",
          returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
          merchantReturnDays: RETURN_WINDOW_DAYS,
        },
      },
    };
    return JSON.stringify(data, null, 2);
  }

  function buildProductHtml(product, store) {
    var slug = product.slug || slugFor(product);
    var canonicalUrl = SITE_URL + "/productos/" + slug + ".html";
    var images = product.images && product.images.length ? product.images : [""];
    var mainImage = images[0];
    var absMainImage = mainImage ? SITE_URL + "/" + mainImage : "";
    var outOfStock = isOutOfStock(product);
    var hasDiscount = Number(product.discountPercent) > 0;
    var priceHtml = hasDiscount
      ? '<span class="price-old">' + formatPrice(product.price) + "</span> " + formatPrice(effectivePrice(product))
      : formatPrice(product.price);
    var catLabel = product.subcategory ? product.category + " · " + product.subcategory : product.category;
    var whatsapp = store && store.whatsapp;
    var waHref = whatsapp
      ? waLink(whatsapp, "Hola, estoy interesado en este producto: " + product.title + " " + canonicalUrl)
      : "#";
    var instagram = (store && store.instagram) || "https://www.instagram.com/hezuradar/";
    var waFloatHref = whatsapp ? waLink(whatsapp, "Hola, tengo una consulta sobre vuestros productos.") : "#";

    var thumbsHtml =
      images.length > 1
        ? '<div class="product-gallery-thumbs" id="product-thumbs">' +
          images
            .map(function (im, i) {
              return '<img src="/' + escapeAttr(im) + '" class="' + (i === 0 ? "active" : "") + '" alt="">';
            })
            .join("") +
          "</div>"
        : "";

    return (
      "<!DOCTYPE html>\n" +
      '<html lang="es">\n' +
      "<head>\n" +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' https://www.gstatic.com https://cdn.jsdelivr.net; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; font-src \'self\' https://fonts.gstatic.com; img-src \'self\' data: blob:; connect-src \'self\' https://*.googleapis.com https://api.emailjs.com; object-src \'none\'; base-uri \'self\'; form-action \'self\';">\n' +
      "<title>" + escapeHtml(product.title) + " — HezurAdar</title>\n" +
      '<meta name="description" content="' + escapeAttr(metaDescription(product)) + '">\n' +
      '<link rel="canonical" href="' + canonicalUrl + '">\n' +
      '<meta property="og:type" content="product">\n' +
      '<meta property="og:site_name" content="HezurAdar">\n' +
      '<meta property="og:title" content="' + escapeAttr(product.title) + " — HezurAdar" + '">\n' +
      '<meta property="og:description" content="' + escapeAttr(metaDescription(product)) + '">\n' +
      '<meta property="og:url" content="' + canonicalUrl + '">\n' +
      '<meta property="og:image" content="' + absMainImage + '">\n' +
      '<meta property="og:locale" content="es_ES">\n' +
      '<meta property="product:price:amount" content="' + effectivePrice(product).toFixed(2) + '">\n' +
      '<meta property="product:price:currency" content="EUR">\n' +
      '<meta name="twitter:card" content="summary_large_image">\n' +
      '<meta name="twitter:title" content="' + escapeAttr(product.title) + " — HezurAdar" + '">\n' +
      '<meta name="twitter:description" content="' + escapeAttr(metaDescription(product)) + '">\n' +
      '<meta name="twitter:image" content="' + absMainImage + '">\n' +
      '<link rel="icon" href="/images/site/favicon-32x32.png" sizes="32x32">\n' +
      '<link rel="icon" href="/images/site/favicon-16x16.png" sizes="16x16">\n' +
      '<link rel="apple-touch-icon" href="/images/site/apple-touch-icon.png">\n' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">\n' +
      '<link rel="stylesheet" href="/assets/css/style.css?v=20260921b">\n' +
      '<script src="/assets/js/device.js?v=20260915l"></script>\n' +
      '<script type="application/ld+json">\n' + buildProductJsonLd(product, canonicalUrl) + "\n</script>\n" +
      "</head>\n" +
      "<body>\n\n" +
      '<header class="site-header">\n' +
      '  <div class="container">\n' +
      '    <a class="brand" href="/index.html">\n' +
      '      <img src="/images/site/logo.jpg" alt="Logo HezurAdar">\n' +
      "      HezurAdar\n" +
      "    </a>\n" +
      '    <nav class="header-nav">\n' +
      '      <div class="header-links">\n' +
      '        <a class="pill-btn" href="/disenador.html">Personaliza tu placa</a>\n' +
      '        <a class="pill-btn" href="/disenador-puas.html">Personaliza tus púas</a>\n' +
      '        <a class="pill-btn" href="/index.html#about">Quiénes somos</a>\n' +
      "      </div>\n" +
      '      <div class="header-icons">\n' +
      '        <a class="icon-btn" href="' + escapeAttr(instagram) + '" target="_blank" rel="noopener" aria-label="Instagram">\n' +
      '          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>\n' +
      "        </a>\n" +
      '        <button class="icon-btn cart-icon-btn" id="cart-btn" aria-label="Cesta">\n' +
      '          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>\n' +
      '          <span class="cart-badge" id="cart-badge">0</span>\n' +
      "        </button>\n" +
      "      </div>\n" +
      "    </nav>\n" +
      "  </div>\n" +
      "</header>\n\n" +
      '<main class="container product-page">\n' +
      '  <nav class="breadcrumb"><a href="/index.html">Tienda</a> › ' + escapeHtml(catLabel) + "</nav>\n" +
      '  <div class="product-detail">\n' +
      '    <div class="product-gallery-page">\n' +
      '      <div class="product-gallery-main"><img id="product-main-img" src="/' + escapeAttr(mainImage) + '" alt="' + escapeAttr(product.title) + '"></div>\n' +
      "      " + thumbsHtml + "\n" +
      "    </div>\n" +
      '    <div class="product-info-page">\n' +
      '      <div class="product-cat-page">' + escapeHtml(catLabel) + "</div>\n" +
      "      <h1>" + escapeHtml(product.title) + "</h1>\n" +
      '      <div class="product-price-page">' + priceHtml + "</div>\n" +
      (outOfStock ? '      <div class="status-msg err">Sin stock disponible.</div>\n' : "") +
      '      <p class="product-desc-page">' + escapeHtml(product.description || "") + "</p>\n" +
      '      <div class="product-sku-page">Ref. ' + escapeHtml(product.sku || "-") + "</div>\n" +
      '      <div class="qty-stepper">\n' +
      '        <button type="button" id="product-qty-dec" aria-label="Menos"' + (outOfStock ? " disabled" : "") + ">&minus;</button>\n" +
      '        <input type="number" id="product-qty" value="1" min="1" inputmode="numeric"' + (outOfStock ? " disabled" : "") + ">\n" +
      '        <button type="button" id="product-qty-inc" aria-label="Más"' + (outOfStock ? " disabled" : "") + ">+</button>\n" +
      "      </div>\n" +
      '      <div class="product-actions-page">\n' +
      '        <button class="btn btn-primary" id="product-add-btn"' + (outOfStock ? " disabled" : "") + ">" + (outOfStock ? "Sin stock" : "Añadir a la cesta") + "</button>\n" +
      '        <a class="btn btn-outline" target="_blank" rel="noopener" href="' + escapeAttr(waHref) + '">Consultar por WhatsApp</a>\n' +
      "      </div>\n" +
      '      <a class="btn btn-outline" href="/index.html">← Volver al catálogo</a>\n' +
      "    </div>\n" +
      "  </div>\n" +
      "</main>\n\n" +
      '<footer class="site-footer">\n' +
      '  <div class="container">\n' +
      '    <span>&copy; <span id="year"></span> HezurAdar · Legazpi, Gipuzkoa</span>\n' +
      '    <div class="footer-links">\n' +
      '      <a href="/index.html#about">Quiénes somos</a>\n' +
      '      <a href="' + escapeAttr(instagram) + '" target="_blank" rel="noopener">Instagram</a>\n' +
      "    </div>\n" +
      "  </div>\n" +
      "</footer>\n\n" +
      '<a class="wa-float" href="' + escapeAttr(waFloatHref) + '" target="_blank" rel="noopener" aria-label="WhatsApp">\n' +
      '  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2zm0 18.02c-1.5 0-2.96-.4-4.24-1.16l-.3-.18-3.12.82.83-3.04-.2-.31a8.06 8.06 0 0 1-1.24-4.24c0-4.46 3.63-8.09 8.1-8.09 2.16 0 4.2.85 5.73 2.38a8.05 8.05 0 0 1 2.37 5.72c0 4.46-3.63 8.1-8.1 8.1zm4.44-6.06c-.24-.12-1.44-.71-1.66-.79-.22-.08-.39-.12-.55.12-.16.24-.63.79-.78.95-.14.16-.29.18-.53.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.01-.37.11-.49.11-.11.24-.29.36-.43.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.42-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.13 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28z"/></svg>\n' +
      "</a>\n\n" +
      '<div id="cart-root"></div>\n\n' +
      '<script src="/assets/js/year.js?v=20260915l"></script>\n' +
      '<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>\n' +
      '<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>\n' +
      '<script src="/assets/js/firebase-config.js?v=20260915l"></script>\n' +
      '<script src="/assets/js/firebase-orders.js?v=20260915l"></script>\n' +
      '<script src="/assets/js/analytics.js?v=20260918a"></script>\n' +
      '<script src="https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/dist/email.min.js"></script>\n' +
      '<script src="/assets/js/emailjs-config.js?v=20260915l"></script>\n' +
      '<script src="/assets/js/emailjs-notify.js?v=20260915l"></script>\n' +
      '<script src="/assets/js/cart.js?v=20260921e"></script>\n' +
      '<script src="/assets/js/product-page.js?v=20260921a" data-product-id="' + escapeAttr(product.id) + '"></script>\n' +
      "</body>\n" +
      "</html>\n"
    );
  }

  function buildSitemapXml(entries) {
    var body = entries
      .map(function (e) {
        return (
          "  <url>\n" +
          "    <loc>" + e.loc + "</loc>\n" +
          (e.changefreq ? "    <changefreq>" + e.changefreq + "</changefreq>\n" : "") +
          (e.priority ? "    <priority>" + e.priority + "</priority>\n" : "") +
          "  </url>"
        );
      })
      .join("\n");
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      body +
      "\n</urlset>\n"
    );
  }

  var api = {
    slugify: slugify,
    slugFor: slugFor,
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    formatPrice: formatPrice,
    effectivePrice: effectivePrice,
    isOutOfStock: isOutOfStock,
    metaDescription: metaDescription,
    buildProductHtml: buildProductHtml,
    buildSitemapXml: buildSitemapXml,
    SITE_URL: SITE_URL,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.HA_TEMPLATE = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
