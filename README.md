# Sitio de instalación de Jarvis

Esta carpeta contiene una página estática para distribuir Jarvis en Windows y Android.

## Windows

El botón de Windows descarga `downloads/Jarvis-Setup.exe`. Después de descargarlo:

1. Ejecuta el instalador.
2. Jarvis se instala en `%LOCALAPPDATA%\Programs\Jarvis`.
3. El instalador crea accesos directos en el escritorio y el menú Inicio y abre Jarvis al terminar.

El instalador ya incluye el runtime de escritorio, por lo que no necesita Node.js instalado. El servidor de Jarvis solo escucha en `127.0.0.1`.

## Android

El botón «Abrir e instalar Jarvis» descarga el APK nativo oficial:

`https://github.com/rmcarmwrestling-sys/jarvis-installer/releases/download/v1.2.0/app-release.apk`

Después de la descarga, abre el APK y confirma «Instalar». Android puede pedir que permitas temporalmente la instalación desde el navegador. La aplicación incluye una copia local de la interfaz real de Jarvis, así que puede abrirse aunque GitHub Pages esté temporalmente inaccesible; el chat necesita conexión a internet. Guarda su configuración en el móvil y solicita permiso de micrófono solo cuando es necesario.

El APK usa la misma interfaz de Jarvis que la aplicación de Windows, pero las funciones de control de Windows siguen siendo exclusivas del ordenador. El chat de Android utiliza OpenRouter directamente desde el móvil.

## Probar localmente

Desde esta carpeta, con Node.js instalado, ejecuta `Abrir-Jarvis-web.bat`. El script sirve la página en la red local y muestra una dirección como `http://192.168.1.25:4173/`.

Conecta el móvil a la misma red Wi‑Fi que el ordenador y pega esa dirección exacta en Chrome o Edge del móvil. No uses `localhost`, `127.0.0.1` ni una ruta `C:\...`: esas direcciones apuntan al propio móvil o solo existen en el ordenador.

También puedes iniciar un servidor estático manualmente:

```powershell
node serve.mjs
```

Después abre la URL de red que muestre el comando. Para publicar el sitio en internet y que funcione fuera de tu Wi‑Fi, hay que subir todos los archivos a un hosting HTTPS manteniendo la carpeta `downloads/`.
