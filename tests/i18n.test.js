"use strict";

// Idioma de la web (assets/js/i18n.js y su diccionario assets/js/i18n-en.js). Una traducción
// con etiquetas distintas a las del texto original no se aplica, y la página se quedaría
// en español sin avisar: por eso se comprueba aquí todo el diccionario.

const path = require("path");
const { ROOT } = require("./helpers");
const core = require(path.join(ROOT, "assets/js/i18n.js"));

global.window = global.window || {};
delete require.cache[path.join(ROOT, "assets/js/i18n-en.js")];
require(path.join(ROOT, "assets/js/i18n-en.js"));
const DICT = global.window.HA_I18N_DICT;
const PATTERNS = global.window.HA_I18N_PATTERNS;

function tags(s) {
  return (s.match(/<\/?[a-z]+>/g) || []).join("");
}
function translate(key) {
  if (key in DICT) return DICT[key];
  for (const [re, rep] of PATTERNS) {
    const m = key.match(re);
    if (m) return typeof rep === "function" ? rep(m, (k) => (k in DICT ? DICT[k] : k)) : key.replace(re, rep);
  }
  return null;
}

test("canonText junta los espacios y conserva los saltos de párrafo", () => {
  assertEqual(core.canonText("  Hola\n   mundo  "), "Hola mundo");
  assertEqual(core.canonText("Uno.\n\nDos."), "Uno.\n\nDos.");
  assertEqual(core.canonText("A & B < C"), "A &amp; B &lt; C");
});

test("cada traducción tiene las mismas etiquetas y saltos de párrafo que el original", () => {
  const bad = Object.keys(DICT).filter((k) => {
    const v = DICT[k];
    return typeof v !== "string" || !v.trim() || tags(k) !== tags(v) || (k.match(/\n\n/g) || []).length !== (v.match(/\n\n/g) || []).length;
  });
  assertEqual(bad.slice(0, 5), []);
});

test("las traducciones no llevan atributos en las etiquetas", () => {
  const bad = Object.keys(DICT).filter((k) => /<[a-z]+\s/.test(DICT[k]));
  assertEqual(bad.slice(0, 5), []);
});

test("los textos con datos variables de la cesta se traducen con su patrón", () => {
  assertEqual(translate("1 producto"), "1 product");
  assertEqual(translate("22 productos"), "22 products");
  assertEqual(translate("Cesta, 3 artículos"), "Basket, 3 items");
  assertEqual(translate("Envío certificado (France)"), "Registered mail (France)");
  assertEqual(translate("Paq Light Internacional (Japan)"), "Paq Light Internacional (Japan)");
  assertEqual(
    translate("Los envíos fuera de España van por Paq Light Internacional de Correos, con número de seguimiento. Peso aproximado del pedido: 75 g."),
    "Shipments outside Spain go by Correos Paq Light Internacional, with tracking. Approximate order weight: 75 g."
  );
  assertEqual(translate("Falta tu nombre, la ciudad."), "Missing: your name, the city.");
  assertEqual(translate("Pedido HA-261102-AB12 recibido."), "Order HA-261102-AB12 received.");
});

test("los textos fijos de la cesta y el checkout están traducidos", () => {
  ["Tu cesta", "Enviar a", "Finalizar pedido", "Revisa y confirma tu pedido", "País *", "Confirmar pedido con obligación de pago", "¡Pedido enviado!"].forEach((k) =>
    assertTrue(typeof DICT[k] === "string" && DICT[k] !== k, "sin traducir: " + k)
  );
});
