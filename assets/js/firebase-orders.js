(function () {
  "use strict";

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

  async function saveOrder(order) {
    const app = getApp();
    if (!app) {
      throw new Error("La base de datos de pedidos no está configurada todavía.");
    }
    const db = firebase.firestore();
    const ref = await db.collection("orders").add({
      ...order,
      createdAtServer: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  }

  window.HA_DB = { saveOrder };
})();
