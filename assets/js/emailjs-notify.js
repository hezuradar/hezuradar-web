(function () {
  "use strict";

  const PAYMENT_LABELS = { paypal: "PayPal", bizum: "Bizum", otros: "Otros" };

  function ready() {
    return window.HA_EMAILJS_ENABLED && window.emailjs;
  }

  function formatPrice(n) {
    if (window.HA && window.HA.formatPrice) return window.HA.formatPrice(n);
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  async function sendOrderEmail(order) {
    if (!ready()) throw new Error("El envío de email no está configurado todavía.");
    const cfg = window.HA_EMAILJS_CONFIG;

    const itemsText = order.items
      .map((it) => `${it.qty}x ${it.title} - ${formatPrice(it.price * it.qty)}`)
      .join("\n");
    const s = order.shipping || {};
    const c = order.customer || {};

    const params = {
      order_code: order.notRegistered ? `⚠ NO REGISTRADO EN EL PANEL · ${order.orderCode}` : order.orderCode,
      items_text: itemsText,
      subtotal: formatPrice(order.subtotal),
      shipping_cost: formatPrice(order.shippingCost || 0),
      total: formatPrice(order.total),
      payment_method: PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod || "-",
      customer_name: c.name || "",
      customer_phone: c.phone || "",
      customer_email: c.email || "",
      shipping_address: `${s.address || ""}, ${s.postalCode || ""} ${s.city || ""}${s.province ? " (" + s.province + ")" : ""}`,
      notes: s.notes || "",
      to_email: cfg.toEmail,
      order_html: buildOwnerOrderHtml(order),
    };

    await emailjs.send(cfg.serviceId, cfg.templateId, params, { publicKey: cfg.publicKey });
  }

  // En el correo las rutas relativas no se resuelven: la miniatura va con la URL
  // absoluta de la web. Solo se aceptan fotos de producto publicadas (la ruta viene
  // del navegador del cliente), y si no hay, la celda queda vacía.
  const SITE_URL = "https://hezuradar.com/";

  function itemThumbUrl(path) {
    const p = String(path || "").replace(/^\/+/, "");
    if (!/^images\/products\/[\w.-]+\.(webp|jpe?g|png)$/i.test(p)) return "";
    const i = p.lastIndexOf(".");
    return SITE_URL + p.slice(0, i) + "-thumb" + p.slice(i);
  }

  function itemThumbCell(it) {
    const url = itemThumbUrl(it.image);
    return `<td style="width:64px;padding:10px 12px 10px 0;border-bottom:1px solid #e1e8ed;vertical-align:middle">${
      url
        ? `<img src="${escapeHtml(url)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid #e1e8ed">`
        : ""
    }</td>`;
  }

  function itemsRowsHtml(order) {
    return order.items
      .map(
        (it) => `
        <tr>
          ${itemThumbCell(it)}
          <td style="padding:10px 0;border-bottom:1px solid #e1e8ed;color:#1c2b36;font-size:14px">
            ${escapeHtml(it.title)}
            ${it.discountPercent ? `<span style="color:#6c7d89;font-size:12px"> (-${Number(it.discountPercent)}%)</span>` : ""}
            <div style="color:#6c7d89;font-size:12px">${Number(it.qty) || 0} × ${formatPrice(it.price)}</div>
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #e1e8ed;color:#1c2b36;font-size:14px;text-align:right;white-space:nowrap">
            ${formatPrice(it.price * it.qty)}
          </td>
        </tr>`
      )
      .join("");
  }

  function totalsTableHtml(order) {
    const shippingRow = order.shippingCost
      ? `<tr>
          <td style="padding:4px 0;color:#33424c;font-size:13px">Envío certificado</td>
          <td style="padding:4px 0;color:#33424c;font-size:13px;text-align:right">${formatPrice(order.shippingCost)}</td>
        </tr>`
      : "";
    return `
        <table style="width:100%;border-collapse:collapse;margin-top:10px">
          <tr>
            <td style="padding:4px 0;color:#33424c;font-size:13px">Subtotal</td>
            <td style="padding:4px 0;color:#33424c;font-size:13px;text-align:right">${formatPrice(order.subtotal)}</td>
          </tr>
          ${shippingRow}
          <tr>
            <td style="padding:8px 0 0;color:#1c2b36;font-size:16px;font-weight:bold;border-top:1px solid #e1e8ed">Total</td>
            <td style="padding:8px 0 0;color:#245F96;font-size:16px;font-weight:bold;text-align:right;border-top:1px solid #e1e8ed">${formatPrice(order.total)}</td>
          </tr>
        </table>`;
  }

  // Nota informativa para el negocio, calcada de la instrucción que ya ve el
  // cliente en su albarán, para poder comprobar el pago sin tener que abrir
  // el panel de pedidos.
  function ownerPaymentNote(method) {
    if (method === "bizum") return "El cliente ha visto la instrucción de hacer el Bizum al 653713428.";
    if (method === "paypal") return "El cliente ha visto la instrucción de enviar el PayPal a hezuradar@gmail.com como amigos/familia.";
    return "";
  }

  function buildOwnerOrderHtml(order) {
    const s = order.shipping || {};
    const c = order.customer || {};
    const paymentLabel = PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod || "-";
    const note = ownerPaymentNote(order.paymentMethod);
    const noteRow = s.notes
      ? `<tr><td style="padding:4px 0 0;color:#6c7d89;font-size:13px"><b>Notas del cliente:</b> ${escapeHtml(s.notes)}</td></tr>`
      : "";

    return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e1e8ed;border-radius:12px;overflow:hidden">
      <div style="background:#245F96;padding:22px 28px">
        <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:.3px">Hezur&amp;Adar</span>
        <div style="color:#cfe0f0;font-size:12px;margin-top:2px">Nuevo pedido recibido</div>
      </div>
      <div style="padding:28px">
        ${
          order.notRegistered
            ? `<div style="background:#fdecea;border:1px solid #e57373;border-radius:10px;padding:12px 14px;margin-bottom:18px;color:#8a1f17;font-size:13px">
                <b>Este pedido no se ha guardado en el panel</b> (motivo: ${escapeHtml(order.notRegistered)}).
                El navegador del cliente lo reintenta; si en unos minutos no aparece en Pedidos, añádelo a mano con estos datos.
              </div>`
            : ""
        }
        <h2 style="margin:0 0 4px;color:#1c2b36;font-size:19px">Pedido ${escapeHtml(order.orderCode)}</h2>
        <p style="margin:0 0 18px;color:#6c7d89;font-size:13px">${escapeHtml(new Date(order.createdAt || Date.now()).toLocaleString("es-ES"))}</p>

        <div style="background:#f5f7f9;border-radius:10px;padding:14px 16px;margin-bottom:20px">
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#33424c">
            <tr><td style="padding:2px 0"><b>Cliente</b></td><td style="padding:2px 0;text-align:right">${escapeHtml(c.name || "")}</td></tr>
            <tr><td style="padding:2px 0"><b>Teléfono</b></td><td style="padding:2px 0;text-align:right"><a href="tel:${escapeHtml(c.phone || "")}" style="color:#245F96;text-decoration:none">${escapeHtml(c.phone || "-")}</a></td></tr>
            <tr><td style="padding:2px 0"><b>Email</b></td><td style="padding:2px 0;text-align:right"><a href="mailto:${escapeHtml(c.email || "")}" style="color:#245F96;text-decoration:none">${escapeHtml(c.email || "-")}</a></td></tr>
            <tr><td style="padding:2px 0"><b>Forma de pago</b></td><td style="padding:2px 0;text-align:right">${escapeHtml(paymentLabel)}</td></tr>
          </table>
          ${note ? `<p style="margin:10px 0 0;color:#245F96;font-size:12px">${escapeHtml(note)}</p>` : ""}
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:6px">
          ${itemsRowsHtml(order)}
        </table>

        ${totalsTableHtml(order)}

        <div style="margin-top:22px;padding-top:18px;border-top:1px solid #e1e8ed">
          <p style="margin:0 0 4px;color:#1c2b36;font-size:14px;font-weight:bold">Dirección de envío</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:2px 0;color:#33424c;font-size:13px">${escapeHtml(s.address || "")}</td></tr>
            <tr><td style="padding:2px 0;color:#33424c;font-size:13px">${escapeHtml(s.postalCode || "")} ${escapeHtml(s.city || "")}${s.province ? " (" + escapeHtml(s.province) + ")" : ""}</td></tr>
            ${noteRow}
          </table>
        </div>
      </div>
    </div>`;
  }

  // La confirmación al CLIENTE ya no se envía desde aquí: la manda el Apps Script
  // (scripts/drive-export/Code.gs) leyendo el pedido guardado, para que nadie pueda
  // usar la plantilla de EmailJS con un destinatario o un contenido propios.
  // Mensaje del formulario de contacto de la portada (assets/js/contact-form.js).
  // Si no hay plantilla propia (contactTemplateId), usa la del aviso de pedido, que
  // pinta {{{order_html}}} tal cual. captchaToken va como g-recaptcha-response para
  // que EmailJS lo compruebe si tiene reCAPTCHA activado en Account → Security.
  async function sendContactEmail(msg) {
    if (!ready()) throw new Error("El envío de email no está configurado todavía.");
    const cfg = window.HA_EMAILJS_CONFIG;
    const params = {
      order_code: `Mensaje de contacto · ${msg.name}`,
      customer_name: msg.name,
      customer_email: msg.email,
      customer_phone: msg.phone,
      notes: msg.message,
      reply_to: msg.email,
      to_email: cfg.toEmail,
      order_html: buildContactHtml(msg),
      "g-recaptcha-response": msg.captchaToken || "",
    };
    await emailjs.send(cfg.serviceId, cfg.contactTemplateId || cfg.templateId, params, { publicKey: cfg.publicKey });
  }

  function buildContactHtml(msg) {
    return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e1e8ed;border-radius:12px;overflow:hidden">
      <div style="background:#245F96;padding:22px 28px">
        <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:.3px">Hezur&amp;Adar</span>
      </div>
      <div style="padding:26px 28px">
        <p style="margin:0 0 16px;color:#1c2b36;font-size:16px;font-weight:bold">Nuevo mensaje desde el formulario de contacto</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <tr><td style="padding:3px 0;color:#6c7d89;font-size:13px;width:70px">Nombre</td><td style="padding:3px 0;color:#1c2b36;font-size:14px">${escapeHtml(msg.name)}</td></tr>
          <tr><td style="padding:3px 0;color:#6c7d89;font-size:13px">Email</td><td style="padding:3px 0;color:#1c2b36;font-size:14px"><a href="mailto:${escapeHtml(msg.email)}" style="color:#245F96">${escapeHtml(msg.email)}</a></td></tr>
          <tr><td style="padding:3px 0;color:#6c7d89;font-size:13px">Teléfono</td><td style="padding:3px 0;color:#1c2b36;font-size:14px"><a href="tel:${escapeHtml(String(msg.phone || "").replace(/[^\d+]/g, ""))}" style="color:#245F96">${escapeHtml(msg.phone)}</a></td></tr>
        </table>
        <div style="padding:14px 16px;background:#f5f8fa;border-radius:8px;color:#1c2b36;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(msg.message)}</div>
        <p style="margin:18px 0 0;color:#6c7d89;font-size:12px">Responde a ${escapeHtml(msg.email)} o llama al ${escapeHtml(msg.phone)}.</p>
      </div>
    </div>`;
  }

  window.HA_EMAIL = { sendOrderEmail, sendContactEmail };
})();
