(function () {
  "use strict";

  // El SDK de Firebase (~370 KB) solo hace falta al guardar un pedido, así que no se
  // carga con la página: se pide la primera vez que se necesita (o al abrir el checkout,
  // con preload()). Las estadísticas (analytics.js) van por la API REST y no lo usan.
  const SDK_SCRIPTS = [
    "/assets/js/vendor/firebase-app-compat-10.12.2.js",
    "/assets/js/vendor/firebase-firestore-compat-10.12.2.js",
  ];
  const SAVE_TIMEOUT_MS = 15000;
  let sdkPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing && existing.dataset.loaded) return resolve();
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

  function loadSdk() {
    if (window.firebase && window.firebase.firestore) return Promise.resolve();
    if (!sdkPromise) {
      sdkPromise = SDK_SCRIPTS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve()).catch((e) => {
        sdkPromise = null; // se podrá reintentar
        throw e;
      });
    }
    return sdkPromise;
  }

  function preload() {
    if (window.HA_FIREBASE_ENABLED) loadSdk().catch(() => {});
  }

  function getApp() {
    if (!window.HA_FIREBASE_ENABLED) return null;
    if (!window.firebase) return null;
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.HA_FIREBASE_CONFIG);
      return firebase.app();
    } catch (e) {
      console.error("Firebase no se pudo inicializar:", e);
      return null;
    }
  }

  // ID de documento aleatorio (como los de Firestore). Quien guarda el pedido lo
  // reutiliza en los reintentos para que un pedido no pueda quedar duplicado.
  function newOrderId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => chars[b % chars.length]).join("");
  }

  function withTimeout(promise, ms, msg) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(msg);
          err.code = "timeout";
          reject(err);
        }, ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  // Valor de Firestore en formato REST. Los enteros van como integerValue, igual que con el
  // SDK: las reglas exigen `qty is int`.
  function toRestValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === "string") return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toRestValue) } };
    return { mapValue: { fields: toRestFields(v) } };
  }

  function toRestFields(obj) {
    const fields = {};
    Object.keys(obj).forEach((k) => {
      if (obj[k] !== undefined) fields[k] = toRestValue(obj[k]);
    });
    return fields;
  }

  // Mismo guardado que saveOrderSdk pero con una petición HTTPS normal (como analytics.js).
  // Es el respaldo para cuando el SDK no carga o su canal en tiempo real no llega a
  // Firestore (bloqueadores, antivirus, proxies de empresa...): el 16/10/2026 un pedido
  // llegó por email y WhatsApp pero no al panel, con unas reglas que sí lo aceptaban.
  async function saveOrderRest(order, id) {
    const cfg = window.HA_FIREBASE_CONFIG;
    if (!cfg || !window.fetch) throw new Error("La base de datos de pedidos no está disponible ahora mismo.");
    const base = `projects/${cfg.projectId}/databases/(default)/documents`;
    const body = {
      writes: [
        {
          update: { name: `${base}/orders/${id}`, fields: toRestFields(order) },
          updateTransforms: [{ fieldPath: "createdAtServer", setToServerValue: "REQUEST_TIME" }],
          currentDocument: { exists: false },
        },
      ],
    };
    const res = await withTimeout(
      fetch(`https://firestore.googleapis.com/v1/${base}:commit?key=${cfg.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      SAVE_TIMEOUT_MS,
      "La base de datos de pedidos no responde. Revisa tu conexión."
    );
    if (res.ok) return id;
    let status = "";
    try {
      status = ((await res.json()).error || {}).status || "";
    } catch (e) {
      // Respuesta sin JSON: basta con el código HTTP.
    }
    const err = new Error(`Firestore REST ${res.status} ${status}`.trim());
    // Mismos códigos que el SDK, que es lo que mira cart.js.
    err.code = res.status === 403 ? "permission-denied" : status === "ALREADY_EXISTS" || status === "FAILED_PRECONDITION" ? "already-exists" : "rest-" + res.status;
    throw err;
  }

  // Firestore no rechaza un guardado sin conexión: se queda esperando. Por eso hay un
  // límite de tiempo; el error lleva code "timeout" porque el pedido podría llegar igual.
  async function saveOrderSdk(order, id) {
    await withTimeout(loadSdk(), SAVE_TIMEOUT_MS, "No se pudo conectar con la base de datos de pedidos.");
    const app = getApp();
    if (!app) throw new Error("La base de datos de pedidos no está disponible ahora mismo.");
    const db = firebase.firestore();
    await withTimeout(
      db.collection("orders").doc(id).set({
        ...order,
        createdAtServer: firebase.firestore.FieldValue.serverTimestamp(),
      }),
      SAVE_TIMEOUT_MS,
      "La base de datos de pedidos no responde. Revisa tu conexión."
    );
    return id;
  }

  // Primero el SDK; si falla por algo que no sean las reglas, se reintenta por REST con el
  // mismo ID (currentDocument.exists=false impide duplicarlo).
  async function saveOrder(order, opts) {
    const id = (opts && opts.id) || newOrderId();
    if (!window.HA_FIREBASE_ENABLED) throw new Error("La base de datos de pedidos no está configurada todavía.");
    try {
      return await saveOrderSdk(order, id);
    } catch (sdkErr) {
      if (sdkErr && sdkErr.code === "permission-denied") throw sdkErr;
      console.error("Guardado con el SDK fallido, se reintenta por REST:", sdkErr);
      try {
        return await saveOrderRest(order, id);
      } catch (restErr) {
        // Ya existe: el guardado del SDK que se quedó sin respuesta sí llegó. Si el SDK agotó
        // el tiempo, un rechazo de las reglas significa lo mismo (con datos inválidos el SDK
        // habría recibido el rechazo enseguida, no un silencio).
        if (restErr.code === "already-exists") return id;
        if (sdkErr && sdkErr.code === "timeout" && restErr.code === "permission-denied") return id;
        restErr.message = `${restErr.message} (SDK: ${(sdkErr && (sdkErr.code || sdkErr.message)) || "?"})`;
        throw restErr;
      }
    }
  }

  window.HA_DB = { saveOrder, newOrderId, preload };
})();
