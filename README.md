# RC LAB 3D — Laboratorio universitario de circuito RC

Plataforma local de adquisición, instrumentación y análisis para un circuito RC
con Arduino Uno. Integra firmware no bloqueante, backend FastAPI, visualización
3D con Three.js, gráficas Plotly, ajuste exponencial, simulador independiente y
persistencia de sesiones con trazabilidad.

> **Alcance científico:** la aplicación implementa y verifica el software y la
> matemática con datos sintéticos. **La validación con hardware físico sigue
> pendiente** (no había Arduino ni `arduino-cli` disponibles durante el
> desarrollo). Las afirmaciones sobre el montaje real están marcadas como
> hipótesis o pendientes de verificación.

---

## 1. Capacidades

- Adquisición serial a **9600 baudios** con protocolo `R1` a 10 Hz.
- Compatibilidad de lectura con el protocolo heredado de 2 campos y con el
  formato etiquetado antiguo (`Min:...`, `Limite_Pot:...`, etc.).
- Detección de la primera trama válida, timeout, datos obsoletos y reconexión.
- Emulador sintético etiquetado como **SIMULACION**, separado de **SERIAL**.
- Escena 3D interactiva del montaje (Three.js + OrbitControls locales).
- Gráficas científicas en vivo y análisis por segmentos de carga/descarga.
- Ajuste exponencial con SciPy: τ experimental, RMSE, R², residuos e
  incertidumbre.
- Estimación de τ en vivo con confirmación posterior usando el nivel final
  medido.
- Simulador RC independiente, sin contaminar las sesiones reales.
- Sesiones con ID único, guardado automático, checkpoints, historial,
  anotaciones y exportación CSV/JSON.
- Pestaña educativa **Conoce el laboratorio** con pausas didácticas que congelan
  solo la gráfica, nunca la adquisición.
- Interfaz sin frameworks: HTML, CSS y JavaScript clásico. Dependencias 3D y de
  gráficas servidas localmente (funciona sin internet).

---

## 2. Arquitectura

```
Arduino Uno                Backend FastAPI                     Navegador
┌──────────────┐   USB    ┌──────────────────────────┐  HTTP/WS  ┌──────────────────┐
│ firmware R1  │ ───────► │ serial_manager           │ ────────► │ index.html       │
│ A0/A1/D2-D4  │  9600    │   ├─ parser              │           │ app.js / store   │
│ D7 / D9 PWM  │          │   ├─ session_manager     │           │ circuit3d.js     │
└──────────────┘          │   └─ math_engine         │           │ charts.js        │
                          │ app.py (REST + WS)       │           │ analysis.js      │
                          │ data_sessions/ (JSON/CSV)│           │ simulator.js     │
                          └──────────────────────────┘           └──────────────────┘
```

El backend mantiene el estado de la conexión, la sesión activa y la
configuración eléctrica. El frontend recibe telemetría por WebSocket y consulta
REST para sesiones, análisis y simulación.

---

## 3. Estructura del proyecto

```
sketch_oct5a/
├── sketch_oct5a.ino                 # Firmware nuevo (R1, 9600 baudios)
├── firmware/
│   └── legacy/
│       └── sketch_oct5a_original.ino # Firmware original preservado
├── backend/
│   ├── app.py                       # FastAPI, REST, WebSocket, lifespan
│   ├── models.py                    # CircuitParameters, TelemetrySample, sesiones
│   ├── protocol.py                  # Constantes del protocolo y umbrales
│   ├── parser.py                    # Parser R1 + protocolos heredados
│   ├── serial_manager.py            # Puerto COM, emulador, concurrencia
│   ├── math_engine.py               # Modelos RC, ajuste, segmentos, incertidumbre
│   └── session_manager.py           # Persistencia atómica, historial, CSV/JSON
├── frontend/
│   ├── index.html                   # 5 vistas de la aplicación
│   ├── css/styles.css               # Tema de laboratorio claro
│   └── js/
│       ├── core.js                  # Matemática pura y TauTracker
│       ├── api.js                   # Cliente REST
│       ├── store.js                 # Buffer de telemetría
│       ├── circuit3d.js             # Escena 3D
│       ├── charts.js                # Gráficas Plotly
│       ├── analysis.js              # Panel de análisis
│       ├── simulator.js             # Simulador independiente
│       ├── app.js                   # Controlador principal
│       └── vendor/                  # three.min.js, OrbitControls.js, plotly.min.js
├── tests/
│   ├── conftest.py                  # Aislamiento de sesiones y estado
│   ├── test_parser.py
│   ├── test_math_engine.py
│   ├── test_serial_manager.py
│   ├── test_session_manager.py
│   ├── test_backend.py
│   └── frontend/core.test.js        # Pruebas Node del núcleo matemático
├── data_sessions/                   # Sesiones y archivos históricos (no borrar)
├── requirements.txt
├── start.ps1
├── start.bat
└── README.md
```

