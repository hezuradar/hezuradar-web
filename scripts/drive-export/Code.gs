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
 *
 * La primera vez que se exporta un pedido se manda un aviso a NOTIFY_EMAIL con
 * la nota en PDF, el diseño y el enlace a la carpeta (las reexportaciones no avisan).
 * Instrucciones de instalación: README.md, sección 7.
 */

const ROOT_FOLDER_ID = "1MML8aSlkTRKsJQjeQ8ukaGbSN1J_O_e4";
const FIREBASE_PROJECT_ID = "hezuradar-web";
const NOTIFY_EMAIL = "hezuradar@gmail.com";
const DESIGN_KINDS = {
  "placa-personalizada": "Placa personalizada",
  "pua-personalizada": "Púa personalizada",
};

// Email de confirmación al cliente. Se envía desde aquí (y no desde EmailJS en el
// navegador) para que el contenido salga siempre del pedido guardado en Firestore y
// nadie pueda usar la cuenta para mandar correos con un texto o destinatario propios.
// - action "confirmCustomer": la cesta, justo después de crear el pedido, con un
//   token de reCAPTCHA que se valida con Google. Solo una vez por pedido y solo
//   durante los primeros minutos desde que se creó.
// - action "resendCustomer": el botón "Reenviar email" del panel, con el ID token
//   de Firebase del administrador.
// La clave secreta de reCAPTCHA va en Configuración del proyecto → Propiedades del
// script → RECAPTCHA_SECRET (nunca en este archivo, que se publica en GitHub).
const FIREBASE_API_KEY = "AIzaSyDHdD-PcTQtaJhbGPegd7aW6ZWiI_EPFuQ"; // clave pública, la misma de assets/js/firebase-config.js
const ADMIN_EMAILS = ["hezuradar@gmail.com", "iotegi@gmail.com"];
const SITE_HOSTNAME = "hezuradar.com";
const CONFIRM_WINDOW_MINUTES = 30;

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const orderId = String(body.orderId || "");
    if (!/^[A-Za-z0-9]{10,40}$/.test(orderId)) throw new Error("ID de pedido no válido.");
    if (body.action === "confirmCustomer") return json_({ ok: true, ...confirmCustomer_(orderId, String(body.captchaToken || "")) });
    if (body.action === "resendCustomer") return json_({ ok: true, ...resendCustomer_(orderId, String(body.idToken || "")) });
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

// Diseños del pedido: los del personalizador llevan uno (kind/material/design) y los
// pedidos agrupados desde el panel pueden llevar varios en designs[].
function orderDesigns_(o) {
  if (Array.isArray(o.designs)) return o.designs;
  if (!DESIGN_KINDS[o.kind]) return [];
  return [{ kind: o.kind, orderCode: o.orderCode, material: o.material, qty: qty_(o), design: o.design || {} }];
}

function designsLabel_(designs) {
  return designs.length > 1 ? "Varios diseños" : DESIGN_KINDS[designs[0].kind] || "Diseño personalizado";
}

function exportOrder_(orderId) {
  const o = getOrder_(orderId);
  const designs = orderDesigns_(o);
  if (!designs.length) throw new Error("Solo se exportan pedidos de placa o púa personalizada.");
  const c = o.customer || {};
  const code = safeName_(o.orderCode || orderId);

  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const clientFolder = getOrCreateFolder_(root, safeName_(c.name) || "Sin nombre");
  const orderFolder = getOrCreateFolder_(clientFolder, code);

  // Con varios diseños, cada archivo lleva delante el código de su pedido de origen.
  const files = [];
  const designJpgs = [];
  let fileMissing = false;
  designs.forEach((ds) => {
    const d = ds.design || {};
    const prefix = designs.length > 1 ? safeName_(ds.orderCode) || code : code;
    if (isImageDataUrl_(d.snapshot)) {
      const jpg = dataUrlToBlob_(d.snapshot, "image/jpeg", prefix + "-diseno.jpg");
      designJpgs.push(jpg);
      files.push(putFile_(orderFolder, jpg));
    }
    if (d.fileData && String(d.fileData).indexOf("data:") === 0) {
      const base = safeClientFileName_(d.fileName);
      const name = designs.length > 1 || !d.fileName ? prefix + "-" + base : base;
      files.push(putFile_(orderFolder, dataUrlToBlob_(d.fileData, safeMime_(base), name)));
    } else if (d.fileTooLargeToEmbed) {
      fileMissing = true;
    }
  });
  const pdf = HtmlService.createHtmlOutput(noteHtml_(o, orderId, designs))
    .getBlob()
    .getAs("application/pdf")
    .setName(code + "-nota-pedido.pdf");
  files.push(putFile_(orderFolder, pdf));

  const folderUrl = orderFolder.getUrl();
  // driveExportedAt se lee antes de marcarlo: así solo avisa la primera exportación,
  // aunque el cliente y el admin la lancen a la vez (el bloqueo de doPost las ordena).
  const isNew = !o.driveExportedAt;
  markExported_(orderId, folderUrl);
  if (isNew) notifyNewOrder_(o, code, folderUrl, designs, [pdf, ...designJpgs]);
  return { folderUrl, files, fileMissing };
}

