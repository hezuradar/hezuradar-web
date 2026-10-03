// Plantilla compartida para generar la página estática de un producto.
// Se usa tanto desde admin.js (navegador, al crear/editar/borrar un producto)
// como desde scripts/generate-product-pages.mjs (Node, migración/backfill).
(function (root) {
  "use strict";

  var SITE_URL = "https://hezuradar.com";
  var STANDARD_SHIPPING_EUR = "5.50"; // Coincide con SHIPPING_COST en assets/js/cart.js
  // Mínimo legal para ventas a distancia a consumidores en España (art. 102 TRLGDCU).
  var RETURN_WINDOW_DAYS = 14;
  // Política real de devoluciones y envío (confirmada por el propietario, no
  // inventada): el cliente organiza y paga él mismo el envío de vuelta (no hay
  // importe fijo, por eso ReturnFeesCustomerResponsibility y no
  // ReturnShippingFees, que obligaría a declarar returnShippingFeesAmount), la devolución se hace por
  // correo/mensajería, el pedido se prepara en 1-2 días laborables y el
  // tránsito dentro de España peninsular es de 2-4 días laborables.
  var RETURN_FEES = "https://schema.org/ReturnFeesCustomerResponsibility";
  var RETURN_METHOD = "https://schema.org/ReturnByMail";
  var HANDLING_TIME_DAYS = { min: 1, max: 2 };
  var TRANSIT_TIME_DAYS = { min: 2, max: 4 };

  // Plantilla del catálogo (precios por cantidad): en el navegador ya está cargada como
  // window.HA_CATALOG_TEMPLATE; en Node (scripts/generate-product-pages.js) se carga aquí.
  function catalogApi() {
    if (root.HA_CATALOG_TEMPLATE) return root.HA_CATALOG_TEMPLATE;
    if (typeof require === "function") {
      try {
        return require("./catalog-template.js");
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function priceTiersHtml(product) {
    var api = catalogApi();
    return api && api.priceTiersHtml ? api.priceTiersHtml(product) : "";
  }

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

  // Ruta de la miniatura (~500px) de una foto de producto, usada en el grid del
  // catálogo, "productos relacionados" y la tira de miniaturas de la galería:
  // sitios donde nunca hace falta la imagen a tamaño completo (esa se reserva
  // para la vista principal de la ficha).
  function thumbPath(path) {
    if (!path) return "";
    var i = path.lastIndexOf(".");
    return i === -1 ? path + "-thumb" : path.slice(0, i) + "-thumb" + path.slice(i);
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

  function fullDescription(product) {
    var plain = String(product.description || "").replace(/\s+/g, " ").trim();
    if (!plain) {
      plain = (product.title || "") + " — hueso y cuerno natural para luthería, HezurAdar.";
    }
    return plain;
  }

  // Frase de cierre para las fichas con descripción muy corta (solo medidas):
  // así ninguna meta description se queda en 50-70 caracteres.
  var META_TAIL = "Material natural para luthería, preparado a mano en Legazpi. Envío a toda España.";

  function metaDescription(product) {
    var title = String(product.title || "").trim();
    // Las viñetas ("- Mejor tono: ...") se leen como frases seguidas.
    var plain = String(product.description || "")
      .split("\n")
      .map(function (line) { return line.replace(/^\s*[-•]\s*/, "").trim(); })
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!plain) return fullDescription(product);

    // Fichas con la misma descripción base (p. ej. las cejuelas talladas):
    // si el texto empieza igual que el título hasta su "para ...", se usa el
    // título completo para que cada ficha tenga una descripción distinta.
    if (title && plain.toLowerCase().indexOf(title.toLowerCase()) !== 0) {
      var tw = title.split(" ");
      var dw = plain.split(" ");
      var head = tw.indexOf("para");
      var k = 0;
      while (k < tw.length && k < dw.length && tw[k].toLowerCase() === dw[k].toLowerCase()) k++;
      var rest = dw.slice(k).join(" ");
      var titleTail = tw.slice(head).join(" ").toLowerCase();
      if (head > 1 && k === head && rest.toLowerCase().indexOf(titleTail) === -1) plain = title + " " + rest;
    }

    if (plain.length < 110) {
      var sep = /[.!?]$/.test(plain) ? " " : ". ";
      // Se añade la frase entera o su primera mitad, nunca cortada a medias.
      var tails = [META_TAIL, META_TAIL.split(". ")[0] + "."];
      for (var t = 0; t < tails.length; t++) {
        if ((plain + sep + tails[t]).length <= 160) { plain += sep + tails[t]; break; }
      }
    }
    if (plain.length <= 160) return plain;
    var cut = plain.slice(0, 158);
    cut = cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:.\-—]+$/, "");
    return cut + "…";
  }

  function waLink(phone, text) {
    return "https://api.whatsapp.com/send?phone=" + String(phone || "").replace("+", "") + "&text=" + encodeURIComponent(text);
  }

  // Lee las dimensiones reales de una imagen JPEG o PNG a partir de sus bytes,
  // sin dependencias externas (funciona igual en Node con un Buffer que en el
  // navegador con un Uint8Array leído de un File). Se usa para declarar
  // og:image:width/height y el width/height del <img> principal sin inventar
  // valores que no coincidan con el archivo real.
  function imageDimensionsFromBytes(bytes) {
    if (!bytes || bytes.length < 24) return null;
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      var i = 2;
      while (i + 8 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        var marker = bytes[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
        var len = (bytes[i + 2] << 8) | bytes[i + 3];
        var isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSOF) {
          return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
        }
        i += 2 + len;
      }
      return null;
    }
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return {
        width: ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0,
        height: ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0,
      };
    }
    return null;
  }

  function buildProductJsonLd(product, canonicalUrl) {
    var images = (product.images || []).map(function (im) {
      return SITE_URL + "/" + im;
    });
    var productNode = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.title,
      image: images,
      description: fullDescription(product),
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
          deliveryTime: {
            "@type": "ShippingDeliveryTime",
            handlingTime: {
              "@type": "QuantitativeValue",
              minValue: HANDLING_TIME_DAYS.min,
              maxValue: HANDLING_TIME_DAYS.max,
              unitCode: "DAY",
            },
            transitTime: {
              "@type": "QuantitativeValue",
              minValue: TRANSIT_TIME_DAYS.min,
              maxValue: TRANSIT_TIME_DAYS.max,
              unitCode: "DAY",
            },
          },
        },
        hasMerchantReturnPolicy: {
          "@type": "MerchantReturnPolicy",
          applicableCountry: "ES",
          returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
          merchantReturnDays: RETURN_WINDOW_DAYS,
          returnFees: RETURN_FEES,
          returnMethod: RETURN_METHOD,
        },
      },
    };
    // Tienda › página de categoría (si la ficha pertenece a una) › ficha.
    var crumbs = [{ name: "Tienda", item: SITE_URL + "/" }];
    var cat = categoryPageFor(product);
    if (cat) crumbs.push({ name: cat.name, item: SITE_URL + "/" + cat.file });
    crumbs.push({ name: product.title, item: canonicalUrl });
    var breadcrumbNode = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumbs.map(function (c, i) {
        return { "@type": "ListItem", position: i + 1, name: c.name, item: c.item };
      }),
    };
    return [productNode, breadcrumbNode]
      .map(function (node) {
        // "<" escapado para que un "</script>" dentro de un texto no cierre el bloque.
        return '<script type="application/ld+json">\n' + JSON.stringify(node, null, 2).replace(/</g, "\\u003c") + "\n</script>";
      })
      .join("\n");
  }

  // Hasta 4 productos de la misma subcategoría (o categoría, si hace falta
  // completar) para enlazar internamente entre fichas de producto reales.
  function relatedProducts(product, allProducts) {
    if (!Array.isArray(allProducts)) return [];
    var pool = allProducts.filter(function (p) {
      return p.id !== product.id && p.slug;
    });
    var sameSub = product.subcategory
      ? pool.filter(function (p) {
          return p.subcategory === product.subcategory;
        })
      : [];
    var sameCat = pool.filter(function (p) {
      return p.category === product.category && p.subcategory !== product.subcategory;
    });
    var seen = {};
    var result = [];
    sameSub.concat(sameCat).forEach(function (p) {
      if (result.length >= 4 || seen[p.id]) return;
      seen[p.id] = true;
      result.push(p);
    });
    return result;
  }

  // Tarjeta enlazada a la ficha (productos relacionados y páginas de categoría).
  function linkCardHtml(p) {
    var img = (p.images && p.images[0]) || "";
    var href = "/productos/" + escapeAttr(p.slug) + ".html";
    return (
      '<a class="card' + (isOutOfStock(p) ? " out-of-stock" : "") + '" href="' + href + '">' +
      '<div class="card-img"><span class="card-cat">' + escapeHtml(p.subcategory || p.category) + "</span>" +
      '<img src="/' + escapeAttr(thumbPath(img)) + '" alt="' + escapeAttr(p.title) + '" loading="lazy"></div>' +
      '<div class="card-body"><h3 class="card-title">' + escapeHtml(p.title) + "</h3>" +
      '<div class="card-price">' + formatPrice(effectivePrice(p)) + (isOutOfStock(p) ? " · Sin stock" : "") + "</div></div>" +
      "</a>"
    );
  }

  function relatedProductsHtml(product, allProducts) {
    var related = relatedProducts(product, allProducts);
    if (!related.length) return "";
    var cards = related.map(linkCardHtml).join("");
    return (
      '<section class="related-products container">\n' +
      "  <h2>Productos relacionados</h2>\n" +
      '  <div class="grid">' + cards + "</div>\n" +
      "</section>\n\n"
    );
  }

  function buildProductHtml(product, store, allProducts) {
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
              return (
                '<img src="/' + escapeAttr(thumbPath(im)) + '" data-full="/' + escapeAttr(im) + '"' +
                ' class="' + (i === 0 ? "active" : "") + '"' +
                ' alt="' + escapeAttr(product.title) + " - foto " + (i + 1) + '" loading="lazy">'
              );
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
      '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' https://www.google.com https://www.gstatic.com; frame-src https://www.google.com; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; font-src \'self\' https://fonts.gstatic.com; img-src \'self\' data: blob:; connect-src \'self\' https://firestore.googleapis.com https://api.emailjs.com https://script.google.com https://script.googleusercontent.com; object-src \'none\'; base-uri \'self\'; form-action \'self\';">\n' +
      "<title>" + escapeHtml(product.title) + " — HezurAdar</title>\n" +
      '<meta name="description" content="' + escapeAttr(metaDescription(product)) + '">\n' +
      '<link rel="canonical" href="' + canonicalUrl + '">\n' +
      '<meta property="og:type" content="product">\n' +
      '<meta property="og:site_name" content="HezurAdar">\n' +
      '<meta property="og:title" content="' + escapeAttr(product.title) + " — HezurAdar" + '">\n' +
      '<meta property="og:description" content="' + escapeAttr(metaDescription(product)) + '">\n' +
      '<meta property="og:url" content="' + canonicalUrl + '">\n' +
      '<meta property="og:image" content="' + absMainImage + '">\n' +
      (product.imageWidth && product.imageHeight
        ? '<meta property="og:image:width" content="' + product.imageWidth + '">\n' +
          '<meta property="og:image:height" content="' + product.imageHeight + '">\n'
        : "") +
      '<meta property="og:locale" content="es_ES">\n' +
      '<meta property="product:price:amount" content="' + effectivePrice(product).toFixed(2) + '">\n' +
      '<meta property="product:price:currency" content="EUR">\n' +
      '<meta name="twitter:card" content="summary_large_image">\n' +
      '<meta name="twitter:title" content="' + escapeAttr(product.title) + " — HezurAdar" + '">\n' +
      '<meta name="twitter:description" content="' + escapeAttr(metaDescription(product)) + '">\n' +
      '<meta name="twitter:image" content="' + absMainImage + '">\n' +
      '<link rel="icon" href="/favicon.ico" sizes="any">\n' +
      '<link rel="icon" href="/images/site/favicon-32x32.png" sizes="32x32" type="image/png">\n' +
      '<link rel="icon" href="/images/site/favicon-16x16.png" sizes="16x16" type="image/png">\n' +
      '<link rel="apple-touch-icon" href="/images/site/apple-touch-icon.png">\n' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=optional" rel="stylesheet">\n' +
      '<link rel="stylesheet" href="/assets/css/style.css?v=20261003c">\n' +
      '<script src="/assets/js/device.js?v=20260915l"></script>\n' +
      buildProductJsonLd(product, canonicalUrl) + "\n" +
      "</head>\n" +
      "<body>\n\n" +
      '<header class="site-header">\n' +
      '  <div class="container">\n' +
      '    <a class="brand" href="/">\n' +
      '      <img src="/images/site/logo.jpg" alt="Logo HezurAdar">\n' +
      "      HezurAdar\n" +
      "    </a>\n" +
      '    <nav class="header-nav">\n' +
      '      <div class="header-links">\n' +
      '        <a class="pill-btn" href="/disenador.html">Personaliza tu placa</a>\n' +
      '        <a class="pill-btn" href="/disenador-puas.html">Personaliza tus púas</a>\n' +
      '        <a class="pill-btn" href="/#about">Quiénes somos</a>\n' +
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
      '  <nav class="breadcrumb"><a href="/">Tienda</a> › ' +
      (categoryPageFor(product)
        ? '<a href="/' + categoryPageFor(product).file + '">' + escapeHtml(categoryPageFor(product).name) + "</a>"
        : escapeHtml(catLabel)) +
      "</nav>\n" +
      '  <div class="product-detail">\n' +
      '    <div class="product-gallery-page">\n' +
      '      <div class="product-gallery-main"><img id="product-main-img" src="/' + escapeAttr(mainImage) + '" alt="' + escapeAttr(product.title) + '" fetchpriority="high"' +
      (product.imageWidth && product.imageHeight ? ' width="' + product.imageWidth + '" height="' + product.imageHeight + '"' : "") +
      "></div>\n" +
      "      " + thumbsHtml + "\n" +
      "    </div>\n" +
      '    <div class="product-info-page">\n' +
      '      <div class="product-cat-page">' + escapeHtml(catLabel) + "</div>\n" +
      "      <h1>" + escapeHtml(product.title) + "</h1>\n" +
      '      <div class="product-price-page">' + priceHtml + "</div>\n" +
      (priceTiersHtml(product) ? "      " + priceTiersHtml(product) + "\n" : "") +
      (outOfStock ? '      <div class="status-msg err">Sin stock disponible.</div>\n' : "") +
      '      <p class="product-desc-page">' + escapeHtml(product.description || "") + "</p>\n" +
      '      <div class="product-sku-page">Ref. ' + escapeHtml(product.sku || "-") + "</div>\n" +
      '      <div class="qty-stepper">\n' +
      '        <button type="button" id="product-qty-dec" aria-label="Menos"' + (outOfStock ? " disabled" : "") + ">&minus;</button>\n" +
      '        <input type="number" id="product-qty" value="1" min="1" inputmode="numeric" aria-label="Cantidad"' + (outOfStock ? " disabled" : "") + ">\n" +
      '        <button type="button" id="product-qty-inc" aria-label="Más"' + (outOfStock ? " disabled" : "") + ">+</button>\n" +
      "      </div>\n" +
      '      <div class="product-actions-page">\n' +
      '        <button class="btn btn-primary" id="product-add-btn"' + (outOfStock ? " disabled" : "") + ">" + (outOfStock ? "Sin stock" : "Añadir a la cesta") + "</button>\n" +
      '        <a class="btn btn-outline" target="_blank" rel="noopener" href="' + escapeAttr(waHref) + '">Consultar por WhatsApp</a>\n' +
      "      </div>\n" +
      '      <a class="btn btn-outline" href="/">← Volver al catálogo</a>\n' +
      "    </div>\n" +
      "  </div>\n" +
      relatedProductsHtml(product, allProducts) +
      "</main>\n\n" +
      footerHtml(instagram) +
      '<a class="wa-float" href="' + escapeAttr(waFloatHref) + '" target="_blank" rel="noopener" aria-label="WhatsApp">\n' +
      '  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2zm0 18.02c-1.5 0-2.96-.4-4.24-1.16l-.3-.18-3.12.82.83-3.04-.2-.31a8.06 8.06 0 0 1-1.24-4.24c0-4.46 3.63-8.09 8.1-8.09 2.16 0 4.2.85 5.73 2.38a8.05 8.05 0 0 1 2.37 5.72c0 4.46-3.63 8.1-8.1 8.1zm4.44-6.06c-.24-.12-1.44-.71-1.66-.79-.22-.08-.39-.12-.55.12-.16.24-.63.79-.78.95-.14.16-.29.18-.53.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.01-.37.11-.49.11-.11.24-.29.36-.43.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.42-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.13 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28z"/></svg>\n' +
      "</a>\n\n" +
      '<div id="cart-root"></div>\n\n' +
      '<script src="/assets/js/year.js?v=20260915l"></script>\n' +
      '<script src="/assets/js/vendor/firebase-app-compat-10.12.2.js"></script>\n' +
      '<script src="/assets/js/vendor/firebase-firestore-compat-10.12.2.js"></script>\n' +
      '<script src="/assets/js/firebase-config.js?v=20260915l"></script>\n' +
      '<script src="/assets/js/firebase-orders.js?v=20260915l"></script>\n' +
      '<script src="/assets/js/analytics.js?v=20261002d"></script>\n' +
      '<script src="/assets/js/vendor/emailjs-browser-4.4.1.min.js"></script>\n' +
      '<script src="/assets/js/emailjs-config.js?v=20261002e"></script>\n' +
      '<script src="/assets/js/emailjs-notify.js?v=20261002e"></script>\n' +
      '<script src="/assets/js/catalog-template.js?v=20261002d"></script>\n' +
      '<script src="/assets/js/drive-export.js?v=20261002e"></script>\n' +
      '<script src="/assets/js/cart.js?v=20261002f"></script>\n' +
      '<script src="/assets/js/product-page.js?v=20261002f" data-product-id="' + escapeAttr(product.id) + '"></script>\n' +
      "</body>\n" +
      "</html>\n"
    );
  }

  /* ---------------- PÁGINAS DE CATEGORÍA ---------------- */

  // Cada tipo de pieza tiene su propia página (/cejuelas.html, ...) con un texto
  // propio y sus productos, para que Google pueda posicionar búsquedas como
  // "cejuela de hueso" o "selleta de cuerno": los chips de la portada son solo
  // un filtro en el navegador y no tienen URL. Una ficha va a la primera
  // página cuyo `match` cumpla (ese orden decide también sus migas de pan).
  // Los textos son HTML de confianza escrito aquí, no datos del catálogo.
  var CATEGORY_PAGES = [
    {
      file: "cejuelas.html",
      name: "Cejuelas",
      title: "Cejuelas de hueso y cuerno para guitarra",
      h1: "Cejuelas de hueso, cuerno y madre perla",
      description:
        "Cejuelas talladas a mano para Fender, Les Paul, SG, acústica y clásica, y piezas en bruto de hueso, cuerno y madre perla para tallar la tuya.",
      match: function (p) {
        return p.subcategory === "Cejuela" || p.subcategory === "Cejuelas talladas";
      },
      intro:
        "<p>La cejuela marca el punto donde empiezan a vibrar las cuerdas al aire y define su separación y su altura en el primer traste. " +
        "Aquí tienes dos opciones: <strong>cejuelas ya talladas a mano</strong>, listas para ajustar a tu guitarra, y <strong>piezas en bruto</strong> " +
        "de hueso, cuerno o madre perla para tallarla tú a medida.</p>",
      guide:
        "<h2>Qué medida necesito</h2>" +
        '<ul class="guide-list">' +
        "<li><strong>Stratocaster y Telecaster:</strong> cejuelas talladas de 43 × 3,5 × 4 mm.</li>" +
        "<li><strong>Les Paul, SG y acústicas:</strong> cejuelas talladas de 43 × 9 × 6 mm (en algunos materiales, también de 42 a 45 mm de ancho).</li>" +
        "<li><strong>Clásica y flamenca:</strong> cejuelas talladas de 52 × 5 × 10 mm.</li>" +
        "<li><strong>Para tallar:</strong> piezas en bruto de 55 × 6 × 10 mm, y de 55 × 4 × 9 mm para cejuelas tipo Fender.</li>" +
        "</ul>" +
        '<p>Si no sabes qué medida lleva tu guitarra, mira la <a href="/guia-medidas-cejuela-selleta.html">guía de medidas de cejuelas y selletas</a>; ' +
        'para elegir material, la <a href="/guia-hueso-vs-cuerno.html">guía de hueso o cuerno</a>. ' +
        'Y si vas a tallarla tú, sigue la <a href="/guia-tallar-cejuela.html">guía para tallar una cejuela paso a paso</a>.</p>',
    },
    {
      file: "selletas.html",
      name: "Selletas",
      title: "Selletas de hueso y cuerno para guitarra",
      h1: "Selletas de hueso, cuerno y madre perla",
      description:
        "Hueso, cuerno de buey, oveja latxa y madre perla en bruto para tallar selletas y cordales: medidas estándar, extra gruesas y finas.",
      match: function (p) {
        return p.subcategory === "Selleta";
      },
      intro:
        "<p>La selleta es el punto de apoyo de las cuerdas en el puente y, en muchas guitarras acústicas, transmite buena parte de la vibración a la tapa. " +
        "Todas las piezas de esta sección vienen <strong>en bruto</strong>, con margen para tallarlas a la medida de tu instrumento, " +
        "en hueso, cuerno de buey (ámbar, negro y Ankola), cuerno de oveja latxa, búfalo y madre perla.</p>",
      guide:
        "<h2>Qué formato elegir</h2>" +
        '<ul class="guide-list">' +
        "<li><strong>Selleta estándar:</strong> 105 × 4 × 10 mm u 85 × 4 × 10 mm.</li>" +
        "<li><strong>Extra gruesa:</strong> unos 6-7 mm de grosor, para puentes con una ranura más ancha.</li>" +
        "<li><strong>Fina:</strong> 105 × 2,5 × 11 mm.</li>" +
        "<li><strong>Cordal o selleta:</strong> piezas más altas, de 85 × 3 × 15 mm (en hueso, 85 × 2,5 × 15 mm).</li>" +
        "</ul>" +
        '<p>Para medir la tuya, consulta la <a href="/guia-medidas-cejuela-selleta.html">guía de medidas de cejuelas y selletas</a>; ' +
        'para elegir material, la <a href="/guia-hueso-vs-cuerno.html">guía de hueso o cuerno</a>. ' +
        'Y si vas a tallarla tú, sigue la <a href="/guia-tallar-selleta.html">guía para tallar una selleta paso a paso</a>.</p>',
    },
    {
      file: "pines-guitarra-acustica.html",
      name: "Pines",
      title: "Pines de hueso y cuerno para guitarra acústica",
      h1: "Pines de puente de hueso y cuerno para guitarra acústica",
      description:
        "Sets de 6 pines de puente de cuerno de buey negro o ámbar y de hueso blanco veta, con o sin ranura, para guitarras acústicas con pines estándar.",
      match: function (p) {
        return p.subcategory === "Pines";
      },
      intro:
        "<p>Los pines sujetan las cuerdas en el puente de la guitarra acústica. A diferencia de los de plástico estándar, el hueso y el cuerno " +
        "transmiten mejor la vibración, lo que se nota en la resonancia y el sustain. Se venden en <strong>sets de 6</strong>, fabricados artesanalmente.</p>",
      guide:
        "<h2>Con ranura o sin ranurar</h2>" +
        '<ul class="guide-list">' +
        "<li><strong>Ranurados:</strong> la ranura facilita el paso de la cuerda y hace más cómodo el cambio de cuerdas.</li>" +
        "<li><strong>Sin ranurar:</strong> acabado liso que mantiene el diseño tradicional del pin.</li>" +
        "</ul>" +
        "<p>Todos son para guitarras acústicas con pines de puente estándar. Si tienes dudas con tu modelo, pregúntanos por WhatsApp. " +
        'Te explicamos cómo elegir entre ranurados y lisos, y cómo cambiarlos, en la <a href="/guia-cambiar-pines-guitarra.html">guía para cambiar los pines</a>.</p>',
    },
    {
      file: "puas.html",
      name: "Púas",
      title: "Púas de hueso, cuerno y resina",
      h1: "Púas de hueso, cuerno y resina para guitarra y bajo",
      description:
        "Sets de 5 púas de hueso blanco Prime Bone, cuerno de buey ámbar, cuerno de oveja latxa y resina, pulidas a mano. También púas personalizadas con tu logo.",
      match: function (p) {
        return p.subcategory === "Púas";
      },
      intro:
        "<p>Púas de material natural pulidas a mano, cómodas al tacto y sin cantos que enganchen la cuerda. Cada una es única, con sus propias vetas. " +
        "Frente al hueso, el cuerno aporta un matiz algo más cálido y algo menos de brillo en los agudos. Se venden en <strong>sets de 5</strong>.</p>",
      guide:
        "<h2>Púas con tu diseño</h2>" +
        '<p>¿Quieres tus propias púas con logo? Prueba el <a href="/disenador-puas.html">diseñador de púas</a>: sube tu logo en PDF o DXF, ' +
        "colócalo sobre la púa y te enviamos presupuesto sin compromiso.</p>",
    },
    {
      file: "madre-perla-abalone.html",
      name: "Madre perla y abalone",
      title: "Madre perla y abalone para luthería",
      h1: "Madre perla y abalone para luthería",
      description:
        "Madre perla y abalone para cejuelas, selletas, cordales, incrustaciones y adornos de puente: piezas en bruto, placas y marcos mecanizados.",
      match: function (p) {
        return p.category === "Madre perla y abalone";
      },
      intro:
        "<p>La madre perla es más dura y densa que el hueso: en una cejuela o una selleta aporta un tono más brillante, con más claridad en los agudos. " +
        "Además de piezas en bruto para tallar, tienes <strong>placas</strong> (Gold, Black y de 70 × 40 mm), <strong>marcos mecanizados</strong> " +
        "y <strong>abalone</strong> sobre base de resina para incrustaciones y adornos.</p>",
      guide:
        '<p>¿Dudas entre madre perla, hueso o cuerno? Lo explicamos en la <a href="/guia-hueso-vs-cuerno.html">guía de materiales</a>.</p>',
    },
    {
      file: "bloques-placas.html",
      name: "Bloques y placas",
      title: "Bloques y placas de hueso, cuerno y madre perla",
      h1: "Bloques, tiras y placas de hueso y cuerno",
      description:
        "Bloques, tiras y placas de hueso, cuerno de buey negro, madre perla y abalone en bruto, para tallar piezas a medida, incrustaciones y adornos de puente.",
      match: function (p) {
        return p.subcategory === "Bloques y placas";
      },
      intro:
        "<p>Material en bruto en formatos más grandes o especiales: bloques de 60 mm, tira de hueso de 300 mm, hueso teñido de negro, " +
        "adornos de puente y placas de madre perla y abalone. Pensado para tallar piezas a medida e incrustaciones.</p>",
      guide:
        '<p>Para piezas estándar de cejuela o selleta, mira directamente las secciones de <a href="/cejuelas.html">cejuelas</a> ' +
        'y <a href="/selletas.html">selletas</a>.</p>',
    },
  ];

  function categoryPageFor(product) {
    for (var i = 0; i < CATEGORY_PAGES.length; i++) {
      if (CATEGORY_PAGES[i].match(product)) return CATEGORY_PAGES[i];
    }
    return null;
  }

  // Productos que se listan en una página de categoría: todos los que cumplan su
  // `match` (una placa de madre perla sale en "Madre perla" y en "Bloques y placas").
  function categoryProducts(cat, allProducts) {
    return allProducts.filter(function (p) {
      return p.slug && cat.match(p);
    });
  }

  function footerHtml(instagram) {
    return (
      '<footer class="site-footer">\n' +
      '  <div class="container">\n' +
      '    <span>&copy; <span id="year"></span> HezurAdar · Legazpi, Gipuzkoa</span>\n' +
      '    <div class="footer-links">\n' +
      '      <a href="/#about">Quiénes somos</a>\n' +
      '      <a href="/condiciones.html">Envíos y devoluciones</a>\n' +
      '      <a href="/privacidad.html">Privacidad</a>\n' +
      '      <a href="/aviso-legal.html">Aviso legal</a>\n' +
      '      <a href="' + escapeAttr(instagram || "https://www.instagram.com/hezuradar/") + '" target="_blank" rel="noopener">Instagram</a>\n' +
      "    </div>\n" +
      "    " + footerCatsHtml() + "\n" +
      "    " + footerGuidesHtml() + "\n" +
      "  </div>\n" +
      "</footer>\n\n"
    );
  }

  // Fila de enlaces a las páginas de categoría (se repite en el pie de todas las páginas).
  function footerCatsHtml() {
    return (
      '<nav class="footer-cats" aria-label="Categorías">' +
      CATEGORY_PAGES.map(function (c) {
        return '<a href="/' + c.file + '">' + escapeHtml(c.name) + "</a>";
      }).join("") +
      "</nav>"
    );
  }

  // Guías del sitio, en el orden en que salen en el pie de página.
  var GUIDE_PAGES = [
    { file: "guia-hueso-vs-cuerno.html", name: "Hueso o cuerno" },
    { file: "guia-medidas-cejuela-selleta.html", name: "Medidas de cejuelas y selletas" },
    { file: "guia-tallar-cejuela.html", name: "Tallar una cejuela" },
    { file: "guia-tallar-selleta.html", name: "Tallar una selleta" },
    { file: "guia-cambiar-pines-guitarra.html", name: "Cambiar los pines" },
  ];

  // Fila de enlaces a las guías (se repite en el pie de todas las páginas).
  function footerGuidesHtml() {
    return (
      '<nav class="footer-cats footer-guides" aria-label="Guías"><span>Guías:</span>' +
      GUIDE_PAGES.map(function (g) {
        return '<a href="/' + g.file + '">' + escapeHtml(g.name) + "</a>";
      }).join("") +
      "</nav>"
    );
  }

  function buildCategoryJsonLd(cat, items) {
    var url = SITE_URL + "/" + cat.file;
    var nodes = [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: cat.title,
        description: cat.description,
        url: url,
        inLanguage: "es",
        isPartOf: { "@type": "WebSite", name: "HezurAdar", url: SITE_URL + "/" },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: items.length,
          itemListElement: items.map(function (p, i) {
            return { "@type": "ListItem", position: i + 1, url: SITE_URL + "/productos/" + p.slug + ".html", name: p.title };
          }),
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Tienda", item: SITE_URL + "/" },
          { "@type": "ListItem", position: 2, name: cat.name, item: url },
        ],
      },
    ];
    return nodes
      .map(function (node) {
        return '<script type="application/ld+json">\n' + JSON.stringify(node, null, 2).replace(/</g, "\\u003c") + "\n</script>";
      })
      .join("\n");
  }

  function buildCategoryHtml(cat, store, allProducts) {
    var items = categoryProducts(cat, allProducts);
    var url = SITE_URL + "/" + cat.file;
    var instagram = (store && store.instagram) || "https://www.instagram.com/hezuradar/";
    var phone = (store && store.whatsapp) || "+34653713428";
    var ogImage = items.length && items[0].images && items[0].images[0] ? SITE_URL + "/" + items[0].images[0] : SITE_URL + "/images/site/hero/photo-2.jpg";
    var fullTitle = cat.title + " — HezurAdar";
    var others = CATEGORY_PAGES.filter(function (c) {
      return c !== cat;
    });
    return (
      "<!DOCTYPE html>\n" +
      '<html lang="es">\n' +
      "<head>\n" +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; font-src \'self\' https://fonts.gstatic.com; img-src \'self\' data:; object-src \'none\'; base-uri \'self\'; form-action \'self\';">\n' +
      "<title>" + escapeHtml(fullTitle) + "</title>\n" +
      '<meta name="description" content="' + escapeAttr(cat.description) + '">\n' +
      '<link rel="canonical" href="' + url + '">\n' +
      '<meta property="og:type" content="website">\n' +
      '<meta property="og:site_name" content="HezurAdar">\n' +
      '<meta property="og:title" content="' + escapeAttr(fullTitle) + '">\n' +
      '<meta property="og:description" content="' + escapeAttr(cat.description) + '">\n' +
      '<meta property="og:url" content="' + url + '">\n' +
      '<meta property="og:image" content="' + escapeAttr(ogImage) + '">\n' +
      '<meta property="og:locale" content="es_ES">\n' +
      '<meta name="twitter:card" content="summary_large_image">\n' +
      '<meta name="twitter:title" content="' + escapeAttr(fullTitle) + '">\n' +
      '<meta name="twitter:description" content="' + escapeAttr(cat.description) + '">\n' +
      '<meta name="twitter:image" content="' + escapeAttr(ogImage) + '">\n' +
      '<link rel="icon" href="/favicon.ico" sizes="any">\n' +
      '<link rel="icon" href="/images/site/favicon-32x32.png" sizes="32x32" type="image/png">\n' +
      '<link rel="icon" href="/images/site/favicon-16x16.png" sizes="16x16" type="image/png">\n' +
      '<link rel="apple-touch-icon" href="/images/site/apple-touch-icon.png">\n' +
      '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=optional" rel="stylesheet">\n' +
      '<link rel="stylesheet" href="/assets/css/style.css?v=20261003c">\n' +
      '<script src="/assets/js/device.js?v=20260915l"></script>\n' +
      buildCategoryJsonLd(cat, items) + "\n" +
      "</head>\n" +
      "<body>\n\n" +
      '<header class="site-header">\n' +
      '  <div class="container">\n' +
      '    <a class="brand" href="/">\n' +
      '      <img src="/images/site/logo.jpg" alt="Logo HezurAdar">\n' +
      "      HezurAdar\n" +
      "    </a>\n" +
      '    <nav class="header-nav">\n' +
      '      <div class="header-links">\n' +
      '        <a class="pill-btn" href="/disenador.html">Personaliza tu placa</a>\n' +
      '        <a class="pill-btn" href="/disenador-puas.html">Personaliza tus púas</a>\n' +
      '        <a class="pill-btn" href="/">← Volver a la tienda</a>\n' +
      "      </div>\n" +
      "    </nav>\n" +
      "  </div>\n" +
      "</header>\n\n" +
      '<main class="container product-page category-page">\n' +
      '  <nav class="breadcrumb"><a href="/">Tienda</a> › ' + escapeHtml(cat.name) + "</nav>\n" +
      '  <div class="category-intro">\n' +
      "    <h1>" + escapeHtml(cat.h1) + "</h1>\n" +
      "    " + cat.intro + "\n" +
      '    <p class="category-count">' + items.length + " producto" + (items.length === 1 ? "" : "s") + "</p>\n" +
      "  </div>\n" +
      '  <div class="grid">' + items.map(linkCardHtml).join("") + "</div>\n" +
      '  <section class="category-guide">\n' +
      "    " + cat.guide + "\n" +
      '    <div class="product-actions-page">\n' +
      '      <a class="btn btn-primary" href="/">Ver todo el catálogo</a>\n' +
      '      <a class="btn btn-outline" target="_blank" rel="noopener" href="' +
      escapeAttr(waLink(phone, "Hola, tengo una consulta sobre " + cat.name.toLowerCase() + ".")) +
      '">Consultar por WhatsApp</a>\n' +
      "    </div>\n" +
      '    <p class="category-others">También te puede interesar: ' +
      others
        .map(function (c) {
          return '<a href="/' + c.file + '">' + escapeHtml(c.name) + "</a>";
        })
        .join(" · ") +
      "</p>\n" +
      "  </section>\n" +
      "</main>\n\n" +
      footerHtml(instagram) +
      '<script src="/assets/js/year.js?v=20260915l"></script>\n' +
      "</body>\n" +
      "</html>\n"
    );
  }

  /* ---------------- SITEMAP ---------------- */

  // Páginas fijas del sitemap. Lista única para scripts/generate-product-pages.js
  // y admin.js, para que al guardar un producto no se pierda ninguna.
  var STATIC_PAGES = [
    { path: "", changefreq: "weekly", priority: "1.0", file: "index.html" },
    { path: "disenador.html", changefreq: "monthly", priority: "0.7" },
    { path: "disenador-puas.html", changefreq: "monthly", priority: "0.7" },
    { path: "guia-hueso-vs-cuerno.html", changefreq: "monthly", priority: "0.5" },
    { path: "guia-medidas-cejuela-selleta.html", changefreq: "monthly", priority: "0.5" },
    { path: "guia-tallar-cejuela.html", changefreq: "monthly", priority: "0.5" },
    { path: "guia-tallar-selleta.html", changefreq: "monthly", priority: "0.5" },
    { path: "guia-cambiar-pines-guitarra.html", changefreq: "monthly", priority: "0.5" },
    { path: "condiciones.html", changefreq: "yearly", priority: "0.2" },
    { path: "privacidad.html", changefreq: "yearly", priority: "0.2" },
    { path: "cookies.html", changefreq: "yearly", priority: "0.2" },
    { path: "aviso-legal.html", changefreq: "yearly", priority: "0.2" },
  ];

  // Entradas completas del sitemap. `lastmodFor(archivo)` es opcional (en Node
  // devuelve la fecha del último commit; en el navegador no se conoce).
  function sitemapEntries(allProducts, lastmodFor) {
    var lm = lastmodFor || function () { return null; };
    return STATIC_PAGES.map(function (s) {
      return { loc: SITE_URL + "/" + s.path, changefreq: s.changefreq, priority: s.priority, lastmod: lm(s.file || s.path) };
    })
      .concat(
        CATEGORY_PAGES.map(function (c) {
          return { loc: SITE_URL + "/" + c.file, changefreq: "weekly", priority: "0.8", lastmod: lm(c.file) };
        })
      )
      .concat(
        allProducts
          .filter(function (p) {
            return p.slug;
          })
          .map(function (p) {
            return {
              loc: SITE_URL + "/productos/" + p.slug + ".html",
              changefreq: "weekly",
              priority: "0.6",
              lastmod: p.updatedAt,
              images: (p.images || []).map(function (im) {
                return SITE_URL + "/" + im;
              }),
            };
          })
      );
  }

  function buildSitemapXml(entries) {
    var body = entries
      .map(function (e) {
        var imagesXml = (e.images || [])
          .map(function (imgUrl) {
            return "    <image:image>\n      <image:loc>" + imgUrl + "</image:loc>\n    </image:image>\n";
          })
          .join("");
        return (
          "  <url>\n" +
          "    <loc>" + e.loc + "</loc>\n" +
          (e.lastmod ? "    <lastmod>" + e.lastmod + "</lastmod>\n" : "") +
          (e.changefreq ? "    <changefreq>" + e.changefreq + "</changefreq>\n" : "") +
          (e.priority ? "    <priority>" + e.priority + "</priority>\n" : "") +
          imagesXml +
          "  </url>"
        );
      })
      .join("\n");
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
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
    imageDimensionsFromBytes: imageDimensionsFromBytes,
    thumbPath: thumbPath,
    buildProductHtml: buildProductHtml,
    buildSitemapXml: buildSitemapXml,
    sitemapEntries: sitemapEntries,
    CATEGORY_PAGES: CATEGORY_PAGES,
    categoryPageFor: categoryPageFor,
    buildCategoryHtml: buildCategoryHtml,
    footerCatsHtml: footerCatsHtml,
    footerGuidesHtml: footerGuidesHtml,
    SITE_URL: SITE_URL,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.HA_TEMPLATE = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
