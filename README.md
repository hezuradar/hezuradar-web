# HezurAdar — web

Catálogo estático de HezurAdar (hueso y cuerno natural para luthería), listo para publicarse gratis en **GitHub Pages**. Incluye un panel de administración privado para añadir, editar y borrar productos sin tocar código.

## Estructura

```
index.html            tienda pública
admin.html             panel de administración (no enlazado desde el menú)
assets/css/style.css   estilos
assets/js/main.js      lógica de la tienda
assets/js/admin.js     lógica del panel de administración
data/products.json     catálogo de productos
data/store.json        datos de contacto / quiénes somos
images/products/       fotos de producto
images/site/           logo y foto de portada
```

## 1. Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub (puede ser privado o público; si es privado necesitas GitHub Pro/Team para activar Pages).
2. Sube todo el contenido de esta carpeta a la raíz del repositorio (`git init`, `git add .`, `git commit`, `git push`).
3. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, elige la rama (`main`) y carpeta `/ (root)`.
4. En un par de minutos tu web estará en `https://<tu-usuario>.github.io/<repo>/`.

```bash
git init
git add .
git commit -m "Primera versión de la web"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/<repo>.git
git push -u origin main
```

## 2. Panel de administración (`/admin.html`)

Es la **única parte visible solo para ti**: no aparece en ningún menú de la web pública, solo tú conoces su URL (`https://<tu-usuario>.github.io/<repo>/admin.html`). Tiene dos pestañas: **Productos** (lo de abajo) y **Pedidos** (ver sección 4).

Funciona en dos capas:

- **PIN local**: la primera vez que entras, eliges un PIN. Se guarda cifrado (hash) en el navegador que uses. Solo oculta el panel a quien abra la página por curiosidad; no es una contraseña de servidor porque GitHub Pages no tiene servidor.
- **Token de GitHub**: es la protección real. Para publicar cambios necesitas un *Personal Access Token* con permiso de escritura sobre el repositorio. Sin ese token nadie puede modificar el catálogo, aunque conozca la URL del panel y el PIN.

### Crear el token

1. Ve a GitHub → foto de perfil → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Dale acceso solo a este repositorio (`Only select repositories`) y en **Repository permissions** activa `Contents: Read and write`.
3. Genera el token y cópialo (empieza distinto según el tipo; guárdalo en un gestor de contraseñas, no lo compartas).
4. En `admin.html`, rellena usuario, repositorio, rama (`main`) y pega el token en "Personal Access Token" → **Guardar conexión**.

El token se guarda solo en `localStorage` de tu navegador: no se sube al repositorio ni se envía a ningún sitio que no sea `api.github.com`.

### Añadir / editar / borrar productos

Desde el panel puedes crear un producto (título, descripción, precio, stock, categoría, subcategoría, imágenes) o editar/borrar uno existente. Cada acción hace un commit directo al repositorio (sube las imágenes a `images/products/` y actualiza `data/products.json`). GitHub Pages tarda entre 30 segundos y 2 minutos en desplegar el cambio.

## 3. Editar los textos de "Quiénes somos" y contacto

Edita `data/store.json` (nombre, email, WhatsApp, Instagram y el texto "Quiénes somos").

## 4. Carrito, pedidos y WhatsApp

La tienda tiene cesta de la compra: el cliente añade productos, rellena sus datos de envío y contacto,
y al confirmar el pedido se abre WhatsApp con el resumen ya redactado para que os pongáis de acuerdo
en el pago y la entrega — igual que antes, pero ahora con un pedido estructurado en vez de un mensaje
por producto.

Para que esos pedidos queden también **guardados y gestionables desde tu panel de administración**
(marcar como confirmado, enviado, entregado...), la web usa una base de datos gratuita de Google
llamada **Firebase**. Es necesaria porque una web estática de GitHub Pages no tiene servidor propio
donde guardar datos: Firebase hace de "buzón" — cualquier visitante puede dejar un pedido, pero
**solo tú puedes leerlos**, iniciando sesión con tu cuenta de administrador.

