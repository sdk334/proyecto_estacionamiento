/**
 * PARK / 10 - Generador de Comandos ESC/POS Universal para Impresoras Térmicas Bluetooth
 * Compatible con impresoras de 58mm (PT-280, GOOJPRT, MPT-II, POS-58, Xprinter) y 80mm.
 * Utiliza modo mapa de bits rasterizado (GS v 0) para imprimir códigos QR nítidos en 100% de impresoras.
 */

class ESCPOSPrinter {
  constructor() {
    this.buffer = [];
  }

  reset() {
    this.buffer = [];
    return this;
  }

  // Inicializar impresora (ESC @)
  init() {
    this.buffer.push(0x1B, 0x40);
    return this;
  }

  // Alineación: 0 = Izquierda, 1 = Centro, 2 = Derecha (ESC a n)
  align(alignment = 1) {
    this.buffer.push(0x1B, 0x61, alignment);
    return this;
  }

  // Negrita: true/false (ESC E n)
  bold(enable = true) {
    this.buffer.push(0x1B, 0x45, enable ? 0x01 : 0x00);
    return this;
  }

  // Tamaño de texto: 0x00 = Normal, 0x11 = Doble altura y anchura (GS ! n)
  textSize(size = 0x00) {
    this.buffer.push(0x1D, 0x21, size);
    return this;
  }

  // Añadir texto con codificación
  text(str) {
    for (let i = 0; i < str.length; i++) {
      let code = str.charCodeAt(i);
      // Reemplazo básico de caracteres especiales en ASCII latino
      if (code === 225) code = 160; // á
      else if (code === 233) code = 130; // é
      else if (code === 237) code = 161; // í
      else if (code === 243) code = 162; // ó
      else if (code === 250) code = 163; // ú
      else if (code === 241) code = 164; // ñ
      else if (code === 209) code = 165; // Ñ
      else if (code > 127) code = 63;   // ?
      this.buffer.push(code);
    }
    return this;
  }

  line(str = '') {
    this.text(str);
    this.buffer.push(0x0A); // \n
    return this;
  }

  feed(lines = 2) {
    for (let i = 0; i < lines; i++) {
      this.buffer.push(0x0A);
    }
    return this;
  }

  // Separador de guiones
  divider(char = '-', length = 32) {
    this.line(char.repeat(length));
    return this;
  }

  /**
   * Imprime un Canvas como mapa de bits rasterizado ESC/POS (GS v 0).
   * Este es el estándar universal que soporta el 100% de impresoras térmicas
   * (incluyendo la PT-280, que no soporta el comando Epson GS ( k).
   * 
   * Centra automáticamente la imagen en los 384 puntos del cabezal de 58mm.
   */
  rasterImageFromCanvas(canvas, centerIn384 = true) {
    if (!canvas || !canvas.getContext) {
      console.warn('[ESCPOS] Canvas inválido para rasterizar');
      return this;
    }

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const rgba = imgData.data;

    // Para impresoras 58mm el ancho imprimible es de 384 puntos = 48 bytes
    const targetBytesPerRow = (centerIn384 && width <= 384) ? 48 : Math.ceil(width / 8);
    const qrBytes = Math.ceil(width / 8);
    const leftPadBytes = (centerIn384 && width <= 384) ? Math.max(0, Math.floor((48 - qrBytes) / 2)) : 0;

    const xL = targetBytesPerRow % 256;
    const xH = Math.floor(targetBytesPerRow / 256);
    const yL = height % 256;
    const yH = Math.floor(height / 256);

    // Comando ESC/POS: GS v 0 0 xL xH yL yH
    this.buffer.push(0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH);

    for (let y = 0; y < height; y++) {
      const rowBytes = new Uint8Array(targetBytesPerRow);
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = rgba[idx];
        const g = rgba[idx + 1];
        const b = rgba[idx + 2];
        const a = rgba[idx + 3];

        // Determinar pixel negro (opaco y oscuro)
        const isBlack = a > 120 && (r * 0.299 + g * 0.587 + b * 0.114) < 140;
        if (isBlack) {
          const targetX = (leftPadBytes * 8) + x;
          const byteIdx = Math.floor(targetX / 8);
          const bitIdx = 7 - (targetX % 8);
          if (byteIdx < targetBytesPerRow) {
            rowBytes[byteIdx] |= (1 << bitIdx);
          }
        }
      }

      for (let b = 0; b < targetBytesPerRow; b++) {
        this.buffer.push(rowBytes[b]);
      }
    }

    // Salto de línea tras la imagen para limpiar buffer de raster
    this.buffer.push(0x0A);
    return this;
  }

  // Corte de papel o avance amplio para barra dentada manual
  cut() {
    this.feed(4);
    this.buffer.push(0x1D, 0x56, 0x42, 0x00);
    return this;
  }

  // Retorna el array de bytes listos para enviar por Bluetooth
  getBytes() {
    return new Uint8Array(this.buffer);
  }

  // Convierte los bytes a Base64 para enviarlos al puente de Android (AndroidBridge)
  toBase64() {
    const uint8 = this.getBytes();
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
  }
}

/**
 * Generador de ticket completo de estacionamiento PARK / 10
 * Ahora utiliza rasterImageFromCanvas (GS v 0) para imprimir el QR en cualquier impresora.
 */
async function buildParkingTicketESC(ticket, qrCanvas = null) {
  const p = new ESCPOSPrinter();
  const entryDate = new Date(ticket.entryTime || Date.now());
  const dateFormatted = `${entryDate.toLocaleDateString('es-MX')} ${entryDate.getHours().toString().padStart(2, '0')}:${entryDate.getMinutes().toString().padStart(2, '0')} hrs`;

  p.init()
   .align(1) // Centrado
   .textSize(0x11) // Grande
   .bold(true)
   .line('PARK / 10')
   .textSize(0x00) // Normal
   .bold(false)
   .line('Estacionamiento Inteligente')
   .line('Control de Acceso IoT')
   .feed(1)
   .divider('=', 32)
   .align(0) // Izquierda
   .bold(true)
   .line(`TICKET:   ${ticket.id}`)
   .line(`CAJON:    Lugar ${ticket.spot}`)
   .line(`ENTRADA:  ${dateFormatted}`)
   .line(`TARIFA:   $20.00 / hora`)
   .bold(false)
   .divider('-', 32)
   .align(1) // Centrado
   .feed(1);

  // Asegurar Canvas con el código QR generado
  let canvas = qrCanvas;
  if (!canvas || !canvas.getContext || canvas.width !== 192) {
    canvas = document.createElement('canvas');
    if (window.QRCode && window.QRCode.toCanvas) {
      await window.QRCode.toCanvas(canvas, ticket.id, {
        width: 192,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' }
      });
    }
  }

  // Imprimir código QR como mapa de bits rasterizado universal (GS v 0)
  if (canvas && canvas.getContext) {
    p.rasterImageFromCanvas(canvas, true);
  }

  p.feed(1)
   .bold(true)
   .line(`CODIGO: ${ticket.id}`)
   .bold(false)
   .feed(1)
   .line('1. Escanea este QR en la app')
   .line('2. Paga antes de salir')
   .line('3. Tienes 20 min de tolerancia')
   .feed(1)
   .bold(true)
   .line('¡GRACIAS POR SU VISITA!')
   .cut();

  return p;
}

window.ESCPOSPrinter = ESCPOSPrinter;
window.buildParkingTicketESC = buildParkingTicketESC;
