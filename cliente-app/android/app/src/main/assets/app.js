/**
 * PARK / 10 - Sistema de Control de Estacionamiento por QR (IoT App)
 * Código 100% Funcional para Android 14+ y Web Móvil
 * 
 * Regla Fundamental:
 * Un usuario NO puede escanear más de un ticket cuando uno ya está activo.
 * Si intenta escanear otro, el sistema lo bloquea y le solicita finalizar
 * o liquidar la estancia previa.
 */

let currentScanner = null;
let countdownInterval = null;
let pendingScannedCode = null;

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupSpots();
  setupRealCameraScanner();
  setupManualTicketInput();
  setupPaymentFlow();
  setupEstatusScreen();
  setupBlockedTicketModal();
  refreshUIFromStorage();
  startPersistentCountdown();
});

/**
 * Transición fluida entre pantallas y sincronización de navegación
 */
function showScreen(screenId, activeTab = null) {
  // Apagar la cámara si se sale de la pantalla de escaneo para ahorrar batería
  if (screenId !== 'screen-escanear-qr' && currentScanner) {
    currentScanner.stopCamera();
    resetCameraViewfinder();
  }

  const screens = document.querySelectorAll('.screen-view');
  screens.forEach(s => s.classList.remove('active-screen'));

  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add('active-screen');
    target.scrollTop = 0;
  }

  // Determinar tab activo
  let tabName = activeTab;
  if (!tabName) {
    if (screenId === 'screen-inicio') tabName = 'inicio';
    else if (screenId === 'screen-estatus') tabName = 'estatus';
    else tabName = 'qr';
  }

  const tabs = document.querySelectorAll('.phone-bottom-nav .nav-tab-item');
  tabs.forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });

  // Refrescar datos y renderizar QR
  refreshUIFromStorage();
}

/**
 * Sincroniza la interfaz con los datos reales del servicio IoT
 */
