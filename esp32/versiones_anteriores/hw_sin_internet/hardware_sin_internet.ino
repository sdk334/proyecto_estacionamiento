// --- Mux 1 (10 Sensores Infrarrojos en C6-C15 + 2 LEDs en C0-C3) ---
const int MUX1_S0 = 18;
const int MUX1_S1 = 19;
const int MUX1_S2 = 22;
const int MUX1_S3 = 23;
const int MUX1_SIG = 32; 

// --- Mux 2 (8 LEDs restantes en C0-C15) ---
const int MUX2_S0 = 13;
const int MUX2_S1 = 12;
const int MUX2_S2 = 14;
const int MUX2_S3 = 27;
const int MUX2_SIG = 26; 

// --- Botón y Servomotor de ENTRADA ---
const int PIN_BOTON_ENTRADA = 25; // Entre D25 y GND
const int PIN_SERVO_ENTRADA = 33; // Señal servo entrada en D33

// --- Botón y Servomotor de SALIDA ---
const int PIN_BOTON_SALIDA = 16;  // Entre D16 y GND
const int PIN_SERVO_SALIDA = 17;  // Señal servo salida en D17

// --- Umbral de sensibilidad analógica (0 a 4095) ---
const int UMBRAL_IR = 3200;

int estadoSensor[10] = {0}; 
int lugaresLibres = 10;

// Variables para Pluma de ENTRADA
bool plumaEntradaAbierta = false;
int anguloEntrada = 0;          // 0° = Cerrada, 90° = Abierta
unsigned long tiempoAperturaEntrada = 0;
bool botonEntradaAntes = false;
int contadorTurnos = 0;

// Variables para Pluma de SALIDA
bool plumaSalidaAbierta = false;
int anguloSalida = 0;           // 0° = Cerrada, 90° = Abierta
unsigned long tiempoAperturaSalida = 0;
bool botonSalidaAntes = false;

const unsigned long TIEMPO_ESPERA_PLUMA = 3500; // 3.5 segundos abierta

// Timers para servos y monitor serial
unsigned long ultimoPulsoServos = 0;
unsigned long ultimoTiempoSerial = 0;

void setMuxCanal(int mux, int canal) {
  if (mux == 1) {
    digitalWrite(MUX1_S0, (canal & 0x01) ? HIGH : LOW);
    digitalWrite(MUX1_S1, (canal & 0x02) ? HIGH : LOW);
    digitalWrite(MUX1_S2, (canal & 0x04) ? HIGH : LOW);
    digitalWrite(MUX1_S3, (canal & 0x08) ? HIGH : LOW);
  } else {
    digitalWrite(MUX2_S0, (canal & 0x01) ? HIGH : LOW);
    digitalWrite(MUX2_S1, (canal & 0x02) ? HIGH : LOW);
    digitalWrite(MUX2_S2, (canal & 0x04) ? HIGH : LOW);
    digitalWrite(MUX2_S3, (canal & 0x08) ? HIGH : LOW);
  }
}

// Envía el pulso a ambos servomotores cada 20 ms sin pausar los LEDs
void actualizarServos(int angEnt, int angSal) {
  if (millis() - ultimoPulsoServos >= 20) {
    ultimoPulsoServos = millis();
    
    // Pulso para Servo de Entrada
    int pulsoEnt = map(angEnt, 0, 180, 500, 2400);
    digitalWrite(PIN_SERVO_ENTRADA, HIGH);
    delayMicroseconds(pulsoEnt);
    digitalWrite(PIN_SERVO_ENTRADA, LOW);

    // Pulso para Servo de Salida
    int pulsoSal = map(angSal, 0, 180, 500, 2400);
    digitalWrite(PIN_SERVO_SALIDA, HIGH);
    delayMicroseconds(pulsoSal);
    digitalWrite(PIN_SERVO_SALIDA, LOW);
  }
}

void setup() {
  Serial.begin(115200);
  
  // Pines Mux 1
  pinMode(MUX1_S0, OUTPUT); pinMode(MUX1_S1, OUTPUT);
  pinMode(MUX1_S2, OUTPUT); pinMode(MUX1_S3, OUTPUT);
  
  // Pines Mux 2
  pinMode(MUX2_S0, OUTPUT); pinMode(MUX2_S1, OUTPUT);
  pinMode(MUX2_S2, OUTPUT); pinMode(MUX2_S3, OUTPUT);
  pinMode(MUX2_SIG, OUTPUT); 

  // Configurar Botones (Pull-Up interno) y Servos
  pinMode(PIN_BOTON_ENTRADA, INPUT_PULLUP);
  pinMode(PIN_SERVO_ENTRADA, OUTPUT);
  
  pinMode(PIN_BOTON_SALIDA, INPUT_PULLUP);
  pinMode(PIN_SERVO_SALIDA, OUTPUT);

  Serial.println("=== SISTEMA DE ESTACIONAMIENTO (ENTRADA Y SALIDA) LISTO ===");
  Serial.println("- Boton Entrada (D25) -> Servo Entrada (D33)");
  Serial.println("- Boton Salida  (D16) -> Servo Salida  (D17)");
}

