/**
 * Servicio IoT y Gestión de Tickets de Estacionamiento Real
 * Maneja persistencia en localStorage, cálculo dinámico de tarifas,
 * generación de códigos QR reales para barrera de salida,
 * temporizador de tolerancia de 20 minutos y puente con Android 14.
 * 
 * Regla de Negocio Crítica:
 * Un usuario NO puede escanear más de un ticket cuando ya tiene uno activo.
 */

class ParkingIoTService {
  constructor() {
    this.STORAGE_KEY_SPOTS = 'park10_spots_v2';
    this.STORAGE_KEY_TICKETS = 'park10_tickets_v2';
    this.STORAGE_KEY_CURRENT = 'park10_active_ticket_v2';
    this.STORAGE_KEY_HISTORY = 'park10_history_v2';
    this.STORAGE_KEY_BACKEND = 'park10_backend_url';
    this.STORAGE_KEY_INIT = 'park10_initialized_v2';
    
    // Configuración comercial
    this.HOURLY_RATE = 20.0; // $20.00 MXN por hora o fracción
    this.EXIT_GRACE_MINUTES = 20; // 20 minutos de tolerancia para salir

    this.backendUrl = localStorage.getItem(this.STORAGE_KEY_BACKEND) || '';
    this.initDefaultData();
  }

  /**
   * Inicializa datos en almacenamiento local persistente
   */
  initDefaultData() {
    if (!localStorage.getItem(this.STORAGE_KEY_SPOTS)) {
      const initialSpots = {
        '01': { occupied: true, ticket: '#ET-00038', entryTime: Date.now() - (80 * 60 * 1000) },
        '02': { occupied: false, ticket: null, entryTime: null },
        '03': { occupied: true, ticket: '#ET-00039', entryTime: Date.now() - (55 * 60 * 1000) },
        '04': { occupied: false, ticket: null, entryTime: null },
        '05': { occupied: false, ticket: null, entryTime: null },
        '06': { occupied: true, ticket: '#ET-00042', entryTime: Date.now() - (42 * 60 * 1000) },
        '07': { occupied: false, ticket: null, entryTime: null },
        '08': { occupied: false, ticket: null, entryTime: null },
        '09': { occupied: true, ticket: '#ET-00041', entryTime: Date.now() - (125 * 60 * 1000) },
        '10': { occupied: false, ticket: null, entryTime: null },
      };
      localStorage.setItem(this.STORAGE_KEY_SPOTS, JSON.stringify(initialSpots));
    }

    // Solo se precarga un ticket activo en la primera ejecución
    if (!localStorage.getItem(this.STORAGE_KEY_INIT)) {
      const defaultTicket = {
        id: '#ET-00042',
        spot: '06',
        entryTime: Date.now() - (42 * 60 * 1000), // Hace 42 minutos
        paid: false,
        paidTime: null,
        exitDeadline: null,
        totalPaid: 0.00,
        completed: false
      };
      localStorage.setItem(this.STORAGE_KEY_CURRENT, JSON.stringify(defaultTicket));
      localStorage.setItem(this.STORAGE_KEY_INIT, 'true');
    }
  }

