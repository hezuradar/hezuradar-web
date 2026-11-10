"use strict";

// Todas las fotos de producto se publican en WebP, en sus dos tamaños (ficha y miniatura).
// El panel las convierte al subirlas; en Safari, que no sabe generar WebP, lo hace
// assets/js/webp-encoder.js con el codificador de libwebp en WebAssembly.

const fs = require("fs");
const path = require("path");
const { ROOT } = require("./helpers");

const products = JSON.parse(fs.readFileSync(path.join(ROOT, "data/products.json"), "utf8"));

test("todas las fotos del catálogo están en WebP", () => {
  const otras = [];
  products.forEach((p) => (p.images || []).forEach((im) => !/\.webp$/.test(im) && otras.push(p.sku + " → " + im)));
  assertEqual(otras, [], "fotos que no son WebP");
});

test("en images/products solo hay archivos WebP (fotos y miniaturas)", () => {
  const otras = fs.readdirSync(path.join(ROOT, "images/products")).filter((f) => !/\.webp$/.test(f));
  assertEqual(otras, [], "archivos que no son WebP");
});

test("los archivos .webp son WebP de verdad (cabecera RIFF/WEBP)", () => {
  const malas = [];
  products.forEach((p) =>
    (p.images || []).forEach((im) => {
      const head = fs.readFileSync(path.join(ROOT, im)).subarray(0, 12).toString("latin1");
      if (head.slice(0, 4) !== "RIFF" || head.slice(8, 12) !== "WEBP") malas.push(im);
    })
  );
  assertEqual(malas, [], "archivos con extensión .webp que no son WebP");
});

test("el panel publica siempre en WebP y carga el conversor para Safari", () => {
  const admin = fs.readFileSync(path.join(ROOT, "assets/js/admin.js"), "utf8");
  assertTrue(/function canvasToImage\([^)]*\) \{\s*return window\.HA_WEBP\.encodeCanvas\(/.test(admin), "las fotos no pasan por el conversor WebP");
  assertFalse(/toBlob\(/.test(admin), "admin.js genera imágenes por su cuenta (sin pasar por el conversor WebP)");
  assertTrue(/IMAGE_EXT = "\.webp"/.test(admin), "admin.js no fija la extensión .webp");

  const html = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
  assertTrue(/script-src[^;]*'wasm-unsafe-eval'/.test(html), "la CSP del panel no permite WebAssembly");
  const enc = html.indexOf("assets/js/webp-encoder.js");
  assertTrue(enc > 0 && enc < html.indexOf("assets/js/admin.js"), "webp-encoder.js tiene que cargarse antes que admin.js");

  ["webp_enc.js", "webp_enc.wasm"].forEach((f) => {
    assertTrue(fs.existsSync(path.join(ROOT, "assets/js/vendor/webp-enc-1.5.0", f)), "falta el codificador: " + f);
  });
});
