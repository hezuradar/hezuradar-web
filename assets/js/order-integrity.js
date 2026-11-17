// Comprobación de importes de los pedidos que llegan de la tienda (admin-orders.js).
//
// La web no tiene servidor: el pedido lo arma el navegador del cliente y Firestore solo
// puede validar tipos y tamaños (firestore.rules), no que los precios sean los del
// catálogo ni que las cuentas cuadren. Alguien que manipule la petición podría guardar
// un pedido con líneas a buen precio pero un total de 0,01 €, una línea inventada o un
// precio negativo para restar. El cobro es manual (PayPal/Bizum), así que la defensa es
// que el panel lo marque antes de confirmar el pedido y pedir el pago.
(function (root) {
  "use strict";

  var TOLERANCE = 0.01;

  function round2(n) {
    return Math.round(Number(n) * 100) / 100;
  }

  function money(n) {
    return round2(n).toFixed(2).replace(".", ",") + " €";
  }

  function isValidLine(it) {
    var qty = Number(it && it.qty);
    var price = Number(it && it.price);
    return Number.isInteger(qty) && qty >= 1 && Number.isFinite(price) && price >= 0;
  }

  function titleOf(it) {
    return String((it && (it.title || it.id)) || "(sin título)");
  }

  /** Comparación con el catálogo publicado: precios distintos y productos que no existen. */
  function catalogIssues(items, catalog, unitPriceFor) {
    if (!catalog || !catalog.length || typeof unitPriceFor !== "function") return [];
    var mismatched = [];
    var unknown = [];
    items.forEach(function (it) {
      var p = catalog.find(function (x) { return x.id === it.id; });
      if (!p) return unknown.push(titleOf(it));
      var expected = unitPriceFor(p, Number(it.qty) || 1);
      if (Math.abs((Number(it.price) || 0) - expected) > 0.005) mismatched.push(titleOf(it));
    });
    var out = [];
    if (mismatched.length) out.push("Precio distinto del catálogo en: " + mismatched.join(", ") + ".");
    if (unknown.length) out.push("Producto que no está en el catálogo: " + unknown.join(", ") + ".");
    return out;
  }

  /** Que el subtotal sea la suma de las líneas y el total no quede por debajo de productos + envío. */
  function arithmeticIssues(order, items) {
    var out = [];
    var bad = items.filter(function (it) { return !isValidLine(it); });
    if (bad.length) out.push("Línea con cantidad o precio no válidos: " + bad.map(titleOf).join(", ") + ".");
    // Igual que cart.js: cada línea redondeada al céntimo antes de sumar.
    var lines = round2(items.reduce(function (sum, it) {
      return isValidLine(it) ? sum + round2(Number(it.price) * Number(it.qty)) : sum;
    }, 0));
    var subtotal = Number(order.subtotal);
    if (!Number.isFinite(subtotal) || Math.abs(subtotal - lines) > TOLERANCE) {
      out.push("El subtotal guardado (" + money(subtotal || 0) + ") no cuadra con la suma de las líneas (" + money(lines) + ").");
    }
    if (typeof order.total === "number") {
      var minTotal = lines + (Number(order.shippingCost) || 0);
      if (order.total < minTotal - TOLERANCE) {
        out.push("El total guardado (" + money(order.total) + ") es menor que productos + envío (" + money(minTotal) + ").");
      }
    }
    return out;
  }

  /**
   * Avisos (texto plano, sin escapar) de un pedido pendiente de la tienda cuyos importes no
   * son de fiar. Vacío si todo cuadra o si el pedido ya no está pendiente: se compara con
   * el catálogo actual y un pedido ya confirmado saldría marcado al cambiar un precio.
   */
  function orderIssues(order, catalog, unitPriceFor) {
    var o = order || {};
    if (o.status !== "pendiente") return [];
    var items = Array.isArray(o.items) ? o.items : [];
    return catalogIssues(items, catalog, unitPriceFor).concat(arithmeticIssues(o, items));
  }

  var api = { orderIssues: orderIssues };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.HA_ORDER_INTEGRITY = api;
  }
})(typeof window !== "undefined" ? window : this);
