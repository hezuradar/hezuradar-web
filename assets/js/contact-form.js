// Formulario de contacto de la portada: botón «Escríbenos» de la tarjeta Contacto →
// ventana modal con nombre, email, mensaje y reCAPTCHA v2 → email a la tienda con
// EmailJS (HA_EMAIL.sendContactEmail en assets/js/emailjs-notify.js).
(function () {
  "use strict";

  const MIN_FILL_MS = 3000; // un humano tarda más que esto en rellenar el formulario
  const COOLDOWN_MS = 60 * 1000; // un mensaje por minuto desde el mismo navegador
  const SENT_KEY = "ha_contact_sent_at";

  let opener = null;
  let openedAt = 0;
  let captchaWidgetId = null;
  let captchaLoading = false;
  let sending = false;

  const $ = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", () => {
    const btn = $("contact-open");
    if (btn) btn.addEventListener("click", openContact);
  });

  function captchaSiteKey() {
    return (window.HA_DRIVE && window.HA_DRIVE.recaptchaSiteKey) || "";
  }

  function lastSentAt() {
    try {
      return Number(localStorage.getItem(SENT_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }

  function markSent() {
    try {
      localStorage.setItem(SENT_KEY, String(Date.now()));
    } catch (e) {}
  }

  function openContact() {
    if ($("contact-backdrop")) return;
    opener = document.activeElement;
    openedAt = Date.now();
    const root = document.createElement("div");
    root.id = "contact-root";
    root.innerHTML = `
      <div class="modal-backdrop" id="contact-backdrop">
        <div class="modal modal-contact" role="dialog" aria-modal="true" aria-labelledby="contact-title">
          <button class="modal-close" id="contact-close" type="button" aria-label="Cerrar">&times;</button>
          <form id="contact-form" class="contact-form" novalidate>
            <h2 id="contact-title">Escríbenos</h2>
            <p class="help-text">Cuéntanos qué necesitas y te respondemos por email lo antes posible.</p>
            <div class="field">
              <label for="cf-name">Nombre</label>
              <input id="cf-name" name="name" autocomplete="name" maxlength="100" required aria-required="true">
            </div>
            <div class="field">
              <label for="cf-email">Email</label>
              <input id="cf-email" name="email" type="email" autocomplete="email" maxlength="150" required aria-required="true">
            </div>
            <div class="field">
              <label for="cf-message">Mensaje</label>
              <textarea id="cf-message" name="message" maxlength="3000" required aria-required="true"></textarea>
            </div>
            <div class="cf-hp" aria-hidden="true">
              <label for="cf-website">No rellenes este campo</label>
              <input id="cf-website" name="website" tabindex="-1" autocomplete="off">
            </div>
            <div class="field">
              <div id="cf-captcha" class="cf-captcha"></div>
            </div>
            <p class="help-text">Solo usaremos tus datos para responderte. Más información en la <a href="/privacidad.html">política de privacidad</a>.</p>
            <button class="btn btn-primary" id="cf-submit" type="submit" style="width:100%">Enviar mensaje</button>
            <div id="cf-status" aria-live="polite"></div>
          </form>
        </div>
      </div>`;
    document.body.appendChild(root);

    $("contact-close").addEventListener("click", closeContact);
    $("contact-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "contact-backdrop") closeContact();
    });
    $("contact-backdrop").addEventListener("keydown", onKeydown);
    $("contact-form").addEventListener("submit", onSubmit);
    document.body.style.overflow = "hidden";
    $("cf-name").focus({ preventScroll: true });
    showCaptcha();
  }

  function closeContact() {
    const backdrop = $("contact-backdrop");
    if (!backdrop || backdrop.classList.contains("closing")) return;
    backdrop.classList.add("closing");
    document.body.style.overflow = "";
    captchaWidgetId = null;
    setTimeout(() => {
      const root = $("contact-root");
      if (root) root.remove();
    }, 160);
    if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus({ preventScroll: true });
    opener = null;
  }

  // Escape cierra; Tab no se sale del modal.
  function onKeydown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeContact();
      return;
    }
    if (e.key !== "Tab") return;
    const modal = document.querySelector(".modal-contact");
    const focusables = Array.from(
      modal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), iframe')
    ).filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // reCAPTCHA v2, la misma clave que la casilla de la cesta (assets/js/drive-export.js).
  function showCaptcha() {
    const key = captchaSiteKey();
    const el = $("cf-captcha");
    if (!key || !el) return;
    const render = () => {
      const target = $("cf-captcha");
      if (!target || target.childElementCount) return;
      captchaWidgetId = window.grecaptcha.render(target, { sitekey: key });
    };
    if (window.grecaptcha && window.grecaptcha.render) return render();
    window.haContactRecaptchaReady = render;
    if (captchaLoading) return;
    captchaLoading = true;
    const sc = document.createElement("script");
    sc.src = "https://www.google.com/recaptcha/api.js?onload=haContactRecaptchaReady&render=explicit&hl=es";
    sc.async = true;
    sc.onerror = () => {
      captchaLoading = false;
      sc.remove();
      const target = $("cf-captcha");
      if (target && !target.childElementCount) {
        target.innerHTML = `<p class="help-text" role="alert">No se ha podido cargar la verificación «No soy un robot». Recarga la página o escríbenos directamente a hezuradar@gmail.com.</p>`;
      }
    };
    document.head.appendChild(sc);
  }

  function captchaToken() {
    if (captchaWidgetId === null || !window.grecaptcha) return "";
    return window.grecaptcha.getResponse(captchaWidgetId) || "";
  }

  function setStatus(type, msg) {
    const el = $("cf-status");
    if (!el) return;
    el.innerHTML = msg ? `<div class="status-msg ${type}" role="${type === "err" ? "alert" : "status"}">${escapeHtml(msg)}</div>` : "";
  }

  function readForm() {
    return {
      name: $("cf-name").value.trim(),
      email: $("cf-email").value.trim(),
      message: $("cf-message").value.trim(),
      website: $("cf-website").value.trim(),
    };
  }

  // [id del campo, texto del error] del primer campo incorrecto, o null si todo está bien.
  function validate(data) {
    if (!data.name) return ["cf-name", "Escribe tu nombre."];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return ["cf-email", "Escribe un email válido para poder responderte."];
    if (data.message.length < 5) return ["cf-message", "Escribe tu mensaje."];
    return null;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (sending) return;
    const data = readForm();
    const invalid = validate(data);
    if (invalid) {
      setStatus("err", invalid[1]);
      $(invalid[0]).focus();
      return;
    }
    // Campo trampa relleno o enviado demasiado rápido: se da por enviado sin mandar nada.
    if (data.website || Date.now() - openedAt < MIN_FILL_MS) {
      setStatus("ok", "¡Gracias! Hemos recibido tu mensaje.");
      return;
    }
    if (Date.now() - lastSentAt() < COOLDOWN_MS) {
      setStatus("err", "Acabas de enviarnos un mensaje. Espera un minuto antes de mandar otro.");
      return;
    }
    const token = captchaSiteKey() ? captchaToken() : "";
    if (captchaSiteKey() && !token) {
      setStatus("err", "Marca la casilla «No soy un robot» para enviar el mensaje.");
      return;
    }
    if (!window.HA_EMAIL || !window.HA_EMAIL.sendContactEmail) {
      setStatus("err", "No se ha podido enviar el mensaje. Escríbenos directamente a hezuradar@gmail.com.");
      return;
    }

    sending = true;
    $("cf-submit").disabled = true;
    setStatus("info", "Enviando...");
    try {
      await window.HA_EMAIL.sendContactEmail({ name: data.name, email: data.email, message: data.message, captchaToken: token });
      markSent();
      $("contact-form").reset();
      setStatus("ok", "¡Mensaje enviado! Te responderemos por email lo antes posible.");
    } catch (err) {
      console.error("No se pudo enviar el mensaje de contacto:", err);
      setStatus("err", "No se ha podido enviar el mensaje. Inténtalo de nuevo o escríbenos a hezuradar@gmail.com.");
    } finally {
      sending = false;
      const btn = $("cf-submit");
      if (btn) btn.disabled = false;
      if (captchaWidgetId !== null && window.grecaptcha) window.grecaptcha.reset(captchaWidgetId);
    }
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
