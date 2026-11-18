"""
Gestor de comunicación USB serial y emulador de pruebas para RC LAB 3D.

Correcciones principales frente a la versión anterior:
- Lock reentrante y cierre interno para evitar el interbloqueo de connect().
- Generaciones de hilo para que un lector viejo no derribe una conexión nueva.
- Estado separado "puerto abierto" y "primera trama válida recibida".
- Detección de datos obsoletos y timeout de primera trama.
- Emulador sintético no bloqueante, identificado como SIMULACION.
"""
from __future__ import annotations

import math
import threading
import time
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional, Tuple

import serial
import serial.tools.list_ports

from backend.models import FIRMWARE_ACTUAL, PROTOCOLO_ACTUAL, TelemetrySample
from backend.parser import SerialParser
from backend.protocol import ADC_MAX, BAUDIOS, PERIODO_TELEMETRIA_MS


class SerialManager:
    def __init__(
        self,
        on_sample_callback: Optional[Callable[[TelemetrySample], None]] = None,
        on_event_callback: Optional[Callable[[str, str], None]] = None,
    ) -> None:
        self.on_sample_callback = on_sample_callback
        self.on_event_callback = on_event_callback

        self.parser = SerialParser()
        self.serial_port: Optional[serial.Serial] = None
        self.port_name: Optional[str] = None
        self.baudrate: int = BAUDIOS

        self.is_port_open: bool = False
        self.is_running: bool = False
        self.is_synthetic: bool = False
        self.has_valid_frame: bool = False
        self.synthetic_plan: Optional[Dict[str, Any]] = None

        self._lock = threading.RLock()
        self._generation = 0
        self._thread: Optional[threading.Thread] = None
        self._synthetic_thread: Optional[threading.Thread] = None

        self.opened_at_monotonic: Optional[float] = None
        self.last_valid_sample_time: float = 0.0
        self.last_raw_line: Optional[str] = None
        self.last_protocol: Optional[str] = None
        self.stale_after_s: float = 3.0
        self.first_frame_timeout_s: float = 6.0
        self.max_line_bytes: int = 1024

        self._sample_timestamps: Deque[float] = deque(maxlen=500)
        self.stats: Dict[str, Any] = self._initial_stats()

    @staticmethod
    def _initial_stats() -> Dict[str, Any]:
        return {
            "bytes_read": 0,
            "samples_received": 0,
            "corrupt_lines": 0,
            "ignored_lines": 0,
            "connection_state": "DESCONECTADO",
            "last_error": None,
            "sample_rate_hz": 0.0,
            "first_frame_at": None,
        }

    # ------------------------------------------------------------------
    # Puertos
    # ------------------------------------------------------------------
    @staticmethod
    def list_ports() -> List[Dict[str, str]]:
        result: List[Dict[str, str]] = []
        for port in serial.tools.list_ports.comports():
            description = port.description or ""
            result.append(
                {
                    "device": port.device,
                    "description": description,
                    "hwid": port.hwid or "",
                    "is_arduino": any(
                        token in description.lower()
                        for token in ("arduino", "ch340", "usb serial", "usb-serial")
                    ),
                }
            )
        return result

    # ------------------------------------------------------------------
    # Conexión serial
    # ------------------------------------------------------------------
    def connect(self, port: str, baudrate: int = BAUDIOS) -> Tuple[bool, str]:
        with self._lock:
            self._stop_locked()
            self._generation += 1
            generation = self._generation

            self.port_name = port
            self.baudrate = int(baudrate)
            self.parser = SerialParser()
            self.stats = self._initial_stats()
            self.last_raw_line = None
            self.last_protocol = None
            self.has_valid_frame = False
            self.last_valid_sample_time = 0.0
            self.is_synthetic = False

            try:
                self.serial_port = serial.Serial(
                    port=port,
                    baudrate=self.baudrate,
                    timeout=0.5,
                    write_timeout=1.0,
                )
                # Reinicio normal del Arduino Uno al abrir el puerto.
                self.serial_port.dtr = False
                time.sleep(0.1)
                self.serial_port.dtr = True
                try:
                    self.serial_port.reset_input_buffer()
                except Exception:
                    pass

                self.is_port_open = True
                self.is_running = True
                self.opened_at_monotonic = time.monotonic()
                self.stats["connection_state"] = "ESPERANDO_PRIMERA_TRAMA"

                self._thread = threading.Thread(
                    target=self._reader_loop,
                    args=(generation,),
                    name=f"serial-reader-{generation}",
                    daemon=True,
                )
                self._thread.start()
                return True, (
                    f"Puerto {port} abierto a {self.baudrate} baudios. "
                    "Esperando la primera trama válida del firmware."
                )
            except Exception as exc:
                self.is_port_open = False
                self.is_running = False
                self.stats["connection_state"] = "ERROR"
                self.stats["last_error"] = str(exc)
                self.serial_port = None
                return False, f"No se pudo abrir {port}: {exc}"

    def disconnect(self) -> None:
        with self._lock:
            self._stop_locked()
            self.stats["connection_state"] = "DESCONECTADO"

    def _stop_locked(self) -> None:
        self._generation += 1
        self.is_running = False
        self.is_port_open = False
        self.is_synthetic = False
        self.has_valid_frame = False
        self.opened_at_monotonic = None
        self.synthetic_plan = None

        port = self.serial_port
        self.serial_port = None
        if port is not None:
            try:
                if port.is_open:
                    port.close()
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Lector serial
    # ------------------------------------------------------------------
    def _reader_loop(self, generation: int) -> None:
        while self._is_current(generation):
            with self._lock:
                port = self.serial_port
            if port is None or not port.is_open:
                break

            try:
                data = port.readline()
            except serial.SerialException as exc:
                self._handle_serial_error(generation, f"Desconexión física del puerto: {exc}")
                break
            except Exception as exc:
                with self._lock:
                    if generation == self._generation:
                        self.stats["last_error"] = str(exc)
                time.sleep(0.05)
                continue

            if not data:
                continue

            with self._lock:
                if generation != self._generation:
                    break
                self.stats["bytes_read"] += len(data)

            line = data.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            if len(line.encode("utf-8", errors="replace")) > self.max_line_bytes:
                self._record_corrupt("Línea supera el máximo permitido y se descarta")
                continue

            self.last_raw_line = line[:300]
            sample, error = self.parser.parse_line(line, origin="SERIAL")

            if sample is not None:
                self._emit_sample(sample, generation)
            elif error:
                self._record_corrupt(error)

    def _handle_serial_error(self, generation: int, message: str) -> None:
        callback = None
        with self._lock:
            if generation != self._generation:
                return
            self.stats["connection_state"] = "ERROR"
            self.stats["last_error"] = message
            self.is_running = False
            self.is_port_open = False
            self.has_valid_frame = False
            self.opened_at_monotonic = None
            port = self.serial_port
            self.serial_port = None
            if port is not None:
                try:
                    if port.is_open:
                        port.close()
                except Exception:
                    pass
            callback = self.on_event_callback

        if callback:
            try:
                callback("disconnected", message)
            except Exception:
                pass

    def _record_corrupt(self, message: str) -> None:
        with self._lock:
            self.stats["corrupt_lines"] += 1
            self.stats["last_error"] = message

    # ------------------------------------------------------------------
    # Emulador sintético
    # ------------------------------------------------------------------
    def start_synthetic_mode(
        self,
        r_ohm: float = 4700.0,
        c_farad: float = 0.004,
        voltaje_techo_v: float = 4.0,
        speed: float = 8.0,
        scenario: str = "completo",
    ) -> Tuple[bool, str]:
        with self._lock:
            self._stop_locked()
            self._generation += 1
            generation = self._generation

            if r_ohm <= 0 or c_farad <= 0:
                return False, "R y C deben ser positivos para el emulador"
            if scenario not in {"completo", "carga", "descarga"}:
                return False, "Escenario sintético no válido"

            speed = max(1.0, min(50.0, float(speed)))
            tau = max(0.1, float(r_ohm) * float(c_farad))
            phases = {"completo": ["C", "D"], "carga": ["C"], "descarga": ["D"]}[scenario]

            self.parser = SerialParser()
            self.stats = self._initial_stats()
            self.port_name = "SINTETICO_TEST"
            self.baudrate = BAUDIOS
            self.is_synthetic = True
            self.is_running = True
            self.is_port_open = False
            self.has_valid_frame = False
            self.last_valid_sample_time = 0.0
            self.last_raw_line = None
            self.last_protocol = PROTOCOLO_ACTUAL
            self.opened_at_monotonic = time.monotonic()
            self.stats["connection_state"] = "SIMULACION_ACTIVA"
            self.synthetic_plan = {
                "scenario": scenario,
                "speed": speed,
                "tau_s": round(tau, 4),
                "phase_s": round(5.0 * tau, 4),
                "total_s": round(5.0 * tau * len(phases), 4),
                "real_duration_s": round(5.0 * tau * len(phases) / speed, 3),
                "phases": list(phases),
                "ceiling_v": float(voltaje_techo_v),
            }

            self._synthetic_thread = threading.Thread(
                target=self._synthetic_loop,
                args=(
                    generation,
                    float(r_ohm),
                    float(c_farad),
                    float(voltaje_techo_v),
                    speed,
                    tuple(phases),
                ),
                name=f"synthetic-{generation}",
                daemon=True,
            )
            self._synthetic_thread.start()
            return True, "Emulador de pruebas iniciado. Los datos se identifican como SIMULACION."

    def get_synthetic_plan(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            return dict(self.synthetic_plan) if self.synthetic_plan else None

    def _synthetic_loop(
        self,
        generation: int,
        r_ohm: float,
        c_farad: float,
        voltaje_techo_v: float,
        speed: float,
        phases: Tuple[str, ...],
    ) -> None:
        tau = max(0.1, r_ohm * c_farad)
        techo = min(5.0, max(0.1, voltaje_techo_v))
        ganancia = (1_000_000.0 + 470_000.0) / 470_000.0
        duracion_fase = 5.0 * tau

        # El reloj de la simulación avanza `speed` veces más rápido que el
        # reloj real. Las marcas de tiempo y las ecuaciones RC siguen siendo
        # coherentes; solo se acorta la espera didáctica.
        sim_time = 0.0
        last_wall = time.monotonic()
        phase_index = 0

        while self._is_current(generation):
            now = time.monotonic()
            delta = max(0.0, now - last_wall)
            last_wall = now
            sim_time += delta * speed

            while (
                phase_index + 1 < len(phases)
                and sim_time >= duracion_fase * (phase_index + 1)
            ):
                phase_index += 1

            phase = phases[phase_index]
            phase_start = duracion_fase * phase_index
            tiempo_fase = max(0.0, min(duracion_fase, sim_time - phase_start))

            if phase == "C":
                v0 = 0.0
                vf = techo
                voltaje = vf - (vf - v0) * math.exp(-tiempo_fase / tau)
                estado = "C" if voltaje < (vf - 0.01) else "S"
                pwm = 0
            else:
                v0 = techo
                vf = 0.0
                voltaje = vf + (v0 - vf) * math.exp(-tiempo_fase / tau)
                estado = "D" if voltaje > 0.01 else "S"
                pasos = int(tiempo_fase / 0.015)
                pwm = max(0, 255 - pasos * 5)
                if pwm < 5:
                    pwm = 0

            voltaje = max(0.0, min(30.0, voltaje))
            adc_a0 = int(round(min(5.0, max(0.0, (voltaje / ganancia))) / 5.0 * ADC_MAX))
            adc_a1 = int(round(min(5.0, max(0.0, techo)) / 5.0 * ADC_MAX))
            millis = int(sim_time * 1000.0) & 0xFFFFFFFF

            line = (
                f"R1,{millis},{voltaje:.3f},{techo:.3f},{estado},{pwm},"
                f"{adc_a0},{adc_a1}"
            )
            self.last_raw_line = line
            sample, _ = self.parser.parse_line(line, origin="SIMULACION")
            if sample is not None:
                self._emit_sample(sample, generation)

            siguiente = (int(now / (PERIODO_TELEMETRIA_MS / 1000.0)) + 1) * (
                PERIODO_TELEMETRIA_MS / 1000.0
            )
            time.sleep(max(0.005, siguiente - time.monotonic()))

    # ------------------------------------------------------------------
    # Estado
    # ------------------------------------------------------------------
    def _emit_sample(self, sample: TelemetrySample, generation: int) -> None:
        callback = None
        with self._lock:
            if generation != self._generation:
                return
            self.has_valid_frame = True
            self.last_valid_sample_time = time.time()
            self.last_protocol = sample.protocolo
            self.stats["samples_received"] += 1
            self.stats["connection_state"] = (
                "SIMULACION_ACTIVA" if self.is_synthetic else "TRANSMITIENDO"
            )
            self._sample_timestamps.append(time.monotonic())
            self._refresh_rate_locked()
            callback = self.on_sample_callback

        if callback:
            try:
                callback(sample)
            except Exception:
                pass

    def _refresh_rate_locked(self) -> None:
        ahora = time.monotonic()
        while self._sample_timestamps and (ahora - self._sample_timestamps[0]) > 1.0:
            self._sample_timestamps.popleft()
        self.stats["sample_rate_hz"] = float(len(self._sample_timestamps))

    def _is_current(self, generation: int) -> bool:
        with self._lock:
            return generation == self._generation and self.is_running

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            self._refresh_rate_locked()
            ahora = time.time()
            since_last = (
                ahora - self.last_valid_sample_time
                if self.last_valid_sample_time > 0
                else None
            )
            stale = since_last is not None and since_last > self.stale_after_s
            connected = (
                (self.is_port_open or self.is_synthetic)
                and self.has_valid_frame
                and not stale
            )

            if self.is_synthetic:
                if self.has_valid_frame and not stale:
                    state = "SIMULACION_ACTIVA"
                elif self.has_valid_frame and stale:
                    state = "DATOS_OBSOLETOS"
                else:
                    state = "ESPERANDO_PRIMERA_TRAMA"
            elif self.is_port_open:
                if not self.has_valid_frame:
                    open_for = (
                        time.monotonic() - self.opened_at_monotonic
                        if self.opened_at_monotonic is not None
                        else 0.0
                    )
                    state = (
                        "ESPERANDO_PRIMERA_TRAMA"
                        if open_for <= self.first_frame_timeout_s
                        else "SIN_DATOS_VALIDOS"
                    )
                elif stale:
                    state = "DATOS_OBSOLETOS"
                else:
                    state = "TRANSMITIENDO"
            else:
                state = self.stats.get("connection_state", "DESCONECTADO")
                if state in {"TRANSMITIENDO", "SIMULACION_ACTIVA"}:
                    state = "DESCONECTADO"

            return {
                "connected": bool(connected),
                "port_open": self.is_port_open,
                "port": self.port_name,
                "baudrate": self.baudrate,
                "is_synthetic": self.is_synthetic,
                "has_valid_frame": self.has_valid_frame,
                "connection_state": state,
                "sample_rate_hz": round(self.stats["sample_rate_hz"], 1),
                "total_samples": self.stats["samples_received"],
                "corrupt_lines": self.stats["corrupt_lines"],
                "ignored_lines": self.stats["ignored_lines"],
                "seconds_since_last_sample": round(since_last, 2) if since_last is not None else None,
                "stale": bool(stale),
                "last_error": self.stats["last_error"],
                "last_raw_line": self.last_raw_line,
                "protocol": self.last_protocol or PROTOCOLO_ACTUAL,
                "firmware": FIRMWARE_ACTUAL,
                "stale_after_s": self.stale_after_s,
                "first_frame_timeout_s": self.first_frame_timeout_s,
                "parser_stats": dict(self.parser.stats),
            }
