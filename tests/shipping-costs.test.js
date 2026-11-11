"use strict";

// Gastos de envío con Correos (assets/js/shipping-costs.js) y lector de Excel
// (assets/js/xlsx-mini.js). Los datos imitan la plantilla Control_envios_Correos_Hezur_Adar.xlsx
// con valores inventados.

const { loadBrowserModule } = require("./helpers");

const S = loadBrowserModule("assets/js/shipping-costs.js").HA_SHIPPING;
const X = loadBrowserModule("assets/js/xlsx-mini.js").HA_XLSX;

const HEADER = [
  "Fecha", "Nº seguimiento", "Destino", "Zona", "Peso facturado", "Tramo", "Servicio",
  "Bruto unitario (€)", "Descuento unitario (€)", "Neto envío (€)", "Combustible asignado (€)",
  "Base imponible (€)", "IVA (€)", "Coste final (€)", "Cliente / pedido", "Observaciones",
];

// Las columnas con fórmula llegan a 0 (Excel no guardó el valor calculado).
function row(date, tracking, dest, zone, tier, gross, discount) {
  return [date, tracking, dest, zone, tier, tier, "Paq Estándar domicilio", gross, discount, 0, 0, 0, 0, 0];
}

function workbook(extraRows, summary) {
  return {
    sheetNames: ["Envios", "Resumen"],
    sheets: {
      Envios: [HEADER].concat(extraRows || [
        row("08/10/2026", "PQTEST0001A", "Bizkaia", "Z2", "251-500 g", 6.2, 2.21),
        row("05/10/2026", "PQTEST0002B", "Barcelona", "Z3", "0-250 g", 6.37, 2.27),
        row("30/10/2026", "PQTEST0003C", "Málaga", "Z3+", "0-250 g", 6.37, 2.27),
      ]),
      Resumen: summary || [
        ["CONTROL DE FACTURAS CORREOS"],
        [],
        ["Periodo", "Octubre 2026"],
        ["Nº de envíos", 0],
        ["Suplemento combustible (€)", 1.2],
        ["Base imponible total (€)", 13.39],
        ["Tipo IVA", 0.21],
        ["IVA factura (€)", 2.81],
        ["Total factura (€)", 16.2],
      ],
    },
  };
}

test("recalcula neto, combustible, IVA y coste final aunque las fórmulas lleguen a 0", () => {
  const r = S.parseWorkbook(workbook());
  assertEqual(r.errors, []);
  const first = r.shipments.find((s) => s.tracking === "PQTEST0001A");
  assertEqual(first.net, 3.99);
  // 3,99 / 12,19 × 1,20 = 0,39
  assertEqual(first.fuel, 0.39);
  assertEqual(first.base, 4.38);
  assertTrue(first.total > first.base, "el coste final incluye IVA");
});

test("la suma de los envíos cuadra con el total de la factura tras ajustar céntimos", () => {
  const r = S.parseWorkbook(workbook());
  const sum = S.round2(r.shipments.reduce((a, s) => a + s.total, 0));
  assertEqual(sum, 16.2);
  assertEqual(r.invoice.total, 16.2);
  assertEqual(r.warnings, []);
});

test("avisa cuando la diferencia con la factura no es de redondeo", () => {
  const summary = workbook().sheets.Resumen.map((r) => (r[0] === "Total factura (€)" ? [r[0], 30] : r));
  const r = S.parseWorkbook(workbook(null, summary));
  assertEqual(r.warnings.length, 1);
  assertTrue(/no cuadra/.test(r.warnings[0]));
});

test("identifica la factura por el mes del periodo y convierte las fechas a ISO", () => {
  const r = S.parseWorkbook(workbook());
  assertEqual(r.invoice.id, "2026-10");
  assertEqual(r.invoice.period, "Octubre 2026");
  assertEqual(r.invoice.fromDate, "2026-10-05");
  assertEqual(r.invoice.toDate, "2026-10-30");
  assertTrue(r.shipments.every((s) => s.invoiceId === "2026-10"));
});

