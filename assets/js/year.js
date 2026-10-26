(function () {
  "use strict";
  var el = document.getElementById("year");
  if (el) el.textContent = new Date().getFullYear();

  // Contacto por WhatsApp activable desde el panel (whatsappEnabled en data/store.json).
  // Este script va en todas las páginas públicas: si está desactivado, marca <html> con
  // la clase "no-whatsapp" y el CSS oculta botones y enlaces de WhatsApp. El último valor
  // se recuerda en el navegador para aplicarlo antes de que llegue store.json.
  var WA_KEY = "ha_whatsapp_off";
  var root = document.documentElement;

  function applyWhatsapp(off) {
    if (off) root.classList.add("no-whatsapp");
    else root.classList.remove("no-whatsapp");
  }

  try {
    applyWhatsapp(localStorage.getItem(WA_KEY) === "1");
  } catch (e) {}

  window.HA_whatsappEnabled = function () {
    return !root.classList.contains("no-whatsapp");
  };

  if (!window.fetch) return;
  fetch("/data/store.json", { cache: "no-cache" })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (store) {
      if (!store) return;
      var off = store.whatsappEnabled === false;
      applyWhatsapp(off);
      try {
        localStorage.setItem(WA_KEY, off ? "1" : "0");
      } catch (e) {}
    })
    .catch(function () {});
})();