function refreshUIFromStorage() {
  if (!window.iotService) return;

  const ticket = window.iotService.getActiveTicket();

  // 0. Banner en Escáner: Advertencia visible si ya hay ticket activo
  const scannerBanner = document.getElementById('active-ticket-scanner-banner');
  const bannerTicketInfo = document.getElementById('active-banner-ticket-info');
  const bannerStatusText = document.getElementById('active-banner-status-text');
  if (scannerBanner) {
    if (ticket) {
      scannerBanner.style.display = 'flex';
      if (bannerTicketInfo) bannerTicketInfo.textContent = `${ticket.id} · Lugar ${ticket.spot}`;
      if (bannerStatusText) bannerStatusText.textContent = ticket.paid ? 'SALIDA AUTORIZADA' : 'TICKET ACTIVO EN CURSO';
    } else {
      scannerBanner.style.display = 'none';
    }
  }

  // Banner en Inicio: Texto dinámico según estado
  const bannerTitle = document.querySelector('#banner-to-scan .banner-title');
  const bannerSub = document.querySelector('#banner-to-scan .banner-sub');
  const btnBannerScan = document.getElementById('btn-banner-scan');
  if (bannerTitle && bannerSub && btnBannerScan) {
    if (ticket) {
      bannerTitle.textContent = `Estancia activa: ${ticket.id}`;
      bannerSub.textContent = `Lugar ${ticket.spot} · ${ticket.paid ? 'Salida autorizada' : 'Pendiente de pago'}`;
      btnBannerScan.textContent = 'Ver estatus →';
    } else {
      bannerTitle.textContent = '¿Ya tienes tu ticket?';
      bannerSub.textContent = 'Escanéalo para registrar tu estancia';
      btnBannerScan.textContent = 'Escanear →';
    }
  }

  // Si no hay ticket activo, renderizar vista vacía y actualizar conteo de lugares
  if (!ticket) {
    renderEstatusView(false);
    updateSpotsCount();
    return;
  }

  // 1. Pantalla: Tu ticket
  const tuTicketId = document.querySelector('#screen-tu-ticket .ticket-code-id');
  const tuTicketMeta = document.querySelector('#screen-tu-ticket .ticket-entry-meta');
  const tuTicketTime = document.querySelector('#screen-tu-ticket .metric-huge-value');
  const tuTicketTotal = document.querySelector('#screen-tu-ticket .ticket-metric-block:nth-of-type(2) .metric-huge-value');
  const unpaidQrCanvas = document.getElementById('unpaid-ticket-qr-canvas');

  if (tuTicketId) tuTicketId.textContent = ticket.id;
  if (tuTicketMeta) tuTicketMeta.textContent = `Entrada · hoy a las ${ticket.entryFormatted}`;
  if (tuTicketTime) tuTicketTime.textContent = ticket.formattedElapsed;
  if (tuTicketTotal) tuTicketTotal.textContent = ticket.totalDue;

  // Generar QR real para Tu ticket
  if (unpaidQrCanvas) {
    window.iotService.renderQRCodeOnCanvas(unpaidQrCanvas, ticket.id, 150);
  }

  // 2. Pantalla: Simular pago
  const sumTicket = document.querySelector('#screen-simular-pago .summary-row:nth-of-type(1) .summary-value');
  const sumTime = document.querySelector('#screen-simular-pago .summary-row:nth-of-type(2) .summary-value');
  const sumEntry = document.querySelector('#screen-simular-pago .summary-row:nth-of-type(3) .summary-value');
  const sumTotal = document.querySelector('#screen-simular-pago .total-huge-amount');

  if (sumTicket) sumTicket.textContent = ticket.id;
  if (sumTime) sumTime.textContent = `${ticket.elapsedMinutes} minutos`;
  if (sumEntry) sumEntry.textContent = ticket.entryFormatted;
  if (sumTotal) sumTotal.textContent = ticket.totalDue;

  // 3. Pantalla: Ticket pagado
  const paidId = document.querySelector('#screen-ticket-pagado .ticket-code-id');
  const paidMeta = document.querySelector('#screen-ticket-pagado .ticket-entry-meta');
  const paidTimestamp = document.querySelector('#screen-ticket-pagado .paid-timestamp-value');
  const paidQrCanvas = document.getElementById('paid-ticket-qr-canvas');

  if (paidId) paidId.textContent = ticket.id;
  if (paidMeta) paidMeta.textContent = `Entrada · hoy ${ticket.entryFormatted}`;
  if (paidTimestamp && ticket.paidTime) {
    const pDate = new Date(ticket.paidTime);
    paidTimestamp.textContent = `Hoy · ${pDate.getHours().toString().padStart(2, '0')}:${pDate.getMinutes().toString().padStart(2, '0')}`;
  }

  // Generar QR real para salida en la pluma
  if (paidQrCanvas && ticket.paid) {
    const exitPayload = `PARK10:${ticket.id}:PAID:${ticket.exitDeadline || ''}`;
    window.iotService.renderQRCodeOnCanvas(paidQrCanvas, exitPayload, 170);
  }

  // 4. Pantalla: Estatus
  renderEstatusView(ticket.paid);
  updateSpotsCount();
}

/**
 * Navegación de la barra inferior (Inicio · QR · Estatus)
 */
function setupNavigation() {
  const navTabs = document.querySelectorAll('.phone-bottom-nav .nav-tab-item');
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      window.iotService.hapticFeedback([40]);

      if (tabName === 'inicio') {
        showScreen('screen-inicio', 'inicio');
      } else if (tabName === 'qr') {
        showScreen('screen-escanear-qr', 'qr');
      } else if (tabName === 'estatus') {
        showScreen('screen-estatus', 'estatus');
      }
    });
  });

  // Banner en Inicio: acción inteligente
  const btnBannerScan = document.getElementById('btn-banner-scan');
  if (btnBannerScan) {
    btnBannerScan.addEventListener('click', () => {
      window.iotService.hapticFeedback([50]);
      if (window.iotService.hasActiveTicket()) {
        showScreen('screen-estatus', 'estatus');
      } else {
        showScreen('screen-escanear-qr', 'qr');
      }
    });
  }

  // Botón en el banner superior del escáner: "Ver ticket ->"
  const btnBannerGoEstatus = document.getElementById('btn-banner-go-estatus');
  if (btnBannerGoEstatus) {
    btnBannerGoEstatus.addEventListener('click', () => {
      window.iotService.hapticFeedback([40]);
      showScreen('screen-estatus', 'estatus');
    });
  }
}