test("sin hoja Resumen usa el 21 % de IVA, sin combustible, y lo avisa", () => {
  const wb = workbook();
  delete wb.sheets.Resumen;
  const r = S.parseWorkbook(wb);
  assertEqual(r.shipments[0].fuel, 0);
  assertEqual(r.invoice.vatRate, 0.21);
  assertTrue(r.warnings.some((w) => /21/.test(w)));
});

test("salta filas vacías e informa de fechas, importes o envíos repetidos", () => {
  const r = S.parseWorkbook(workbook([
    row("08/10/2026", "PQTEST0001A", "Bizkaia", "Z2", "0-250 g", 6.2, 2.21),
    [],
    row("31/02/2026", "PQTEST0002B", "Burgos", "Z3", "0-250 g", 6.37, 2.27),
    row("09/10/2026", "PQTEST0003C", "Burgos", "Z3", "0-250 g", 1, 5),
    row("10/10/2026", "PQTEST0001A", "Bizkaia", "Z2", "0-250 g", 6.2, 2.21),
  ]));
  assertEqual(r.shipments.length, 1);
  assertEqual(r.errors.length, 3);
});

test("encuentra las columnas por su cabecera aunque cambien de orden", () => {
  const wb = {
    sheets: {
      envios: [
        ["Nº seguimiento", "Bruto", "Descuento", "Fecha", "Zona"],
        ["pq test 9", "6,37", "2,27", "2026-10-15", "z3"],
      ],
    },
  };
  const r = S.parseWorkbook(wb);
  assertEqual(r.errors, []);
  assertEqual(r.shipments[0].tracking, "PQTEST9");
  assertEqual(r.shipments[0].zone, "Z3");
  assertEqual(r.shipments[0].net, 4.1);
  assertEqual(r.shipments[0].date, "2026-10-15");
});

test("rechaza un Excel sin hoja Envios o sin columnas de importes", () => {
  assertEqual(S.parseWorkbook({ sheets: { Hoja1: [] } }).errors.length, 1);
  const r = S.parseWorkbook({ sheets: { Envios: [["Fecha", "Nº seguimiento"], ["01/10/2026", "X"]] } });
  assertEqual(r.shipments, []);
  assertTrue(r.errors.length >= 1);
});

test("toIsoDate admite texto dd/mm/aaaa, aaaa-mm-dd y número de serie de Excel", () => {
  assertEqual(S.toIsoDate("08/10/2026"), "2026-10-08");
  assertEqual(S.toIsoDate("8-10-26"), "2026-10-08");
  assertEqual(S.toIsoDate("2026-10-08"), "2026-10-08");
  assertEqual(S.toIsoDate(46303), "2026-10-08");
  assertEqual(S.toIsoDate("31/02/2026"), null);
  assertEqual(S.toIsoDate(""), null);
});

test("toNumber entiende la coma decimal y el símbolo del euro", () => {
  assertEqual(S.toNumber("6,37 €"), 6.37);
  assertEqual(S.toNumber("1.234,5"), 1234.5);
  assertEqual(S.toNumber(2.266), 2.266);
  assertEqual(S.toNumber("abc"), null);
});

test("filterByRange incluye los dos extremos y admite extremos vacíos", () => {
  const list = [{ date: "2026-10-01" }, { date: "2026-10-15" }, { date: "2026-10-31" }];
  assertEqual(S.filterByRange(list, "2026-10-01", "2026-10-15").length, 2);
  assertEqual(S.filterByRange(list, "", "2026-10-14").length, 1);
  assertEqual(S.filterByRange(list, "2026-10-31", "").length, 1);
  assertEqual(S.filterByRange(list, "", "").length, 3);
});

