(function () {
  "use strict";

  // Ventana para elegir qué pedidos confirmados entran en la hoja de etiquetas. Todos
  // vienen marcados; onPrint recibe los elegidos dentro del propio clic del botón, para
  // que el window.open de la impresión no lo bloquee el navegador.

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function orderId(o) {
    return String(o.docId || o.orderCode || "");
  }

  function formatDate(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  }

  function rowsHtml(orders) {
    return orders
      .map((o) => {
        const c = o.customer || {};
        const s = o.shipping || {};
        const place = [s.postalCode, s.city].filter(Boolean).join(" ");
        const id = escapeHtml(orderId(o));
        return `
        <label class="label-pick-row">
          <input type="checkbox" data-pick="${id}" checked>
          <span class="label-pick-code">${escapeHtml(o.orderCode || o.docId)}</span>
          <span class="label-pick-name">${escapeHtml(c.name || "Sin nombre")}</span>
          <span class="label-pick-place">${escapeHtml(place)}</span>
          <span class="label-pick-date">${escapeHtml(formatDate(o.createdAt))}</span>
        </label>`;
      })
      .join("");
  }

  // Pedidos elegidos, en el mismo orden que la lista.
  function selectedOrders(orders, ids) {
    const wanted = new Set(ids);
    return orders.filter((o) => wanted.has(orderId(o)));
  }

  function open({ orders, onPrint }) {
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.innerHTML = `
      <div class="modal label-pick-modal" role="dialog" aria-modal="true" aria-labelledby="label-pick-title">
        <button type="button" class="modal-close" data-close aria-label="Cerrar">&times;</button>
        <div class="label-pick-body">
          <h2 id="label-pick-title">Etiquetas de pedidos confirmados</h2>
          <p class="help-text">Marca los pedidos que quieres imprimir.</p>
          <label class="label-pick-all">
            <input type="checkbox" id="label-pick-all" checked>
            <span>Seleccionar todos (${orders.length})</span>
          </label>
          <div class="label-pick-list">${rowsHtml(orders)}</div>
          <div class="label-pick-actions">
            <button type="button" class="small-btn" data-close>Cancelar</button>
            <button type="button" class="btn btn-primary small-btn" id="label-pick-print"></button>
          </div>
        </div>
      </div>
    `;
    const boxes = () => [...overlay.querySelectorAll("input[data-pick]")];
    const allBox = overlay.querySelector("#label-pick-all");
    const printBtn = overlay.querySelector("#label-pick-print");

    function refresh() {
      const checked = boxes().filter((b) => b.checked).length;
      allBox.checked = checked === orders.length;
      allBox.indeterminate = checked > 0 && checked < orders.length;
      printBtn.disabled = checked === 0;
      printBtn.textContent = checked === 1 ? "Generar 1 etiqueta" : `Generar ${checked} etiquetas`;
    }

    function close() {
      overlay.remove();
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }

    allBox.addEventListener("change", () => {
      boxes().forEach((b) => (b.checked = allBox.checked));
      refresh();
    });
    overlay.querySelector(".label-pick-list").addEventListener("change", refresh);
    printBtn.addEventListener("click", () => {
      const ids = boxes().filter((b) => b.checked).map((b) => b.dataset.pick);
      const chosen = selectedOrders(orders, ids);
      if (!chosen.length) return;
      close();
      onPrint(chosen);
    });
    overlay.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);

    refresh();
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    printBtn.focus();
  }

  window.HA_LABEL_PICKER = { open, rowsHtml, selectedOrders };
})();
