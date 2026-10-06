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
    vault: "ha_vault_v2",
    fails: "ha_pin_fails",
    // Formato antiguo (hash SHA-256 del PIN + token en claro): solo se lee para migrarlo.
    legacyPinHash: "ha_pin_hash",
    legacyToken: "ha_gh_token",
  };
  const PRODUCTS_PATH = "data/products.json";

  // El PIN no se guarda en ningún sitio: de él se deriva (PBKDF2) la clave AES-GCM que
  // cifra el token de GitHub. Sin el PIN correcto el token no se puede descifrar, y cada
  // intento cuesta ~0,5 s de cálculo, así que probar PINs a ciegas es muy lento.
  const PIN_MIN_LENGTH = 6;
  const PBKDF2_ITERATIONS = 600000;
  const VAULT_CHECK = "hezuradar-admin";
  const MAX_FREE_ATTEMPTS = 5;
  const IDLE_LOCK_MS = 15 * 60 * 1000;

  let products = [];
  let productsSha = null;
  let editingId = null;
  let pendingFiles = [];
  let currentImages = [];

  // Solo en memoria: se pierden al recargar o cerrar la pestaña.
  let vaultKey = null;
  let vaultSalt = null;
  let ghToken = "";
  let lockMode = "unlock"; // unlock | create | migrate | newpin
  let migratedToken = "";

  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", () => {
    initLock();
    $("gh-owner").value = localStorage.getItem(LS.owner) || "hezuradar";
    $("gh-repo").value = localStorage.getItem(LS.repo) || "hezuradar-web";
    $("gh-branch").value = localStorage.getItem(LS.branch) || "main";

    $("gh-save").addEventListener("click", saveGhConfig);
    $("p-save").addEventListener("click", saveProduct);
    $("p-cancel").addEventListener("click", resetForm);
    $("p-images").addEventListener("change", onFilesSelected);
    $("p-category").addEventListener("change", () => updateSubcategoryOptions(""));
    $("p-filter").addEventListener("input", renderTable);
    $("logout-btn").addEventListener("click", lockPanel);
  });

  /* ---------------- PIN + CIFRADO ---------------- */

  const b64 = {
    enc: (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))),
    dec: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
  };

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function deriveKey(pin, salt, iterations) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: iterations || PBKDF2_ITERATIONS, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function writeVault(token) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify({ check: VAULT_CHECK, token }));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, vaultKey, plain);
    localStorage.setItem(
      LS.vault,
      JSON.stringify({ v: 2, iter: PBKDF2_ITERATIONS, salt: b64.enc(vaultSalt), iv: b64.enc(iv), ct: b64.enc(ct) })
    );
  }

  function readVault() {
    try {
      const v = JSON.parse(localStorage.getItem(LS.vault));
      return v && v.v === 2 && v.salt && v.iv && v.ct ? v : null;
    } catch (e) {
      return null;
    }
  }

  // Devuelve el token si el PIN es correcto; si no, null (AES-GCM no descifra con otra clave).
  async function openVault(pin, vault) {
    const salt = b64.dec(vault.salt);
    const key = await deriveKey(pin, salt, vault.iter);
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(vault.iv) }, key, b64.dec(vault.ct));
      const data = JSON.parse(new TextDecoder().decode(plain));
      if (data.check !== VAULT_CHECK) return null;
      vaultKey = key;
      vaultSalt = salt;
      return String(data.token || "");
    } catch (e) {
      return null;
    }
  }

  async function createVault(pin, token) {
    vaultSalt = crypto.getRandomValues(new Uint8Array(16));
    vaultKey = await deriveKey(pin, vaultSalt);
    await writeVault(token);
    localStorage.removeItem(LS.legacyPinHash);
    localStorage.removeItem(LS.legacyToken);
  }

  // Tras MAX_FREE_ATTEMPTS fallos seguidos, espera creciente: 30 s, 1 min, 2 min... hasta 1 h.
  function readFails() {
    try {
      return JSON.parse(localStorage.getItem(LS.fails)) || { count: 0, until: 0 };
    } catch (e) {
      return { count: 0, until: 0 };
    }
  }
  function registerFail() {
    const f = readFails();
    f.count += 1;
    if (f.count >= MAX_FREE_ATTEMPTS) {
      f.until = Date.now() + Math.min(3600, 30 * 2 ** (f.count - MAX_FREE_ATTEMPTS)) * 1000;
    }
    localStorage.setItem(LS.fails, JSON.stringify(f));
    return f;
  }

  function setLockMode(mode) {
    lockMode = mode;
    const texts = {
      unlock: ["Panel privado", "Introduce tu PIN de acceso.", "Entrar"],
      create: [
        "Crea tu PIN de acceso",
        `Elige un PIN de al menos ${PIN_MIN_LENGTH} caracteres (mejor con letras y números). Con él se cifra tu token de GitHub en este navegador.`,
        "Crear PIN",
      ],
      migrate: ["Panel privado", "Introduce tu PIN actual para pasar al nuevo acceso cifrado.", "Entrar"],
      newpin: [
        "Elige un PIN nuevo",
        `Tu PIN es demasiado corto. Elige uno de al menos ${PIN_MIN_LENGTH} caracteres (mejor con letras y números).`,
        "Guardar PIN",
      ],
    }[mode];
    $("lock-title").textContent = texts[0];
    $("lock-help").textContent = texts[1];
    $("pin-submit").textContent = texts[2];
    const confirming = mode === "create" || mode === "newpin";
    $("pin-confirm").style.display = confirming ? "block" : "none";
    $("pin-input").value = "";
    $("pin-confirm").value = "";
    $("pin-input").autocomplete = confirming ? "new-password" : "current-password";
  }

  function lockMsg(type, msg) {
    $("lock-msg").innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
  }

  function initLock() {
    if (readVault()) setLockMode("unlock");
    else if (localStorage.getItem(LS.legacyPinHash)) setLockMode("migrate");
    else setLockMode("create");
    $("pin-submit").addEventListener("click", onPinSubmit);
    $("pin-input").addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if ($("pin-confirm").style.display === "none") onPinSubmit();
      else $("pin-confirm").focus();
    });
    $("pin-confirm").addEventListener("keydown", (e) => {
      if (e.key === "Enter") onPinSubmit();
    });
    $("pin-reset").addEventListener("click", resetVault);
  }

  function isTrivialPin(pin) {
    return /^(.)\1*$/.test(pin) || "01234567890123456789".includes(pin) || "98765432109876543210".includes(pin);
  }

  let busy = false;
  async function onPinSubmit() {
    if (busy) return;
    const pin = $("pin-input").value;
    if (!pin) return;
    const f = readFails();
    if (f.until > Date.now()) {
      lockMsg("err", `Demasiados intentos fallidos. Espera ${Math.ceil((f.until - Date.now()) / 1000)} s.`);
      return;
    }
    busy = true;
    $("pin-submit").disabled = true;
    lockMsg("info", "Comprobando...");
    try {
      if (lockMode === "create" || lockMode === "newpin") {
        if (pin.length < PIN_MIN_LENGTH) return lockMsg("err", `El PIN debe tener al menos ${PIN_MIN_LENGTH} caracteres.`);
        if (isTrivialPin(pin)) return lockMsg("err", "Ese PIN es demasiado fácil de adivinar.");
        if (pin !== $("pin-confirm").value) return lockMsg("err", "Los dos PIN no coinciden.");
        const token = lockMode === "newpin" ? migratedToken : "";
        await createVault(pin, token);
        migratedToken = "";
        return unlocked(token);
      }

      if (lockMode === "migrate") {
        // El panel antiguo guardaba el hash del PIN sin espacios alrededor.
        if ((await sha256Hex(pin.trim())) !== localStorage.getItem(LS.legacyPinHash)) return failed();
        const token = localStorage.getItem(LS.legacyToken) || "";
        if (pin.length < PIN_MIN_LENGTH || isTrivialPin(pin)) {
          migratedToken = token;
          localStorage.removeItem(LS.fails);
          setLockMode("newpin");
          return lockMsg("", "");
        }
        await createVault(pin, token);
        return unlocked(token);
      }

      const token = await openVault(pin, readVault());
      if (token === null) return failed();
      unlocked(token);
    } catch (e) {
      lockMsg("err", "Error: " + e.message);
    } finally {
      busy = false;
      $("pin-submit").disabled = false;
    }
  }

  function failed() {
    const f = registerFail();
    $("pin-input").value = "";
    const left = MAX_FREE_ATTEMPTS - f.count;
    lockMsg(
      "err",
      left > 0
        ? `PIN incorrecto. Te quedan ${left} intento(s) antes de un bloqueo temporal.`
        : `PIN incorrecto. Bloqueado ${Math.ceil((f.until - Date.now()) / 1000)} s.`
    );
  }

  function unlocked(token) {
    ghToken = token || "";
    localStorage.removeItem(LS.fails);
    lockMsg("", "");
    showShell();
  }

  async function resetVault() {
    const ok = confirm(
      "Se borrarán el PIN y el token de GitHub guardados en este navegador, y se cerrará la sesión de pedidos. " +
        "Tendrás que crear un PIN nuevo y volver a pegar el token. ¿Continuar?"
    );
    if (!ok) return;
    [LS.vault, LS.fails, LS.legacyPinHash, LS.legacyToken].forEach((k) => localStorage.removeItem(k));
    await signOutFirebase();
    location.reload();
  }

  async function signOutFirebase() {
    try {
      if (window.firebase && firebase.apps.length) await firebase.auth().signOut();
    } catch (e) {
      // Sin sesión de Firebase no hay nada que cerrar.
    }
  }

  // Bloquear el panel borra de memoria la clave y el token, y cierra la sesión de pedidos.
  async function lockPanel() {
    vaultKey = null;
    ghToken = "";
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
    $("lock-screen").style.display = "none";
    $("admin-shell").style.display = "block";
    $("logout-btn").style.display = "inline-block";
    $("gh-token").value = ghToken;
    startIdleLock();
    // admin-orders.js y admin-stats.js esperan a esto para conectar con Firebase.
    window.HA_ADMIN_UNLOCKED = true;
    window.dispatchEvent(new Event("ha-admin-unlocked"));
    loadProducts();
  }

  /* ---------------- GITHUB CONFIG ---------------- */

  function ghConfig() {
    return {
      owner: localStorage.getItem(LS.owner) || "hezuradar",
      repo: localStorage.getItem(LS.repo) || "hezuradar-web",
      branch: localStorage.getItem(LS.branch) || "main",
      token: ghToken,
    };
  }

  async function saveGhConfig() {
    if (!vaultKey) {
      setStatus("gh-status", "err", "El panel está bloqueado: vuelve a entrar con tu PIN.");
      return;
    }
    localStorage.setItem(LS.owner, $("gh-owner").value.trim());
    localStorage.setItem(LS.repo, $("gh-repo").value.trim());
    localStorage.setItem(LS.branch, $("gh-branch").value.trim() || "main");
    ghToken = $("gh-token").value.trim();
    try {
      await writeVault(ghToken);
    } catch (e) {
      setStatus("gh-status", "err", "No se pudo cifrar el token: " + e.message);
      return;
    }
    setStatus("gh-status", "ok", "Conexión guardada. El token queda cifrado con tu PIN en este navegador.");
    loadProducts();
  }

  async function ghApi(path, opts) {
    const cfg = ghConfig();
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      throw new Error("Configura primero usuario, repositorio y token de GitHub.");
    }
    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/${path}`;
    const res = await fetch(url, {
      ...opts,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/vnd.github+json",
        ...(opts && opts.headers ? opts.headers : {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async function getFile(path) {
    const cfg = ghConfig();
    try {
      const data = await ghApi(`contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${cfg.branch}`);
      return { sha: data.sha, content: b64DecodeUnicode(data.content) };
    } catch (e) {
      if (String(e.message).includes("404")) return null;
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

  async function loadProducts() {
    const cfg = ghConfig();
    if (!cfg.owner || !cfg.repo || !cfg.token) {
      setStatus("p-status", "info", "Configura la conexión con GitHub para cargar y publicar productos.");
      await loadProductsFromLiveSite();
      return;
    }
    try {
      setStatus("p-status", "info", "Cargando catálogo desde GitHub...");
      const file = await getFile(PRODUCTS_PATH);
      if (file) {
        products = JSON.parse(file.content);
        productsSha = file.sha;
      } else {
        products = [];
        productsSha = null;
      }
      setStatus("p-status", "", "");
      renderTable();
      fillDatalists();
      maybeSuggestSku();
    } catch (e) {
      setStatus("p-status", "err", "Error cargando catálogo desde GitHub: " + e.message);
      // Aunque falle la conexión con GitHub, se intenta rellenar la tabla y los desplegables
      // de categoría/subcategoría con el catálogo público de la web ya publicada, para no
      // dejarlos vacíos mientras se soluciona la conexión.
      await loadProductsFromLiveSite();
    }
  }

  async function loadProductsFromLiveSite() {
    try {
      const res = await fetch(PRODUCTS_PATH + "?v=" + Date.now(), { cache: "no-store" });
      if (res.ok) {
        products = await res.json();
        renderTable();
        fillDatalists();
        maybeSuggestSku();
      }
    } catch (e) {}
  }

  async function putProductsFile(mutate, message) {
    let file = await getFile(PRODUCTS_PATH);
    let next = mutate(file ? JSON.parse(file.content) : []);
    try {
      await putFile(PRODUCTS_PATH, b64EncodeUnicode(JSON.stringify(next, null, 2)), message, file ? file.sha : null);
    } catch (e) {
      if (!String(e.message).includes("409")) throw e;
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
          <button class="small-btn" data-edit="${escapeAttr(p.id)}">Editar</button>
          <button class="small-btn danger" data-del="${escapeAttr(p.id)}">Borrar</button>
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
          <button type="button" class="thumb-remove" data-existing-idx="${i}" title="Quitar imagen">&times;</button>
        </div>`
    );
    const pendingThumbs = pendingFiles.map(
      (f, i) => `
        <div class="thumb-item">
          <img src="${URL.createObjectURL(f)}" alt="">
          <button type="button" class="thumb-remove" data-pending-idx="${i}" title="Quitar imagen">&times;</button>
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
      const price = parseDecimal($("p-price").value);
      if (!title) throw new Error("El título es obligatorio.");
      if (isNaN(price) || price < 0) throw new Error("El precio no es válido. Usa solo números, con coma o punto para los decimales (p.ej. 10,50).");

      const priceTiers = parseTiers($("p-tiers").value);

      const cfg = ghConfig();
      if (!cfg.owner || !cfg.repo || !cfg.token) {
        throw new Error("Configura primero la conexión con GitHub.");
      }

      $("p-save").disabled = true;
      setStatus("p-status", "info", "Publicando...");

      const id = editingId || crypto.randomUUID();
      const existing = editingId ? products.find((x) => x.id === editingId) : null;
      let images = [...currentImages];
      let mainImageDims = null;

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
            /* sin miniatura, se usará la imagen completa */
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
      for (const imgPath of removedImages) {
        try {
          const imgFile = await getFile(imgPath);
          if (imgFile) await deleteFile(imgPath, `Borra imagen quitada de: ${title}`, imgFile.sha);
        } catch (e) {
          /* ignore missing images */
        }
        try {
          const thumbPath = window.HA_TEMPLATE && window.HA_TEMPLATE.thumbPath(imgPath);
          const thumbFile = thumbPath && (await getFile(thumbPath));
          if (thumbFile) await deleteFile(thumbPath, `Borra miniatura quitada de: ${title}`, thumbFile.sha);
        } catch (e) {
          /* ignore missing thumbnails */
        }
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

      setStatus(
        "p-status",
        seoWarning ? "err" : "ok",
        "Publicado correctamente. La web pública (y la página de cada producto) tardará uno o dos minutos en mostrar el cambio: es el tiempo que tarda GitHub Pages en desplegarlo, no hace falta volver a guardar. Si guardas varias veces seguidas, cada guardado se pone en cola y el tiempo total de espera aumenta." + seoWarning
      );
      resetForm();
      await loadProducts();
    } catch (e) {
      setStatus("p-status", "err", e.message);
    } finally {
      $("p-save").disabled = false;
    }
  }

  async function deleteProduct(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    if (!confirm(`¿Borrar "${p.title}" del catálogo? Esta acción se publica de inmediato.`)) return;
    try {
      setStatus("p-status", "info", "Borrando...");
      const updatedProducts = await putProductsFile((current) => current.filter((x) => x.id !== id), `Borra producto: ${p.title}`);

      for (const imgPath of p.images || []) {
        try {
          const imgFile = await getFile(imgPath);
          if (imgFile) await deleteFile(imgPath, `Borra imagen de: ${p.title}`, imgFile.sha);
        } catch (e) {
          /* ignore missing images */
        }
        try {
          const thumbPath = window.HA_TEMPLATE && window.HA_TEMPLATE.thumbPath(imgPath);
          const thumbFile = thumbPath && (await getFile(thumbPath));
          if (thumbFile) await deleteFile(thumbPath, `Borra miniatura de: ${p.title}`, thumbFile.sha);
        } catch (e) {
          /* ignore missing thumbnails */
        }
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

      setStatus("p-status", seoWarning ? "err" : "ok", "Producto borrado y publicado." + seoWarning);
      await loadProducts();
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

  function parseDecimal(raw) {
    const s = String(raw ?? "")
      .trim()
      .replace(/[€\s]/g, "")
      .replace(",", ".");
    return s === "" ? NaN : parseFloat(s);
  }
})();
