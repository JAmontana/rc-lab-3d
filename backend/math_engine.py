"""
Motor matemático y de ajuste científico para circuitos RC.
Implementa modelos analíticos de carga y descarga, constante de tiempo tau,
regresión no lineal con SciPy, cálculo de residuos, RMSE, R2, e incertidumbre.
"""
import math
from typing import Dict, Any, List, Optional, Tuple
import numpy as np
from scipy.optimize import curve_fit

def modelo_carga_rc(t: np.ndarray, v_s: float, v_0: float, tau: float) -> np.ndarray:
    """
    V_C(t) = V_s + (V_0 - V_s) * exp(-t / tau)
    """
    return v_s + (v_0 - v_s) * np.exp(-t / tau)

def modelo_descarga_rc(t: np.ndarray, v_0: float, tau: float) -> np.ndarray:
    """
    V_C(t) = V_0 * exp(-t / tau)
    """
    return v_0 * np.exp(-t / tau)

def calcular_tau_teorica(r_ohm: Optional[float], c_farad: Optional[float]) -> Tuple[Optional[float], Optional[str]]:
    """
    Calcula tau = R * C (segundos).
    Retorna (tau, error_mensaje).
    """
    if r_ohm is None or c_farad is None:
        return None, "Faltan parámetros: R o C no especificados"
    if r_ohm <= 0:
        return None, "La resistencia debe ser un valor estrictamente positivo"
    if c_farad <= 0:
        return None, "La capacitancia debe ser un valor estrictamente positivo"
    return r_ohm * c_farad, None

def simular_circuito_rc(
    modo: str,
    r_ohm: float,
    c_farad: float,
    v_s: float,
    v_0: float,
    t_final: float,
    num_puntos: int = 500
) -> Dict[str, Any]:
    """
    Simulación teórica de circuito RC ideal.
    Retorna arrays de tiempo (s), voltaje V_C(t) e intensidad I(t).
    """
    tau, err = calcular_tau_teorica(r_ohm, c_farad)
    if err:
        return {"error": err, "valido": False}
        
    t = np.linspace(0.0, max(0.01, t_final), num_puntos)
    
    if modo.upper() == "CARGA":
        v_c = modelo_carga_rc(t, v_s, v_0, tau)
        i_c = (v_s - v_c) / r_ohm # Ley de Ohm en circuito serie simple
    else: # DESCARGA
        v_c = modelo_descarga_rc(t, v_0, tau)
        i_c = -v_c / r_ohm
        
    return {
        "valido": True,
        "etiqueta": "SIMULACION_TEORICA_IDEAL",
        "modo": modo.upper(),
        "tau_segundos": float(tau),
        "r_ohm": float(r_ohm),
        "c_farad": float(c_farad),
        "v_s": float(v_s),
        "v_0": float(v_0),
        "tiempo": t.tolist(),
        "voltaje": v_c.tolist(),
        "corriente": i_c.tolist()
    }

