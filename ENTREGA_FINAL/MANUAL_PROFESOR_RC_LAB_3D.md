# Manual del profesor — RC LAB 3D

**Versión 3.0.0 · Noviembre de 2026**

> Guía breve para abrir, recorrer y comprobar el laboratorio. Todas las etiquetas
> corresponden a botones, pestañas y paneles que existen en la interfaz.
> Los valores de R = 4,7 kΩ y C = 0,004 F son **nominales o ilustrativos**, no
> mediciones certificadas.

---

## 1. Cómo abrir el enlace público

1. Abra un navegador actualizado (Edge, Chrome o Firefox).
2. Escriba la URL pública del servicio. Tiene la forma:

   `https://<nombre-del-servicio>.onrender.com`

   > **URL de esta entrega:** ______________________________________________
   >
   > Se comunica junto con el paquete. Si aún no está activa, use la ejecución
   > local de la sección 9.

3. La primera visita puede tardar **30–60 segundos** en el plan Free de Render
   (el servicio se suspende por inactividad). Si aparece un error de carga,
   espere y recargue una vez.
4. Compruebe que la barra superior muestra **RC LAB 3D** y que el indicador de
   conexión está en **Desconectado** o **Simulación**.
5. Para una comprobación técnica rápida, abra `/health`. Debe responder con
   `"status":"ok"`.

No hace falta instalar nada para usar el **Modo prueba**. No se necesitan
credenciales, claves ni archivos `.env`.

---

## 2. Recorrido del Dashboard

La barra superior contiene el selector de puerto, el botón de actualizar,
**Conectar Arduino**, **Desconectar**, **Modo prueba** y el indicador de estado.

Debajo hay seis pestañas:

| Pestaña | Para qué sirve |
|---|---|
| **Conoce el laboratorio** | Portada explicativa. Los botones **1 · CONFIGURAR CIRCUITO** y **2 · ENTRAR AL LABORATORIO** llevan al paso siguiente. |
| **Configurar circuito** | Declara resistencias, condensadores, alimentación y, si existen, valores medidos. |
| **Laboratorio en vivo** | Escena 3D, gráfica q(t), controles de instante y panel **Comprueba el cálculo**. |
| **Simulación** | Modelo RC ideal con datos sintéticos, independiente del Arduino. |
| **Análisis científico** | Ajuste exponencial, τ experimental, error, RMSE, R² y residuos. |
| **Sesiones** | Historial guardado, origen, muestras, duración y exportación CSV/JSON. |

**Ruta recomendada para una clase**

1. **Configurar circuito** → revise los equivalentes → **Guardar y entrar al laboratorio →**.
2. **Laboratorio en vivo** → pulse **Modo prueba**.
3. Elija un instante y lea la carga en la gráfica y en los cuatro condensadores.
4. Abra **Comprueba el cálculo** y copie los ocho pasos.
5. Use **Simulación** para repetir con otros valores.
6. Use **Análisis científico** o **Sesiones** para comparar y exportar.

> La escena 3D es un esquema conceptual. No sustituye un esquema eléctrico
> verificado ni una medición con instrumentos.

---

## 3. Modo Prueba sin Arduino

### 3.1 Emulador rápido

1. Entre a **Laboratorio en vivo**.
2. En la barra superior, pulse **Modo prueba**.
3. El indicador cambia a **Simulación** y aparece la etiqueta **SIMULACIÓN**.
4. En unos segundos se mueven la escena, la gráfica q(t) y los contadores.
5. Para guardar la demostración como sesión, pulse **Iniciar sesión** y, al
   terminar, **Detener y guardar**.
6. Para apagar el emulador, pulse **Detener prueba** o **Salir de simulación**.

### 3.2 Demostración guiada

1. En **Laboratorio en vivo**, despliegue
   **Demostración guiada con datos sintéticos (opcional)**.
2. Elija **Escenario**: *Completo: carga + descarga*, *Solo carga* o
   *Solo descarga*.
3. Elija **Voltaje techo**: 3,0 V, 4,0 V o 5,0 V.
4. Pulse **Iniciar demostración**. La demostración crea y guarda su propia
   sesión sintética.
5. **Pausar presentación** y **Continuar** solo detienen la presentación
   visual: la adquisición y el almacenamiento continúan.
6. **Reiniciar demostración** vuelve a empezar.

> Todo lo generado en Modo prueba es **SIMULACIÓN — DATOS SINTÉTICOS**. No es
> una medición del Arduino y no debe presentarse como resultado experimental.

---

## 4. Cómo seleccionar y entender los datos

### En Laboratorio en vivo

- Arrastre el control de tiempo o escriba un valor en el campo numérico para
  elegir un instante.
- **Ahora** vuelve al último dato recibido.
- **Pausar vista** congela la gráfica; la adquisición sigue.
- **Limpiar** vacía la vista, no la sesión guardada.
- En la gráfica q(t), el HUD muestra **Tiempo**, **Tau** y **Qmax**.
- En la lista de comprobación aparecen **V medido**, **q = C · Vc**,
  **q teórica**, **Diferencia**, **t estimado** y **t para q**.

