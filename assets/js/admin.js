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

  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", () => {
    initLock();
    $("gh-owner").value = localStorage.getItem(LS.owner) || "";
    $("gh-repo").value = localStorage.getItem(LS.repo) || "";
    $("gh-branch").value = localStorage.getItem(LS.branch) || "main";
    $("gh-token").value = localStorage.getItem(LS.token) || "";

    $("gh-save").addEventListener("click", saveGhConfig);
    $("p-save").addEventListener("click", saveProduct);
    $("p-cancel").addEventListener("click", resetForm);
    $("p-images").addEventListener("change", onFilesSelected);
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
      owner: localStorage.getItem(LS.owner) || "",
      repo: localStorage.getItem(LS.repo) || "",
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
      try {
        const res = await fetch(PRODUCTS_PATH + "?v=" + Date.now(), { cache: "no-store" });
        if (res.ok) {
          products = await res.json();
          renderTable();
          fillDatalists();
        }
      } catch (e) {}
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
    } catch (e) {
      setStatus("p-status", "err", "Error cargando catálogo: " + e.message);
    }
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
  }

  function fillDatalists() {
    const cats = new Set();
    const subs = new Set();
    products.forEach((p) => {
      if (p.category) cats.add(p.category);
      if (p.subcategory) subs.add(p.subcategory);
    });
    $("cat-list").innerHTML = Array.from(cats).map((c) => `<option value="${escapeAttr(c)}">`).join("");
    $("subcat-list").innerHTML = Array.from(subs).map((c) => `<option value="${escapeAttr(c)}">`).join("");
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
    $("form-title").textContent = "Editar producto";
    $("p-title").value = p.title || "";
    $("p-desc").value = p.description || "";
    $("p-price").value = p.price ?? "";
    $("p-stock").value = p.stock ?? "";
    $("p-discount").value = p.discountPercent ?? "";
    $("p-category").value = p.category || "";
    $("p-subcategory").value = p.subcategory || "";
    $("p-sku").value = p.sku || "";
    $("p-cancel").style.display = "inline-block";
    $("thumb-preview").innerHTML = (p.images || [])
      .map((src) => `<img src="${src}">`)
      .join("");
    window.scrollTo({ top: $("form-title").offsetTop - 80, behavior: "smooth" });
  }

  function resetForm() {
    editingId = null;
    pendingFiles = [];
    $("form-title").textContent = "Añadir producto";
    ["p-title", "p-desc", "p-price", "p-stock", "p-discount", "p-category", "p-subcategory", "p-sku"].forEach(
      (id) => ($(id).value = "")
    );
    $("p-images").value = "";
    $("thumb-preview").innerHTML = "";
    $("p-cancel").style.display = "none";
  }

  function onFilesSelected(e) {
    pendingFiles = Array.from(e.target.files || []);
    const existing = editingId
      ? (products.find((x) => x.id === editingId)?.images || [])
      : [];
    const previews = existing.map((src) => `<img src="${src}">`);
    pendingFiles.forEach((f) => previews.push(`<img src="${URL.createObjectURL(f)}">`));
    $("thumb-preview").innerHTML = previews.join("");
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
      const price = parseFloat($("p-price").value);
      if (!title) throw new Error("El título es obligatorio.");
      if (isNaN(price)) throw new Error("El precio no es válido.");

      const cfg = ghConfig();
      if (!cfg.owner || !cfg.repo || !cfg.token) {
        throw new Error("Configura primero la conexión con GitHub.");
      }

      $("p-save").disabled = true;
      setStatus("p-status", "info", "Publicando...");

      const id = editingId || crypto.randomUUID();
      const existing = editingId ? products.find((x) => x.id === editingId) : null;
      let images = existing ? [...(existing.images || [])] : [];

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
      };

      setStatus("p-status", "info", "Actualizando catálogo...");
      await putProductsFile((current) => {
        const idx = current.findIndex((x) => x.id === id);
        if (idx >= 0) current[idx] = product;
        else current.push(product);
        return current;
      }, `${editingId ? "Edita" : "Añade"} producto: ${title}`);

      setStatus(
        "p-status",
        "ok",
        "Publicado correctamente. La web pública (y la página de cada producto) tardará uno o dos minutos en mostrar el cambio: es el tiempo que tarda GitHub Pages en desplegarlo, no hace falta volver a guardar. Si guardas varias veces seguidas, cada guardado se pone en cola y el tiempo total de espera aumenta."
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
      await putProductsFile((current) => current.filter((x) => x.id !== id), `Borra producto: ${p.title}`);

      for (const imgPath of p.images || []) {
        try {
          const imgFile = await getFile(imgPath);
          if (imgFile) await deleteFile(imgPath, `Borra imagen de: ${p.title}`, imgFile.sha);
        } catch (e) {
          /* ignore missing images */
        }
      }

      setStatus("p-status", "ok", "Producto borrado y publicado.");
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
})();
