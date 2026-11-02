# RC LAB 3D — Plataforma de Instrumentación y Control RC

Aplicación local para adquisición en tiempo real de un circuito RC experimental
con Arduino Uno mediante USB serial, dashboard científica con visualización 3D,
gráficas Plotly, simulador RC independiente y exportación de sesiones.

## 1. Auditoría inicial (resumen)

| Punto | Estado |
|-------|--------|
| Directorio de trabajo | `C:\Users\USER\OneDrive - UNIVERSIDAD DE SANTANDER - UDES\Documentos\Arduino\sketch_oct5a` |
| Firmware Arduino | `sketch_oct5a.ino` (pines confirmados: A1 sensor, A0 potenciómetro, D9 MOSFET, D7 botón, D2-D5 LEDs, 115200 baudios) |
| Protocolo serial | `Min:...,Max:...,Límite_Pot:...,Curva_Objetivo:...,Voltaje_Real:...` (parser implementado y probado) |
| Aplicación web | Creada en este repositorio (FastAPI backend + frontend HTML/JS con Three.js y Plotly.js locales) |
| Dependencias Python | `fastapi`, `uvicorn`, `pyserial`, `websockets`, `numpy`, `scipy`, `pytest`, `httpx` |
| Sistema operativo | Windows 11, Python 3.14.5 |
| Pruebas automatizadas | 29 pruebas aprobadas (parser, motor matemático, serial, sesiones, backend) |
| Arduino físico | No conectado durante esta implementación; pruebas con datos sintéticos aprobadas |

## 2. Estructura del proyecto

```
sketch_oct5a/
├── sketch_oct5a.ino              # Firmware Arduino (conservado sin cambios)
├── start.ps1                     # Script de arranque en PowerShell
├── README.md                     # Esta documentación
├── backend/
│   ├── __init__.py
│   ├── app.py                    # Servidor FastAPI, API REST y WebSocket
│   ├── models.py                 # Modelos de datos (TelemetrySample, SessionMetadata, CircuitParameters)
│   ├── parser.py                 # Parser serial del protocolo Arduino
│   ├── serial_manager.py         # Gestor de puerto COM + emulador sintético
│   ├── session_manager.py        # Sesiones, anotaciones, exportación CSV/JSON
│   └── math_engine.py            # Modelos RC, ajuste exponencial, tau, incertidumbre
├── frontend/
│   ├── index.html                # Interfaz única (laboratorio, 3D, gráficas, análisis, simulador, sesiones, guía)
│   ├── css/styles.css            # Estiloscientífico oscuro ( azul noche / cian / ámbar / violeta )
│   └── js/
│       ├── app.js                # Controlador principal, WebSocket, UI
│       ├── charts.js             # Gráficas Plotly (A, B, C, D + principal en vivo)
│       ├── circuit3d.js          # Gemelo tridimensional con Three.js
│       ├── simulator.js          # Simulador RC independiente
│       ├── analysis.js           # Ajuste exponencial y tabla de resultados
│       └── vendor/
│           ├── three.min.js
│           ├── OrbitControls.js
│           └── plotly.min.js     # Dependencias 3D y gráficas (funcionan sin internet)
└── tests/
    ├── test_parser.py            # Parser serial (6 pruebas)
    ├── test_math_engine.py       # Motor matemático RC (9 pruebas)
    ├── test_serial_manager.py    # Puerto COM y modo sintético (3 pruebas)
    ├── test_session_manager.py   # Gestión de sesiones y exportación (1 prueba)
    └── test_backend.py           # Endpoints FastAPI (7 pruebas)
```

## 3. Requisitos

- Windows 10 o 11
- Python 3.9+ (probado con Python 3.14.5)
- Arduino Uno con el firmware `sketch_oct5a.ino` cargado
- Cable USB Arduino → PC

Dependencias Python (instaladas automáticamente por `start.ps1`):
- `fastapi`, `uvicorn`, `pyserial`, `websockets`
- `numpy`, `scipy` (motor matemático)
- `pytest`, `httpx` (pruebas)

Los archivos `three.min.js`, `OrbitControls.js` y `plotly.min.js` ya están incluidos
en `frontend/js/vendor/` para funcionar sin conexión a internet.

## 4. Ejecución en Windows (PowerShell)

### Paso 1: Abrir PowerShell en la carpeta del proyecto

