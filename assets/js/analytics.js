// Registro de visitas y vistas de producto, muy ligero, sobre Firestore: alimenta el
// cuadro de mando de "Estadísticas" en el panel de administración. No usa ningún
// servicio de terceros (nada que pagar ni configurar fuera de Firebase, que ya se usa
// para los pedidos). Va por la API REST de Firestore con una sola petición, para no
// tener que cargar el SDK de Firebase (~370 KB) en cada visita.
(function () {
  "use strict";

  const PAGE_KEYS = {
    "/": "inicio",
    "": "inicio",
    "index.html": "inicio",
    "disenador.html": "placa",
    "disenador-puas.html": "pua",
    "guia-hueso-vs-cuerno.html": "guia",
  };

  function currentPageKey() {
    const path = window.location.pathname;
    if (path.indexOf("/productos/") === 0) return "producto";
    const file = path.split("/").pop();
    return PAGE_KEYS[file] || "otra";
  }

  function todayKey() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Las claves de un mapa de Firestore no pueden llevar ".", "/", "[", "]" ni "~"; las
  // comillas invertidas y la barra invertida se quitan porque delimitan la ruta del campo.
  function safeKey(str) {
    return String(str || "").replace(/[.\/\[\]~*`\\]/g, "_").slice(0, 120) || "_";
  }

  // Equivale a set({...}, {merge:true}) con FieldValue.increment(1) del SDK: crea el
  // documento del día si no existe y suma 1 a cada contador indicado.
  function bump(counters, setFields) {
    const cfg = window.HA_FIREBASE_CONFIG;
    if (!window.HA_FIREBASE_ENABLED || !cfg || !window.fetch) return;
    const docName = `projects/${cfg.projectId}/databases/(default)/documents/analytics_daily/${todayKey()}`;
    const fields = {};
    const mask = [];
    Object.keys(setFields || {}).forEach((path) => {
      const [map, key] = path.split(".");
      fields[map] = fields[map] || { mapValue: { fields: {} } };
      fields[map].mapValue.fields[key] = { stringValue: String(setFields[path]).slice(0, 200) };
      mask.push(`${map}.\`${key}\``);
    });
    const transforms = counters.map((path) => {
      const [map, key] = path.split(".");
      return { fieldPath: key ? `${map}.\`${key}\`` : map, increment: { integerValue: "1" } };
    });
    transforms.push({ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" });
    const body = {
      writes: [{ update: { name: docName, fields }, updateMask: { fieldPaths: mask }, updateTransforms: transforms }],
    };
    try {
      fetch(
        `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents:commit?key=${cfg.apiKey}`,
        { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      ).catch(() => {
        // El registro de estadísticas nunca debe interrumpir la visita del cliente.
      });
    } catch (e) {
      // Igual que arriba: se ignora en silencio.
    }
  }

  function trackPageview() {
    bump(["visits", "pages." + safeKey(currentPageKey())]);
  }

  function trackProductView(productId, title) {
    if (!productId) return;
    const key = safeKey(productId);
    bump(["productViews." + key], { ["productTitles." + key]: title || productId });
  }

  window.HA_ANALYTICS = { trackProductView };

  // La visita a la página se registra sola, sin que las demás páginas tengan que llamarla.
  if (document.readyState === "complete" || document.readyState === "interactive") {
    trackPageview();
  } else {
    document.addEventListener("DOMContentLoaded", trackPageview);
  }
})();
