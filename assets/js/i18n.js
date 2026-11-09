// Idioma de la tienda (español por defecto, inglés a elección del cliente).
//
// La web se escribe en español y, si el cliente elige inglés, este script cambia cada texto
// por su traducción de assets/js/i18n-en.js, también lo que pintan después los demás scripts
// (cesta, checkout, ficha rápida, diseñadores...). La elección se guarda en el navegador
// (localStorage) y se mantiene en todas las páginas. Se carga en el <head> de cada página,
// antes que el resto de scripts, para que la página no llegue a verse en español.
//
// Unidad de traducción: el elemento "hoja", es decir, el que tiene texto propio y solo
// etiquetas en línea dentro (enlaces, negritas...). Su clave es el texto con esas etiquetas
// sin atributos: "Lee la <a>guía</a>." -> "Read the <a>guide</a>.". Al traducir se conservan
// los elementos originales (con sus atributos y eventos) y solo se cambian los textos.
// scripts/i18n/extract.js usa estas mismas funciones para sacar los textos de las páginas.
(function (root, factory) {
  var core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  else core.boot(root);
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var LS_KEY = "ha_lang";
  var LANGS = ["es", "en"];
  var DICT_URL = "/assets/js/i18n-en.js?v=20261109a";
  // Etiquetas que pueden ir dentro de una frase sin partirla.
  var INLINE = /^(A|B|STRONG|EM|I|SPAN|BR|SMALL|SUP|SUB|ABBR|CODE|KBD|MARK|U|S|TIME|Q|WBR)$/;
  // Donde nunca hay texto que traducir (o no se debe tocar).
  var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|SVG|TEXTAREA|CANVAS|TEMPLATE|IFRAME|OBJECT|PRE)$/;
  var ATTRS = ["placeholder", "aria-label", "alt", "title"];
  var HAS_LETTERS = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ¿¡]/;

  // Lo que ya está en inglés (lang="en") no se toca; el lang de <html> no cuenta, porque es
  // el propio script quien lo pone en "en" al cambiar de idioma.
  function skipped(el) {
    if (SKIP.test(el.tagName) || el.hasAttribute("data-no-i18n")) return true;
    return el.tagName !== "HTML" && (el.getAttribute("lang") || "").slice(0, 2) === "en";
  }

  // Espacios como los ve el lector: los saltos de párrafo ("\n\n", en textos con
  // white-space:pre-line como la descripción del producto) se conservan; el resto, un espacio.
  function normSpace(s) {
    return String(s).replace(/[\s ]+/g, function (ws) {
      return /\n[ \t ]*\n/.test(ws) ? "\n\n" : " ";
    });
  }
  function escText(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function inlineOnly(el) {
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (!INLINE.test(c.tagName) || skipped(c) || !inlineOnly(c)) return false;
    }
    return true;
  }
  function hasOwnText(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && HAS_LETTERS.test(n.nodeValue)) return true;
    }
    return false;
  }
  function hasText(el) {
    return HAS_LETTERS.test(el.textContent || "");
  }
  // Hoja: texto propio o etiquetas en línea con texto, y nada de bloques dentro.
  function isLeaf(el) {
    return !skipped(el) && !!el.firstChild && inlineOnly(el) && hasText(el) && (hasOwnText(el) || el.childElementCount > 0);
  }

  function canonInner(el) {
    var out = "";
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) out += escText(normSpace(n.nodeValue));
      else if (n.nodeType === 1) {
        var tag = n.tagName.toLowerCase();
        out += tag === "br" || tag === "wbr" ? "<" + tag + ">" : "<" + tag + ">" + canonInner(n) + "</" + tag + ">";
      }
    }
    return out;
  }
  function trimCanon(s) {
    return s.replace(/^[ \n]+|[ \n]+$/g, "");
  }
  function canon(el) {
    return trimCanon(canonInner(el));
  }
  function canonText(s) {
    return trimCanon(escText(normSpace(s)));
  }

  // Recorre un subárbol y llama a onLeaf(elemento) / onText(nodo de texto suelto) /
  // onAttr(elemento, atributo) para cada cosa traducible.
  function walk(node, visit) {
    if (node.nodeType === 3) {
      if (HAS_LETTERS.test(node.nodeValue)) visit.onText(node);
      return;
    }
    if (node.nodeType !== 1) return;
    // Del texto que escribe el cliente solo se traduce el placeholder.
    if (node.tagName === "TEXTAREA" && !node.hasAttribute("data-no-i18n")) return attrsOf(node, visit);
    if (skipped(node)) return;
    attrsOf(node, visit);
    if (isLeaf(node)) {
      visit.onLeaf(node);
      // Los atributos de las etiquetas en línea (alt de un icono, aria-label...) también cuentan.
      var inner = node.getElementsByTagName("*");
      for (var k = 0; k < inner.length; k++) attrsOf(inner[k], visit);
      return;
    }
    for (var c = node.firstChild; c; c = c.nextSibling) walk(c, visit);
  }
  function attrsOf(el, visit) {
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (v && HAS_LETTERS.test(v)) visit.onAttr(el, ATTRS[i]);
    }
    if (el.tagName === "INPUT" && /^(button|submit|reset)$/i.test(el.getAttribute("type") || "") && HAS_LETTERS.test(el.value || "")) {
      visit.onAttr(el, "value");
    }
  }

  // ---------------------------------------------------------------- navegador

  var dict = null;
  var patterns = [];
  var lang = "es";

  function lookupOne(key) {
    if (!key) return null;
    if (dict && Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
    for (var i = 0; i < patterns.length; i++) {
      var m = key.match(patterns[i][0]);
      if (m) {
        var rep = patterns[i][1];
        return typeof rep === "function" ? rep(m, lookupOr) : key.replace(patterns[i][0], rep);
      }
    }
    return null;
  }
  // Los avisos que juntan varias frases (p. ej. "Diseño cargado: x. Su tamaño...") se
  // traducen frase a frase si no hay traducción del conjunto.
  function lookup(key) {
    var res = lookupOne(key);
    if (res != null || !key || key.indexOf("<") !== -1) return res;
    // Sin "lookbehind" en la expresión: Safari antiguo no lo entiende y rompería el script.
    var parts = key.replace(/([.!?…])\s+(?=[¡¿A-ZÁÉÍÓÚÑ])/g, "$1\u0000").split("\u0000");
    if (parts.length < 2) return null;
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = lookupOne(parts[i]);
      if (p == null) return null;
      out.push(p);
    }
    return out.join(" ");
  }
  // Para los patrones: la traducción de un trozo, o el trozo tal cual.
  function lookupOr(key) {
    var res = lookup(key);
    return res == null ? key : res;
  }
  function unesc(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }
  // Traducción de un texto suelto (para los scripts). Sin traducción, el texto tal cual.
  function t(s) {
    if (lang !== "en") return s;
    var res = lookup(canonText(s));
    return res == null ? s : unesc(res);
  }

  // Cambia los textos de `el` por los de `html` (misma estructura de etiquetas), conservando
  // los elementos originales. Si la estructura no coincide, no toca nada.
  function applyInner(el, html) {
    var doc = el.ownerDocument;
    var tpl = doc.createElement("template");
    tpl.innerHTML = html;
    var plan = [];
    if (!matchTree(el, tpl.content, plan)) return false;
    plan.forEach(function (p) {
      while (p.parent.firstChild) p.parent.removeChild(p.parent.firstChild);
      p.nodes.forEach(function (n) {
        p.parent.appendChild(n);
      });
    });
    return true;
  }
  function matchTree(orig, trans, plan) {
    var origEls = [];
    for (var c = orig.firstElementChild; c; c = c.nextElementSibling) origEls.push(c);
    var nodes = [];
    var k = 0;
    for (var n = trans.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) nodes.push(orig.ownerDocument.createTextNode(n.nodeValue));
      else if (n.nodeType === 1) {
        var o = origEls[k++];
        if (!o || o.tagName !== n.tagName) return false;
        if (!matchTree(o, n, plan)) return false;
        nodes.push(o);
      }
    }
    if (k !== origEls.length) return false;
    plan.push({ parent: orig, nodes: nodes });
    return true;
  }

  // Lo que ya se tradujo no se vuelve a buscar (el observador ve también nuestros cambios).
  var done = typeof WeakMap === "function" ? new WeakMap() : null;

  function translateLeaf(el) {
    var key = canon(el);
    if (done && done.get(el) === key) return;
    var res = lookup(key);
    if (res == null) {
      // Sin traducción de la frase completa, al menos cada trozo por separado.
      if (el.childElementCount) {
        for (var n = el.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 3 && HAS_LETTERS.test(n.nodeValue)) translateText(n);
          else if (n.nodeType === 1 && hasText(n)) translateLeaf(n);
        }
      }
      if (done) done.set(el, canon(el));
      return;
    }
    if (res !== key) {
      if (el.childElementCount === 0 && el.childNodes.length === 1) el.firstChild.nodeValue = unesc(res);
      else applyInner(el, res);
    }
    if (done) done.set(el, canon(el));
  }
  function translateText(node) {
    var raw = node.nodeValue;
    var res = lookup(canonText(raw));
    if (res == null) return;
    // Se conservan los espacios de los bordes, que separan el texto de lo que lo rodea.
    var lead = /^[\s ]/.test(raw) ? " " : "";
    var trail = /[\s ]$/.test(raw) ? " " : "";
    var next = lead + unesc(res) + trail;
    if (next !== raw) node.nodeValue = next;
  }
  function translateAttr(el, name) {
    var v = name === "value" ? el.value : el.getAttribute(name);
    if (!v) return;
    var res = lookup(canonText(v));
    if (res == null) return;
    res = unesc(res);
    if (res === v) return;
    if (name === "value") el.value = res;
    else el.setAttribute(name, res);
  }
  var visitor = { onLeaf: translateLeaf, onText: translateText, onAttr: translateAttr };

  // Lo que hay que volver a traducir cuando cambia un nodo: su hoja, o el propio nodo.
  function leafRoot(node) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return null;
    for (var p = el; p && p.nodeType === 1; p = p.parentElement) if (skipped(p)) return null;
    while (el.parentElement && INLINE.test(el.tagName) && isLeaf(el.parentElement)) el = el.parentElement;
    if (node.nodeType === 3 && !isLeaf(el)) return node;
    return el;
  }

  function translateTitle(doc) {
    var res = lookup(canonText(doc.title));
    if (res != null && unesc(res) !== doc.title) doc.title = unesc(res);
  }

  function observe(doc) {
    var pending = [];
    var scheduled = false;
    function flush() {
      scheduled = false;
      var list = pending;
      pending = [];
      list.forEach(function (n) {
        if (n.isConnected === false) return;
        walk(n, visitor);
      });
    }
    var mo = new MutationObserver(function (records) {
      records.forEach(function (r) {
        if (r.type === "attributes") {
          if (!leafRoot(r.target)) return;
          translateAttr(r.target, r.attributeName);
          return;
        }
        var target = null;
        if (r.type === "characterData") target = leafRoot(r.target);
        else {
          for (var i = 0; i < r.addedNodes.length; i++) {
            var lr = leafRoot(r.addedNodes[i]);
            if (lr) pending.push(lr);
          }
          if (r.target.nodeType === 1 && isLeaf(r.target)) target = leafRoot(r.target);
        }
        if (target) pending.push(target);
      });
      if (pending.length && !scheduled) {
        scheduled = true;
        // En una microtarea: antes de que el navegador pinte, no se llega a ver en español.
        (typeof queueMicrotask === "function" ? queueMicrotask : setTimeout)(flush);
      }
    });
    mo.observe(doc.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
    var titleEl = doc.querySelector("title");
    if (titleEl) {
      new MutationObserver(function () {
        translateTitle(doc);
      }).observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  }

  function readLang(win) {
    var q = /[?&]lang=(es|en)\b/.exec(win.location.search);
    try {
      if (q) win.localStorage.setItem(LS_KEY, q[1]);
      var saved = win.localStorage.getItem(LS_KEY);
      if (LANGS.indexOf(saved) !== -1) return saved;
    } catch (e) {
      // Sin almacenamiento (modo privado estricto...) vale lo que diga la URL.
    }
    return q ? q[1] : "es";
  }
  function setLang(next) {
    if (LANGS.indexOf(next) === -1 || next === lang) return;
    var stored = false;
    try {
      window.localStorage.setItem(LS_KEY, next);
      stored = window.localStorage.getItem(LS_KEY) === next;
    } catch (e) {
      stored = false;
    }
    var url = new URL(window.location.href);
    url.searchParams.delete("lang");
    // Sin almacenamiento, el idioma viaja en la URL.
    if (!stored) url.searchParams.set("lang", next);
    // Con un ancla en la URL (#catalogo...), replace() a la misma dirección solo hace scroll
    // y la página se quedaba en el idioma anterior: en ese caso se recarga.
    if (url.toString() === window.location.href) window.location.reload();
    else window.location.replace(url.toString());
  }

  // Selector ES | EN en la cabecera: junto a la cesta o, si no hay iconos, al final.
  function mountSwitch(doc) {
    var nav = doc.querySelector(".site-header .header-nav");
    if (!nav || doc.querySelector(".lang-switch")) return;
    var box = doc.createElement("div");
    box.className = "lang-switch";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "Cambiar idioma / Change language");
    box.title = "Cambiar idioma / Change language";
    box.setAttribute("data-no-i18n", "");
    // El globo es el símbolo que se reconoce para el idioma; la pastilla ES | EN sola no lo dejaba claro.
    var globe = doc.createElement("span");
    globe.className = "lang-switch-icon";
    globe.setAttribute("aria-hidden", "true");
    globe.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
    box.appendChild(globe);
    LANGS.forEach(function (code) {
      var b = doc.createElement("button");
      b.type = "button";
      b.lang = code;
      b.textContent = code.toUpperCase();
      b.setAttribute("aria-pressed", code === lang ? "true" : "false");
      b.setAttribute("aria-label", code === "es" ? "Español" : "English");
      b.addEventListener("click", function () {
        setLang(code);
      });
      box.appendChild(b);
    });
    var icons = nav.querySelector(".header-icons");
    if (icons) icons.insertBefore(box, icons.firstChild);
    else nav.appendChild(box);
  }

  function boot(win) {
    var doc = win.document;
    var html = doc.documentElement;
    lang = readLang(win);
    win.HA_I18N = {
      get lang() {
        return lang;
      },
      t: t,
      setLang: setLang,
      // Para textos con datos variables que pintan los scripts (ver i18n-en.js).
      addPatterns: function (list) {
        patterns = patterns.concat(list);
      },
      // Para revisar desde la consola qué textos de una pantalla faltan por traducir.
      core: { walk: walk, canon: canon, canonText: canonText },
    };
    html.setAttribute("data-lang", lang);
    doc.addEventListener("DOMContentLoaded", function () {
      mountSwitch(doc);
    });
    if (lang !== "en") return;

    html.lang = "en";
    // Hasta que esté traducida la página no se ve (como mucho 2,5 s, por si falla la carga).
    html.classList.add("i18n-pending");
    var style = doc.createElement("style");
    style.textContent = "html.i18n-pending body{visibility:hidden}";
    doc.head.appendChild(style);
    function reveal() {
      html.classList.remove("i18n-pending");
    }
    var failsafe = setTimeout(reveal, 2500);

    var ready = false;
    var loaded = false;
    function start() {
      if (!ready || !loaded) return;
      walk(doc.body, visitor);
      translateTitle(doc);
      observe(doc);
      clearTimeout(failsafe);
      reveal();
    }
    var sc = doc.createElement("script");
    sc.src = DICT_URL;
    sc.onload = function () {
      dict = win.HA_I18N_DICT || {};
      patterns = (win.HA_I18N_PATTERNS || []).concat(patterns);
      loaded = true;
      start();
    };
    sc.onerror = reveal;
    doc.head.appendChild(sc);
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", function () {
        ready = true;
        start();
      });
    } else {
      ready = true;
      start();
    }
  }

  return { boot: boot, walk: walk, canon: canon, canonText: canonText, isLeaf: isLeaf };
});
