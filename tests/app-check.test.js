"use strict";

// Firebase App Check (assets/js/app-check.js): cuando se active la obligatoriedad en la
// consola, Firestore rechazará cualquier escritura sin token. Toda página que escriba en
// Firestore (estadísticas, pedidos o el panel) tiene que cargar app-check.js y permitir en su
// CSP lo que necesitan reCAPTCHA v3 y el servicio de tokens; si no, esa página dejaría de
// guardar pedidos o visitas sin dar ningún error visible.

const fs = require("fs");
const path = require("path");
const { ROOT } = require("./helpers");

const WRITERS = /(analytics|firebase-orders|admin-orders)\.js/;

function htmlPages() {
  const root = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  const productos = fs.readdirSync(path.join(ROOT, "productos")).filter((f) => f.endsWith(".html")).map((f) => "productos/" + f);
  return root.concat(productos).map((f) => ({ file: f, html: fs.readFileSync(path.join(ROOT, f), "utf8") }));
}

function csp(html) {
  const m = /Content-Security-Policy" content="([^"]*)"/.exec(html);
  return m ? m[1] : "";
}

function directive(policy, name) {
  const m = new RegExp("(?:^|; )" + name + " ([^;]*)").exec(policy);
  return m ? m[1].split(/\s+/) : [];
}

const writers = htmlPages().filter((p) => WRITERS.test(p.html));

test("hay páginas que escriben en Firestore (si no, la prueba no comprueba nada)", () => {
  assertTrue(writers.length >= 79, "solo " + writers.length);
});

test("toda página que escribe en Firestore carga app-check.js antes que quien escribe", () => {
  const bad = writers.filter((p) => {
    const ac = p.html.indexOf("app-check.js?v=");
    const first = p.html.search(WRITERS);
    return ac === -1 || ac > first;
  });
  assertEqual(bad.map((p) => p.file).slice(0, 5).join(", "), "");
});

test("su CSP deja incrustar el iframe de App Check (frame-src 'self')", () => {
  const bad = writers.filter((p) => !directive(csp(p.html), "frame-src").includes("'self'"));
  assertEqual(bad.map((p) => p.file).slice(0, 5).join(", "), "");
});

test("reCAPTCHA Enterprise solo se carga dentro del iframe, nunca en la página", () => {
  // enterprise.js en la página se queda con grecaptcha.render y rompe la casilla clásica de
  // la cesta y del contacto (comprobado el 17/11/2026).
  const bad = htmlPages().filter((p) => /recaptcha\/enterprise\.js|ReCaptchaEnterpriseProvider/.test(p.html));
  assertEqual(bad.map((p) => p.file).join(", "), "");
  const pageJs = fs.readFileSync(path.join(ROOT, "assets/js/app-check.js"), "utf8");
  assertTrue(!/ReCaptcha(Enterprise|V3)Provider/.test(pageJs), "app-check.js no debe usar proveedores reCAPTCHA");
});

test("el iframe de App Check usa Fraud Defense y su CSP permite reCAPTCHA y el canje del token", () => {
  const frame = fs.readFileSync(path.join(ROOT, "assets/app-check-frame.html"), "utf8");
  const policy = csp(frame);
  assertTrue(directive(policy, "script-src").includes("https://www.google.com"), "script-src");
  assertTrue(directive(policy, "connect-src").includes("https://content-firebaseappcheck.googleapis.com"), "connect-src");
  assertTrue(frame.includes("vendor/firebase-app-check-compat-10.12.2.js") && frame.includes("app-check-frame.js"), "scripts");
  const js = fs.readFileSync(path.join(ROOT, "assets/js/app-check-frame.js"), "utf8");
  assertTrue(js.includes("ReCaptchaEnterpriseProvider") && js.includes("e.origin !== location.origin"), "proveedor y origen");
});

test("el panel carga el SDK de App Check antes de app-check.js", () => {
  const admin = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
  const sdk = admin.indexOf("vendor/firebase-app-check-compat-10.12.2.js");
  assertTrue(sdk !== -1 && sdk < admin.indexOf("app-check.js?v="), "orden de scripts del panel");
});
