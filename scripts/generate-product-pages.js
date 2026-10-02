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
const CATALOG_TEMPLATE = require(path.join(ROOT, "assets/js/catalog-template.js"));

const PRODUCTS_PATH = path.join(ROOT, "data/products.json");
const STORE_PATH = path.join(ROOT, "data/store.json");
const PRODUCTS_DIR = path.join(ROOT, "productos");
const SITEMAP_PATH = path.join(ROOT, "sitemap.xml");
const INDEX_PATH = path.join(ROOT, "index.html");

// Fecha real del último commit que tocó el archivo, para <lastmod> en el sitemap.
function gitLastModified(relPath) {
  try {
    const out = execSync('git log -1 --format=%cI -- "' + relPath + '"', { cwd: ROOT }).toString().trim();
    return out || null;
  } catch (e) {
    return null;
  }
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function replaceBetween(html, start, end, inner) {
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a === -1 || b === -1) throw new Error("No se han encontrado los marcadores " + start + " / " + end);
  return html.slice(0, a + start.length) + inner + html.slice(b);
}

// Mismo marcado que renderAboutText() de assets/js/main.js.
function aboutHtml(store) {
  const text = String(store.aboutUs || "");
  const marker = "\n\nAbout us\n\n";
  const idx = text.indexOf(marker);
  if (idx === -1) return '<span lang="es" class="about-text-block">' + escapeHtml(text) + "</span>";
  return (
    '<span lang="es" class="about-text-block">' + escapeHtml(text.slice(0, idx)) + "</span>" +
    '<span lang="en" class="about-text-block">' + escapeHtml(text.slice(idx + marker.length)) + "</span>"
  );
}

// Mismo marcado que la lista de contacto de assets/js/main.js.
function contactHtml(store) {
  const wa = "https://api.whatsapp.com/send?phone=" + String(store.whatsapp || "").replace("+", "") + "&text=" + encodeURIComponent("Hola, estoy interesado en vuestros productos.");
  return (
    "\n        <li><b>Ubicación</b>Legazpi, Gipuzkoa (España)</li>" +
    '\n        <li><b>Email</b><a href="mailto:' + escapeHtml(store.email) + '">' + escapeHtml(store.email) + "</a></li>" +
    '\n        <li><b>WhatsApp</b><a href="' + escapeHtml(wa) + '" target="_blank" rel="noopener">' + escapeHtml(store.whatsapp) + "</a></li>" +
    '\n        <li><b>Instagram</b><a href="' + escapeHtml(store.instagram) + '" target="_blank" rel="noopener">@hezuradar</a></li>\n      '
  );
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
    const html = TEMPLATE.buildProductHtml(p, store, products);
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

  // Páginas de categoría (/cejuelas.html, ...), con los productos de cada tipo.
  TEMPLATE.CATEGORY_PAGES.forEach((cat) => {
    fs.writeFileSync(path.join(ROOT, cat.file), TEMPLATE.buildCategoryHtml(cat, store, products), "utf8");
  });
  console.log("Generadas " + TEMPLATE.CATEGORY_PAGES.length + " páginas de categoría.");

  const entries = TEMPLATE.sitemapEntries(products, gitLastModified);
  fs.writeFileSync(SITEMAP_PATH, TEMPLATE.buildSitemapXml(entries), "utf8");
  console.log("sitemap.xml regenerado con " + entries.length + " URLs.");

  const indexHtml = fs.readFileSync(INDEX_PATH, "utf8");
  let homeHtml = CATALOG_TEMPLATE.injectHomepageMarkup(indexHtml, products);
  // "Quiénes somos" y contacto también quedan en el HTML (main.js los vuelve a
  // pintar igual), para que el texto se indexe sin depender de JavaScript.
  homeHtml = replaceBetween(homeHtml, "<!--HA:ABOUT_START-->", "<!--HA:ABOUT_END-->", aboutHtml(store));
  homeHtml = replaceBetween(homeHtml, "<!--HA:CONTACT_START-->", "<!--HA:CONTACT_END-->", contactHtml(store));
  fs.writeFileSync(INDEX_PATH, homeHtml, "utf8");
  console.log("index.html regenerado con el catálogo (" + products.length + " productos).");
}

main();