### En Análisis científico

1. Elija el intervalo en **Inicio** y **Final** (segundos), o déjelos vacíos
   para usar todo el registro.
2. Pulse **Analizar datos actuales**.
3. Para una sesión guardada, vaya a **Sesiones**, busque la fila y pulse
   **Analizar**; también puede usar **Analizar sesión guardada**.
4. Lea las tarjetas: **Tau de carga teórico**, **Tau de descarga teórico**,
   **Tau experimental**, **Error relativo**, **RMSE**, **R²**, **Muestras
   usadas** y **Fuente temporal**.

### En Sesiones

- Cada fila muestra el identificador, la fecha, el archivo, el **Origen**
  (`SERIAL` o `SIMULACION`), las muestras y la duración.
- **CSV** y **JSON** descargan los datos.
- Las sesiones con formato antiguo se marcan como **LEGACY** y no se modifican.

---

## 5. Qué significan R, C, Ve, τ, Qmax, q(t) y t

| Símbolo | Nombre en la interfaz | Significado | Unidad |
|---|---|---|---|
| **R** | Resistencia de carga / de descarga | Oposición al paso de corriente en el proceso. La resistencia de carga y la de descarga pueden ser distintas. | Ω |
| **C** | Capacitancia equivalente, C<sub>eq</sub> | Capacidad de almacenar carga del conjunto de condensadores. En el banco documentado: 4 × 1000 µF en paralelo = 0,004 F. | F |
| **Ve** | Voltaje de referencia / voltaje techo | Voltaje de alimentación o techo usado como referencia del proceso. | V |
| **τ** | Tau / constante de tiempo | Tiempo característico: τ = R<sub>eq</sub> · C<sub>eq</sub>. En carga se alcanza el **63,2 %** de la variación; en descarga queda el **36,8 %**. | s |
| **Qmax** | Carga máxima | Carga almacenada cuando el condensador llega al voltaje de referencia: Qmax = C<sub>eq</sub> · Ve. | C |
| **q(t)** | Carga eléctrica almacenada | Carga presente en el instante t: q(t) = C<sub>eq</sub> · V<sub>C</sub>(t). | C |
| **t** | Tiempo | Tiempo transcurrido desde el inicio del proceso de carga o descarga. | s |

**Fórmulas que usa el laboratorio**

- Carga: `q(t) = Qmax · (1 − e^(−t/τ))`
- Descarga: `q(t) = Q₀ · e^(−t/τ)`, con `Q₀ = C_eq · V₀`
- Constante de tiempo: `τ = R_eq · C_eq`
- Carga máxima: `Qmax = C_eq · Ve`
- Cinco constantes de tiempo (≈ 99,3 %) es una carga prácticamente completa;
  1τ **no** significa carga completa.

---

## 6. Copiar los datos y resolver el cálculo a mano

En **Laboratorio en vivo** (o en **Simulación**) abra el panel
**Comprueba el cálculo**. Contiene ocho pasos numerados:

1. **Datos del circuito y sus unidades** — copie V<sub>e</sub>, t,
   R<sub>carga</sub>, R<sub>descarga</sub>, C<sub>eq</sub> y los componentes
   declarados.
2. **Cálculo de C<sub>eq</sub>** — copie la fórmula serie/paralelo y el valor.
3. **Cálculo de R<sub>eq</sub>** — copie la resistencia del proceso.
4. **Constante de tiempo: τ = R<sub>eq</sub> · C<sub>eq</sub>** — copie la
   multiplicación.
5. **Carga máxima: Qmax = C<sub>eq</sub> · V<sub>e</sub>** — copie el resultado
   en C y mC.
6. **Ecuación de carga o descarga** — copie la ecuación que muestra el panel.
7. **Sustitución numérica completa** — copie la línea con los números.
8. **Resultado final en culombios y milicoulombios** — copie el resultado en C
   y en mC.

### Ejemplo ilustrativo (no es una medición)

Datos de ejemplo: **R = 4700 Ω**, **C = 0,004 F**, **Ve = 4,0 V**,
**t = 18,8 s**, proceso de carga.

| Paso | Operación | Resultado |
|---|---|---|
| 1 | Datos | R = 4700 Ω · C = 0,004 F · Ve = 4,0 V · t = 18,8 s |
| 2 | C<sub>eq</sub> | 4 × 1000 µF = 4000 µF = **0,004 F** |
| 3 | R<sub>eq</sub> | **4700 Ω** |
| 4 | τ = R<sub>eq</sub> · C<sub>eq</sub> | 4700 × 0,004 = **18,8 s** |
| 5 | Qmax = C<sub>eq</sub> · Ve | 0,004 × 4,0 = 0,016 C = **16 mC** |
| 6 | Ecuación de carga | q(t) = Qmax · (1 − e^(−t/τ)) |
| 7 | Sustitución | q(18,8) = 0,016 × (1 − e^(−18,8/18,8)) |
| 8 | Resultado | 0,016 × (1 − 0,367879) = 0,0101139 C = **10,11 mC** |

