---
name: HezurAdar
description: Catálogo artesanal de hueso y cuerno natural para luthería, con herramientas de personalización a medida.
colors:
  taller-acero: "#4076AA"
  taller-acero-profundo: "#245F96"
  tinta-nocturna: "#1c2b36"
  grafito: "#33424c"
  peltre-apagado: "#62727d"
  niebla-taller: "#e1e8ed"
  lienzo: "#f5f7f9"
  blanco-ficha: "#ffffff"
  verde-whatsapp: "#25D366"
  exito: "#1c7a3f"
  exito-superficie: "#e5f6ec"
  alerta: "#b3261e"
  alerta-superficie: "#fdeaea"
  info-superficie: "#eaf2fb"
  aviso-pendiente: "#8a6100"
  aviso-pendiente-superficie: "#fdf1d9"
  enviado: "#4a3592"
  enviado-superficie: "#ece6fa"
  texto-pie: "#c9d4db"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.6rem"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 700
    letterSpacing: "0.02em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.taller-acero}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "9px 14px"
  button-primary-hover:
    backgroundColor: "{colors.taller-acero-profundo}"
  button-outline:
    backgroundColor: "{colors.blanco-ficha}"
    textColor: "{colors.grafito}"
    rounded: "{rounded.pill}"
    padding: "9px 14px"
  button-outline-hover:
    textColor: "{colors.taller-acero}"
  card-product:
    backgroundColor: "{colors.blanco-ficha}"
    rounded: "{rounded.md}"
    padding: "14px 14px 16px"
  chip:
    backgroundColor: "{colors.blanco-ficha}"
    textColor: "{colors.grafito}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  chip-active:
    backgroundColor: "{colors.taller-acero}"
    textColor: "#ffffff"
  field-input:
    backgroundColor: "{colors.blanco-ficha}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
---

# Design System: HezurAdar

## Overview

**Creative North Star: "El Atelier"**

HezurAdar vende materia prima real —hueso, cuerno, madre perla— a luthiers que trabajan con precisión. La interfaz elegida para ello no imita el taller: es el catálogo de un atelier de confianza, un mostrador limpio y bien fichado que deja que el material (fotografiado, no ilustrado) sea lo único con textura. El azul de acero, las tarjetas blancas y las esquinas en pastilla no buscan calidez rústica; buscan la seriedad de una ficha técnica bien hecha, con un punto de calidez que evita la frialdad clínica.

Todo el sistema comparte un mismo gesto de interacción: casi cualquier control activo (botón, chip, tab, swatch) responde con un `scale(.96–.97)` breve al pulsarlo. Es la firma táctil del sistema — confirmación inmediata, nunca decorativa.

**Rechazo confirmado:** nada de texturas de madera, tipografía manuscrita, iconografía "hecho a mano" ni vocabulario visual de feria artesanal, por mucho que el producto sea un material natural.

**Key Characteristics:**
- Cálido pero contenido: color y movimiento discretos, nunca vistosos.
- Capas tonales antes que sombra: la profundidad se lee por diferencia de color de superficie, no por decoración.
- Un único gesto táctil (tap-scale) repetido en todo el sistema en vez de una librería de microinteracciones distintas.
- Fotografía real del material como único elemento con textura; todo lo demás es plano y geométrico.

## Colors

Paleta corta y funcional: un azul de marca con su variante oscura, una escala de neutros fríos, y colores semánticos reservados casi en exclusiva a los paneles de administración de pedidos.

### Primary
- **Azul Acero de Taller** (`#4076AA`): color de marca. Cabecera del sitio, botones primarios, bordes de foco, estado activo de chips y tabs. Ajustado en la auditoría técnica de 2026-09-21 desde `#4581B9` para cumplir contraste AA (4.5:1) como texto blanco sobre este fondo.
- **Azul Acero de Taller — Profundo** (`#245F96`): hover de los elementos anteriores, precios (`.card-price`, `.modal-price`), texto de énfasis sobre fondo claro (categorías, títulos de sección de checkout).

