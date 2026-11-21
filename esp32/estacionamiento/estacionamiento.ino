/*
 *  Lo que ESCRIBE en Firebase (es el único dueño de estos campos):
 *    /parking/spots/01..10/sensor      true/false  (¿hay un coche físicamente?)
 *    /parking/status/latido            hora del servidor, cada 5 s ("sigo vivo")
 *    /parking/status/plumillas         {entrada:bool, salida:bool}
 *    /parking/stats                    {entradasHoy:n, dia:"AAAA-MM-DD"}
 *    /parking/commands/gate_/resultado  "ok" | "lleno" | "abierta"
 *
 *  Lo que LEE de Firebase (lo escribe el dashboard):
 *    /parking/spots/01..10/manual      "libre" | "ocupado" | "mantenimiento" (opcional)
 *    /parking/commands/gate_entrada    {trigger:true, timestamp:...}
 *    /parking/commands/gate_salida     {trigger:true, timestamp:...}
 *
 *  Dos "trabajadores" (núcleos del ESP32):
 *    Núcleo 1 -> loop():          sensores, LEDs, botones, servos (no se puede frenar)
 *    Núcleo 0 -> tareaFirebase(): todo el internet (tarda 200-500 ms por petición)
 *  Así los LEDs no parpadean mientras se espera a Firebase.
 *
 *  Estructura del archivo:
 *   1. LIBRERÍAS
 *   2. CONFIGURACIÓN            <- lo único que se edita
 *   3. ESTADO GLOBAL
 *   4. HARDWARE (mux, sensores, LEDs)
 *   5. LÓGICA DEL ESTACIONAMIENTO
 *   6. FIREBASE (núcleo 0)
 *   7. setup()
 *   8. loop() (núcleo 1)
 *
 *  Librerías a instalar: ESP32Servo y ArduinoJson (versión 7).
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>  
#include <HTTPClient.h>
#include <ArduinoJson.h>       
#include <ESP32Servo.h>
#include <time.h>


// --- 2.1 Red y base de datos ---
const char* WIFI_SSID = "TU_RED_WIFI";
const char* WIFI_PASS = "TU_CONTRASENA";
const char* DB_URL    = "https://park10-iot-31384-default-rtdb.firebaseio.com";  

// --- 2.2 Pines del MUX 1 (sensores IR + 2 pares de LEDs) ---
//                          S0  S1  S2  S3
const int MUX1_S[4]    = { 18, 19, 22, 23 };
const int MUX1_SIG     = 32;   // ADC1: sirve con WiFi (ADC2 NO)

// --- 2.3 Pines del MUX 2 (8 pares de LEDs restantes) ---
//                          S0  S1  S2  S3
const int MUX2_S[4]    = { 13, 12, 14, 27 };
const int MUX2_SIG     = 26;

// --- 2.4 Botones y servos ---
const int PIN_BOTON_ENTRADA = 25;
const int PIN_SERVO_ENTRADA = 33;
const int PIN_BOTON_SALIDA  = 16;
const int PIN_SERVO_SALIDA  = 17;

// --- 2.5 Lugares ---
// Lugar n (1..10) = posición n-1. El valor es el canal del MUX1 de su sensor.
const int TOTAL_LUGARES = 10;
const uint8_t SENSOR_CANAL[TOTAL_LUGARES] = { 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 };

// --- 2.6 Umbrales y tiempos ---
const int UMBRAL_IR = 3200;                       // lectura < umbral => hay un coche
const unsigned long TIEMPO_PLUMILLA   = 3500;     // ms abierta
const unsigned long PERIODO_LATIDO    = 5000;     // ms entre "sigo vivo"
const unsigned long PERIODO_COMANDOS  = 1000;     // ms entre revisiones de órdenes
const unsigned long PERIODO_MANUAL    = 2000;     // ms entre revisiones de estados manuales
const int ANG_ABIERTA = 90;
const int ANG_CERRADA = 0;
const int FRAMES_LED  = 15;

// --- 2.7 Zona horaria (CDMX = UTC-6, sin horario de verano) ---
const long ZONA_HORARIA_SEG = -6 * 3600;

// ============================================================
// 3. ESTADO GLOBAL
// ============================================================
// "volatile" = lo leen/escriben dos núcleos a la vez; avisa al compilador que no lo "memorice".
enum EstadoLugar : uint8_t { LIBRE = 0, OCUPADO = 1, MANTENIMIENTO = 2 };
const char* NOMBRE_ESTADO[3] = { "libre", "ocupado", "mantenimiento" };

volatile bool   sensorOcupado[TOTAL_LUGARES];                      // verdad física (núcleo 1 escribe)
volatile int8_t estadoManual[TOTAL_LUGARES];                       // -1 = automático, 0/1/2 forzado (núcleo 0 escribe)

volatile bool ordenPendiente[2]    = { false, false };             // [0]=entrada [1]=salida (núcleo 0 -> 1)
volatile int8_t resultadoOrden[2]  = { -1, -1 };                   // -1 sin resultado, 0 ok, 1 lleno, 2 abierta (núcleo 1 -> 0)

struct Plumilla {
  Servo servo;
  volatile bool abierta = false;
  unsigned long tApertura = 0;
  bool botonAntes = false;
};
Plumilla plumaEntrada, plumaSalida;

volatile int entradasHoy = 0;
String diaContador = "";                 // día al que pertenece entradasHoy
unsigned long ultimoSerial = 0;

// ============================================================
// 4. HARDWARE
// ============================================================
void setMuxCanal(int mux, int canal) {
  const int* pines = (mux == 1) ? MUX1_S : MUX2_S;
  for (int bit = 0; bit < 4; bit++) digitalWrite(pines[bit], (canal >> bit) & 0x01);
}

void leerSensores() {
  pinMode(MUX1_SIG, INPUT);
  for (int i = 0; i < TOTAL_LUGARES; i++) {
    setMuxCanal(1, SENSOR_CANAL[i]);
    delayMicroseconds(80);
    analogRead(MUX1_SIG);                               // lectura descartada
    sensorOcupado[i] = analogRead(MUX1_SIG) < UMBRAL_IR;
  }
}

// Canal par = LED verde, impar = LED rojo. Lugares 0-1 en MUX1; 2..9 en MUX2.
void encenderLed(int lugar, bool rojo) {
  int mux  = (lugar < 2) ? 1 : 2;
  int base = ((lugar < 2) ? lugar : lugar - 2) * 2;
  int sig  = (mux == 1) ? MUX1_SIG : MUX2_SIG;
  setMuxCanal(mux, base + (rojo ? 1 : 0));
  digitalWrite(sig, HIGH);
  delayMicroseconds(1000);
  digitalWrite(sig, LOW);
}

// ============================================================
// 5. LÓGICA DEL ESTACIONAMIENTO
// ============================================================

// Si el dashboard forzó un estado manda ese; si no, el sensor.
EstadoLugar estadoLugar(int i) {
  if (estadoManual[i] >= 0) return (EstadoLugar)estadoManual[i];
  return sensorOcupado[i] ? OCUPADO : LIBRE;
}

int contarLibres() {
  int n = 0;
  for (int i = 0; i < TOTAL_LUGARES; i++) if (estadoLugar(i) == LIBRE) n++;
  return n;
}

// Devuelve: 0 = abierta, 1 = rechazada (lleno), 2 = ya estaba abierta
int abrirPlumilla(bool esEntrada, const char* origen) {
  Plumilla& p = esEntrada ? plumaEntrada : plumaSalida;
  if (p.abierta) return 2;

  if (esEntrada) {
    if (contarLibres() == 0) {
      Serial.printf("[ENTRADA] DENEGADA (%s): lleno\n", origen);
      return 1;
    }
    entradasHoy++;
    Serial.printf("[ENTRADA] Turno #%d (%s)\n", (int)entradasHoy, origen);
  } else {
    Serial.printf("[SALIDA] Abierta (%s)\n", origen);
  }
  p.abierta = true;
  p.tApertura = millis();
  p.servo.write(ANG_ABIERTA);
  return 0;
}

void cerrarSiToca(Plumilla& p, const char* nombre) {
  if (p.abierta && millis() - p.tApertura >= TIEMPO_PLUMILLA) {
    p.abierta = false;
    p.servo.write(ANG_CERRADA);
    Serial.printf("[%s] Plumilla cerrada\n", nombre);
  }
}

void revisarBoton(int pin, Plumilla& p, bool esEntrada) {
  bool actual = (digitalRead(pin) == LOW);
  if (actual && !p.botonAntes) abrirPlumilla(esEntrada, "boton");
  p.botonAntes = actual;
}

// Órdenes que dejó el núcleo 0 (vienen del dashboard)
void revisarOrdenes() {
  for (int k = 0; k < 2; k++) {
    if (ordenPendiente[k]) {
      ordenPendiente[k] = false;
      resultadoOrden[k] = abrirPlumilla(k == 0, "dashboard");
    }
  }
}

// "AAAA-MM-DD" de hoy, o "" si todavía no hay hora de internet
String diaHoy() {
  struct tm t;
  if (!getLocalTime(&t, 0)) return "";
  char buf[11];
  strftime(buf, sizeof(buf), "%Y-%m-%d", &t);
  return String(buf);
}

// Si cambió el día, el contador vuelve a 0
void revisarNuevoDia() {
  String hoy = diaHoy();
  if (hoy == "") return;
  if (diaContador == "") diaContador = hoy;
  else if (hoy != diaContador) { diaContador = hoy; entradasHoy = 0; }
}

// ============================================================
// 6. FIREBASE (corre en el núcleo 0)
// ============================================================
WiFiClientSecure clienteTLS;   // una sola conexión segura reutilizada (el "saludo" TLS es lento)
HTTPClient http;

// Una petición a Firebase. Devuelve el código HTTP (200 = bien). Si pasas "respuesta", la llena.
int firebase(const char* metodo, const String& ruta, const String& cuerpo = "", String* respuesta = nullptr) {
  http.setReuse(true);
  http.setTimeout(4000);
  http.begin(clienteTLS, String(DB_URL) + ruta + ".json");
  http.addHeader("Content-Type", "application/json");
  int codigo = (strcmp(metodo, "GET") == 0) ? http.GET() : http.sendRequest(metodo, cuerpo);
  if (respuesta && codigo == 200) *respuesta = http.getString();
  http.end();
  return codigo;
}

String clave2(int i) { char b[3]; snprintf(b, sizeof(b), "%02d", i + 1); return String(b); }  // 0 -> "01"

void tareaFirebase(void*) {
  clienteTLS.setInsecure();     // sin validar certificado: suficiente para un proyecto escolar

  bool enviadoSensor[TOTAL_LUGARES];
  bool primeraVez = true;
  bool plumasEnv[2] = { false, false };
  bool plumasInicial = true;
  int  entradasEnv = -1;
  bool contadorRestaurado = false;
  unsigned long tLatido = 0, tComandos = 0, tManual = 0;

  for (;;) {
    // --- Sin WiFi: reintentar y esperar ---
    if (WiFi.status() != WL_CONNECTED) { WiFi.reconnect(); vTaskDelay(pdMS_TO_TICKS(3000)); continue; }
    unsigned long ahora = millis();

    // --- A. Latido: "sigo vivo" (el dashboard avisa de error si deja de cambiar) ---
    if (ahora - tLatido >= PERIODO_LATIDO || tLatido == 0) {
      tLatido = ahora;
      firebase("PUT", "/parking/status/latido", "{\".sv\":\"timestamp\"}");   // el servidor pone la hora
    }

    // --- B. Subir SOLO los sensores que cambiaron (una sola petición con varias rutas) ---
    String cambios = "";
    for (int i = 0; i < TOTAL_LUGARES; i++) {
      bool v = sensorOcupado[i];
      if (primeraVez || v != enviadoSensor[i]) {
        if (cambios != "") cambios += ",";
        cambios += "\"" + clave2(i) + "/sensor\":" + (v ? "true" : "false");
      }
    }
    if (cambios != "") {
      if (firebase("PATCH", "/parking/spots", "{" + cambios + "}") == 200) {
        for (int i = 0; i < TOTAL_LUGARES; i++) enviadoSensor[i] = sensorOcupado[i];
        primeraVez = false;
      }
    }

    // --- C. Subir estado de plumillas si cambió ---
    bool pe = plumaEntrada.abierta, ps = plumaSalida.abierta;
    if (plumasInicial || pe != plumasEnv[0] || ps != plumasEnv[1]) {
      String j = String("{\"entrada\":") + (pe ? "true" : "false") + ",\"salida\":" + (ps ? "true" : "false") + "}";
      if (firebase("PATCH", "/parking/status/plumillas", j) == 200) { plumasEnv[0] = pe; plumasEnv[1] = ps; plumasInicial = false; }
    }

    // --- D. Contador del día: restaurarlo tras un reinicio, y subirlo cuando cambia ---
    String hoy = diaHoy();
    if (hoy != "") {
      if (!contadorRestaurado) {
        String r;
        if (firebase("GET", "/parking/stats", "", &r) == 200) {
          JsonDocument d;
          if (!deserializeJson(d, r) && d["dia"] == hoy) entradasHoy = d["entradasHoy"] | 0;
          contadorRestaurado = true;
        }
      } else if (entradasEnv != entradasHoy) {
        int n = entradasHoy;
        String j = "{\"entradasHoy\":" + String(n) + ",\"dia\":\"" + diaContador + "\"}";
        if (firebase("PATCH", "/parking/stats", j) == 200) entradasEnv = n;
      }
    }

    // --- E. Leer órdenes de plumilla del dashboard ---
    if (ahora - tComandos >= PERIODO_COMANDOS) {
      tComandos = ahora;
      String r;
      if (firebase("GET", "/parking/commands", "", &r) == 200) {
        JsonDocument d;
        if (!deserializeJson(d, r)) {
          const char* nombres[2] = { "gate_entrada", "gate_salida" };
          for (int k = 0; k < 2; k++) {
            if (d[nombres[k]]["trigger"] == true && !ordenPendiente[k]) {
              ordenPendiente[k] = true;                                              // se la pasamos al núcleo 1
              firebase("PATCH", String("/parking/commands/") + nombres[k], "{\"trigger\":false}");  // para no repetirla
            }
          }
        }
      }
    }

    // --- F. Devolver el resultado de una orden ya ejecutada ---
    for (int k = 0; k < 2; k++) {
      if (resultadoOrden[k] >= 0) {
        const char* txt[3] = { "ok", "lleno", "abierta" };
        String j = String("{\"resultado\":\"") + txt[resultadoOrden[k]] + "\"}";
        if (firebase("PATCH", String("/parking/commands/") + (k == 0 ? "gate_entrada" : "gate_salida"), j) == 200)
          resultadoOrden[k] = -1;
      }
    }

    // --- G. Leer estados manuales de los lugares (mantenimiento, etc.) ---
    if (ahora - tManual >= PERIODO_MANUAL) {
      tManual = ahora;
      String r;
      if (firebase("GET", "/parking/spots", "", &r) == 200) {
        JsonDocument d;
        if (!deserializeJson(d, r)) {
          for (int i = 0; i < TOTAL_LUGARES; i++) {
            const char* m = d[clave2(i)]["manual"] | "";
            int8_t nuevo = -1;
            for (int k = 0; k < 3; k++) if (strcmp(m, NOMBRE_ESTADO[k]) == 0) nuevo = k;
            estadoManual[i] = nuevo;
          }
        }
      }
    }

    vTaskDelay(pdMS_TO_TICKS(100));   // respiro para no saturar el procesador
  }
}

// ============================================================
// 7. SETUP
// ============================================================
void conectarWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Conectando a WiFi");
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 20000) { delay(500); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? "\nWiFi listo" : "\nSin WiFi (el estacionamiento sigue funcionando)");
}

void setup() {
  Serial.begin(115200);

  for (int b = 0; b < 4; b++) { pinMode(MUX1_S[b], OUTPUT); pinMode(MUX2_S[b], OUTPUT); }
  pinMode(MUX2_SIG, OUTPUT);
  pinMode(PIN_BOTON_ENTRADA, INPUT_PULLUP);
  pinMode(PIN_BOTON_SALIDA,  INPUT_PULLUP);

  for (int i = 0; i < TOTAL_LUGARES; i++) { sensorOcupado[i] = false; estadoManual[i] = -1; }

  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  plumaEntrada.servo.setPeriodHertz(50);
  plumaSalida.servo.setPeriodHertz(50);
  plumaEntrada.servo.attach(PIN_SERVO_ENTRADA, 500, 2400);
  plumaSalida.servo.attach(PIN_SERVO_SALIDA, 500, 2400);
  plumaEntrada.servo.write(ANG_CERRADA);
  plumaSalida.servo.write(ANG_CERRADA);

  conectarWiFi();
  configTime(ZONA_HORARIA_SEG, 0, "pool.ntp.org");

  // Lanza el "segundo trabajador" en el núcleo 0 (loop() ya corre en el núcleo 1)
  xTaskCreatePinnedToCore(tareaFirebase, "firebase", 16384, NULL, 1, NULL, 0);

  Serial.println("=== ESTACIONAMIENTO LISTO ===");
}

// ============================================================
// 8. LOOP (núcleo 1): nunca espera a internet
// ============================================================
void loop() {
  leerSensores();
  revisarBoton(PIN_BOTON_ENTRADA, plumaEntrada, true);
  revisarBoton(PIN_BOTON_SALIDA,  plumaSalida,  false);
  revisarOrdenes();                                   // órdenes del dashboard
  cerrarSiToca(plumaEntrada, "ENTRADA");
  cerrarSiToca(plumaSalida,  "SALIDA");
  revisarNuevoDia();

  if (millis() - ultimoSerial >= 500) {
    ultimoSerial = millis();
    Serial.print("Estados (0=Libre 1=Ocupado 2=Mant): ");
    for (int i = 0; i < TOTAL_LUGARES; i++) { Serial.print((int)estadoLugar(i)); Serial.print(" "); }
    Serial.printf("| Libres: %d | Entradas hoy: %d | WiFi: %s\n",
                  contarLibres(), (int)entradasHoy, WiFi.status() == WL_CONNECTED ? "ok" : "caido");
  }

  // Barrido de LEDs (persistencia de visión): rojo si ocupado o en mantenimiento
  pinMode(MUX1_SIG, OUTPUT);
  for (int frame = 0; frame < FRAMES_LED; frame++) {
    for (int i = 0; i < TOTAL_LUGARES; i++) encenderLed(i, estadoLugar(i) != LIBRE);
  }
}