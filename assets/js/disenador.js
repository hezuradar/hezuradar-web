(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const PLATE_PX = 480;
  const FIT_RATIO = 0.82; // el logo, al ajustarlo, ocupa como mucho este % del lado de la placa
  const MAX_EMBED_BYTES = 700 * 1024; // por encima de esto, no se intenta adjuntar el archivo original al pedido

  const MATERIALS = [
    { id: "madreperla", label: "Resina madre perla", img: "images/site/materials/madreperla.jpg", contrast: "#161616" },
    { id: "negro", label: "Cuerno de buey negro", img: "images/site/materials/negro.jpg", contrast: "#f7f7f5" },
    { id: "ambar", label: "Cuerno de buey ámbar", img: "images/site/materials/ambar.jpg", contrast: "#161616" },
    { id: "blanco", label: "Hueso blanco", img: "images/site/materials/blanco.jpg", contrast: "#161616" },
    { id: "ankola", label: "Cuerno de buey ankola", img: "images/site/materials/ankola.jpg", contrast: "#161616" },
  ];

  function materialById(id) {
    return MATERIALS.find((m) => m.id === id) || MATERIALS[0];
  }

  const state = {
    materialId: "madreperla",
    materialImg: null,
    logoCanvas: null, // canvas recortado y recoloreado (el que se dibuja sobre la placa)
    logoCanvasRaw: null, // canvas recortado SIN recolorear (para poder recalcular al cambiar de material)
    logoFile: null, // { name, type, dataUrl } del archivo original, si es razonable adjuntarlo
    fitPxSize: 0, // tamaño (lado mayor) al que se dibuja el logo con scale=1
    offsetX: 0, // desplazamiento del centro del logo respecto al centro de la placa, en px de plate-canvas
    offsetY: 0,
    scale: 1,
    rotationDeg: 0,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragOffsetStartX: 0,
    dragOffsetStartY: 0,
  };

  const materialImages = {};

  document.addEventListener("DOMContentLoaded", () => {
    renderMaterialSwatches();
    preloadMaterialImages();
    bindEvents();
    drawPlate();
    if (window.pdfjsLib) {
      // El worker se sirve desde el propio dominio (no desde el CDN): un worker de otro origen
      // necesita permisos de red (connect-src) para poder cargarse como blob, y en algunos
      // navegadores eso deja el render() colgado sin avisar. Alojarlo en local es más fiable.
      pdfjsLib.GlobalWorkerOptions.workerSrc = "assets/js/vendor/pdf.worker.min.js";
    }
  });

  function preloadMaterialImages() {
    MATERIALS.forEach((m) => {
      const img = new Image();
      img.src = m.img;
      img.onload = () => {
        materialImages[m.id] = img;
        if (m.id === state.materialId) {
          state.materialImg = img;
          drawPlate();
        }
      };
    });
  }

  function renderMaterialSwatches() {
    $("material-swatches").innerHTML = MATERIALS.map(
      (m) => `
      <button type="button" class="material-swatch${m.id === state.materialId ? " selected" : ""}" data-material="${m.id}" title="${m.label}">
        <img src="${m.img}" alt="">
        <span>${m.label}</span>
      </button>`
    ).join("");
    $("material-swatches").querySelectorAll("[data-material]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.materialId = btn.dataset.material;
        state.materialImg = materialImages[state.materialId] || null;
        $("material-swatches").querySelectorAll(".material-swatch").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        applyContrastColor();
        drawPlate();
      });
    });
  }

  function bindEvents() {
    $("design-file-input").addEventListener("change", onFileSelected);
    $("remove-design-btn").addEventListener("click", removeDesign);
    $("reset-fit-btn").addEventListener("click", () => {
      applyAutoFit();
      drawPlate();
    });

    $("scale-range").addEventListener("input", (e) => {
      state.scale = parseFloat(e.target.value);
      drawPlate();
    });
    document.querySelectorAll("[data-scale]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = parseInt(btn.dataset.scale, 10);
        state.scale = clamp(state.scale + dir * 0.1, 0.2, 3);
        $("scale-range").value = state.scale;
        drawPlate();
      });
    });

    $("rotate-range").addEventListener("input", (e) => {
      state.rotationDeg = parseFloat(e.target.value);
      drawPlate();
    });
    document.querySelectorAll("[data-rotate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = parseInt(btn.dataset.rotate, 10);
        state.rotationDeg = ((state.rotationDeg + dir * 15) % 360 + 360) % 360;
        $("rotate-range").value = state.rotationDeg;
        drawPlate();
      });
    });

    const canvas = $("plate-canvas");
    canvas.addEventListener("pointerdown", (e) => {
      if (!state.logoCanvas) return;
      state.dragging = true;
      const rect = canvas.getBoundingClientRect();
      state.dragStartX = e.clientX - rect.left;
      state.dragStartY = e.clientY - rect.top;
      state.dragOffsetStartX = state.offsetX;
      state.dragOffsetStartY = state.offsetY;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        // En algún navegador/caso puntual la captura del puntero puede fallar; el arrastre sigue
        // funcionando igual mientras el puntero no salga del canvas.
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!state.dragging) return;
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) * (canvas.width / rect.width);
      const py = (e.clientY - rect.top) * (canvas.height / rect.height);
      const startPx = state.dragStartX * (canvas.width / rect.width);
      const startPy = state.dragStartY * (canvas.height / rect.height);
      state.offsetX = state.dragOffsetStartX + (px - startPx);
      state.offsetY = state.dragOffsetStartY + (py - startPy);
      drawPlate();
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
      canvas.addEventListener(ev, () => {
        state.dragging = false;
      })
    );

    $("send-request-btn").addEventListener("click", sendRequest);
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  /* ---------------- CARGA DE ARCHIVOS ---------------- */

  async function onFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    setFileStatus("info", "Procesando " + file.name + "...");
    try {
      let canvas;
      if (ext === "pdf") {
        canvas = await renderPdfFile(file);
      } else if (ext === "dxf") {
        canvas = await renderDxfFile(file);
      } else {
        throw new Error("Formato no admitido. Sube un archivo .pdf o .dxf.");
      }
      canvas = deriveInkMask(canvas);
      canvas = trimCanvas(canvas);
      state.logoCanvasRaw = canvas;
      applyContrastColor();
      state.logoFile = await maybeReadAsEmbeddableFile(file);
      applyAutoFit();
      $("remove-design-btn").style.display = "inline-block";
      $("plate-controls").style.display = "block";
      $("plate-empty-hint").style.display = "none";
      setFileStatus("ok", "Diseño cargado: " + file.name);
      drawPlate();
    } catch (err) {
      console.error(err);
      setFileStatus("err", err.message || "No se pudo procesar el archivo.");
    }
  }

  async function maybeReadAsEmbeddableFile(file) {
    if (file.size > MAX_EMBED_BYTES) return { name: file.name, type: file.type, tooLarge: true };
    const dataUrl = await fileToDataUrl(file);
    return { name: file.name, type: file.type, dataUrl };
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
    ]);
  }

  async function renderPdfFile(file) {
    if (!window.pdfjsLib) throw new Error("No se pudo cargar el lector de PDF. Recarga la página e inténtalo de nuevo.");
    const buf = await file.arrayBuffer();
    const timeoutMsg = "No se ha podido procesar este PDF (ha tardado demasiado). Prueba con otro archivo o con un DXF.";
    const pdf = await withTimeout(pdfjsLib.getDocument({ data: buf }).promise, 20000, timeoutMsg);
    const page = await withTimeout(pdf.getPage(1), 20000, timeoutMsg);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetMax = 900;
    const scale = targetMax / Math.max(baseViewport.width, baseViewport.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    // Sin fondo blanco: se deja transparente para poder recolorear el trazo después (el color
    // de contraste se aplica usando el canal alfa como máscara).
    await withTimeout(page.render({ canvasContext: ctx, viewport }).promise, 20000, timeoutMsg);
    return canvas;
  }

  async function renderDxfFile(file) {
    if (!window.HA_DXF) throw new Error("No se pudo cargar el lector de DXF. Recarga la página e inténtalo de nuevo.");
    const text = await file.text();
    const entities = window.HA_DXF.parseDXF(text);
    if (!entities.length) throw new Error("No se han encontrado formas reconocibles en este DXF (líneas, círculos, arcos o polilíneas).");
    const canvas = window.HA_DXF.renderDxfToCanvas(entities, 900);
    if (!canvas) throw new Error("No se ha podido interpretar la geometría de este DXF.");
    return canvas;
  }

  // pdf.js siempre pinta un fondo opaco (blanco) al renderizar una página, aunque el canvas
  // partiera transparente. Para poder recolorear solo el "trazo" del diseño, se deriva una
  // máscara de opacidad a partir de lo oscuro que es cada píxel: blanco puro pasa a transparente
  // y el negro se queda opaco: así, tanto en PDF como en DXF, solo el dibujo real se recolorea.
  function deriveInkMask(canvas) {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    if (width < 1 || height < 1) return canvas;
    let imgData;
    try {
      imgData = ctx.getImageData(0, 0, width, height);
    } catch (e) {
      return canvas;
    }
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;
      const luminance = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const inkAlpha = Math.round(255 - luminance);
      data[i + 3] = Math.min(a, inkAlpha);
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  // Recolorea el diseño cargado (state.logoCanvasRaw) con el color de contraste del material
  // actual, y lo deja listo en state.logoCanvas para dibujarlo. Se puede llamar tantas veces como
  // se quiera (al cargar el archivo, o cada vez que se cambia de material) porque siempre parte
  // del canvas SIN colorear.
  function applyContrastColor() {
    if (!state.logoCanvasRaw) return;
    const material = materialById(state.materialId);
    state.logoCanvas = recolor(state.logoCanvasRaw, material.contrast);
  }

  // Sustituye el color del dibujo por un color plano, conservando su forma (usa el canal alfa
  // del original como máscara) — así el trazo siempre contrasta con el material de la placa,
  // sea cual sea el color con el que se dibujó originalmente el PDF o el DXF.
  function recolor(canvas, color) {
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(canvas, 0, 0);
    return out;
  }

  // Recorta los márgenes en blanco/transparentes alrededor del contenido real.
  function trimCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    if (width < 2 || height < 2) return canvas;
    let data;
    try {
      data = ctx.getImageData(0, 0, width, height).data;
    } catch (e) {
      return canvas; // por seguridad, si el canvas estuviera "tainted" devolvemos tal cual
    }
    let minX = width,
      minY = height,
      maxX = -1,
      maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const a = data[idx + 3];
        const r = data[idx],
          g = data[idx + 1],
          b = data[idx + 2];
        const isWhite = r > 250 && g > 250 && b > 250;
        if (a > 10 && !isWhite) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return canvas;
    const pad = 6;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d").drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
    return out;
  }

  function applyAutoFit() {
    if (!state.logoCanvas) return;
    const maxDim = Math.max(state.logoCanvas.width, state.logoCanvas.height);
    state.fitPxSize = (PLATE_PX * FIT_RATIO) / maxDim; // factor: px de plate-canvas por px de logoCanvas, a scale=1
    state.offsetX = 0;
    state.offsetY = 0;
    state.scale = 1;
    state.rotationDeg = 0;
    $("scale-range").value = 1;
    $("rotate-range").value = 0;
  }

  function removeDesign() {
    state.logoCanvas = null;
    state.logoCanvasRaw = null;
    state.logoFile = null;
    state.offsetX = 0;
    state.offsetY = 0;
    state.scale = 1;
    state.rotationDeg = 0;
    $("design-file-input").value = "";
    $("remove-design-btn").style.display = "none";
    $("plate-controls").style.display = "none";
    $("plate-empty-hint").style.display = "block";
    setFileStatus("", "");
    drawPlate();
  }

  function setFileStatus(type, msg) {
    $("design-file-status").innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
  }

  /* ---------------- DIBUJO DE LA PLACA ---------------- */

  function drawPlate() {
    const canvas = $("plate-canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const radius = 18;
    ctx.save();
    roundedRectPath(ctx, 0, 0, canvas.width, canvas.height, radius);
    ctx.clip();

    if (state.materialImg) {
      drawCover(ctx, state.materialImg, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "#e7e2da";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (state.logoCanvas) {
      const cx = canvas.width / 2 + state.offsetX;
      const cy = canvas.height / 2 + state.offsetY;
      const maxDim = Math.max(state.logoCanvas.width, state.logoCanvas.height);
      const drawMax = state.fitPxSize * maxDim * state.scale;
      const w = drawMax * (state.logoCanvas.width / maxDim);
      const h = drawMax * (state.logoCanvas.height / maxDim);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((state.rotationDeg * Math.PI) / 180);
      ctx.drawImage(state.logoCanvas, -w / 2, -h / 2, w, h);
      ctx.restore();
    }

    ctx.restore();

    // Borde sutil de la placa
    ctx.save();
    roundedRectPath(ctx, 1, 1, canvas.width - 2, canvas.height - 2, radius);
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCover(ctx, img, targetW, targetH) {
    const imgRatio = img.width / img.height;
    const targetRatio = targetW / targetH;
    let sw, sh, sx, sy;
    if (imgRatio > targetRatio) {
      sh = img.height;
      sw = sh * targetRatio;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = sw / targetRatio;
      sx = 0;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
  }

  /* ---------------- ENVÍO DE LA SOLICITUD ---------------- */

  function genRequestCode() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `HA-DIS-${ymd}-${rand}`;
  }

  async function sendRequest() {
    const name = $("d-name").value.trim();
    const phone = $("d-phone").value.trim();
    const email = $("d-email").value.trim();
    const notes = $("d-notes").value.trim();

    if (!name || !phone) {
      setRequestStatus("err", "Rellena tu nombre y teléfono.");
      return;
    }
    if (!state.logoCanvas) {
      setRequestStatus("err", "Sube primero tu diseño (PDF o DXF).");
      return;
    }

    const btn = $("send-request-btn");
    btn.disabled = true;
    setRequestStatus("info", "Enviando...");

    const material = MATERIALS.find((m) => m.id === state.materialId);
    const snapshot = $("plate-canvas").toDataURL("image/jpeg", 0.85);
    const requestCode = genRequestCode();

    const order = {
      kind: "placa-personalizada",
      orderCode: requestCode,
      createdAt: new Date().toISOString(),
      status: "pendiente",
      customer: { name, phone, email },
      shipping: { address: "", postalCode: "", city: "", province: "", notes },
      items: [{ id: "placa-personalizada-" + material.id, title: `Placa personalizada — ${material.label}`, qty: 1, price: 0 }],
      subtotal: 0,
      material: { id: material.id, label: material.label },
      design: {
        snapshot,
        fileName: (state.logoFile && state.logoFile.name) || "",
        fileType: (state.logoFile && state.logoFile.type) || "",
        fileData: state.logoFile && !state.logoFile.tooLarge ? state.logoFile.dataUrl : null,
        fileTooLargeToEmbed: !!(state.logoFile && state.logoFile.tooLarge),
      },
    };

    try {
      if (window.HA_DB && window.HA_DB.saveOrder) {
        await window.HA_DB.saveOrder(order);
      } else {
        throw new Error("La base de datos no está disponible ahora mismo.");
      }
    } catch (err) {
      console.error("No se pudo guardar la solicitud:", err);
      setRequestStatus("err", "No se pudo enviar: " + err.message);
      btn.disabled = false;
      return;
    }

    try {
      const store = await fetch("data/store.json?v=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
      const phoneShop = (store && store.whatsapp) || "";
      if (phoneShop) {
        const text = buildWhatsAppMessage(order);
        window.open(`https://wa.me/${phoneShop.replace("+", "")}?text=${encodeURIComponent(text)}`, "_blank");
      }
    } catch (err) {
      console.error("No se pudo abrir WhatsApp:", err);
    }

    setRequestStatus(
      "ok",
      `¡Solicitud enviada! Código ${requestCode}. Hemos abierto WhatsApp con el resumen para que nos lo confirmes; te contactaremos con un presupuesto.`
    );
    btn.disabled = false;
  }

  function buildWhatsAppMessage(order) {
    const c = order.customer;
    return [
      `🎨 *Solicitud de placa personalizada ${order.orderCode}*`,
      "",
      `Material: ${order.material.label}`,
      order.design.fileName ? `Archivo: ${order.design.fileName}` : null,
      "",
      `Nombre: ${c.name}`,
      `Teléfono: ${c.phone}`,
      c.email ? `Email: ${c.email}` : null,
      order.shipping.notes ? `Notas: ${order.shipping.notes}` : null,
      "",
      "Adjunto también una captura del diseño ajustado sobre la placa.",
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  function setRequestStatus(type, msg) {
    $("request-status").innerHTML = msg ? `<div class="status-msg ${type}">${escapeHtml(msg)}</div>` : "";
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
})();
