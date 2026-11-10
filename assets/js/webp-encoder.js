// Convierte a WebP las fotos que prepara el panel (foto de la ficha y miniatura), en
// cualquier navegador. Chrome, Edge y Firefox lo hacen solos con canvas.toBlob; Safari
// (iPhone, iPad y Mac) no sabe generar WebP y devolvería PNG o JPEG, así que en ese caso se
// usa el codificador de libwebp compilado a WebAssembly (@jsquash/webp 1.5.0, el mismo de
// Squoosh), copiado en assets/js/vendor/webp-enc-1.5.0 y cargado solo cuando hace falta.
(function () {
  "use strict";

  const ENCODER_URL = "/assets/js/vendor/webp-enc-1.5.0/webp_enc.js";

  // Opciones de libwebp (struct WebPConfig); son las de @jsquash/webp salvo la calidad, que
  // llega en cada llamada.
  const ENCODER_OPTIONS = {
    quality: 75,
    target_size: 0,
    target_PSNR: 0,
    method: 4,
    sns_strength: 50,
    filter_strength: 60,
    filter_sharpness: 0,
    filter_type: 1,
    partitions: 0,
    segments: 4,
    pass: 1,
    show_compressed: 0,
    preprocessing: 0,
    autofilter: 0,
    partition_limit: 0,
    alpha_compression: 1,
    alpha_filtering: 1,
    alpha_quality: 100,
    lossless: 0,
    exact: 0,
    image_hint: 0,
    emulate_jpeg_size: 0,
    thread_level: 0,
    low_memory: 0,
    near_lossless: 100,
    use_delta_palette: 0,
    use_sharp_yuv: 0,
  };

  let nativeSupport = null;
  function hasNativeWebp() {
    if (nativeSupport === null) {
      try {
        nativeSupport = document.createElement("canvas").toDataURL("image/webp").indexOf("data:image/webp") === 0;
      } catch (e) {
        nativeSupport = false;
      }
    }
    return nativeSupport;
  }

  // Se carga una sola vez; si falla (sin conexión, por ejemplo) se puede volver a intentar.
  let encoderPromise = null;
  function loadEncoder() {
    if (!encoderPromise) {
      encoderPromise = import(ENCODER_URL)
        .then((mod) => mod.default({ noInitialRun: true }))
        .catch((err) => {
          encoderPromise = null;
          throw new Error("No se pudo cargar el conversor a WebP (" + ((err && err.message) || err) + "). Revisa la conexión e inténtalo de nuevo.");
        });
    }
    return encoderPromise;
  }

  function nativeEncode(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob && blob.type === "image/webp" ? resolve(blob) : reject(new Error("El navegador no generó un WebP."))),
        "image/webp",
        quality
      );
    });
  }

  // quality va de 0 a 1, como en canvas.toBlob; libwebp la quiere de 0 a 100.
  async function wasmEncode(canvas, quality) {
    const encoder = await loadEncoder();
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const options = Object.assign({}, ENCODER_OPTIONS, { quality: Math.round(quality * 100) });
    const out = encoder.encode(pixels.data, canvas.width, canvas.height, options);
    if (!out || !out.byteLength) throw new Error("No se pudo convertir la foto a WebP.");
    // Copia: el resultado puede apuntar a la memoria del módulo, que se reutiliza.
    return new Blob([new Uint8Array(out)], { type: "image/webp" });
  }

  function encodeCanvas(canvas, quality) {
    if (!hasNativeWebp()) return wasmEncode(canvas, quality);
    return nativeEncode(canvas, quality).catch(() => wasmEncode(canvas, quality));
  }

  window.HA_WEBP = { encodeCanvas, hasNativeWebp, wasmEncode };
})();
