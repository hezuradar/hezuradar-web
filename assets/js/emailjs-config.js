// Configuración de EmailJS para enviar el pedido por correo a HezurAdar.
// Son datos públicos (no secretos): la cuenta gratuita de EmailJS es la que
// realmente envía el correo. Ver instrucciones en el README.md.
// 1. Crea una cuenta gratis en https://www.emailjs.com
// 2. Email Services -> Add new Email Service (conecta tu Gmail) -> copia el "Service ID"
// 3. Email Templates -> Create new Template -> copia el "Template ID"
//    En el asunto puedes usar, por ejemplo: Nuevo pedido {{order_code}} - Hezur&Adar
//    En "To Email" de la plantilla pon: hezuradar@gmail.com
//    Para el CUERPO, para que salga visualmente maquetado (con el envío
//    incluido, en vez de texto plano), cambia a la vista "Code editor" (HTML)
//    y pon únicamente: {{{order_html}}}  (con triple llave, así EmailJS
//    inserta el HTML ya maquetado tal cual, en vez de escaparlo como texto).
//    Variables de texto plano disponibles por si prefieres una plantilla
//    simple en vez de order_html: {{order_code}} {{items_text}} {{subtotal}}
//    {{shipping_cost}} {{total}} {{payment_method}} {{customer_name}}
//    {{customer_phone}} {{customer_email}} {{shipping_address}} {{notes}}
// 4. Account -> General -> copia tu "Public Key"
//
// 5. (Opcional) Email de confirmación al CLIENTE: si el cliente rellena su email al
//    hacer el pedido, se le envía automáticamente un correo con el resumen visual del
//    pedido. Para activarlo:
//    a) Email Templates -> Create new Template (uno nuevo, distinto al del paso 3).
//    b) En "To Email" pon: {{to_email}}
//    c) En el asunto puedes poner algo como: Pedido {{order_code}} confirmado - Hezur&Adar
//    d) En el cuerpo, cambia a la vista "Code editor" (HTML) y pon únicamente: {{{order_html}}}
//       (con triple llave, así EmailJS inserta el HTML ya maquetado tal cual, en vez de
//       escaparlo como texto).
//    e) Guarda y copia el "Template ID" -> pégalo abajo en "customerTemplateId".
//    Si dejas "customerTemplateId" con el valor de ejemplo, esta función se omite sin dar
//    error: el pedido se sigue guardando y avisando por WhatsApp/email al negocio igual.
window.HA_EMAILJS_CONFIG = {
  publicKey: "OJRsbiXiBtTuXI009",
  serviceId: "service_4hsf5zy",
  templateId: "template_vw6xsbu",
  customerTemplateId: "template_ul6jy8a",
  toEmail: "hezuradar@gmail.com",
};

window.HA_EMAILJS_ENABLED = window.HA_EMAILJS_CONFIG.publicKey !== "TU_PUBLIC_KEY";
