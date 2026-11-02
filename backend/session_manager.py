"""
Gestor de sesiones experimentales de RC LAB 3D.

- IDs únicos con resolución de microsegundos y sufijo aleatorio.
- Guardado atómico JSON/CSV.
- Checkpoints automáticos durante la adquisición.
- Historial en disco y exportación por sesión.
- Separación estricta entre SERIAL y SIMULACION.
- Trazabilidad de origen, protocolo, puerto y parámetros en cada fila CSV.
"""
from __future__ import annotations

import csv
import json
import os
import threading
import time
import uuid
from typing import Any, Dict, List, Optional

from backend.models import (
    CircuitParameters,
    FIRMWARE_ACTUAL,
    PROTOCOLO_ACTUAL,
    SCHEMA_VERSION,
    SessionAnnotation,
    SessionEvent,
    SessionMetadata,
    TelemetrySample,
)

SESSION_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data_sessions"))
os.makedirs(SESSION_DIR, exist_ok=True)


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


class SessionManager:
    def __init__(self, session_dir: Optional[str] = None) -> None:
        self.session_dir = os.path.abspath(session_dir or SESSION_DIR)
        os.makedirs(self.session_dir, exist_ok=True)
        self.current_session: Optional[SessionMetadata] = None
        self.samples: List[TelemetrySample] = []
        self.is_recording: bool = False
        self.start_monotonic: float = 0.0
        self._last_state: Optional[str] = None
        self._last_checkpoint_monotonic: float = 0.0
        self._samples_at_checkpoint: int = 0
        self._checkpoint_interval_s: float = 15.0
        self._checkpoint_every_samples: int = 500
        self._lock = threading.RLock()

    # ------------------------------------------------------------------
    # Ciclo de vida
    # ------------------------------------------------------------------
    def start_new_session(
        self,
        port: Optional[str] = None,
        baudrate: int = 9600,
        origin: str = "SERIAL",
        parametros: Optional[CircuitParameters] = None,
        protocolo: str = PROTOCOLO_ACTUAL,
        firmware: str = FIRMWARE_ACTUAL,
    ) -> SessionMetadata:
        with self._lock:
            if self.is_recording:
                self.stop_session(reason="nueva_sesion")

            session_id = self._unique_session_id()
            meta = SessionMetadata(
                session_id=session_id,
                created_at_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                device_port=port,
                baudrate=int(baudrate),
                origen_datos=origin,
                protocolo=protocolo,
                firmware=firmware,
                parametros_circuito=(parametros or CircuitParameters()).model_copy(deep=True),
            )
            self.current_session = meta
            self.samples = []
            self.is_recording = True
            self.start_monotonic = time.monotonic()
            self._last_checkpoint_monotonic = self.start_monotonic
            self._samples_at_checkpoint = 0
            self._last_state = None
            return meta

    def stop_session(self, reason: str = "manual", save: bool = True) -> Optional[SessionMetadata]:
        with self._lock:
            if self.current_session is None:
                return None
            was_recording = self.is_recording
            self.is_recording = False
            if was_recording:
                self.current_session.ended_at_utc = time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
                )
                self.current_session.duracion_s = round(
                    time.monotonic() - self.start_monotonic, 3
                )
                self.current_session.total_muestras = len(self.samples)
                self.current_session.frecuencia_muestreo_hz = self._calculate_rate()
                self.current_session.eventos.append(
                    SessionEvent(
                        timestamp=time.time(),
                        tipo="FIN_SESION",
                        detalle=f"Sesión detenida: {reason}",
                    )
                )
            if save:
                self.save_to_disk()
            return self.current_session

    # ------------------------------------------------------------------
    # Muestras y eventos
    # ------------------------------------------------------------------
    def add_sample(self, sample: TelemetrySample) -> None:
        with self._lock:
            if not self.is_recording or self.current_session is None:
                return

            self.samples.append(sample)
            self.current_session.total_muestras = len(self.samples)
            if bool(_get(sample, "valida", True)):
                self.current_session.total_muestras_validas += 1
            else:
                self.current_session.total_muestras_invalidas += 1

            techo = _get(sample, "voltaje_techo")
            if techo is not None and self.current_session.voltaje_techo_v is None:
                self.current_session.voltaje_techo_v = float(techo)

            estado = str(_get(sample, "estado", "S")).upper()
            if estado != self._last_state:
                if estado in {"C", "D", "S"}:
                    tipo = {
                        "C": "INICIO_CARGA",
                        "D": "INICIO_DESCARGA",
                        "S": "ESTABLE",
                    }[estado]
                    self.current_session.eventos.append(
                        SessionEvent(
                            timestamp=float(_get(sample, "timestamp_host", time.time())),
                            device_time_ms=_get(sample, "device_time_ms"),
                            tipo=tipo,
                            detalle=f"Estado {estado}",
                            voltaje_v=float(_get(sample, "voltaje_tanque", 0.0)),
                        )
                    )
                self._last_state = estado

            self._maybe_checkpoint()

    def add_annotation(self, text: str, category: str = "NOTA") -> Optional[SessionAnnotation]:
        with self._lock:
            if self.current_session is None:
                return None
            annotation = SessionAnnotation(
                timestamp=time.time(),
                monotonic_time=time.monotonic(),
                text=text,
                categoria=category,
            )
            self.current_session.anotaciones.append(annotation)
            self.current_session.eventos.append(
                SessionEvent(
                    timestamp=annotation.timestamp,
                    tipo=category,
                    detalle=text,
                )
            )
            return annotation

    def record_disconnection(self, detail: str = "Pérdida de señal o desconexión") -> None:
        with self._lock:
            if self.current_session is None:
                return
            self.current_session.desconexiones.append(
                {"timestamp": time.time(), "tipo": "DESCONEXION", "detalle": detail}
            )
            self.current_session.eventos.append(
                SessionEvent(timestamp=time.time(), tipo="DESCONEXION", detalle=detail)
            )
            self.current_session.anotaciones.append(
                SessionAnnotation(text=detail, categoria="DESCONEXION")
            )

    def record_reconnection(self, detail: str = "Reconexión") -> None:
        with self._lock:
            if self.current_session is None:
                return
            self.current_session.desconexiones.append(
                {"timestamp": time.time(), "tipo": "RECONEXION", "detalle": detail}
            )
            self.current_session.eventos.append(
                SessionEvent(timestamp=time.time(), tipo="RECONEXION", detalle=detail)
            )

    def update_circuit_parameters(self, params: Dict[str, Any]) -> None:
        with self._lock:
            if self.current_session is None:
                return
            for key, value in params.items():
                if hasattr(self.current_session.parametros_circuito, key):
                    setattr(self.current_session.parametros_circuito, key, value)

    # ------------------------------------------------------------------
    # Resumen
    # ------------------------------------------------------------------
    def get_summary(self) -> Dict[str, Any]:
        with self._lock:
            if self.current_session is None:
                return {"active": False}
            last_sample = self.samples[-1] if self.samples else None
            elapsed = (
                time.monotonic() - self.start_monotonic
                if self.is_recording
                else (self.current_session.duracion_s or 0.0)
            )
            return {
                "active": self.is_recording,
                "session_id": self.current_session.session_id,
                "origen": self.current_session.origen_datos,
                "protocolo": self.current_session.protocolo,
                "samples_count": len(self.samples),
                "valid_samples": self.current_session.total_muestras_validas,
                "invalid_samples": self.current_session.total_muestras_invalidas,
                "elapsed_seconds": round(float(elapsed), 2),
                "annotations_count": len(self.current_session.anotaciones),
                "events_count": len(self.current_session.eventos),
                "created_at": self.current_session.created_at_utc,
                "last_sample_time": (
                    float(_get(last_sample, "timestamp_host"))
                    if last_sample is not None
                    else None
                ),
                "rate_hz": self._calculate_rate(),
                "voltaje_techo_v": self.current_session.voltaje_techo_v,
                "estado": str(_get(last_sample, "estado", "S")) if last_sample else None,
            }

    # ------------------------------------------------------------------
    # Persistencia
    # ------------------------------------------------------------------
    def _maybe_checkpoint(self) -> None:
        now = time.monotonic()
        if (
            now - self._last_checkpoint_monotonic >= self._checkpoint_interval_s
            or len(self.samples) - self._samples_at_checkpoint >= self._checkpoint_every_samples
        ):
            self.save_to_disk()
            self._last_checkpoint_monotonic = now
            self._samples_at_checkpoint = len(self.samples)

    def save_to_disk(self) -> str:
        with self._lock:
            if self.current_session is None:
                raise ValueError("No hay sesión para guardar")
            filepath = os.path.join(self.session_dir, f"{self.current_session.session_id}.json")
            data = {
                "schema_version": SCHEMA_VERSION,
                "metadata": self.current_session.model_dump(),
                "samples": [
                    s.model_dump() if hasattr(s, "model_dump") else dict(s)
                    for s in self.samples
                ],
            }
            self._atomic_write_json(filepath, data)
            return filepath

    def export_csv(self, session_id: Optional[str] = None) -> str:
        with self._lock:
            if session_id is None:
                if self.current_session is None:
                    raise ValueError("No hay sesión para exportar")
                meta = self.current_session
                samples: List[Any] = list(self.samples)
                filepath = os.path.join(self.session_dir, f"{meta.session_id}.csv")
            else:
                data = self.load_session(session_id, include_samples=True)
                meta = data["metadata"]
                samples = data.get("samples", [])
                filepath = os.path.join(self.session_dir, f"{session_id}.csv")

            self._write_csv(filepath, meta, samples)
            return filepath

    def _write_csv(self, filepath: str, meta: Any, samples: List[Any]) -> None:
        fieldnames = [
            "session_id",
            "origen",
            "protocolo",
            "puerto",
            "device_time_ms",
            "tiempo_relativo_s",
            "timestamp_host",
            "monotonic_time",
            "voltaje_tanque_v",
            "voltaje_techo_v",
            "estado",
            "pwm",
            "adc_a0",
            "adc_a1",
            "carga_c",
            "energia_j",
            "led_rojo",
            "led_amarillo1",
            "led_amarillo2",
            "valida",
            "anomalia",
            "mensaje_anomalia",
        ]
        params = _get(meta, "parametros_circuito", {}) or {}
        if hasattr(params, "model_dump"):
            params = params.model_dump()
        capacitance = float(params.get("capacitancia_f", 0.004))
        schema_version = int(_get(meta, "schema_version", 1) or 1)
        origin = _get(meta, "origen_datos", "SERIAL")
        if schema_version < 2:
            # Los archivos históricos no permiten verificar el origen real.
            origin = "LEGACY_NO_VERIFICADO"
        protocol = _get(meta, "protocolo", PROTOCOLO_ACTUAL)
        if schema_version < 2:
            protocol = _get(meta, "protocolo", _get(meta, "protocolo_serial", "LEGACY"))
        port = _get(meta, "device_port", "") or ""
        session_id = _get(meta, "session_id", "")

        t0_device = None
        t0_host = None
        for sample in samples:
            device_ms = _get(sample, "device_time_ms")
            if device_ms is not None:
                t0_device = int(device_ms)
                break
        if samples:
            t0_host = float(_get(samples[0], "monotonic_time", 0.0))

        temp_path = filepath + ".tmp"
        with open(temp_path, "w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for sample in samples:
                voltage = float(_get(sample, "voltaje_tanque", _get(sample, "voltaje_real", 0.0)))
                device_ms = _get(sample, "device_time_ms")
                if device_ms is not None and t0_device is not None:
                    relative = (int(device_ms) - t0_device) / 1000.0
                else:
                    relative = float(_get(sample, "monotonic_time", 0.0)) - (t0_host or 0.0)
                writer.writerow(
                    {
                        "session_id": session_id,
                        "origen": origin,
                        "protocolo": protocol,
                        "puerto": port,
                        "device_time_ms": device_ms if device_ms is not None else "",
                        "tiempo_relativo_s": f"{relative:.6f}",
                        "timestamp_host": f"{float(_get(sample, 'timestamp_host', 0.0)):.6f}",
                        "monotonic_time": f"{float(_get(sample, 'monotonic_time', 0.0)):.6f}",
                        "voltaje_tanque_v": f"{voltage:.6f}",
                        "voltaje_techo_v": f"{float(_get(sample, 'voltaje_techo', _get(sample, 'limite_pot', 0.0))):.6f}",
                        "estado": _get(sample, "estado", "S"),
                        "pwm": _get(sample, "pwm", ""),
                        "adc_a0": _get(sample, "adc_a0", ""),
                        "adc_a1": _get(sample, "adc_a1", ""),
                        "carga_c": f"{capacitance * voltage:.9f}",
                        "energia_j": f"{0.5 * capacitance * voltage**2:.9f}",
                        "led_rojo": int(bool(_get(sample, "led_rojo", False))),
                        "led_amarillo1": int(bool(_get(sample, "led_amarillo1", False))),
                        "led_amarillo2": int(bool(_get(sample, "led_amarillo2", False))),
                        "valida": int(bool(_get(sample, "valida", True))),
                        "anomalia": int(bool(_get(sample, "anomalia", False))),
                        "mensaje_anomalia": _get(sample, "mensaje_anomalia", "") or "",
                    }
                )
        os.replace(temp_path, filepath)

    def _atomic_write_json(self, filepath: str, data: Dict[str, Any]) -> None:
        temp_path = filepath + ".tmp"
        with open(temp_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False, allow_nan=False)
        os.replace(temp_path, filepath)

    # ------------------------------------------------------------------
    # Historial
    # ------------------------------------------------------------------
    def list_saved_sessions(self) -> List[Dict[str, Any]]:
        with self._lock:
            sessions: List[Dict[str, Any]] = []
            try:
                names = sorted(os.listdir(self.session_dir), reverse=True)
            except OSError:
                return []
            for name in names:
                if not name.endswith(".json"):
                    continue
                path = os.path.join(self.session_dir, name)
                try:
                    with open(path, "r", encoding="utf-8") as handle:
                        data = json.load(handle)
                    meta = data.get("metadata", {})
                    session_id = meta.get("session_id", name[:-5])
                    samples = data.get("samples", [])
                    sessions.append(
                        {
                            "session_id": session_id,
                            "created_at": meta.get("created_at_utc"),
                            "ended_at": meta.get("ended_at_utc"),
                            "origen": meta.get("origen_datos", "SERIAL"),
                            "protocolo": meta.get("protocolo", meta.get("protocolo_serial", "LEGACY")),
                            "puerto": meta.get("device_port"),
                            "samples": len(samples) if isinstance(samples, list) else meta.get("total_muestras_validas", 0),
                            "duracion_s": meta.get("duracion_s"),
                            "schema_version": meta.get("schema_version", 1),
                            "file": name,
                            "archivo_csv": f"{session_id}.csv" if os.path.exists(os.path.join(self.session_dir, f"{session_id}.csv")) else None,
                        }
                    )
                except Exception:
                    continue
            return sorted(sessions, key=lambda x: x.get("created_at") or "", reverse=True)

    def load_session(self, session_id: str, include_samples: bool = True) -> Dict[str, Any]:
        safe_id = os.path.basename(session_id)
        if safe_id != session_id:
            raise ValueError("Identificador de sesión inválido")
        path = os.path.join(self.session_dir, f"{safe_id}.json")
        if not os.path.isfile(path):
            raise FileNotFoundError(f"No existe la sesión {safe_id}")
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not include_samples:
            data["samples"] = []
        return data

    def get_session_file(self, session_id: str, fmt: str) -> str:
        safe_id = os.path.basename(session_id)
        if safe_id != session_id:
            raise ValueError("Identificador de sesión inválido")
        if fmt == "json":
            path = os.path.join(self.session_dir, f"{safe_id}.json")
        elif fmt == "csv":
            data = self.load_session(safe_id, include_samples=True)
            path = self.export_csv(safe_id)
            return path
        else:
            raise ValueError(f"Formato no soportado: {fmt}")
        if not os.path.isfile(path):
            raise FileNotFoundError(f"No existe el archivo de la sesión {safe_id}")
        return path

    # ------------------------------------------------------------------
    # Utilidades
    # ------------------------------------------------------------------
    def _unique_session_id(self) -> str:
        for _ in range(20):
            stamp = time.strftime("%Y%m%d_%H%M%S")
            suffix = uuid.uuid4().hex[:6]
            session_id = f"RC_SES_{stamp}_{suffix}"
            if not os.path.exists(os.path.join(self.session_dir, f"{session_id}.json")):
                return session_id
        return f"RC_SES_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"

    def _calculate_rate(self) -> Optional[float]:
        if len(self.samples) < 2:
            return None
        first = self.samples[0]
        last = self.samples[-1]
        device_first = _get(first, "device_time_ms")
        device_last = _get(last, "device_time_ms")
        if device_first is not None and device_last is not None:
            delta = (int(device_last) - int(device_first)) / 1000.0
        else:
            delta = float(_get(last, "monotonic_time", 0.0)) - float(
                _get(first, "monotonic_time", 0.0)
            )
        if delta <= 0:
            return None
        return round((len(self.samples) - 1) / delta, 3)
