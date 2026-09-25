/**
 * HezurAdar — exporta pedidos de placa/púa personalizada a Google Drive.
 *
 * Se publica como aplicación web de Apps Script ("Ejecutar como: yo",
 * "Acceso: cualquier usuario"). La web solo le manda el ID del documento de
 * Firestore; el script lee el pedido con tu cuenta (no con los datos que llegan
 * en la petición), así nadie puede subir archivos arbitrarios a tu Drive.
 *
 * Estructura que crea dentro de la carpeta compartida:
 *   <Nombre del cliente>/<Código del pedido>/
 *     <código>-diseno.jpg        diseño ajustado que se genera al cerrar el pedido
 *     <archivo del cliente>      PDF/DXF original subido por el cliente
 *     <código>-nota-pedido.pdf   nota del pedido
 *
 * Si se vuelve a exportar el mismo pedido (p.ej. tras presupuestarlo), los
 * archivos con el mismo nombre se mandan a la papelera y se crean de nuevo.
 * Instrucciones de instalación: README.md, sección 7.
 */

const ROOT_FOLDER_ID = "1MML8aSlkTRKsJQjeQ8ukaGbSN1J_O_e4";
const FIREBASE_PROJECT_ID = "hezuradar-web";
const DESIGN_KINDS = {
  "placa-personalizada": "Placa personalizada",
  "pua-personalizada": "Púa personalizada",
};
const PAYMENT_LABELS = { paypal: "PayPal", bizum: "Bizum", otros: "Otros" };

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const orderId = String(body.orderId || "");
    if (!/^[A-Za-z0-9]{10,40}$/.test(orderId)) throw new Error("ID de pedido no válido.");
    // El cliente (al cerrar el pedido) y el admin ("Enviar a cortar") pueden
    // lanzarlo a la vez: el bloqueo evita crear carpetas duplicadas.
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      return json_({ ok: true, ...exportOrder_(orderId) });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function doGet() {
  return json_({ ok: true, service: "hezuradar-drive-export" });
}

// Ejecútala una vez desde el editor (▶ Ejecutar) al instalarlo: pide los permisos
// y comprueba que la cuenta llega a la carpeta de Drive y a los pedidos de Firestore.
function probarConexion() {
  const folder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  console.log("✅ Drive: carpeta \"" + folder.getName() + "\" accesible.");
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/orders?pageSize=1&mask.fieldPaths=orderCode`;
  const res = UrlFetchApp.fetch(url, { headers: firestoreHeaders_(), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error("❌ Firestore respondió " + res.getResponseCode() + ": " + res.getContentText());
  }
  console.log("✅ Firestore: pedidos accesibles.");
}

function exportOrder_(orderId) {
  const o = getOrder_(orderId);
  if (!DESIGN_KINDS[o.kind]) throw new Error("Solo se exportan pedidos de placa o púa personalizada.");
  const c = o.customer || {};
  const d = o.design || {};
  const code = safeName_(o.orderCode || orderId);

  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const clientFolder = getOrCreateFolder_(root, safeName_(c.name) || "Sin nombre");
  const orderFolder = getOrCreateFolder_(clientFolder, code);

  const files = [];
  if (d.snapshot) {
    files.push(putFile_(orderFolder, dataUrlToBlob_(d.snapshot, "image/jpeg", code + "-diseno.jpg")));
  }
  if (d.fileData) {
    const name = safeName_(d.fileName) || code + "-archivo-cliente";
    files.push(putFile_(orderFolder, dataUrlToBlob_(d.fileData, d.fileType, name)));
  }
  const pdf = HtmlService.createHtmlOutput(noteHtml_(o, orderId))
    .getBlob()
    .getAs("application/pdf")
    .setName(code + "-nota-pedido.pdf");
  files.push(putFile_(orderFolder, pdf));

  const folderUrl = orderFolder.getUrl();
  markExported_(orderId, folderUrl);
  return { folderUrl, files, fileMissing: !d.fileData && !!d.fileTooLargeToEmbed };
}

/* ---------------- Drive ---------------- */

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function putFile_(folder, blob) {
  const name = blob.getName();
  const existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);
  folder.createFile(blob);
  return name;
}

function dataUrlToBlob_(dataUrl, mimeType, name) {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.substring(5, comma);
  const type = mimeType || meta.replace(/;base64$/i, "") || "application/octet-stream";
  return Utilities.newBlob(Utilities.base64Decode(dataUrl.substring(comma + 1)), type, name);
}

// Drive admite casi cualquier carácter, pero quitamos barras y espacios de más
// para que el mismo cliente caiga siempre en la misma carpeta.
function safeName_(s) {
  return String(s || "").replace(/[\/\\]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
}

/* ---------------- Firestore (REST con la cuenta del propietario) ---------------- */

function firestoreUrl_(orderId) {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/orders/${orderId}`;
}

function firestoreHeaders_() {
  return {
    Authorization: "Bearer " + ScriptApp.getOAuthToken(),
    // Sin esto Google imputa la llamada al proyecto interno del script, que no
    // tiene activada la API de Firestore.
    "X-Goog-User-Project": FIREBASE_PROJECT_ID,
  };
}