---

## 4. Requisitos

- Windows 10/11 (probado en Windows 11).
- Python 3.10 o superior (probado con **Python 3.14.5**).
- Node.js 18+ solo para ejecutar las pruebas del frontend (probado con
  **Node 24.21.0**).
- Arduino Uno con el firmware cargado y cable USB.
- Navegador moderno (Edge, Chrome o Firefox).

Dependencias Python fijadas en `requirements.txt`. Las dependencias 3D y de
gráficas ya están incluidas en `frontend/js/vendor/`.

---

## 5. Instalación y arranque

### 5.1 Inicio recomendado (Windows)

Desde PowerShell, en la carpeta del proyecto:

```powershell
.\start.ps1
```

o haga doble clic en `start.bat`.

El script:

1. Comprueba Python.
2. Crea `.venv` si no existe.
3. Instala `requirements.txt` dentro del entorno virtual.
4. Verifica que el puerto **8000** esté libre.
5. Arranca Uvicorn en primer plano.

Si PowerShell bloquea el script:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1
```

### 5.2 Inicio manual

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

### 5.3 URL de la aplicación

```
http://127.0.0.1:8000
```

Documentación interactiva de la API:

```
http://127.0.0.1:8000/docs
```

### 5.4 Cómo detener el sistema

- Presione **Ctrl+C** en la ventana donde corre `start.ps1`; el `finally` del
  script cierra Uvicorn y libera el puerto serial.
- Si quedó un proceso en segundo plano:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess }
```

No es necesario desconectar el Arduino antes de cerrar la aplicación, pero el
condensador **no se descarga** por cerrar el software ni por desconectar USB.

---

## 6. Uso de la interfaz

### Laboratorio en vivo

- Seleccione el puerto COM y pulse **Conectar USB**.
- Sin hardware, pulse **Modo Test** para generar datos sintéticos.
- La conexión solo se declara activa tras recibir y validar una trama `R1`.
- Visualiza voltaje del tanque, voltaje techo, estado, PWM, LEDs, frecuencia de
  muestreo y calidad de la señal.
- La escena 3D y la gráfica en vivo son protagonistas (aprox. 60–65 % / 35–40 %).

### Análisis científico

- Detecta segmentos de carga y descarga con histéresis y confirmación.
- Ajusta `V(t) = Vf + (V0 - Vf)·exp(-t/τ)` por mínimos cuadrados no lineales.
- Muestra τ experimental, τ teórica, error relativo, RMSE, R², residuos,
  número de muestras e incertidumbre.
- Rechaza curvas sin variación suficiente o con datos insuficientes en lugar de
  inventar un resultado.

### Simulación

- Simulador RC ideal independiente del hardware.
- Permite variar R, C, V0, Vf, duración y número de puntos.
- Etiqueta permanente **SIMULACION**; nunca se mezcla con sesiones reales.

### Conoce el laboratorio

- Fundamento físico, ecuaciones, procedimiento, interpretación de τ,
  incertidumbres, preguntas frecuentes y limitaciones.
- Las pausas didácticas congelan únicamente la gráfica; la adquisición y el
  almacenamiento continúan.

### Sesiones

