"use strict";

// Carga en Node los módulos del navegador que exponen la lógica de negocio a través de
// window (product-page-template.js, catalog-template.js...). No se simula un DOM completo:
// solo lo justo para que el IIFE se evalúe y publique su API.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

// window/document mínimos para los IIFE que tocan el DOM al cargarse.
function fakeWindow() {
  const win = {};
  win.window = win;
  return win;
}

function loadBrowserModule(relPath) {
  const file = path.join(ROOT, relPath);
  const code = fs.readFileSync(file, "utf8");
  const win = fakeWindow();
  const sandbox = {
    window: win,
    document: {
      addEventListener() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getElementById() {
        return null;
      },
      createElement() {
        return { setAttribute() {}, appendChild() {}, remove() {}, style: {}, classList: { add() {}, remove() {} } };
      },
      body: { appendChild() {}, style: {} },
    },
    console,
    setTimeout,
    clearTimeout,
    URL,
    Intl,
    encodeURIComponent,
    decodeURIComponent,
    localStorage: {
      _d: {},
      getItem(k) {
        return this._d[k] ?? null;
      },
      setItem(k, v) {
        this._d[k] = String(v);
      },
      removeItem(k) {
        delete this._d[k];
      },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: file });
  return win;
}

module.exports = { loadBrowserModule, ROOT };