  /**
   * Obtiene todos los cajones del estacionamiento
   */
  getSpots() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY_SPOTS)) || {};
    } catch (e) {
      return {};
    }
  }

  /**
   * Actualiza el estado de un sensor IoT (ocupado/libre)
   */
  updateSpot(spotId, isOccupied, ticketId = null) {
    const spots = this.getSpots();
    if (spots[spotId]) {
      spots[spotId].occupied = isOccupied;
      spots[spotId].ticket = isOccupied ? (ticketId || `#ET-${Math.floor(10000 + Math.random() * 90000)}`) : null;
      spots[spotId].entryTime = isOccupied ? Date.now() : null;
      localStorage.setItem(this.STORAGE_KEY_SPOTS, JSON.stringify(spots));

      // Si hay backend configurado, sincronizar
      this.syncSpotWithBackend(spotId, spots[spotId]);
    }
    return spots;
  }

  /**
   * Genera un nuevo ticket para un cajón libre
   */
  createTicketForSpot(spotId) {
    const ticketId = `#ET-${Math.floor(10000 + Math.random() * 90000)}`;
    const newTicket = {
      id: ticketId,
      spot: spotId,
      entryTime: Date.now(),
      paid: false,
      paidTime: null,
      exitDeadline: null,
      totalPaid: 0.00,
      completed: false
    };
    this.updateSpot(spotId, true, ticketId);
    this.saveCurrentTicket(newTicket);
    return this.calculateTicketDetails(newTicket);
  }

  /**
   * Obtiene el ticket bruto en almacenamiento local
   */
  getRawCurrentTicket() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY_CURRENT);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Determina si existe actualmente un ticket activo (no finalizado)
   */
  hasActiveTicket() {
    const raw = this.getRawCurrentTicket();
    return Boolean(raw && !raw.completed);
  }

  /**
   * Obtiene el ticket activo actual con cálculos de tiempo y tarifa
   */
  getActiveTicket() {
    const raw = this.getRawCurrentTicket();
    if (!raw || raw.completed) return null;
    return this.calculateTicketDetails(raw);
  }

  /**
   * Alias estándar para compatibilidad con vistas
   */
  getTicket() {
    return this.getActiveTicket();
  }

  /**
   * Extrae el ID canónico de ticket (#ET-XXXXX) de cualquier payload QR o texto
   */
  parseCanonicalTicketId(code) {
    if (!code) return null;
    let raw = String(code).trim();

    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const parsed = JSON.parse(raw);
        raw = parsed.id || parsed.ticket || raw;
      } catch (e) {}
    }

    if (raw.includes(':')) {
      const parts = raw.split(':');
      for (const p of parts) {
        if (/ET-\d+/i.test(p)) {
          raw = p;
          break;
        }
      }
    }

    const match = raw.match(/ET-\d+/i);
    if (match) {
      return `#${match[0].toUpperCase()}`;
    }

    if (raw.startsWith('#')) return raw.toUpperCase();
    return `#${raw.toUpperCase()}`;
  }

  /**
   * Verifica si un código representa un cajón de estacionamiento
   */
  isSpotCode(code) {
    if (!code) return false;
    const raw = String(code).trim();
    if (/ET-\d+/i.test(raw)) return false;
    return /(?:lugar|cajon|spot)\s*0?([1-9]|10)\b/i.test(raw) || /^(0?[1-9]|10)$/.test(raw);
  }

  /**
   * Extrae el número de cajón a 2 dígitos
   */
  extractSpotNumber(code) {
    if (!code) return null;
    const raw = String(code).trim();
    const match = raw.match(/(?:lugar|cajon|spot)?\s*0?([1-9]|10)\b/i);
    if (match) {
      return match[1].padStart(2, '0');
    }
    return null;
  }

  /**
   * Valida si el usuario tiene permitido escanear este código QR
   * REGLA: No se permite escanear más de un ticket cuando uno ya está activo
   */
  canScanTicket(scannedCode) {
    const active = this.getActiveTicket();
    if (!active) {
      return { allowed: true, reason: 'NO_ACTIVE_TICKET' };
    }

    const scannedId = this.parseCanonicalTicketId(scannedCode);
    const activeId = this.parseCanonicalTicketId(active.id);

    const isSpot = this.isSpotCode(scannedCode);
    const spotNum = isSpot ? this.extractSpotNumber(scannedCode) : null;

    const isSameTicket = Boolean(scannedId && activeId && scannedId === activeId);
    const isSameSpot = Boolean(spotNum && active.spot === spotNum);

    if (isSameTicket || isSameSpot) {
      return {
        allowed: true,
        isSame: true,
        activeTicket: active
      };
    }

    // BLOQUEADO: Hay un ticket activo y el código escaneado es diferente
    return {
      allowed: false,
      reason: 'ACTIVE_TICKET_EXISTS',
      activeTicket: active,
      attemptedCode: scannedCode,
      attemptedId: isSpot ? `Lugar ${spotNum}` : scannedId
    };
  }

  /**
   * Resuelve el código QR y actualiza la sesión activa.
   * Si hay un ticket activo y se intenta cambiar sin force=true, lanza excepción.
   */
  async resolveTicket(scannedCode, force = false) {
    if (!scannedCode) return this.getActiveTicket();

    if (!force) {
      const check = this.canScanTicket(scannedCode);
      if (!check.allowed) {
        const err = new Error(`ACTIVE_TICKET_BLOCKED`);
        err.activeTicket = check.activeTicket;
        err.attemptedId = check.attemptedId;
        throw err;
      }
      if (check.isSame) {
        return check.activeTicket;
      }
    }

    let raw = String(scannedCode).trim();

    // 1. Si es formato payload tipo PARK10:ET-35281 o similar
    if (raw.includes(':')) {
      const parts = raw.split(':');
      for (const p of parts) {
        if (/ET-\d+/i.test(p)) {
          raw = p;
          break;
        }
      }
    }

    // 2. Si es formato JSON
    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.id || parsed.ticket) raw = parsed.id || parsed.ticket;
        else if (parsed.spot) raw = parsed.spot;
      } catch (e) {}
    }

    // 3. Si es un cajón de estacionamiento (ej. "02", "Lugar 02")
    if (this.isSpotCode(raw)) {
      const spotNum = this.extractSpotNumber(raw);
      if (spotNum) {
        const spots = this.getSpots();
        if (spots[spotNum] && spots[spotNum].ticket) {
          raw = spots[spotNum].ticket;
        } else {
          return this.createTicketForSpot(spotNum);
        }
      }
    }

    // 4. Normalizar formato de ticket ET-XXXXX
    let ticketId = this.parseCanonicalTicketId(raw) || `#${raw}`;
    const cleanId = ticketId.replace(/^#/, '');

    // 5. Consultar Firebase Realtime Database
    if (window.firebaseParking) {
      try {
        const fbData = await window.firebaseParking.fetchTicket(cleanId);
        if (fbData) {
          const ticket = {
            id: fbData.id || ticketId,
            spot: fbData.spot || '06',
            entryTime: fbData.entryTime || Date.now(),
            paid: fbData.status === 'PAID',
            paidTime: fbData.paidAt || null,
            exitDeadline: fbData.exitDeadline || null,
            totalPaid: fbData.totalPaid || 0.00,
            completed: false
          };
          this.saveCurrentTicket(ticket);
          return this.calculateTicketDetails(ticket);
        }
      } catch (e) {
        console.warn('[IoT] Error consultando Firebase para ticket:', e);
      }
    }

    // 6. Verificar en cajones locales o crear sesión
    const spots = this.getSpots();
    let matchedSpot = '06';
    let matchedEntry = Date.now() - (20 * 60 * 1000); // 20 minutos por defecto

    for (const [sNum, sData] of Object.entries(spots)) {
      if (sData.ticket === ticketId && sData.entryTime) {
        matchedSpot = sNum;
        matchedEntry = sData.entryTime;
        break;
      }
    }

    const newTicket = {
      id: ticketId,
      spot: matchedSpot,
      entryTime: matchedEntry,
      paid: false,
      paidTime: null,
      exitDeadline: null,
      totalPaid: 0.00,
      completed: false
    };

    this.saveCurrentTicket(newTicket);
    return this.calculateTicketDetails(newTicket);
  }

  /**
   * Finaliza la estancia del ticket actual, lo archiva en historial y libera el cajón
   */
  finalizeCurrentTicket() {
    const raw = this.getRawCurrentTicket();
    if (!raw) return null;

    raw.completed = true;
    raw.completedAt = Date.now();

    // Archivar en historial de estancias
    let history = [];
    try {
      history = JSON.parse(localStorage.getItem(this.STORAGE_KEY_HISTORY)) || [];
    } catch (e) {}
    history.unshift(raw);
    if (history.length > 30) history = history.slice(0, 30);
    localStorage.setItem(this.STORAGE_KEY_HISTORY, JSON.stringify(history));

    // Liberar cajón asociado en el mapa
    if (raw.spot) {
      const spots = this.getSpots();
      if (spots[raw.spot] && (spots[raw.spot].ticket === raw.id || spots[raw.spot].occupied)) {
        this.updateSpot(raw.spot, false, null);
      }
    }

    // Limpiar ticket activo
    localStorage.removeItem(this.STORAGE_KEY_CURRENT);
    return raw;
  }

  /**
   * Descarta el ticket activo actual sin archivarlo como pagado
   */
  discardCurrentTicket() {
    const raw = this.getRawCurrentTicket();
    if (raw && raw.spot) {
      const spots = this.getSpots();
      if (spots[raw.spot] && spots[raw.spot].ticket === raw.id) {
        this.updateSpot(raw.spot, false, null);
      }
    }
    localStorage.removeItem(this.STORAGE_KEY_CURRENT);
    return true;
  }

  /**
   * Calcula importes y tiempos en tiempo real según el reloj del dispositivo
   */
  calculateTicketDetails(ticket) {
    if (!ticket) return null;

    const now = Date.now();
    const elapsedMs = Math.max(0, now - ticket.entryTime);
    const elapsedMinutes = Math.floor(elapsedMs / (60 * 1000));
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    const remMinutes = elapsedMinutes % 60;

    // Tarifa: Mínimo 1 hora, redondeo hacia arriba por fracción
    const hoursToBill = Math.max(1, Math.ceil(elapsedMinutes / 60));
    const totalDue = (hoursToBill * this.HOURLY_RATE).toFixed(2);

    // Formato hh:mm
    const formattedElapsed = `${elapsedHours < 10 ? '0' : ''}${elapsedHours}:${remMinutes < 10 ? '0' : ''}${remMinutes}`;

    // Hora de entrada formateada
    const entryDate = new Date(ticket.entryTime);
    const entryHours = entryDate.getHours().toString().padStart(2, '0');
    const entryMins = entryDate.getMinutes().toString().padStart(2, '0');
    const entryFormatted = `${entryHours}:${entryMins}`;

    // Si está pagado, calcular tiempo restante de tolerancia
    let remainingExitSeconds = 0;
    let deadlineFormatted = '';

    if (ticket.paid && ticket.exitDeadline) {
      remainingExitSeconds = Math.max(0, Math.floor((ticket.exitDeadline - now) / 1000));
      const deadlineDate = new Date(ticket.exitDeadline);
      const dlHours = deadlineDate.getHours().toString().padStart(2, '0');
      const dlMins = deadlineDate.getMinutes().toString().padStart(2, '0');
      deadlineFormatted = `${dlHours}:${dlMins} hrs`;
    }

    return {
      ...ticket,
      elapsedMinutes,
      formattedElapsed,
      totalDue: `$${totalDue}`,
      rawTotalDue: parseFloat(totalDue),
      entryFormatted,
      remainingExitSeconds,
      deadlineFormatted
    };
  }

  /**
   * Registra el pago del ticket y activa el temporizador real de 20 minutos
   */
  registerPayment(ticketId, amount) {
    const raw = this.getRawCurrentTicket();
    if (!raw) return null;

    const now = Date.now();
    const deadline = now + (this.EXIT_GRACE_MINUTES * 60 * 1000);

    raw.paid = true;
    raw.paidTime = now;
    raw.exitDeadline = deadline;
    raw.totalPaid = amount || 20.00;

    this.saveCurrentTicket(raw);
    const updated = this.calculateTicketDetails(raw);

    // Sincronizar pago en tiempo real con Firebase Realtime Database
    if (window.firebaseParking) {
      window.firebaseParking.updateTicketPayment(raw.id, {
        paidAt: now,
        exitDeadline: deadline,
        totalPaid: raw.totalPaid
      });
    }

    // Notificar al puente nativo de Android 14
    if (window.Android && window.Android.onPaymentSuccess) {
      try {
        window.Android.onPaymentSuccess(raw.id, updated.totalPaid, updated.deadlineFormatted);
      } catch (e) {
        console.warn('Android onPaymentSuccess error:', e);
      }
    }

    return updated;
  }

  saveCurrentTicket(ticket) {
    localStorage.setItem(this.STORAGE_KEY_CURRENT, JSON.stringify(ticket));
  }

  /**
   * Genera un código QR real en un elemento Canvas HTML5
   */
  renderQRCodeOnCanvas(canvasElement, qrContent, size = 180) {
    if (!canvasElement) return;

    if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
      window.QRCode.toCanvas(canvasElement, qrContent, {
        width: size,
        margin: 2,
        color: {
          dark: '#111815',
          light: '#FFFFFF'
        }
      }, (error) => {
        if (error) console.error('Error generando QR:', error);
      });
    }
  }

  /**
   * Retroalimentación háptica
   */
  hapticFeedback(pattern = [50, 40, 50]) {
    if (window.Android && window.Android.vibrate) {
      window.Android.vibrate(pattern[0] || 50);
    } else if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }

  /**
   * Sincronización opcional con Backend IoT vía HTTP REST
   */
  async syncSpotWithBackend(spotId, spotData) {
    if (!this.backendUrl) return;
    try {
      await fetch(`${this.backendUrl}/api/spots/${spotId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spotData)
      });
    } catch (e) {
      // Offline fallback
    }
  }
}

// Instancia global
window.iotService = new ParkingIoTService();
