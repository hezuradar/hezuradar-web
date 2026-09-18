// Registro de visitas y vistas de producto, muy ligero, sobre Firestore: alimenta el
// cuadro de mando de "Estadísticas" en el panel de administración. No usa ningún
// servicio de terceros (nada que pagar ni configurar fuera de Firebase, que ya se usa
// para los pedidos).
(function () {
  "use strict";

  const PAGE_KEYS = {
    "/": "inicio",
    "": "inicio",
    "index.html": "inicio",
    "disenador.html": "placa",
    "disenador-puas.html": "pua",
  };

  function currentPageKey() {
    const file = window.location.pathname.split("/").pop();
    return PAGE_KEYS[file] || PAGE_KEYS[""] || "otra";
  }

  function getApp() {
    if (!window.HA_FIREBASE_ENABLED) return null;
    if (!window.firebase) return null;
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.HA_FIREBASE_CONFIG);
      return firebase.app();
    } catch (e) {
      return null;
    }
  }

  function todayKey() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Las claves de un mapa de Firestore no pueden llevar ".", "/", "[", "]" ni "~".
  function safeKey(str) {
    return String(str || "").replace(/[.\/\[\]~*]/g, "_").slice(0, 120) || "_";
  }

  function bump(fields) {
    const app = getApp();
    if (!app) return;
    try {
      const db = firebase.firestore();
      db.collection("analytics_daily")
        .doc(todayKey())
        .set(
          { ...fields, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        )
        .catch(() => {
          // El registro de estadísticas nunca debe interrumpir la visita del cliente
          // (p.ej. si todavía no se han añadido las reglas de Firestore para esta colección).
        });
    } catch (e) {
      // Igual que arriba: se ignora en silencio.
    }
  }

  function trackPageview() {
    const inc = firebase.firestore && firebase.firestore.FieldValue.increment(1);
    if (!inc) return;
    bump({
      visits: inc,
      pages: { [safeKey(currentPageKey())]: inc },
    });
  }

  function trackProductView(productId, title) {
    if (!productId) return;
    const inc = firebase.firestore && firebase.firestore.FieldValue.increment(1);
    if (!inc) return;
    const key = safeKey(productId);
    bump({
      productViews: { [key]: inc },
      productTitles: { [key]: title || productId },
    });
  }

  window.HA_ANALYTICS = { trackProductView };

  // La visita a la página se registra sola, sin que las demás páginas tengan que llamarla.
  if (document.readyState === "complete" || document.readyState === "interactive") {
    trackPageview();
  } else {
    document.addEventListener("DOMContentLoaded", trackPageview);
  }
})();
