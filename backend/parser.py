"""
Parser serial robusto para el protocolo Arduino de RC LAB 3D.
Interpreta líneas con formato:
Min:0.0,Max:5.0,Límite_Pot:2.50,Curva_Objetivo:2.30,Voltaje_Real:2.10
Admite variaciones de acentos (Límite_Pot / Limite_Pot), orden arbitrario de claves,
espacios en blanco, caracteres Unicode, y descarta líneas corruptas o NaN/Inf.
"""
import math
import re
import time
from typing import Optional, Tuple, Dict
from backend.models import TelemetrySample

# Normalización de claves (sin tildes, minúsculas, sin espacios)
KEY_MAP = {
    "min": "min",
    "max": "max",
    "limite_pot": "limite_pot",
    "limitepot": "limite_pot",
    "límite_pot": "limite_pot",
    "límit_pot": "limite_pot",
    "curva_objetivo": "curva_objetivo",
    "curvaobjetivo": "curva_objetivo",
    "voltaje_real": "voltaje_real",
    "voltajereal": "voltaje_real",
    "voltaje": "voltaje_real"
}

def clean_key(key: str) -> str:
    cleaned = key.strip().lower()
    cleaned = cleaned.replace("í", "i").replace("á", "a").replace("é", "e").replace("ó", "o").replace("ú", "u")
    return KEY_MAP.get(cleaned, cleaned)


class SerialParser:
    def __init__(self):
        self.last_target_voltage: Optional[float] = None
        self.last_monotonic_time: Optional[float] = None
        self.stats = {
            "lines_received": 0,
            "lines_valid": 0,
            "lines_corrupt": 0,
            "last_error": None
        }

    def parse_line(self, line: str, origin: str = "SERIAL_ARDUINO") -> Tuple[Optional[TelemetrySample], Optional[str]]:
        """
        Analiza una línea recibida y retorna (TelemetrySample, error_str).
        Si la línea es inválida, retorna (None, motivo_error).
        """
        self.stats["lines_received"] += 1
        
        if not line:
            err = "Línea vacía recibida"
            self.stats["lines_corrupt"] += 1
            self.stats["last_error"] = err
            return None, err
            
        line_clean = line.strip()
        if not line_clean:
            err = "Línea con solo espacios en blanco"
            self.stats["lines_corrupt"] += 1
            self.stats["last_error"] = err
            return None, err
            
        # Segmentar pares clave:valor separados por coma
        tokens = line_clean.split(",")
        parsed_dict: Dict[str, float] = {}
        
        for token in tokens:
            token = token.strip()
            if not token:
                continue
            if ":" not in token:
                continue
            parts = token.split(":", 1)
            raw_key, raw_val = parts[0].strip(), parts[1].strip()
            norm_key = clean_key(raw_key)
            
            try:
                # Convertir a float
                val = float(raw_val)
                # Validar que no sea NaN ni Inf
                if math.isnan(val) or math.isinf(val):
                    err = f"Valor no numérico o infinito en clave '{raw_key}': {raw_val}"
                    self.stats["lines_corrupt"] += 1
                    self.stats["last_error"] = err
                    return None, err
                parsed_dict[norm_key] = val
            except ValueError:
                err = f"Formato numérico inválido en clave '{raw_key}': {raw_val}"
                self.stats["lines_corrupt"] += 1
                self.stats["last_error"] = err
                return None, err
                
        # Verificar campos esenciales obligatorios
        required = ["limite_pot", "curva_objetivo", "voltaje_real"]
        missing = [r for r in required if r not in parsed_dict]
        if missing:
            err = f"Faltan campos obligatorios en el protocolo: {missing}. Recibido: {list(parsed_dict.keys())}"
            self.stats["lines_corrupt"] += 1
            self.stats["last_error"] = err
            return None, err
            
        now_ts = time.time()
        now_mono = time.monotonic()
        
        v_real = parsed_dict["voltaje_real"]
        v_target = parsed_dict["curva_objetivo"]
        v_pot = parsed_dict["limite_pot"]
        v_min = parsed_dict.get("min", 0.0)
        v_max = parsed_dict.get("max", 5.0)
        
        # Validar rangos físicos esperados
        anomalia = False
        msj_anomalia = []
        
        if v_real < -0.2:
            anomalia = True
            msj_anomalia.append(f"Voltaje real negativo inesperado: {v_real:.3f}V")
        elif v_real > 5.2:
            anomalia = True
            msj_anomalia.append(f"Voltaje real supera 5.0V (+margen de tolerancia): {v_real:.3f}V")
            
        if v_pot < -0.2 or v_pot > 5.2:
            anomalia = True
            msj_anomalia.append(f"Lectura potenciómetro fuera de rango 0-5V: {v_pot:.3f}V")
            
        if v_target < -0.2 or v_target > 5.2:
            anomalia = True
            msj_anomalia.append(f"Curva objetivo fuera de rango 0-5V: {v_target:.3f}V")
            
        # Inferencia de modo (carga / descarga / estable) según la pendiente de voltajeObjetivo
        modo_estimado = "DESCONOCIDO"
        confianza_modo = 0.5
        
        if self.last_target_voltage is not None and self.last_monotonic_time is not None:
            dt = now_mono - self.last_monotonic_time
            if dt > 0.001:
                dv = v_target - self.last_target_voltage
                pendiente = dv / dt # V/s
                if pendiente > 0.05:
                    modo_estimado = "CARGA"
                    confianza_modo = min(0.95, 0.6 + abs(pendiente) * 0.1)
                elif pendiente < -0.05:
                    modo_estimado = "DESCARGA"
                    confianza_modo = min(0.95, 0.6 + abs(pendiente) * 0.1)
                else:
                    modo_estimado = "ESTABLE"
                    confianza_modo = 0.8
        
        self.last_target_voltage = v_target
        self.last_monotonic_time = now_mono
        
        # Error de seguimiento del controlador
        e_t = v_real - v_target
        # Porcentaje respecto a 5.0V
        pct_escala = max(0.0, min(100.0, (v_real / 5.0) * 100.0))
        
        # Umbrales lógicos de LEDs según firmware Arduino
        led1 = v_real >= 1.0
        led2 = v_real >= 2.0
        led3 = v_real >= 3.0
        led4 = v_real >= 4.0
        
        sample = TelemetrySample(
            timestamp_host=now_ts,
            monotonic_time=now_mono,
            limite_pot=round(v_pot, 3),
            voltaje_objetivo=round(v_target, 3),
            voltaje_real=round(v_real, 3),
            min_val=round(v_min, 2),
            max_val=round(v_max, 2),
            error_seguimiento=round(e_t, 3),
            porcentaje_escala=round(pct_escala, 1),
            led1_logico=led1,
            led2_logico=led2,
            led3_logico=led3,
            led4_logico=led4,
            modo_estimado=modo_estimado,
            confianza_modo=round(confianza_modo, 2),
            origen=origin,
            valida=True,
            anomalia=anomalia,
            mensaje_anomalia="; ".join(msj_anomalia) if msj_anomalia else None
        )
        
        self.stats["lines_valid"] += 1
        return sample, None
