"use strict";

// Integridad del catálogo real (data/products.json) y de los ficheros que dependen de él.
// Estas pruebas protegen contra el fallo clásico: añadir o editar un producto y dejar la
// web con una imagen que no existe, un slug duplicado o un sitemap desincronizado.

const fs = require("fs");
const path = require("path");
const { ROOT, loadBrowserModule } = require("./helpers");

const products = JSON.parse(fs.readFileSync(path.join(ROOT, "data/products.json"), "utf8"));
const T = loadBrowserModule("assets/js/product-page-template.js").HA_TEMPLATE;

test("el catálogo tiene productos y cada uno con los campos mínimos", () => {
  assertTrue(products.length > 0, "el catálogo está vacío");
  products.forEach((p) => {
    ["id", "title", "price", "category"].forEach((k) => {
      assertTrue(p[k] !== undefined && p[k] !== null && p[k] !== "", "el producto " + (p.id || "?") + " no tiene " + k);
    });
  });
});

test("no hay dos productos con el mismo slug", () => {
  const seen = new Set();
  products.forEach((p) => {
    const slug = p.slug || T.slugFor(p);
    assertFalse(seen.has(slug), "slug duplicado: " + slug);
    seen.add(slug);
  });
});

test("cada producto tiene un slug bien formado", () => {
  products.forEach((p) => {
    assertTrue(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug), "slug mal formado: " + p.slug);
  });
});

test("todas las imágenes de los productos existen en disco", () => {
  const missing = [];
  products.forEach((p) => {
    (p.images || []).forEach((im) => {
      if (!fs.existsSync(path.join(ROOT, im))) missing.push(p.slug + " → " + im);
    });
  });
  assertEqual(missing, [], "imágenes que faltan");
});

test("el formato declarado en el catálogo coincide con el de los ficheros", () => {
  // El catálogo declara cada imagen en products.json y el fichero tiene que estar en ese
  // mismo formato: si se convierte a WebP hay que actualizar las dos cosas a la vez.
  const mismatch = [];
  products.forEach((p) => {
    (p.images || []).forEach((im) => {
      const ext = path.extname(im).slice(1).toLowerCase();
      const alt = ext === "jpg" ? "jpeg" : ext === "jpeg" ? "jpg" : null;
      if (alt && fs.existsSync(path.join(ROOT, im.replace(new RegExp("\\." + ext + "$"), "." + alt)))) {
        mismatch.push(p.slug + " → " + im + " (existe también en ." + alt + ")");
      }
    });
  });
  assertEqual(mismatch, [], "imágenes declaradas en un formato pero duplicadas en otro");
});

test("la miniatura de cada imagen existe en disco", () => {
  // El grid del catálogo y la galería cargan <imagen>-thumb.<ext>: si falta, se ve hueco.
  const missing = [];
  products.forEach((p) => {
    (p.images || []).forEach((im) => {
      const thumb = T.thumbPath(im);
      if (thumb && !fs.existsSync(path.join(ROOT, thumb))) missing.push(p.slug + " → " + thumb);
    });
  });
  assertEqual(missing, [], "miniaturas que faltan");
});

test("los precios son números positivos y coherentes", () => {
  products.forEach((p) => {
    assertTrue(typeof p.price === "number" && p.price > 0, p.slug + " tiene un precio inválido: " + p.price);
    // discountPercent: null es la forma habitual de decir "sin descuento" en el catálogo,
    // así que solo se valida el rango cuando trae un número.
    if (p.discountPercent !== undefined && p.discountPercent !== null) {
      assertTrue(
        typeof p.discountPercent === "number" && p.discountPercent >= 0 && p.discountPercent <= 100,
        p.slug + " tiene un descuento fuera de rango: " + p.discountPercent
      );
    }
  });
});