- Iniciar, anotar y detener.
- Historial con origen (`SERIAL` / `SIMULACION`), protocolo, puerto y duración.
- Exportación CSV y JSON por sesión.
- Guardado automático y checkpoints periódicos.

---

## 7. Firmware y hardware

Archivo principal: `sketch_oct5a.ino` (el original está en
`firmware/legacy/sketch_oct5a_original.ino`).

| Pin | Función |
|-----|---------|
| `A0` | Medición del tanque a través de divisor 1 MΩ / 470 kΩ |
| `A1` | Potenciómetro de voltaje techo (0–5 V) |
| `D2` | LED rojo: 30 % del voltaje techo |
| `D3` | LED amarillo 1: 60 % |
| `D4` | LED amarillo 2: 90 % |
| `D7` | Pulsador de descarga (`INPUT_PULLUP`, activo en LOW) |
| `D9` | PWM del MOSFET IRLZ44N |

Características del firmware:

- `millis()` en lugar de `delay()` para el lazo principal.
- Antirrebote del pulsador por software.
- Rampa PWM **255 → 0** no bloqueante en pasos de 5 cada 15 ms.
- LEDs con umbrales relativos al voltaje techo, no valores fijos.
- Histéresis y confirmación de 3 lecturas para el estado `C` / `D` / `S`.
- Telemetría cada 100 ms durante la adquisición y la descarga.

### Seguridad del divisor

El firmware aplica una ganancia de `(1 M + 470 k) / 470 k = 3,12766`. La entrada
`A0` nunca debe superar 5 V; con este divisor, el máximo seguro es:

```
V_tanque_max = 5 V × 3,12766 ≈ 15,64 V
```

El valor nominal de 25 V de los condensadores **no autoriza** aplicar 25 V.
Verifique el acondicionamiento de señal antes de energizar el montaje.

---

## 8. Protocolo serial R1

### 8.1 Trama

```
R1,<millis>,<voltaje_tanque>,<voltaje_techo>,<estado>,<pwm>,<adc_A0>,<adc_A1>\r\n
```

Ejemplo:

```
R1,12345,2.135,4.200,C,0,437,860
```

| Campo | Unidad | Descripción |
|-------|--------|-------------|
| `R1` | — | Versión del protocolo |
| `millis` | ms | Tiempo del dispositivo (`millis()`, uint32) |
| `voltaje_tanque` | V | Voltaje reconstruido del banco |
| `voltaje_techo` | V | Referencia del potenciómetro |
| `estado` | — | `C` carga, `D` descarga, `S` estable |
| `pwm` | 0–255 | PWM aplicado al MOSFET |
| `adc_A0` | 0–1023 | Lectura cruda del tanque |
| `adc_A1` | 0–1023 | Lectura cruda del potenciómetro |

### 8.2 Compatibilidad heredada

El parser acepta además:

```
<voltaje_tanque>,<voltaje_techo>
Min:0.0,Max:5.0,Límite_Pot:2.50,Curva_Objetivo:2.30,Voltaje_Real:2.10
```

En esos formatos el estado se infiere de la pendiente y se marca como
inferencia. El protocolo `R1` nunca inventa el estado: lo recibe del firmware.

### 8.3 Tiempo y ancho de banda

- 10 Hz, 9600 baudios, 8N1.
- Una trama típica ocupa menos de 55 bytes → ~550 B/s de ~960 B/s disponibles.
- `millis()` se desenvuelve en Python y JavaScript, incluyendo desbordamiento
  uint32 y detección de reinicio del dispositivo.

---

## 9. Matemática y tratamiento de datos

### 9.1 Modelos

Carga:

```
V_C(t) = V_f + (V_0 - V_f)·exp(-t/τ)
```

Descarga:

```
V_C(t) = V_f + (V_0 - V_f)·exp(-t/τ)
```

Constante de tiempo:

```
τ = R · C
```

Puntos característicos:

- Carga: **63,212 %** de la variación total.
- Descarga: **36,788 %** restante.

### 9.2 Ajuste

