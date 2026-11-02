/*
 * RC LAB 3D - Firmware de adquisición y control
 * ------------------------------------------------
 * Montaje de referencia:
 *   A0  -> medición del banco de condensadores a través del divisor 1 M / 470 k
 *   A1  -> potenciómetro de voltaje techo (0..5 V)
 *   D2  -> LED rojo    (30 % del voltaje techo)
 *   D3  -> LED amarillo 1 (60 %)
 *   D4  -> LED amarillo 2 (90 %)
 *   D7  -> pulsador de descarga (INPUT_PULLUP, activo en LOW)
 *   D9  -> PWM del MOSFET IRLZ44N
 *
 * Protocolo serial definitivo (9600 baudios, 8N1):
 *   R1,<millis>,<voltaje_tanque>,<voltaje_techo>,<estado>,<pwm>,<adc_A0>,<adc_A1>\r\n
 *
 * Ejemplo:
 *   R1,12345,2.135,4.200,C,0,437,860
 *
 * Estados:
 *   C = carga, D = descarga, S = estable
 *
 * Ancho de banda:
 *   Una trama típica ocupa menos de 55 bytes. A 10 Hz son ~550 bytes/s.
 *   A 9600 baudios el límite práctico es ~960 bytes/s; queda margen suficiente.
 *
 * Seguridad:
 *   - La entrada A0 nunca debe superar 5 V. El divisor 1 M / 470 k solo es
 *     seguro si el voltaje del tanque no excede V_A0_max * (1470/470) = 15.64 V.
 *   - El valor nominal de 25 V de los condensadores NO autoriza aplicar 25 V.
 *   - Este firmware no controla la alimentación del montaje.
 *   - La rampa PWM no debe interpretarse como una ruta de descarga verificada.
 *
 * El firmware original del proyecto se conserva en:
 *   firmware/legacy/sketch_oct5a_original.ino
 */

// Pines de LEDs
const uint8_t LED_ROJO = 2;
const uint8_t LED_AMARILLO_1 = 3;
const uint8_t LED_AMARILLO_2 = 4;

// Pines de control y adquisición
const uint8_t PIN_BOTON = 7;
const uint8_t PIN_MOSFET = 9;
const uint8_t PIN_MEDICION = A0;
const uint8_t PIN_POTEN = A1;

// Parámetros de adquisición
const unsigned long BAUDIOS = 9600;
const unsigned long PERIODO_TELEMETRIA_MS = 100;   // 10 Hz
const unsigned long PERIODO_RAMPA_MS = 15;
const unsigned long PERIODO_ANTIRREBOTE_MS = 30;
const unsigned long VENTANA_PENDIENTE_MS = 600;
const uint8_t CONFIRMACION_ESTADO = 3;

// Divisor de medición: R1 = 1 M, R2 = 470 k
const float VREF = 5.0;
const float DIVISOR_R1 = 1000000.0;
const float DIVISOR_R2 = 470000.0;
const float GANANCIA_DIVISOR = (DIVISOR_R1 + DIVISOR_R2) / DIVISOR_R2; // 3.12766

// Umbrales de pendiente para histéresis (V/s)
const float PENDIENTE_CARGA = 0.020;
const float PENDIENTE_DESCARGA = -0.020;

enum EstadoTanque : uint8_t {
  ESTADO_CARGA = 'C',
  ESTADO_DESCARGA = 'D',
  ESTADO_ESTABLE = 'S'
};

// Estado del pulsador y de la rampa
bool botonEstable = HIGH;
bool botonAnterior = HIGH;
unsigned long ultimoCambioBoton = 0;

bool rampaActiva = false;
int pwmActual = 0;
unsigned long ultimoPasoRampa = 0;

// Historial corto para estimar pendiente sin bloquear
const uint8_t HISTORIAL = 8;
float historialVoltaje[HISTORIAL];
unsigned long historialTiempo[HISTORIAL];
uint8_t historialIndice = 0;
uint8_t historialCuenta = 0;

EstadoTanque estadoActual = ESTADO_ESTABLE;
EstadoTanque estadoCandidato = ESTADO_ESTABLE;
uint8_t contadorEstado = 0;

unsigned long ultimaTelemetria = 0;
float voltajeTanque = 0.0;
float voltajeTecho = 0.0;

void setup() {
  pinMode(LED_ROJO, OUTPUT);
  pinMode(LED_AMARILLO_1, OUTPUT);
  pinMode(LED_AMARILLO_2, OUTPUT);
  pinMode(PIN_MOSFET, OUTPUT);
  pinMode(PIN_BOTON, INPUT_PULLUP);

  analogWrite(PIN_MOSFET, 0);
  digitalWrite(LED_ROJO, LOW);
  digitalWrite(LED_AMARILLO_1, LOW);
  digitalWrite(LED_AMARILLO_2, LOW);

  Serial.begin(BAUDIOS);
  delay(200);
  Serial.println(F("# RC LAB 3D firmware 1.0 | protocolo R1 | 9600 baudios"));
}

