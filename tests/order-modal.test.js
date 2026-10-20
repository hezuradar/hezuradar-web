"use strict";

// Alta/edición de pedidos en pantalla emergente (modal) en vez de dentro de la pestaña.
// Se comprueba la estructura sin navegador: el markup del modal, el botón de alta y que el
// formulario ya no se inserta fijo en la pestaña de Pedidos.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
const JS = fs.readFileSync(path.join(ROOT, "assets", "js", "admin-orders.js"), "utf8");

test("admin.html tiene el botón de alta de pedido en la cabecera de la lista", () => {
  assertTrue(/id="new-order-btn"/.test(HTML), "falta el botón #new-order-btn");
  const i = HTML.indexOf('id="new-order-btn"');
  const boton = HTML.slice(i, HTML.indexOf("</button>", i));
  assertTrue(/Nuevo pedido/.test(boton), "el botón no dice «Nuevo pedido»");
});

test("el formulario de pedido arranca oculto (no ocupa la pestaña)", () => {
  assertTrue(/id="order-form-host"[^>]*hidden/.test(HTML), "#order-form-host debe empezar hidden");
  // El formulario ya no está dentro del panel de pedidos visible, sino fuera de él
  // (oculto, a la espera de moverse al modal).
  const panelStart = HTML.indexOf('id="orders-panel"');
  const panelEnd = HTML.indexOf('id="order-form-host"');
  assertTrue(panelStart > 0 && panelEnd > panelStart, "orden inesperado en admin.html");
  const panel = HTML.slice(panelStart, panelEnd);
  assertFalse(/id="order-form-host"/.test(panel), "el formulario no debe vivir en el panel visible");
});

test("el JS abre y cierra un modal accesible para el formulario", () => {
  assertTrue(/function openOrderModal\(/.test(JS), "falta openOrderModal");
  assertTrue(/function closeOrderModal\(/.test(JS), "falta closeOrderModal");
  assertTrue(/role="dialog" aria-modal="true"/.test(JS), "el modal debe declarar role=dialog y aria-modal");
  assertTrue(/aria-labelledby="order-form-title"/.test(JS), "el modal debe apuntarse al título");
  assertTrue(/id="order-modal-close"/.test(JS), "falta el botón de cerrar del modal");
  assertTrue(/e\.key === "Escape"/.test(JS), "el modal debe cerrarse con Escape");
});

test("alta y edición abren el modal, no pintan el formulario en la página", () => {
  assertTrue(/function newOrder\(\)[\s\S]*openOrderModal\("Nuevo pedido"\)/.test(JS), "newOrder debe abrir el modal");
  assertTrue(/openOrderModal\("Editar pedido"\)/.test(JS), "editOrder debe abrir el modal");
  // El scroll forzado al formulario en la página ya no tiene sentido.
  assertFalse(/scrollIntoView/.test(JS), "ya no debe hacer scroll al formulario en la página");
});

test("guardar cierra el modal y avisa en la pestaña de Pedidos", () => {
  assertTrue(/closeOrderModal\(\);\s*\n\s*setAuthStatus\("ok", doneMsg\)/.test(JS), "guardar debe cerrar y avisar");
  assertTrue(/doneMsg = "Pedido creado\."/.test(JS), "falta el aviso de pedido creado");
  assertTrue(/doneMsg = "Pedido actualizado\."/.test(JS), "falta el aviso de pedido actualizado");
});

test("cancelar cierra el modal sin guardar", () => {
  assertTrue(/\$\("order-cancel"\)\.addEventListener\("click", closeOrderModal\)/.test(JS), "cancelar debe cerrar el modal");
});

test("borrar el pedido que se edita cierra el modal", () => {
  // Los tres caminos que borran el pedido en edición (borrado directo, por cliente, agrupado).
  const ocurrencias = (JS.match(/closeOrderModal\(\);/g) || []).length;
  assertTrue(ocurrencias >= 4, "los caminos de borrado deben cerrar el modal (encontrados " + ocurrencias + ")");
});

test("el modal reutiliza los estilos de modal ya existentes", () => {
  assertTrue(/modal-backdrop/.test(JS), "debe usar .modal-backdrop");
  assertTrue(/class="modal order-modal"/.test(JS), "debe usar .modal con la variante .order-modal");
  const CSS = fs.readFileSync(path.join(ROOT, "assets", "css", "style.css"), "utf8");
  assertTrue(/\.order-modal\{/.test(CSS), "falta el estilo .order-modal");
  assertTrue(/\.order-modal-scroll\{/.test(CSS), "falta el estilo .order-modal-scroll");
});