void loop() {
  // ==========================================
  // 1. LEER LOS 10 SENSORES (C6 a C15 en MUX 1)
  // ==========================================
  pinMode(MUX1_SIG, INPUT);
  lugaresLibres = 0;
  
  for (int i = 0; i < 10; i++) {
    setMuxCanal(1, i + 6);
    delayMicroseconds(80);
    analogRead(MUX1_SIG);
    int lectura = analogRead(MUX1_SIG);
    
    if (lectura < UMBRAL_IR) {
      estadoSensor[i] = 1; // Ocupado
    } else {
      estadoSensor[i] = 0; // Libre
      lugaresLibres++;
    }
  }

  // ==========================================
  // 2. LÓGICA DE PLUMA DE ENTRADA (D25 / D33)
  // ==========================================
  bool botonEntradaActual = (digitalRead(PIN_BOTON_ENTRADA) == LOW);

  if (botonEntradaActual && !botonEntradaAntes && !plumaEntradaAbierta) {
    if (lugaresLibres > 0) {
      contadorTurnos++;
      plumaEntradaAbierta = true;
      anguloEntrada = 90; // Abre pluma de entrada
      tiempoAperturaEntrada = millis();
      
      Serial.println("----------------------------------------");
      Serial.print(">>> [ENTRADA] Turno asignado: #");
      Serial.println(contadorTurnos);
      Serial.print(">>> Lugares disponibles: ");
      Serial.println(lugaresLibres);
      Serial.println(">>> Abriendo pluma de ENTRADA...");
      Serial.println("----------------------------------------");
    } else {
      Serial.println("----------------------------------------");
      Serial.println(">>> [ENTRADA] ACCESO DENEGADO: Estacionamiento lleno.");
      Serial.println("----------------------------------------");
    }
  }
  botonEntradaAntes = botonEntradaActual;

  if (plumaEntradaAbierta && (millis() - tiempoAperturaEntrada >= TIEMPO_ESPERA_PLUMA)) {
    plumaEntradaAbierta = false;
    anguloEntrada = 0; // Cierra pluma de entrada
    Serial.println(">>> [ENTRADA] Pluma cerrada.");
  }

  // ==========================================
  // 3. LÓGICA DE PLUMA DE SALIDA (D16 / D17)
  // ==========================================
  bool botonSalidaActual = (digitalRead(PIN_BOTON_SALIDA) == LOW);

  if (botonSalidaActual && !botonSalidaAntes && !plumaSalidaAbierta) {
    plumaSalidaAbierta = true;
    anguloSalida = 90; // Abre pluma de salida
    tiempoAperturaSalida = millis();
    
    Serial.println("----------------------------------------");
    Serial.println("<<< [SALIDA] Usuario saliendo. Abriendo pluma de SALIDA...");
    Serial.println("----------------------------------------");
  }
  botonSalidaAntes = botonSalidaActual;

  if (plumaSalidaAbierta && (millis() - tiempoAperturaSalida >= TIEMPO_ESPERA_PLUMA)) {
    plumaSalidaAbierta = false;
    anguloSalida = 0; // Cierra pluma de salida
    Serial.println("<<< [SALIDA] Pluma cerrada.");
  }

  // Refrescar posición de ambos servos
  actualizarServos(anguloEntrada, anguloSalida);

  // ==========================================
  // 4. MONITOR SERIAL DE SENSORES (Cada 500 ms)
  // ==========================================
  if (millis() - ultimoTiempoSerial >= 500) {
    ultimoTiempoSerial = millis();
    Serial.print("Sensores (0=Libre, 1=Ocupado): ");
    for (int i = 0; i < 10; i++) {
      Serial.print(estadoSensor[i]);
      Serial.print(" ");
    }
    Serial.print("| Libres: ");
    Serial.println(lugaresLibres);
  }

  // ==========================================
  // 5. BARRIDO VISUAL DE LOS 10 LEDs (POV)
  // ==========================================
  pinMode(MUX1_SIG, OUTPUT);

  for (int frame = 0; frame < 15; frame++) {
    for (int i = 0; i < 10; i++) {
      if (i < 2) {
        int canal = (estadoSensor[i] == 1) ? ((i * 2) + 1) : (i * 2);
        setMuxCanal(1, canal);
        digitalWrite(MUX1_SIG, HIGH);   
        delayMicroseconds(1000); 
        digitalWrite(MUX1_SIG, LOW);    
      } else {
        int idx = i - 2; 
        int canal = (estadoSensor[i] == 1) ? ((idx * 2) + 1) : (idx * 2);
        setMuxCanal(2, canal);
        digitalWrite(MUX2_SIG, HIGH);   
        delayMicroseconds(1000);
        digitalWrite(MUX2_SIG, LOW);    
      }
    }
    // Mantiene actualizados ambos servos durante el barrido de LEDs
    actualizarServos(anguloEntrada, anguloSalida);
  }
}