void leerBoton(unsigned long ahora) {
  bool lectura = digitalRead(PIN_BOTON);

  if (lectura != botonAnterior) {
    ultimoCambioBoton = ahora;
    botonAnterior = lectura;
  }

  if ((ahora - ultimoCambioBoton) >= PERIODO_ANTIRREBOTE_MS) {
    if (lectura != botonEstable) {
      botonEstable = lectura;

      // Flanco de pulsación: iniciar una sola rampa 255 -> 0.
      if (botonEstable == LOW && !rampaActiva) {
        pwmActual = 255;
        analogWrite(PIN_MOSFET, pwmActual);
        rampaActiva = true;
        ultimoPasoRampa = ahora;
      }
    }
  }
}

void actualizarRampa(unsigned long ahora) {
  if (!rampaActiva) {
    return;
  }

  if ((ahora - ultimoPasoRampa) >= PERIODO_RAMPA_MS) {
    ultimoPasoRampa = ahora;

    if (pwmActual >= 5) {
      pwmActual -= 5;
    } else {
      pwmActual = 0;
    }

    analogWrite(PIN_MOSFET, pwmActual);

    if (pwmActual == 0) {
      rampaActiva = false;
    }
  }
}

void actualizarEstado(float pendiente) {
  EstadoTanque candidato = ESTADO_ESTABLE;

  if (rampaActiva || botonEstable == LOW) {
    candidato = ESTADO_DESCARGA;
  } else if (pendiente > PENDIENTE_CARGA && voltajeTanque < (voltajeTecho - 0.02)) {
    candidato = ESTADO_CARGA;
  } else if (pendiente < PENDIENTE_DESCARGA && voltajeTanque > 0.02) {
    candidato = ESTADO_DESCARGA;
  } else {
    candidato = ESTADO_ESTABLE;
  }

  if (candidato == estadoActual) {
    contadorEstado = 0;
    return;
  }

  if (candidato == estadoCandidato) {
    if (contadorEstado < 255) {
      contadorEstado++;
    }
  } else {
    estadoCandidato = candidato;
    contadorEstado = 1;
  }

  if (contadorEstado >= CONFIRMACION_ESTADO) {
    estadoActual = candidato;
    contadorEstado = 0;
  }
}

float estimarPendiente(unsigned long ahora) {
  if (historialCuenta < 2) {
    return 0.0;
  }

  uint8_t indiceViejo = (historialIndice + HISTORIAL - historialCuenta) % HISTORIAL;
  unsigned long dtMs = ahora - historialTiempo[indiceViejo];

  if (dtMs == 0 || dtMs > 5000) {
    return 0.0;
  }

  float dt = dtMs / 1000.0;
  return (voltajeTanque - historialVoltaje[indiceViejo]) / dt;
}

void guardarHistorial(unsigned long ahora) {
  historialVoltaje[historialIndice] = voltajeTanque;
  historialTiempo[historialIndice] = ahora;
  historialIndice = (historialIndice + 1) % HISTORIAL;

  if (historialCuenta < HISTORIAL) {
    historialCuenta++;
  }
}

void actualizarLEDs() {
  if (voltajeTecho <= 0.05) {
    digitalWrite(LED_ROJO, LOW);
    digitalWrite(LED_AMARILLO_1, LOW);
    digitalWrite(LED_AMARILLO_2, LOW);
    return;
  }

  digitalWrite(LED_ROJO, voltajeTanque >= (voltajeTecho * 0.30) ? HIGH : LOW);
  digitalWrite(LED_AMARILLO_1, voltajeTanque >= (voltajeTecho * 0.60) ? HIGH : LOW);
  digitalWrite(LED_AMARILLO_2, voltajeTanque >= (voltajeTecho * 0.90) ? HIGH : LOW);
}

void enviarTelemetria(unsigned long ahora, int adcA0, int adcA1) {
  Serial.print(F("R1,"));
  Serial.print(ahora);
  Serial.print(',');
  Serial.print(voltajeTanque, 3);
  Serial.print(',');
  Serial.print(voltajeTecho, 3);
  Serial.print(',');
  Serial.print(static_cast<char>(estadoActual));
  Serial.print(',');
  Serial.print(pwmActual);
  Serial.print(',');
  Serial.print(adcA0);
  Serial.print(',');
  Serial.println(adcA1);
}

void loop() {
  unsigned long ahora = millis();

  leerBoton(ahora);
  actualizarRampa(ahora);

  if ((ahora - ultimaTelemetria) >= PERIODO_TELEMETRIA_MS) {
    ultimaTelemetria = ahora;

    int adcA0 = analogRead(PIN_MEDICION);
    int adcA1 = analogRead(PIN_POTEN);

    float voltajePin = adcA0 * (VREF / 1023.0);
    voltajeTanque = voltajePin * GANANCIA_DIVISOR;
    voltajeTecho = adcA1 * (VREF / 1023.0);

    float pendiente = estimarPendiente(ahora);
    actualizarEstado(pendiente);
    actualizarLEDs();
    guardarHistorial(ahora);
    enviarTelemetria(ahora, adcA0, adcA1);
  }
}
