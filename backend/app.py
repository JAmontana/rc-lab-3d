"""
Servidor FastAPI de RC LAB 3D.

- API REST para puertos, configuración, sesiones, análisis y simulación.
- WebSocket con cola acotada y timeout para clientes lentos.
- Operaciones seriales y de disco fuera del event loop.
- Lifespan de FastAPI y guardado automático al apagar o desconectar.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import sys
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from backend.math_engine import (
    ajustar_exponencial_rc,
    analisis_incertidumbre,
    analizar_sesion,
    calcular_tau_teorica,
    simular_circuito_rc,
)
from backend.models import (
    CircuitParameters,
    FIRMWARE_ACTUAL,
    PROTOCOLO_ACTUAL,
    SCHEMA_VERSION,
    SessionMetadata,
    TelemetrySample,
)
from backend.protocol import BAUDIOS, PROTOCOLO_LEGACY_2F, PROTOCOLO_LEGACY_V1
from backend.serial_manager import SerialManager
from backend.session_manager import SessionManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("rc_lab_3d")

APP_VERSION = "3.0.0"
FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
FIRMWARE_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "sketch_oct5a.ino"))


# ----------------------------------------------------------------------
# WebSocket hub con cola acotada
# ----------------------------------------------------------------------
class WebSocketHub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.queue: Optional[asyncio.Queue[str]] = None
        self.task: Optional[asyncio.Task[None]] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.dropped_messages = 0
        self.sent_messages = 0

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop
        self.queue = asyncio.Queue(maxsize=512)
        self.task = loop.create_task(self._broadcaster())

    async def stop(self) -> None:
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        for websocket in list(self.clients):
            try:
                await websocket.close()
            except Exception:
                pass
        self.clients.clear()

    def publish_threadsafe(self, payload: Dict[str, Any]) -> None:
        if self.loop is None or self.queue is None or not self.loop.is_running():
            return
        try:
            message = json.dumps(payload, ensure_ascii=False, default=str)
            self.loop.call_soon_threadsafe(self._enqueue, message)
        except Exception:
            logger.exception("No se pudo programar el mensaje WebSocket")

    def _enqueue(self, message: str) -> None:
        if self.queue is None:
            return
        if self.queue.full():
            try:
                self.queue.get_nowait()
                self.dropped_messages += 1
            except asyncio.QueueEmpty:
                pass
        try:
            self.queue.put_nowait(message)
        except asyncio.QueueFull:
            self.dropped_messages += 1

    async def _broadcaster(self) -> None:
        assert self.queue is not None
        while True:
            message = await self.queue.get()
            clients = list(self.clients)
            if not clients:
                continue

            async def send_one(websocket: WebSocket) -> None:
                try:
                    await asyncio.wait_for(websocket.send_text(message), timeout=1.0)
                    self.sent_messages += 1
                except Exception:
                    await self.disconnect(websocket)

            # Envío concurrente y acotado: un cliente lento no bloquea al resto.
            await asyncio.gather(*(send_one(websocket) for websocket in clients), return_exceptions=True)

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.clients.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        self.clients.discard(websocket)
        try:
            await websocket.close()
        except Exception:
            pass


# ----------------------------------------------------------------------
# Estado global
# ----------------------------------------------------------------------
session_mgr = SessionManager()
circuit_config = CircuitParameters()
ws_hub = WebSocketHub()


def handle_sample(sample: TelemetrySample) -> None:
    session_mgr.add_sample(sample)
    ws_hub.publish_threadsafe({"type": "SAMPLE", "data": sample.model_dump()})


def handle_connection_event(event: str, detail: str) -> None:
    if event == "disconnected":
        if session_mgr.is_recording:
            session_mgr.record_disconnection(detail)
            session_mgr.stop_session(reason="desconexion_serial")
        ws_hub.publish_threadsafe(
            {
                "type": "STATUS",
                "serial": serial_mgr.get_status(),
                "session": session_mgr.get_summary(),
            }
        )


serial_mgr = SerialManager(
    on_sample_callback=handle_sample,
    on_event_callback=handle_connection_event,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    ws_hub.start(loop)
    logger.info("RC LAB 3D iniciado en el puerto local de Uvicorn")
    yield
    logger.info("Cerrando RC LAB 3D...")
    try:
        if session_mgr.is_recording:
            session_mgr.stop_session(reason="apagado_del_servidor")
        serial_mgr.disconnect()
    finally:
        await ws_hub.stop()


app = FastAPI(
    title="RC LAB 3D — Laboratorio Universitario RC",
    version=APP_VERSION,
    description="Adquisición, control, análisis y visualización 3D de un circuito RC con Arduino.",
    lifespan=lifespan,
)


# ----------------------------------------------------------------------
# DTOs
# ----------------------------------------------------------------------
class ConnectRequest(BaseModel):
    port: str = Field(..., min_length=1)
    baudrate: int = Field(BAUDIOS, ge=1200, le=115200)


class AnnotationRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)
    categoria: str = Field("NOTA", max_length=40)


class SimulationRequest(BaseModel):
    modo: str = Field("CARGA", pattern="^(CARGA|DESCARGA|carga|descarga)$")
    r_ohm: float = Field(4700.0, gt=0, le=1e9)
    c_farad: float = Field(0.004, gt=0, le=10)
    v_inicial: float = Field(0.0, ge=-100, le=100)
    v_final: float = Field(5.0, ge=-100, le=100)
    t_final: float = Field(60.0, gt=0, le=100000)
    num_puntos: int = Field(600, ge=10, le=5000)


class FitRequest(BaseModel):
    tiempos: List[float]
    voltajes: List[float]
    modo: Optional[str] = None
    v0: Optional[float] = None
    vf: Optional[float] = None
    r_ohm_teorica: Optional[float] = Field(4700.0, gt=0)
    c_farad_teorica: Optional[float] = Field(0.004, gt=0)


class AnalysisRequest(BaseModel):
    session_id: Optional[str] = None
    samples: Optional[List[TelemetrySample]] = None
    start_s: Optional[float] = Field(None, ge=0)
    end_s: Optional[float] = Field(None, ge=0)
    parametros: Optional[CircuitParameters] = None


class CircuitConfigUpdate(BaseModel):
    capacitancia_f: Optional[float] = Field(None, gt=0, le=10)
    capacitancia_origen: Optional[str] = None
    resistencia_carga_ohm: Optional[float] = Field(None, gt=0, le=1e9)
    resistencia_descarga_ohm: Optional[float] = Field(None, gt=0, le=1e9)
    resistencia_origen: Optional[str] = None
    voltaje_maximo_referencia_v: Optional[float] = Field(None, gt=0, le=100)
    divisor_r1_ohm: Optional[float] = Field(None, gt=0)
    divisor_r2_ohm: Optional[float] = Field(None, gt=0)
    adc_bits: Optional[int] = Field(None, ge=8, le=24)
    vref_v: Optional[float] = Field(None, gt=0, le=20)
    tolerancia_r_pct: Optional[float] = Field(None, ge=0, le=100)
    tolerancia_c_pct: Optional[float] = Field(None, ge=0, le=100)
    tolerancia_vref_pct: Optional[float] = Field(None, ge=0, le=100)


# ----------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------
def _status_payload() -> Dict[str, Any]:
    return {
        "serial": serial_mgr.get_status(),
        "session": session_mgr.get_summary(),
        "config": circuit_config.model_dump(),
        "protocol": {
            "actual": PROTOCOLO_ACTUAL,
            "heredados": [PROTOCOLO_LEGACY_2F, PROTOCOLO_LEGACY_V1],
            "firmware": FIRMWARE_ACTUAL,
            "baudrate": BAUDIOS,
        },
        "server_time": time.time(),
        "version": APP_VERSION,
    }


def _publish_status() -> None:
    ws_hub.publish_threadsafe({"type": "STATUS", **_status_payload()})


def _firmware_diagnostics() -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "path": FIRMWARE_PATH,
        "present": os.path.isfile(FIRMWARE_PATH),
        "protocol_r1": False,
        "serial_begin": False,
        "baud_9600": False,
        "size_bytes": None,
        "modified": None,
    }
    if not os.path.isfile(FIRMWARE_PATH):
        return result
    try:
        with open(FIRMWARE_PATH, "r", encoding="utf-8", errors="replace") as handle:
            content = handle.read()
        result.update(
            {
                "protocol_r1": "R1," in content and "Serial.print" in content,
                "serial_begin": "Serial.begin" in content,
                "baud_9600": "9600" in content,
                "size_bytes": os.path.getsize(FIRMWARE_PATH),
                "modified": time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ", time.gmtime(os.path.getmtime(FIRMWARE_PATH))
                ),
            }
        )
    except Exception as exc:
        result["error"] = str(exc)
    return result


def _safe_detail(exc: Exception, context: str) -> str:
    logger.exception("%s: %s", context, exc)
    return f"{context}. Revisa el diagnóstico técnico del servidor."


# ----------------------------------------------------------------------
# Puertos y conexión
# ----------------------------------------------------------------------
@app.get("/api/ports")
async def list_ports():
    ports = await run_in_threadpool(serial_mgr.list_ports)
    return {"ports": ports}


@app.post("/api/connect")
async def connect_serial(request: ConnectRequest):
    try:
        if session_mgr.is_recording:
            await run_in_threadpool(session_mgr.stop_session, "cambio_a_conexion_serial")
        if serial_mgr.is_synthetic:
            await run_in_threadpool(serial_mgr.disconnect)

        success, message = await run_in_threadpool(
            serial_mgr.connect, request.port, request.baudrate
        )
        if not success:
            raise HTTPException(status_code=400, detail=message)
        _publish_status()
        return {"success": True, "message": message, "serial": serial_mgr.get_status()}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_detail(exc, "No se pudo conectar el puerto"))


@app.post("/api/disconnect")
async def disconnect_serial():
    try:
        if session_mgr.is_recording:
            await run_in_threadpool(session_mgr.stop_session, "desconexion_manual")
        await run_in_threadpool(serial_mgr.disconnect)
        _publish_status()
        return {"success": True, "message": "Puerto desconectado y sesión guardada."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_detail(exc, "No se pudo desconectar"))


@app.post("/api/synthetic/start")
async def start_synthetic():
    try:
        if session_mgr.is_recording:
            await run_in_threadpool(session_mgr.stop_session, "cambio_a_simulacion")
        if serial_mgr.is_port_open:
            await run_in_threadpool(serial_mgr.disconnect)
        success, message = await run_in_threadpool(
            serial_mgr.start_synthetic_mode,
            circuit_config.resistencia_carga_ohm or 4700.0,
            circuit_config.capacitancia_f,
            4.0,
        )
        if not success:
            raise HTTPException(status_code=400, detail=message)
        _publish_status()
        return {"success": True, "message": message, "serial": serial_mgr.get_status()}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_detail(exc, "No se pudo iniciar el emulador"))


@app.post("/api/synthetic/stop")
async def stop_synthetic():
    try:
        if session_mgr.is_recording:
            await run_in_threadpool(session_mgr.stop_session, "fin_simulacion")
        await run_in_threadpool(serial_mgr.disconnect)
        _publish_status()
        return {"success": True, "message": "Emulador detenido y sesión guardada."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_detail(exc, "No se pudo detener el emulador"))


@app.get("/api/status")
async def get_status():
    return _status_payload()


# ----------------------------------------------------------------------
# Configuración eléctrica
# ----------------------------------------------------------------------
@app.get("/api/config")
async def get_config():
    return {
        "config": circuit_config.model_dump(),
        "tau_carga_s": circuit_config.tau_carga_s(),
        "tau_descarga_s": circuit_config.tau_descarga_s(),
        "ganancia_divisor": circuit_config.ganancia_divisor,
    }


@app.put("/api/config")
async def update_config(update: CircuitConfigUpdate):
    global circuit_config
    try:
        merged = circuit_config.model_dump()
        merged.update(update.model_dump(exclude_none=True))
        circuit_config = CircuitParameters(**merged)
        _publish_status()
        return {
            "success": True,
            "config": circuit_config.model_dump(),
            "tau_carga_s": circuit_config.tau_carga_s(),
            "tau_descarga_s": circuit_config.tau_descarga_s(),
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Configuración inválida: {exc}")


# ----------------------------------------------------------------------
# Sesiones
# ----------------------------------------------------------------------
@app.post("/api/session/start")
async def session_start():
    try:
        if session_mgr.is_recording:
            await run_in_threadpool(session_mgr.stop_session, "reinicio_de_sesion")

        if serial_mgr.is_synthetic:
            origin = "SIMULACION"
            port = "SINTETICO_TEST"
        elif serial_mgr.is_port_open and serial_mgr.has_valid_frame:
            origin = "SERIAL"
            port = serial_mgr.port_name
        else:
            raise HTTPException(
                status_code=400,
                detail=(
                    "No hay una fuente activa con tramas válidas. Conecta el Arduino, "
                    "espera la primera trama o inicia el emulador."
                ),
            )

        meta = await run_in_threadpool(
            session_mgr.start_new_session,
            port,
            serial_mgr.baudrate,
            origin,
            circuit_config,
            serial_mgr.last_protocol or PROTOCOLO_ACTUAL,
            FIRMWARE_ACTUAL,
        )
        _publish_status()
        return {"success": True, "session": meta.model_dump()}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_detail(exc, "No se pudo iniciar la sesión"))


@app.post("/api/session/stop")
async def session_stop():
    try:
        meta = await run_in_threadpool(session_mgr.stop_session, "manual")
        if meta is None:
            raise HTTPException(status_code=400, detail="No hay sesión activa para detener")
        _publish_status()
        return {"success": True, "session": meta.model_dump()}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_detail(exc, "No se pudo detener la sesión"))


@app.post("/api/session/annotate")
async def session_annotate(request: AnnotationRequest):
    try:
        annotation = await run_in_threadpool(
            session_mgr.add_annotation, request.text, request.categoria
        )
        if annotation is None:
            raise HTTPException(status_code=400, detail="No hay sesión activa para anotar")
        return {"success": True, "annotation": annotation.model_dump()}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_detail(exc, "No se pudo registrar la anotación"))


@app.get("/api/sessions")
async def list_sessions():
    try:
        return {"sessions": await run_in_threadpool(session_mgr.list_saved_sessions)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_detail(exc, "No se pudo leer el historial"))


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str, include_samples: bool = False):
    try:
        data = await run_in_threadpool(session_mgr.load_session, session_id, include_samples)
        return data
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=_safe_detail(exc, "No se pudo cargar la sesión"))


@app.get("/api/sessions/{session_id}/export/{fmt}")
async def export_session(session_id: str, fmt: str):
    try:
        if fmt not in {"csv", "json"}:
            raise HTTPException(status_code=400, detail="Formato no soportado; usa csv o json")
        path = await run_in_threadpool(session_mgr.get_session_file, session_id, fmt)
        media = "text/csv" if fmt == "csv" else "application/json"
        return FileResponse(path, filename=os.path.basename(path), media_type=media)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=_safe_detail(exc, "No se pudo exportar la sesión"))


@app.get("/api/session/export/{fmt}")
async def export_current_session(fmt: str):
    try:
        if fmt not in {"csv", "json"}:
            raise HTTPException(status_code=400, detail="Formato no soportado; usa csv o json")
        if fmt == "csv":
            path = await run_in_threadpool(session_mgr.export_csv)
        else:
            path = await run_in_threadpool(session_mgr.save_to_disk)
        media = "text/csv" if fmt == "csv" else "application/json"
        return FileResponse(path, filename=os.path.basename(path), media_type=media)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=_safe_detail(exc, "No se pudo exportar la sesión actual"))


# ----------------------------------------------------------------------
# Matemática
# ----------------------------------------------------------------------
@app.post("/api/math/simulate")
async def run_simulation(request: SimulationRequest):
    try:
        return await run_in_threadpool(
            simular_circuito_rc,
            request.modo.upper(),
            request.r_ohm,
            request.c_farad,
            request.v_inicial,
            request.v_final,
            request.t_final,
            request.num_puntos,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=_safe_detail(exc, "No se pudo simular el circuito"))


@app.post("/api/math/fit")
async def run_fitting(request: FitRequest):
    try:
        fit = await run_in_threadpool(
            ajustar_exponencial_rc,
            request.tiempos,
            request.voltajes,
            request.modo,
            request.v0,
            request.vf,
        )
        if not fit.get("valido"):
            return fit
        tau_teo, _ = calcular_tau_teorica(
            request.r_ohm_teorica, request.c_farad_teorica
        )
        fit["tau_teorica_s"] = tau_teo
        fit["incertidumbre"] = analisis_incertidumbre(
            fit.get("tau_experimental_s"),
            tau_teo,
            params=circuit_config,
            tau_fit_err=fit.get("incertidumbre_tau_s"),
        )
        return fit
    except Exception as exc:
        raise HTTPException(status_code=400, detail=_safe_detail(exc, "No se pudo ajustar la curva"))


@app.post("/api/math/analyze")
async def analyze(request: AnalysisRequest):
    try:
        if request.session_id:
            data = await run_in_threadpool(
                session_mgr.load_session, request.session_id, True
            )
            samples: List[Any] = data.get("samples", [])
            params = request.parametros or CircuitParameters(
                **data.get("metadata", {}).get("parametros_circuito", {})
            )
        elif request.samples:
            samples = request.samples
            params = request.parametros or circuit_config
        else:
            with session_mgr._lock:  # lectura consistente del buffer actual
                samples = list(session_mgr.samples)
            params = request.parametros or circuit_config

        return await run_in_threadpool(
            analizar_sesion,
            samples,
            params,
            request.start_s,
            request.end_s,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=_safe_detail(exc, "No se pudo analizar la sesión"))


# ----------------------------------------------------------------------
# Diagnóstico
# ----------------------------------------------------------------------
@app.get("/api/diagnostics")
async def diagnostics():
    return {
        "version": APP_VERSION,
        "schema_version": SCHEMA_VERSION,
        "python": sys.version,
        "platform": platform.platform(),
        "cwd": os.getcwd(),
        "session_dir": session_mgr.session_dir,
        "serial": serial_mgr.get_status(),
        "session": session_mgr.get_summary(),
        "config": circuit_config.model_dump(),
        "tau_carga_s": circuit_config.tau_carga_s(),
        "tau_descarga_s": circuit_config.tau_descarga_s(),
        "firmware": _firmware_diagnostics(),
        "websocket": {
            "clients": len(ws_hub.clients),
            "queue_size": ws_hub.queue.qsize() if ws_hub.queue else 0,
            "dropped_messages": ws_hub.dropped_messages,
            "sent_messages": ws_hub.sent_messages,
        },
        "protocol": {
            "actual": PROTOCOLO_ACTUAL,
            "heredados": [PROTOCOLO_LEGACY_2F, PROTOCOLO_LEGACY_V1],
            "baudrate": BAUDIOS,
        },
        "warnings": [
            "La referencia de 5 V del ADC es una hipótesis, no una calibración certificada.",
            "La resistencia efectiva de descarga no se asume igual a la de carga.",
            "La validación con hardware físico debe realizarse con instrumentos independientes.",
        ],
    }


# ----------------------------------------------------------------------
# WebSocket
# ----------------------------------------------------------------------
@app.websocket("/ws/live")
async def websocket_live(websocket: WebSocket):
    await ws_hub.connect(websocket)
    try:
        await websocket.send_text(
            json.dumps({"type": "STATUS_INIT", **_status_payload()}, ensure_ascii=False)
        )
        while True:
            raw = await websocket.receive_text()
            try:
                command = json.loads(raw)
                if command.get("action") == "PING":
                    await websocket.send_text(
                        json.dumps({"type": "PONG", "time": time.time()})
                    )
                elif command.get("action") == "STATUS":
                    await websocket.send_text(
                        json.dumps({"type": "STATUS", **_status_payload()}, ensure_ascii=False)
                    )
            except json.JSONDecodeError:
                await websocket.send_text(
                    json.dumps({"type": "ERROR", "detail": "Mensaje WebSocket no válido"})
                )
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Error en WebSocket")
    finally:
        await ws_hub.disconnect(websocket)


# ----------------------------------------------------------------------
# Manejo de errores y frontend
# ----------------------------------------------------------------------
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Error no controlado en %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "detail": (
                "Error interno del laboratorio. La operación no se completó. "
                "Consulta /api/diagnostics y la consola del servidor."
            )
        },
    )


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