/**
 * Sensores y Cajones de Estacionamiento
 */
function setupSpots() {
  const spotElements = document.querySelectorAll('.parking-spot');
  spotElements.forEach(el => {
    el.addEventListener('click', () => {
      const spotNum = el.dataset.spot;
      const spots = window.iotService.getSpots();
      if (!spots[spotNum]) return;

      const newOccupiedState = !spots[spotNum].occupied;
      window.iotService.updateSpot(spotNum, newOccupiedState);

      if (newOccupiedState) {
        showToast(`Sensor IoT: Lugar ${spotNum} OCUPADO`);
      } else {
        showToast(`Sensor IoT: Lugar ${spotNum} LIBRE`);
      }

      window.iotService.hapticFeedback([60]);
      updateSpotsCount();
    });
  });
}

function updateSpotsCount() {
  if (!window.iotService) return;
  const spots = window.iotService.getSpots();
  let freeCount = 0;

  for (const [num, data] of Object.entries(spots)) {
    if (!data.occupied) freeCount++;
  }

  const freeDisplay = document.getElementById('display-free-spots');
  if (freeDisplay) {
    freeDisplay.textContent = freeCount < 10 ? `0${freeCount}` : `${freeCount}`;
  }

  const spotElements = document.querySelectorAll('.parking-spot');
  spotElements.forEach(el => {
    const num = el.dataset.spot;
    if (spots[num]?.occupied) {
      el.classList.remove('free');
      el.classList.add('occupied');
    } else {
      el.classList.remove('occupied');
      el.classList.add('free');
    }
  });
}

/**
 * Escáner de Cámara Real y Subida de Archivos
 */
function setupRealCameraScanner() {
  const videoEl = document.getElementById('camera-video-stream');
  const canvasEl = document.getElementById('qr-scan-canvas');
  const laser = document.getElementById('scanner-laser');
  const dummyGrid = document.getElementById('qr-dummy-grid');
  const btnStartCamera = document.getElementById('btn-start-camera');
  const btnTorch = document.getElementById('btn-toggle-torch');
  const inputQrFile = document.getElementById('input-qr-file');
  const btnUploadQr = document.getElementById('btn-upload-qr');

  let torchEnabled = false;

  // Instanciar motor de escaneo real
  currentScanner = new RealQRScanner(videoEl, canvasEl, (scannedResult) => {
    handleScannedTicket(scannedResult);
  });

  // Botón Abrir Cámara
  if (btnStartCamera) {
    btnStartCamera.addEventListener('click', async () => {
      if (currentScanner.isScanning) {
        currentScanner.stopCamera();
        resetCameraViewfinder();
        btnStartCamera.innerHTML = `<span>Abrir cámara para escanear</span>`;
        return;
      }

      btnStartCamera.innerHTML = `<span>Accediendo a la cámara...</span>`;
      btnStartCamera.style.opacity = '0.75';

      const res = await currentScanner.startCamera();
      if (res.success) {
        videoEl.style.display = 'block';
        laser.style.display = 'block';
        dummyGrid.style.display = 'none';
        btnStartCamera.innerHTML = `<span>Detener escáner</span>`;
        btnStartCamera.style.opacity = '1';
        if (btnTorch) btnTorch.style.display = 'block';
        showToast('Enfoca el código QR de tu ticket');
      } else {
        btnStartCamera.innerHTML = `<span>Abrir cámara para escanear</span>`;
        btnStartCamera.style.opacity = '1';
        showToast(`Cámara no disponible (${res.error}). Usa la carga de foto o ingreso manual.`);
      }
    });
  }

  // Linterna / Flash
  if (btnTorch) {
    btnTorch.addEventListener('click', async () => {
      torchEnabled = !torchEnabled;
      const ok = await currentScanner.toggleTorch(torchEnabled);
      if (ok) {
        btnTorch.textContent = torchEnabled ? '⚡ Flash ON' : '⚡ Flash OFF';
      }
    });
  }

  // Carga y decodificación de imagen real desde almacenamiento/galería de Android
  if (btnUploadQr && inputQrFile) {
    btnUploadQr.addEventListener('click', () => {
      inputQrFile.click();
    });

    inputQrFile.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        showToast('Analizando código QR de la imagen...');

        try {
          const res = await currentScanner.scanImageFile(file);
          if (res.success && res.code) {
            handleScannedTicket(res.code);
          } else {
            showToast(res.error || 'No se reconoció un código QR válido en la foto.');
          }
        } catch (err) {
          console.error(err);
          showToast('Error al procesar la imagen seleccionada.');
        }

        // Limpiar el input para permitir seleccionar la misma imagen de nuevo
        inputQrFile.value = '';
      }
    });
  }
}

