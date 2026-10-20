"use strict";

// Lógica del catálogo y de la plantilla de fichas (assets/js/product-page-template.js).

const { loadBrowserModule } = require("./helpers");
const T = loadBrowserModule("assets/js/product-page-template.js").HA_TEMPLATE;

test("slugify quita acentos y pasa a minúsculas con guiones", () => {
  assertEqual(T.slugify("Cejuela de cuerno de buey ámbar"), "cejuela-de-cuerno-de-buey-ambar");
  assertEqual(T.slugify("Selleta 72 × 3 × 9 mm"), "selleta-72-3-9-mm");
});

test("slugify no deja guiones al principio ni al final", () => {
  const s = T.slugify("  ¡Hueso!  ");
  assertFalse(/^-|-$/.test(s), "slug con guion en los extremos: " + s);
  assertFalse(/--/.test(s), "slug con guiones dobles: " + s);
});

test("slugFor siempre deriva el slug del título más un trozo del id", () => {
  const s = T.slugFor({ id: "3f9a1b2c-4d5e", title: "Cejuela de hueso" });
  assertEqual(s, "cejuela-de-hueso-3f9a1b2c");
});

test("escapeHtml neutraliza los caracteres peligrosos", () => {
  assertEqual(T.escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assertEqual(T.escapeHtml("a & b 'c'"), "a &amp; b &#39;c&#39;");
});

test("formatPrice escribe el precio en formato español con dos decimales", () => {
  const s = T.formatPrice(12.5);
  assertTrue(s.includes("12,50"), "esperado 12,50 en: " + s);
  assertTrue(s.includes("€"), "esperado símbolo de euro en: " + s);
});

test("effectivePrice aplica el porcentaje de descuento", () => {
  assertEqual(T.effectivePrice({ price: 10, discountPercent: 20 }), 8);
  assertEqual(T.effectivePrice({ price: 10 }), 10);
  // Un descuento inválido no debe romper el cálculo.
  assertEqual(T.effectivePrice({ price: 10, discountPercent: 0 }), 10);
});

test("isOutOfStock distingue sin existencias de disponible", () => {
  assertTrue(T.isOutOfStock({ stock: 0 }));
  assertFalse(T.isOutOfStock({ stock: 3 }));
});

test("thumbPath deriva la miniatura del nombre del archivo", () => {
  assertEqual(T.thumbPath("images/products/abc_0.webp"), "images/products/abc_0-thumb.webp");
  // Sin extensión conocida se añade el sufijo al final, sin dejar la ruta rota.
  assertEqual(T.thumbPath("images/products/abc_0"), "images/products/abc_0-thumb");
  assertEqual(T.thumbPath(""), "");
});

test("imageDimensionsFromBytes lee las dimensiones de un PNG real", () => {
  // PNG 1×1 mínimo válido (cabecera IHDR con ancho y alto).
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const dims = T.imageDimensionsFromBytes(png);
  assertEqual(dims, { width: 1, height: 1 });
});

test("imageDimensionsFromBytes devuelve null con bytes que no son imagen", () => {
  assertEqual(T.imageDimensionsFromBytes(Buffer.from("no soy una imagen")), null);
});

test("buildSitemapXml produce un XML con todas las URLs y las escapa", () => {
  const xml = T.buildSitemapXml([
    { loc: "https://hezuradar.com/", changefreq: "weekly", priority: "1.0", lastmod: "2026-01-02" },
  ]);
  assertTrue(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "falta la cabecera XML");
  assertTrue(xml.includes("<loc>https://hezuradar.com/</loc>"), "falta la URL");
  assertTrue(xml.includes("<lastmod>2026-01-02</lastmod>"), "falta lastmod");
  assertTrue(xml.includes("</urlset>"), "falta el cierre");
});

test("sitemapEntries incluye las páginas fijas, las categorías y los productos", () => {
  const products = [{ slug: "uno", updatedAt: "2026-01-01", images: ["images/products/uno_0.webp"] }];
  const entries = T.sitemapEntries(products, () => "2026-01-01");
  const locs = entries.map((e) => e.loc);
  assertTrue(locs.includes("https://hezuradar.com/"), "falta la portada");
  assertTrue(locs.includes("https://hezuradar.com/guias.html"), "falta la página de guías");
  assertTrue(locs.includes("https://hezuradar.com/productos/uno.html"), "falta la ficha del producto");
  // Cada categoría del catálogo tiene que estar también.
  T.CATEGORY_PAGES.forEach((c) => {
    assertTrue(locs.includes("https://hezuradar.com/" + c.file), "falta la categoría " + c.file);
  });
});

test("sitemapEntries omite los productos sin slug", () => {
  const entries = T.sitemapEntries([{ title: "Sin slug" }], () => null);
  assertFalse(entries.some((e) => e.loc.includes("productos/")), "se coló un producto sin slug");
});

test("el título de la ficha añade la marca cuando cabe en 60 caracteres", () => {
  const html = T.buildProductHtml({ id: "x", title: "Cejuela corta", price: 10, images: [] }, {}, []);
  assertTrue(html.includes("<title>Cejuela corta — HezurAdar</title>"), "no añadió la marca");
});

test("el título largo se deja sin marca antes que cortarlo a medias", () => {
  const largo = "Cejuela de cuerno de buey ámbar para clásica / flamenca";
  const html = T.buildProductHtml({ id: "x", title: largo, price: 10, images: [] }, {}, []);
  assertTrue(html.includes("<title>" + largo + "</title>"), "debería quedarse solo con el título");
  assertFalse(html.includes(largo + " — HezurAdar</title>"), "añadió la marca pasando de 60 caracteres");
});

test("buildProductHtml escapa el título puesto como texto visible", () => {
  const html = T.buildProductHtml({ id: "x", title: "Púa <b>rara</b>", price: 5, images: [] }, {}, []);
  assertFalse(html.includes("<b>rara</b>"), "el título se coló sin escapar");
  assertTrue(html.includes("&lt;b&gt;rara&lt;/b&gt;"), "no aparece el título escapado");
});

test("una descripción con </script> no rompe el JSON-LD ni inyecta HTML ejecutable", () => {
  const evil = {
    id: "x",
    title: "Producto normal",
    description: 'Púa</script><img src=x onerror=alert(1)><script>alert(2)</script>',
    price: 5,
    images: [],
  };
  const html = T.buildProductHtml(evil, {}, []);

  // El <script> del JSON-LD tiene que abrir y cerrar exactamente una vez, sin que el
  // texto del cliente lo cierre antes de tiempo.
  const opens = (html.match(/<script/g) || []).length;
  const closes = (html.match(/<\/script>/g) || []).length;
  assertEqual(opens, closes, "etiquetas <script> descompensadas");

  // Nada de HTML crudo del cliente: ni etiquetas reales ni manejadores inline.
  assertFalse(html.includes("<img src=x onerror"), "se coló un <img> sin escapar");
  assertFalse(/<script>alert\(2\)<\/script>/.test(html), "se coló un <script> inyectado");
});
