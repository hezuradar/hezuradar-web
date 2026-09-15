(function () {
  "use strict";

  const PAYMENT_LABELS = { paypal: "PayPal", bizum: "Bizum", otros: "Otros" };

  function ready() {
    return window.HA_EMAILJS_ENABLED && window.emailjs;
  }

  function customerReady() {
    const cfg = window.HA_EMAILJS_CONFIG;
    return ready() && cfg.customerTemplateId && cfg.customerTemplateId !== "TU_CUSTOMER_TEMPLATE_ID";
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
      order_code: order.orderCode,
      items_text: itemsText,
      subtotal: formatPrice(order.subtotal),
      customer_name: c.name || "",
      customer_phone: c.phone || "",
      customer_email: c.email || "",
      shipping_address: `${s.address || ""}, ${s.postalCode || ""} ${s.city || ""}${s.province ? " (" + s.province + ")" : ""}`,
      notes: s.notes || "",
      to_email: cfg.toEmail,
    };

    await emailjs.send(cfg.serviceId, cfg.templateId, params, { publicKey: cfg.publicKey });
  }

  function buildOrderHtml(order) {
    const s = order.shipping || {};
    const c = order.customer || {};
    const itemsRows = order.items
      .map(
        (it) => `
        <tr>
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

    const shippingRow = order.shippingCost
      ? `<tr>
          <td style="padding:4px 0;color:#33424c;font-size:13px">Envío certificado</td>
          <td style="padding:4px 0;color:#33424c;font-size:13px;text-align:right">${formatPrice(order.shippingCost)}</td>
        </tr>`
      : "";

    const noteRow = s.notes
      ? `<tr><td style="padding:4px 0 0;color:#6c7d89;font-size:13px"><b>Notas:</b> ${escapeHtml(s.notes)}</td></tr>`
      : "";

    return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e1e8ed;border-radius:12px;overflow:hidden">
      <div style="background:#245F96;padding:22px 28px">
        <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:.3px">Hezur&amp;Adar</span>
      </div>
      <div style="padding:28px">
        <h2 style="margin:0 0 6px;color:#1c2b36;font-size:19px">¡Gracias por tu compra, ${escapeHtml(c.name || "")}!</h2>
        <p style="margin:0 0 18px;color:#33424c;font-size:14px;line-height:1.5">
          Tu pedido será tramitado. Nos pondremos en contacto contigo en breve para concretar los
          detalles pendientes. Aquí tienes el resumen:
        </p>

        <div style="background:#f5f7f9;border-radius:10px;padding:14px 16px;margin-bottom:20px">
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#33424c">
            <tr><td style="padding:2px 0"><b>Nº de pedido</b></td><td style="padding:2px 0;text-align:right">${escapeHtml(order.orderCode)}</td></tr>
            <tr><td style="padding:2px 0"><b>Fecha</b></td><td style="padding:2px 0;text-align:right">${escapeHtml(new Date(order.createdAt || Date.now()).toLocaleString("es-ES"))}</td></tr>
            <tr><td style="padding:2px 0"><b>Forma de pago</b></td><td style="padding:2px 0;text-align:right">${escapeHtml(PAYMENT_LABELS[order.paymentMethod] || order.paymentMethod || "-")}</td></tr>
          </table>
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:6px">
          ${itemsRows}
        </table>

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
        </table>

        <div style="margin-top:22px;padding-top:18px;border-top:1px solid #e1e8ed">
          <p style="margin:0 0 4px;color:#1c2b36;font-size:14px;font-weight:bold">Dirección de envío</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:2px 0;color:#33424c;font-size:13px">${escapeHtml(c.name || "")}</td></tr>
            <tr><td style="padding:2px 0;color:#33424c;font-size:13px">${escapeHtml(s.address || "")}</td></tr>
            <tr><td style="padding:2px 0;color:#33424c;font-size:13px">${escapeHtml(s.postalCode || "")} ${escapeHtml(s.city || "")}${s.province ? " (" + escapeHtml(s.province) + ")" : ""}</td></tr>
            <tr><td style="padding:2px 0;color:#33424c;font-size:13px">Tel: ${escapeHtml(c.phone || "")}</td></tr>
            ${noteRow}
          </table>
        </div>

        <p style="margin:22px 0 0;color:#6c7d89;font-size:12px;line-height:1.5">
          Gracias por confiar en Hezur&amp;Adar. Si tienes cualquier duda sobre tu pedido,
          responde a este correo o escríbenos por WhatsApp.
        </p>
      </div>
    </div>`;
  }

  async function sendCustomerOrderEmail(order) {
    const email = order && order.customer && order.customer.email;
    if (!email) return;
    if (!customerReady()) {
      console.info("Email de confirmación al cliente no configurado (falta customerTemplateId en emailjs-config.js).");
      return;
    }
    const cfg = window.HA_EMAILJS_CONFIG;

    const params = {
      to_email: email,
      order_code: order.orderCode,
      customer_name: (order.customer && order.customer.name) || "",
      order_html: buildOrderHtml(order),
    };

    await emailjs.send(cfg.serviceId, cfg.customerTemplateId, params, { publicKey: cfg.publicKey });
  }

  window.HA_EMAIL = { sendOrderEmail, sendCustomerOrderEmail };
})();
