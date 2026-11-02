"""
Gestor de sesiones experimentales, anotaciones, eventos y exportaciones CSV / JSON.
"""
import os
import csv
import json
import time
from typing import List, Dict, Optional, Any
from backend.models import TelemetrySample, SessionAnnotation, SessionMetadata, CircuitParameters

SESSION_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data_sessions"))
os.makedirs(SESSION_DIR, exist_ok=True)

class SessionManager:
    def __init__(self):
        self.current_session: Optional[SessionMetadata] = None
        self.samples: List[TelemetrySample] = []
        self.is_recording: bool = False
        self.start_monotonic: float = 0.0
        
    def start_new_session(self, port: Optional[str] = None, baudrate: int = 115200, origin: str = "SERIAL") -> SessionMetadata:
        session_id = f"RC_SES_{time.strftime('%Y%m%d_%H%M%S')}"
        meta = SessionMetadata(
            session_id=session_id,
            created_at_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            device_port=port,
            baudrate=baudrate,
            origen_datos=origin,
            parametros_circuito=CircuitParameters()
        )
        self.current_session = meta
        self.samples = []
        self.is_recording = True
        self.start_monotonic = time.monotonic()
        return meta

    def stop_session(self) -> Optional[SessionMetadata]:
        self.is_recording = False
        if self.current_session:
            self.save_to_disk()
            return self.current_session
        return None

    def add_sample(self, sample: TelemetrySample):
        if self.is_recording and self.current_session:
            self.samples.append(sample)
            if sample.valida:
                self.current_session.total_muestras_validas += 1
            else:
                self.current_session.total_muestras_invalidas += 1

    def add_annotation(self, text: str, category: str = "NOTA") -> Optional[SessionAnnotation]:
        if not self.current_session:
            return None
        ann = SessionAnnotation(
            timestamp=time.time(),
            monotonic_time=time.monotonic(),
            text=text,
            categoria=category
        )
        self.current_session.anotaciones.append(ann)
        return ann

    def record_disconnection(self):
        if self.current_session:
            self.current_session.desconexiones.append({"timestamp": time.time(), "tipo": "DESCONEXION"})
            self.add_annotation("Pérdida de señal o desconexión del puerto COM", "DESCONEXION")

    def record_reconnection(self):
        if self.current_session:
            self.current_session.desconexiones.append({"timestamp": time.time(), "tipo": "RECONEXION"})
            self.add_annotation("Reconexión exitosa del puerto COM", "RECONEXION")

    def update_circuit_parameters(self, params: Dict[str, Any]):
        if self.current_session:
            for k, v in params.items():
                if hasattr(self.current_session.parametros_circuito, k):
                    setattr(self.current_session.parametros_circuito, k, v)

    def get_summary(self) -> Dict[str, Any]:
        if not self.current_session:
            return {"active": False}
        elapsed = time.monotonic() - self.start_monotonic if self.is_recording else 0.0
        return {
            "active": self.is_recording,
            "session_id": self.current_session.session_id,
            "samples_count": len(self.samples),
            "valid_samples": self.current_session.total_muestras_validas,
            "invalid_samples": self.current_session.total_muestras_invalidas,
            "elapsed_seconds": round(elapsed, 2),
            "annotations_count": len(self.current_session.anotaciones),
            "created_at": self.current_session.created_at_utc
        }

    def save_to_disk(self) -> str:
        if not self.current_session:
            raise ValueError("No hay sesión activa para guardar")
        filename = f"{self.current_session.session_id}.json"
        filepath = os.path.join(SESSION_DIR, filename)
        
        data = {
            "metadata": self.current_session.model_dump(),
            "samples": [s.model_dump() for s in self.samples]
        }
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return filepath

    def export_csv(self) -> str:
        if not self.current_session:
            raise ValueError("No hay sesión activa para exportar")
        filename = f"{self.current_session.session_id}.csv"
        filepath = os.path.join(SESSION_DIR, filename)
        
        fieldnames = [
            "timestamp_host", "monotonic_time", "tiempo_relativo_s",
            "voltaje_real", "curva_objetivo", "limite_pot", "error_seguimiento",
            "porcentaje_escala", "led1", "led2", "led3", "led4",
            "modo_estimado", "valida", "anomalia"
        ]
        
        t0 = self.samples[0].monotonic_time if self.samples else 0.0
        
        with open(filepath, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for s in self.samples:
                writer.writerow({
                    "timestamp_host": f"{s.timestamp_host:.4f}",
                    "monotonic_time": f"{s.monotonic_time:.4f}",
                    "tiempo_relativo_s": f"{(s.monotonic_time - t0):.4f}",
                    "voltaje_real": s.voltaje_real,
                    "curva_objetivo": s.voltaje_objetivo,
                    "limite_pot": s.limite_pot,
                    "error_seguimiento": s.error_seguimiento,
                    "porcentaje_escala": s.porcentaje_escala,
                    "led1": int(s.led1_logico),
                    "led2": int(s.led2_logico),
                    "led3": int(s.led3_logico),
                    "led4": int(s.led4_logico),
                    "modo_estimado": s.modo_estimado,
                    "valida": int(s.valida),
                    "anomalia": int(s.anomalia)
                })
        return filepath

    def list_saved_sessions(self) -> List[Dict[str, Any]]:
        sessions = []
        for fname in os.listdir(SESSION_DIR):
            if fname.endswith(".json"):
                fpath = os.path.join(SESSION_DIR, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        meta = data.get("metadata", {})
                        sessions.append({
                            "session_id": meta.get("session_id", fname),
                            "created_at": meta.get("created_at_utc"),
                            "samples": len(data.get("samples", [])),
                            "file": fname
                        })
                except Exception:
                    continue
        return sorted(sessions, key=lambda x: x.get("created_at", ""), reverse=True)