/**
 * Consulta manual de tickets
 */
function setupManualTicketInput() {
  const inputManual = document.getElementById('input-manual-ticket');
  const btnSubmitManual = document.getElementById('btn-submit-manual-ticket');

  const executeSearch = () => {
    if (!inputManual) return;
    const code = inputManual.value.trim();
    if (code) {
      handleScannedTicket(code);
    } else {
      showToast('Por favor introduce un código de ticket');
    }
  };

  if (btnSubmitManual) {
    btnSubmitManual.addEventListener('click', executeSearch);
  }

  if (inputManual) {
    inputManual.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        executeSearch();
      }
    });
  }
}

function resetCameraViewfinder() {
  const videoEl = document.getElementById('camera-video-stream');
  const laser = document.getElementById('scanner-laser');
  const dummyGrid = document.getElementById('qr-dummy-grid');
  const btnStartCamera = document.getElementById('btn-start-camera');
  const btnTorch = document.getElementById('btn-toggle-torch');

  if (videoEl) videoEl.style.display = 'none';
  if (laser) laser.style.display = 'none';
  if (dummyGrid) dummyGrid.style.display = 'grid';
  if (btnTorch) btnTorch.style.display = 'none';
  if (btnStartCamera) btnStartCamera.innerHTML = `<span>Abrir cámara para escanear</span>`;
}

/**
 * Procesa el código QR escaneado o consultado
 * REGLA: Bloquea si ya existe un ticket activo diferente
 */
async function handleScannedTicket(ticketCode) {
  resetCameraViewfinder();

  // Validar si tiene permitido escanear este ticket
  const check = window.iotService.canScanTicket(ticketCode);
  if (!check.allowed) {
    window.iotService.hapticFeedback([100, 50, 100, 50, 150]);
    showActiveTicketBlockedModal(check.activeTicket, ticketCode);
    return;
  }

  window.iotService.hapticFeedback([70, 40, 70]);
  showToast('Identificando código QR...');

  try {
    const ticket = await window.iotService.resolveTicket(ticketCode);
    showToast(`Ticket ${ticket.id} localizado (Lugar ${ticket.spot})`);
    showScreen('screen-estatus', 'estatus');
  } catch (err) {
    if (err.message === 'ACTIVE_TICKET_BLOCKED') {
      showActiveTicketBlockedModal(err.activeTicket, ticketCode);
    } else {
      showToast('Error procesando ticket: ' + err.message);
    }
  }
}

/**
 * Muestra el modal de bloqueo cuando se intenta escanear otro ticket con uno activo
 */
