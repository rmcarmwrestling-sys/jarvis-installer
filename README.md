# Sitio de instalación de Jarvis

Esta carpeta contiene una página estática para distribuir Jarvis en Windows y Android.

## Windows

El botón de Windows descarga `downloads/Jarvis-Setup.exe`. Después de descargarlo:

1. Ejecuta el instalador.
2. Jarvis se instala en `%LOCALAPPDATA%\Programs\Jarvis`.
3. El instalador crea accesos directos en el escritorio y el menú Inicio y abre Jarvis al terminar.

El instalador ya incluye el runtime de escritorio, por lo que no necesita Node.js instalado. El servidor de Jarvis solo escucha en `127.0.0.1`.

## Android

La página se puede instalar como PWA desde Chrome o Edge para Android. El botón «Instalar en Android» usa el aviso nativo del navegador cuando está disponible; si no, el usuario puede abrir el menú del navegador y elegir «Instalar aplicación» o «Añadir a pantalla de inicio».

Para que el aviso de instalación funcione, sirve esta carpeta mediante HTTPS o desde `localhost`. No se presenta un APK falso: la versión Android de esta entrega es una aplicación web instalable (PWA).

## Probar localmente

Desde esta carpeta, con Node.js instalado, ejecuta `Abrir-Jarvis-web.bat`. El script sirve la página en la red local y muestra una dirección como `http://192.168.1.25:4173/`.

Conecta el móvil a la misma red Wi‑Fi que el ordenador y pega esa dirección exacta en Chrome o Edge del móvil. No uses `localhost`, `127.0.0.1` ni una ruta `C:\...`: esas direcciones apuntan al propio móvil o solo existen en el ordenador.

También puedes iniciar un servidor estático manualmente:

```powershell
node serve.mjs
```

Después abre la URL de red que muestre el comando. Para publicar el sitio en internet y que funcione fuera de tu Wi‑Fi, hay que subir todos los archivos a un hosting HTTPS manteniendo la carpeta `downloads/`.
