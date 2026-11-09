"use strict";

// Recargo por pagar con PayPal como "bienes y servicios" (assets/js/paypal-fee.js).
// Tarifas de PayPal España consultadas el 09/11/2026: 2,90 % + 0,35 € dentro del EEE,
// +1,29 % desde Reino Unido y +1,99 % desde el resto del mundo.

const { loadBrowserModule } = require("./helpers");
const P = loadBrowserModule("assets/js/paypal-fee.js").HA_PAYPAL;

test("el recargo deja al vendedor el importe íntegro tras la comisión de PayPal (España)", () => {
  const fee = P.feeFor(11.5, "ES");
  assertEqual(fee, 0.71);
  const charged = 11.5 + fee;
  const net = charged - (charged * 0.029 + 0.35);
  assertTrue(net >= 11.5 - 1e-9, "neto " + net);
  assertTrue(net < 11.5 + 0.02, "no se cobra de más: " + net);
});

test("un pedido pequeño también cubre la tarifa fija", () => {
  assertEqual(P.feeFor(6, "ES"), 0.54);
});

test("dentro del EEE no hay recargo internacional", () => {
  assertEqual(P.feeFor(30, "FR"), P.feeFor(30, "ES"));
  assertEqual(P.feeFor(30, "NO"), P.feeFor(30, "ES"));
});

test("Reino Unido y resto del mundo suman su recargo internacional", () => {
  assertTrue(P.feeFor(30, "GB") > P.feeFor(30, "ES"));
  assertTrue(P.feeFor(30, "US") > P.feeFor(30, "GB"));
  assertEqual(P.rateFor("GB"), 0.029 + 0.0129);
  assertEqual(P.rateFor("US"), 0.029 + 0.0199);
  assertEqual(P.rateFor("ES"), 0.029);
});

test("sin importe no hay recargo", () => {
  assertEqual(P.feeFor(0, "ES"), 0);
  assertEqual(P.feeFor(-3, "ES"), 0);
  assertEqual(P.feeFor(NaN, "ES"), 0);
});

test("orderFee deduce el recargo guardado en el total de un pedido PayPal", () => {
  assertEqual(P.orderFee({ paymentMethod: "paypal", subtotal: 10, shippingCost: 1.5, total: 12.21 }), 0.71);
  assertEqual(P.orderFee({ paymentMethod: "paypal", subtotal: 10, shippingCost: 1.5, total: 11.5 }), 0);
  assertEqual(P.orderFee({ paymentMethod: "bizum", subtotal: 10, shippingCost: 1.5, total: 12.21 }), 0);
  assertEqual(P.orderFee({ paymentMethod: "paypal", subtotal: 10, shippingCost: 1.5 }), 0);
  assertEqual(P.orderFee({ paymentMethod: "paypal", subtotal: 10, total: 12, paymentFee: 0.5 }), 0.5);
});

test("paymentLabel distingue las dos modalidades de PayPal", () => {
  assertEqual(P.paymentLabel({ paymentMethod: "paypal", subtotal: 10, shippingCost: 0, total: 10 }), "PayPal (amigos y familiares)");
  assertEqual(P.paymentLabel({ paymentMethod: "paypal", subtotal: 10, shippingCost: 0, total: 10.67 }), "PayPal (pago normal)");
  assertEqual(P.paymentLabel({ paymentMethod: "bizum" }), "Bizum");
  assertEqual(P.paymentLabel({ paymentMethod: "otros" }), "Otros");
  assertEqual(P.paymentLabel({}), "-");
});

test("las instrucciones de pago de PayPal dicen a qué cuenta enviarlo", () => {
  const ff = P.paymentInstructions({ paymentMethod: "paypal", subtotal: 10, total: 10 });
  const gs = P.paymentInstructions({ paymentMethod: "paypal", subtotal: 10, total: 10.67 });
  assertTrue(ff.includes("hezuradar@gmail.com") && /amigos y familiares/i.test(ff), ff);
  assertTrue(gs.includes("hezuradar@gmail.com") && /bienes y servicios/i.test(gs), gs);
  assertTrue(P.paymentInstructions({ paymentMethod: "bizum" }).includes("653713428"));
  assertEqual(P.paymentInstructions({ paymentMethod: "otros" }), "");
});