- `scipy.optimize.curve_fit` con `V0`, `Vf` y `τ` acotados.
- RMSE, R², residuos y matriz de covarianza.
- Incertidumbre de τ a partir de la covarianza.
- Propagación de tolerancias de R y C cuando se declaran; si faltan, el valor
  queda en `None` en lugar de inventarse.
- Interpolación del cruce de umbral entre muestras (no se redondea al instante
  de muestreo).

### 9.3 Estimación en vivo

`TauTracker` (frontend) estima τ mientras llegan las muestras:

- En carga usa el voltaje techo medido como referencia.
- En descarga usa la hipótesis de 0 V, marcada como **provisional**.
- Al estabilizarse la señal, recalcula el cruce con el `Vf` medido de la cola y
  confirma el evento.

### 9.4 Limitaciones del modelo

- El lazo PWM puede alterar la respuesta respecto a un RC pasivo ideal.
- La resistencia efectiva y la topología de descarga no están verificadas.
- La referencia de 5 V es una hipótesis del firmware, no una calibración.
- La resolución del ADC (10 bits) no es exactitud.

---

## 10. Sesiones y trazabilidad

- ID único: `RC_SES_<AAAAMMDD>_<HHMMSS>_<6 hex>`.
- JSON con metadatos, muestras, eventos y anotaciones.
- CSV con una fila por muestra y columnas de trazabilidad: `session_id`,
  `origen`, `protocolo`, `puerto`, `tiempo_relativo_s`, voltajes, estado, PWM,
  ADC, LEDs y magnitudes derivadas.
- Escritura atómica (archivo temporal + reemplazo) y checkpoints cada 15 s o
  500 muestras.
- Separación estricta `SERIAL` / `SIMULACION`.
- Los archivos históricos incompatibles se marcan como
  `LEGACY_NO_VERIFICADO` y **no se modifican**.

Los datos se guardan en `data_sessions/`. **No borre esa carpeta**: contiene las
sesiones históricas del proyecto.

---