### Neutral
- **Tinta Nocturna** (`#1c2b36`): titulares (h1–h3), pie de página (fondo).
- **Grafito** (`#33424c`): texto de cuerpo por defecto.
- **Peltre Apagado** (`#62727d`): texto secundario/metadatos (precios tachados, fechas, ayudas, SKU). Ajustado en la auditoría técnica de 2026-09-21 desde `#6c7d89` para cumplir contraste AA (4.5:1) sobre Blanco Ficha y Lienzo.
- **Niebla de Taller** (`#e1e8ed`): bordes y separadores en toda la interfaz.
- **Lienzo** (`#f5f7f9`): fondo de página; la capa "de suelo" sobre la que flotan las superficies blancas.
- **Blanco Ficha** (`#ffffff`): superficie de tarjetas, paneles, modales y campos.
- **Texto de Pie** (`#c9d4db`): único uso — texto del pie de página sobre fondo Tinta Nocturna (antes un literal sin token; tokenizado como `--color-footer-text` en la auditoría técnica de 2026-09-21).

### Named Rules
**La Regla del Verde Ajeno.** `#25D366` (verde WhatsApp) es un color de marca de terceros, no un acento propio del sistema. Se usa únicamente en el botón flotante de WhatsApp y en `.btn-whatsapp`; nunca se adopta como color de estado o de acento general.

**La Regla del Doble Rojo (deuda observada).** El sistema usa dos rojos distintos para semántica negativa: `#b3261e` (errores de formulario, estado "cancelado", botón de eliminar) y `#c0392b` (insignia de descuento, "sin stock", etiquetas de descuento en admin). No son intercambiables hoy porque ninguno de los dos se ha promovido a único; cualquier componente nuevo que necesite rojo debe elegir uno de los dos existentes en vez de introducir un tercero, y una limpieza futura debería unificarlos.

## Typography

**Display / Body Font:** Inter (con system-ui, -apple-system, Segoe UI, Roboto, sans-serif como reserva). Un solo tipo de letra para todo el sitio, incluidos titulares — la jerarquía se construye con tamaño y peso, no con una segunda familia.

**Character:** Una sans-serif geométrica y neutra que no compite con la fotografía del producto; el peso (400 a 800) es el único recurso expresivo.

### Hierarchy
- **Display** (700, 2rem, 1.2): titular del hero de la portada («Hueso y cuerno natural para luthería»). Baja a 1.5rem en móvil (≤760px).
- **Headline** (700, 1.6rem, 1.3): títulos de sección e introducciones de página, como «Personaliza tu placa».
- **Title** (600, ~0.95–1rem, 1.35): títulos de tarjeta de producto y de panel («1. Elige el material»); en modal de producto sube a 1.35rem.
- **Body** (400, 0.88–0.96rem, 1.6–1.7): texto de descripción y de "Quiénes somos" (1.7 en párrafos largos, 1.6 en descripción de producto).
- **Label** (700, 0.68–0.85rem, may be uppercase con `letter-spacing:.02–.03em`): etiquetas de categoría sobre imagen, pills de estado de pedido, títulos de sección de checkout.

### Named Rules
**La Regla de un Solo Tipo.** Ninguna familia secundaria, ni siquiera monoespaciada para SKU o precios: todo es Inter con variación de peso y tamaño.

## Layout

Contenedor centrado a 1180px con 20px de margen lateral (14px en móvil ≤480px). El catálogo usa una grilla `auto-fill, minmax(220px, 1fr)` con 18px de separación, que cae a 2 columnas fijas con 10px de gap por debajo de 480px — nunca a una sola columna, incluso en el teléfono más estrecho previsto.

La cabecera es `sticky top:0`; en desktop la barra de búsqueda/filtros también es `sticky top:64px` justo debajo, y ambas colapsan a flujo normal (`position:static` la barra de filtros) por debajo de 760px para no robar altura de pantalla en móvil. Las páginas de personalización (`disenador*.html`) usan un contenedor angosto (760px máx.) de una sola columna, coherente con ser un flujo secuencial de tareas (elegir material → subir diseño → ajustar → datos) en vez de un catálogo de exploración libre.

## Elevation & Depth