function showActiveTicketBlockedModal(activeTicket, attemptedCode) {
  pendingScannedCode = attemptedCode;
  const modal = document.getElementById('modal-active-ticket-blocked');
  const chip = document.getElementById('modal-blocked-chip');
  const desc = document.getElementById('modal-blocked-description');
  const btnFinalizeText = document.getElementById('btn-modal-finalize-text');
  const icon = document.getElementById('modal-blocked-icon');

  if (!modal) return;

  const isPaid = Boolean(activeTicket.paid);
  if (chip) chip.textContent = `${activeTicket.id} · Lugar ${activeTicket.spot}`;

  if (isPaid) {
    if (icon) {
      icon.className = 'modal-icon-badge info';
      icon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
    }
    if (desc) desc.textContent = `Tienes una estancia pagada en curso con salida autorizada. Por control de acceso, debes finalizar tu salida antes de registrar una nueva estancia.`;
    if (btnFinalizeText) btnFinalizeText.textContent = 'Salida realizada (Finalizar y usar nuevo)';
  } else {
    if (icon) {
      icon.className = 'modal-icon-badge warning';
      icon.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    }
    if (desc) desc.textContent = `Actualmente tienes el ticket ${activeTicket.id} pendiente de pago en el Lugar ${activeTicket.spot}. No se permite escanear más de un ticket simultáneamente.`;
    if (btnFinalizeText) btnFinalizeText.textContent = 'Descartar estancia y registrar este ticket';
  }

  modal.style.display = 'flex';
}

function hideActiveTicketBlockedModal() {
  const modal = document.getElementById('modal-active-ticket-blocked');
  if (modal) modal.style.display = 'none';
  pendingScannedCode = null;
}

function setupBlockedTicketModal() {
  const modal = document.getElementById('modal-active-ticket-blocked');
  const btnViewActive = document.getElementById('btn-modal-view-active');
  const btnFinalize = document.getElementById('btn-modal-finalize-active');
  const btnClose = document.getElementById('btn-modal-close');

  if (btnViewActive) {
    btnViewActive.addEventListener('click', () => {
      hideActiveTicketBlockedModal();
      showScreen('screen-estatus', 'estatus');
    });
  }

  if (btnFinalize) {
    btnFinalize.addEventListener('click', async () => {
      const codeToLoad = pendingScannedCode;
      hideActiveTicketBlockedModal();

      // Finalizar estancia previa
      window.iotService.finalizeCurrentTicket();
      showToast('Estancia anterior finalizada');

      // Si había un código nuevo pendiente, registrarlo ahora
      if (codeToLoad) {
        setTimeout(async () => {
          showToast('Registrando nuevo ticket...');
          try {
            const ticket = await window.iotService.resolveTicket(codeToLoad, true);
            showToast(`Nuevo ticket ${ticket.id} activo`);
            showScreen('screen-estatus', 'estatus');
          } catch (e) {
            console.error(e);
          }
        }, 200);
      } else {
        showScreen('screen-inicio', 'inicio');
      }
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      hideActiveTicketBlockedModal();
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideActiveTicketBlockedModal();
    });
  }
}

/**
 * Flujo de Pago Real y Transiciones
 */
function setupPaymentFlow() {
  // Volver al escáner
  const btnBackScanner = document.getElementById('btn-back-to-scanner');
  if (btnBackScanner) {
    btnBackScanner.addEventListener('click', () => showScreen('screen-escanear-qr', 'qr'));
  }

  // Tu ticket -> Simular pago
  const btnToSimulate = document.getElementById('btn-to-simulate-pay');
  if (btnToSimulate) {
    btnToSimulate.addEventListener('click', () => {
      window.iotService.hapticFeedback([40]);
      showScreen('screen-simular-pago', 'qr');
    });
  }

  // Volver a Tu ticket
  const btnBackTicket = document.getElementById('btn-back-to-ticket');
  if (btnBackTicket) {
    btnBackTicket.addEventListener('click', () => showScreen('screen-tu-ticket', 'qr'));
  }

  // Confirmar pago (Registra en storage y activa temporizador de 20 min)
  const btnConfirmPay = document.getElementById('btn-confirm-pay');
  if (btnConfirmPay) {
    btnConfirmPay.addEventListener('click', () => {
      btnConfirmPay.innerHTML = `<span>Procesando pago...</span>`;
      btnConfirmPay.style.opacity = '0.75';

      setTimeout(() => {
        const currentTicket = window.iotService.getActiveTicket();
        if (!currentTicket) return;

        const updated = window.iotService.registerPayment(currentTicket.id, 20.00);

        btnConfirmPay.innerHTML = `<span>Confirmar pago simulado</span>`;
        btnConfirmPay.style.opacity = '1';

        window.iotService.hapticFeedback([100, 60, 100]);
        showToast('¡Pago registrado con éxito! Tienes 20 minutos para salir.');

        showScreen('screen-ticket-pagado', 'qr');
      }, 500);
    });
  }

  // Botones desde Ticket pagado
  const btnPaidToEstatus = document.getElementById('btn-paid-to-estatus');
  if (btnPaidToEstatus) {
    btnPaidToEstatus.addEventListener('click', () => showScreen('screen-estatus', 'estatus'));
  }

  const btnPaidToInicio = document.getElementById('btn-paid-to-inicio');
  if (btnPaidToInicio) {
    btnPaidToInicio.addEventListener('click', () => showScreen('screen-inicio', 'inicio'));
  }

  // Finalizar estancia desde Ticket pagado (Salida realizada)
  const btnPaidFinalize = document.getElementById('btn-paid-finalize-stay');
  if (btnPaidFinalize) {
    btnPaidFinalize.addEventListener('click', () => {
      window.iotService.hapticFeedback([60]);
      window.iotService.finalizeCurrentTicket();
      showToast('¡Estancia finalizada! Salida completada.');
      showScreen('screen-inicio', 'inicio');
    });
  }
}