```powershell
cd "C:\Users\USER\OneDrive - UNIVERSIDAD DE SANTANDER - UDES\Documentos\Arduino\sketch_oct5a"
```

### Paso 2: Ejecutar el script de inicio

```powershell
.\start.ps1
```

Si la directiva de ejecución de PowerShell bloquea el script, ejecute:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
.\start.ps1
```

### Paso 3: Abrir la aplicación

El script le indicará la URL local, por ejemplo:

```
http://127.0.0.1:8000
```

Ábrala en su navegador web (Edge, Chrome, Firefox).

### Paso 4: Conectar el Arduino

1. Conecte el Arduino Uno por USB.
2. En la barra superior de la aplicación, seleccione el puerto COM correspondiente (por ejemplo `COM3`).
3. Haga clic en **Conectar USB** (115200 baudios).
4. La conexión se declara válida solo tras recibir y analizar una línea correcta del firmware.

Si no tiene el Arduino conectado, use el botón **Modo Test** para validar la interfaz
con un emulador que reproduce exactamente el comportamiento del firmware `sketch_oct5a.ino`.

### Cómo detener el sistema

- Presione `Ctrl+C` en la ventana de PowerShell donde se ejecuta `start.ps1`, o
- Ejecute en otra consola de PowerShell:

```powershell
Stop-Process -Name python
```

Esto detendrá uvicorn y liberará el puerto serial.

## 5. Puerto COM y velocidad serial

- Velocidad: **115200 baudios** (configurada en el firmware y en la aplicación).
- La aplicación no presupone el nombre del puerto COM; se selecciona desde la interfaz.
- Al abrir el puerto, la aplicación espera el reinicio normal del Arduino y no declara
  conexión válida hasta recibir y analizar una línea correcta del protocolo.

## 6. Formato de datos (protocolo serial actual)

Una línea típica del Arduino:

```
Min:0.0,Max:5.0,Límite_Pot:2.50,Curva_Objetivo:2.30,Voltaje_Real:2.10
```

Campos:

| Campo | Significado | Unidades |
|-------|-------------|----------|
| `Min` | Límite inferior del rango (firmware) | V |
| `Max` | Límite superior del rango (firmware) | V |
| `Límite_Pot` | Voltaje límite configurado por el potenciómetro A0 | V |
| `Curva_Objetivo` | Referencia artificial del controlador firmware | V |
| `Voltaje_Real` | Voltaje filtrado leído por A1 (señal principal del condensador) | V |

El parser acepta etiquetas con tildes (`Límite_Pot` / `Limite_Pot`), espacios adicionales,
orden arbitrario de claves, y rechaza líneas vacías, corruptas, NaN, infinito y campos ausentes.

Los campos **no transmitidos** por el protocolo actual (PWM, estado de carga/descarga,
tiempo del dispositivo, voltaje ADC sin filtrar) aparecen como **No disponible**.

## 7. Funcionamiento del hardware

### Botón físico (D7)
- Cambia el modo interno del firmware entre carga y descarga.
- No es un botón de control remoto de la web. La aplicación **no envía comandos** al Arduino.
- El protocolo actual no transmite `modoCarga`; la dashboard presenta una **estimación visual**
  del modo (CARGA / DESCARGA / ESTABLE) inferida de la pendiente de `Curva_Objetivo`,
  con su nivel de confianza, etiquetada como inferencia.

### Potenciómetro (A0)
- Determina el límite de voltaje objetivo durante la carga.
- Se muestra en la dashboard como **Límite Potenciómetro** en voltios.

### Voltaje real (A1)
- Señal filtrada del condensador (filtro exponencial α = 0.2 en el firmware).
- Es la señal principal de la dashboard; alimenta indicadores, gráficas y el modelo 3D.

### Controlador PWM y MOSFET (D9)
- Control incremental: `nivelPwm += error * 25.0`, limitado entre 0 y 255.
- La dashboard es de **solo lectura**; no se implementan controles web que alteren el PWM.

### LEDs físicos (D2-D5)
- Umbrales del firmware: 1 V, 2 V, 3 V, 4 V.
- Los LEDs virtuales en la dashboard siguen la lógica:
  - LED 1: V_real ≥ 1 V
  - LED 2: V_real ≥ 2 V
  - LED 3: V_real ≥ 3 V
  - LED 4: V_real ≥ 4 V
- Son una **reproducción lógica** de los umbrales, no una confirmación eléctrica de que los LEDs físicos estén iluminados.

## 8. Indicadores en tiempo real

La barra superior y las tarjetas de telemetría muestran:

- Voltaje real filtrado (V)
- Límite del potenciómetro (V)
- Curva objetivo (V)
- Error de seguimiento `e(t) = V_real - V_objetivo` (V)
- Porcentaje de escala de voltaje (voltaje / 5.0 V × 100) — **no es porcentaje de carga ni de energía**
- Estado lógico de los 4 LEDs virtuales
- Frecuencia de recepción estimada (Hz)
- Muestras válidas e inválidas
- Tiempo desde la última muestra válida
- Estado del origen de los datos (SERIAL_ARDUINO / SINTETICO_TEST)

## 9. Gráficas científicas (Plotly)

| Gráfica | Contenido |
|---------|-----------|
| A | Voltaje real filtrado vs curva objetivo (+ modelo teórico cuando está disponible) |
| B | Límite potenciómetro A0 y curva objetivo |
| C | Error de seguimiento `e(t) = V_real - V_obj` |
| D | Corriente estimada **ESTIMACIÓN** (sólo si topología y parámetros lo justifican; por defecto hip. R = 1 kΩ) |
| E | Comparación experimental vs teórica (intervalo seleccionable) |

Todas las gráficas tienen unidades, leyendas, zoom y lectura de coordenadas. Los datos
completos se conservan aunque la visualización reduzca puntos renderizados.

## 10. Simulador RC independiente

Funciona sin Arduino conectado. Permite variar R, C, voltaje inicial, voltaje de fuente,
tiempo de simulación, paso temporal y modo carga/descarga.

- Incluye etiqueta permanente **SIMULACIÓN**.
- Nunca contamina los datos de sesión real.
- Representa un circuito RC ideal; no pretende reproducir automáticamente el controlador PWM real.

## 11. Modelos matemáticos RC

- Carga ideal: `V_C(t) = V_s + (V_0 - V_s) * exp(-t / (R*C))`
- Descarga ideal: `V_C(t) = V_0 * exp(-t / (R*C))`
- Constante de tiempo: `tau = R * C` (segundos)

La capacitancia nominal es **C = 0.001 F** (1000 µF). La resistencia efectiva está
pendiente de confirmar física. Cada parámetro identifica su procedencia:
nominal, medido, declarado, calculado o pendiente de verificar.

Si falta una resistencia válida, no se presenta una constante de tiempo definitiva.

## 12. Ajuste exponencial y calidad de datos

Permite seleccionar intervalo temporal, detectar modo (carga/descarga/estable),
verificar suficiente variación de voltaje y rechazar intervalos incompatibles.

Resultado de ajuste válido muestra:
- Constante de tiempo experimental τ
- Incertidumbre de ajuste de τ
- Parámetros ajustados (V₀, V_s)
- RMSE y R²
- Residuos y número de muestras
- Advertencia si el lazo de control PWM altera la respuesta respecto a RC pasivo

## 13. Sesiones y exportación

- Iniciar, pausar, reanudar y detener sesiones.
- Añadir anotaciones y marcar eventos de carga/descarga.
- Exportar CSV y JSON.
- Cada sesión incluye: identificador, fecha y hora, configuración, origen de datos,
  parámetros conocidos/desconocidos, número de muestras, errores, anotaciones
  e intervalos de desconexión.
- Los datos se guardan en la carpeta `data_sessions/`.

## 14. Incertidumbre y errores

- Resolución nominal del ADC Arduino Uno: 10 bits (códigos 0-1023).
- Conversión actual presupone referencia de 5.0 V (hipótesis del firmware, no calibración certificada).
- Resolución ≠ exactitud.
- Incertidumbre por cuantización, tolerancia de resistencia y condensador, efectos del filtrado,
  variación del intervalo de muestreo y pérdida de muestras se documentan en el análisis.
- Error relativo entre τ experimental y teórica:
  `Error (%) = |τ_exp - τ_teo| / |τ_teo| × 100`

## 15. Seguridad eléctrica

- Primera versión de **solo lectura** respecto al hardware.
- No se implementan controles web que alteren el PWM ni activen el MOSFET.
- No se envían comandos seriales al Arduino sin protocolo de control diseñado y verificado.
- La interfaz no sugiere superar la tensión nominal del condensador (25 V).
- Desconectar el USB **no** descarga eléctricamente el condensador.
- La topología de conexiones no está verificada por esquema eléctrico; la escena 3D está
  etiquetada como **ESQUEMA CONCEPTUAL — TOPOLOGÍA PENDIENTE DE VERIFICACIÓN**.
- Antes de energizar el montaje físico, inspeccione el acondicionamiento de señal en A1
  para asegurar que la entrada analógica del Arduino no exceda 5 V.

## 16. Ejecución de pruebas

Desde la carpeta del proyecto, en PowerShell:

```powershell
python -m pytest tests/ -v
```

Resultado esperado: **29 pruebas aprobadas**.

Clasificación de las pruebas realizadas:

| Tipo | Pruebas | Resultado |
|------|---------|-----------|
| Automatizadas (parser, motor matemático, serial, sesiones, backend) | 29 | Aprobadas |
| Con datos sintéticos (modo test sin Arduino) | Incluidas en las 29 | Aprobadas |
| Con Arduino físico | Pendiente | No ejecutado (no hay hardware conectado) |

## 17. Parámetros pendientes de confirmar

| Parámetro | Estado | Observación |
|-----------|--------|-------------|
| Resistencia efectiva de carga | Pendiente | No inventada; se debe medir o declarar físicamente |
| Resistencia efectiva de descarga | Pendiente | Ruta de descarga no confirmada por esquema |
| Referencia de voltaje analógica (V_ref) | Hipótesis | 5.0 V según firmware, no calibración certificada |
| Topología de conexiones A1 → condensador | Pendiente | Verificar acondicionamiento de señal antes de energizar |
| Tensión de alimentación del montaje | Pendiente | No asumida |

## 18. Solución de problemas

| Problema | Posible causa / Solución |
|----------|--------------------------|
| La aplicación no arranca | Verificar que Python esté instalado y en el PATH. Ejecutar `.\start.ps1`. |
| Puerto COM no aparece | Verificar que el Arduino esté conectado y los controladores instalados (CH340 / Arduino Uno). |
| Error al conectar | Otro programa ocupando el puerto (PuTTY, Arduino IDE Serial Monitor). Cerrarlos y volver a intentar. |
| Datos no llegan tras conectar | Esperar a que aparezca una línea válida; el Arduino reinicia al abrir el puerto. |
| Página no carga | Verificar que uvicorn esté escuchando en `http://127.0.0.1:8000`. |
| Gráficas vacías | Iniciar adquisición (conectar o activar Modo Test) y esperar muestras. |