Si no configuras Firebase, la tienda funciona igual (el pedido se sigue enviando por WhatsApp), pero
no se guardará ningún historial y la pestaña "Pedidos" del panel quedará vacía.

### Crear el proyecto Firebase (una sola vez, ~10 minutos)

1. Ve a [console.firebase.google.com](https://console.firebase.google.com) y crea un proyecto nuevo
   (puedes desactivar Google Analytics, no hace falta).
2. En el menú lateral, entra en **Compilación → Firestore Database** → **Crear base de datos** →
   elige una ubicación de Europa (p.ej. `eur3`) → modo **producción**.
3. Dentro de Firestore, pestaña **Reglas**, sustituye el contenido por esto y publica:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /orders/{orderId} {
         allow create: if true;
         allow read, update, delete: if request.auth != null;
       }
     }
   }
   ```

   Esto permite que cualquiera pueda **crear** un pedido (es lo que hace la cesta de la compra), pero
   solo alguien que haya iniciado sesión (tú) puede **leerlos o modificarlos**.
4. En **Compilación → Authentication** → pestaña **Sign-in method**, activa el proveedor
   **Correo electrónico/contraseña**.
5. Pestaña **Users** → **Add user**: crea tu usuario administrador (el email y contraseña con los que
   entrarás en la pestaña "Pedidos" del panel).
6. Icono de engranaje (arriba a la izquierda) → **Configuración del proyecto** → pestaña **Tus apps**
   → botón **</>** (app web) → dale un nombre y regístrala. Copia el bloque `firebaseConfig` que te
   muestra.
7. Pega esos valores en [assets/js/firebase-config.js](assets/js/firebase-config.js), reemplazando los
   valores de ejemplo (`TU_API_KEY`, etc.). Sube el cambio al repositorio.

Con esto, la cesta ya guardará los pedidos y en `admin.html` → pestaña **Pedidos** podrás iniciar
sesión con el email/contraseña del paso 5 y gestionarlos: crear pedidos manuales (por ejemplo, uno
que te llegue por teléfono), editar cualquier dato o los productos de un pedido existente, borrarlos,
y consultar el **total facturado** filtrando por rango de fechas (no cuenta los pedidos cancelados).

> Estos datos de `firebaseConfig` (apiKey, projectId...) no son secretos — están pensados para ir en
> el código de cualquier app web. La seguridad real la dan las reglas de Firestore del paso 3 y tu
> contraseña de administrador.

## 5. Aviso por email de cada pedido (EmailJS)

Además de abrirse WhatsApp, al confirmar un pedido se envía un email a `hezuradar@gmail.com` con el
resumen. Esto usa **EmailJS**, un servicio gratuito que manda correos directamente desde el
navegador del cliente sin necesitar un servidor propio (hasta 200 emails/mes gratis).

Si no lo configuras, la tienda sigue funcionando igual (WhatsApp y el guardado en Firebase no se ven
afectados); simplemente no llegará el aviso por correo.

### Configurarlo (una sola vez, ~5 minutos)

1. Crea una cuenta gratis en [emailjs.com](https://www.emailjs.com).
2. **Email Services** → **Add New Email Service** → conecta tu Gmail (`hezuradar@gmail.com`) →
   copia el **Service ID**.
3. **Email Templates** → **Create New Template**. En el asunto/cuerpo usa estas variables (tal cual,
   con las llaves dobles):
   - `{{order_code}}`, `{{items_text}}`, `{{subtotal}}`, `{{customer_name}}`, `{{customer_phone}}`,
     `{{customer_email}}`, `{{shipping_address}}`, `{{notes}}`
   - En el campo **To Email** de la plantilla pon `{{to_email}}` (o directamente
     `hezuradar@gmail.com`).
   - Guarda y copia el **Template ID**.
4. **Account** → **General** → copia tu **Public Key**.
5. Pega los tres valores en
   [assets/js/emailjs-config.js](assets/js/emailjs-config.js), reemplazando `TU_PUBLIC_KEY`,
   `TU_SERVICE_ID` y `TU_TEMPLATE_ID`. Sube el cambio al repositorio.

> Igual que con Firebase, estos identificadores no son contraseñas secretas: EmailJS está diseñado
> para usarlos en código público de cliente. El límite de envíos gratuito y la cuenta conectada son
> la protección real.

### Email de confirmación al cliente (opcional)

Además del aviso a `hezuradar@gmail.com`, si el cliente rellena su email al hacer el pedido se le
puede enviar automáticamente un correo de confirmación con el resumen del pedido en formato visual
(logo, productos, importes, forma de pago y dirección de envío). Usa la misma cuenta de EmailJS,
pero necesita **una segunda plantilla**:

1. En EmailJS, **Email Templates** → **Create New Template** (una nueva, distinta a la del aviso
   interno).
2. En **To Email** pon `{{to_email}}` (así cada correo se envía a la dirección de cada cliente).
3. En el asunto, algo como: `Pedido {{order_code}} confirmado - Hezur&Adar`.
4. En el cuerpo, cambia al editor de código (HTML) y deja únicamente: `{{{order_html}}}` (con
   triple llave) — el diseño ya viene maquetado desde la web, esta variable lo inserta tal cual.
5. Guarda y copia el **Template ID** → pégalo en
   [assets/js/emailjs-config.js](assets/js/emailjs-config.js) en `customerTemplateId`, reemplazando
   `TU_CUSTOMER_TEMPLATE_ID`. Sube el cambio al repositorio.

Si no configuras esta segunda plantilla, todo sigue funcionando igual (WhatsApp, aviso interno y
guardado en Firebase); simplemente no se enviará confirmación por email al cliente.

## 6. Personalizador de placas (`/disenador.html`)

Sección aparte de la tienda (enlazada desde el menú como "Personaliza tu placa") donde el cliente
puede subir el logo de su diseño en **PDF o DXF**, elegirlo sobre una placa de 32×32&nbsp;mm en uno
de 5 materiales (con la textura real de cada uno) y ajustarlo con el ratón/dedo: moverlo, agrandarlo,
encogerlo o girarlo. El DXF se interpreta con un parser propio (`assets/js/dxf-mini.js`, soporta
LINE/CIRCLE/ARC/LWPOLYLINE/POLYLINE) y el PDF con [pdf.js](https://mozilla.github.io/pdf.js/) de
Mozilla; el DWG (formato cerrado de AutoCAD) no se puede leer en el navegador, así que si el cliente
solo tiene un DWG se le pide que lo exporte a DXF (gratis, desde cualquier programa de CAD).

Al enviar la solicitud se guarda en la misma base de datos Firebase que los pedidos normales (con
`kind: "placa-personalizada"`, así que no requiere ninguna configuración adicional a la ya descrita
en la sección 4) y se abre WhatsApp con el resumen. Estas solicitudes aparecen en la pestaña
**Pedidos** del panel con su propio distintivo "🎨 Placa personalizada", mostrando el material, una
vista previa de cómo queda el diseño sobre la placa y un botón para descargar el archivo original
(si no pesaba demasiado para guardarlo). No cuentan en el resumen de ventas, al no ser pedidos con
precio cerrado.

> El worker de pdf.js (`assets/js/vendor/pdf.worker.min.js`) está alojado en el propio repositorio
> en vez de en un CDN externo: cargar un *web worker* de otro dominio necesita permisos de red
> adicionales en la política de seguridad (CSP) que, según el navegador, pueden dejar la carga del
> PDF colgada sin avisar. Alojarlo en local evita ese problema.

## 7. Copia de los pedidos personalizados en Google Drive

Cada pedido de placa o púa personalizada se copia a la carpeta compartida de Drive con esta
estructura:

```
<carpeta compartida>/
  <Nombre del cliente>/
    <Código del pedido>/
      HA-…-diseno.jpg          diseño ajustado sobre la pieza
      <archivo del cliente>    PDF/DXF original que subió
      HA-…-nota-pedido.pdf     nota del pedido (material, cantidad, notas y datos de contacto;
                               sin importes ni dirección de envío)
