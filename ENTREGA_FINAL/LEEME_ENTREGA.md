# Entrega RC LAB 3D

Fecha de preparación: 18 de noviembre de 2026.

## Archivos incluidos

| Archivo | Contenido |
|---|---|
| `ENTREGA_RC_LAB_3D.zip` | Código fuente, firmware, frontend, pruebas, README, `requirements.txt`, `render.yaml` y scripts de arranque. |
| `MANUAL_PROFESOR_RC_LAB_3D.pdf` | Manual visual de 6 páginas. |
| `MANUAL_PROFESOR_RC_LAB_3D.md` | Copia editable del manual. |

## Estado verificado

- Directorio: `sketch_oct5a` · rama `main`.
- Dashboard: `GET /` responde 200 y los recursos locales cargan.
- Salud: `GET /health` responde `{"status":"ok"}`.
- WebSocket `/ws/live`: recibe `STATUS_INIT` y `SAMPLE`.
- Modo prueba: el emulador inicia, emite muestras `SIMULACION`, permite iniciar
  sesión y el análisis devuelve un resultado válido.
- Pruebas backend: **107 aprobadas**.
- Pruebas frontend: **58 aprobadas**.
- ZIP: CRC verificado con `testzip`; se extrajo y el servidor arrancó desde el
  contenido extraído con `/health` en estado `ok`.
- PDF: 6 páginas verificadas visualmente.

## URL pública

**No hay una URL pública verificada todavía.** El equipo no tiene repositorio
remoto de GitHub ni credenciales de Render configuradas; por eso no se creó ni
se afirmó ningún despliegue.

`render.yaml` ya está preparado con:

- arranque en `0.0.0.0` usando la variable `PORT`;
- health check en `/health`;
- Python 3.12.8;
- plan Free.

Paso manual indispensable: crear el repositorio en GitHub, subir la rama `main`
y conectar ese repositorio en Render como **Blueprint**. Render leerá
`render.yaml`. Después se debe comprobar
`https://<servicio>.onrender.com/health`.

## Nota sobre el ZIP

El ZIP no incluye `.venv`, `.git`, cachés, registros, secretos ni las sesiones
históricas de `data_sessions/`. La carpeta `data_sessions/` se incluye vacía y
la aplicación la utiliza para guardar sesiones nuevas.
