(function () {
  "use strict";

  function ready() {
    return window.HA_EMAILJS_ENABLED && window.emailjs;
  }

  function formatPrice(n) {
    if (window.HA && window.HA.formatPrice) return window.HA.formatPrice(n);
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
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

  window.HA_EMAIL = { sendOrderEmail };
})();
