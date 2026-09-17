(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const PLATE_PX = 480;
  const PLATE_MM = 32;
  const PLATE_PX_PER_MM = PLATE_PX / PLATE_MM;
  const FIT_RATIO = 0.82; // el logo, al ajustarlo, ocupa como mucho este % del lado de la placa
  const MM_PER_FIT_SCALE = PLATE_MM * FIT_RATIO; // mm reales (lado mayor) a las que corresponde scale=1
  const SIZE_MM_MIN = 5;
  const SIZE_MM_MAX = 80;
  const scaleToMm = (scale) => scale * MM_PER_FIT_SCALE;
  const mmToScale = (mm) => mm / MM_PER_FIT_SCALE;
  const HARD_MAX_FILE_BYTES = 15 * 1024 * 1024; // por encima de esto ni se intenta leer el archivo (evita colgar el navegador)
  const SAFE_ORDER_BYTES = 950 * 1024; // margen de seguridad bajo el límite de 1 MiB por documento de Firestore

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
    dxfPxPerMm: null, // solo para DXF: px de logoCanvas por mm real del dibujo (null si es un PDF)
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

  // Regla de referencia alrededor de la placa: marca cada mm real (la placa mide 32x32mm),
  // con ticks más largos y etiqueta cada 5mm. Se genera una sola vez, ya que el tamaño de la
  // placa no cambia.
  function renderRulers() {
    const ticks = [];
    for (let mm = 0; mm <= 32; mm++) ticks.push(mm);
    const buildTick = (mm, axis) => {
      const isMajor = mm % 5 === 0 || mm === 32;
      const pct = (mm / 32) * 100;
      const pos = axis === "h" ? `left:${pct}%` : `top:${pct}%`;
      return `<span class="ruler-tick${isMajor ? " major" : ""}" style="${pos}">${isMajor ? `<span>${mm}</span>` : ""}</span>`;
    };
    $("ruler-bottom").innerHTML = ticks.map((mm) => buildTick(mm, "h")).join("");
    $("ruler-side").innerHTML = ticks.map((mm) => buildTick(mm, "v")).join("");
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
    state.fitPxSize = (PLATE_PX * FIT_RATIO) / maxDim; // factor: px de plate-canvas por px de logoCanvas, a scale=1
    state.offsetX = 0;
    state.offsetY = 0;
    state.scale = 1;
    state.rotationDeg = 0;
    $("scale-range").value = MM_PER_FIT_SCALE.toFixed(1);
    $("rotate-range").value = 0;
  }

  // Calcula (sin aplicar) el "scale" y los mm reales a los que correspondería el logo, a partir
  // de las medidas del DXF cargado (ver renderDxfFile). Devuelve null si no hay esa información
  // (por ejemplo, un PDF, que no tiene una escala física fiable).
  // 1 mm de plate-canvas equivale a PLATE_PX_PER_MM px; 1 mm del DXF equivale a dxfPxPerMm px
  // de logoCanvas. A partir de ahí se despeja el "scale" que reproduce ese tamaño real.
  function computeRealSize() {
    if (!state.logoCanvas || !state.fitPxSize || !state.dxfPxPerMm) return null;
    const rawScale = PLATE_PX_PER_MM / (state.dxfPxPerMm * state.fitPxSize);
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

    let logoGeom = null;
    if (state.logoCanvas) {
      const cx = canvas.width / 2 + state.offsetX;
      const cy = canvas.height / 2 + state.offsetY;
      const maxDim = Math.max(state.logoCanvas.width, state.logoCanvas.height);
      const drawMax = state.fitPxSize * maxDim * state.scale;
      const w = drawMax * (state.logoCanvas.width / maxDim);
      const h = drawMax * (state.logoCanvas.height / maxDim);
      const angleRad = (state.rotationDeg * Math.PI) / 180;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angleRad);
      ctx.drawImage(state.logoCanvas, -w / 2, -h / 2, w, h);
      ctx.restore();
      logoGeom = { cx, cy, w, h, angleRad };
    }

    ctx.restore();

    // Borde sutil de la placa
    ctx.save();
    roundedRectPath(ctx, 1, 1, canvas.width - 2, canvas.height - 2, radius);
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    if (logoGeom) drawDimensions(ctx, logoGeom);
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
    const widthMm = (maxX - minX) / PLATE_PX_PER_MM;
    const heightMm = (maxY - minY) / PLATE_PX_PER_MM;

    const dimColor = materialById(state.materialId).contrast;
    ctx.save();
    ctx.strokeStyle = dimColor;
    ctx.fillStyle = dimColor;
    ctx.lineWidth = 1;
    ctx.font = "600 14px Inter, sans-serif";
    ctx.textAlign = "center";

    const hy = Math.min(maxY + 12, PLATE_PX - 6);
    ctx.textBaseline = "top";
    drawDimLine(ctx, minX, hy, maxX, hy, true);
    ctx.fillText(widthMm.toFixed(1) + " mm", (minX + maxX) / 2, hy + 4);

    const vx = Math.min(maxX + 12, PLATE_PX - 6);
    drawDimLine(ctx, vx, minY, vx, maxY, false);
    ctx.save();
    ctx.translate(vx + 4, (minY + maxY) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "bottom";
    ctx.fillText(heightMm.toFixed(1) + " mm", 0, 0);
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

    // Solo adjuntamos el archivo original si, sumado a la miniatura, cabe con margen
    // en el límite de 1 MiB por documento de Firestore. Se calcula aquí, con el tamaño
    // real, en vez de con un límite fijo sobre el archivo en bruto.
    const fileDataUrl = state.logoFile && !state.logoFile.tooLarge ? state.logoFile.dataUrl : null;
    const usedBytes = new Blob([snapshot, fileDataUrl || ""]).size;
    const fileFits = !!fileDataUrl && usedBytes <= SAFE_ORDER_BYTES;

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
