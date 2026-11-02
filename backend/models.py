"""
Modelos de datos normalizados para RC LAB 3D.

El esquema v2 usa el protocolo R1 y conserva nombres explícitos para las
magnitudes físicas. Los archivos históricos v1 se conservan sin modificar y se
listan como sesiones heredadas.
"""
from typing import Optional, List, Dict, Any
import time

from pydantic import BaseModel, Field, field_validator, model_validator

PROTOCOLO_ACTUAL = "R1"
FIRMWARE_ACTUAL = "RC_LAB_3D/1.0"
SCHEMA_VERSION = 2


class CircuitParameters(BaseModel):
    """Parámetros eléctricos declarados o medidos del montaje.

    Los valores nominales no son una calibración. Cualquier tolerancia no
    conocida debe permanecer en None para que el análisis la marque como
    desconocida en lugar de inventar una incertidumbre.
    """

    capacitancia_f: float = Field(0.004, gt=0, description="Capacitancia equivalente del banco (F)")
    capacitancia_origen: str = Field("NOMINAL_4x1000uF", description="NOMINAL, MEDIDO o PENDIENTE")
    resistencia_carga_ohm: Optional[float] = Field(4700.0, gt=0, description="Resistencia de carga declarada (Ω)")
    resistencia_descarga_ohm: Optional[float] = Field(None, gt=0, description="Resistencia efectiva de descarga (Ω); None si no está verificada")
    resistencia_origen: str = Field("NOMINAL_4k7", description="NOMINAL, MEDIDO o PENDIENTE")
    voltaje_maximo_referencia_v: float = Field(15.64, gt=0, description="Máximo medible con el divisor y ADC de 5 V")
    divisor_r1_ohm: float = Field(1_000_000.0, gt=0)
    divisor_r2_ohm: float = Field(470_000.0, gt=0)
    adc_bits: int = Field(10, ge=8, le=24)
    vref_v: float = Field(5.0, gt=0, description="Hipótesis de referencia del ADC, no calibración certificada")
    tolerancia_r_pct: Optional[float] = Field(None, ge=0, le=100)
    tolerancia_c_pct: Optional[float] = Field(None, ge=0, le=100)
    tolerancia_vref_pct: Optional[float] = Field(None, ge=0, le=100)

    @model_validator(mode="after")
    def validar_divisor(self):
        if self.divisor_r1_ohm <= 0 or self.divisor_r2_ohm <= 0:
            raise ValueError("Las resistencias del divisor deben ser positivas")
        return self

    @property
    def ganancia_divisor(self) -> float:
        return (self.divisor_r1_ohm + self.divisor_r2_ohm) / self.divisor_r2_ohm

    def tau_carga_s(self) -> Optional[float]:
        if self.resistencia_carga_ohm is None or self.capacitancia_f <= 0:
            return None
        return self.resistencia_carga_ohm * self.capacitancia_f

    def tau_descarga_s(self) -> Optional[float]:
        if self.resistencia_descarga_ohm is None or self.capacitancia_f <= 0:
            return None
        return self.resistencia_descarga_ohm * self.capacitancia_f


class TelemetrySample(BaseModel):
    """Muestra normalizada de telemetría.

    `estado` procede del firmware en el protocolo R1. En protocolos heredados
    se infiere y se marca `protocolo` como LEGACY_*.
    """

    schema_version: int = SCHEMA_VERSION
    timestamp_host: float = Field(default_factory=time.time, description="Timestamp UNIX del host (s)")
    monotonic_time: float = Field(default_factory=time.monotonic, description="Tiempo monotónico del host (s)")
    device_time_ms: Optional[int] = Field(None, description="millis() del Arduino; None en protocolos heredados")
    protocolo: str = Field(PROTOCOLO_ACTUAL)
    firmware: str = Field(FIRMWARE_ACTUAL)
    origen: str = Field("SERIAL", description="SERIAL o SIMULACION")

    voltaje_tanque: float = Field(..., description="Voltaje del banco de condensadores (V)")
    voltaje_techo: float = Field(..., description="Voltaje techo seleccionado por el potenciómetro (V)")
    estado: str = Field("S", description="C, D o S")
    estado_confianza: float = Field(1.0, ge=0.0, le=1.0)
    pwm: Optional[float] = Field(None, ge=0, le=255, description="Valor PWM 0-255")
    adc_a0: Optional[int] = Field(None, ge=0, le=1023)
    adc_a1: Optional[int] = Field(None, ge=0, le=1023)

    # Estado lógico esperado de los LEDs, calculado con los umbrales del firmware.
    led_rojo: bool = False
    led_amarillo1: bool = False
    led_amarillo2: bool = False

    valida: bool = True
    anomalia: bool = False
    mensaje_anomalia: Optional[str] = None

    @field_validator("estado")
    @classmethod
    def validar_estado(cls, value: str) -> str:
        value = (value or "S").upper()
        if value not in {"C", "D", "S"}:
            return "S"
        return value


class SessionAnnotation(BaseModel):
    timestamp: float = Field(default_factory=time.time)
    monotonic_time: float = Field(default_factory=time.monotonic)
    text: str
    categoria: str = Field("NOTA", description="NOTA, EVENTO_CARGA, EVENTO_DESCARGA, DESCONEXION, RECONEXION")


class SessionEvent(BaseModel):
    timestamp: float = Field(default_factory=time.time)
    device_time_ms: Optional[int] = None
    tipo: str
    detalle: str
    voltaje_v: Optional[float] = None


class SessionMetadata(BaseModel):
    schema_version: int = SCHEMA_VERSION
    session_id: str
    created_at_utc: str
    ended_at_utc: Optional[str] = None
    device_port: Optional[str] = None
    baudrate: int = 9600
    origen_datos: str = "SERIAL"
    protocolo: str = PROTOCOLO_ACTUAL
    firmware: str = FIRMWARE_ACTUAL
    parametros_circuito: CircuitParameters = Field(default_factory=CircuitParameters)
    voltaje_techo_v: Optional[float] = None
    total_muestras: int = 0
    total_muestras_validas: int = 0
    total_muestras_invalidas: int = 0
    duracion_s: Optional[float] = None
    frecuencia_muestreo_hz: Optional[float] = None
    anotaciones: List[SessionAnnotation] = Field(default_factory=list)
    eventos: List[SessionEvent] = Field(default_factory=list)
    desconexiones: List[Dict[str, Any]] = Field(default_factory=list)
    advertencias: List[str] = Field(default_factory=list)
    resultados: Dict[str, Any] = Field(default_factory=dict)


class SessionSummary(BaseModel):
    active: bool = False
    session_id: Optional[str] = None
    origen: Optional[str] = None
    protocolo: Optional[str] = None
    samples_count: int = 0
    valid_samples: int = 0
    invalid_samples: int = 0
    elapsed_seconds: float = 0.0
    annotations_count: int = 0
    events_count: int = 0
    created_at: Optional[str] = None
    last_sample_time: Optional[float] = None
    rate_hz: Optional[float] = None
    voltaje_techo_v: Optional[float] = None
    estado: Optional[str] = None
