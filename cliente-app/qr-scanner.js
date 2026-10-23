/**
 * QR Scanner Engine para Android 14+ y Web Móvil
 * Soporta:
 * 1. BarcodeDetector nativo (Acelerado por GPU en Android 14)
 * 2. Motor jsQR integrado para análisis de frames y archivos offline sin dependencias externas
 * 3. Decodificación real de fotos tomadas o seleccionadas de la galería
 * 4. Control de Linterna (Flash) nativa vía AndroidBridge y HTML5 MediaTrack
 * 5. Retroalimentación háptica (Vibración)
 */

class RealQRScanner {
  constructor(videoElement, canvasElement, onScanCallback) {
    this.video = videoElement;
    this.canvas = canvasElement || document.createElement('canvas');
    this.onScan = onScanCallback;
    this.stream = null;
    this.isScanning = false;
    this.animFrameId = null;
    this.hasBarcodeDetector = ('BarcodeDetector' in window);
    this.detector = null;

    if (this.hasBarcodeDetector) {
      try {
        this.detector = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'ean_13', 'code_39'] });
      } catch (e) {
        console.warn('BarcodeDetector format error, using jsQR fallback:', e);
        this.hasBarcodeDetector = false;
      }
    }
  }

  /**
   * Inicia la cámara real del dispositivo (Android 14+)
   */
  async startCamera() {
    try {
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      this.video.setAttribute("playsinline", "true");
      await this.video.play();

      this.isScanning = true;
      this.scanLoop();
      return { success: true };
    } catch (err) {
      console.error("Error al acceder a la cámara:", err);
      return {
        success: false,
        error: err.name || "PermissionDenied",
        message: err.message
      };
    }
  }

  /**
   * Detiene el flujo de la cámara
   */
  stopCamera() {
    this.isScanning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  /**
   * Bucle continuo de detección de frames
   */
  async scanLoop() {
    if (!this.isScanning) return;

    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      // 1. Intentar con BarcodeDetector nativo de Android 14
      if (this.hasBarcodeDetector && this.detector) {
        try {
          const barcodes = await this.detector.detect(this.video);
          if (barcodes.length > 0 && barcodes[0].rawValue) {
            this.handleDetectedCode(barcodes[0].rawValue);
            return;
          }
        } catch (e) {}
      }

      // 2. Fallback con motor jsQR leyendo el frame de canvas
      if (window.jsQR && this.canvas) {
        try {
          const width = this.video.videoWidth;
          const height = this.video.videoHeight;
          if (width > 0 && height > 0) {
            this.canvas.width = width;
            this.canvas.height = height;
            const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(this.video, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: "dontInvert"
            });
            if (code && code.data) {
              this.handleDetectedCode(code.data);
              return;
            }
          }
        } catch (e) {}
      }
    }

    if (this.isScanning) {
      this.animFrameId = requestAnimationFrame(() => this.scanLoop());
    }
  }

  /**
   * Decodifica un archivo de imagen real subido por el usuario (Galería o captura)
   */
  async scanImageFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = async () => {
        try {
          // 1. Probar con BarcodeDetector
          if (this.hasBarcodeDetector && this.detector) {
            try {
              const barcodes = await this.detector.detect(img);
              if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                URL.revokeObjectURL(objectUrl);
                const code = barcodes[0].rawValue;
                this.handleDetectedCode(code);
                resolve({ success: true, code });
                return;
              }
            } catch (e) {}
          }

          // 2. Probar con jsQR
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(objectUrl);

          if (window.jsQR) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = window.jsQR(imageData.data, imageData.width, imageData.height);
            if (code && code.data) {
              this.handleDetectedCode(code.data);
              resolve({ success: true, code: code.data });
              return;
            }
          }

          resolve({ success: false, error: 'No se detectó ningún código QR en la imagen.' });
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(err);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('No se pudo leer la imagen'));
      };

      img.src = objectUrl;
    });
  }

  /**
   * Procesa el código QR detectado con vibración háptica
   */
  handleDetectedCode(codeText) {
    this.stopCamera();

    // Retroalimentación háptica en Android nativo y Web
    if (window.Android && window.Android.vibrate) {
      window.Android.vibrate(80);
    } else if (navigator.vibrate) {
      navigator.vibrate([60, 40, 60]);
    }

    if (typeof this.onScan === 'function') {
      this.onScan(codeText);
    }
  }

  /**
   * Alterna la linterna (Flash) vía puente nativo Android o MediaStream
   */
  async toggleTorch(enable) {
    // 1. Probar por control nativo Android 14
    if (window.Android && typeof window.Android.toggleTorch === 'function') {
      try {
        const ok = window.Android.toggleTorch(enable);
        if (ok) return true;
      } catch (e) {
        console.warn('Native torch error:', e);
      }
    }

    // 2. Probar por HTML5 MediaTrack
    if (!this.stream) return false;
    const track = this.stream.getVideoTracks()[0];
    if (!track) return false;

    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    if (capabilities.torch) {
      try {
        await track.applyConstraints({
          advanced: [{ torch: enable }]
        });
        return true;
      } catch (e) {
        console.warn("Torch constraint failed:", e);
      }
    }
    return false;
  }
}