def ajustar_exponencial_rc(
    tiempos: List[float],
    voltajes: List[float],
    modo: Optional[str] = None
) -> Dict[str, Any]:
    """
    Ajusta un modelo exponencial a un conjunto de muestras experimentales.
    Verifica precondiciones: número de muestras, monotonía, variación de voltaje.
    """
    n = len(tiempos)
    if n < 15:
        return {
            "valido": False,
            "motivo": f"Datos insuficientes para ajuste (muestras = {n}, mínimo requerido = 15)"
        }
        
    t_arr = np.array(tiempos, dtype=float)
    v_arr = np.array(voltajes, dtype=float)
    
    # Normalizar tiempo a t_0 = 0
    t_rel = t_arr - t_arr[0]
    
    # Comprobar variación de voltaje mínima
    v_min, v_max = np.min(v_arr), np.max(v_arr)
    delta_v = v_max - v_min
    if delta_v < 0.20:
        return {
            "valido": False,
            "motivo": f"Variación de voltaje insuficiente ({delta_v:.3f}V < 0.20V requerido)"
        }
        
    # Detectar o validar modo
    delta_extremos = v_arr[-1] - v_arr[0]
    modo_detectado = "CARGA" if delta_extremos > 0 else "DESCARGA"
    if modo and modo.upper() in ["CARGA", "DESCARGA"]:
        modo_final = modo.upper()
    else:
        modo_final = modo_detectado
        
    v_0_init = float(v_arr[0])
    
    try:
        if modo_final == "CARGA":
            v_s_init = float(v_max)
            # Estimación inicial de tau (tiempo al 63.2% de cambio)
            v_63 = v_0_init + 0.632 * (v_s_init - v_0_init)
            idx_63 = np.where(v_arr >= v_63)[0]
            tau_init = float(t_rel[idx_63[0]]) if len(idx_63) > 0 else (t_rel[-1] / 3.0)
            tau_init = max(0.01, tau_init)
            
            popt, pcov = curve_fit(
                modelo_carga_rc,
                t_rel,
                v_arr,
                p0=[v_s_init, v_0_init, tau_init],
                bounds=([0.0, 0.0, 0.001], [15.0, 15.0, 100.0]),
                maxfev=3000
            )
            v_s_fit, v_0_fit, tau_fit = popt
            v_pred = modelo_carga_rc(t_rel, v_s_fit, v_0_fit, tau_fit)
            
        else: # DESCARGA
            v_63 = v_0_init * 0.368
            idx_63 = np.where(v_arr <= v_63)[0]
            tau_init = float(t_rel[idx_63[0]]) if len(idx_63) > 0 else (t_rel[-1] / 3.0)
            tau_init = max(0.01, tau_init)
            
            popt, pcov = curve_fit(
                modelo_descarga_rc,
                t_rel,
                v_arr,
                p0=[v_0_init, tau_init],
                bounds=([0.0, 0.001], [15.0, 100.0]),
                maxfev=3000
            )
            v_0_fit, tau_fit = popt
            v_s_fit = 0.0
            v_pred = modelo_descarga_rc(t_rel, v_0_fit, tau_fit)
            
        # Métricas de bondad de ajuste
        residuos = v_arr - v_pred
        rmse = float(np.sqrt(np.mean(residuos ** 2)))
        
        ss_res = np.sum(residuos ** 2)
        ss_tot = np.sum((v_arr - np.mean(v_arr)) ** 2)
        r2 = float(1.0 - (ss_res / ss_tot)) if ss_tot > 1e-9 else 0.0
        
        # Desviación estándar del parámetro tau (incertidumbre de ajuste)
        perr = np.sqrt(np.diag(pcov))
        tau_err = float(perr[-1]) if len(perr) > 0 else 0.0
        
        # Advertencia de controlador: si el R2 es bajo, avisar que el PWM y la rampa
        # alteran la dinámica respecto a una exponencial pasiva
        advertencia_controlador = None
        if r2 < 0.85:
            advertencia_controlador = (
                "Aviso metodológico: El controlador incremental y la rampa lineal del Arduino "
                "alteran la respuesta frente a un circuito RC pasivo ideal. El valor de tau "
                "representa un ajuste formal pero puede estar dominado por la acción del firmware."
            )
            
        return {
            "valido": True,
            "modo": modo_final,
            "tau_experimental_s": round(float(tau_fit), 4),
            "incertidumbre_tau_s": round(float(tau_err), 4),
            "v_0_ajustado": round(float(v_0_fit), 3),
            "v_s_ajustado": round(float(v_s_fit), 3) if modo_final == "CARGA" else 0.0,
            "rmse_v": round(float(rmse), 4),
            "r2": round(float(r2), 4),
            "num_muestras": n,
            "duracion_intervalo_s": round(float(t_rel[-1]), 3),
            "t_relativo": t_rel.tolist(),
            "voltaje_ajustado": v_pred.tolist(),
            "residuos": residuos.tolist(),
            "advertencia_controlador": advertencia_controlador
        }
        
    except Exception as e:
        return {
            "valido": False,
            "motivo": f"Fallo de optimización en ajuste exponencial: {str(e)}"
        }

def analisis_incertidumbre(
    tau_exp: Optional[float],
    tau_teo: Optional[float],
    r_tolerancia_pct: float = 5.0,
    c_tolerancia_pct: float = 20.0, # Condensadores electrolíticos típicos ±20%
    adc_bits: int = 10,
    v_ref: float = 5.0
) -> Dict[str, Any]:
    """
    Calcula tabla de componentes de incertidumbre.
    """
    q_resolucion_v = v_ref / (2**adc_bits - 1) # ~4.887 mV
    incertidumbre_cuantizacion_v = q_resolucion_v / (2.0 * math.sqrt(3.0)) # Distribución uniforme
    
    res = {
        "adc_resolucion_mv": round(q_resolucion_v * 1000.0, 3),
        "incertidumbre_cuantizacion_mv": round(incertidumbre_cuantizacion_v * 1000.0, 3),
        "tolerancia_r_pct": r_tolerancia_pct,
        "tolerancia_c_pct": c_tolerancia_pct,
        "error_relativo_tau_pct": None,
        "diferencia_absoluta_tau_s": None,
        "observacion": "Resolución del ADC (10 bits) no equivale a exactitud absoluta."
    }
    
    if tau_exp is not None and tau_teo is not None and tau_teo > 0:
        diff_abs = abs(tau_exp - tau_teo)
        err_pct = (diff_abs / tau_teo) * 100.0
        res["diferencia_absoluta_tau_s"] = round(diff_abs, 4)
        res["error_relativo_tau_pct"] = round(err_pct, 2)
        
    return res