test("summarize agrupa por zona y destino, de más a menos gasto", () => {
  const r = S.parseWorkbook(workbook());
  const s = S.summarize(r.shipments);
  assertEqual(s.count, 3);
  assertEqual(s.total, 16.2);
  assertEqual(s.byZone.map((z) => z.key).sort(), ["Z2", "Z3", "Z3+"]);
  assertEqual(s.byDestination.length, 3);
  assertEqual(s.byMonth.map((m) => m.key), ["2026-10"]);
  assertEqual(S.summarize([]).avg, 0);
});

test("ordersByTracking cruza envíos y pedidos por nº de seguimiento sin distinguir mayúsculas", () => {
  const map = S.ordersByTracking([{ orderCode: "HA-1", trackingNumber: " pqtest0001a " }, { orderCode: "HA-2" }]);
  assertEqual(map.get("PQTEST0001A").orderCode, "HA-1");
  assertEqual(map.size, 1);
  assertEqual(S.docIdFor("pq/test 01"), "PQTEST01");
});

test("chargedVsReal compara el envío cobrado con el coste real en las mismas fechas", () => {
  const orders = [
    { orderCode: "A", status: "enviado", createdAt: "2026-10-07T12:00:00", shippingCost: 4.5, trackingNumber: "PQ1" },
    { orderCode: "B", status: "entregado", createdAt: "2026-10-18T12:00:00", shippingCost: 6 },
    { orderCode: "C", status: "cancelado", createdAt: "2026-10-19T12:00:00", shippingCost: 9 },
    { orderCode: "D", status: "pendiente", createdAt: "2026-11-02T12:00:00", shippingCost: 4.5 },
    { orderCode: "E", status: "pendiente", createdAt: "2026-10-20T12:00:00" },
  ];
  const shipments = [
    { date: "2026-10-08", tracking: "PQ1", total: 5.4 },
    { date: "2026-10-19", tracking: "PQ2", total: 5.54 },
    { date: "2026-11-03", tracking: "PQ3", total: 5.54 },
  ];
  const counts = (o) => o.status !== "cancelado";
  const r = S.chargedVsReal(orders, shipments, "2026-10-01", "2026-10-31", counts);
  assertEqual(r.charged, 10.5);
  assertEqual(r.orders, 3);
  assertEqual(r.chargedOrders, 2);
  assertEqual(r.spent, 10.94);
  assertEqual(r.shipments, 2);
  assertEqual(r.balance, -0.44);
  assertEqual(r.matched, { count: 1, charged: 4.5, spent: 5.4, balance: -0.9, losing: 1 });
  assertEqual(S.chargedVsReal(orders, shipments, "", "", counts).charged, 15);
  assertEqual(S.chargedVsReal([], [], "", "").coverage, null);
});

test("periodMonth reconoce el mes en castellano", () => {
  assertEqual(S.periodMonth("Octubre 2026"), "2026-10");
  assertEqual(S.periodMonth("setiembre de 2026"), "2026-09");
  assertEqual(S.periodMonth("Factura"), null);
});

test("xlsx-mini lee celdas de texto compartido, número, texto en línea y huecos", () => {
  const shared = X.parseSharedStrings(
    '<sst><si><t>Fecha</t></si><si><r><t>Nº </t></r><r><t xml:space="preserve">seguimiento</t></r></si><si><t>A &amp; B</t></si></sst>'
  );
  assertEqual(shared, ["Fecha", "Nº seguimiento", "A & B"]);
  const rows = X.parseSheet(
    '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c></row>' +
      '<row r="2"><c r="A2"><v>6.37</v></c><c r="B2" t="inlineStr"><is><t>Z3</t></is></c>' +
      '<c r="D2"><f>A2*2</f></c><c r="E2" t="str"><f>B2</f><v>Z3</v></c></row></sheetData>',
    shared
  );
  assertEqual(rows[0], ["Fecha", null, "A & B"]);
  assertEqual(rows[1], [6.37, "Z3", null, null, "Z3"]);
  assertEqual(X.cellRef("AB12"), { col: 27, row: 11 });
});