## 11. API principal

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/` | Interfaz web |
| GET | `/api/ports` | Puertos seriales disponibles |
| POST | `/api/connect` | Conectar a un puerto |
| POST | `/api/disconnect` | Desconectar |
| POST | `/api/synthetic/start` | Iniciar emulador |
| POST | `/api/synthetic/stop` | Detener emulador |
| GET | `/api/status` | Estado serial, sesión y protocolo |
| GET/PUT | `/api/config` | Parámetros eléctricos y τ teórica |
| POST | `/api/session/start` | Iniciar sesión |
| POST | `/api/session/stop` | Detener y guardar sesión |
| POST | `/api/session/annotate` | Añadir anotación |
| GET | `/api/sessions` | Historial |
| GET | `/api/sessions/{id}` | Detalle de una sesión |
| GET | `/api/sessions/{id}/export/{csv\|json}` | Exportar sesión |
| GET | `/api/session/export/{csv\|json}` | Exportar sesión activa |
| POST | `/api/math/analyze` | Analizar muestras |
| POST | `/api/math/fit` | Ajuste exponencial |
| POST | `/api/math/simulate` | Simulación RC |
| GET | `/api/diagnostics` | Diagnóstico del sistema y firmware |
| WS | `/ws/live` | Telemetría en vivo y estado |

---

## 12. Pruebas

### Backend

```powershell
$env:PYTHONDONTWRITEBYTECODE = "1"
.\.venv\Scripts\python.exe -m pytest -p no:cacheprovider -q
```

Resultado verificado en este equipo: **104 pruebas aprobadas**.

Cubren parser, modelos, protocolo, motor matemático, segmentos,
interpolación, ajuste, incertidumbre, simulador, sesiones, exportación,
concurrencia serial, endpoints REST, WebSocket y diagnóstico.

### Frontend

```powershell
node --test "tests/frontend/*.test.js"
```

Resultado verificado: **17 pruebas aprobadas**.

Cubren constantes, modelos RC, energía, `millis()`, interpolación de cruces,
asíntota, `TauTracker` de carga/descarga, señales estables y reinicios.

### Lo que las pruebas NO demuestran

- No se ejecutó el firmware en un Arduino real.
- No se validó la topología eléctrica ni la resistencia efectiva.
- No se calibró la referencia de 5 V ni el divisor.
- Las pruebas con emulador no sustituyen una medida física.

---

## 13. Limitaciones y validación pendiente

| Elemento | Estado |
|----------|--------|
| Compilación del firmware | **Pendiente**: no hay `arduino-cli` en el equipo |
| Carga en Arduino Uno | **Pendiente**: no hay hardware conectado |
| Lectura real de A0/A1 | **Pendiente** de verificación física |
| Resistencia de carga | **No medida**; valor nominal 4,7 kΩ sin tolerancia declarada |
| Resistencia de descarga | **No medida**; `None` por defecto |
| Capacitancia | Nominal 4 × 1000 µF = 0,004 F, sin calibración |
| Topología de descarga | **Pendiente**; la escena 3D es un esquema conceptual |
| Referencia ADC | Hipótesis 5,0 V |
| Incertidumbres de R y C | Desconocidas hasta medirlas |

Para compilar y cargar el firmware (cuando haya `arduino-cli`):

```powershell
arduino-cli core install arduino:avr
arduino-cli compile --fqbn arduino:avr:uno .
arduino-cli upload -p COM3 --fqbn arduino:avr:uno .
```

Sustituya `COM3` por el puerto real. El firmware usa el puerto serie a 9600
baudios; no abra el Monitor Serie de Arduino IDE al mismo tiempo que la
aplicación.

---

## 14. Seguridad eléctrica

- El software es de **solo lectura** sobre el hardware: no envía comandos de
  control al Arduino.
- No conecte el montaje a 25 V solo porque los condensadores lo soporten.
- Verifique que `A0` nunca reciba más de 5 V (máximo del divisor: ~15,64 V).
- Desconectar USB **no descarga** el condensador.
- Descargue el banco con una resistencia adecuada antes de manipularlo.
- La topología mostrada en 3D es conceptual y no sustituye un esquema
  eléctrico verificado.

---

## 15. Solución de problemas

| Problema | Solución |
|----------|----------|
| `start.ps1` bloqueado | `powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1` |
| Puerto 8000 ocupado | Detener el proceso con `Get-NetTCPConnection -LocalPort 8000` |
| No aparecen puertos COM | Revisar cable USB y controladores CH340/Arduino |
| Conecta pero no hay datos | Esperar la primera trama; el Arduino reinicia al abrir el puerto |
| Datos obsoletos | Revisar cable, baudios y que otro programa no use el puerto |
| Gráficas vacías | Conectar el Arduino o activar **Modo Test** |
| Error al exportar | Verificar que la sesión exista y que `data_sessions/` sea escribible |
| La interfaz no carga | Confirmar que Uvicorn escucha en `http://127.0.0.1:8000` |

---

## 16. Respaldo y control de versiones

- Respaldo externo del proyecto original:
  `C:\Users\USER\OneDrive - UNIVERSIDAD DE SANTANDER - UDES\Documentos\Arduino\RC_LAB_3D_backup_20261102_122443`
- Firmware original: `firmware/legacy/sketch_oct5a_original.ino`.
- Repositorio Git local en la carpeta del proyecto (rama `main`).
- Los archivos de sesión históricos se conservan; los nuevos formatos no
  sobrescriben los antiguos.

---

## 17. Estado de la entrega

| Componente | Estado |
|------------|--------|
| Firmware R1 | Implementado; compilación física pendiente |
| Backend FastAPI | Implementado y probado |
| Parser y protocolo | Implementado y probado |
| Motor matemático | Implementado y verificado con datos sintéticos |
| Frontend 3D y gráficas | Implementado; sintaxis validada y recursos servidos correctamente |
| Sesiones y exportación | Implementado y probado |
| Pruebas backend | 104/104 aprobadas |
| Pruebas frontend | 17/17 aprobadas |
| Validación con hardware | **Pendiente y declarada** |
