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

  // Firestore no rechaza un guardado sin conexión: se queda esperando. Por eso hay un
  // límite de tiempo; el error lleva code "timeout" porque el pedido podría llegar igual.
  async function saveOrder(order, opts) {
    const id = (opts && opts.id) || newOrderId();
    if (!window.HA_FIREBASE_ENABLED) throw new Error("La base de datos de pedidos no está configurada todavía.");
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

  window.HA_DB = { saveOrder, newOrderId, preload };
})();
