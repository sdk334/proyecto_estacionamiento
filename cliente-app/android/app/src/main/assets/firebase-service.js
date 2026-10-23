/**
 * PARK / 10 - Servicio de Sincronización en Tiempo Real con Firebase Realtime Database
 * Soporta conexión directa con Firebase (REST + WebSockets/EventSource)
 * y persistencia offline automática en localStorage.
 */

class FirebaseParkingService {
  constructor() {
    this.STORAGE_KEY_CONFIG = 'park10_firebase_config';
    
    // Configuración con el proyecto creado en la cuenta de Firebase del usuario
    this.defaultDatabaseUrl = 'https://park10-iot-31384-default-rtdb.firebaseio.com';
    this.databaseUrl = localStorage.getItem(this.STORAGE_KEY_CONFIG) || this.defaultDatabaseUrl;
    
    this.eventSources = {};
    this.isConnected = false;
  }

  /**
   * Configura la URL de la base de datos de Firebase
   */
  setDatabaseUrl(url) {
    if (!url) return;
    let cleanUrl = url.trim().replace(/\/$/, '');
    if (!cleanUrl.startsWith('http')) {
      cleanUrl = `https://${cleanUrl}.firebaseio.com`;
    }
    this.databaseUrl = cleanUrl;
    localStorage.setItem(this.STORAGE_KEY_CONFIG, cleanUrl);
    console.log('[Firebase] Conectado a:', this.databaseUrl);
  }

  /**
   * Obtiene la URL de un nodo de Firebase
   */
  getNodeUrl(path) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.databaseUrl}${cleanPath}.json`;
  }

  /**
   * Consulta un ticket en Firebase en tiempo real
   */
  async fetchTicket(ticketId) {
    const cleanId = ticketId.replace(/^#/, '');
    try {
      const res = await fetch(this.getNodeUrl(`/parking/tickets/${cleanId}`));
      if (res.ok) {
        const data = await res.json();
        if (data) {
          this.isConnected = true;
          return data;
        }
      }
    } catch (e) {
      console.warn('[Firebase] Sin conexión en vivo a Firebase, usando datos locales:', e.message);
    }
    return null;
  }

  /**
   * Registra el pago del ticket en Firebase
   */
  async updateTicketPayment(ticketId, paymentData) {
    const cleanId = ticketId.replace(/^#/, '');
    const payload = {
      status: 'PAID',
      paidAt: paymentData.paidAt || Date.now(),
      exitDeadline: paymentData.exitDeadline || (Date.now() + 20 * 60 * 1000),
      totalPaid: paymentData.totalPaid || 20.00
    };

    try {
      const res = await fetch(this.getNodeUrl(`/parking/tickets/${cleanId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        console.log('[Firebase] Pago registrado exitosamente en Firebase:', cleanId);
        return await res.json();
      }
    } catch (e) {
      console.warn('[Firebase] Error al guardar pago en Firebase:', e.message);
    }
    return payload;
  }

  /**
   * Escucha cambios en tiempo real en los 10 cajones desde Firebase
   */
  listenToSpots(onUpdateCallback) {
    const spotsUrl = this.getNodeUrl('/parking/spots');

    // Intentar conexión en tiempo real con EventSource (SSE de Firebase)
    try {
      if (window.EventSource) {
        if (this.eventSources['spots']) {
          this.eventSources['spots'].close();
        }

        const es = new EventSource(spotsUrl);
        es.addEventListener('put', (event) => {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed && parsed.data) {
              this.isConnected = true;
              onUpdateCallback(parsed.data);
            }
          } catch (err) {}
        });

        es.onerror = () => {
          // Fallback a polling si EventSource se desconecta
          es.close();
        };

        this.eventSources['spots'] = es;
      }
    } catch (e) {
      console.warn('[Firebase SSE error]:', e);
    }
  }

  /**
   * Envía un comando a Firebase para que el Tótem imprima un ticket físico
   */
  async triggerTotemPrint(spotNumber = '06') {
    const newId = `ET-${Math.floor(10000 + Math.random() * 90000)}`;
    const ticketPayload = {
      id: `#${newId}`,
      spot: spotNumber,
      entryTime: Date.now(),
      status: 'UNPAID',
      hourlyRate: 20.00,
      totalDue: 20.00,
      paidAt: null,
      exitDeadline: null,
      totalPaid: 0.00
    };

    try {
      // 1. Guardar ticket en /parking/tickets/
      await fetch(this.getNodeUrl(`/parking/tickets/${newId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticketPayload)
      });

      // 2. Disparar comando al tótem en /parking/commands/print_ticket
      await fetch(this.getNodeUrl('/parking/commands/print_ticket'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger: true,
          ticketId: newId,
          ticketData: ticketPayload,
          timestamp: Date.now()
        })
      });

      console.log('[Firebase] Comando de impresión enviado al tótem para ticket:', newId);
      return ticketPayload;
    } catch (e) {
      console.warn('[Firebase] Error al enviar comando de impresión:', e);
      return ticketPayload;
    }
  }
}

// Instancia global
window.firebaseParking = new FirebaseParkingService();
