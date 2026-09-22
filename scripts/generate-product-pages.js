#!/usr/bin/env node
// Migración/backfill: asigna slug a los productos que no lo tengan, genera
// productos/<slug>.html para cada producto y regenera sitemap.xml.
// Uso: node scripts/generate-product-pages.js
//
// Esta misma plantilla (assets/js/product-page-template.js) es la que usa
// admin.js en el navegador para mantener las páginas al día en cada
// creación/edición/borrado; este script solo sirve para el alta inicial
// o para regenerar todo el catálogo de golpe si hiciera falta.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TEMPLATE = require(path.join(ROOT, "assets/js/product-page-template.js"));

const PRODUCTS_PATH = path.join(ROOT, "data/products.json");
const STORE_PATH = path.join(ROOT, "data/store.json");
const PRODUCTS_DIR = path.join(ROOT, "productos");
const SITEMAP_PATH = path.join(ROOT, "sitemap.xml");

// Fecha real del último commit que tocó el archivo, para <lastmod> en el sitemap.
function gitLastModified(relPath) {
  try {
    const out = execSync('git log -1 --format=%cI -- "' + relPath + '"', { cwd: ROOT }).toString().trim();
    return out || null;
  } catch (e) {
    return null;
  }
}

function main() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));
  const store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));

  const usedSlugs = new Set();
  let changed = false;
  const today = new Date().toISOString().slice(0, 10);

  products.forEach((p) => {
    if (!p.slug) {
      p.slug = TEMPLATE.slugFor(p);
      changed = true;
    }
    if (usedSlugs.has(p.slug)) {
      throw new Error("Slug duplicado tras generar: " + p.slug + " (producto " + p.id + ")");
    }
    usedSlugs.add(p.slug);

    // Dimensiones reales de la imagen principal (para og:image:width/height y
    // evitar layout shift), leídas del archivo, nunca inventadas.
    const mainImage = p.images && p.images[0];
    if (mainImage) {
      const imgPath = path.join(ROOT, mainImage);
      if (fs.existsSync(imgPath)) {
        const dims = TEMPLATE.imageDimensionsFromBytes(fs.readFileSync(imgPath));
        if (dims && (p.imageWidth !== dims.width || p.imageHeight !== dims.height)) {
          p.imageWidth = dims.width;
          p.imageHeight = dims.height;
          changed = true;
        }
      }
    }
    if (!p.updatedAt) {
      p.updatedAt = today;
      changed = true;
    }
  });

  if (changed) {
    fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2) + "\n", "utf8");
    console.log("data/products.json actualizado con slugs nuevos.");
  }

  fs.mkdirSync(PRODUCTS_DIR, { recursive: true });

  const keepFiles = new Set();
  products.forEach((p) => {
    const html = TEMPLATE.buildProductHtml(p, store);
    const fileName = p.slug + ".html";
    fs.writeFileSync(path.join(PRODUCTS_DIR, fileName), html, "utf8");
    keepFiles.add(fileName);
  });
  console.log("Generadas " + products.length + " páginas de producto en /productos.");

  // Elimina páginas huérfanas (productos borrados en una ejecución anterior).
  fs.readdirSync(PRODUCTS_DIR).forEach((f) => {
    if (f.endsWith(".html") && !keepFiles.has(f)) {
      fs.unlinkSync(path.join(PRODUCTS_DIR, f));
      console.log("Eliminada página huérfana: " + f);
    }
  });

  const entries = [
    { loc: TEMPLATE.SITE_URL + "/", changefreq: "weekly", priority: "1.0", lastmod: gitLastModified("index.html") },
    {
      loc: TEMPLATE.SITE_URL + "/disenador.html",
      changefreq: "monthly",
      priority: "0.7",
      lastmod: gitLastModified("disenador.html"),
    },
    {
      loc: TEMPLATE.SITE_URL + "/disenador-puas.html",
      changefreq: "monthly",
      priority: "0.7",
      lastmod: gitLastModified("disenador-puas.html"),
    },
  ].concat(
    products.map((p) => ({
      loc: TEMPLATE.SITE_URL + "/productos/" + p.slug + ".html",
      changefreq: "weekly",
      priority: "0.6",
      lastmod: p.updatedAt,
    }))
  );
  fs.writeFileSync(SITEMAP_PATH, TEMPLATE.buildSitemapXml(entries), "utf8");
  console.log("sitemap.xml regenerado con " + entries.length + " URLs.");
}

main();
