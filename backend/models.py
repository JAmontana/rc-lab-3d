"""
Modelos de datos normalizados para RC LAB 3D.
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
import time

class TelemetrySample(BaseModel):
    # Tiempos
    timestamp_host: float = Field(default_factory=time.time, description="Timestamp UNIX del host (segundos)")
    monotonic_time: float = Field(default_factory=time.monotonic, description="Tiempo monotónico del host (segundos)")
    
    # Señales recibidas del Arduino
    limite_pot: float = Field(..., description="Límite configurado por el potenciómetro A0 en Voltios")
    voltaje_objetivo: float = Field(..., description="Curva objetivo artificial generada por el firmware en Voltios")
    voltaje_real: float = Field(..., description="Voltaje filtrado leído por A1 en Voltios")
    min_val: float = Field(default=0.0, description="Rango mínimo reportado por firmware")
    max_val: float = Field(default=5.0, description="Rango máximo reportado por firmware")
    
    # Inferencia y cálculos en host
    error_seguimiento: float = Field(..., description="e(t) = voltaje_real - voltaje_objetivo (V)")
    porcentaje_escala: float = Field(..., description="(voltaje_real / 5.0) * 100")
    
    # Umbrales lógicos de los 4 LEDs
    led1_logico: bool = Field(False, description="Voltaje real >= 1.0 V")
    led2_logico: bool = Field(False, description="Voltaje real >= 2.0 V")
    led3_logico: bool = Field(False, description="Voltaje real >= 3.0 V")
    led4_logico: bool = Field(False, description="Voltaje real >= 4.0 V")
    
    # Estimación de modo de carga
    modo_estimado: str = Field("DESCONOCIDO", description="'CARGA', 'DESCARGA' o 'ESTABLE' inferido de la pendiente")
    confianza_modo: float = Field(0.0, description="Nivel de confianza de la inferencia (0.0 a 1.0)")
    
    # Metadatos de calidad y origen
    origen: str = Field("SERIAL_ARDUINO", description="'SERIAL_ARDUINO' o 'SINTETICO_TEST'")
    valida: bool = Field(True, description="True si la muestra pasó todas las comprobaciones de formato y límites")
    anomalia: bool = Field(False, description="True si supera 5.0V o presenta valores fuera de especificación nominal")
    mensaje_anomalia: Optional[str] = Field(None, description="Detalle de anomalía detectada")
    
    # Campos opcionales no transmitidos por protocolo actual
    arduino_time_ms: Optional[int] = Field(None, description="No disponible en protocolo v1")
    voltaje_adc_raw: Optional[float] = Field(None, description="No disponible en protocolo v1")
    pwm_duty: Optional[float] = Field(None, description="No disponible en protocolo v1")


class SessionAnnotation(BaseModel):
    timestamp: float = Field(default_factory=time.time)
    monotonic_time: float = Field(default_factory=time.monotonic)
    text: str
    categoria: str = Field("NOTA", description="'NOTA', 'EVENTO_CARGA', 'EVENTO_DESCARGA', 'DESCONEXION', 'RECONEXION'")


class CircuitParameters(BaseModel):
    capacitancia_nominal_f: float = Field(0.001, description="1000 uF = 0.001 F")
    capacitancia_medida_f: Optional[float] = Field(None, description="Capacitancia real medida con capacímetro si está disponible")
    resistencia_carga_ohm: Optional[float] = Field(None, description="Resistencia efectiva de ruta de carga")
    resistencia_descarga_ohm: Optional[float] = Field(None, description="Resistencia efectiva de ruta de descarga")
    fuente_vs_v: float = Field(5.0, description="Voltaje supuesto de alimentación Arduino")
    
    # Procedencia
    origen_capacitancia: str = Field("NOMINAL_1000uF", description="NOMINAL, MEDIDO o PENDIENTE")
    origen_resistencia_carga: str = Field("PENDIENTE_VERIFICAR", description="DECLARADO, MEDIDO o PENDIENTE_VERIFICAR")
    origen_resistencia_descarga: str = Field("PENDIENTE_VERIFICAR", description="DECLARADO, MEDIDO o PENDIENTE_VERIFICAR")


class SessionMetadata(BaseModel):
    session_id: str
    created_at_utc: str
    device_port: Optional[str] = None
    baudrate: int = 115200
    origen_datos: str = "SERIAL"
    parametros_circuito: CircuitParameters = Field(default_factory=CircuitParameters)
    total_muestras_validas: int = 0
    total_muestras_invalidas: int = 0
    anotaciones: List[SessionAnnotation] = Field(default_factory=list)
    desconexiones: List[Dict[str, float]] = Field(default_factory=list)
