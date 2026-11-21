/*
 * Lectura de 16 canales del multiplexor CD74HC4067 con ESP32
 * - Canales C0 a C15: Lectura analógica directa de cada canal (0 a 4095)
 * 
 * Conexiones:
 *  - Multiplexor SIG -> ESP32 Pin 34 (ADC1 - Entrada Analógica)
 *  - S0 -> ESP32 Pin 22 (Bit 0 - LSB)
 *  - S1 -> ESP32 Pin 21 (Bit 1)
 *  - S2 -> ESP32 Pin 19 (Bit 2)
 *  - S3 -> ESP32 Pin 18 (Bit 3 - MSB)
 *  - EN -> GND (Habilitado / Activo en bajo)
 */

// Definición de pines
const int PIN_SIG = 34;  // Pin común analógico del multiplexor (ADC1_CH6)
const int PIN_S0  = 22;  // Bit 0 (LSB)
const int PIN_S1  = 21;  // Bit 1
const int PIN_S2  = 19;  // Bit 2
const int PIN_S3  = 18;  // Bit 3 (MSB)

const uint8_t TOTAL_CANALES = 16; // C0 a C15

// Arreglo para almacenar el valor analógico de los 16 canales
uint16_t muxValues[TOTAL_CANALES];

/**
 * Selecciona el canal activo del multiplexor (0 a 15) mediante lógica binaria de 4 bits.
 */
void setMuxChannel(uint8_t channel) {
  digitalWrite(PIN_S0, (channel >> 0) & 0x01); // Bit 0
  digitalWrite(PIN_S1, (channel >> 1) & 0x01); // Bit 1
  digitalWrite(PIN_S2, (channel >> 2) & 0x01); // Bit 2
  digitalWrite(PIN_S3, (channel >> 3) & 0x01); // Bit 3
}

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    ; // Espera a que el puerto serie esté listo
  }

  // 1. Configurar los pines de selección como salidas digitales
  pinMode(PIN_S0, OUTPUT);
  pinMode(PIN_S1, OUTPUT);
  pinMode(PIN_S2, OUTPUT);
  pinMode(PIN_S3, OUTPUT);

  digitalWrite(PIN_S0, LOW);
  digitalWrite(PIN_S1, LOW);
  digitalWrite(PIN_S2, LOW);
  digitalWrite(PIN_S3, LOW);

  // Configuración de resolución del ADC en ESP32 (12 bits -> 0 a 4095)
  analogReadResolution(12);

  Serial.println("\n--- CD74HC4067: Lectura analógica de los 16 canales (C0 - C15) ---");
  // Encabezado de los 16 canales
  for (uint8_t ch = 0; ch < TOTAL_CANALES; ch++) {
    Serial.print("C");
    Serial.print(ch);
    if (ch < TOTAL_CANALES - 1) {
      Serial.print("\t");
    }
  }
  Serial.println();
}

void loop() {
  // Lectura secuencial de los 16 canales (C0 a C15)
  for (uint8_t ch = 0; ch < TOTAL_CANALES; ch++) {
    setMuxChannel(ch);

    // Retardo y lectura doble anti-ghosting del ADC
    delayMicroseconds(60);
    analogRead(PIN_SIG);                   // Descarta lectura previa
    delayMicroseconds(10);
    muxValues[ch] = analogRead(PIN_SIG);   // Lectura del valor analógico real
  }

  // Imprimir los valores analógicos de cada canal separados por tabulación
  for (uint8_t ch = 0; ch < TOTAL_CANALES; ch++) {
    Serial.print(muxValues[ch]);

    if (ch < TOTAL_CANALES - 1) {
      Serial.print("\t");
    }
  }
  Serial.println();

  delay(20); // Pausa entre barridos
}