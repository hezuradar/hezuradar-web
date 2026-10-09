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

const TODAY = new Date().toISOString().slice(0, 10);

// Fecha (YYYY-MM-DD) del último commit que tocó el archivo, para <lastmod> en el
// sitemap y el dateModified de las guías. Si el archivo tiene cambios sin subir,
// se usa la fecha de hoy: el sitemap se regenera antes de hacer ese commit.
function gitLastModified(relPath) {
  try {
    const pending = execSync('git status --porcelain -- "' + relPath + '"', { cwd: ROOT }).toString().trim();
    if (pending) return TODAY;
    const out = execSync('git log -1 --format=%cs -- "' + relPath + '"', { cwd: ROOT }).toString().trim();
    return out || null;
  } catch (e) {
    return null;
  }
}

// Alinea el "dateModified" del JSON-LD de las guías con su <lastmod> del sitemap.
function syncGuideDates() {
  fs.readdirSync(ROOT)
    .filter((f) => /^guia-.+\.html$/.test(f))
    .forEach((f) => {
      const full = path.join(ROOT, f);
      const html = fs.readFileSync(full, "utf8");
      const date = gitLastModified(f);
      if (!date) return;
      const next = html.replace(/("dateModified":\s*")\d{4}-\d{2}-\d{2}(")/, "$1" + date + "$2");
      if (next !== html) {
        fs.writeFileSync(full, next, "utf8");
        console.log("dateModified de " + f + " → " + date);
      }
    });
}

// Versiones "?v=" de cada CSS/JS tal como están en las páginas de la raíz (las
// mantiene al día el hook que las sube al editar cada archivo). Las páginas
// generadas usan las mismas, para no quedarse con versiones fijas antiguas de la
// plantilla (que solo se usan tal cual cuando admin.js publica una ficha suelta).
// Manda la versión de index.html; para los archivos que no carga la portada, la
// más reciente de las demás páginas de la raíz.
function currentAssetVersions() {
  const re = /\/?assets\/(?:js|css)\/(?:vendor\/)?([\w.-]+\.(?:js|css))\?v=([0-9a-zA-Z]+)/g;
  const collect = (files) => {
    const found = {};
    files.forEach((f) => {
      const html = fs.readFileSync(path.join(ROOT, f), "utf8");
      let m;
      while ((m = re.exec(html))) {
        if (!found[m[1]] || m[2] > found[m[1]]) found[m[1]] = m[2];
      }
    });
    return found;
  };
  const others = collect(fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && f !== "index.html"));
  return Object.assign(others, collect(["index.html"]));
}

function syncAssetVersions(html, versions) {
  return html.replace(/(\/assets\/(?:js|css)\/(?:vendor\/)?([\w.-]+\.(?:js|css))\?v=)([0-9a-zA-Z]+)/g, (all, prefix, file) =>
    versions[file] ? prefix + versions[file] : all
  );
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
  const newTab = '<span class="visually-hidden"> (se abre en una pestaña nueva)</span>';
  return (
    "\n        <li><b>Ubicación</b>Legazpi, Gipuzkoa (España)</li>" +
    '\n        <li><b>Email</b><a href="mailto:' + escapeHtml(store.email) + '">' + escapeHtml(store.email) + "</a></li>" +
    '\n        <li><b>WhatsApp</b><a href="' + escapeHtml(wa) + '" target="_blank" rel="noopener">' + escapeHtml(store.whatsapp) + newTab + "</a></li>" +
    '\n        <li><b>Instagram</b><a href="' + escapeHtml(store.instagram) + '" target="_blank" rel="noopener">@hezuradar' + newTab + "</a></li>\n      "
  );
}

function main() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));
  const store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));

  const usedSlugs = new Set();
  let changed = false;
  const today = TODAY;
  const versions = currentAssetVersions();

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
    const html = syncAssetVersions(TEMPLATE.buildProductHtml(p, store, products), versions);
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
    fs.writeFileSync(path.join(ROOT, cat.file), syncAssetVersions(TEMPLATE.buildCategoryHtml(cat, store, products), versions), "utf8");
  });
  console.log("Generadas " + TEMPLATE.CATEGORY_PAGES.length + " páginas de categoría.");

  syncGuideDates();

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