/**
 * Pantalla de Estatus (Vista dinámica: Sin ticket, Pendiente o Pagado)
 */
function setupEstatusScreen() {
  // Pagar ticket ahora desde Estatus
  const btnPayNow = document.getElementById('btn-estatus-pay-now');
  if (btnPayNow) {
    btnPayNow.addEventListener('click', () => showScreen('screen-simular-pago', 'qr'));
  }

  // Ver ticket QR de salida desde Estatus
  const btnViewQr = document.getElementById('btn-estatus-view-qr');
  if (btnViewQr) {
    btnViewQr.addEventListener('click', () => showScreen('screen-ticket-pagado', 'qr'));
  }

  // Descartar estancia desde Estatus (Pendiente de pago)
  const btnDiscardUnpaid = document.getElementById('btn-estatus-discard-unpaid');
  if (btnDiscardUnpaid) {
    btnDiscardUnpaid.addEventListener('click', () => {
      const ticket = window.iotService.getActiveTicket();
      if (!ticket) return;
      if (confirm(`¿Deseas descartar el ticket activo actual (${ticket.id})? Se liberará el lugar ${ticket.spot} y podrás registrar un nuevo ticket.`)) {
        window.iotService.hapticFeedback([80]);
        window.iotService.discardCurrentTicket();
        showToast('Ticket actual descartado. Espacio liberado.');
        showScreen('screen-inicio', 'inicio');
      }
    });
  }

  // Finalizar estancia desde Estatus (Pagado)
  const btnFinalizePaid = document.getElementById('btn-estatus-finalize-paid');
  if (btnFinalizePaid) {
    btnFinalizePaid.addEventListener('click', () => {
      window.iotService.hapticFeedback([60]);
      window.iotService.finalizeCurrentTicket();
      showToast('¡Estancia finalizada! Salida completada.');
      showScreen('screen-inicio', 'inicio');
    });
  }

  // Botón en vista vacía de Estatus: "Escanear ticket QR"
  const btnEmptyScan = document.getElementById('btn-empty-scan-qr');
  if (btnEmptyScan) {
    btnEmptyScan.addEventListener('click', () => {
      window.iotService.hapticFeedback([40]);
      showScreen('screen-escanear-qr', 'qr');
    });
  }
}

