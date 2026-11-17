// Firebase App Check: demuestra a Firestore que cada escritura sale de hezuradar.com y no de
// un script. El token lo consigue un iframe invisible de la propia web
// (assets/app-check-frame.html) con reCAPTCHA Enterprise (Fraud Defense). Va en un iframe
// porque enterprise.js, cargado en la página, se queda con grecaptcha.render y la casilla
// «No soy un robot» de la cesta y del contacto dejaría de emitir tokens que el Apps Script
// sabe verificar (comprobado el 17/11/2026).
//
// Lo usan:
//  - analytics.js y el guardado por REST de firebase-orders.js: cabecera X-Firebase-AppCheck
//    con HA_APPCHECK.headers().
//  - el SDK de Firestore (cesta, diseñadores y panel): activate() le da los tokens del iframe
//    con el CustomProvider de App Check, y el SDK los añade a cada petición.
// Mientras la obligatoriedad no esté activada en la consola (Firebase → App Check → APIs →
// Cloud Firestore), las peticiones sin token se aceptan: si algo falla aquí, la web funciona
// igual. Con la obligatoriedad activada, sin token Firestore rechaza la escritura.
(function () {
  "use strict";

  const FRAME_SRC = "/assets/app-check-frame.html?v=20261117a";
  const SDK_SCRIPTS = [
    "/assets/js/vendor/firebase-app-compat-10.12.2.js",
    "/assets/js/vendor/firebase-app-check-compat-10.12.2.js",
  ];
  // Un token nuevo tarda entre 0,7 y 7 s (medido en hezuradar.com el 17/11/2026), más la
  // carga del iframe la primera vez. Con la obligatoriedad activada, un token que no llega es
  // un pedido rechazado: mejor esperar de más.
  const TOKEN_TIMEOUT_MS = 25000;
  const REFRESH_MARGIN_MS = 5 * 60 * 1000;

  let frame = null;
  let frameReady = null;
  let seq = 0;
  const pending = new Map();
  let cached = null;
  let sdkPromise = null;
  let activated = false;

  /* ---------------- Iframe que consigue los tokens ---------------- */

  function ensureFrame() {
    if (frameReady) return frameReady;
    frame = document.createElement("iframe");
    frame.src = FRAME_SRC;
    frame.title = "Verificación de seguridad";
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
    frameReady = new Promise((resolve, reject) => {
      frame.addEventListener("load", resolve, { once: true });
      frame.addEventListener("error", () => reject(new Error("No se pudo cargar App Check.")), { once: true });
    });
    (document.body || document.documentElement).appendChild(frame);
    return frameReady;
  }

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
    if (!msg || msg.source !== "ha-appcheck" || !pending.has(msg.id)) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error || !msg.token) p.reject(new Error(msg.error || "Token vacío"));
    else p.resolve({ token: msg.token, expireTimeMillis: Number(msg.expireTimeMillis) || Date.now() + REFRESH_MARGIN_MS });
  });

  async function requestToken(forceRefresh) {
    await ensureFrame();
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("App Check no responde."));
      }, TOKEN_TIMEOUT_MS);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      frame.contentWindow.postMessage({ source: "ha-appcheck", cmd: "token", id, forceRefresh: !!forceRefresh }, location.origin);
    });
  }

  // { token, expireTimeMillis }, reutilizando el último mientras le queden más de 5 minutos.
  // Si ya hay una petición en curso (estadísticas y cesta a la vez), se espera a esa.
  let inFlight = null;
  async function tokenResult(forceRefresh) {
    if (!window.HA_FIREBASE_ENABLED) throw new Error("Firebase no está configurado.");
    if (!forceRefresh && cached && cached.expireTimeMillis - Date.now() > REFRESH_MARGIN_MS) return cached;
    if (!forceRefresh && inFlight) return inFlight;
    const req = requestToken(forceRefresh).then((res) => {
      cached = res;
      return res;
    });
    inFlight = req;
    try {
      return await req;
    } finally {
      if (inFlight === req) inFlight = null;
    }
  }

  // Token para las peticiones REST. Devuelve "" si no se puede conseguir (bloqueador,
  // reCAPTCHA caído...): quien llama manda la petición igual, sin la cabecera.
  async function getToken() {
    try {
      return (await tokenResult(false)).token;
    } catch (e) {
      console.warn("No se pudo obtener el token de App Check:", e);
      return "";
    }
  }

  // Cabeceras para un fetch a Firestore por REST, con el token si lo hay.
  async function headers(base) {
    const token = await getToken();
    return token ? { ...base, "X-Firebase-AppCheck": token } : { ...base };
  }

  /* ---------------- SDK de Firestore (cesta, diseñadores, panel) ---------------- */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing && (existing.dataset.loaded || sdkAlreadyRan(src))) return resolve();
      const sc = existing || document.createElement("script");
      sc.addEventListener("load", () => {
        sc.dataset.loaded = "1";
        resolve();
      });
      sc.addEventListener("error", () => reject(new Error("No se pudo cargar " + src)));
      if (!existing) {
        sc.src = src;
        document.head.appendChild(sc);
      }
    });
  }

  // El panel carga los scripts de Firebase con <script> normales: ya se han ejecutado.
  function sdkAlreadyRan(src) {
    if (!window.firebase) return false;
    return src.indexOf("app-check") === -1 || typeof window.firebase.appCheck === "function";
  }

  // Engancha App Check al SDK de Firebase de la página (una sola vez): el SDK de Firestore
  // que se use después pide los tokens al iframe a través del CustomProvider.
  function activate() {
    if (activated) return true;
    const fb = window.firebase;
    if (!window.HA_FIREBASE_ENABLED || !fb || typeof fb.appCheck !== "function") return false;
    try {
      if (!fb.apps.length) fb.initializeApp(window.HA_FIREBASE_CONFIG);
      fb.appCheck().activate(new fb.appCheck.CustomProvider({ getToken: () => tokenResult(false) }), true);
      activated = true;
    } catch (e) {
      console.warn("App Check no se pudo activar:", e);
    }
    return activated;
  }

  // Carga Firebase App y App Check (31 KB + 23 KB) y activa App Check, antes de que
  // firebase-orders.js cargue Firestore. Pide ya el token en segundo plano: la cesta llama
  // aquí al abrir el pago (HA_DB.preload), y así está listo cuando el cliente confirma.
  function load() {
    if (!window.HA_FIREBASE_ENABLED) return Promise.resolve(false);
    if (!sdkPromise) {
      tokenResult(false).catch(() => {});
      sdkPromise = SDK_SCRIPTS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
        .then(activate)
        .catch((e) => {
          sdkPromise = null; // se podrá reintentar
          console.warn("App Check no disponible:", e);
          return false;
        });
    }
    return sdkPromise;
  }

  window.HA_APPCHECK = { load, activate, getToken, headers };

  // Panel de administración: los scripts de Firebase ya están cargados; se activa ya, antes
  // de que admin-orders.js y compañía empiecen a leer de Firestore.
  if (window.firebase && typeof window.firebase.appCheck === "function") activate();
})();
