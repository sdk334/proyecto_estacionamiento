/**
 * PARK / 10 - Módulo Firebase para la App Tótem / Expendedor de Entrada
 * Sincroniza cajones disponibles, crea tickets en tiempo real y
 * escucha eventos automáticos de presencia vehicular.
 */

class FirebaseTotemService {
  constructor() {
    this.defaultDatabaseUrl = 'https://park10-iot-31384-default-rtdb.firebaseio.com';
    this.databaseUrl = localStorage.getItem('park10_firebase_config') || this.defaultDatabaseUrl;
    this.eventSource = null;
    this.onPrintCommandCallback = null;
    this.onSpotsUpdateCallback = null;
  }

  setDatabaseUrl(url) {
    if (!url) return;
    this.databaseUrl = url.trim().replace(/\/$/, '');
    localStorage.setItem('park10_firebase_config', this.databaseUrl);
  }

  getNodeUrl(path) {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.databaseUrl}${cleanPath}.json`;
  }

  /**
   * Obtiene todos los cajones en tiempo real
   */
  async getSpots() {
    try {
      const res = await fetch(this.getNodeUrl('/parking/spots'));
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {}
    return null;
  }

  /**
   * Asigna el primer cajón libre disponible
   */
  async findNextFreeSpot() {
    const spots = await this.getSpots();
    if (spots) {
      for (const [num, data] of Object.entries(spots)) {
        if (!data.occupied) return num;
      }
    }
    // Fallback si no hay conexión o están todos ocupados
    return '06';
  }

  /**
   * Crea un nuevo ticket de entrada y actualiza el cajón como ocupado
   */
  async issueNewTicket() {
    const assignedSpot = await this.findNextFreeSpot();
    const randomCode = Math.floor(10000 + Math.random() * 90000);
    const ticketId = `#ET-${randomCode}`;
    const cleanId = `ET-${randomCode}`;
    const now = Date.now();

    const ticketData = {
      id: ticketId,
      spot: assignedSpot,
      entryTime: now,
      status: 'UNPAID',
      hourlyRate: 20.00,
      totalDue: 20.00,
      paidAt: null,
      exitDeadline: null,
      totalPaid: 0.00,
      createdFrom: 'totem_kiosk_entry'
    };

    try {
      // 1. Guardar ticket en /parking/tickets/{id}
      await fetch(this.getNodeUrl(`/parking/tickets/${cleanId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticketData)
      });

      // 2. Marcar cajón como ocupado en /parking/spots/{spot}
      await fetch(this.getNodeUrl(`/parking/spots/${assignedSpot}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occupied: true, ticketId: ticketId, entryTime: now })
      });
    } catch (e) {
      console.warn('[Totem Firebase] Error al sincronizar con Firebase, operando offline:', e.message);
    }

    return ticketData;
  }

  /**
   * Escucha comandos de impresión remota en /parking/commands/print_ticket
   */
  startListeningToCommands(callback) {
    this.onPrintCommandCallback = callback;
    const commandUrl = this.getNodeUrl('/parking/commands/print_ticket');

    if (window.EventSource) {
      try {
        if (this.eventSource) this.eventSource.close();
        this.eventSource = new EventSource(commandUrl);

        this.eventSource.addEventListener('put', (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data && data.data && data.data.trigger) {
              console.log('[Totem Firebase] Comando de impresión recibido:', data.data);
              // Resetear el trigger para no duplicar
              fetch(commandUrl, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trigger: false })
              }).catch(() => {});

              if (this.onPrintCommandCallback) {
                this.onPrintCommandCallback(data.data.ticketData || null);
              }
            }
          } catch (e) {}
        });
      } catch (err) {
        console.warn('Error inicializando EventSource:', err);
      }
    }
  }
}

window.firebaseTotem = new FirebaseTotemService();