test("los tramos de precio son válidos y están ordenados de menor a mayor", () => {
  products.forEach((p) => {
    if (!p.priceTiers) return;
    assertTrue(Array.isArray(p.priceTiers), p.slug + ": priceTiers no es una lista");
    let prev = 0;
    p.priceTiers.forEach((t) => {
      assertTrue(typeof t.minQty === "number" && t.minQty > 1, p.slug + ": minQty inválido " + t.minQty);
      assertTrue(typeof t.price === "number" && t.price >= 0, p.slug + ": precio de tramo inválido");
      assertTrue(t.minQty > prev, p.slug + ": tramos desordenados o repetidos");
      prev = t.minQty;
    });
  });
});

test("la imagen principal de cada producto tiene dimensiones declaradas", () => {
  const sinDimensiones = [];
  products.forEach((p) => {
    if (p.images && p.images.length) {
      if (!p.imageWidth || !p.imageHeight) sinDimensiones.push(p.slug);
    }
  });
  assertEqual(sinDimensiones, [], "productos sin dimensiones de imagen");
});

test("existe una ficha HTML por cada producto y no hay fichas huérfanas", () => {
  const dir = path.join(ROOT, "productos");
  const files = new Set(fs.readdirSync(dir).filter((f) => f.endsWith(".html")));
  const expected = new Set(products.map((p) => p.slug + ".html"));

  const faltan = [...expected].filter((f) => !files.has(f));
  const sobran = [...files].filter((f) => !expected.has(f));
  assertEqual(faltan, [], "fichas que faltan");
  assertEqual(sobran, [], "fichas huérfanas (producto borrado sin limpiar la página)");
});

test("el sitemap contiene una URL por cada ficha de producto", () => {
  const xml = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const locs = new Set((xml.match(/<loc>([^<]+)<\/loc>/g) || []).map((m) => m.replace(/<\/?loc>/g, "")));
  const faltan = products
    .map((p) => "https://hezuradar.com/productos/" + p.slug + ".html")
    .filter((u) => !locs.has(u));
  assertEqual(faltan, [], "productos sin URL en el sitemap");
});

test("el sitemap no incluye páginas que no deben indexarse", () => {
  const xml = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  ["admin.html", "404.html", "google"].forEach((prohibida) => {
    assertFalse(xml.includes("<loc>https://hezuradar.com/" + prohibida), "el sitemap incluye " + prohibida);
  });
});

test("el sitemap es XML bien formado y sin URLs duplicadas", () => {
  const xml = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const locs = (xml.match(/<loc>([^<]+)<\/loc>/g) || []).map((m) => m.replace(/<\/?loc>/g, ""));
  assertTrue(locs.length > 0, "el sitemap está vacío");
  assertEqual(new Set(locs).size, locs.length, "hay URLs repetidas en el sitemap");
  assertTrue(xml.trim().endsWith("</urlset>"), "el sitemap no cierra correctamente");
});

test("las fichas sin marca en el título son solo las que no caben en 60 caracteres", () => {
  const sinMarca = [];
  products.forEach((p) => {
    const pageTitle = (p.title + " — HezurAdar").length <= 60 ? p.title + " — HezurAdar" : p.title;
    if (!pageTitle.includes("HezurAdar")) sinMarca.push(p.slug);
  });
  // No es un fallo en sí, pero se deja constancia del número para detectar que crezca.
  assertTrue(sinMarca.length <= 5, "demasiadas fichas sin la marca en el título: " + sinMarca.length + " (" + sinMarca.join(", ") + ")");
});

test("las páginas generadas usan las mismas versiones de assets que la portada", () => {
  const re = /\/assets\/(?:js|css)\/(?:vendor\/)?([\w.-]+\.(?:js|css))\?v=([0-9a-zA-Z]+)/g;
  const versionsIn = (file) => {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    const found = {};
    let m;
    while ((m = re.exec(html))) found[m[1]] = m[2];
    return found;
  };
  const index = versionsIn("index.html");
  const ficha = versionsIn("productos/" + products[0].slug + ".html");
  Object.keys(ficha).forEach((file) => {
    if (index[file]) {
      assertEqual(ficha[file], index[file], "la ficha usa una versión antigua de " + file);
    }
  });
});
