"""
Servidor principal FastAPI para RC LAB 3D.
Provee API REST, conexión WebSocket para streaming en tiempo real y sirve el frontend.
"""
import os
import asyncio
import json
import time
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from backend.serial_manager import SerialManager
from backend.session_manager import SessionManager
from backend.math_engine import simular_circuito_rc, ajustar_exponencial_rc, analisis_incertidumbre, calcular_tau_teorica
from backend.models import TelemetrySample

app = FastAPI(title="RC LAB 3D — Suite Científica", version="2.0.0")

# Instancias centrales
session_mgr = SessionManager()

# Cola de eventos para distribuir a WebSockets
connected_websockets: List[WebSocket] = []
ws_lock = asyncio.Lock()
loop_ref: Optional[asyncio.AbstractEventLoop] = None

def broadcast_sample(sample: TelemetrySample):
    """Callback invocado por el hilo serial al recibir una muestra válida"""
    session_mgr.add_sample(sample)
    
    # Notificar a los clientes WebSockets de forma asíncrona y segura
    if connected_websockets and loop_ref and loop_ref.is_running():
        payload = {
            "type": "SAMPLE",
            "data": sample.model_dump()
        }
        msg = json.dumps(payload)
        asyncio.run_coroutine_threadsafe(_send_ws_broadcast(msg), loop_ref)

async def _send_ws_broadcast(msg: str):
    async with ws_lock:
        to_remove = []
        for ws in connected_websockets:
            try:
                await ws.send_text(msg)
            except Exception:
                to_remove.append(ws)
        for ws in to_remove:
            if ws in connected_websockets:
                connected_websockets.remove(ws)

serial_mgr = SerialManager(on_sample_callback=broadcast_sample)

# DTOs
class ConnectRequest(BaseModel):
    port: str
    baudrate: int = 115200

class AnnotationRequest(BaseModel):
    text: str
    categoria: str = "NOTA"

class SimulationRequest(BaseModel):
    modo: str = "CARGA"
    r_ohm: float = 1000.0
    c_farad: float = 0.001
    v_s: float = 5.0
    v_0: float = 0.0
    t_final: float = 5.0

class FitRequest(BaseModel):
    tiempos: List[float]
    voltajes: List[float]
    modo: Optional[str] = None
    r_ohm_teorica: Optional[float] = None
    c_farad_teorica: Optional[float] = 0.001

# Endpoints REST

@app.on_event("startup")
async def startup_event():
    global loop_ref
    loop_ref = asyncio.get_running_loop()

@app.get("/api/ports")
async def list_ports():
    ports = serial_mgr.list_ports()
    return {"ports": ports}

@app.post("/api/connect")
async def connect_serial(req: ConnectRequest):
    success, msg = serial_mgr.connect(req.port, req.baudrate)
    if success:
        # Iniciar sesión de adquisición automáticamente si no hay activa
        if not session_mgr.is_recording:
            session_mgr.start_new_session(port=req.port, baudrate=req.baudrate, origin="SERIAL")
        return {"success": True, "message": msg}
    else:
        raise HTTPException(status_code=400, detail=msg)

@app.post("/api/disconnect")
async def disconnect_serial():
    serial_mgr.disconnect()
    session_mgr.record_disconnection()
    return {"success": True, "message": "Puerto desconectado exitosamente."}

@app.post("/api/synthetic/start")
async def start_synthetic():
    serial_mgr.start_synthetic_mode()
    if not session_mgr.is_recording:
        session_mgr.start_new_session(port="SINTETICO_TEST", baudrate=115200, origin="SINTETICO_TEST")
    return {"success": True, "message": "Emulador de hardware sintético activado."}

@app.get("/api/status")
async def get_system_status():
    serial_status = serial_mgr.get_status()
    session_summary = session_mgr.get_summary()
    return {
        "serial": serial_status,
        "session": session_summary
    }

@app.post("/api/session/start")
async def session_start():
    port = serial_mgr.port_name or "DESCONECTADO"
    meta = session_mgr.start_new_session(port=port, baudrate=serial_mgr.baudrate)
    return {"success": True, "session": meta.model_dump()}

@app.post("/api/session/stop")
async def session_stop():
    meta = session_mgr.stop_session()
    return {"success": True, "session": meta.model_dump() if meta else None}

@app.post("/api/session/annotate")
async def session_annotate(req: AnnotationRequest):
    ann = session_mgr.add_annotation(req.text, req.categoria)
    if not ann:
        raise HTTPException(status_code=400, detail="No hay sesión activa para anotar")
    return {"success": True, "annotation": ann.model_dump()}

@app.get("/api/session/export/csv")
async def export_session_csv():
    try:
        path = session_mgr.export_csv()
        return FileResponse(path, filename=os.path.basename(path), media_type="text/csv")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/session/export/json")
async def export_session_json():
    try:
        path = session_mgr.save_to_disk()
        return FileResponse(path, filename=os.path.basename(path), media_type="application/json")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/math/simulate")
async def run_simulation(req: SimulationRequest):
    result = simular_circuito_rc(
        modo=req.modo,
        r_ohm=req.r_ohm,
        c_farad=req.c_farad,
        v_s=req.v_s,
        v_0=req.v_0,
        t_final=req.t_final
    )
    return result

@app.post("/api/math/fit")
async def run_fitting(req: FitRequest):
    fit_res = ajustar_exponencial_rc(req.tiempos, req.voltajes, modo=req.modo)
    if not fit_res["valido"]:
        return fit_res
        
    tau_exp = fit_res.get("tau_experimental_s")
    tau_teo, _ = calcular_tau_teorica(req.r_ohm_teorica, req.c_farad_teorica)
    
    unc_res = analisis_incertidumbre(tau_exp, tau_teo)
    fit_res["incertidumbre"] = unc_res
    fit_res["tau_teorica_s"] = round(tau_teo, 4) if tau_teo else None
    return fit_res

@app.websocket("/ws/live")
async def websocket_live_stream(websocket: WebSocket):
    await websocket.accept()
    async with ws_lock:
        connected_websockets.append(websocket)
    try:
        # Enviar estado actual de inmediato
        init_payload = {
            "type": "STATUS_INIT",
            "serial": serial_mgr.get_status(),
            "session": session_mgr.get_summary()
        }
        await websocket.send_text(json.dumps(init_payload))
        
        while True:
            # Mantener conexión viva y procesar comandos de cliente si los hubiera
            data = await websocket.receive_text()
            try:
                cmd = json.loads(data)
                if cmd.get("action") == "PING":
                    await websocket.send_text(json.dumps({"type": "PONG", "time": time.time()}))
            except Exception:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        async with ws_lock:
            if websocket in connected_websockets:
                connected_websockets.remove(websocket)

# Montar archivos estáticos del frontend
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
