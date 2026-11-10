(function () {
  "use strict";

  // Lector mínimo de ficheros .xlsx, sin dependencias (la CSP del panel no deja cargar
  // librerías de fuera). Un .xlsx es un ZIP con XML dentro: se recorre el directorio
  // central del ZIP, se descomprime cada entrada con DecompressionStream("deflate-raw")
  // y se leen las celdas con expresiones regulares (en Node no hay DOMParser y así se
  // puede probar igual que en el navegador).
  //
  // Solo devuelve los valores guardados: las fórmulas sin valor calculado salen vacías.
  // Por eso shipping-costs.js recalcula los importes en vez de fiarse de las columnas
  // con fórmula.

  const SIG_EOCD = 0x06054b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_LOCAL = 0x04034b50;
  const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

  function findEndOfCentralDir(view) {
    // El registro final mide 22 bytes más un comentario de hasta 64 KB.
    const min = Math.max(0, view.byteLength - 22 - 65535);
    for (let i = view.byteLength - 22; i >= min; i--) {
      if (view.getUint32(i, true) === SIG_EOCD) return i;
    }
    throw new Error("El fichero no es un Excel (.xlsx) válido.");
  }

  function readZipEntries(buffer) {
    const view = new DataView(buffer);
    const eocd = findEndOfCentralDir(view);
    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder("utf-8");
    const entries = {};
    for (let n = 0; n < count; n++) {
      if (view.getUint32(ptr, true) !== SIG_CENTRAL) throw new Error("ZIP dañado.");
      const method = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localOffset = view.getUint32(ptr + 42, true);
      const name = decoder.decode(new Uint8Array(buffer, ptr + 46, nameLen));
      entries[name] = { method, compSize, localOffset };
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readEntryText(buffer, entry) {
    const view = new DataView(buffer);
    const at = entry.localOffset;
    if (view.getUint32(at, true) !== SIG_LOCAL) throw new Error("ZIP dañado.");
    if (entry.compSize > MAX_ENTRY_BYTES) throw new Error("El Excel es demasiado grande.");
    const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
    const raw = new Uint8Array(buffer, start, entry.compSize);
    let bytes;
    if (entry.method === 0) bytes = raw;
    else if (entry.method === 8) bytes = await inflateRaw(raw);
    else throw new Error("Compresión del Excel no soportada.");
    return new TextDecoder("utf-8").decode(bytes);
  }

  function decodeXml(s) {
    return String(s)
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&amp;/g, "&");
  }

  function attr(tag, name) {
    const m = new RegExp("\\s" + name + '="([^"]*)"').exec(tag);
    return m ? decodeXml(m[1]) : null;
  }

  // Texto de un <si> o <is>: concatena todos los <t>, incluidos los de texto enriquecido.
  function runText(xml) {
    let out = "";
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let m;
    while ((m = re.exec(xml))) out += decodeXml(m[1]);
    return out;
  }

  function parseSharedStrings(xml) {
    const list = [];
    const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    let m;
    while ((m = re.exec(xml))) list.push(m[1] ? runText(m[1]) : "");
    return list;
  }

  // "AB12" -> índice de columna 27 (base 0) y fila 11 (base 0).
  function cellRef(ref) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref || "");
    if (!m) return null;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { col: col - 1, row: Number(m[2]) - 1 };
  }

  function cellValue(open, body, shared) {
    const type = attr(open, "t");
    if (type === "inlineStr") return runText(body);
    const v = /<v>([\s\S]*?)<\/v>/.exec(body);
    if (!v) return null;
    const raw = decodeXml(v[1]);
    if (type === "s") return shared[Number(raw)] != null ? shared[Number(raw)] : "";
    if (type === "str" || type === "e") return raw;
    if (type === "b") return raw === "1";
    const num = Number(raw);
    return isNaN(num) ? raw : num;
  }

  // Devuelve las filas de la hoja como lista de listas (huecos a null).
  function parseSheet(xml, shared) {
    const rows = [];
    const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m;
    while ((m = re.exec(xml))) {
      const pos = cellRef(attr(m[1], "r"));
      if (!pos) continue;
      const value = m[2] == null ? null : cellValue(m[1], m[2], shared);
      if (value === null || value === "") continue;
      while (rows.length <= pos.row) rows.push([]);
      const row = rows[pos.row];
      while (row.length < pos.col) row.push(null);
      row[pos.col] = value;
    }
    return rows;
  }

  function resolveTarget(target) {
    const t = String(target || "").replace(/^\//, "");
    return t.startsWith("xl/") ? t : "xl/" + t;
  }

  // Lee el libro completo: { sheetNames: [...], sheets: { nombre: filas } }.
  async function readWorkbook(buffer) {
    const entries = readZipEntries(buffer);
    const text = async (name) => (entries[name] ? readEntryText(buffer, entries[name]) : "");
    const workbook = await text("xl/workbook.xml");
    if (!workbook) throw new Error("El fichero no es un Excel (.xlsx) válido.");
    const rels = await text("xl/_rels/workbook.xml.rels");
    const shared = parseSharedStrings(await text("xl/sharedStrings.xml"));

    const targets = {};
    (rels.match(/<Relationship\b[^>]*>/g) || []).forEach((tag) => {
      targets[attr(tag, "Id")] = resolveTarget(attr(tag, "Target"));
    });

    const sheetNames = [];
    const sheets = {};
    for (const tag of workbook.match(/<sheet\b[^>]*>/g) || []) {
      const name = attr(tag, "name");
      const target = targets[attr(tag, "r:id")];
      if (!name || !target || !entries[target]) continue;
      sheetNames.push(name);
      sheets[name] = parseSheet(await text(target), shared);
    }
    return { sheetNames, sheets };
  }

  window.HA_XLSX = { readWorkbook, parseSheet, parseSharedStrings, cellRef };
})();
