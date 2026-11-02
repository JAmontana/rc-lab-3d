"""
Pruebas unitarias para el motor matemático RC (math_engine).
Incluye simulación ideal, ajuste exponencial, cálculo de tau e incertidumbre.
"""
import pytest
from backend.math_engine import (
    simular_circuito_rc,
    ajustar_exponencial_rc,
    analisis_incertidumbre,
    calcular_tau_teorica,
    modelo_carga_rc,
    modelo_descarga_rc,
)

def test_calcular_tau_con_parametros_conocidos():
    tau, err = calcular_tau_teorica(1000.0, 0.001)
    assert err is None
    assert abs(tau - 1.0) < 1e-9  # 1000 * 0.001 = 1 s

def test_calcular_tau_parametros_ausentes():
    tau, err = calcular_tau_teorica(None, 0.001)
    assert tau is None
    assert "Faltan parámetros" in err

def test_modelo_carga_rc():
    import numpy as np
    v = modelo_carga_rc(np.array([0.0]), 5.0, 0.0, 1.0)
    assert abs(v[0] - 5.0 + 5.0 * np.exp(0)) < 1e-9  # V_s + (V_0 - V_s) = V_0

def test_modelo_descarga_rc():
    import numpy as np
    v = modelo_descarga_rc(np.array([0.0]), 5.0, 1.0)
    assert abs(v[0] - 5.0) < 1e-9

def test_simulacion_carga():
    res = simular_circuito_rc("CARGA", 1000.0, 0.001, 5.0, 0.0, 5.0, num_puntos=100)
    assert res["valido"] is True
    assert res["etiqueta"] == "SIMULACION_TEORICA_IDEAL"
    assert abs(res["tau_segundos"] - 1.0) < 1e-6
    # Voltaje final debe acercarse a Vs
    assert res["voltaje"][-1] > 4.0

def test_simulacion_descarga():
    res = simular_circuito_rc("DESCARGA", 1000.0, 0.001, 5.0, 5.0, 5.0, num_puntos=100)
    assert res["valido"] is True
    assert res["voltaje"][-1] < 1.0

def test_ajuste_con_datos_sinteticos_carga():
    import numpy as np
    from backend.math_engine import calcular_tau_teorica, analisis_incertidumbre
    t = np.linspace(0, 5, 50).tolist()
    v = [5.0 * (1 - np.exp(-ti / 1.0)) for ti in t]
    res = ajustar_exponencial_rc(t, v, modo="CARGA")
    assert res["valido"] is True
    assert abs(res["tau_experimental_s"] - 1.0) < 0.2  # tolerancia razonable
    assert res["r2"] > 0.99

    # Verificar contra teórica por separado
    tau_teo, _ = calcular_tau_teorica(1000.0, 0.001)
    unc = analisis_incertidumbre(res["tau_experimental_s"], tau_teo)
    assert unc["error_relativo_tau_pct"] is not None

def test_ajuste_con_datos_sinteticos_descarga():
    import numpy as np
    from backend.math_engine import calcular_tau_teorica
    t = np.linspace(0, 5, 50).tolist()
    v = [5.0 * np.exp(-ti / 1.0) for ti in t]
    res = ajustar_exponencial_rc(t, v, modo="DESCARGA")
    assert res["valido"] is True
    assert abs(res["tau_experimental_s"] - 1.0) < 0.2
    assert res["r2"] > 0.99

def test_ajuste_datos_insuficientes():
    res = ajustar_exponencial_rc([0.0, 1.0], [0.0, 1.0], modo="CARGA")
    assert res["valido"] is False
    assert "insuficientes" in res["motivo"]

def test_ajuste_sin_variacion_de_voltaje():
    import numpy as np
    t = np.linspace(0, 5, 30).tolist()
    v = [2.5] * 30
    res = ajustar_exponencial_rc(t, v, modo="CARGA")
    assert res["valido"] is False
    assert "variación" in res["motivo"].lower()

def test_incertidumbre_error_relativo():
    res = analisis_incertidumbre(1.0, 1.0, r_tolerancia_pct=5.0, c_tolerancia_pct=20.0)
    assert res["error_relativo_tau_pct"] == 0.0
    assert res["diferencia_absoluta_tau_s"] == 0.0

def test_incertidumbre_sin_tau_teorica():
    res = analisis_incertidumbre(1.0, None)
    assert res["error_relativo_tau_pct"] is None