## 19. Guía para la exposición universitaria

Ver sección incluida en la propia aplicación (pestaña **Guía de Laboratorio**) que cubre:

1. Objetivo general y específicos
2. Fundamento físico (Q = C·V, I = dQ/dt, ecuación diferencial RC)
3. Ecuaciones de carga y descarga derivadas
4. Significado de la constante de tiempo τ = R·C
5. Materiales y montaje
6. Procedimiento experimental paso a paso
7. Adquisición serial (115200 baudios, parser, formato de datos)
8. Tratamiento de datos y ajuste exponencial
9. Comparación teoría-experimento
10. Incertidumbres y limitaciones
11. Conclusiones automáticas (solo con datos válidos)
12. Mejoras propuestas

Preguntas típicas del profesor y respuestas sugeridas están incluidas en la pestaña
**Guía de Laboratorio** de la aplicación.

## 20. Limitaciones y siguientes pasos

- No se ha probado con Arduino físico durante esta implementación (no hay hardware conectado).
- La resistencia efectiva y la topología exacta están pendientes de verificación física.
- No se implementa control remoto del PWM (solo lectura).
- Exportación a PDF de informes requiere dependencias adicionales no instaladas por defecto (HTML imprimible disponible).

Siguientes pasos concretos:
1. Conectar el Arduino Uno y validar la recepción de datos en vivo.
2. Medir la resistencia efectiva de carga/descarga y actualizar `CircuitParameters`.
3. Verificar el acondicionamiento de señal en A1 antes de energizar el montaje completo.
4. Realizar el ajuste experimental con datos reales y contrastar τ experimental vs teórico.
