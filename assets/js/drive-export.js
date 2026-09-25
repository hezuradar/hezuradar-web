(function () {
  "use strict";

  // URL de la aplicación web de Apps Script (scripts/drive-export/Code.gs), la que
  // termina en /exec. Mientras esté vacía no se exporta nada a Drive.
  // Instrucciones: README.md, sección 7.
  const DRIVE_EXPORT_URL =
    "https://script.google.com/macros/s/AKfycbx_pt9xLeoCZuohwVu3ylEFnjOzpx0nzwr1HLWm3sFNFynisApuRvVI-8MkNFKDj9qS/exec";

  // Se manda como text/plain para que sea una petición "simple" sin preflight CORS,
  // que Apps Script no sabe responder. Solo viaja el ID del documento de Firestore:
  // el script lee el pedido por su cuenta.
  async function exportOrder(orderId) {
    if (!DRIVE_EXPORT_URL) throw new Error("La exportación a Drive no está configurada (assets/js/drive-export.js).");
    const res = await fetch(DRIVE_EXPORT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ orderId }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Error desconocido al exportar a Drive.");
    return data;
  }

  // Versión para la página del cliente: no necesita la respuesta y no debe
  // bloquear ni mostrar errores; keepalive la deja terminar aunque se cierre la pestaña.
  function exportOrderInBackground(orderId) {
    if (!DRIVE_EXPORT_URL || !orderId) return;
    fetch(DRIVE_EXPORT_URL, {
      method: "POST",
      mode: "no-cors",
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ orderId }),
    }).catch((e) => console.warn("No se pudo exportar el pedido a Drive:", e));
  }

  window.HA_DRIVE = { enabled: !!DRIVE_EXPORT_URL, exportOrder, exportOrderInBackground };
})();
