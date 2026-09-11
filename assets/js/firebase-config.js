// Configuración de Firebase para HezurAdar.
// Sustituye estos valores por los de TU proyecto Firebase (son datos públicos,
// no secretos: la seguridad real la dan las reglas de Firestore, ver README.md).
// Pasos para generarlos: https://console.firebase.google.com -> tu proyecto ->
// icono de engranaje -> Configuración del proyecto -> "Tus apps" -> app web (</>).
window.HA_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDHdD-PcTQtaJhbGPegd7aW6ZWiI_EPFuQ",
  authDomain: "hezuradar-web.firebaseapp.com",
  projectId: "hezuradar-web",
  storageBucket: "hezuradar-web.firebasestorage.app",
  messagingSenderId: "917729341748",
  appId: "1:917729341748:web:af91c522c14c190dd23561",
};

// Se activa automáticamente en cuanto rellenes los datos de arriba.
window.HA_FIREBASE_ENABLED = window.HA_FIREBASE_CONFIG.apiKey !== "TU_API_KEY";
