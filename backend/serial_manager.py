"""
Gestor de comunicación USB Serial con subproceso no bloqueante,
detección automática de puertos COM, reconexión inteligente,
soporte para generador sintético de pruebas físicas en ausencia de Arduino real.
"""
import threading
import time
import queue
from typing import List, Dict, Optional, Callable, Any, Tuple
import serial
import serial.tools.list_ports

from backend.parser import SerialParser
from backend.models import TelemetrySample

class SerialManager:
    def __init__(self, on_sample_callback: Optional[Callable[[TelemetrySample], None]] = None):
        self.on_sample_callback = on_sample_callback
        self.parser = SerialParser()
        self.serial_port: Optional[serial.Serial] = None
        self.port_name: Optional[str] = None
        self.baudrate: int = 115200
        
        self.is_connected: bool = False
        self.is_running: bool = False
        self.is_synthetic_mode: bool = False
        
        self._thread: Optional[threading.Thread] = None
        self._synthetic_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        
        self.last_valid_sample_time: float = 0.0
        self.stats = {
            "bytes_read": 0,
            "samples_received": 0,
            "corrupt_lines": 0,
            "connection_state": "DISCONNECTED",
            "last_error": None,
            "sample_rate_hz": 0.0
        }
        
        # Monitor de tasa de muestreo
        self._sample_timestamps = []

    @staticmethod
    def list_ports() -> List[Dict[str, str]]:
        """Lista todos los puertos COM disponibles en Windows."""
        ports = serial.tools.list_ports.comports()
        result = []
        for p in ports:
            result.append({
                "device": p.device,
                "description": p.description,
                "hwid": p.hwid,
                "is_arduino": "arduino" in p.description.lower() or "ch340" in p.description.lower() or "usb serial" in p.description.lower()
            })
        return result

    def connect(self, port: str, baudrate: int = 115200) -> Tuple[bool, str]:
        with self._lock:
            if self.is_connected:
                self.disconnect()
                
            self.port_name = port
            self.baudrate = baudrate
            self.is_synthetic_mode = False
            
            try:
                # Abrir puerto COM con timeout para no congelar
                self.serial_port = serial.Serial(
                    port=port,
                    baudrate=baudrate,
                    timeout=1.0,
                    write_timeout=1.0
                )
                
                # Reseteo DTR normal en Arduino Uno
                self.serial_port.dtr = False
                time.sleep(0.1)
                self.serial_port.dtr = True
                
                self.is_running = True
                self.is_connected = True
                self.stats["connection_state"] = "CONNECTING_WAITING_SYNC"
                
                # Iniciar hilo de lectura en segundo plano
                self._thread = threading.Thread(target=self._reader_loop, daemon=True)
                self._thread.start()
                return True, f"Conectado a {port} a {baudrate} baudios. Esperando sincronización inicial..."
            except Exception as e:
                self.is_connected = False
                self.stats["connection_state"] = "ERROR"
                self.stats["last_error"] = str(e)
                return False, f"Error al abrir {port}: {str(e)}"

    def start_synthetic_mode(self):
        """Inicia un emulador de hardware con el comportamiento exacto del firmware sketch_oct5a.ino"""
        with self._lock:
            if self.is_connected:
                self.disconnect()
            self.is_synthetic_mode = True
            self.is_running = True
            self.is_connected = True
            self.port_name = "SINTETICO_TEST_COM"
            self.stats["connection_state"] = "SYNTHETIC_ACTIVE"
            
            self._synthetic_thread = threading.Thread(target=self._synthetic_loop, daemon=True)
            self._synthetic_thread.start()

    def disconnect(self):
        with self._lock:
            self.is_running = False
            self.is_connected = False
            self.stats["connection_state"] = "DISCONNECTED"
            
            if self.serial_port and self.serial_port.is_open:
                try:
                    self.serial_port.close()
                except Exception:
                    pass
                self.serial_port = None
                
            self.is_synthetic_mode = False

    def _reader_loop(self):
        """Bucle de lectura en subproceso"""
        # Descartar primeros datos corruptos causados por el reinicio del Arduino
        time.sleep(1.5)
        if self.serial_port and self.serial_port.is_open:
            try:
                self.serial_port.reset_input_buffer()
            except Exception:
                pass
                
        buffer = ""
        while self.is_running and self.serial_port and self.serial_port.is_open:
            try:
                data = self.serial_port.readline()
                if not data:
                    continue
                    
                self.stats["bytes_read"] += len(data)
                line = data.decode("utf-8", errors="replace").strip()
                
                if line:
                    sample, err = self.parser.parse_line(line, origin="SERIAL_ARDUINO")
                    if sample:
                        self.last_valid_sample_time = time.time()
                        self.stats["connection_state"] = "CONNECTED_STREAMING"
                        self.stats["samples_received"] += 1
                        self._track_rate()
                        if self.on_sample_callback:
                            self.on_sample_callback(sample)
                    else:
                        self.stats["corrupt_lines"] += 1
                        self.stats["last_error"] = err
            except serial.SerialException as se:
                self.stats["connection_state"] = "DISCONNECTED_ERROR"
                self.stats["last_error"] = f"Desconexión física de puerto: {str(se)}"
                self.disconnect()
                break
            except Exception as e:
                self.stats["last_error"] = str(e)
                time.sleep(0.01)

    def _synthetic_loop(self):
        """Simula con precisión el bucle Arduino loop() de sketch_oct5a.ino con retardo de 15ms"""
        v_pot = 4.20
        v_filtrado = 0.0
        v_objetivo = 0.0
        nivel_pwm = 255.0
        modo_carga = True
        velocidad_rampa = 0.01
        factor_suavizado = 0.2
        cycle_counter = 0
        
        while self.is_running and self.is_synthetic_mode:
            # Alternar modo cada ~350 ciclos (~5.25 segundos)
            cycle_counter += 1
            if cycle_counter > 350:
                cycle_counter = 0
                modo_carga = not modo_carga
                
            # Generar curva objetivo (código Arduino exacto)
            if modo_carga:
                if v_objetivo < v_pot:
                    v_objetivo += velocidad_rampa
                elif v_objetivo > v_pot:
                    v_objetivo -= velocidad_rampa
            else:
                if v_objetivo > 0.0:
                    v_objetivo -= velocidad_rampa
                else:
                    v_objetivo = 0.0
                    
            # Simulación física de la respuesta del condensador ante PWM
            # Dinámica aproximada del circuito RC alimentado por PWM
            v_fuente_pwm = (nivel_pwm / 255.0) * 5.0
            # Condensador responde hacia el voltaje efectivo del MOSFET
            v_instantaneo = v_filtrado + (v_fuente_pwm - v_filtrado) * 0.04
            # Filtro exponencial Arduino
            v_filtrado = (factor_suavizado * v_instantaneo) + ((1.0 - factor_suavizado) * v_filtrado)
            
            # Controlador incremental del Arduino
            error = v_filtrado - v_objetivo
            nivel_pwm += (error * 25.0)
            if nivel_pwm > 255.0:
                nivel_pwm = 255.0
            elif nivel_pwm < 0.0:
                nivel_pwm = 0.0
                
            # Línea con formato exacto del firmware
            line = f"Min:0.0,Max:5.0,Límite_Pot:{v_pot:.2f},Curva_Objetivo:{v_objetivo:.2f},Voltaje_Real:{v_filtrado:.2f}"
            sample, err = self.parser.parse_line(line, origin="SINTETICO_TEST")
            if sample:
                self.last_valid_sample_time = time.time()
                self.stats["samples_received"] += 1
                self._track_rate()
                if self.on_sample_callback:
                    self.on_sample_callback(sample)
                    
            time.sleep(0.015) # 15 ms delay Arduino loop

    def _track_rate(self):
        now = time.monotonic()
        self._sample_timestamps.append(now)
        # Mantener últimos 1 segundo
        self._sample_timestamps = [t for t in self._sample_timestamps if now - t <= 1.0]
        self.stats["sample_rate_hz"] = len(self._sample_timestamps)

    def get_status(self) -> Dict[str, Any]:
        time_since_sample = time.time() - self.last_valid_sample_time if self.last_valid_sample_time > 0 else None
        return {
            "connected": self.is_connected,
            "port": self.port_name,
            "baudrate": self.baudrate,
            "is_synthetic": self.is_synthetic_mode,
            "connection_state": self.stats["connection_state"],
            "sample_rate_hz": round(self.stats["sample_rate_hz"], 1),
            "total_samples": self.stats["samples_received"],
            "corrupt_lines": self.stats["corrupt_lines"],
            "seconds_since_last_sample": round(time_since_sample, 2) if time_since_sample is not None else None,
            "last_error": self.stats["last_error"]
        }