function getOrder_(orderId) {
  const res = UrlFetchApp.fetch(firestoreUrl_(orderId), { headers: firestoreHeaders_(), muteHttpExceptions: true });
  if (res.getResponseCode() === 404) throw new Error("No existe ese pedido.");
  if (res.getResponseCode() !== 200) throw new Error("Firestore respondió " + res.getResponseCode() + ": " + res.getContentText());
  return decodeFields_(JSON.parse(res.getContentText()).fields || {});
}

function markExported_(orderId, folderUrl) {
  const url =
    firestoreUrl_(orderId) + "?updateMask.fieldPaths=driveFolderUrl&updateMask.fieldPaths=driveExportedAt";
  const res = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    headers: firestoreHeaders_(),
    muteHttpExceptions: true,
    payload: JSON.stringify({
      fields: {
        driveFolderUrl: { stringValue: folderUrl },
        driveExportedAt: { stringValue: new Date().toISOString() },
      },
    }),
  });
  // No es crítico: los archivos ya están en Drive aunque no se guarde el enlace.
  if (res.getResponseCode() !== 200) console.warn("No se pudo guardar driveFolderUrl: " + res.getContentText());
}

function decodeFields_(fields) {
  const out = {};
  Object.keys(fields).forEach((k) => (out[k] = decodeValue_(fields[k])));
  return out;
}

function decodeValue_(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields_(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue_);
  return null;
}

/* ---------------- Nota del pedido (HTML → PDF) ---------------- */

function noteHtml_(o, orderId) {
  const c = o.customer || {};
  const s = o.shipping || {};
  const d = o.design || {};
  const items = o.items || [];
  const shippingCost = Number(o.shippingCost) || 0;
  const itemsSum = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
  const total = typeof o.total === "number" ? o.total : (Number(o.subtotal) || 0) + shippingCost;
  const rows = items
    .map(
      (it) =>
        `<tr><td>${esc_(it.title)}</td><td class="num">${Number(it.qty) || 0}</td><td class="num">${price_(it.price)}</td><td class="num">${price_((Number(it.price) || 0) * (Number(it.qty) || 0))}</td></tr>`
    )
    .join("");
  const address = [s.address, [s.postalCode, s.city].filter(Boolean).join(" "), s.province ? "(" + s.province + ")" : ""]
    .filter(Boolean)
    .join(", ");

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#222;font-size:13px}
    .head{border-bottom:2px solid #245F96;padding-bottom:10px;margin-bottom:14px}
    .brand{font-size:20px;font-weight:bold;color:#245F96}
    .doc{font-size:15px;font-weight:bold;margin-top:6px}
    h3{font-size:13px;color:#245F96;margin:16px 0 6px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:6px;border-bottom:1px solid #ddd;text-align:left}
    .num{text-align:right}
    .total td{font-weight:bold;border-top:2px solid #245F96}
    .notes{padding:8px 10px;border:1px solid #245F96;background:#eaf2fb}
    .warn{padding:8px 10px;border:1px solid #c0392b;background:#fdecea;color:#8a1f13}
    img{max-width:420px;border:1px solid #ddd}
  </style></head><body>
    <div class="head">
      <div class="brand">HezurAdar</div>
      <div class="doc">Nota de pedido · ${esc_(DESIGN_KINDS[o.kind])}</div>
      <div>Pedido ${esc_(o.orderCode || orderId)} · ${esc_(date_(o.createdAt))} · Estado: ${esc_(o.status || "pendiente")}</div>
    </div>

    <h3>Pieza</h3>
    <div>Material: <b>${esc_((o.material && o.material.label) || "-")}</b></div>
    ${d.fileName ? `<div>Archivo del cliente: ${esc_(d.fileName)}</div>` : ""}
    ${d.fileTooLargeToEmbed ? `<p class="warn">El archivo original era demasiado grande para guardarlo: hay que pedírselo al cliente.</p>` : ""}

    ${s.notes ? `<h3>Nota del cliente</h3><div class="notes">${esc_(s.notes)}</div>` : ""}

    <h3>Detalle</h3>
    <table>
      <thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Importe</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="3">Productos</td><td class="num">${price_(itemsSum)}</td></tr>
        ${shippingCost > 0 ? `<tr><td colspan="3">Envío</td><td class="num">${price_(shippingCost)}</td></tr>` : ""}
        <tr class="total"><td colspan="3">Total</td><td class="num">${price_(total)}</td></tr>
      </tfoot>
    </table>

    <h3>Cliente</h3>
    <div><b>${esc_(c.name || "-")}</b></div>
    ${c.phone ? `<div>Tel: ${esc_(c.phone)}</div>` : ""}
    ${c.email ? `<div>Email: ${esc_(c.email)}</div>` : ""}
    ${address ? `<div>Dirección: ${esc_(address)}</div>` : ""}
    ${o.paymentMethod ? `<div>Forma de pago: ${esc_(PAYMENT_LABELS[o.paymentMethod] || o.paymentMethod)}</div>` : ""}

    ${d.snapshot ? `<h3>Diseño</h3><img src="${d.snapshot}">` : ""}
  </body></html>`;
}

function esc_(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function price_(n) {
  return (Number(n) || 0).toFixed(2).replace(".", ",") + " €";
}

function date_(iso) {
  if (!iso) return "";
  return Utilities.formatDate(new Date(iso), "Europe/Madrid", "dd/MM/yyyy HH:mm");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
