/**
 * PARK / 10 - Controlador del Tótem Kiosko de Entrada
 * Maneja emisión de tickets, conexión Bluetooth ESC/POS y sincronización Firebase.
 */

class TotemController {
  constructor() {
    this.selectedDeviceAddress = localStorage.getItem('park10_printer_mac') || '';
    this.isPrinting = false;
    this.printerConnected = false;

    this.initDOMElements();
    this.bindEvents();
    this.initFirebase();
    this.checkBluetoothBridge();
    this.updateSpotsCounter();

    // Actualizar disponibilidad periódicamente
    setInterval(() => this.updateSpotsCounter(), 10000);

    // Forzar orientación horizontal en API de pantalla web
    if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
      window.screen.orientation.lock('landscape').catch(() => {});
    }

    // Prevenir cualquier desplazamiento, arrastre o rebote de la pantalla en modo Kiosko
    document.addEventListener('touchmove', (e) => {
      if (!e.target.closest('.modal-card')) {
        e.preventDefault();
      }
    }, { passive: false });
  }

  initDOMElements() {
    this.dom = {
      btnIssueTicket: document.getElementById('btn-issue-ticket'),
      totemFreeSpots: document.getElementById('totem-free-spots'),
      dispensingCard: document.getElementById('dispensing-card'),
      dispensingTicketId: document.getElementById('dispensing-ticket-id'),
      previewQrCanvas: document.getElementById('totem-preview-qr'),
      printerStatusPill: document.getElementById('printer-status-pill'),
      printerStatusText: document.getElementById('printer-status-text'),
      btnOpenSettings: document.getElementById('btn-open-settings'),
      btnCloseSettings: document.getElementById('btn-close-settings'),
      settingsModal: document.getElementById('settings-modal'),
      selectBtDevices: document.getElementById('select-bt-devices'),
      btnRefreshBt: document.getElementById('btn-refresh-bt'),
      btnConnectPrinter: document.getElementById('btn-connect-printer'),
      btnTestPrint: document.getElementById('btn-test-print'),
      inputFirebaseUrl: document.getElementById('input-firebase-url'),
      btnSaveFirebase: document.getElementById('btn-save-firebase'),
      toast: document.getElementById('totem-toast'),
      toastMsg: document.getElementById('totem-toast-msg'),
    };

    if (this.dom.inputFirebaseUrl && window.firebaseTotem) {
      this.dom.inputFirebaseUrl.value = window.firebaseTotem.databaseUrl;
    }
  }

  bindEvents() {
    // Botón gigante para solicitar ticket
    if (this.dom.btnIssueTicket) {
      this.dom.btnIssueTicket.addEventListener('click', () => this.handleIssueTicket());
    }

    // Modal de ajustes
    if (this.dom.btnOpenSettings) {
      this.dom.btnOpenSettings.addEventListener('click', () => {
        this.dom.settingsModal.style.display = 'flex';
        this.refreshBluetoothDevices();
      });
    }

    if (this.dom.btnCloseSettings) {
      this.dom.btnCloseSettings.addEventListener('click', () => {
        this.dom.settingsModal.style.display = 'none';
      });
    }

    // Cerrar modal al hacer click afuera
    window.addEventListener('click', (e) => {
      if (e.target === this.dom.settingsModal) {
        this.dom.settingsModal.style.display = 'none';
      }
    });

    // Refrescar lista de dispositivos Bluetooth
    if (this.dom.btnRefreshBt) {
      this.dom.btnRefreshBt.addEventListener('click', () => this.refreshBluetoothDevices());
    }

    // Conectar a impresora seleccionada
    if (this.dom.btnConnectPrinter) {
      this.dom.btnConnectPrinter.addEventListener('click', () => this.connectSelectedPrinter());
    }

    // Prueba de impresión
    if (this.dom.btnTestPrint) {
      this.dom.btnTestPrint.addEventListener('click', () => this.handleTestPrint());
    }

    // Guardar Firebase URL
    if (this.dom.btnSaveFirebase) {
      this.dom.btnSaveFirebase.addEventListener('click', () => {
        const url = this.dom.inputFirebaseUrl.value.trim();
        if (url && window.firebaseTotem) {
          window.firebaseTotem.setDatabaseUrl(url);
          this.showToast('Firebase URL guardada');
          this.updateSpotsCounter();
        }
      });
    }
  }

  showToast(message) {
    if (!this.dom.toast || !this.dom.toastMsg) return;
    this.dom.toastMsg.textContent = message;
    this.dom.toast.classList.add('visible');
    setTimeout(() => {
      this.dom.toast.classList.remove('visible');
    }, 3000);
  }

  setPrinterStatus(status, text) {
    if (!this.dom.printerStatusPill || !this.dom.printerStatusText) return;
    this.dom.printerStatusPill.className = `status-indicator-pill ${status}`;
    this.dom.printerStatusText.textContent = text;
    this.printerConnected = status === 'connected';
  }

  checkBluetoothBridge() {
    // Si corre dentro del WebView Android con la interfaz nativa
    if (window.AndroidPrinter) {
      try {
        const isConn = window.AndroidPrinter.isConnected();
        if (isConn) {
          const deviceName = window.AndroidPrinter.getConnectedDeviceName() || 'Impresora Bluetooth';
          this.setPrinterStatus('connected', `Conectada: ${deviceName}`);
        } else {
          this.setPrinterStatus('connecting', 'Android: Sin impresora vinculada');
          // Intentar auto-conectar si hay una dirección guardada
          if (this.selectedDeviceAddress) {
            window.AndroidPrinter.connect(this.selectedDeviceAddress);
          }
        }
      } catch (e) {
        this.setPrinterStatus('connecting', 'Android Bluetooth Activo');
      }
    } else {
      // Entorno Navegador Web / Emulador
      this.setPrinterStatus('connected', 'Modo Virtual ESC/POS');
    }
  }

  refreshBluetoothDevices() {
    if (!this.dom.selectBtDevices) return;
    this.dom.selectBtDevices.innerHTML = '<option value="">Buscando dispositivos...</option>';

    if (window.AndroidPrinter) {
      try {
        const devicesJson = window.AndroidPrinter.getPairedDevices();
        const devices = JSON.parse(devicesJson || '[]');

        this.dom.selectBtDevices.innerHTML = '<option value="">Seleccionar impresora vinculada...</option>';
        if (devices.length === 0) {
          this.dom.selectBtDevices.innerHTML += '<option disabled>No hay dispositivos BT emparejados</option>';
          this.showToast('Empareja tu impresora en Ajustes de Android primero');
          return;
        }

        devices.forEach(dev => {
          const opt = document.createElement('option');
          opt.value = dev.address;
          opt.textContent = `${dev.name || 'Dispositivo'} (${dev.address})`;
          if (dev.address === this.selectedDeviceAddress) {
            opt.selected = true;
          }
          this.dom.selectBtDevices.appendChild(opt);
        });
      } catch (e) {
        this.dom.selectBtDevices.innerHTML = '<option value="">Error leyendo dispositivos</option>';
      }
    } else {
      // Mock para pruebas en navegador
      this.dom.selectBtDevices.innerHTML = `
        <option value="">Seleccionar impresora...</option>
        <option value="00:11:22:33:44:55">Impresora Termica 58mm POS (00:11:22:33:44:55)</option>
        <option value="AA:BB:CC:DD:EE:FF">XP-58C Bluetooth Printer (AA:BB:CC:DD:EE:FF)</option>
      `;
    }
  }

  connectSelectedPrinter() {
    const address = this.dom.selectBtDevices.value;
    if (!address) {
      this.showToast('Por favor selecciona una impresora');
      return;
    }

    this.selectedDeviceAddress = address;
    localStorage.setItem('park10_printer_mac', address);
    this.setPrinterStatus('connecting', 'Conectando...');

    if (window.AndroidPrinter) {
      try {
        const success = window.AndroidPrinter.connect(address);
        if (success) {
          const devName = window.AndroidPrinter.getConnectedDeviceName() || address;
          this.setPrinterStatus('connected', `Conectada: ${devName}`);
          this.showToast(`Impresora conectada: ${devName}`);
        } else {
          this.setPrinterStatus('disconnected', 'Fallo al conectar');
          this.showToast('No se pudo conectar a la impresora');
        }
      } catch (e) {
        this.setPrinterStatus('disconnected', 'Error de conexión');
        this.showToast('Error: ' + e.message);
      }
    } else {
      setTimeout(() => {
        this.setPrinterStatus('connected', 'Conectada (Simulada)');
        this.showToast('Impresora vinculada exitosamente');
      }, 600);
    }
  }

  async updateSpotsCounter() {
    if (!window.firebaseTotem) return;
    try {
      const spots = await window.firebaseTotem.getSpots();
      if (spots) {
        let freeCount = 0;
        Object.values(spots).forEach(s => {
          if (!s.occupied) freeCount++;
        });
        if (this.dom.totemFreeSpots) {
          this.dom.totemFreeSpots.textContent = freeCount.toString().padStart(2, '0');
        }
      }
    } catch (e) {}
  }

  initFirebase() {
    if (!window.firebaseTotem) return;

    // Escuchar comandos remotos de impresión (ej. sensor ultrasónico o barrera detectando auto)
    window.firebaseTotem.startListeningToCommands(async (ticketData) => {
      console.log('[Totem] Activación remota por sensor:', ticketData);
      this.showToast('⚡ Vehículo detectado: Imprimiendo ticket');
      if (ticketData) {
        await this.dispenseAndPrintTicket(ticketData);
      } else {
        await this.handleIssueTicket();
      }
    });
  }

  async handleIssueTicket() {
    if (this.isPrinting) return;
    this.isPrinting = true;

    try {
      this.showToast('Generando ticket en Firebase...');
      const ticket = await window.firebaseTotem.issueNewTicket();
      await this.dispenseAndPrintTicket(ticket);
      this.updateSpotsCounter();
    } catch (err) {
      console.error('[Totem] Error emitiendo ticket:', err);
      this.showToast('Error al generar ticket');
    } finally {
      this.isPrinting = false;
    }
  }

  async dispenseAndPrintTicket(ticket) {
    // 1. Mostrar tarjeta animada de ticket y alternar botón
    if (this.dom.dispensingTicketId) {
      this.dom.dispensingTicketId.textContent = ticket.id;
    }
    const actionSection = this.dom.btnIssueTicket ? this.dom.btnIssueTicket.closest('.kiosk-action-section') : null;
    if (actionSection) {
      actionSection.style.display = 'none';
    }
    if (this.dom.dispensingCard) {
      this.dom.dispensingCard.style.display = 'flex';
    }

    // 2. Renderizar QR en pantalla
    if (this.dom.previewQrCanvas && window.QRCode) {
      try {
        await window.QRCode.toCanvas(this.dom.previewQrCanvas, ticket.id, {
          width: 140,
          margin: 1,
          color: { dark: '#111815', light: '#FFFFFF' }
        });
      } catch (e) {
        console.warn('Error dibujando canvas QR:', e);
      }
    }

    // 3. Generar comandos binarios ESC/POS con QR rasterizado universal (GS v 0)
    if (window.buildParkingTicketESC) {
      try {
        const escpos = await window.buildParkingTicketESC(ticket);
        const base64Data = escpos.toBase64();

        // 4. Enviar a hardware térmico
        this.sendToPrinter(base64Data, ticket);
      } catch (err) {
        console.error('Error generando ticket ESC/POS:', err);
      }
    }

    // Ocultar la animación después de 5.5 segundos para recibir al siguiente cliente
    setTimeout(() => {
      if (this.dom.dispensingCard) {
        this.dom.dispensingCard.style.display = 'none';
      }
      if (actionSection) {
        actionSection.style.display = 'flex';
      }
    }, 5500);
  }

  sendToPrinter(base64Data, ticket) {
    if (window.AndroidPrinter) {
      try {
        const printed = window.AndroidPrinter.printBase64(base64Data);
        if (printed) {
          this.showToast(`🖨️ Ticket ${ticket.id} impreso`);
        } else {
          this.showToast('Aviso: Impresora desconectada, guardado en Firebase');
        }
      } catch (e) {
        console.error('Error enviando a AndroidPrinter:', e);
        this.showToast('Error imprimiendo por Bluetooth');
      }
    } else {
      console.log('[ESC/POS Output Base64]:', base64Data);
      this.showToast(`🖨️ Ticket impreso exitosamente (Modo Kiosko)`);
    }
  }

  async handleTestPrint() {
    const sampleTicket = {
      id: '#ET-TEST01',
      spot: '07',
      entryTime: Date.now(),
      status: 'UNPAID',
      hourlyRate: 20.00,
      totalDue: 20.00
    };

    if (window.buildParkingTicketESC) {
      try {
        const escpos = await window.buildParkingTicketESC(sampleTicket);
        this.sendToPrinter(escpos.toBase64(), sampleTicket);
        this.showToast('Comando de prueba con QR enviado');
      } catch (err) {
        console.error('Error en prueba de impresión:', err);
      }
    }
  }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  window.totem = new TotemController();
});