/* ---------------- Aviso por email ---------------- */

function notifyNewOrder_(o, code, folderUrl, designs, attachments) {
  const c = o.customer || {};
  const notes = (o.shipping && o.shipping.notes) || "";
  const pieces = designs
    .map((ds) => `Material: ${esc_((ds.material && ds.material.label) || "-")} · Cantidad: ${esc_(ds.qty || 1)}`)
    .join("<br>");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;font-size:14px">
    <p><b>Nuevo pedido (${esc_(designsLabel_(designs).toLowerCase())}): ${esc_(code)}</b></p>
    <p>${pieces}</p>
    <p><b>${esc_(c.name || "-")}</b>${c.phone ? "<br>Tel: " + esc_(c.phone) : ""}${c.email ? "<br>Email: " + esc_(c.email) : ""}</p>
    ${notes ? `<p><b>Nota del cliente:</b><br>${esc_(notes).replace(/\n/g, "<br>")}</p>` : ""}
    <p><a href="${folderUrl}">📁 Abrir la carpeta del pedido en Drive</a></p>
  </div>`;
  try {
    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: `Nuevo pedido ${code} · ${designsLabel_(designs)} · ${c.name || "sin nombre"}`,
      htmlBody: html,
      attachments,
      replyTo: c.email || undefined,
    });
  } catch (err) {
    // Los archivos ya están en Drive: un fallo del correo no debe dar el pedido por fallido.
    console.error("No se pudo enviar el aviso por email: " + err);
  }
}

/* ---------------- Confirmación al cliente ---------------- */

function confirmCustomer_(orderId, captchaToken) {
  verifyCaptcha_(captchaToken);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const o = getOrder_(orderId);
    if (o.customerEmailSentAt) return { sent: false, reason: "ya enviado" };
    const created = new Date(o.createdAtServer || o.createdAt || 0).getTime();
    if (!created || Date.now() - created > CONFIRM_WINDOW_MINUTES * 60 * 1000) {
      throw new Error("El pedido es demasiado antiguo para enviar la confirmación automática.");
    }
    sendCustomerEmail_(o);
    markCustomerEmailed_(orderId);
    return { sent: true };
  } finally {
    lock.releaseLock();
  }
}

function resendCustomer_(orderId, idToken) {
  verifyAdmin_(idToken);
  const o = getOrder_(orderId);
  sendCustomerEmail_(o);
  markCustomerEmailed_(orderId);
  return { sent: true };
}

function verifyCaptcha_(token) {
  const secret = PropertiesService.getScriptProperties().getProperty("RECAPTCHA_SECRET");
  if (!secret) throw new Error("Falta RECAPTCHA_SECRET en las propiedades del script.");
  if (!token) throw new Error("Falta la verificación reCAPTCHA.");
  const res = UrlFetchApp.fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "post",
    payload: { secret: secret, response: token },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText() || "{}");
  if (!data.success || data.hostname !== SITE_HOSTNAME) throw new Error("La verificación reCAPTCHA no es válida.");
}

// Comprueba el ID token de Firebase con Identity Toolkit y que el correo sea de un admin.
function verifyAdmin_(idToken) {
  if (!idToken) throw new Error("Falta la sesión de administrador.");
  const res = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FIREBASE_API_KEY, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true,
  });
  const user = ((JSON.parse(res.getContentText() || "{}").users) || [])[0];
  if (res.getResponseCode() !== 200 || !user || ADMIN_EMAILS.indexOf(String(user.email || "").toLowerCase()) === -1) {
    throw new Error("Sesión de administrador no válida.");
  }
}

function sendCustomerEmail_(o) {
  const c = o.customer || {};
  const email = String(c.email || "").trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length > 200) {
    throw new Error("El pedido no tiene un email de cliente válido.");
  }
  MailApp.sendEmail({
    to: email,
    subject: `Pedido ${o.orderCode || ""} recibido - HezurAdar`,
    htmlBody: customerEmailHtml_(o),
    name: "HezurAdar",
    replyTo: NOTIFY_EMAIL,
  });
}

function markCustomerEmailed_(orderId) {
  const res = UrlFetchApp.fetch(firestoreUrl_(orderId) + "?updateMask.fieldPaths=customerEmailSentAt", {
    method: "patch",
    contentType: "application/json",
    headers: firestoreHeaders_(),
    muteHttpExceptions: true,
    payload: JSON.stringify({ fields: { customerEmailSentAt: { stringValue: new Date().toISOString() } } }),
  });
  if (res.getResponseCode() !== 200) console.warn("No se pudo guardar customerEmailSentAt: " + res.getContentText());
}

const PAYMENT_LABELS = { paypal: "PayPal", bizum: "Bizum", otros: "Otros" };

function eur_(n) {
  return (Number(n) || 0).toFixed(2).replace(".", ",") + " €";
}

// Mismo diseño que tenía la plantilla de EmailJS, pero montado aquí con datos escapados.
function customerEmailHtml_(o) {
  const c = o.customer || {};
  const s = o.shipping || {};
  const items = Array.isArray(o.items) ? o.items : [];
  const subtotal = Number(o.subtotal) || 0;
  const shipping = Number(o.shippingCost) || 0;
  const total = typeof o.total === "number" ? o.total : subtotal + shipping;
  const td = "padding:4px 0;color:#33424c;font-size:13px";
  const rows = items
    .map(
      (it) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #e1e8ed;color:#1c2b36;font-size:14px">${esc_(it.title)}
          <div style="color:#6c7d89;font-size:12px">${esc_(Number(it.qty) || 0)} × ${esc_(eur_(it.price))}</div></td>
        <td style="padding:10px 0;border-bottom:1px solid #e1e8ed;color:#1c2b36;font-size:14px;text-align:right;white-space:nowrap">${esc_(eur_((Number(it.price) || 0) * (Number(it.qty) || 0)))}</td>
      </tr>`
    )
    .join("");
  const priced = subtotal > 0;
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e1e8ed;border-radius:12px;overflow:hidden">
    <div style="background:#245F96;padding:22px 28px"><span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:.3px">HezurAdar</span></div>
    <div style="padding:28px">
      <h2 style="margin:0 0 6px;color:#1c2b36;font-size:19px">¡Gracias por tu pedido, ${esc_(c.name || "")}!</h2>
      <p style="margin:0 0 18px;color:#33424c;font-size:14px;line-height:1.5">Hemos recibido tu pedido. Nos pondremos en contacto contigo en breve para confirmar la disponibilidad, el envío y los datos de pago. Aquí tienes el resumen:</p>
      <div style="background:#f5f7f9;border-radius:10px;padding:14px 16px;margin-bottom:20px">
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#33424c">
          <tr><td style="padding:2px 0"><b>Nº de pedido</b></td><td style="padding:2px 0;text-align:right">${esc_(o.orderCode || "")}</td></tr>
          <tr><td style="padding:2px 0"><b>Fecha</b></td><td style="padding:2px 0;text-align:right">${esc_(date_(o.createdAt))}</td></tr>
          <tr><td style="padding:2px 0"><b>Forma de pago</b></td><td style="padding:2px 0;text-align:right">${esc_(PAYMENT_LABELS[o.paymentMethod] || "-")}</td></tr>
        </table>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:6px">${rows}</table>
      ${priced ? `<table style="width:100%;border-collapse:collapse;margin-top:10px">
        <tr><td style="${td}">Subtotal</td><td style="${td};text-align:right">${esc_(eur_(subtotal))}</td></tr>
        ${shipping ? `<tr><td style="${td}">Envío certificado</td><td style="${td};text-align:right">${esc_(eur_(shipping))}</td></tr>` : ""}
        <tr><td style="padding:8px 0 0;color:#1c2b36;font-size:16px;font-weight:bold;border-top:1px solid #e1e8ed">Total</td>
            <td style="padding:8px 0 0;color:#245F96;font-size:16px;font-weight:bold;text-align:right;border-top:1px solid #e1e8ed">${esc_(eur_(total))}</td></tr>
      </table>` : `<p style="color:#33424c;font-size:13px">Te enviaremos el presupuesto en breve.</p>`}
      <div style="margin-top:22px;padding-top:18px;border-top:1px solid #e1e8ed">
        <p style="margin:0 0 4px;color:#1c2b36;font-size:14px;font-weight:bold">Dirección de envío</p>
        <div style="${td}">${esc_(c.name || "")}<br>${esc_(s.address || "")}<br>${esc_(s.postalCode || "")} ${esc_(s.city || "")}${s.province ? " (" + esc_(s.province) + ")" : ""}<br>Tel: ${esc_(c.phone || "")}</div>
        ${s.notes ? `<p style="${td}"><b>Notas:</b> ${esc_(s.notes)}</p>` : ""}
      </div>
      <p style="margin:22px 0 0;color:#6c7d89;font-size:12px;line-height:1.5">Si tienes cualquier duda sobre tu pedido, responde a este correo o escríbenos por WhatsApp. Condiciones de venta y devoluciones: https://hezuradar.com/condiciones.html</p>
    </div>
  </div>`;
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

// El pedido lo escribe el cliente: la imagen del diseño solo se acepta si de verdad es
// un JPEG/PNG en base64, y el archivo original solo con una extensión de la lista
// (cualquier otra se guarda como .bin y como binario genérico, sin poder ejecutarse).
const SAFE_CLIENT_EXTS = { pdf: "application/pdf", dxf: "application/dxf", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

function isImageDataUrl_(s) {
  return typeof s === "string" && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+\/=]+$/.test(s);
}

function safeClientFileName_(fileName) {
  const base = safeName_(fileName).replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "archivo-cliente";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/\./g, "_");
  return stem + "." + (SAFE_CLIENT_EXTS[ext] ? ext : "bin");
}

function safeMime_(fileName) {
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  return SAFE_CLIENT_EXTS[ext] || "application/octet-stream";
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

function noteHtml_(o, orderId, designs) {
  const c = o.customer || {};
  const notes = (o.shipping && o.shipping.notes) || "";
  const many = designs.length > 1;
  const pieces = designs
    .map((ds, i) => {
      const d = ds.design || {};
      return `
    <h3>${many ? `Diseño ${i + 1} · ${esc_(DESIGN_KINDS[ds.kind] || "Diseño")} · ${esc_(ds.orderCode || "")}` : "Pieza"}</h3>
    <div>Material: <b>${esc_((ds.material && ds.material.label) || "-")}</b></div>
    <div>Cantidad: <b>${esc_(ds.qty || 1)}</b></div>
    ${d.fileName ? `<div>Archivo del cliente: ${esc_(d.fileName)}</div>` : ""}
    ${d.fileTooLargeToEmbed ? `<p class="warn">El archivo original era demasiado grande para guardarlo: hay que pedírselo al cliente.</p>` : ""}
    ${d.fileInDrive ? `<p>El archivo original está en la carpeta de Drive del pedido ${esc_(ds.orderCode || "")}.</p>` : ""}
    ${isImageDataUrl_(d.snapshot) ? `<img src="${d.snapshot}">` : ""}`;
    })
    .join("");
  // En un pedido agrupado se listan también los demás productos (sin precios).
  const others = many || (o.items || []).length > designs.length
    ? `<h3>Productos del pedido</h3>` +
      (o.items || []).map((it) => `<div>${esc_(Number(it.qty) || 0)}× ${esc_(it.title)}</div>`).join("")
    : "";

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#222;font-size:13px}
    .head{border-bottom:2px solid #245F96;padding-bottom:10px;margin-bottom:14px}
    .brand{font-size:20px;font-weight:bold;color:#245F96}
    .doc{font-size:15px;font-weight:bold;margin-top:6px}
    h3{font-size:13px;color:#245F96;margin:16px 0 6px}
    .notes{padding:8px 10px;border:1px solid #245F96;background:#eaf2fb}
    .warn{padding:8px 10px;border:1px solid #c0392b;background:#fdecea;color:#8a1f13}
    img{max-width:420px;border:1px solid #ddd;margin-top:6px}
  </style></head><body>
    <div class="head">
      <div class="brand">HezurAdar</div>
      <div class="doc">Nota de pedido · ${esc_(designsLabel_(designs))}</div>
      <div>Pedido ${esc_(o.orderCode || orderId)} · ${esc_(date_(o.createdAt))} · Estado: ${esc_(o.status || "pendiente")}</div>
    </div>
    ${pieces}
    ${others}

    ${notes ? `<h3>Nota del cliente</h3><div class="notes">${esc_(notes).replace(/\n/g, "<br>")}</div>` : ""}

    <h3>Cliente</h3>
    <div><b>${esc_(c.name || "-")}</b></div>
    ${c.phone ? `<div>Tel: ${esc_(c.phone)}</div>` : ""}
    ${c.email ? `<div>Email: ${esc_(c.email)}</div>` : ""}
  </body></html>`;
}

function esc_(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function qty_(o) {
  return ((o.items || [])[0] || {}).qty || 1;
}

function date_(iso) {
  if (!iso) return "";
  return Utilities.formatDate(new Date(iso), "Europe/Madrid", "dd/MM/yyyy HH:mm");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
