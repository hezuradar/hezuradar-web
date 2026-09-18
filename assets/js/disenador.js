(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const PX_PER_MM = 15;
  const FIT_RATIO = 0.82; // el logo, al ajustarlo, ocupa como mucho este % del lado más corto de la placa
  const SIZE_MM_MIN = 5;
  const SIZE_MM_MAX = 80;
  const HARD_MAX_FILE_BYTES = 15 * 1024 * 1024; // por encima de esto ni se intenta leer el archivo (evita colgar el navegador)
  const SAFE_ORDER_BYTES = 950 * 1024; // margen de seguridad bajo el límite de 1 MiB por documento de Firestore

  const DEFAULT_MATERIALS = [
    { id: "madreperla", label: "Resina madre perla", img: "images/site/materials/madreperla.jpg", contrast: "#161616" },
    { id: "negro", label: "Cuerno de buey negro", img: "images/site/materials/negro.jpg", contrast: "#f7f7f5" },
    { id: "ambar", label: "Cuerno de buey ámbar", img: "images/site/materials/ambar.jpg", contrast: "#161616" },
    { id: "blanco", label: "Hueso blanco", img: "images/site/materials/blanco.jpg", contrast: "#161616" },
    { id: "ankola", label: "Cuerno de buey ankola", img: "images/site/materials/ankola.jpg", contrast: "#161616" },
  ];

  // La página que carga este script puede definir window.HA_DESIGNER_CONFIG antes de este
  // <script> para reutilizar el mismo editor con otros materiales, otra forma/medidas de pieza
  // y otro tipo de pedido (por ejemplo, "Personaliza tus púas" solo tiene un material, la
  // pieza tiene forma de púa en vez de placa cuadrada, y guarda kind:"pua-personalizada").
  const DESIGNER_CONFIG = window.HA_DESIGNER_CONFIG || {};
  const MATERIALS = DESIGNER_CONFIG.materials || DEFAULT_MATERIALS;
  const ORDER_KIND = DESIGNER_CONFIG.kind || "placa-personalizada";
  const ITEM_LABEL = DESIGNER_CONFIG.itemLabel || "Placa personalizada";
  const PLATE_SHAPE = DESIGNER_CONFIG.shape || "rect";
  const PLATE_W_MM = DESIGNER_CONFIG.plateWidthMm || 32;
  const PLATE_H_MM = DESIGNER_CONFIG.plateHeightMm || 32;
  const PLATE_W_PX = PLATE_W_MM * PX_PER_MM;
  const PLATE_H_PX = PLATE_H_MM * PX_PER_MM;
  const FIT_BASIS_MM = Math.min(PLATE_W_MM, PLATE_H_MM); // lado más corto: referencia para el ajuste automático
  const MM_PER_FIT_SCALE = FIT_BASIS_MM * FIT_RATIO; // mm reales (lado mayor del logo) a las que corresponde scale=1
  const scaleToMm = (scale) => scale * MM_PER_FIT_SCALE;
  const mmToScale = (mm) => mm / MM_PER_FIT_SCALE;

  function materialById(id) {
    return MATERIALS.find((m) => m.id === id) || MATERIALS[0];
  }

  const state = {
    materialId: MATERIALS[0].id,
    materialImg: null,
    logoCanvas: null, // canvas recortado y recoloreado (el que se dibuja sobre la placa)
    logoCanvasRaw: null, // canvas recortado SIN recolorear (para poder recalcular al cambiar de material)
    logoFile: null, // { name, type, dataUrl } del archivo original, si es razonable adjuntarlo
    fitPxSize: 0, // tamaño (lado mayor) al que se dibuja el logo con scale=1
    dxfPxPerMm: null, // solo para DXF: px de logoCanvas por mm real del dibujo (null si es un PDF)
    offsetX: 0, // desplazamiento del centro del logo respecto al centro de la placa, en px de plate-canvas
    offsetY: 0,
    scale: 1,
    rotationDeg: 0,
    duplicate: null, // { offsetX, offsetY, rotationDeg } de la pieza duplicada, o null si no hay copia
    activePiece: 1, // 1 = pieza original, 2 = copia: a cuál afecta el control "Girar" ahora mismo
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
    renderRulers();
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

  // Regla de referencia alrededor de la placa: marca cada mm real, con ticks más largos y
  // etiqueta cada 5mm. Se genera una sola vez, ya que el tamaño de la placa no cambia.
  function renderRulers() {
    const buildTicks = (totalMm, axis) => {
      const out = [];
      for (let mm = 0; mm <= totalMm; mm++) {
        const isMajor = mm % 5 === 0 || mm === totalMm;
        const pct = (mm / totalMm) * 100;
        const pos = axis === "h" ? `left:${pct}%` : `top:${pct}%`;
        out.push(`<span class="ruler-tick${isMajor ? " major" : ""}" style="${pos}">${isMajor ? `<span>${mm}</span>` : ""}</span>`);
      }
      return out.join("");
    };
    $("ruler-bottom").innerHTML = buildTicks(PLATE_W_MM, "h");
    $("ruler-side").innerHTML = buildTicks(PLATE_H_MM, "v");
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
    $("original-size-btn").addEventListener("click", setOriginalSize);
    $("duplicate-btn").addEventListener("click", duplicatePiece);
    $("remove-duplicate-btn").addEventListener("click", removeDuplicate);

    $("scale-range").addEventListener("input", (e) => {
      state.scale = mmToScale(parseFloat(e.target.value));
      drawPlate();
    });
    document.querySelectorAll("[data-scale]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = parseInt(btn.dataset.scale, 10);
        const mmStep = 2;
        const newMm = clamp(scaleToMm(state.scale) + dir * mmStep, SIZE_MM_MIN, SIZE_MM_MAX);
        state.scale = mmToScale(newMm);
        $("scale-range").value = newMm.toFixed(1);
        drawPlate();
      });
    });

    $("rotate-range").addEventListener("input", (e) => {
      activePieceState().rotationDeg = parseFloat(e.target.value);
      drawPlate();
    });
    document.querySelectorAll("[data-rotate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = parseInt(btn.dataset.rotate, 10);
        const piece = activePieceState();
        piece.rotationDeg = ((piece.rotationDeg + dir * 15) % 360 + 360) % 360;
        $("rotate-range").value = piece.rotationDeg;
        drawPlate();
      });
    });

    const canvas = $("plate-canvas");
    canvas.addEventListener("pointerdown", (e) => {
      if (!state.logoCanvas) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = (e.clientX - rect.left) * (canvas.width / rect.width) - canvas.width / 2;
      const clickY = (e.clientY - rect.top) * (canvas.height / rect.height) - canvas.height / 2;
      // Con dos piezas, se arrastra la que esté más cerca del punto donde se toca.
      if (state.duplicate) {
        const d1 = Math.hypot(clickX - state.offsetX, clickY - state.offsetY);
        const d2 = Math.hypot(clickX - state.duplicate.offsetX, clickY - state.duplicate.offsetY);
        state.activePiece = d2 < d1 ? 2 : 1;
        $("rotate-range").value = activePieceState().rotationDeg;
      }
      const piece = activePieceState();
      state.dragging = true;
      state.dragStartX = e.clientX - rect.left;
      state.dragStartY = e.clientY - rect.top;
      state.dragOffsetStartX = piece.offsetX;
      state.dragOffsetStartY = piece.offsetY;
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
      const piece = activePieceState();
      piece.offsetX = state.dragOffsetStartX + (px - startPx);
      piece.offsetY = state.dragOffsetStartY + (py - startPy);
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
        state.dxfPxPerMm = null;
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
      state.logoFile = await readFileForRequest(file);
      applyAutoFit();
      // Si el archivo trae una escala real conocida (DXF), se muestra directamente a su
      // tamaño real sobre la placa de 32x32mm en vez del ajuste automático al 82%.
      const real = applyRealSize();
      $("remove-design-btn").style.display = "inline-block";
      $("plate-controls").style.display = "block";
      $("plate-empty-hint").style.display = "none";
      setFileStatus(
        "ok",
        real
          ? `Diseño cargado: ${file.name} (a su tamaño real: ${real.mm.toFixed(1)} mm)`
          : "Diseño cargado: " + file.name
      );
      drawPlate();
    } catch (err) {
      console.error(err);
      setFileStatus("err", err.message || "No se pudo procesar el archivo.");
    }
  }

  async function readFileForRequest(file) {
    if (file.size > HARD_MAX_FILE_BYTES) return { name: file.name, type: file.type, tooLarge: true };
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
    const targetMax = 900;
    const canvas = window.HA_DXF.renderDxfToCanvas(entities, targetMax);
    if (!canvas) throw new Error("No se ha podido interpretar la geometría de este DXF.");
    // Se asume que el DXF está dibujado en milímetros reales (lo habitual en archivos para
    // corte/grabado láser), para poder ofrecer luego el botón "Tamaño original".
    const bounds = window.HA_DXF.computeBounds(entities);
    const boundsW = bounds ? bounds.maxX - bounds.minX : 0;
    const boundsH = bounds ? bounds.maxY - bounds.minY : 0;
    state.dxfPxPerMm = bounds && Math.max(boundsW, boundsH) > 0 ? targetMax / Math.max(boundsW, boundsH) : null;
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
    const fitBasisPx = Math.min(PLATE_W_PX, PLATE_H_PX);
    state.fitPxSize = (fitBasisPx * FIT_RATIO) / maxDim; // factor: px de plate-canvas por px de logoCanvas, a scale=1
    state.offsetX = 0;
    state.offsetY = 0;
    state.scale = 1;
    state.rotationDeg = 0;
    $("scale-range").value = MM_PER_FIT_SCALE.toFixed(1);
    $("rotate-range").value = 0;
    removeDuplicate();
  }

  // Devuelve el objeto de estado (offsetX/offsetY/rotationDeg) de la pieza que deba moverse o
  // girarse ahora mismo: la copia si existe y está activa, o la pieza original en cualquier
  // otro caso.
  function activePieceState() {
    return state.activePiece === 2 && state.duplicate ? state.duplicate : state;
  }

  // Crea una copia de la pieza cargada, con el mismo tamaño (que queda bloqueado mientras
  // exista la copia) y un pequeño desplazamiento para que se vean como dos piezas distintas.
  function duplicatePiece() {
    if (!state.logoCanvas || state.duplicate) return;
    const shift = 40;
    state.duplicate = {
      offsetX: state.offsetX + shift,
      offsetY: state.offsetY + shift,
      rotationDeg: state.rotationDeg,
    };
    state.activePiece = 2;
    $("rotate-range").value = state.duplicate.rotationDeg;
    setSizeControlsDisabled(true);
    $("duplicate-btn").style.display = "none";
    $("remove-duplicate-btn").style.display = "inline-block";
    $("duplicate-hint").style.display = "block";
    drawPlate();
  }

  // Quita la copia y devuelve los controles de tamaño a su estado normal.
  function removeDuplicate() {
    state.duplicate = null;
    state.activePiece = 1;
    $("rotate-range").value = state.rotationDeg;
    setSizeControlsDisabled(false);
    $("duplicate-btn").style.display = "inline-block";
    $("remove-duplicate-btn").style.display = "none";
    $("duplicate-hint").style.display = "none";
    drawPlate();
  }

  function setSizeControlsDisabled(disabled) {
    $("scale-range").disabled = disabled;
    $("original-size-btn").disabled = disabled;
    document.querySelectorAll("[data-scale]").forEach((btn) => (btn.disabled = disabled));
  }

  // Calcula (sin aplicar) el "scale" y los mm reales a los que correspondería el logo, a partir
  // de las medidas del DXF cargado (ver renderDxfFile). Devuelve null si no hay esa información
  // (por ejemplo, un PDF, que no tiene una escala física fiable).
  // 1 mm de plate-canvas equivale a PX_PER_MM px; 1 mm del DXF equivale a dxfPxPerMm px
  // de logoCanvas. A partir de ahí se despeja el "scale" que reproduce ese tamaño real.
  function computeRealSize() {
    if (!state.logoCanvas || !state.fitPxSize || !state.dxfPxPerMm) return null;
    const rawScale = PX_PER_MM / (state.dxfPxPerMm * state.fitPxSize);
    const clampedScale = clamp(rawScale, mmToScale(SIZE_MM_MIN), mmToScale(SIZE_MM_MAX));
    return { clampedScale, mm: scaleToMm(clampedScale), clipped: Math.abs(clampedScale - rawScale) > 0.001 };
  }

  // Aplica el tamaño real calculado por computeRealSize (si lo hay) al estado y al control de
  // tamaño, sin redibujar ni tocar el mensaje de estado (lo decide quien la llama).
  function applyRealSize() {
    const real = computeRealSize();
    if (!real) return null;
    state.scale = real.clampedScale;
    $("scale-range").value = real.mm.toFixed(1);
    return real;
  }

  // Botón "Tamaño original": pone el logo a su tamaño real en mm (solo disponible para DXF).
  function setOriginalSize() {
    if (!state.logoCanvas || !state.fitPxSize) return;
    const real = applyRealSize();
    if (!real) {
      setFileStatus("err", "El tamaño real solo se puede calcular para archivos DXF (en PDF no hay una escala fiable).");
      return;
    }
    drawPlate();
    if (real.clipped) {
      setFileStatus("info", "El tamaño real del diseño se sale del rango de ajuste permitido, se ha dejado en el máximo posible.");
    } else {
      setFileStatus("ok", "Diseño a su tamaño real (según las medidas del DXF).");
    }
  }

  function removeDesign() {
    state.logoCanvas = null;
    state.logoCanvasRaw = null;
    state.logoFile = null;
    state.dxfPxPerMm = null;
    state.offsetX = 0;
    state.offsetY = 0;
    state.scale = 1;
    state.rotationDeg = 0;
    removeDuplicate();
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

    ctx.save();
    platePath(ctx, 0, 0, canvas.width, canvas.height);
    ctx.clip();

    if (state.materialImg) {
      drawCover(ctx, state.materialImg, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "#e7e2da";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const logoGeoms = [];
    if (state.logoCanvas) {
      const pieces = [{ offsetX: state.offsetX, offsetY: state.offsetY, rotationDeg: state.rotationDeg }];
      if (state.duplicate) pieces.push(state.duplicate);
      const maxDim = Math.max(state.logoCanvas.width, state.logoCanvas.height);
      const drawMax = state.fitPxSize * maxDim * state.scale;
      const w = drawMax * (state.logoCanvas.width / maxDim);
      const h = drawMax * (state.logoCanvas.height / maxDim);
      pieces.forEach((piece) => {
        const cx = canvas.width / 2 + piece.offsetX;
        const cy = canvas.height / 2 + piece.offsetY;
        const angleRad = (piece.rotationDeg * Math.PI) / 180;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angleRad);
        ctx.drawImage(state.logoCanvas, -w / 2, -h / 2, w, h);
        ctx.restore();
        logoGeoms.push({ cx, cy, w, h, angleRad });
      });
    }

    ctx.restore();

    // Borde sutil de la placa
    ctx.save();
    platePath(ctx, 1, 1, canvas.width - 2, canvas.height - 2);
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    logoGeoms.forEach((g) => drawDimensions(ctx, g));
  }

  // Cotas del diseño cargado: dos líneas con topes y una etiqueta en mm, siguiendo el
  // rectángulo (ya girado) que ocupa el logo sobre la placa. Sirven de referencia de tamaño
  // mientras se mueve, agranda o gira el diseño.
  function drawDimensions(ctx, { cx, cy, w, h, angleRad }) {
    const hw = w / 2,
      hh = h / 2;
    const corners = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ].map(([x, y]) => [cx + x * Math.cos(angleRad) - y * Math.sin(angleRad), cy + x * Math.sin(angleRad) + y * Math.cos(angleRad)]);
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs);
    const minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const widthMm = (maxX - minX) / PX_PER_MM;
    const heightMm = (maxY - minY) / PX_PER_MM;

    const dimColor = materialById(state.materialId).contrast;
    ctx.save();
    ctx.strokeStyle = dimColor;
    ctx.fillStyle = dimColor;
    ctx.lineWidth = 1;
    ctx.font = "600 14px Inter, sans-serif";
    ctx.textAlign = "center";

    // Las líneas se colocan preferentemente debajo/a la derecha del diseño, pero si ahí no
    // hay hueco (el diseño llega casi al borde de la placa) se pasan al otro lado, para que
    // el número siempre quede visible dentro de la placa y no se corte.
    const margin = 12;
    const labelGap = 5;
    const textH = 14;
    const edgePad = 4;
    const needed = margin + labelGap + textH + edgePad;

    const widthLabel = widthMm.toFixed(1) + " mm";
    const widthLabelW = ctx.measureText(widthLabel).width;
    let hy, hLabelY;
    if (PLATE_H_PX - maxY >= needed) {
      hy = maxY + margin;
      ctx.textBaseline = "top";
      hLabelY = hy + labelGap;
    } else if (minY >= needed) {
      hy = minY - margin;
      ctx.textBaseline = "bottom";
      hLabelY = hy - labelGap;
    } else {
      hy = clamp(maxY + margin, edgePad, PLATE_H_PX - textH - edgePad);
      ctx.textBaseline = "top";
      hLabelY = hy + labelGap;
    }
    // Pegada al extremo izquierdo de la línea (no centrada), con un pequeño margen interior.
    const hLabelX = clamp(minX + widthLabelW / 2 + 6, widthLabelW / 2 + edgePad, PLATE_W_PX - widthLabelW / 2 - edgePad);
    drawDimLine(ctx, minX, hy, maxX, hy, true);
    ctx.fillText(widthLabel, hLabelX, hLabelY);

    const heightLabel = heightMm.toFixed(1) + " mm";
    const heightLabelW = ctx.measureText(heightLabel).width;
    let vx, vSide;
    if (PLATE_W_PX - maxX >= needed) {
      vx = maxX + margin;
      vSide = 1;
    } else if (minX >= needed) {
      vx = minX - margin;
      vSide = -1;
    } else {
      vx = clamp(maxX + margin, edgePad, PLATE_W_PX - textH - edgePad);
      vSide = 1;
    }
    // Pegada al extremo superior de la línea (no centrada), con un pequeño margen interior.
    const vLabelY = clamp(minY + heightLabelW / 2 + 6, heightLabelW / 2 + edgePad, PLATE_H_PX - heightLabelW / 2 - edgePad);
    drawDimLine(ctx, vx, minY, vx, maxY, false);
    ctx.save();
    ctx.translate(vx + vSide * labelGap, vLabelY);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = vSide === 1 ? "bottom" : "top";
    ctx.fillText(heightLabel, 0, 0);
    ctx.restore();

    ctx.restore();
  }

  function drawDimLine(ctx, x1, y1, x2, y2, horizontal) {
    const tick = 5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(x1, y1 - tick);
      ctx.lineTo(x1, y1 + tick);
      ctx.moveTo(x2, y2 - tick);
      ctx.lineTo(x2, y2 + tick);
    } else {
      ctx.moveTo(x1 - tick, y1);
      ctx.lineTo(x1 + tick, y1);
      ctx.moveTo(x2 - tick, y2);
      ctx.lineTo(x2 + tick, y2);
    }
    ctx.stroke();
  }

  // Contorno de la pieza sobre la que se dibuja el material: un rectángulo redondeado (placas)
  // o la silueta de una púa (DESIGNER_CONFIG.shape === "pick"), según la página.
  function platePath(ctx, x, y, w, h) {
    if (PLATE_SHAPE === "pick") {
      pickShapePath(ctx, x, y, w, h);
    } else {
      roundedRectPath(ctx, x, y, w, h, 18);
    }
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

  // Contorno aproximado de una púa: más ancha y redondeada en la parte de arriba, remate en
  // punta redondeada abajo (como en la foto del material). w y h son el ancho y el alto del
  // rectángulo que la contiene.
  function pickShapePath(ctx, x, y, w, h) {
    const cx = x + w / 2;
    ctx.beginPath();
    ctx.moveTo(cx, y + h);
    ctx.bezierCurveTo(x + w * 0.02, y + h * 0.78, x, y + h * 0.42, x + w * 0.14, y + h * 0.2);
    ctx.bezierCurveTo(x + w * 0.28, y - h * 0.02, x + w * 0.72, y - h * 0.02, x + w * 0.86, y + h * 0.2);
    ctx.bezierCurveTo(x + w, y + h * 0.42, x + w * 0.98, y + h * 0.78, cx, y + h);
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

    // Solo adjuntamos el archivo original si, sumado a la miniatura, cabe con margen
    // en el límite de 1 MiB por documento de Firestore. Se calcula aquí, con el tamaño
    // real, en vez de con un límite fijo sobre el archivo en bruto.
    const fileDataUrl = state.logoFile && !state.logoFile.tooLarge ? state.logoFile.dataUrl : null;
    const usedBytes = new Blob([snapshot, fileDataUrl || ""]).size;
    const fileFits = !!fileDataUrl && usedBytes <= SAFE_ORDER_BYTES;

    const order = {
      kind: ORDER_KIND,
      orderCode: requestCode,
      createdAt: new Date().toISOString(),
      status: "pendiente",
      customer: { name, phone, email },
      shipping: { address: "", postalCode: "", city: "", province: "", notes },
      items: [{ id: ORDER_KIND + "-" + material.id, title: `${ITEM_LABEL} — ${material.label}`, qty: 1, price: 0 }],
      subtotal: 0,
      material: { id: material.id, label: material.label },
      design: {
        snapshot,
        fileName: (state.logoFile && state.logoFile.name) || "",
        fileType: (state.logoFile && state.logoFile.type) || "",
        fileData: fileFits ? fileDataUrl : null,
        fileTooLargeToEmbed: !!(state.logoFile && state.logoFile.tooLarge) || (!!fileDataUrl && !fileFits),
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
      `🎨 *Solicitud de ${ITEM_LABEL.toLowerCase()} ${order.orderCode}*`,
      "",
      `Material: ${order.material.label}`,
      order.design.fileName ? `Archivo: ${order.design.fileName}` : null,
      "",
      `Nombre: ${c.name}`,
      `Teléfono: ${c.phone}`,
      c.email ? `Email: ${c.email}` : null,
      order.shipping.notes ? `Notas: ${order.shipping.notes}` : null,
      "",
      "Adjunto también una captura del diseño ajustado.",
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
