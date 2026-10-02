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
// 5. El email de confirmación al CLIENTE ya no usa EmailJS: lo envía el Apps Script
//    (scripts/drive-export/Code.gs) tras validar reCAPTCHA. Ver README.md, sección 7.
window.HA_EMAILJS_CONFIG = {
  publicKey: "OJRsbiXiBtTuXI009",
  serviceId: "service_4hsf5zy",
  templateId: "template_vw6xsbu",
  toEmail: "hezuradar@gmail.com",
};

window.HA_EMAILJS_ENABLED = window.HA_EMAILJS_CONFIG.publicKey !== "TU_PUBLIC_KEY";
