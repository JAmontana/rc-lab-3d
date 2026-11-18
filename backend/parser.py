"""
Parser serial robusto para RC LAB 3D.

Protocolo principal R1:
    R1,<millis>,<voltaje_tanque>,<voltaje_techo>,<estado>,<pwm>,<adc_A0>,<adc_A1>

Protocolos heredados aceptados para migración:
    <voltaje_tanque>,<voltaje_techo>
    Min:0.0,Max:5.0,Límite_Pot:2.50,Curva_Objetivo:2.30,Voltaje_Real:2.10

El parser no inventa el estado en R1: lo toma del firmware. En los protocolos
heredados lo infiere a partir de la pendiente y lo marca como tal.
"""
from __future__ import annotations

import math
import re
import time
from collections import deque
from statistics import median
from typing import Dict, Optional, Tuple

from backend.models import FIRMWARE_ACTUAL, PROTOCOLO_ACTUAL, TelemetrySample
from backend.protocol import (
    PROTOCOLO_LEGACY_2F,
    PROTOCOLO_LEGACY_V1,
    LED_ROJO_UMBRAL,
    LED_AMARILLO1_UMBRAL,
    LED_AMARILLO2_UMBRAL,
    MAX_TANK_V,
    MAX_TECHO_V,
)

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
    "voltaje": "voltaje_real",
}


def clean_key(key: str) -> str:
    cleaned = key.strip().lower()
    cleaned = (
        cleaned.replace("í", "i")
        .replace("á", "a")
        .replace("é", "e")
        .replace("ó", "o")
        .replace("ú", "u")
    )
    return KEY_MAP.get(cleaned, cleaned)


