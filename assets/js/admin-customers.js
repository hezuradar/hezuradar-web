(function () {
  "use strict";

  // Búsqueda y orden de la pestaña Clientes (admin-orders.js). Es lógica pura, sin DOM,
  // para poder probarla con Node (tests/customers-filter.test.js).

  // Campos por los que se puede buscar. "all" busca en todos a la vez.
  const SEARCH_FIELDS = {
    all: "Todos los campos",
    name: "Nombre",
    phone: "Teléfono",
    email: "Email",
    address: "Dirección",
    city: "Ciudad",
    province: "Provincia",
    postalCode: "Código postal",
  };

  // Opciones del desplegable «Ordenar por»: valor -> { etiqueta, campo, sentido }.
  const SORT_OPTIONS = {
    "lastOrderAt:desc": { label: "Pedido más reciente", field: "lastOrderAt", dir: "desc" },
    "lastOrderAt:asc": { label: "Pedido más antiguo", field: "lastOrderAt", dir: "asc" },
    "name:asc": { label: "Nombre A-Z", field: "name", dir: "asc" },
    "name:desc": { label: "Nombre Z-A", field: "name", dir: "desc" },
    "orderCount:desc": { label: "Más pedidos", field: "orderCount", dir: "desc" },
    "orderCount:asc": { label: "Menos pedidos", field: "orderCount", dir: "asc" },
    "totalSpent:desc": { label: "Más gastado", field: "totalSpent", dir: "desc" },
    "totalSpent:asc": { label: "Menos gastado", field: "totalSpent", dir: "asc" },
    "firstOrderAt:asc": { label: "Clientes más antiguos", field: "firstOrderAt", dir: "asc" },
    "city:asc": { label: "Ciudad A-Z", field: "city", dir: "asc" },
    "province:asc": { label: "Provincia A-Z", field: "province", dir: "asc" },
  };
  const DEFAULT_SORT = "lastOrderAt:desc";

  const SORT_GETTERS = {
    name: (c) => c.name || "",
    city: (c) => c.city || "",
    province: (c) => c.province || "",
    orderCount: (c) => Number(c.orderCount) || 0,
    totalSpent: (c) => Number(c.totalSpent) || 0,
    lastOrderAt: (c) => timeMs(c.lastOrderAt),
    firstOrderAt: (c) => timeMs(c.firstOrderAt),
  };

  function timeMs(iso) {
    const t = Date.parse(iso || "");
    return isNaN(t) ? 0 : t;
  }

  // Minúsculas y sin tildes: «Álava» se encuentra escribiendo «alava».
  function normalizeText(s) {
    return String(s == null ? "" : s)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  const digitsOnly = (s) => String(s == null ? "" : s).replace(/\D/g, "");
  // Lo escrito parece un número de teléfono («667 23 73», «+34 667...»).
  const looksLikeNumber = (q) => /^[\d\s+().-]+$/.test(q) && digitsOnly(q).length >= 3;

  function fieldValues(c, field) {
    if (field !== "all") return [c[field]];
    return Object.keys(SEARCH_FIELDS)
      .filter((f) => f !== "all")
      .map((f) => c[f]);
  }

  // Cada palabra de la búsqueda tiene que aparecer en alguno de los campos elegidos.
  // Un número escrito con espacios se compara además con los dígitos del teléfono, para
  // que «667 23 73» encuentre «667237332».
  function customerMatches(c, query, field) {
    const f = SEARCH_FIELDS[field] ? field : "all";
    const q = String(query == null ? "" : query).trim();
    const terms = normalizeText(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const cust = c || {};
    if ((f === "all" || f === "phone") && looksLikeNumber(q) && digitsOnly(cust.phone).includes(digitsOnly(q))) {
      return true;
    }
    const texts = fieldValues(cust, f).map(normalizeText);
    return terms.every((t) => texts.some((v) => v.includes(t)));
  }

  function filterCustomers(list, query, field) {
    return (list || []).filter((c) => customerMatches(c, query, field));
  }

  function sortCustomers(list, sortKey) {
    const opt = SORT_OPTIONS[sortKey] || SORT_OPTIONS[DEFAULT_SORT];
    const getter = SORT_GETTERS[opt.field];
    const dir = opt.dir === "asc" ? 1 : -1;
    return (list || []).slice().sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      if (typeof av === "number") return (av - bv) * dir;
      // Los vacíos (sin ciudad, sin nombre...) van siempre al final, en cualquier sentido.
      if (!av !== !bv) return av ? -1 : 1;
      return av.localeCompare(bv, "es", { sensitivity: "base" }) * dir;
    });
  }

  window.HA_CUSTOMERS = {
    SEARCH_FIELDS,
    SORT_OPTIONS,
    DEFAULT_SORT,
    normalizeText,
    customerMatches,
    filterCustomers,
    sortCustomers,
  };
})();