function renderEstatusView(isPaid) {
  const viewUnpaid = document.getElementById('estatus-view-unpaid');
  const viewPaid = document.getElementById('estatus-view-paid');
  const viewEmpty = document.getElementById('estatus-view-empty');
  const ticket = window.iotService ? window.iotService.getActiveTicket() : null;

  // Si no hay ticket activo, mostrar vista vacía
  if (!ticket) {
    if (viewUnpaid) viewUnpaid.style.display = 'none';
    if (viewPaid) viewPaid.style.display = 'none';
    if (viewEmpty) viewEmpty.style.display = 'block';
    return;
  }

  if (viewEmpty) viewEmpty.style.display = 'none';

  if (isPaid) {
    if (viewUnpaid) viewUnpaid.style.display = 'none';
    if (viewPaid) viewPaid.style.display = 'block';
  } else {
    if (viewUnpaid) viewUnpaid.style.display = 'block';
    if (viewPaid) viewPaid.style.display = 'none';
  }

  const unpaidTime = document.getElementById('estatus-unpaid-time');
  if (unpaidTime) unpaidTime.textContent = `${ticket.formattedElapsed} hrs (${ticket.elapsedMinutes} min)`;
  
  const unpaidDue = document.querySelector('#estatus-view-unpaid .metric-huge-value');
  if (unpaidDue) unpaidDue.textContent = ticket.totalDue;

  const unpaidTicketId = document.querySelector('#estatus-view-unpaid .status-row-item:nth-child(1) .val');
  if (unpaidTicketId) unpaidTicketId.textContent = ticket.id;

  const unpaidSpot = document.querySelector('#estatus-view-unpaid .status-row-item:nth-child(2) .val');
  if (unpaidSpot) unpaidSpot.textContent = `Cajón ${ticket.spot}`;

  const unpaidEntry = document.querySelector('#estatus-view-unpaid .status-row-item:nth-child(4) .val');
  if (unpaidEntry) unpaidEntry.textContent = `Hoy · ${ticket.entryFormatted}`;

  const paidTicketId = document.querySelector('#estatus-view-paid .status-row-item:nth-child(1) .val');
  if (paidTicketId) paidTicketId.textContent = ticket.id;

  const paidSpot = document.querySelector('#estatus-view-paid .status-row-item:nth-child(2) .val');
  if (paidSpot) paidSpot.textContent = `Cajón ${ticket.spot}`;

  const paidDeadline = document.querySelector('#estatus-view-paid .status-row-item:nth-child(3) .val');
  if (paidDeadline && ticket.deadlineFormatted) paidDeadline.textContent = `Hasta las ${ticket.deadlineFormatted}`;

  const paidAmount = document.querySelector('#estatus-view-paid .status-row-item:nth-child(4) .val');
  if (paidAmount) paidAmount.textContent = `$${parseFloat(ticket.totalPaid || 20).toFixed(2)} (Hoy)`;
}

/**
 * Temporizador persistente de 20 minutos de tolerancia (contra reloj real)
 */
function startPersistentCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);

  countdownInterval = setInterval(() => {
    if (!window.iotService) return;
    const ticket = window.iotService.getActiveTicket();

    const timerEstatus = document.getElementById('countdown-exit-timer');
    const timerTicketPaid = document.getElementById('ticket-paid-countdown');

    if (ticket && ticket.paid && ticket.exitDeadline) {
      const now = Date.now();
      const remainingSecs = Math.max(0, Math.floor((ticket.exitDeadline - now) / 1000));
      const mins = Math.floor(remainingSecs / 60);
      const secs = remainingSecs % 60;
      const formatted = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;

      if (timerEstatus) timerEstatus.textContent = formatted;
      if (timerTicketPaid) timerTicketPaid.textContent = formatted;

      if (remainingSecs === 0) {
        if (timerEstatus) timerEstatus.style.color = '#B83232';
        if (timerTicketPaid) timerTicketPaid.style.color = '#B83232';
      } else {
        if (timerEstatus) timerEstatus.style.color = '#111815';
        if (timerTicketPaid) timerTicketPaid.style.color = '#111815';
      }
    } else {
      if (timerEstatus) timerEstatus.textContent = '20:00';
      if (timerTicketPaid) timerTicketPaid.textContent = '20:00';
    }
  }, 1000);
}

/**
 * Toast interactivo
 */
function showToast(message) {
  const toast = document.getElementById('interactive-toast');
  const msgEl = document.getElementById('toast-message');
  if (!toast || !msgEl) return;

  msgEl.textContent = message;
  toast.classList.add('visible');

  setTimeout(() => {
    toast.classList.remove('visible');
  }, 2400);
}