```

Se hace en dos momentos:

- **Al cerrar el pedido** el cliente en `/disenador.html` o `/disenador-puas.html` (en segundo plano,
  sin que el cliente vea nada).
- **Al pulsar "✂️ Enviar a cortar"** en el panel: vuelve a subirlo con los datos actuales
  (p.ej. ya presupuestado), reemplaza los archivos anteriores y abre la carpeta. Una vez exportado,
  el pedido muestra también un botón "📁 Drive".

La primera exportación de cada pedido manda además un correo a hezuradar@gmail.com
(`NOTIFY_EMAIL` en `Code.gs`) con la nota en PDF y el diseño adjuntos y el enlace a la carpeta.
Las reexportaciones con "Enviar a cortar" no vuelven a avisar.

Como GitHub Pages no tiene servidor, la subida la hace una aplicación web de Google Apps Script
(`scripts/drive-export/`) que se ejecuta con tu cuenta de Google. La web solo le manda el ID del
pedido; el script lo lee él mismo de Firestore, así que nadie puede usarlo para subir archivos
arbitrarios a tu Drive.

### Instalarlo (una sola vez, ~5 minutos)

1. Entra en [script.google.com](https://script.google.com) con la cuenta de Google **dueña de la
   carpeta de Drive y del proyecto Firebase** (`hezuradar-web`) → **Nuevo proyecto**. Llámalo, por
   ejemplo, "HezurAdar Drive".
2. Pega el contenido de `scripts/drive-export/Code.gs` en `Código.gs`.
3. **Configuración del proyecto** (rueda dentada) → activa *Mostrar el archivo de manifiesto
   "appsscript.json"* → vuelve al editor y sustituye ese archivo por `scripts/drive-export/appsscript.json`.
4. **Implementar → Nueva implementación → Aplicación web**. *Ejecutar como*: **Yo**;
   *Quién tiene acceso*: **Cualquier usuario**. Autoriza los permisos que pide (Drive, Firestore,
   conexiones externas y enviar correo; Google avisará de que la app no está verificada: *Configuración avanzada →
   Ir a HezurAdar Drive*).
5. Copia la URL que termina en `/exec` y pégala en `DRIVE_EXPORT_URL` de `assets/js/drive-export.js`.
   Sube el cambio.

Si más adelante modificas `Code.gs`, publica los cambios con **Implementar → Gestionar
implementaciones → Editar → Versión: nueva** para conservar la misma URL.

Si "Enviar a cortar" da un error de Firestore (403), la cuenta del script no tiene acceso al
proyecto Firebase: añádela en la consola de Firebase → *Configuración del proyecto → Usuarios y
permisos* como Propietario o Editor.

> Instalación actual: el script está en la cuenta **hezuradar@gmail.com** (dueña de la carpeta de
> Drive), proyecto "HezurAdar Drive". El proyecto Firebase es de iotegi@gmail.com y hezuradar@gmail.com
> se añadió como Editor para que el script pueda leer los pedidos.

## Notas

- El botón "Añadir" de cada producto lo mete en la cesta; desde la cesta se rellenan los datos de
  envío y se confirma el pedido, que se envía por WhatsApp, por email (si configuras EmailJS) y
  (si has configurado Firebase) queda guardado para gestionarlo desde el panel.
- No hay cobro online: el pago se acuerda por WhatsApp, como en la web de referencia.
- Todas las fotos y textos de producto se importaron desde la tienda original de HezurAdar.
