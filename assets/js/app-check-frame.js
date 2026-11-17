// Dentro del iframe invisible assets/app-check-frame.html: consigue el token de App Check con
// reCAPTCHA Enterprise (Fraud Defense) y se lo da a la página que lo contiene
// (assets/js/app-check.js). Solo responde a páginas de la propia web: otra web que incrustara
// este iframe no recibiría nada.
(function () {
  "use strict";

  // Clave de sitio (pública) «hezuradar.com App Check», proyecto hezuradar-web. Es la que
  // está registrada en Firebase → App Check → Apps → HezurAdar Web → Fraud Defense.
  const SITE_KEY = "6Ld1diUuAAAAAHHNgzQKRQoK0b5NObOhW-wZq_Iq";
  const FALLBACK_TTL_MS = 30 * 60 * 1000;

  let appCheck = null;

  function init() {
    if (appCheck) return appCheck;
    const fb = window.firebase;
    if (!window.HA_FIREBASE_ENABLED || !fb || typeof fb.appCheck !== "function") {
      throw new Error("App Check no está disponible.");
    }
    if (!fb.apps.length) fb.initializeApp(window.HA_FIREBASE_CONFIG);
    appCheck = fb.appCheck();
    appCheck.activate(new fb.appCheck.ReCaptchaEnterpriseProvider(SITE_KEY), true);
    return appCheck;
  }

  // Caducidad del token (claim exp del JWT), para que la página sepa cuándo pedir otro.
  function expiryOf(token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.exp) return payload.exp * 1000;
    } catch (e) {
      // Token sin el formato esperado: se usa una caducidad corta.
    }
    return Date.now() + FALLBACK_TTL_MS;
  }

  window.addEventListener("message", async (e) => {
    const msg = e.data;
    if (e.origin !== location.origin || !e.source || !msg || msg.source !== "ha-appcheck" || msg.cmd !== "token") return;
    const reply = (fields) => e.source.postMessage({ source: "ha-appcheck", id: msg.id, ...fields }, location.origin);
    try {
      const res = await init().getToken(!!msg.forceRefresh);
      reply({ token: res.token, expireTimeMillis: expiryOf(res.token) });
    } catch (err) {
      reply({ error: String((err && err.message) || err).slice(0, 200) });
    }
  });
})();
