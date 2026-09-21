# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Luthiers (profesionales y aficionados) que construyen o reparan instrumentos (guitarras, bajos, instrumentos medievales) y trabajan ellos mismos la materia prima en bruto (cejuelas y silletas sin tallar en hueso, cuerno y madre perla/abalone) — audiencia principal. Músicos (guitarristas, bajistas) que compran piezas de accesorio ya terminadas y listas para montar (púas, cejuelas talladas, pines de puente) son una audiencia secundaria dentro del mismo catálogo.

## Product Purpose

Vender materia prima artesanal (hueso y cuerno natural, madre perla/abalone) para luthería, además de piezas de accesorio ya terminadas (púas, cejuelas talladas, pines de puente). Incluye un servicio de personalización: el cliente sube su propio diseño (PDF o DXF) y lo ajusta sobre una placa o púa para pedir presupuesto de grabado a medida. Éxito = pedidos completados (carrito → WhatsApp, con registro en Firestore) y clientes que vuelven por la calidad y consistencia del material.

## Positioning

Material 100% artesanal, procesado de forma lenta y controlada sin productos químicos (según "Quiénes somos"), combinado con la posibilidad real de personalización (subir un diseño propio y grabarlo en hueso/cuerno natural). Ninguno de los dos pesa más que el otro: calidad de material + personalización real son igual de centrales frente a otros vendedores de materia prima para luthería.

## Operating Context

Mercado principal España (el "Quiénes somos" bilingüe ES/EN mira a futuro, no es la audiencia central hoy). Sitio estático publicado en GitHub Pages con dominio propio (CNAME), sin backend propio. Panel de administración privado (`admin.html`, no enlazado desde el menú público) protegido por PIN local + Personal Access Token de GitHub; cada acción sobre el catálogo hace commit directo al repositorio (sube imágenes a `images/products/` y actualiza `data/products.json`). Los pedidos del carrito se guardan también en Firestore para que el panel los gestione (confirmado/enviado/entregado), autenticando al admin con Firebase Authentication; sin Firebase configurado, el pedido igualmente se envía por WhatsApp pero sin quedar registrado. Herramientas de personalización (`disenador.html` para placas 32×32 mm, `disenador-puas.html` para púas 27×32 mm) permiten subir PDF/DXF, elegir material entre 5 opciones (resina madre perla, cuerno de buey negro/ámbar/ankola, hueso blanco) y ajustar el diseño sobre la pieza antes de pedir presupuesto; pedido mínimo de 20 unidades en púas personalizadas.

## Capabilities and Constraints

Catálogo con carrito de compra; checkout que abre WhatsApp con el pedido estructurado. 61 productos en dos líneas: materia prima en bruto por material (Hueso, Cuerno, Madre Perla y Abalone) y tipo de pieza (Cejuela, Silleta, Custom), y accesorios terminados (Púas, Cejuelas Talladas, Pines). Sin servidor propio: toda escritura de datos pasa por commits a GitHub (catálogo) o Firestore (pedidos). Sin proceso de build; HTML/CSS/JS servidos directamente, sin framework.

## Brand Commitments

Nombre: HezurAdar. Ubicados en Legazpi. Logo en `images/site/logo.jpg`. Instagram: @hezuradar. Contacto: hezuradar@gmail.com / WhatsApp +34653713428.

## Evidence on Hand

Texto "Quiénes somos" real (bilingüe ES/EN) en `data/store.json`. Fotos de producto reales en `images/products/`. Sin testimonios, casos de estudio ni prensa — no inventar ninguno.

## Product Principles

- El material y su procesado artesanal sin químicos son la base de la confianza del cliente: no sacrificar esa narrativa por conveniencia visual.
- La personalización (subir tu propio diseño) es un producto real, no un adorno: debe sentirse tan cuidada como el catálogo principal.
- El luthier es el usuario que más decide: el catálogo y sus herramientas deben hablar su lenguaje técnico (materiales, tipos de pieza) antes que el de un comprador ocasional.
- Todo pedido debe poder cerrarse sin fricción incluso sin backend propio (WhatsApp + Firestore como red de seguridad, no como bloqueo).
