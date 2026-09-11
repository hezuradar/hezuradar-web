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
sesión con el email/contraseña del paso 5 y gestionarlos.

> Estos datos de `firebaseConfig` (apiKey, projectId...) no son secretos — están pensados para ir en
> el código de cualquier app web. La seguridad real la dan las reglas de Firestore del paso 3 y tu
> contraseña de administrador.

## Notas

- El botón "Añadir" de cada producto lo mete en la cesta; desde la cesta se rellenan los datos de
  envío y se confirma el pedido, que se envía por WhatsApp y (si has configurado Firebase) queda
  guardado para gestionarlo desde el panel.
- No hay cobro online: el pago se acuerda por WhatsApp, como en la web de referencia.
- Todas las fotos y textos de producto se importaron desde la tienda original de HezurAdar.
