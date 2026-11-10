// Pantalla de Productos del panel: lógica pura (filtros, avisos, orden de fotos) y el
// resolvedor de imágenes recién subidas. admin.js la usa para pintar la cuadrícula y el
// formulario; aquí no se toca el DOM salvo en attachImages, para poder probarla en Node.
(function () {
  "use strict";

  const LOW_STOCK = 5;

  // "Hueso de búfalo" y "hueso de bufalo" deben encontrarse igual al buscar.
  function normalize(str) {
    return String(str == null ? "" : str)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  }

  /** @returns {"none"|"out"|"low"|"ok"} null = stock sin controlar. */
  function stockState(stock) {
    if (stock == null || stock === "") return "none";
    const n = Number(stock);
    if (!(n > 0)) return "out";
    return n <= LOW_STOCK ? "low" : "ok";
  }

  // Cosas que conviene revisar antes de dar un producto por terminado. Solo avisos: no
  // impiden publicar (el admin decide), pero se ven en la tarjeta y en el formulario.
  function productIssues(p) {
    const issues = [];
    const title = String((p && p.title) || "");
    if (!p || !p.images || !p.images.length) issues.push("Sin fotos");
    if (!String((p && p.description) || "").trim()) issues.push("Sin descripción");
    if (!p || !p.category || p.category === "Otros") issues.push("Sin categoría");
    else if (!p.subcategory) issues.push("Sin subcategoría");
    if (/\s{2,}/.test(title) || title !== title.trim()) issues.push("Espacios de más en el título");
    if (/\d\s*x\s*\d|\dx\b/i.test(title)) issues.push("Medidas con «x» en vez de «×»");
    return issues;
  }

  function skuNum(p) {
    const m = String((p && p.sku) || "").match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  // Primero lo que hay que reponer: sin stock, luego poco stock, luego el resto.
  function stockRank(p) {
    const s = stockState(p.stock);
    if (s === "out") return 0;
    if (s === "low") return 1 + Number(p.stock) / 100;
    if (s === "ok") return 2 + Number(p.stock) / 1e6;
    return 3;
  }

  const SORTS = {
    recent: (a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || skuNum(b) - skuNum(a),
    title: (a, b) => String(a.title || "").localeCompare(String(b.title || ""), "es"),
    priceAsc: (a, b) => Number(a.price) - Number(b.price),
    priceDesc: (a, b) => Number(b.price) - Number(a.price),
    stock: (a, b) => stockRank(a) - stockRank(b),
  };

  /**
   * @param {Array<object>} products
   * @param {{query?: string, category?: string, stock?: string, sort?: string}} opts
   * @returns {Array<object>} copia filtrada y ordenada (no modifica la lista original)
   */
  function filterProducts(products, opts) {
    const o = opts || {};
    const q = normalize(o.query).trim();
    const list = (products || []).filter((p) => {
      if (o.category && p.category !== o.category) return false;
      if (o.stock === "issues" && !productIssues(p).length) return false;
      if (o.stock && o.stock !== "issues" && stockState(p.stock) !== o.stock) return false;
      if (!q) return true;
      const hay = normalize([p.title, p.sku, p.category, p.subcategory].join(" "));
      return q.split(/\s+/).every((word) => hay.includes(word));
    });
    return list.slice().sort(SORTS[o.sort] || SORTS.recent);
  }

  /** Mueve una foto de posición sin mutar el array; la posición 0 es la principal. */
  function moveImage(images, from, to) {
    const list = (images || []).slice();
    if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    return list;
  }

  // Las fotos se publican en GitHub, pero la web (GitHub Pages) tarda uno o dos minutos en
  // servirlas: durante ese rato la ruta relativa da 404 y la miniatura salía rota. El
  // resolvedor recuerda la foto recién subida (en memoria) y, si aun así la web no la tiene,
  // la pide a la API de GitHub con fetchBlob(ruta) -> Promise<Blob|null>.
  function createImageResolver(fetchBlob) {
    const urls = new Map(); // ruta -> blob: URL
    const pending = new Map(); // ruta -> Promise<string|null>
    // Rutas que ni la web ni GitHub tienen: no se vuelven a pedir en cada repintado (p. ej. al
    // escribir en el buscador). Se olvida si luego se sube esa foto (remember) o al recargar.
    const missing = new Set();

    function remember(path, blob) {
      if (!path || !blob || typeof URL === "undefined" || !URL.createObjectURL) return;
      missing.delete(path);
      if (urls.has(path)) URL.revokeObjectURL(urls.get(path));
      urls.set(path, URL.createObjectURL(blob));
    }

    function cached(path) {
      return urls.get(path) || null;
    }

    function fromGithub(path) {
      if (urls.has(path)) return Promise.resolve(urls.get(path));
      if (!pending.has(path)) {
        const p = Promise.resolve()
          .then(() => fetchBlob(path))
          .then((blob) => {
            if (!blob) {
              missing.add(path);
              return null;
            }
            remember(path, blob);
            return urls.get(path);
          })
          .catch(() => null)
          .finally(() => pending.delete(path));
        pending.set(path, p);
      }
      return pending.get(path);
    }

    // Activa las <img data-img-path="..."> de root: blob en memoria si existe, si no la web
    // publicada y, si esa falla, GitHub. Sin foto en ningún sitio, la caja lo indica.
    function attachImages(root) {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll("img[data-img-path]").forEach((img) => {
        const path = img.getAttribute("data-img-path");
        img.removeAttribute("data-img-path");
        const frame = img.closest ? img.closest(".pimg") : null;
        const setState = (state) => {
          if (!frame) return;
          frame.classList.remove("is-loading", "is-missing");
          if (state) frame.classList.add(state);
        };
        setState("is-loading");
        img.addEventListener("load", () => setState(""));
        const hit = cached(path);
        if (hit) {
          img.src = hit;
          return;
        }
        if (missing.has(path)) {
          setState("is-missing");
          return;
        }
        img.addEventListener(
          "error",
          () => {
            fromGithub(path).then((url) => {
              if (url) img.src = url;
              else setState("is-missing");
            });
          },
          { once: true }
        );
        img.src = "/" + String(path).replace(/^\/+/, "");
      });
    }

    return { remember, cached, attachImages };
  }

  /* ---------------- HTML (cadenas; admin.js las inserta y conecta los eventos) ---------------- */

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function formatPrice(n) {
    const v = Number(n);
    return isNaN(v) ? "—" : v.toFixed(2).replace(".", ",") + " €";
  }

  const STOCK_LABEL = { out: "Agotado", low: "Quedan {n}", ok: "{n} en stock", none: "Sin control" };

  function stockBadge(stock) {
    const s = stockState(stock);
    return `<span class="stock-badge stock-${s}">${escapeHtml(STOCK_LABEL[s].replace("{n}", String(stock)))}</span>`;
  }

  // Caja de foto: la <img> no lleva src; attachImages() la resuelve (web, memoria o GitHub).
  function imageBox(path, cls) {
    if (!path) return `<div class="pimg ${cls || ""} is-missing"><span class="pimg-empty">Sin foto</span></div>`;
    return `<div class="pimg ${cls || ""}"><img data-img-path="${escapeHtml(path)}" alt="" decoding="async"><span class="pimg-empty">Sin foto</span></div>`;
  }

  /** Tarjeta de la cuadrícula del panel. */
  function cardHtml(p, opts) {
    const o = opts || {};
    const issues = productIssues(p);
    const imgs = (p.images || []).length;
    const effective = p.discountPercent ? Number(p.price) * (1 - Number(p.discountPercent) / 100) : Number(p.price);
    const cat = [p.category, p.subcategory].filter(Boolean).join(" · ");
    return `
      <article class="pcard${o.highlight ? " just-saved" : ""}${stockState(p.stock) === "out" ? " is-out" : ""}" data-id="${escapeHtml(p.id)}">
        <button type="button" class="pcard-open" data-edit="${escapeHtml(p.id)}" aria-label="Editar ${escapeHtml(p.title)}">
          ${imageBox((p.images || [])[0], "pcard-img")}
          ${imgs > 1 ? `<span class="pcard-photos" aria-hidden="true">${imgs} fotos</span>` : ""}
          ${stockBadge(p.stock)}
        </button>
        <div class="pcard-body">
          <span class="pcard-cat">${escapeHtml(cat || "Sin categoría")}</span>
          <h3 class="pcard-title">${escapeHtml(p.title)}</h3>
          <div class="pcard-price">
            ${p.discountPercent ? `<s>${formatPrice(p.price)}</s> ` : ""}<b>${formatPrice(effective)}</b>
            ${p.discountPercent ? `<span class="discount-tag">-${Number(p.discountPercent) || 0}%</span>` : ""}
            ${p.priceTiers && p.priceTiers.length ? `<span class="pcard-tiers" title="Tiene precios por cantidad">por cantidad</span>` : ""}
          </div>
          ${issues.length ? `<p class="pcard-issues" title="${escapeHtml(issues.join(" · "))}">⚠ ${escapeHtml(issues.join(" · "))}</p>` : ""}
          <div class="pcard-foot">
            <span class="pcard-sku">${escapeHtml(p.sku || "sin SKU")}</span>
            <span class="pcard-actions">
              ${p.slug ? `<a class="icon-btn" href="/productos/${encodeURIComponent(p.slug)}.html" target="_blank" rel="noopener" title="Ver en la web" aria-label="Ver ${escapeHtml(p.title)} en la web">↗</a>` : ""}
              <button type="button" class="icon-btn" data-edit="${escapeHtml(p.id)}" title="Editar" aria-label="Editar ${escapeHtml(p.title)}">✎</button>
              <button type="button" class="icon-btn danger" data-del="${escapeHtml(p.id)}" title="Borrar" aria-label="Borrar ${escapeHtml(p.title)}">🗑</button>
            </span>
          </div>
        </div>
      </article>`;
  }

  /**
   * Fotos del formulario, en el orden en que se publicarán.
   * @param {Array<{kind:"existing",path:string}|{kind:"pending",url:string,name:string}>} items
   */
  function imageTilesHtml(items) {
    if (!items.length) return `<p class="pimg-tiles-empty">Aún no hay fotos.</p>`;
    return items
      .map((it, i) => {
        const img =
          it.kind === "pending"
            ? `<div class="pimg"><img src="${escapeHtml(it.url)}" alt=""></div>`
            : imageBox(it.path, "");
        return `
        <div class="pimg-tile${i === 0 ? " is-main" : ""}">
          ${img}
          ${i === 0 ? `<span class="pimg-main-badge">Principal</span>` : ""}
          ${it.kind === "pending" ? `<span class="pimg-new-badge">Nueva</span>` : ""}
          <div class="pimg-tools">
            <button type="button" class="tile-btn" data-img-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Mover la foto ${i + 1} a la izquierda">‹</button>
            ${i === 0 ? "" : `<button type="button" class="tile-btn" data-img-main="${i}" aria-label="Hacer principal la foto ${i + 1}" title="Hacer principal">★</button>`}
            <button type="button" class="tile-btn" data-img-move="${i}" data-dir="1" ${i === items.length - 1 ? "disabled" : ""} aria-label="Mover la foto ${i + 1} a la derecha">›</button>
            <button type="button" class="tile-btn danger" data-img-remove="${i}" aria-label="Quitar la foto ${i + 1}" title="Quitar">✕</button>
          </div>
        </div>`;
      })
      .join("");
  }

  /** Tarjeta "así se verá en la tienda" con los datos que hay ahora en el formulario. */
  function previewHtml(d) {
    const first = d.image || null;
    const media = !first
      ? `<div class="pimg is-missing"><span class="pimg-empty">Sin foto</span></div>`
      : first.kind === "pending"
        ? `<div class="pimg"><img src="${escapeHtml(first.url)}" alt=""></div>`
        : imageBox(first.path, "");
    const cat = (d.subcategory || d.category || "").toUpperCase();
    return `
      <div class="preview-card">
        ${media}
        <div class="preview-body">
          ${cat ? `<span class="preview-cat">${escapeHtml(cat)}</span>` : ""}
          <span class="preview-title">${escapeHtml(d.title || "Título del producto")}</span>
          <span class="preview-price">${isNaN(d.price) ? "—" : formatPrice(d.price)}${stockState(d.stock) === "out" ? " · Sin stock" : ""}</span>
        </div>
      </div>`;
  }

  window.HA_PRODUCTS_VIEW = {
    LOW_STOCK,
    normalize,
    stockState,
    productIssues,
    filterProducts,
    moveImage,
    createImageResolver,
    cardHtml,
    imageTilesHtml,
    previewHtml,
    formatPrice,
  };
})();
