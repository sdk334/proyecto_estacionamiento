# PARK / 10 - Aplicación Móvil para Android 14+ (API 34) e IoT

Aplicación de control de estacionamiento por código QR desarrollada en **HTML5, CSS3, JavaScript y Kotlin**, lista para compilar en **Android Studio** para **Android 14 en adelante (API 34/35)**.

---

## Funciones Reales Implementadas (Sin Simulación)

### 1. Lector de Cámara QR Real y Decodificación de Fotos (`qr-scanner.js`):
- **Cámara física:** Accede a la cámara trasera real del dispositivo mediante `navigator.mediaDevices.getUserMedia` con autofoco.
- **Doble motor de decodificación:** 
  1. API nativa de Android 14 `BarcodeDetector` (Acelerado por hardware en Chromium).
  2. Motor integrado `jsQR` (100% offline, analiza frames de video o imágenes sin necesidad de conexión a internet).
- **Decodificación de fotos de la galería:** Permite subir o tomar fotos de un ticket arrugado o impreso; el motor extrae los píxeles reales y decodifica el QR.
- **Entrada manual de tickets:** Si la cámara física está dañada, el usuario puede teclear su número de ticket (ej. `#ET-00042`) para consultar directamente su estado.
- **Linterna / Flash:** Soporta encendido y apagado de flash en hardware compatible vía `CameraManager` nativo y restricciones HTML5.
- **Respuesta háptica:** Vibración del dispositivo (`navigator.vibrate` / `VibratorManager` en Android) al detectar un ticket válido.

### 2. Generador de Códigos QR en Vivo (`qrcode.bundle.js`):
- Genera códigos QR reales y escaneables en tiempo real sobre elementos `<canvas>` tanto en **"Tu ticket"** como en **"Ticket pagado"**.
- El código generado en la pantalla de salida contiene los datos validados (`PARK10:#ET-00042:PAID:...`) para que los sensores de la pluma/barrera de salida lo lean desde la pantalla del teléfono.

### 3. Motor IoT y Persistencia Real (`iot-service.js`):
- **Cálculo de tiempo y tarifa en vivo:** Calcula el tiempo transcurrido exacto con base en la hora de entrada (`Date.now() - entryTime`). Tarifa: $20.00/hr con redondeo por fracción.
- **Tolerancia real de 20 minutos:** Al pagar el ticket, registra la hora exacta de cobro y activa una cuenta regresiva de **20 minutos persistente** contra el reloj del sistema (no se reinicia al cerrar la app).
- **Control de cajones IoT:** Mantiene el estado de ocupación de los 10 cajones en almacenamiento local persistente y cuenta con interfaz para conectar sensores de ultrasonido/ESP32 vía REST HTTP (`syncSpotWithBackend`).

### 4. Proyecto Nativo para Android 14+ (`android/`):
- **Configuración de Gradle:**
  - `compileSdk = 34` (Android 14 UpsideDownCake)
  - `targetSdk = 34`
  - `minSdk = 26` (Android 8.0+)
  - Gradle Wrapper 8.5 integrado.
- **Permisos de Android 14 (`AndroidManifest.xml`):**
  - `android.permission.CAMERA`
  - `android.permission.VIBRATE`
  - `android.permission.INTERNET`
  - `android.permission.POST_NOTIFICATIONS` (Requerido en Android 13/14+)
- **MainActivity en Kotlin (`MainActivity.kt`):**
  - **Edge-to-Edge nativo:** Barra de estado y navegación adaptadas al diseño moderno con `WindowInsetsControllerCompat`.
  - **Selector de archivos nativo:** Implementa `WebChromeClient.onShowFileChooser` para que `<input type="file">` abra el selector de fotos y cámara nativo de Android 14.
  - **Notificaciones locales nativas:** Envía una notificación al sistema Android al confirmar el pago indicando los 20 minutos de tolerancia y la hora límite.
  - **Auto-concesión de cámara en WebView:** Intercepta `WebChromeClient.onPermissionRequest` para conceder la cámara al escáner sin pantallas intermedias.
  - **JavaScriptInterface (`AndroidBridge`):** Puente de comunicación bidireccional entre la interfaz web y las APIs nativas de Android (vibración, linterna, toasts, notificaciones).
  - **Assets integrados:** Los archivos web se empaquetan en `app/src/main/assets/` para funcionar sin internet (100% offline).

---

## Estructura del Proyecto Organizada por Apps

El proyecto está organizado de forma modular, separando las aplicaciones y sus respectivos proyectos nativos de Android:

```
c:\Users\sdk\Music\iot app\
├── cliente-app/                # APP CLIENTE (Estacionamiento IoT / Escáner de Tickets)
│   ├── index.html              # Interfaz móvil del cliente (Inicio, QR y Estatus)
│   ├── styles.css              # Estilos responsivos Edge-to-Edge
│   ├── app.js                  # Controlador de la aplicación del cliente
│   ├── qr-scanner.js           # Escáner de QR con cámara real y fotos (jsQR)
│   ├── iot-service.js          # Control de cajones, tarifas y puente Android
│   ├── firebase-service.js     # Sincronización en la nube (Firestore)
│   ├── qrcode.bundle.js        # Generador offline de QR
│   ├── jsqr.bundle.js          # Decodificador de imágenes y frames
│   └── android/                # Proyecto nativo de Android Studio (com.park10.iot)
│       └── app/src/main/...
│
├── totem-app/                  # APP TÓTEM (Kiosko Expendedor / Impresora Térmica)
│   ├── index.html              # Interfaz kiosko del Tótem
│   ├── styles.css              # Estilos de pantalla para kiosko / punto de acceso
│   ├── totem.js                # Lógica de emisión y generación de tickets
│   ├── escpos-printer.js       # Driver de impresión térmica ESC/POS por Bluetooth
│   ├── firebase-totem.js       # Sincronización de tickets del kiosko con Firebase
│   ├── qrcode.bundle.js        # Generador offline de QR para tickets
│   ├── totem_screen.png        # Captura de pantalla de la app Tótem
│   └── android/                # Proyecto nativo de Android Studio (com.park10.totem)
│       └── app/src/main/...
│
├── instalar_app.bat            # Menú interactivo para compilar e instalar APKs por ADB
├── package.json                # Scripts npm para ejecutar y sincronizar assets
└── iot_parking_expansion_plan.md # Plan de arquitectura y expansión del sistema
```

---

## Cómo Ejecutar y Probar

### Opción 1: En tu Navegador Web

- **App Cliente:**
  ```bash
  npm run start:cliente
  # Disponible en: http://localhost:8080
  ```
- **App Tótem:**
  ```bash
  npm run start:totem
  # Disponible en: http://localhost:8081
  ```

### Opción 2: Instalador Automático en Dispositivos Android (ADB)
Ejecuta el script incluido en la raíz del proyecto:
```cmd
instalar_app.bat
```
El instalador te permitirá:
1. Sincronizar archivos y compilar/instalar la **App Tótem**.
2. Sincronizar archivos y compilar/instalar la **App Cliente**.
3. Compilar e instalar **ambas aplicaciones** a la vez.

### Opción 3: En Android Studio
- Para la **App Cliente**, abre en Android Studio la carpeta: `c:\Users\sdk\Music\iot app\cliente-app\android`.
- Para la **App Tótem**, abre en Android Studio la carpeta: `c:\Users\sdk\Music\iot app\totem-app\android`.
- Para sincronizar cambios del frontend a los assets de Android:
  ```bash
  npm run sync:cliente   # Para la App Cliente
  npm run sync:totem     # Para la App Tótem
  npm run sync:all       # Para ambas
  ```
