(function () {
  "use strict";

  const LS = {
    pinHash: "ha_pin_hash",
    owner: "ha_gh_owner",
    repo: "ha_gh_repo",
    branch: "ha_gh_branch",
    token: "ha_gh_token",
  };
  const SS_UNLOCKED = "ha_unlocked";
  const PRODUCTS_PATH = "data/products.json";

  let products = [];
  let productsSha = null;
  let editingId = null;
  let pendingFiles = [];
  let currentImages = [];

  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", () => {
    initLock();
    $("gh-owner").value = localStorage.getItem(LS.owner) || "hezuradar";
    $("gh-repo").value = localStorage.getItem(LS.repo) || "hezuradar-web";
    $("gh-branch").value = localStorage.getItem(LS.branch) || "main";
    $("gh-token").value = localStorage.getItem(LS.token) || "";

    $("gh-save").addEventListener("click", saveGhConfig);
    $("p-save").addEventListener("click", saveProduct);
    $("p-cancel").addEventListener("click", resetForm);
    $("p-images").addEventListener("change", onFilesSelected);
    $("p-category").addEventListener("change", () => updateSubcategoryOptions(""));
    $("p-filter").addEventListener("input", renderTable);
    $("logout-btn").addEventListener("click", () => {
      sessionStorage.removeItem(SS_UNLOCKED);
      location.reload();
    });

    if (sessionStorage.getItem(SS_UNLOCKED) === "1") {
      showShell();
    }
  });

  /* ---------------- PIN LOCK ---------------- */

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function initLock() {
    const hasPin = !!localStorage.getItem(LS.pinHash);
    $("lock-title").textContent = hasPin ? "Panel privado" : "Crea tu PIN de acceso";
    $("pin-input").placeholder = hasPin ? "••••" : "Elige un PIN nuevo";
    $("pin-submit").textContent = hasPin ? "Entrar" : "Crear PIN";
    $("pin-submit").addEventListener("click", onPinSubmit);
    $("pin-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") onPinSubmit();
    });
  }

  async function onPinSubmit() {
    const val = $("pin-input").value.trim();
    if (!val) return;
    const hasPin = !!localStorage.getItem(LS.pinHash);
    const hash = await sha256(val);
    if (!hasPin) {
      localStorage.setItem(LS.pinHash, hash);
      sessionStorage.setItem(SS_UNLOCKED, "1");
      showShell();
      return;
    }
    if (hash === localStorage.getItem(LS.pinHash)) {
      sessionStorage.setItem(SS_UNLOCKED, "1");
      showShell();
    } else {
      $("lock-msg").innerHTML = '<div class="status-msg err">PIN incorrecto</div>';
      $("pin-input").value = "";
    }
  }

  function showShell() {
    $("lock-screen").style.display = "none";
    $("admin-shell").style.display = "block";
    $("logout-btn").style.display = "inline-block";
    loadProducts();
  }

  /* ---------------- GITHUB CONFIG ---------------- */

  function ghConfig() {
    return {
      owner: localStorage.getItem(LS.owner) || "hezuradar",
      repo: localStorage.getItem(LS.repo) || "hezuradar-web",
      branch: localStorage.getItem(LS.branch) || "main",
      token: localStorage.getItem(LS.token) || "",
    };
  }

  function saveGhConfig() {
    localStorage.setItem(LS.owner, $("gh-owner").value.trim());
    localStorage.setItem(LS.repo, $("gh-repo").value.trim());
    localStorage.setItem(LS.branch, $("gh-branch").value.trim() || "main");
    localStorage.setItem(LS.token, $("gh-token").value.trim());
    setStatus("gh-status", "ok", "Conexión guardada en este navegador.");
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

  async function publishSitemap(allProducts) {
    if (!window.HA_TEMPLATE) throw new Error("No se pudo cargar la plantilla de página de producto.");
    const T = window.HA_TEMPLATE;
    const entries = [
      { loc: T.SITE_URL + "/", changefreq: "weekly", priority: "1.0" },
      { loc: T.SITE_URL + "/disenador.html", changefreq: "monthly", priority: "0.7" },
      { loc: T.SITE_URL + "/disenador-puas.html", changefreq: "monthly", priority: "0.7" },
      { loc: T.SITE_URL + "/guia-hueso-vs-cuerno.html", changefreq: "monthly", priority: "0.5" },
    ].concat(
      allProducts
        .filter((p) => p.slug)
        .map((p) => ({
          loc: T.SITE_URL + "/productos/" + p.slug + ".html",
          changefreq: "weekly",
          priority: "0.6",
          lastmod: p.updatedAt,
        }))
    );
    const xml = T.buildSitemapXml(entries);
    const existing = await getFile("sitemap.xml");
    await putFile("sitemap.xml", b64EncodeUnicode(xml), "Actualiza sitemap.xml", existing ? existing.sha : null);
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
        <td><img src="${(p.images && p.images[0]) || ""}" alt=""></td>
        <td>${escapeHtml(p.title)}</td>
        <td>${escapeHtml(p.subcategory || p.category || "")}</td>
        <td>${Number(p.price).toFixed(2)} €${p.discountPercent ? ` <span class="discount-tag">-${p.discountPercent}%</span>` : ""}</td>
        <td>${p.stock ?? "-"}</td>
        <td class="row-actions">
          <button class="small-btn" data-edit="${p.id}">Editar</button>
          <button class="small-btn danger" data-del="${p.id}">Borrar</button>
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
    ["p-title", "p-desc", "p-price", "p-stock", "p-discount", "p-sku"].forEach((id) => ($(id).value = ""));
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

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function saveProduct() {
    try {
      const title = $("p-title").value.trim();
      const price = parseDecimal($("p-price").value);
      if (!title) throw new Error("El título es obligatorio.");
      if (isNaN(price) || price < 0) throw new Error("El precio no es válido. Usa solo números, con coma o punto para los decimales (p.ej. 10,50).");

      const cfg = ghConfig();
      if (!cfg.owner || !cfg.repo || !cfg.token) {
        throw new Error("Configura primero la conexión con GitHub.");
      }

      $("p-save").disabled = true;
      setStatus("p-status", "info", "Publicando...");

      const id = editingId || crypto.randomUUID();
      const existing = editingId ? products.find((x) => x.id === editingId) : null;
      let images = [...currentImages];

      if (pendingFiles.length) {
        setStatus("p-status", "info", `Subiendo ${pendingFiles.length} imagen(es)...`);
        for (let i = 0; i < pendingFiles.length; i++) {
          const file = pendingFiles[i];
          const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
          const path = `images/products/${id}_${Date.now()}_${i}.${ext}`;
          const base64 = await fileToBase64(file);
          await putFile(path, base64, `Sube imagen de producto: ${title}`, null);
          images.push(path);
        }
      }

      const slug = (existing && existing.slug) || (window.HA_TEMPLATE && window.HA_TEMPLATE.slugFor({ id, title }));

      // Dimensiones reales de la imagen que queda en la posición principal (images[0]),
      // para declarar og:image:width/height sin inventar valores. Si la principal es
      // una foto nueva se leen sus bytes; si es una que ya existía, se reutilizan las
      // que ya se calcularon para ella en un guardado anterior.
      let mainImageDims = null;
      if (currentImages.length > 0) {
        if (existing && existing.images && existing.images[0] === currentImages[0] && existing.imageWidth && existing.imageHeight) {
          mainImageDims = { width: existing.imageWidth, height: existing.imageHeight };
        }
      } else if (pendingFiles.length && window.HA_TEMPLATE) {
        try {
          const bytes = new Uint8Array(await pendingFiles[0].arrayBuffer());
          mainImageDims = window.HA_TEMPLATE.imageDimensionsFromBytes(bytes);
        } catch (e) {
          /* si no se pueden leer, simplemente no se declaran */
        }
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
      }

      let seoWarning = "";
      try {
        setStatus("p-status", "info", "Publicando página del producto y sitemap...");
        await publishProductPage(product, updatedProducts);
        await publishSitemap(updatedProducts);
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
      }

      let seoWarning = "";
      try {
        await deleteProductPage(p);
        await publishSitemap(updatedProducts);
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
  function parseDecimal(raw) {
    const s = String(raw ?? "")
      .trim()
      .replace(/[€\s]/g, "")
      .replace(",", ".");
    return s === "" ? NaN : parseFloat(s);
  }
})();