class SerialParser:
    def __init__(self) -> None:
        self.last_target_voltage: Optional[float] = None
        self.last_monotonic_time: Optional[float] = None
        self.last_legacy_voltage: Optional[float] = None
        self.last_legacy_monotonic: Optional[float] = None
        self._techo_window: deque[float] = deque(maxlen=5)
        self._techo_rejected: deque[float] = deque(maxlen=20)
        self.stats = {
            "lines_received": 0,
            "lines_valid": 0,
            "lines_corrupt": 0,
            "lines_ignored": 0,
            "techo_rechazados": 0,
            "last_techo_rechazado": None,
            "last_error": None,
            "last_protocol": None,
        }

    # ------------------------------------------------------------------
    # API pública
    # ------------------------------------------------------------------
    def parse_line(
        self, line: str, origin: str = "SERIAL"
    ) -> Tuple[Optional[TelemetrySample], Optional[str]]:
        self.stats["lines_received"] += 1

        if line is None:
            return self._error("Línea nula recibida")

        if len(line) > 1024:
            return self._error("Línea excesivamente larga; se descarta")

        line_clean = line.strip()
        if not line_clean:
            return self._error("Línea vacía o con solo espacios en blanco")

        # El firmware puede enviar una cabecera informativa al arrancar.
        if line_clean.startswith("#"):
            self.stats["lines_ignored"] += 1
            return None, None

        try:
            if line_clean.upper().startswith(PROTOCOLO_ACTUAL + ","):
                sample = self._parse_r1(line_clean, origin)
            elif ":" in line_clean:
                sample = self._parse_legacy_labeled(line_clean, origin)
            elif "," in line_clean:
                sample = self._parse_legacy_two_fields(line_clean, origin)
            else:
                return self._error(f"Trama no reconocida: {line_clean[:120]}")

            if sample is None:
                return None, self.stats["last_error"]

            self.stats["lines_valid"] += 1
            self.stats["last_protocol"] = sample.protocolo
            return sample, None

        except ValueError as exc:
            return self._error(str(exc))
        except Exception as exc:  # pragma: no cover - defensa ante entradas raras
            return self._error(f"Error inesperado al analizar trama: {exc}")

    # ------------------------------------------------------------------
    # Protocolo R1
    # ------------------------------------------------------------------
    def _parse_r1(self, line: str, origin: str) -> Optional[TelemetrySample]:
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 8:
            raise ValueError(
                f"R1 requiere 8 campos; se recibieron {len(parts)}: {line[:120]}"
            )

        _, raw_millis, raw_tank, raw_techo, raw_estado, raw_pwm, raw_a0, raw_a1 = parts
        if not raw_millis or not raw_tank or not raw_techo:
            raise ValueError("Campos vacíos en trama R1")

        try:
            millis = int(raw_millis)
        except ValueError:
            raise ValueError(f"millis no entero en R1: {raw_millis}")

        tank = self._finite_float(raw_tank, "voltaje_tanque")
        techo = self._finite_float(raw_techo, "voltaje_techo")

        estado = raw_estado.upper()
        if estado not in {"C", "D", "S"}:
            raise ValueError(f"Estado R1 inválido: {raw_estado!r}; se esperaba C, D o S")

        try:
            pwm = int(raw_pwm)
            adc_a0 = int(raw_a0)
            adc_a1 = int(raw_a1)
        except ValueError:
            raise ValueError("pwm o ADC no enteros en trama R1")

        if not (0 <= millis <= 0xFFFFFFFF):
            raise ValueError(f"millis fuera de rango uint32: {millis}")
        if not (0.0 <= tank <= 40.0):
            raise ValueError(f"Voltaje de tanque fuera de rango: {tank}")
        if not (0.0 <= techo <= 5.5):
            raise ValueError(f"Voltaje techo fuera de rango: {techo}")
        if not (0 <= pwm <= 255):
            raise ValueError(f"PWM fuera de rango 0-255: {pwm}")
        if not (0 <= adc_a0 <= 1023) or not (0 <= adc_a1 <= 1023):
            raise ValueError(f"ADC fuera de rango 0-1023: A0={adc_a0}, A1={adc_a1}")

        anomaly = self._range_warnings(tank, techo)

        return self._build_sample(
            origin=origin,
            protocolo=PROTOCOLO_ACTUAL,
            device_time_ms=millis,
            tank=tank,
            techo=self._filter_ceiling(techo),
            estado=estado,
            estado_confianza=1.0,
            pwm=float(pwm),
            adc_a0=adc_a0,
            adc_a1=adc_a1,
            anomaly=anomaly,
        )

    # ------------------------------------------------------------------
    # Protocolos heredados
    # ------------------------------------------------------------------
    def _parse_legacy_two_fields(self, line: str, origin: str) -> Optional[TelemetrySample]:
        parts = [p.strip() for p in line.split(",")]
        if len(parts) != 2:
            raise ValueError(
                f"Protocolo heredado de dos campos requiere 2 valores; se recibieron {len(parts)}"
            )

        tank = self._finite_float(parts[0], "voltaje_tanque")
        techo = self._finite_float(parts[1], "voltaje_techo")
        if not (0.0 <= tank <= 40.0):
            raise ValueError(f"Voltaje de tanque fuera de rango: {tank}")
        if not (0.0 <= techo <= 5.5):
            raise ValueError(f"Voltaje techo fuera de rango: {techo}")

        now = time.monotonic()
        estado, confianza = self._inferir_estado(tank, now)
        millis = int(now * 1000.0) & 0xFFFFFFFF

        return self._build_sample(
            origin=origin,
            protocolo=PROTOCOLO_LEGACY_2F,
            device_time_ms=millis,
            tank=tank,
            techo=self._filter_ceiling(techo),
            estado=estado,
            estado_confianza=confianza,
            pwm=None,
            adc_a0=None,
            adc_a1=None,
            anomaly=self._range_warnings(tank, techo),
        )

    def _parse_legacy_labeled(self, line: str, origin: str) -> Optional[TelemetrySample]:
        parsed: Dict[str, float] = {}
        for token in line.split(","):
            token = token.strip()
            if not token or ":" not in token:
                continue
            raw_key, raw_val = token.split(":", 1)
            key = clean_key(raw_key)
            parsed[key] = self._finite_float(raw_val.strip(), raw_key)

        required = ["limite_pot", "curva_objetivo", "voltaje_real"]
        missing = [key for key in required if key not in parsed]
        if missing:
            raise ValueError(
                f"Faltan campos obligatorios del protocolo heredado: {missing}"
            )

        tank = parsed["voltaje_real"]
        techo = parsed["limite_pot"]
        now = time.monotonic()
        estado, confianza = self._inferir_estado(tank, now)

        return self._build_sample(
            origin=origin,
            protocolo=PROTOCOLO_LEGACY_V1,
            device_time_ms=int(now * 1000.0) & 0xFFFFFFFF,
            tank=tank,
            techo=self._filter_ceiling(techo),
            estado=estado,
            estado_confianza=confianza,
            pwm=None,
            adc_a0=None,
            adc_a1=None,
            anomaly=self._range_warnings(tank, techo),
        )

    # ------------------------------------------------------------------
    # Utilidades
    # ------------------------------------------------------------------
    @staticmethod
    def _finite_float(raw: str, field: str) -> float:
        try:
            value = float(raw)
        except (TypeError, ValueError):
            raise ValueError(f"Valor numérico inválido en {field}: {raw!r}")
        if not math.isfinite(value):
            raise ValueError(f"Valor NaN o infinito en {field}: {raw!r}")
        return value

    def _inferir_estado(self, tank: float, now: float) -> Tuple[str, float]:
        estado = "S"
        confianza = 0.5
        if self.last_legacy_voltage is not None and self.last_legacy_monotonic is not None:
            dt = now - self.last_legacy_monotonic
            if dt > 0.001:
                pendiente = (tank - self.last_legacy_voltage) / dt
                if pendiente > 0.02:
                    estado = "C"
                    confianza = min(0.95, 0.6 + abs(pendiente) * 0.1)
                elif pendiente < -0.02:
                    estado = "D"
                    confianza = min(0.95, 0.6 + abs(pendiente) * 0.1)
                else:
                    estado = "S"
                    confianza = 0.8
        self.last_legacy_voltage = tank
        self.last_legacy_monotonic = now
        return estado, round(confianza, 2)

    def _filter_ceiling(self, techo: float) -> float:
        """Mediana móvil de 5 muestras para rechazar picos aislados del techo.

        El valor bruto se registra en ``stats`` cuando se aparta más de 0,75 V
        de la mediana; no se reemplaza por 5 V ni se descarta la muestra de
        telemetría completa.
        """
        raw = float(techo)
        self._techo_window.append(raw)
        filtered = float(median(self._techo_window))
        if len(self._techo_window) >= 3 and abs(raw - filtered) > 0.75:
            self.stats["techo_rechazados"] += 1
            self.stats["last_techo_rechazado"] = raw
            self._techo_rejected.append(raw)
        return filtered

    @staticmethod
    def _range_warnings(tank: float, techo: float) -> Optional[str]:
        warnings = []
        if tank > MAX_TANK_V:
            warnings.append(
                f"Voltaje de tanque {tank:.3f} V supera el máximo nominal de {MAX_TANK_V:.1f} V"
            )
        if tank > 15.7:
            warnings.append(
                "Voltaje de tanque fuera del rango medible del divisor 1 M/470 k con ADC de 5 V"
            )
        if techo < -0.05 or techo > MAX_TECHO_V + 0.2:
            warnings.append(f"Voltaje techo fuera de 0-{MAX_TECHO_V:.1f} V: {techo:.3f} V")
        return "; ".join(warnings) if warnings else None

    def _build_sample(
        self,
        *,
        origin: str,
        protocolo: str,
        device_time_ms: Optional[int],
        tank: float,
        techo: float,
        estado: str,
        estado_confianza: float,
        pwm: Optional[float],
        adc_a0: Optional[int],
        adc_a1: Optional[int],
        anomaly: Optional[str],
    ) -> TelemetrySample:
        leds = self._leds(tank, techo)
        return TelemetrySample(
            timestamp_host=time.time(),
            monotonic_time=time.monotonic(),
            device_time_ms=device_time_ms,
            protocolo=protocolo,
            firmware=FIRMWARE_ACTUAL,
            origen=origin,
            voltaje_tanque=round(tank, 4),
            voltaje_techo=round(techo, 4),
            estado=estado,
            estado_confianza=estado_confianza,
            pwm=pwm,
            adc_a0=adc_a0,
            adc_a1=adc_a1,
            led_rojo=leds["rojo"],
            led_amarillo1=leds["amarillo1"],
            led_amarillo2=leds["amarillo2"],
            valida=True,
            anomalia=bool(anomaly),
            mensaje_anomalia=anomaly,
        )

    @staticmethod
    def _leds(tank: float, techo: float) -> Dict[str, bool]:
        if techo <= 0.05:
            return {"rojo": False, "amarillo1": False, "amarillo2": False}
        return {
            "rojo": tank >= techo * LED_ROJO_UMBRAL,
            "amarillo1": tank >= techo * LED_AMARILLO1_UMBRAL,
            "amarillo2": tank >= techo * LED_AMARILLO2_UMBRAL,
        }

    def _error(self, message: str) -> Tuple[None, str]:
        self.stats["lines_corrupt"] += 1
        self.stats["last_error"] = message
        return None, message
