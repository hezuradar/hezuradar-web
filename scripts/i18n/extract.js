// Saca los textos traducibles de las páginas públicas, con las mismas reglas que
// assets/js/i18n.js, y lista los que aún no tienen traducción en assets/js/i18n-en.js.
//
//   npm install --no-save linkedom@0.18.5
//   node scripts/i18n/extract.js > faltan.json
//
// Lo que pintan los scripts (cesta, checkout, diseñadores...) no está en el HTML: esos
// textos se añaden a mano en i18n-en.js (sección "Textos de los scripts").
"use strict";

const fs = require("fs");
const path = require("path");
const { parseHTML } = require("linkedom");
const core = require("../../assets/js/i18n.js");

const ROOT = path.join(__dirname, "..", "..");
const EXCLUDE = new Set(["admin.html", "googlefa5f055397cb6de1.html"]);

function pages() {
  const top = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && !EXCLUDE.has(f));
  const prod = fs.readdirSync(path.join(ROOT, "productos")).filter((f) => f.endsWith(".html")).map((f) => "productos/" + f);
  return top.concat(prod);
}

function extractPage(file, out) {
  const { document } = parseHTML(fs.readFileSync(path.join(ROOT, file), "utf8"));
  const add = (key) => {
    if (key && !out.has(key)) out.set(key, file);
  };
  add(core.canonText(document.title || ""));
  core.walk(document.body, {
    onLeaf: (el) => add(core.canon(el)),
    onText: (node) => add(core.canonText(node.nodeValue)),
    onAttr: (el, name) => add(core.canonText(name === "value" ? el.getAttribute("value") : el.getAttribute(name))),
  });
}

// Lo que main.js pinta desde el catálogo: títulos, descripciones y categorías.
function extractProducts(out) {
  const products = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "products.json"), "utf8"));
  products.forEach((p) => {
    [p.title, p.description, p.category, p.subcategory].forEach((s) => {
      const key = s && core.canonText(s);
      if (key && !out.has(key)) out.set(key, "data/products.json");
    });
  });
}

function main() {
  const out = new Map();
  pages().forEach((f) => extractPage(f, out));
  extractProducts(out);
  let dict = {};
  try {
    global.window = {};
    require("../../assets/js/i18n-en.js");
    dict = global.window.HA_I18N_DICT || {};
  } catch (e) {
    dict = {};
  }
  const missing = {};
  for (const [key, file] of out) if (!(key in dict)) missing[key] = file;
  process.stdout.write(JSON.stringify(missing, null, 1) + "\n");
  process.stderr.write(`${out.size} textos, ${Object.keys(missing).length} sin traducir\n`);
}

main();