El sistema es principalmente de **capas tonales**: el fondo de página (Lienzo, `#f5f7f9`) y las superficies (Blanco Ficha) se diferencian por color, no por sombra — es esa diferencia de tono, no un `box-shadow`, la que separa visualmente tarjetas, paneles y campos de su fondo. La sombra existe como acento secundario, reservado a estados interactivos o flotantes: la tarjeta de producto en reposo no lleva sombra visible más allá de un borde de 1px, y solo la gana al hacer hover; los modales y el cajón del carrito sí la llevan siempre porque están literalmente flotando sobre un fondo oscurecido.

### Shadow Vocabulary
- **Reposo elevado** (`--shadow: 0 2px 10px rgba(20,40,60,.08)`): borde superior de la cabecera, panel de PIN de admin, tarjetas de estadísticas — una elevación mínima para superficies que ya están "arriba" por defecto.
- **Flotante** (`--shadow-lg: 0 12px 40px rgba(20,40,60,.18)`): hover de tarjeta de producto, modales, cajón del carrito en modo checkout de escritorio.

### Named Rules
**La Regla de la Sombra Ganada.** Una superficie nueva no lleva `--shadow-lg` por defecto; se gana al flotar sobre el resto del contenido (modal, drawer) o al responder a una interacción (hover de tarjeta). Todo lo demás se apoya en el contraste Lienzo/Blanco Ficha.

## Shapes

Dos lenguajes de forma que conviven a propósito: **pastilla** (`999px`) para todo lo que es control de acción o filtro —botones, chips, tabs de estado, el stepper de cantidad, las insignias circulares de icono— y **rectángulo suavizado** (`12px`, con `16–18px` en modales y el lienzo del diseñador) para contenedores de contenido —tarjetas, paneles, modales—. Los elementos circulares puros (`50%`) se reservan a avatares/iconos: el logo, los botones de icono de cabecera, la insignia de descuento, el botón de quitar miniatura.

### Named Rules
**La Regla Pastilla-o-Panel.** Si el elemento es algo que se pulsa para actuar o filtrar, es pastilla. Si el elemento es algo que contiene contenido, es panel de 12px (o 16–18px si flota). Nada a medio camino (por ejemplo, un `border-radius:6–8px` en un botón de acción rompería la regla).

## Components

### Buttons
- **Shape:** pastilla completa (`border-radius:999px`).
- **Primary** (`.btn-primary`): fondo Azul Acero de Taller, texto blanco, `padding:9px 14px`, peso 700.
- **Hover / Focus:** el primario oscurece a Azul Acero de Taller — Profundo; el outline cambia borde y texto a Azul Acero de Taller. No hay anillo de foco visible propio más allá del cambio de color — los inputs de admin y el buscador sí mueven el borde a `--color-primary` en foco.
- **Outline** (`.btn-outline`): fondo blanco, borde Niebla de Taller, texto Grafito.
- **WhatsApp** (`.btn-whatsapp`): fondo `#25D366` fijo — ver *La Regla del Verde Ajeno*.
- **Estado disabled:** opacidad `.55`, sin eventos de puntero.
- **Feedback táctil:** `scale(.97)` en `:active` con `--ease-out`, igual que el resto del sistema.

### Chips (filtros de categoría / tabs)
- **Style:** pastilla blanca con borde Niebla de Taller; el hover solo tiñe el borde de azul.
- **State:** activo = fondo Azul Acero de Taller (subcategoría activa usa la variante Profunda), texto blanco. Las tabs de estado de pedido (`.status-tab`) siguen el mismo patrón con un contador numérico embebido.

### Cards / Containers
- **Corner Style:** 12px (`--radius`).
- **Background:** Blanco Ficha sobre fondo Lienzo.
- **Shadow Strategy:** ver *Elevation & Depth* — sombra mínima en reposo, `--shadow-lg` + `translateY(-3px)` en hover.
- **Border:** 1px Niebla de Taller siempre presente, incluso con sombra.
- **Internal Padding:** `14px 14px 16px` (tarjeta de producto); `24px` en paneles de admin (`.card-panel`), que bajan a `18px` en móvil.