Comprobación: 18,8 s es exactamente 1τ, por eso el resultado es el 63,2 % de
16 mC. `16 × 0,632 = 10,11 mC`. El valor es ilustrativo porque R, C y Ve son
nominales.

---

## 7. Comparar el resultado manual con el del laboratorio

En **Comprueba el cálculo**, la franja inferior muestra tres columnas:

| Columna | Qué contiene |
|---|---|
| **Teórico a mano** | El resultado de la ecuación con los parámetros configurados. Debe coincidir con su cálculo manual. |
| **Experimental** | `q_exp = C_eq · Vc` usando la muestra válida más cercana al instante elegido. |
| **Diferencia** | `Experimental − Teórico`, con signo. |

1. Copie los datos del paso 1 y resuelva a mano.
2. Compare su resultado con **Teórico a mano**. Si no coincide, revise
   unidades: F (no µF), Ω, V y s.
3. Si está en **Modo prueba**, **Experimental** aparece como
   **— (sintético)**: no hay medición física que comparar.
4. Con Arduino conectado, **Experimental** usa la muestra real más cercana.
   Una diferencia pequeña es normal por tolerancias, resolución del ADC y
   ruido.
5. Para una comparación científica use **Análisis científico**:
   - **Tau experimental** se obtiene ajustando la curva medida.
   - **Error relativo** = `|τ_exp − τ_teo| / τ_teo`.
   - **RMSE** indica el error del ajuste; **R²** indica la calidad del modelo
     (más cerca de 1 es mejor).
   - **Muestras usadas** indica cuántos puntos entraron en el ajuste.

> El programa no inventa una comparación si faltan datos. Si ve
> **Dato pendiente de configurar**, complete la configuración o el intervalo.

---

## 8. Teórico, simulado y medición física

| Tipo | Dónde aparece | Qué es | Qué demuestra |
|---|---|---|---|
| **Teórico** | **Comprueba el cálculo** · **Teórico a mano**; tarjetas de τ teórica | Resultado de las fórmulas con R, C y Ve declarados. | Que la aritmética y el modelo son correctos. No demuestra que el montaje real se comporte así. |
| **Simulado** | **Modo prueba**, **Simulación**, **Demostración guiada** | Datos generados por el modelo, etiquetados **SIMULACIÓN — DATOS SINTÉTICOS**. | Que el software y la visualización funcionan sin hardware. No es una medición. |
| **Medición física** | Sesión con origen **SERIAL**, Arduino conectado | Tensiones leídas por el ADC y enviadas por el firmware R1. | El comportamiento real del montaje, con incertidumbres y tolerancias. |

Aunque una sesión sea física, la referencia de 5 V del ADC es una hipótesis y
la resolución de 10 bits no es exactitud. La validación con instrumentos
independientes sigue siendo responsabilidad del montaje.

---

## 9. Ejecutar el proyecto localmente

Requisitos: Windows 10/11, Python 3.12 o superior y el código del ZIP. No hace
falta Arduino para el Modo prueba.

### Opción rápida

1. Descomprima el ZIP.
2. Haga doble clic en `start.bat` o ejecute en PowerShell:

   ```powershell
   .\start.ps1
   ```

3. Abra `http://127.0.0.1:8000`.
4. Para detener, pulse **Ctrl+C** en la ventana del servidor.

### Opción manual

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

- Aplicación: `http://127.0.0.1:8000`
- Documentación de la API: `http://127.0.0.1:8000/docs`
- Salud del servicio: `http://127.0.0.1:8000/health`

### Pruebas (opcional)

```powershell
$env:PYTHONDONTWRITEBYTECODE = "1"
.\.venv\Scripts\python.exe -m pytest -p no:cacheprovider -q
node --test "tests/frontend/*.test.js"
```

### Si algo no abre

| Problema | Solución |
|---|---|
| El enlace público tarda | Es el arranque en frío de Render Free; espere y recargue. |
| No aparecen puertos COM | Use **Modo prueba** o revise el cable y los controladores. |
| La página no carga en local | Confirme que Uvicorn escucha en el puerto 8000. |
| El puerto 8000 está ocupado | Cierre el proceso anterior o use otro puerto. |
| Las sesiones desaparecen en Render | El plan Free usa almacenamiento efímero; descargue CSV/JSON antes de reiniciar. |

---

## 10. Lista rápida para la clase

- [ ] Abrir la URL y esperar la carga.
- [ ] Recorrer las seis pestañas.
- [ ] Configurar circuito y revisar **Equivalentes calculados**.
- [ ] Entrar al laboratorio y activar **Modo prueba**.
- [ ] Elegir un instante y leer q(t).
- [ ] Abrir **Comprueba el cálculo** y copiar los ocho pasos.
- [ ] Resolver el ejemplo a mano y comparar con **Teórico a mano**.
- [ ] Distinguir **SIMULACIÓN** de **MEDICIÓN FÍSICA**.
- [ ] Guardar/exportar una sesión y explicar su origen.

---

*RC LAB 3D · Manual del profesor · Documento generado a partir de la interfaz y
del código del proyecto. Las funciones no verificadas con hardware físico se
presentan como pendientes, no como resultados.*
