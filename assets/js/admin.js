(function () {
  "use strict";

  // El panel no debe poder cargarse dentro de un iframe de otra web (clickjacking):
  // GitHub Pages no permite enviar la cabecera frame-ancestors, así que se hace aquí.
  if (window.top !== window.self) {
    window.top.location = window.self.location.href;
    return;
  }

  const LS = {
    owner: "ha_gh_owner",
    repo: "ha_gh_repo",
    branch: "ha_gh_branch",
    loginAt: "ha_login_at",
    // Del antiguo bloqueo con PIN: solo se lee una vez para importar el token y luego se borra.
    vault: "ha_vault_v2",
    legacyKeys: ["ha_pin_fails", "ha_pin_hash", "ha_gh_token"],
  };
  const PRODUCTS_PATH = "data/products.json";
  const VAULT_CHECK = "hezuradar-admin";
  const IDLE_LOCK_MS = 15 * 60 * 1000;
  const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
  const RESET_COOLDOWN_MS = 60 * 1000;

  let products = [];
  let productsSha = null;
  let editingId = null;
  let pendingFiles = [];
  let currentImages = [];

  // Solo en memoria: se pierde al recargar o cerrar la pestaña. El token vive en Firestore
  // (adminConfig/github, solo legible por los emails de administrador) y se descarga al entrar.
  let ghToken = "";
  let shellShown = false;
  let entering = false;
  let busy = false;

  const $ = (id) => document.getElementById(id);

  // Algunos navegadores (modo privado, bloqueo de datos del sitio) lanzan error al tocar localStorage:
  // el panel debe seguir funcionando sin él, solo que sin recordar nada entre visitas.
  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  }
  function lsRemove(k) {
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  }


  document.addEventListener("DOMContentLoaded", () => {
    initLock();
    $("gh-owner").value = lsGet(LS.owner) || "hezuradar";
    $("gh-repo").value = lsGet(LS.repo) || "hezuradar-web";
    $("gh-branch").value = lsGet(LS.branch) || "main";

    // Los campos de conexión van en un <form> (el del token es de tipo contraseña): se
    // guarda con el botón o con Intro, sin recargar la página.
    $("gh-form").addEventListener("submit", (e) => {
      e.preventDefault();
      saveGhConfig();
    });
    $("p-save").addEventListener("click", saveProduct);
    $("p-cancel").addEventListener("click", resetForm);
    $("p-images").addEventListener("change", onFilesSelected);
    $("p-category").addEventListener("change", () => updateSubcategoryOptions(""));
    $("p-filter").addEventListener("input", renderTable);
    $("logout-btn").addEventListener("click", lockPanel);
  });

  /* ---------------- LOGIN (Firebase Auth) ---------------- */

  const b64 = {
    dec: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
  };

  function lockMsg(type, msg) {
    $("lock-msg").innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
  }

  function showLogin() {
    $("login-form").style.display = "block";
    $("import-form").style.display = "none";
    $("forgot-password").style.display = "inline-block";
    $("lock-help").textContent = "Entra con tu cuenta de administrador.";
  }

  function initLock() {
    $("login-form").addEventListener("submit", (e) => {
      e.preventDefault();
      onLogin();
    });
    $("import-form").addEventListener("submit", (e) => {
      e.preventDefault();
      onImport();
    });
    $("import-skip").addEventListener("click", () => {
      purgeLegacy();
      finishUnlock("");
    });
    $("forgot-password").addEventListener("click", onForgotPassword);

    if (!window.HA_FIREBASE_ENABLED || !window.firebase) {
      $("login-submit").disabled = true;
      $("forgot-password").disabled = true;
      lockMsg("err", "No se pudo conectar con Firebase: sin él no se puede iniciar sesión. Revisa assets/js/firebase-config.js.");
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(window.HA_FIREBASE_CONFIG);
    const auth = firebase.auth();
    // La sesión se conserva en el dispositivo (hasta SESSION_MAX_MS) para no pedir la
    // contraseña en cada visita, y el navegador del móvil puede autorrellenarla.
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((e) => {
      // Sin almacenamiento local (p.ej. modo privado) la sesión dura lo que la pestaña.
      console.warn("No se pudo guardar la sesión en este dispositivo:", e);
    });
    auth.onAuthStateChanged(onAuthChange);
  }

  async function onAuthChange(user) {
    if (!user) {
      lsRemove(LS.loginAt);
      if (shellShown) location.reload();
      else showLogin();
      return;
    }
    if (shellShown || entering) return;
    const at = Number(lsGet(LS.loginAt)) || 0;
    if (!at) {
      lsSet(LS.loginAt, String(Date.now()));
    } else if (Date.now() - at > SESSION_MAX_MS) {
      await signOutFirebase();
      lockMsg("info", "Tu sesión ha caducado. Vuelve a entrar.");
      return;
    }
    await enterPanel(user);
  }

  function authErrorText(e) {
    switch (e && e.code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
      case "auth/invalid-email":
        return "Email o contraseña incorrectos.";
      case "auth/too-many-requests":
        return "Demasiados intentos. Espera unos minutos o pulsa «He olvidado la contraseña».";
      case "auth/network-request-failed":
        return "Sin conexión. Inténtalo de nuevo.";
      case "auth/user-disabled":
        return "Esta cuenta está desactivada.";
      default:
        return "No se pudo iniciar sesión. Inténtalo de nuevo.";
    }
  }

  async function onLogin() {
    if (busy) return;
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    if (!email || !password) return lockMsg("err", "Escribe tu email y tu contraseña.");
    busy = true;
    $("login-submit").disabled = true;
    lockMsg("info", "Comprobando...");
    lsSet(LS.loginAt, String(Date.now()));
    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
      $("login-password").value = "";
    } catch (e) {
      lsRemove(LS.loginAt);
      lockMsg("err", authErrorText(e));
    } finally {
      busy = false;
      $("login-submit").disabled = false;
    }
  }

  async function onForgotPassword() {
    if (busy) return;
    const email = $("login-email").value.trim();
    if (!email) {
      lockMsg("err", "Escribe primero tu email y vuelve a pulsar «He olvidado la contraseña».");
      $("login-email").focus();
      return;
    }
    busy = true;
    lockMsg("info", "Enviando...");
    const auth = firebase.auth();
    try {
      try {
        await auth.sendPasswordResetEmail(email, { url: location.origin + "/admin.html" });
      } catch (e) {
        // Si el dominio no figura entre los autorizados de Firebase, se envía sin enlace de vuelta.
        if (e && /continue-uri/.test(e.code || "")) await auth.sendPasswordResetEmail(email);
        else throw e;
      }
      sentReset();
    } catch (e) {
      const code = e && e.code;
      if (code === "auth/user-not-found") sentReset(); // misma respuesta exista o no: no se revela qué emails son de administrador
      else if (code === "auth/invalid-email") lockMsg("err", "Ese email no es válido.");
      else if (code === "auth/too-many-requests") lockMsg("err", "Demasiados envíos seguidos. Espera unos minutos.");
      else if (code === "auth/network-request-failed") lockMsg("err", "Sin conexión. Inténtalo de nuevo.");
      else lockMsg("err", "No se pudo enviar el correo. Inténtalo de nuevo en unos minutos.");
    } finally {
      busy = false;
    }
  }

  function sentReset() {
    lockMsg("ok", "Si ese email es de administrador, te hemos enviado un enlace para crear una contraseña nueva. Mira también en spam.");
    const btn = $("forgot-password");
    btn.disabled = true;
    setTimeout(() => (btn.disabled = false), RESET_COOLDOWN_MS);
  }

  async function enterPanel(user) {
    entering = true;
    lockMsg("info", "Entrando...");
    try {
      let token = "";
      let tokenError = "";
      try {
        const snap = await firebase.firestore().collection("adminConfig").doc("github").get();
        if (snap.exists) token = String((snap.data() || {}).token || "");
        else if (readVault()) return showImport();
      } catch (e) {
        if (e && e.code === "permission-denied") {
          await signOutFirebase();
          lockMsg("err", "Esa cuenta no tiene acceso de administrador.");
          return;
        }
        tokenError = "No se pudo leer el token de GitHub guardado en tu cuenta. Recarga la página o pégalo de nuevo.";
      }
      purgeLegacy();
      finishUnlock(token);
      if (tokenError) setStatus("gh-status", "err", tokenError);
    } finally {
      entering = false;
    }
  }

  /* ---------------- IMPORTAR EL TOKEN DEL ANTIGUO PIN ---------------- */

  // Hasta ahora el token de GitHub se guardaba cifrado con un PIN en este navegador. Si todavía
  // está aquí y no hay token en la cuenta, se descifra una sola vez y se sube a la cuenta.
  function readVault() {
    try {
      const v = JSON.parse(lsGet(LS.vault));
      return v && v.v === 2 && v.salt && v.iv && v.ct ? v : null;
    } catch (e) {
      return null;
    }
  }

  // Devuelve el token si el PIN es correcto; si no, null (AES-GCM no descifra con otra clave).
  async function openVault(pin, vault) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64.dec(vault.salt), iterations: vault.iter, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(vault.iv) }, key, b64.dec(vault.ct));
      const data = JSON.parse(new TextDecoder().decode(plain));
      return data.check === VAULT_CHECK ? String(data.token || "") : null;
    } catch (e) {
      return null;
    }
  }

  function purgeLegacy() {
    [LS.vault, ...LS.legacyKeys].forEach((k) => lsRemove(k));
  }

  function showImport() {
    $("login-form").style.display = "none";
    $("import-form").style.display = "block";
    $("forgot-password").style.display = "none";
    $("lock-help").textContent =
      "Tu token de GitHub sigue guardado con el PIN antiguo en este navegador. Escríbelo una vez para pasarlo a tu cuenta y no tener que usar más el PIN.";
    $("import-pin").value = "";
    $("import-pin").focus();
    lockMsg("", "");
  }

  async function onImport() {
    if (busy) return;
    const pin = $("import-pin").value;
    if (!pin) return;
    busy = true;
    $("import-submit").disabled = true;
    lockMsg("info", "Comprobando...");
    try {
      const token = await openVault(pin, readVault());
      if (token === null) return lockMsg("err", "PIN incorrecto.");
      if (token) await saveToken(token, firebase.auth().currentUser.email);
      purgeLegacy();
      finishUnlock(token);
    } catch (e) {
      lockMsg("err", "No se pudo importar el token: " + (e.message || e));
    } finally {
      busy = false;
      $("import-submit").disabled = false;
    }
  }

  async function saveToken(token, email) {
    const ref = firebase.firestore().collection("adminConfig").doc("github");
    if (!token) return ref.delete();
    return ref.set({ token, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: email });
  }

  function finishUnlock(token) {
    ghToken = token || "";
    lockMsg("", "");
    showShell();
  }

  async function signOutFirebase() {
    try {
      if (window.firebase && firebase.apps.length) await firebase.auth().signOut();
    } catch (e) {
      // Sin sesión de Firebase no hay nada que cerrar.
    }
  }

  // Bloquear el panel borra de memoria el token y cierra la sesión.
  async function lockPanel() {
    ghToken = "";
    lsRemove(LS.loginAt);
    await signOutFirebase();
    location.reload();
  }

  function startIdleLock() {
    let idleTimer = null;
    const reset = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(lockPanel, IDLE_LOCK_MS);
    };
    ["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) =>
      document.addEventListener(ev, reset, { passive: true })
    );
    reset();
  }

  function showShell() {
    shellShown = true;
    $("lock-screen").style.display = "none";
    $("admin-shell").style.display = "block";
    $("logout-btn").style.display = "inline-block";
    $("gh-token").value = ghToken;
    startIdleLock();
    // admin-orders.js y admin-stats.js esperan a esto para leer pedidos y estadísticas.
    window.HA_ADMIN_UNLOCKED = true;
    window.dispatchEvent(new Event("ha-admin-unlocked"));
    loadProducts();
  }

  /* ---------------- GITHUB CONFIG ---------------- */

  function ghConfig() {
    return {
      owner: lsGet(LS.owner) || "hezuradar",
      repo: lsGet(LS.repo) || "hezuradar-web",
      branch: lsGet(LS.branch) || "main",
      token: ghToken,
    };
  }

  async function saveGhConfig() {
    const user = window.firebase && firebase.apps.length ? firebase.auth().currentUser : null;
    if (!user) {
      setStatus("gh-status", "err", "La sesión ha caducado: vuelve a entrar.");
      return;
    }
    lsSet(LS.owner, $("gh-owner").value.trim());
    lsSet(LS.repo, $("gh-repo").value.trim());
    lsSet(LS.branch, $("gh-branch").value.trim() || "main");
    const token = $("gh-token").value.trim();
    try {
      await saveToken(token, user.email);
    } catch (e) {
      setStatus("gh-status", "err", "No se pudo guardar el token en tu cuenta: " + e.message);
      return;
    }
    ghToken = token;
    setStatus("gh-status", "ok", "Conexión guardada. El token queda en tu cuenta de administrador y vale en todos tus dispositivos.");
    loadProducts();
  }

  async function ghApi(path, opts) {
    const GH_TIMEOUT_MS = 30000;
    const cfg = ghConfig();
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      throw new Error("Configura primero usuario, repositorio y token de GitHub.");
    }
    const base = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;
    const url = path ? `${base}/${path}` : base;
    // Sin respuesta en GH_TIMEOUT_MS se aborta, para que el panel no se quede "publicando" para siempre.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...opts,
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: "application/vnd.github+json",
          ...(opts && opts.headers ? opts.headers : {}),
        },
      });
      if (!res.ok) {
        const body = await res.text();
        const err = new Error(`GitHub API ${res.status}: ${body.slice(0, 300)}`);
        err.status = res.status;
        throw err;
      }
      return res.status === 204 ? null : await res.json();
    } catch (e) {
      // El abort puede llegar durante la petición o mientras se lee el cuerpo de la respuesta.
      if (e && e.name === "AbortError") {
        throw new Error(`GitHub no ha respondido en ${GH_TIMEOUT_MS / 1000} segundos. Revisa la conexión y vuelve a intentarlo.`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // null solo si GitHub responde 404 a ese archivo. Ojo: GitHub también responde 404 cuando
  // el token no tiene acceso al repositorio (o la rama no existe), así que antes de dar por
  // hecho que un archivo importante no existe hay que llamar a assertRepoAccessible().
  // Un 401/403 (token caducado, sin permisos, límite de peticiones) se lanza como error.
  async function getFile(path) {
    const cfg = ghConfig();
    try {
      const data = await ghApi(`contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(cfg.branch)}`);
      return { sha: data.sha, content: b64DecodeUnicode(data.content) };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  // Comprueba que el token ve el repositorio y la rama configurados.
  async function assertRepoAccessible() {
    const cfg = ghConfig();
    try {
      await ghApi("");
    } catch (e) {
      if (e.status === 404 || e.status === 401 || e.status === 403) {
        throw new Error(
          `GitHub no deja acceder al repositorio ${cfg.owner}/${cfg.repo} con este token (error ${e.status}). ` +
            "Revisa el propietario, el nombre del repositorio y que el token tenga permiso de contenido sobre él."
        );
      }
      throw e;
    }
    try {
      await ghApi(`branches/${encodeURIComponent(cfg.branch)}`);
    } catch (e) {
      if (e.status === 404) throw new Error(`La rama "${cfg.branch}" no existe en ${cfg.owner}/${cfg.repo}.`);
      throw e;
    }
  }

  async function putFile(path, base64Content, message, sha) {
    const cfg = ghConfig();
    return ghApi(`contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: base64Content,
        branch: cfg.branch,
        ...(sha ? { sha } : {}),
      }),
    });
  }

  async function deleteFile(path, message, sha) {
    const cfg = ghConfig();
    return ghApi(`contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, {
      method: "DELETE",
      body: JSON.stringify({ message, sha, branch: cfg.branch }),
    });
  }

  function b64EncodeUnicode(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function b64DecodeUnicode(b64) {
    const binary = atob(b64.replace(/\n/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }

  /* ---------------- PRODUCTS ---------------- */

  // keepStatus: tras publicar o borrar, recarga la tabla sin tapar el mensaje final
  // (que puede llevar avisos de fallos parciales que el admin tiene que leer).
  async function loadProducts(options) {
    const keepStatus = !!(options && options.keepStatus);
    const cfg = ghConfig();
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      if (!keepStatus) setStatus("p-status", "info", "Configura la conexión con GitHub para cargar y publicar productos.");
      await loadProductsFromLiveSite();
      return;
    }
    try {
      if (!keepStatus) setStatus("p-status", "info", "Cargando catálogo desde GitHub...");
      const file = await getFile(PRODUCTS_PATH);
      if (file) {
        products = JSON.parse(file.content);
        productsSha = file.sha;
      } else {
        // Un 404 puede ser falta de acceso al repositorio: no se muestra un catálogo vacío.
        await assertRepoAccessible();
        products = [];
        productsSha = null;
      }
      if (!keepStatus) setStatus("p-status", "", "");
      renderTable();
      fillDatalists();
      maybeSuggestSku();
    } catch (e) {
      // Con keepStatus se conserva el resultado de la publicación y se añade el fallo al recargar.
      const previous = keepStatus ? ($("p-status").textContent || "").trim() : "";
      setStatus("p-status", "err", (previous ? previous + " " : "") + "Error cargando catálogo desde GitHub: " + e.message);
      // Aunque falle la conexión con GitHub, se intenta rellenar la tabla y los desplegables
      // de categoría/subcategoría con el catálogo público de la web ya publicada, para no
      // dejarlos vacíos mientras se soluciona la conexión.
      await loadProductsFromLiveSite();
    }
  }

  async function loadProductsFromLiveSite() {
    try {
      const res = await fetch(PRODUCTS_PATH + "?v=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      products = await res.json();
      renderTable();
      fillDatalists();
      maybeSuggestSku();
    } catch (e) {
      console.warn("No se pudo leer el catálogo publicado:", e);
      $("product-table-body").innerHTML =
        `<tr><td colspan="6" class="empty-state">No se pudo cargar el catálogo publicado (${escapeHtml(e.message)}). Recarga la página para reintentarlo.</td></tr>`;
    }
  }

  async function putProductsFile(mutate, message) {
    let file = await getFile(PRODUCTS_PATH);
    // Sin el archivo se publicaría un catálogo que solo tiene este producto: antes se
    // comprueba que el 404 es de verdad "no existe" y no falta de acceso al repositorio.
    if (!file) await assertRepoAccessible();
    let next = mutate(file ? JSON.parse(file.content) : []);
    try {
      await putFile(PRODUCTS_PATH, b64EncodeUnicode(JSON.stringify(next, null, 2)), message, file ? file.sha : null);
    } catch (e) {
      if (e.status !== 409) throw e;
      // El catálogo cambió justo mientras se publicaba: se reintenta una vez con los datos más recientes.
      file = await getFile(PRODUCTS_PATH);
      next = mutate(file ? JSON.parse(file.content) : []);
      await putFile(PRODUCTS_PATH, b64EncodeUnicode(JSON.stringify(next, null, 2)), message, file ? file.sha : null);
    }
    return next;
  }

  /* ---------------- PÁGINA DE PRODUCTO + SITEMAP (SEO) ---------------- */

  async function publishProductPage(product, allProducts) {
    if (!window.HA_TEMPLATE) throw new Error("No se pudo cargar la plantilla de página de producto.");
    const storeFile = await getFile("data/store.json");
    const store = storeFile ? JSON.parse(storeFile.content) : {};
    const html = window.HA_TEMPLATE.buildProductHtml(product, store, allProducts);
    const pagePath = `productos/${product.slug}.html`;
    const existingPage = await getFile(pagePath);
    await putFile(pagePath, b64EncodeUnicode(html), `Publica página de producto: ${product.title}`, existingPage ? existingPage.sha : null);
  }

  async function deleteProductPage(product) {
    if (!product || !product.slug) return;
    const pagePath = `productos/${product.slug}.html`;
    const existingPage = await getFile(pagePath);
    if (existingPage) await deleteFile(pagePath, `Borra página de producto: ${product.title}`, existingPage.sha);
  }

  // Deja precalculado en index.html el estado inicial "Todo" del catálogo
  // (chips, contador y tarjetas), para que el primer pintado de la portada
  // ya muestre el catálogo real en vez de un grid vacío que main.js rellena
  // después por JavaScript (esa sustitución es la que provocaba el salto de
  // diseño que señalaba PageSpeed). Debe llamarse siempre que cambie
  // data/products.json para que index.html no se quede desincronizado.
  async function publishHomepage(allProducts) {
    if (!window.HA_CATALOG_TEMPLATE) throw new Error("No se pudo cargar la plantilla del catálogo.");
    const page = await getFile("index.html");
    if (!page) throw new Error("No se ha encontrado index.html.");
    const html = window.HA_CATALOG_TEMPLATE.injectHomepageMarkup(page.content, allProducts);
    await putFile("index.html", b64EncodeUnicode(html), "Actualiza el catálogo de la portada", page.sha);
  }

  async function publishSitemap(allProducts) {
    if (!window.HA_TEMPLATE) throw new Error("No se pudo cargar la plantilla de página de producto.");
    const xml = window.HA_TEMPLATE.buildSitemapXml(window.HA_TEMPLATE.sitemapEntries(allProducts));
    const existing = await getFile("sitemap.xml");
    await putFile("sitemap.xml", b64EncodeUnicode(xml), "Actualiza sitemap.xml", existing ? existing.sha : null);
  }

  // Páginas de categoría (/cejuelas.html, ...): solo se suben las que cambian
  // (un producto nuevo, un precio, una foto...), para no crear commits vacíos.
  async function publishCategoryPages(allProducts) {
    if (!window.HA_TEMPLATE) throw new Error("No se pudo cargar la plantilla de página de producto.");
    const storeFile = await getFile("data/store.json");
    const store = storeFile ? JSON.parse(storeFile.content) : {};
    for (const cat of window.HA_TEMPLATE.CATEGORY_PAGES) {
      const html = window.HA_TEMPLATE.buildCategoryHtml(cat, store, allProducts);
      const existing = await getFile(cat.file);
      if (existing && existing.content === html) continue;
      await putFile(cat.file, b64EncodeUnicode(html), `Actualiza la página de categoría: ${cat.name}`, existing ? existing.sha : null);
    }
  }

  let categoryMap = {}; // categoría -> Set de subcategorías ya usadas con ella

  function fillDatalists() {
    categoryMap = {};
    products.forEach((p) => {
      if (!p.category) return;
      if (!categoryMap[p.category]) categoryMap[p.category] = new Set();
      if (p.subcategory) categoryMap[p.category].add(p.subcategory);
    });
    const cats = Object.keys(categoryMap).sort((a, b) => a.localeCompare(b));
    const catSelect = $("p-category");
    const prevCat = catSelect.value;
    catSelect.innerHTML =
      '<option value="">Selecciona categoría</option>' +
      cats.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");
    catSelect.value = cats.includes(prevCat) ? prevCat : "";
    updateSubcategoryOptions();
  }

  // Rellena la subcategoría con solo las que ya se han usado dentro de la categoría elegida.
  // Si se pasa selectedSubcategory se intenta dejarla marcada (usado al cargar un producto
  // para editar); si no, se conserva la que ya estuviera seleccionada cuando siga siendo válida.
  function updateSubcategoryOptions(selectedSubcategory) {
    const cat = $("p-category").value;
    const subSelect = $("p-subcategory");
    const prevSub = selectedSubcategory != null ? selectedSubcategory : subSelect.value;
    const subs = cat && categoryMap[cat] ? Array.from(categoryMap[cat]).sort((a, b) => a.localeCompare(b)) : [];
    subSelect.innerHTML =
      '<option value="">(sin subcategoría)</option>' +
      subs.map((s) => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
    subSelect.value = subs.includes(prevSub) ? prevSub : "";
  }

  function nextSku() {
    const nums = products
      .map((p) => p.sku)
      .filter(Boolean)
      .map((s) => {
        const m = String(s).match(/^RR(\d+)$/);
        return m ? parseInt(m[1], 10) : null;
      })
      .filter((n) => n !== null);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return "RR" + String(next).padStart(4, "0");
  }

  function maybeSuggestSku() {
    if (editingId) return;
    if ($("p-sku").value.trim()) return;
    $("p-sku").value = nextSku();
  }

  function renderTable() {
    const filter = ($("p-filter").value || "").toLowerCase();
    const list = products.filter((p) => p.title.toLowerCase().includes(filter));
    $("p-count").textContent = products.length;
    $("product-table-body").innerHTML = list
      .map(
        (p) => `
      <tr>
        <td><img src="${escapeAttr((p.images && p.images[0]) || "")}" alt=""></td>
        <td>${escapeHtml(p.title)}</td>
        <td>${escapeHtml(p.subcategory || p.category || "")}</td>
        <td>${Number(p.price).toFixed(2)} €${p.discountPercent ? ` <span class="discount-tag">-${Number(p.discountPercent) || 0}%</span>` : ""}</td>
        <td>${p.stock == null ? "-" : Number(p.stock)}</td>
        <td class="row-actions">
          <button type="button" class="small-btn" data-edit="${escapeAttr(p.id)}" aria-label="Editar ${escapeAttr(p.title)}">Editar</button>
          <button type="button" class="small-btn danger" data-del="${escapeAttr(p.id)}" aria-label="Borrar ${escapeAttr(p.title)}">Borrar</button>
        </td>
      </tr>`
      )
      .join("");
    $("product-table-body").querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => editProduct(b.dataset.edit))
    );
    $("product-table-body").querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => deleteProduct(b.dataset.del))
    );
  }

  function editProduct(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    editingId = id;
    pendingFiles = [];
    currentImages = [...(p.images || [])];
    $("form-title").textContent = "Editar producto";
    $("p-title").value = p.title || "";
    $("p-desc").value = p.description || "";
    $("p-price").value = p.price != null ? String(p.price).replace(".", ",") : "";
    $("p-stock").value = p.stock ?? "";
    $("p-discount").value = p.discountPercent ?? "";
    $("p-tiers").value = formatTiers(p.priceTiers);
    $("p-category").value = p.category || "";
    updateSubcategoryOptions(p.subcategory || "");
    $("p-sku").value = p.sku || "";
    $("p-cancel").style.display = "inline-block";
    renderThumbPreview();
    window.scrollTo({ top: $("form-title").offsetTop - 80, behavior: "smooth" });
  }

  function resetForm() {
    editingId = null;
    pendingFiles = [];
    currentImages = [];
    $("form-title").textContent = "Añadir producto";
    ["p-title", "p-desc", "p-price", "p-stock", "p-discount", "p-tiers", "p-sku"].forEach((id) => ($(id).value = ""));
    $("p-category").value = "";
    updateSubcategoryOptions("");
    $("p-images").value = "";
    renderThumbPreview();
    maybeSuggestSku();
    $("p-cancel").style.display = "none";
  }

  function onFilesSelected(e) {
    pendingFiles = Array.from(e.target.files || []);
    renderThumbPreview();
  }

  function renderThumbPreview() {
    const existingThumbs = currentImages.map(
      (src, i) => `
        <div class="thumb-item">
          <img src="${escapeAttr(src)}" alt="">
          <button type="button" class="thumb-remove" data-existing-idx="${i}" title="Quitar imagen" aria-label="Quitar imagen">&times;</button>
        </div>`
    );
    const pendingThumbs = pendingFiles.map(
      (f, i) => `
        <div class="thumb-item">
          <img src="${URL.createObjectURL(f)}" alt="">
          <button type="button" class="thumb-remove" data-pending-idx="${i}" title="Quitar imagen" aria-label="Quitar imagen">&times;</button>
        </div>`
    );
    $("thumb-preview").innerHTML = existingThumbs.join("") + pendingThumbs.join("");
    $("thumb-preview").querySelectorAll("[data-existing-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentImages.splice(parseInt(btn.dataset.existingIdx, 10), 1);
        renderThumbPreview();
      });
    });
    $("thumb-preview").querySelectorAll("[data-pending-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        pendingFiles.splice(parseInt(btn.dataset.pendingIdx, 10), 1);
        renderThumbPreview();
      });
    });
  }

  // Reescala la imagen a maxWidth (via canvas) y la devuelve como JPEG en
  // base64 junto con sus dimensiones finales. Se usa tanto para la miniatura
  // como para la foto principal: una foto de móvil sin reducir (4000 px, 3 MB)
  // hunde la velocidad de carga de la ficha y su posicionamiento.
  function fileToThumbBase64(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.naturalWidth);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("No se pudo generar la imagen reducida."));
            const reader = new FileReader();
            reader.onload = () => resolve({ base64: reader.result.split(",")[1], width: w, height: h });
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          },
          "image/jpeg",
          quality || 0.78
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("No se pudo leer la imagen."));
      };
      img.src = url;
    });
  }

  async function saveProduct() {
    try {
      const title = $("p-title").value.trim();
      // Redondeado a céntimos: "10,499" se guarda como 10.5.
      const price = Math.round(parseDecimal($("p-price").value) * 100) / 100;
      if (!title) throw new Error("El título es obligatorio.");
      if (isNaN(price) || price < 0) throw new Error("El precio no es válido. Usa solo números, con coma o punto para los decimales (p.ej. 10,50).");

      const priceTiers = parseTiers($("p-tiers").value);

      const cfg = ghConfig();
      if (!cfg.owner || !cfg.repo || !cfg.token) {
        throw new Error("Configura primero la conexión con GitHub.");
      }

      $("p-save").disabled = true;
      setStatus("p-status", "info", "Publicando...");

      const id = editingId || newProductId();
      const existing = editingId ? products.find((x) => x.id === editingId) : null;
      let images = [...currentImages];
      let mainImageDims = null;
      // Fallos que no detienen la publicación pero que conviene contar al final.
      const thumbFailures = [];
      const cleanupFailures = [];

      if (pendingFiles.length) {
        setStatus("p-status", "info", `Subiendo ${pendingFiles.length} imagen(es)...`);
        for (let i = 0; i < pendingFiles.length; i++) {
          const file = pendingFiles[i];
          // La foto se publica reducida a 1600 px como máximo y en JPEG.
          const path = `images/products/${id}_${Date.now()}_${i}.jpg`;
          const full = await fileToThumbBase64(file, 1600, 0.85);
          await putFile(path, full.base64, `Sube imagen de producto: ${title}`, null);
          images.push(path);
          if (i === 0 && currentImages.length === 0) mainImageDims = { width: full.width, height: full.height };

          // Miniatura (~500px) para el grid del catálogo y "productos relacionados":
          // si falla, la ficha usará la imagen a tamaño completo hasta el próximo
          // guardado (no es un error que deba interrumpir la publicación).
          try {
            const thumbBase64 = (await fileToThumbBase64(file, 500)).base64;
            const thumbPath = window.HA_TEMPLATE && window.HA_TEMPLATE.thumbPath(path);
            if (thumbPath) await putFile(thumbPath, thumbBase64, `Sube miniatura de producto: ${title}`, null);
          } catch (e) {
            // Sin miniatura se usará la imagen completa; se avisa al final.
            thumbFailures.push(`${file.name || path} (${e.message})`);
          }
        }
      }

      const slug = (existing && existing.slug) || (window.HA_TEMPLATE && window.HA_TEMPLATE.slugFor({ id, title }));

      // Dimensiones reales de la imagen que queda en la posición principal (images[0]),
      // para declarar og:image:width/height sin inventar valores. Si la principal es
      // una foto nueva se leen sus bytes; si es una que ya existía, se reutilizan las
      // que ya se calcularon para ella en un guardado anterior.
      // Dimensiones reales de la imagen principal (images[0]) para declarar
      // og:image:width/height sin inventar valores: si es una foto nueva salen
      // del reescalado; si ya existía, se reutilizan las de un guardado anterior.
      if (currentImages.length > 0 && existing && existing.images && existing.images[0] === currentImages[0] && existing.imageWidth && existing.imageHeight) {
        mainImageDims = { width: existing.imageWidth, height: existing.imageHeight };
      }

      const product = {
        id,
        title,
        description: $("p-desc").value.trim(),
        price,
        sku: $("p-sku").value.trim(),
        category: $("p-category").value.trim() || "Otros",
        subcategory: $("p-subcategory").value.trim() || null,
        stock: $("p-stock").value === "" ? null : parseInt($("p-stock").value, 10),
        discountPercent:
          $("p-discount").value === "" ? null : Math.min(99, Math.max(0, parseInt($("p-discount").value, 10) || 0)),
        priceTiers: priceTiers.length ? priceTiers : undefined,
        images,
        slug,
        imageWidth: mainImageDims ? mainImageDims.width : undefined,
        imageHeight: mainImageDims ? mainImageDims.height : undefined,
        updatedAt: new Date().toISOString().slice(0, 10),
      };

      setStatus("p-status", "info", "Actualizando catálogo...");
      const updatedProducts = await putProductsFile((current) => {
        const idx = current.findIndex((x) => x.id === id);
        if (idx >= 0) current[idx] = product;
        else current.push(product);
        return current;
      }, `${editingId ? "Edita" : "Añade"} producto: ${title}`);

      const removedImages = (existing?.images || []).filter((src) => !images.includes(src));
      // Si una imagen ya no existe, getFile devuelve null y no cuenta como fallo.
      for (const imgPath of removedImages) {
        await deleteImageWithThumb(imgPath, `quitada de: ${title}`, cleanupFailures);
      }

      let seoWarning = "";
      try {
        setStatus("p-status", "info", "Publicando página del producto, portada y sitemap...");
        await publishProductPage(product, updatedProducts);
        await publishHomepage(updatedProducts);
        await publishSitemap(updatedProducts);
        await publishCategoryPages(updatedProducts);
      } catch (e) {
        seoWarning = " Aviso: el catálogo se publicó bien, pero no se pudo actualizar la página SEO del producto o el sitemap (" + e.message + "). Vuelve a guardar el producto para reintentarlo.";
      }

      const extraWarning =
        seoWarning +
        (thumbFailures.length ? ` Aviso: no se pudo subir la miniatura de ${thumbFailures.join(", ")}; la ficha usará la imagen completa hasta el próximo guardado.` : "") +
        imageCleanupWarning(cleanupFailures);

      setStatus(
        "p-status",
        extraWarning ? "err" : "ok",
        "Publicado correctamente. La web pública (y la página de cada producto) tardará uno o dos minutos en mostrar el cambio: es el tiempo que tarda GitHub Pages en desplegarlo, no hace falta volver a guardar. Si guardas varias veces seguidas, cada guardado se pone en cola y el tiempo total de espera aumenta." + extraWarning
      );
      resetForm();
      await loadProducts({ keepStatus: true });
    } catch (e) {
      setStatus("p-status", "err", e.message);
    } finally {
      $("p-save").disabled = false;
    }
  }

  // Borra del repositorio una imagen de producto y su miniatura. No interrumpe la
  // publicación si falla: apunta el fallo en `failures` para avisar al final.
  async function deleteImageWithThumb(imgPath, what, failures) {
    try {
      const imgFile = await getFile(imgPath);
      if (imgFile) await deleteFile(imgPath, `Borra imagen ${what}`, imgFile.sha);
    } catch (e) {
      failures.push(`${imgPath} (${e.message})`);
    }
    const thumbPath = window.HA_TEMPLATE && window.HA_TEMPLATE.thumbPath(imgPath);
    if (!thumbPath) return;
    try {
      const thumbFile = await getFile(thumbPath);
      if (thumbFile) await deleteFile(thumbPath, `Borra miniatura ${what}`, thumbFile.sha);
    } catch (e) {
      failures.push(`${thumbPath} (${e.message})`);
    }
  }

  function imageCleanupWarning(failures) {
    if (!failures.length) return "";
    return ` Aviso: no se pudieron borrar ${failures.length} imagen(es) del repositorio, que quedan sin usar: ${failures.join("; ")}.`;
  }

  // Id de producto nuevo. crypto.randomUUID() no existe antes de iOS 15.4 (ni fuera de
  // HTTPS): en ese caso se monta un UUID v4 con crypto.getRandomValues.
  function newProductId() {
    if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  async function deleteProduct(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    if (!confirm(`¿Borrar "${p.title}" del catálogo? Esta acción se publica de inmediato.`)) return;
    try {
      setStatus("p-status", "info", "Borrando...");
      const updatedProducts = await putProductsFile((current) => current.filter((x) => x.id !== id), `Borra producto: ${p.title}`);

      const cleanupFailures = [];
      for (const imgPath of p.images || []) {
        await deleteImageWithThumb(imgPath, `de: ${p.title}`, cleanupFailures);
      }

      let seoWarning = "";
      try {
        await deleteProductPage(p);
        await publishHomepage(updatedProducts);
        await publishSitemap(updatedProducts);
        await publishCategoryPages(updatedProducts);
      } catch (e) {
        seoWarning = " Aviso: no se pudo borrar la página SEO del producto o actualizar el sitemap (" + e.message + ").";
      }

      const extraWarning = seoWarning + imageCleanupWarning(cleanupFailures);
      setStatus("p-status", extraWarning ? "err" : "ok", "Producto borrado y publicado." + extraWarning);
      await loadProducts({ keepStatus: true });
    } catch (e) {
      setStatus("p-status", "err", e.message);
    }
  }

  /* ---------------- UTIL ---------------- */

  function setStatus(elId, type, msg) {
    const el = $(elId);
    if (!msg) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `<div class="status-msg ${type}">${escapeHtml(msg)}</div>`;
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }
  function escapeAttr(str) {
    return escapeHtml(str);
  }
  // "10=4,15; 20=4,05" -> [{ minQty: 10, price: 4.15 }, { minQty: 20, price: 4.05 }]
  function parseTiers(raw) {
    const text = String(raw || "").trim();
    if (!text) return [];
    const tiers = text.split(";").map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
      const parts = chunk.split("=");
      const minQty = parseInt(parts[0], 10);
      const price = parseDecimal(parts[1]);
      if (parts.length !== 2 || !(minQty > 1) || isNaN(price) || price < 0) {
        throw new Error(`Precio por cantidad no válido: "${chunk}". Usa el formato 10=4,15; 20=4,05`);
      }
      return { minQty, price: Math.round(price * 100) / 100 };
    });
    return tiers.sort((a, b) => a.minQty - b.minQty);
  }

  function formatTiers(tiers) {
    if (!Array.isArray(tiers)) return "";
    return tiers.map((t) => `${t.minQty}=${String(t.price).replace(".", ",")}`).join("; ");
  }

  // "10,50" y "10.50" -> 10.5. Si hay coma y punto, el punto es de miles: "1.234,56" -> 1234.56.
  function parseDecimal(raw) {
    let s = String(raw ?? "")
      .trim()
      .replace(/[€\s]/g, "");
    if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "");
    s = s.replace(",", ".");
    // Number() en vez de parseFloat para rechazar restos como "10,5,3" o "12abc".
    return s === "" ? NaN : Number(s);
  }
})();