### Inputs / Fields
- **Style:** fondo blanco, borde Niebla de Taller 1px, `border-radius:8px` (el buscador de portada es la excepción deliberada: pastilla completa, porque vive dentro de la cabecera/toolbar, no en un formulario).
- **Focus:** solo el buscador de portada mueve el borde a Azul Acero de Taller; los campos de formulario (admin, checkout, diseñador) no tienen tratamiento de foco propio más allá del de tu navegador — una brecha a cerrar, no un patrón a copiar.
- **Error / Disabled:** los mensajes de estado (`.status-msg`) son la superficie de error/éxito/info del sistema — no el borde del campo — con fondo tintado y texto de alto contraste (Éxito `#1c7a3f` sobre `#e5f6ec`; Alerta `#b3261e` sobre `#fdeaea`; Info Azul Acero de Taller — Profundo sobre `#eaf2fb`).

### Navigation
- **Style:** cabecera `sticky`, fondo Azul Acero de Taller, texto blanco. Los enlaces son `.pill-btn` (pastilla con borde translúcido blanco, sin relleno hasta el hover); las acciones de icono (Instagram, cesta) son círculos translúcidos con el mismo tratamiento de hover.
- **Mobile (≤600px):** la cabecera pasa a dos filas — icono de cesta arriba a la derecha, enlaces de texto centrados abajo en su propia fila (`flex-wrap` + `order`), en vez de colapsar a un menú hamburguesa.

### Status Pill (componente de firma)
Insignia de estado de pedido en el panel de administración — el componente más distintivo del sistema porque codifica un flujo de negocio completo (pendiente → confirmado → enviado → entregado, o cancelado) en color.
- **Style:** pastilla pequeña, texto en mayúsculas, `letter-spacing:.03em`, un par fondo/texto tintado por estado: pendiente (`#fdf1d9`/`#8a6100`), confirmado (`#e3edf7`/Azul Acero de Taller — Profundo), enviado (`#ece6fa`/`#4a3592`), entregado (`#e0f2e6`/Éxito), cancelado (`#fbe4e2`/Alerta). La misma paleta reaparece como borde izquierdo de 4px en la tarjeta de pedido completa, no solo en la insignia.

### Payment Method Picker (componente de firma)
Selector de forma de pago en los formularios de personalización — una tarjeta que envuelve un radio nativo oculto en vez de un radio visible.
- **Style:** tarjeta con borde de 2px Niebla de Taller, esquinas de 12px, logo de la forma de pago centrado.
- **State:** seleccionado = borde Azul Acero de Taller — Profundo + halo de `box-shadow` de 3px al `18%` de opacidad + fondo `#f3f8fc`. Usa `:has(input:checked)` como mecanismo principal, con una clase `.selected` como respaldo para navegadores sin soporte de `:has`.

## Do's and Don'ts

### Do:
- **Do** usar la diferencia de color Lienzo/Blanco Ficha como primer recurso de profundidad antes de recurrir a `--shadow` o `--shadow-lg`.
- **Do** dar feedback táctil con `scale(.96–.97)` en `:active` a cualquier control nuevo, usando `--ease-out` — es la firma de interacción de todo el sistema.
- **Do** respetar `prefers-reduced-motion`: el sistema ya pausa el carrusel del hero y desactiva los `transform` de hover/entrada bajo esa media query; cualquier animación nueva debe registrarse ahí también.
- **Do** reservar la pastilla completa (999px) para controles de acción/filtro y el panel de 12px+ para contenedores de contenido (*Regla Pastilla-o-Panel*).

### Don't:
- **Don't** introducir texturas de madera, tipografía manuscrita o iconografía "hecho a mano" — es la anti-referencia confirmada de "El Atelier".
- **Don't** añadir un tercer rojo de estado. Elige `#b3261e` o `#c0392b` según el patrón más cercano ya existente (ver *Regla del Doble Rojo*).
- **Don't** usar `#25D366` (verde WhatsApp) fuera del botón flotante y `.btn-whatsapp`; es un color de marca ajeno, no un acento del sistema.
- **Don't** dar a un campo de formulario nuevo un tratamiento de foco distinto al del resto (ninguno, salvo el buscador) sin, antes, decidir explícitamente cerrar esa brecha de accesibilidad en todos los campos a la vez.
