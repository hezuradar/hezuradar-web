// Configuración de EmailJS para enviar el pedido por correo a HezurAdar.
// Son datos públicos (no secretos): la cuenta gratuita de EmailJS es la que
// realmente envía el correo. Ver instrucciones en el README.md.
// 1. Crea una cuenta gratis en https://www.emailjs.com
// 2. Email Services -> Add new Email Service (conecta tu Gmail) -> copia el "Service ID"
// 3. Email Templates -> Create new Template -> copia el "Template ID"
//    Usa estas variables en el asunto/cuerpo de la plantilla:
//    {{order_code}} {{items_text}} {{subtotal}} {{customer_name}} {{customer_phone}}
//    {{customer_email}} {{shipping_address}} {{notes}}
//    En "To Email" de la plantilla pon: hezuradar@gmail.com
// 4. Account -> General -> copia tu "Public Key"
window.HA_EMAILJS_CONFIG = {
  publicKey: "TU_PUBLIC_KEY",
  serviceId: "TU_SERVICE_ID",
  templateId: "TU_TEMPLATE_ID",
  toEmail: "hezuradar@gmail.com",
};

window.HA_EMAILJS_ENABLED = window.HA_EMAILJS_CONFIG.publicKey !== "TU_PUBLIC_KEY";
