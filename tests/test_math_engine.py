"""Pruebas del motor matemático RC.

Cubren ecuaciones, puntos característicos, tiempo del dispositivo, segmentos,
interpolación del cruce de tau, ajuste, incertidumbre y simulación.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from backend.math_engine import (
    TAU_MAX_S,
    analisis_incertidumbre,
    analizar_sesion,
    ajustar_exponencial_rc,
    calcular_tau_teorica,
    detectar_segmentos,
    interpolar_cruce,
    modelo_carga_rc,
    modelo_descarga_rc,
    modelo_general_rc,
    punto_tau_carga,
    punto_tau_descarga,
    simular_circuito_rc,
    unwrap_device_time_ms,
)
from backend.models import CircuitParameters, TelemetrySample
from backend.protocol import FACTOR_TAU_CARGA, FACTOR_TAU_DESCARGA


# ---------------------------------------------------------------------------
# Utilidades de datos sintéticos
# ---------------------------------------------------------------------------
def _sample(voltage: float, state: str, t_ms: int, ceiling: float = 4.0) -> TelemetrySample:
    return TelemetrySample(
        voltaje_tanque=float(voltage),
        voltaje_techo=float(ceiling),
        estado=state,
        device_time_ms=int(t_ms),
    )


def _charge_curve(tau: float = 2.0, vf: float = 4.0, duration: float = 10.0, dt: float = 0.1):
    n = int(round(duration / dt))
    return [(dt * i, vf * (1.0 - math.exp(-(dt * i) / tau))) for i in range(n + 1)]


def _discharge_curve(tau: float = 2.0, v0: float = 4.0, duration: float = 10.0, dt: float = 0.1):
    n = int(round(duration / dt))
    return [(dt * i, v0 * math.exp(-(dt * i) / tau)) for i in range(n + 1)]


def _full_session(tau: float = 2.0, vf: float = 4.0) -> list[TelemetrySample]:
    """Carga completa, cola estable, descarga completa y cola estable."""
    samples: list[TelemetrySample] = []
    t = 0.0
    dt = 0.1

    for _, voltage in _charge_curve(tau=tau, vf=vf):
        samples.append(_sample(voltage, "C", round(t * 1000)))
        t += dt
    for _ in range(6):
        samples.append(_sample(vf, "S", round(t * 1000)))
        t += dt
    for _, voltage in _discharge_curve(tau=tau, v0=vf):
        samples.append(_sample(voltage, "D", round(t * 1000)))
        t += dt
    for _ in range(6):
        samples.append(_sample(0.0, "S", round(t * 1000)))
        t += dt
    return samples


# ---------------------------------------------------------------------------
# Modelos y puntos característicos
# ---------------------------------------------------------------------------
def test_calcular_tau_con_parametros_conocidos():
    tau, error = calcular_tau_teorica(1000.0, 0.001)
    assert error is None
    assert tau == pytest.approx(1.0)


@pytest.mark.parametrize(
    "r, c",
    [(None, 0.001), (1000.0, None), (0.0, 0.001), (1000.0, 0.0), (-5.0, 0.001)],
)
def test_calcular_tau_parametros_invalidos(r, c):
    tau, error = calcular_tau_teorica(r, c)
    assert tau is None
    assert error


def test_modelo_carga_rc_en_origen_y_asintota():
    t = np.array([0.0, 1.0, 10.0])
    v = modelo_carga_rc(t, 0.0, 5.0, 1.0)
    assert v[0] == pytest.approx(0.0)
    assert v[1] == pytest.approx(5.0 * (1 - math.exp(-1)))
    # A 10 tau la exponencial aún difiere de la asíntota en 2,3·10^-4.
    assert v[2] == pytest.approx(5.0, abs=1e-3)


def test_modelo_descarga_rc_en_origen_y_asintota():
    t = np.array([0.0, 1.0, 10.0])
    v = modelo_descarga_rc(t, 5.0, 2.0, 1.0)
    assert v[0] == pytest.approx(5.0)
    assert v[1] == pytest.approx(2.0 + 3.0 * math.exp(-1))
    assert v[2] == pytest.approx(2.0, abs=1e-3)


def test_modelo_general_es_equivalente_en_carga_y_descarga():
    t = np.array([0.0, 0.5, 2.0, 8.0])
    np.testing.assert_allclose(modelo_general_rc(t, 0.0, 4.0, 2.0), modelo_carga_rc(t, 0.0, 4.0, 2.0))
    np.testing.assert_allclose(modelo_general_rc(t, 4.0, 0.0, 2.0), modelo_descarga_rc(t, 4.0, 0.0, 2.0))


def test_punto_tau_carga_es_63_212_por_ciento():
    point = punto_tau_carga(0.0, 4.0)
    assert point["porcentaje_variacion"] == pytest.approx(63.21205588285577, abs=1e-9)
    assert point["voltaje_v"] == pytest.approx(4.0 * FACTOR_TAU_CARGA)
    assert point["factor"] == pytest.approx(FACTOR_TAU_CARGA)


def test_punto_tau_descarga_es_36_788_por_ciento_restante():
    point = punto_tau_descarga(4.0, 0.0)
    assert point["porcentaje_restante"] == pytest.approx(36.787944117144235, abs=1e-9)
    assert point["voltaje_v"] == pytest.approx(4.0 * FACTOR_TAU_DESCARGA)
    assert point["factor"] == pytest.approx(FACTOR_TAU_DESCARGA)


# ---------------------------------------------------------------------------
# Tiempo del dispositivo
# ---------------------------------------------------------------------------
def test_unwrap_device_time_normal():
    times = unwrap_device_time_ms([1000, 1100, 1200, 1500])
    np.testing.assert_allclose(times, [0.0, 0.1, 0.2, 0.5])


def test_unwrap_device_time_desbordamiento_uint32():
    times = unwrap_device_time_ms([4294967295, 5, 105])
    np.testing.assert_allclose(times, [0.0, 0.006, 0.106])


def test_unwrap_device_time_reinicio_devuelve_vacio():
    assert len(unwrap_device_time_ms([1000, 1500, 100, 200])) == 0


def test_unwrap_device_time_vacio():
    assert len(unwrap_device_time_ms([])) == 0


# ---------------------------------------------------------------------------
# Segmentos e interpolación
# ---------------------------------------------------------------------------
def test_interpolar_cruce_ascendente_interpola_entre_muestras():
    times = np.arange(0, 10, dtype=float)
    values = np.arange(0, 10, dtype=float)
    crossing = interpolar_cruce(times, values, 4.5)
    assert crossing is not None
    assert crossing["tiempo_s"] == pytest.approx(4.5)
    assert crossing["fraccion"] == pytest.approx(0.5, abs=1e-6)


def test_interpolar_cruce_descendente():
    times = np.arange(0, 10, dtype=float)
    values = np.linspace(5.0, -5.0, 10)
    crossing = interpolar_cruce(times, values, 2.5)
    assert crossing is not None
    assert 2.0 < crossing["tiempo_s"] < 3.0


def test_interpolar_cruce_exige_confirmacion_posterior():
    times = np.arange(0, 8, dtype=float)
    values = np.array([0.0, 0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0])
    assert interpolar_cruce(times, values, 4.0) is None


def test_interpolar_cruce_datos_insuficientes():
    assert interpolar_cruce(np.array([0.0, 1.0]), np.array([0.0, 1.0]), 0.5) is None


def test_detectar_segmentos_separa_carga_y_descarga():
    segments = detectar_segmentos(_full_session())
    modes = [segment["modo"] for segment in segments]
    assert modes == ["C", "D"]
    assert all(segment["num_muestras"] >= 8 for segment in segments)
    assert segments[0]["cola_idx"] > segments[0]["fin_idx"]


def test_detectar_segmentos_sin_estados_cd():
    samples = [_sample(1.0, "S", i * 100) for i in range(20)]
    assert detectar_segmentos(samples) == []


# ---------------------------------------------------------------------------
# Ajuste exponencial
# ---------------------------------------------------------------------------
def test_ajuste_sintetico_carga_recupera_tau():
    points = _charge_curve(tau=1.5, vf=4.0, duration=7.0)
    times = [p[0] for p in points]
    values = [p[1] for p in points]
    result = ajustar_exponencial_rc(times, values, modo="CARGA")
    assert result["valido"] is True
    assert result["tau_experimental_s"] == pytest.approx(1.5, rel=0.02)
    assert result["r2"] > 0.999
    assert result["calidad"] == "excelente"
    assert len(result["residuos"]) == len(times)
    assert len(result["t_relativo"]) == len(times)


def test_ajuste_sintetico_descarga_recupera_tau():
    points = _discharge_curve(tau=1.5, v0=4.0, duration=7.0)
    result = ajustar_exponencial_rc(
        [p[0] for p in points], [p[1] for p in points], modo="DESCARGA"
    )
    assert result["valido"] is True
    assert result["tau_experimental_s"] == pytest.approx(1.5, rel=0.02)
    assert result["r2"] > 0.999


def test_ajuste_datos_insuficientes():
    result = ajustar_exponencial_rc([0.0, 1.0], [0.0, 1.0], modo="CARGA")
    assert result["valido"] is False
    assert "insuficientes" in result["motivo"]


def test_ajuste_sin_variacion():
    times = np.linspace(0, 5, 30).tolist()
    result = ajustar_exponencial_rc(times, [2.5] * 30, modo="CARGA")
    assert result["valido"] is False
    assert "variación" in result["motivo"].lower()


def test_ajuste_longitudes_distintas():
    result = ajustar_exponencial_rc([0.0] * 10, [0.0] * 9, modo="CARGA")
    assert result["valido"] is False
    assert "longitudes" in result["motivo"]


def test_ajuste_rechaza_nan():
    times = np.linspace(0, 5, 20).tolist()
    values = [float("nan")] * 20
    result = ajustar_exponencial_rc(times, values, modo="CARGA")
    assert result["valido"] is False
    assert "NaN" in result["motivo"]


# ---------------------------------------------------------------------------
# Análisis completo de sesión
# ---------------------------------------------------------------------------
def test_analizar_sesion_sintetica_detecta_tau_y_series_crudas():
    params = CircuitParameters(
        capacitancia_f=0.004,
        resistencia_carga_ohm=500.0,
        resistencia_descarga_ohm=500.0,
    )
    result = analizar_sesion(_full_session(tau=2.0, vf=4.0), params)
    assert result["valido"] is True
    assert result["tiempo_fuente"] == "device_millis"
    assert result["num_muestras"] > 200
    assert len(result["segmentos"]) == 2

    charge, discharge = result["segmentos"]
    assert charge["modo"] == "CARGA"
    assert discharge["modo"] == "DESCARGA"
    assert charge["tau_teorica_s"] == pytest.approx(2.0)
    assert discharge["tau_teorica_s"] == pytest.approx(2.0)
    # La mediana de las 3 primeras muestras y la interpolación introducen un
    # sesgo pequeño y real: el ajuste recupera τ = 2,102 s para τteo = 2 s.
    assert charge["tau_experimental_s"] == pytest.approx(2.102, abs=0.05)
    assert discharge["tau_experimental_s"] == pytest.approx(2.102, abs=0.05)
    assert charge["ajuste"]["valido"] is True
    assert charge["ajuste"]["r2"] > 0.999
    assert len(charge["tiempo_s"]) == charge["num_muestras"]
    assert len(charge["voltaje_v"]) == charge["num_muestras"]
    assert charge["tiempo_s"][0] == pytest.approx(0.0)
    assert charge["error_rel_pct"] == pytest.approx(5.085, abs=0.2)
    assert charge["punto_tau"]["voltaje_v"] == pytest.approx(charge["umbral_tau_v"])
    assert charge["incertidumbre"]["incertidumbre_temporal_s"] is not None
    assert result["advertencias"] == []


def test_analizar_sesion_sin_estados_no_inventa_segmentos():
    samples = [_sample(1.0, "S", i * 100) for i in range(30)]
    result = analizar_sesion(samples)
    assert result["valido"] is False
    assert result["segmentos"] == []
    assert any("No se detectaron" in warning for warning in result["advertencias"])


def test_analizar_sesion_muestras_insuficientes():
    result = analizar_sesion([_sample(0.0, "C", 0), _sample(1.0, "C", 100)])
    assert result["valido"] is False
    assert "insuficientes" in result["motivo"].lower()


def test_analizar_sesion_intervalo_demasiado_corto():
    result = analizar_sesion(_full_session(), start_s=0.0, end_s=0.3)
    assert result["valido"] is False
    assert "menos de 8" in result["motivo"]


def test_analizar_sesion_usa_host_si_no_hay_millis():
    samples = [
        TelemetrySample(
            voltaje_tanque=voltage,
            voltaje_techo=4.0,
            estado="C",
            device_time_ms=None,
            monotonic_time=100.0 + t,
        )
        for t, voltage in _charge_curve(tau=2.0, vf=4.0, duration=10.0)
    ]
    result = analizar_sesion(samples)
    assert result["tiempo_fuente"] == "host_monotonic"
    assert any("tiempo monotónico" in warning.lower() for warning in result["advertencias"])


def test_analizar_sesion_rechaza_variacion_insuficiente():
    samples = []
    for i in range(30):
        samples.append(_sample(2.0 + (0.001 if i % 2 else 0.0), "C", i * 100))
    result = analizar_sesion(samples)
    assert result["valido"] is True
    assert result["segmentos"][0]["tau_experimental_s"] is None
    assert "Variación" in result["segmentos"][0]["motivo"]


def test_analizar_sesion_con_parametros_de_descarga_ausentes():
    params = CircuitParameters(resistencia_descarga_ohm=None)
    result = analizar_sesion(_full_session(), params)
    assert result["valido"] is True
    discharge = [s for s in result["segmentos"] if s["modo"] == "DESCARGA"][0]
    assert discharge["tau_teorica_s"] is None
    assert discharge["error_rel_pct"] is None


# ---------------------------------------------------------------------------
# Incertidumbre
# ---------------------------------------------------------------------------
def test_incertidumbre_con_tolerancias_conocidas():
    result = analisis_incertidumbre(
        tau_exp=2.0,
        tau_teo=2.0,
        params=CircuitParameters(tolerancia_r_pct=5.0, tolerancia_c_pct=20.0),
        sample_period_s=0.1,
    )
    assert result["error_relativo_tau_pct"] == pytest.approx(0.0)
    assert result["diferencia_absoluta_tau_s"] == pytest.approx(0.0)
    assert result["incertidumbre_tau_teorica_s"] == pytest.approx(0.238, abs=0.002)
    assert result["incertidumbre_temporal_s"] == pytest.approx(0.1 / math.sqrt(12), abs=1e-6)
    assert result["adc_resolucion_mv"] == pytest.approx(5.0 / 1023 * 1000)


def test_incertidumbre_sin_tolerancias_no_inventa_valores():
    result = analisis_incertidumbre(2.1, 2.0)
    assert result["incertidumbre_tau_teorica_s"] is None
    assert result["error_relativo_tau_pct"] == pytest.approx(5.0)
    nombres = {c["nombre"]: c for c in result["componentes"]}
    assert nombres["R y C (tau teórico)"]["valor"] is None
    assert nombres["Referencia ADC"]["valor"] is None


def test_incertidumbre_sin_tau_teorica():
    result = analisis_incertidumbre(1.0, None)
    assert result["error_relativo_tau_pct"] is None
    assert result["diferencia_absoluta_tau_s"] is None


# ---------------------------------------------------------------------------
# Simulación
# ---------------------------------------------------------------------------
def test_simulacion_carga():
    result = simular_circuito_rc("CARGA", 1000.0, 0.001, 0.0, 5.0, 5.0, num_puntos=101)
    assert result["valido"] is True
    assert result["etiqueta"] == "SIMULACION_TEORICA_IDEAL"
    assert result["tau_segundos"] == pytest.approx(1.0)
    assert result["voltaje"][0] == pytest.approx(0.0)
    assert result["voltaje"][-1] > 4.9
    assert result["punto_tau"]["voltaje_v"] == pytest.approx(5.0 * FACTOR_TAU_CARGA)
    assert len(result["tiempo"]) == 101
    assert len(result["energia_j"]) == 101


def test_simulacion_descarga():
    result = simular_circuito_rc("DESCARGA", 1000.0, 0.001, 5.0, 0.0, 5.0, num_puntos=101)
    assert result["valido"] is True
    assert result["voltaje"][0] == pytest.approx(5.0)
    assert result["voltaje"][-1] < 0.1
    assert result["punto_tau"]["voltaje_v"] == pytest.approx(5.0 * FACTOR_TAU_DESCARGA)


def test_simulacion_tiempo_invalido():
    result = simular_circuito_rc("CARGA", 1000.0, 0.001, 0.0, 5.0, 0.0)
    assert result["valido"] is False
    assert "positivo" in result["error"]


def test_simulacion_parametros_invalidos():
    result = simular_circuito_rc("CARGA", 0.0, 0.001, 0.0, 5.0, 1.0)
    assert result["valido"] is False
    assert result["error"]


def test_simulacion_limita_numero_de_puntos():
    result = simular_circuito_rc("CARGA", 1000.0, 0.001, 0.0, 5.0, 1.0, num_puntos=1)
    assert result["valido"] is True
    assert len(result["tiempo"]) == 2
    result = simular_circuito_rc("CARGA", 1000.0, 0.001, 0.0, 5.0, 1.0, num_puntos=999999)
    assert len(result["tiempo"]) == 5000
