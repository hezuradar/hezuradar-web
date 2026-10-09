window.HA_DESIGNER_CONFIG = {
  kind: "pua-personalizada",
  itemLabel: "Púa personalizada",
  shape: "pick",
  plateWidthMm: 27,
  plateHeightMm: 32,
  minQty: 20,
  maxQty: 5000, // con 2,80 €/ud el subtotal queda muy por debajo del tope de las reglas de Firestore
  pricePerUnit: 2.8,
  materials: [
    { id: "hueso", label: "Hueso y cuerno natural", img: "images/site/materials/pua.jpg", contrast: "#161616" },
  ],
};
