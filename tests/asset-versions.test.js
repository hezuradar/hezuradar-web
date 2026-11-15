"use strict";

// Las "?v=" de CSS/JS de las fichas generadas y de la plantilla deben coincidir con las de
// las páginas de la raíz; si no, esas páginas sirven estilos o scripts antiguos.
// Arreglo: node scripts/generate-product-pages.js (regenera las fichas y pone al día la plantilla).

const fs = require("fs");
const path = require("path");
const { ROOT } = require("./helpers");
const { currentAssetVersions } = require("../scripts/generate-product-pages.js");

const ASSET_RE = /\/?assets\/(?:js|css)\/(?:vendor\/)?([\w.-]+\.(?:js|css))\?v=([0-9a-zA-Z]+)/g;

function staleRefs(text, versions) {
  const stale = [];
  let m;
  while ((m = ASSET_RE.exec(text))) {
    if (versions[m[1]] && versions[m[1]] !== m[2]) stale.push(`${m[1]}?v=${m[2]} (raíz: ${versions[m[1]]})`);
  }
  return stale;
}

const versions = currentAssetVersions();

test("la plantilla de fichas usa las mismas versiones de CSS/JS que la raíz", () => {
  const src = fs.readFileSync(path.join(ROOT, "assets/js/product-page-template.js"), "utf8");
  assertEqual(staleRefs(src, versions).join(", "), "");
});

test("las fichas generadas usan las mismas versiones de CSS/JS que la raíz", () => {
  const dir = path.join(ROOT, "productos");
  const stale = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .flatMap((f) => staleRefs(fs.readFileSync(path.join(dir, f), "utf8"), versions).map((s) => `${f}: ${s}`));
  assertEqual(stale.slice(0, 3).join("\n"), "");
});
