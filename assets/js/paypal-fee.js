// Formas de pago y recargo de PayPal. Lo usan la cesta (cart.js), el aviso por email al
// negocio (emailjs-notify.js) y el panel de pedidos (admin-orders.js); el email al cliente
// (scripts/drive-export/Code.gs) repite la misma lógica porque el Apps Script no puede
// cargar este archivo.
//
// PayPal tiene dos modalidades:
//  - "amigos y familiares": sin comisión para la tienda, así que sin recargo para el cliente.
//  - pago normal de "bienes y servicios": PayPal cobra a la tienda una comisión, que se
//    repercute al cliente para que el importe que llega sea el mismo.
//
// El pedido no guarda la modalidad en un campo propio (firestore.rules solo admite los
// campos actuales): el recargo va sumado en `total`, y se deduce como
// total - subtotal - envío. Si es 0, el pago es de amigos y familiares.
(function (root) {
  "use strict";

  var PAYPAL_ACCOUNT = "hezuradar@gmail.com";
  var BIZUM_PHONE = "653713428";

  // Tarifas de vendedor de PayPal España (paypal.com/es/business/paypal-business-fees,
  // actualizadas el 04/11/2026 y consultadas el 09/11/2026).
  var DOMESTIC_RATE = 0.029;
  var FIXED_FEE = 0.35;
  var UK_EXTRA_RATE = 0.0129;
  var OTHER_EXTRA_RATE = 0.0199;
  // Espacio Económico Europeo (y regiones ultraperiféricas de la UE): transacción "nacional".
  var EEA = (
    "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO " +
    "AX GF GP MQ RE YT MF"
  ).split(" ");
  var UK = ["GB", "GG", "JE", "IM", "GI"];

  var LABELS = { paypal: "PayPal", bizum: "Bizum", otros: "Otros" };

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /** Porcentaje total de comisión que cobra PayPal por un pago desde ese país. */
  function rateFor(countryCode) {
    var code = String(countryCode || "ES").toUpperCase();
    if (EEA.indexOf(code) !== -1) return DOMESTIC_RATE;
    if (UK.indexOf(code) !== -1) return DOMESTIC_RATE + UK_EXTRA_RATE;
    return DOMESTIC_RATE + OTHER_EXTRA_RATE;
  }

  /**
   * Recargo (en €) para que, tras la comisión de PayPal sobre el importe cobrado, a la
   * tienda le llegue `amount` entero. Se redondea al céntimo hacia arriba.
   */
  function feeFor(amount, countryCode) {
    var base = Number(amount);
    if (!(base > 0)) return 0;
    var gross = (base + FIXED_FEE) / (1 - rateFor(countryCode));
    var cents = Math.ceil(Number(((gross - base) * 100).toFixed(6)));
    return cents / 100;
  }

  /** Recargo de PayPal incluido en el total de un pedido (0 si no lo hay). */
  function orderFee(order) {
    var o = order || {};
    if (o.paymentMethod !== "paypal") return 0;
    if (typeof o.paymentFee === "number") return Math.max(0, round2(o.paymentFee));
    if (typeof o.total !== "number") return 0;
    var fee = round2(o.total - (Number(o.subtotal) || 0) - (Number(o.shippingCost) || 0));
    return fee > 0 ? fee : 0;
  }

  function paymentLabel(order) {
    var method = (order || {}).paymentMethod;
    if (method === "paypal") return orderFee(order) > 0 ? "PayPal (pago normal)" : "PayPal (amigos y familiares)";
    return LABELS[method] || method || "-";
  }

  /** Qué tiene que hacer el cliente para pagar (vacío si se acuerda aparte). */
  function paymentInstructions(order) {
    var method = (order || {}).paymentMethod;
    if (method === "bizum") return "Realiza el Bizum al número " + BIZUM_PHONE + ".";
    if (method !== "paypal") return "";
    return orderFee(order) > 0
      ? "Envía el pago por PayPal a " + PAYPAL_ACCOUNT + " como pago de bienes y servicios (pago normal, con protección al comprador)."
      : "Envía el pago por PayPal a " + PAYPAL_ACCOUNT + " como «amigos y familiares».";
  }

  var api = {
    PAYPAL_ACCOUNT: PAYPAL_ACCOUNT,
    BIZUM_PHONE: BIZUM_PHONE,
    LABELS: LABELS,
    rateFor: rateFor,
    feeFor: feeFor,
    orderFee: orderFee,
    paymentLabel: paymentLabel,
    paymentInstructions: paymentInstructions,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.HA_PAYPAL = api;
  }
})(typeof window !== "undefined" ? window : this);
