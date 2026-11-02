"""
Motor matemático de RC LAB 3D.

Incluye:
- Modelos exponenciales de carga y descarga con V0 y Vf explícitos.
- Puntos característicos 63,212 % y 36,788 %.
- Interpolación del cruce de umbral entre muestras.
- Detección de segmentos de carga/descarga con confirmación e histéresis.
- Ajuste no lineal con SciPy, RMSE, R², residuos e incertidumbre de tau.
- Simulación RC con carga, energía y puntos de tau.
- Propagación de incertidumbres cuando los datos están disponibles.
"""
from __future__ import annotations

import math
import warnings
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
from scipy.optimize import curve_fit

from backend.models import CircuitParameters
from backend.protocol import FACTOR_TAU_CARGA, FACTOR_TAU_DESCARGA, MILLIS_MOD

TAU_MIN_S = 1e-3
TAU_MAX_S = 1e4


# ----------------------------------------------------------------------
# Modelos
# ----------------------------------------------------------------------
def modelo_carga_rc(t: np.ndarray, v0: float, vf: float, tau: float) -> np.ndarray:
    """Vc(t) = Vf - (Vf - V0) * exp(-t/tau)."""
    return vf - (vf - v0) * np.exp(-np.asarray(t) / tau)


def modelo_descarga_rc(t: np.ndarray, v0: float, vf: float, tau: float) -> np.ndarray:
    """Vc(t) = Vf + (V0 - Vf) * exp(-t/tau)."""
    return vf + (v0 - vf) * np.exp(-np.asarray(t) / tau)


def modelo_general_rc(t: np.ndarray, v0: float, vf: float, tau: float) -> np.ndarray:
    """Forma general válida para carga y descarga."""
    return vf + (v0 - vf) * np.exp(-np.asarray(t) / tau)


def calcular_tau_teorica(
    r_ohm: Optional[float], c_farad: Optional[float]
) -> Tuple[Optional[float], Optional[str]]:
    if r_ohm is None or c_farad is None:
        return None, "Faltan parámetros: R o C no especificados"
    if r_ohm <= 0:
        return None, "La resistencia debe ser estrictamente positiva"
    if c_farad <= 0:
        return None, "La capacitancia debe ser estrictamente positiva"
    return float(r_ohm) * float(c_farad), None


def punto_tau_carga(v0: float, vf: float) -> Dict[str, float]:
    return {
        "tiempo_factor_tau": 1.0,
        "voltaje_v": v0 + FACTOR_TAU_CARGA * (vf - v0),
        "porcentaje_variacion": FACTOR_TAU_CARGA * 100.0,
        "factor": FACTOR_TAU_CARGA,
    }


def punto_tau_descarga(v0: float, vf: float) -> Dict[str, float]:
    return {
        "tiempo_factor_tau": 1.0,
        "voltaje_v": vf + FACTOR_TAU_DESCARGA * (v0 - vf),
        "porcentaje_restante": FACTOR_TAU_DESCARGA * 100.0,
        "factor": FACTOR_TAU_DESCARGA,
    }


# ----------------------------------------------------------------------
# Tiempo y segmentos
# ----------------------------------------------------------------------
def unwrap_device_time_ms(values: Sequence[Optional[int]]) -> np.ndarray:
    """Convierte millis() a segundos relativos manejando el desbordamiento uint32.

    Si detecta un reinicio del dispositivo (salto negativo pequeño), marca el
    tiempo como no fiable devolviendo un array vacío.
    """
    if not values:
        return np.array([], dtype=float)

    arr = np.asarray([v for v in values], dtype=float)
    if np.any(~np.isfinite(arr)):
        return np.array([], dtype=float)

    out = np.zeros(len(arr), dtype=float)
    for i in range(1, len(arr)):
        delta = arr[i] - arr[i - 1]
        if delta < -(MILLIS_MOD / 2.0):
            delta += MILLIS_MOD
        elif delta < 0:
            # Reinicio del dispositivo, no un desbordamiento: no se puede
            # construir una escala temporal continua con millis().
            return np.array([], dtype=float)
        out[i] = out[i - 1] + delta / 1000.0
    return out


def _get(sample: Any, key: str, default: Any = None) -> Any:
    if isinstance(sample, dict):
        return sample.get(key, default)
    return getattr(sample, key, default)


def _sample_voltage(sample: Any) -> Optional[float]:
    value = _get(sample, "voltaje_tanque")
    if value is None:
        value = _get(sample, "voltaje_real")
    return None if value is None else float(value)


def _sample_ceiling(sample: Any) -> Optional[float]:
    value = _get(sample, "voltaje_techo")
    if value is None:
        value = _get(sample, "limite_pot")
    return None if value is None else float(value)


def _sample_state(sample: Any) -> str:
    estado = _get(sample, "estado")
    if estado is None:
        estado = _get(sample, "modo_estimado", "S")
    estado = str(estado).upper()
    return {"CARGA": "C", "DESCARGA": "D", "ESTABLE": "S"}.get(estado, estado)


def _sample_time_seconds(samples: Sequence[Any]) -> Tuple[np.ndarray, str]:
    device = [_get(s, "device_time_ms") for s in samples]
    if all(v is not None for v in device):
        times = unwrap_device_time_ms(device)
        if len(times) == len(samples) and len(times) > 1:
            return times, "device_millis"

    host = [_get(s, "monotonic_time") for s in samples]
    if any(v is None for v in host):
        host = [_get(s, "timestamp_host") for s in samples]
    arr = np.asarray(host, dtype=float)
    if len(arr) == 0:
        return np.array([], dtype=float), "desconocido"
    return arr - arr[0], "host_monotonic"


def _smooth(values: np.ndarray, window: int = 3) -> np.ndarray:
    if len(values) < window or window <= 1:
        return values.astype(float, copy=True)
    kernel = np.ones(window, dtype=float) / window
    padded = np.pad(values.astype(float), (window // 2, window - 1 - window // 2), mode="edge")
    return np.convolve(padded, kernel, mode="valid")


def interpolar_cruce(
    tiempos: np.ndarray, voltajes: np.ndarray, umbral: float
) -> Optional[Dict[str, float]]:
    """Busca el primer cruce con confirmación de dos muestras posteriores.

    Devuelve tiempo, voltaje interpolado y los índices utilizados.
    """
    t = np.asarray(tiempos, dtype=float)
    v = np.asarray(voltajes, dtype=float)
    if len(t) < 4 or not np.isfinite(umbral):
        return None

    v_suave = _smooth(v, 3)
    for i in range(1, len(v_suave)):
        antes = v_suave[i - 1]
        despues = v_suave[i]
        cruza = (antes <= umbral <= despues) or (despues <= umbral <= antes)
        if not cruza:
            continue

        # Confirmación: el cruce no puede ser una fluctuación aislada.
        if i + 2 >= len(v_suave):
            return None
        if despues >= antes:
            confirmado = v_suave[i + 1] >= umbral and v_suave[i + 2] >= umbral
        else:
            confirmado = v_suave[i + 1] <= umbral and v_suave[i + 2] <= umbral
        if not confirmado:
            continue

        denominador = despues - antes
        if abs(denominador) < 1e-12:
            fraccion = 0.0
        else:
            fraccion = (umbral - antes) / denominador
        fraccion = float(np.clip(fraccion, 0.0, 1.0))
        t_cruce = float(t[i - 1] + fraccion * (t[i] - t[i - 1]))
        v_cruce = float(umbral)
        return {
            "tiempo_s": t_cruce,
            "voltaje_v": v_cruce,
            "indice_anterior": i - 1,
            "indice_siguiente": i,
            "fraccion": fraccion,
        }
    return None


def detectar_segmentos(samples: Sequence[Any]) -> List[Dict[str, Any]]:
    """Detecta tramos C/D y los extiende brevemente sobre el estado estable."""
    if not samples:
        return []

    tiempos, fuente = _sample_time_seconds(samples)
    if len(tiempos) != len(samples):
        return []

    estados = [_sample_state(s) for s in samples]
    segmentos: List[Dict[str, Any]] = []
    i = 0
    n = len(samples)

    while i < n:
        if estados[i] not in {"C", "D"}:
            i += 1
            continue

        modo = estados[i]
        inicio = i
        fin = i
        j = i + 1
        while j < n and estados[j] == modo:
            fin = j
            j += 1

        # Extender la cola estable para estimar el voltaje final medido.
        cola = fin
        extendidos = 0
        while (
            cola + 1 < n
            and estados[cola + 1] == "S"
            and extendidos < 10
            and (tiempos[cola + 1] - tiempos[cola]) <= 2.0
        ):
            cola += 1
            extendidos += 1

        if fin - inicio + 1 >= 5 and (tiempos[fin] - tiempos[inicio]) >= 0.05:
            segmentos.append(
                {
                    "modo": modo,
                    "inicio_idx": inicio,
                    "fin_idx": fin,
                    "cola_idx": cola,
                    "inicio_s": float(tiempos[inicio]),
                    "fin_s": float(tiempos[fin]),
                    "cola_s": float(tiempos[cola]),
                    "num_muestras": fin - inicio + 1,
                }
            )

        i = max(fin + 1, j)

    return segmentos


# ----------------------------------------------------------------------
# Ajuste
# ----------------------------------------------------------------------
def _calidad(r2: Optional[float]) -> str:
    if r2 is None:
        return "sin evaluar"
    if r2 >= 0.99:
        return "excelente"
    if r2 >= 0.95:
        return "bueno"
    if r2 >= 0.85:
        return "aceptable"
    return "deficiente"


def _ajustar_arrays(
    tiempos: np.ndarray,
    voltajes: np.ndarray,
    *,
    v0_inicial: Optional[float] = None,
    vf_inicial: Optional[float] = None,
    tau_inicial: Optional[float] = None,
) -> Dict[str, Any]:
    t = np.asarray(tiempos, dtype=float)
    v = np.asarray(voltajes, dtype=float)

    if len(t) < 8 or len(t) != len(v):
        return {"valido": False, "motivo": "Datos insuficientes para el ajuste (mínimo 8 muestras)"}
    if not np.all(np.isfinite(t)) or not np.all(np.isfinite(v)):
        return {"valido": False, "motivo": "Los datos contienen NaN o infinito"}

    t_rel = t - t[0]
    if np.any(np.diff(t_rel) < 0):
        return {"valido": False, "motivo": "La escala temporal no es monótona"}

    v0 = float(v[0] if v0_inicial is None else v0_inicial)
    vf = float(v[-1] if vf_inicial is None else vf_inicial)
    if tau_inicial is None:
        tau_inicial = max(TAU_MIN_S, float(t_rel[-1]) / 3.0 if t_rel[-1] > 0 else 1.0)
    tau_inicial = float(np.clip(tau_inicial, TAU_MIN_S, TAU_MAX_S))

    span = max(abs(vf - v0), 1e-6)
    limites_inf = [0.0, 0.0, TAU_MIN_S]
    limites_sup = [max(30.0, v0 + span * 3.0), max(30.0, vf + span * 3.0), TAU_MAX_S]

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            popt, pcov = curve_fit(
                modelo_general_rc,
                t_rel,
                v,
                p0=[v0, vf, tau_inicial],
                bounds=(limites_inf, limites_sup),
                maxfev=8000,
            )
        v0_fit, vf_fit, tau_fit = [float(x) for x in popt]
        pred = modelo_general_rc(t_rel, v0_fit, vf_fit, tau_fit)
        residuos = v - pred
        rmse = float(np.sqrt(np.mean(residuos**2)))
        ss_res = float(np.sum(residuos**2))
        ss_tot = float(np.sum((v - np.mean(v)) ** 2))
        r2 = float(1.0 - ss_res / ss_tot) if ss_tot > 1e-12 else 0.0

        perr = np.sqrt(np.diag(pcov)) if pcov is not None else np.array([np.nan] * 3)
        tau_err = float(perr[2]) if len(perr) >= 3 and np.isfinite(perr[2]) else None

        return {
            "valido": True,
            "tau_s": tau_fit,
            "tau_error_s": tau_err,
            "v0_ajustado": v0_fit,
            "vf_ajustado": vf_fit,
            "rmse_v": rmse,
            "r2": r2,
            "calidad": _calidad(r2),
            "residuos": residuos.tolist(),
            "t_relativo": t_rel.tolist(),
            "voltaje_ajustado": pred.tolist(),
            "num_muestras": len(t),
        }
    except Exception as exc:
        return {"valido": False, "motivo": f"Fallo de optimización: {exc}"}


def ajustar_exponencial_rc(
    tiempos: Sequence[float],
    voltajes: Sequence[float],
    modo: Optional[str] = None,
    v0: Optional[float] = None,
    vf: Optional[float] = None,
) -> Dict[str, Any]:
    """Ajuste compatible con la API anterior, usando V0 y Vf explícitos."""
    t = np.asarray(tiempos, dtype=float)
    v = np.asarray(voltajes, dtype=float)
    if len(t) < 8:
        return {"valido": False, "motivo": f"Datos insuficientes para ajuste (muestras = {len(t)}, mínimo = 8)"}
    if len(t) != len(v):
        return {"valido": False, "motivo": "Tiempos y voltajes tienen longitudes distintas"}
    if not np.all(np.isfinite(t)) or not np.all(np.isfinite(v)):
        return {"valido": False, "motivo": "Los datos contienen NaN o infinito"}

    delta = float(v[-1] - v[0])
    if np.max(v) - np.min(v) < 0.05:
        return {
            "valido": False,
            "motivo": "Sin variación de voltaje suficiente para ajustar una exponencial",
        }
    modo_final = (modo or ("CARGA" if delta >= 0 else "DESCARGA")).upper()
    if modo_final not in {"CARGA", "DESCARGA"}:
        return {"valido": False, "motivo": f"Modo no reconocido: {modo}"}

    fit = _ajustar_arrays(
        t - t[0],
        v,
        v0_inicial=v[0] if v0 is None else v0,
        vf_inicial=v[-1] if vf is None else vf,
    )
    if not fit["valido"]:
        return fit

    return {
        "valido": True,
        "modo": modo_final,
        "tau_experimental_s": round(fit["tau_s"], 6),
        "incertidumbre_tau_s": round(fit["tau_error_s"], 6) if fit["tau_error_s"] is not None else None,
        "v_0_ajustado": round(fit["v0_ajustado"], 6),
        "v_s_ajustado": round(fit["vf_ajustado"], 6),
        "rmse_v": round(fit["rmse_v"], 6),
        "r2": round(fit["r2"], 6),
        "calidad": fit["calidad"],
        "num_muestras": fit["num_muestras"],
        "residuos": fit["residuos"],
        "t_relativo": fit["t_relativo"],
        "voltaje_ajustado": fit["voltaje_ajustado"],
        "advertencia_controlador": (
            "El montaje incluye MOSFET y control activo. Si R² es bajo, la respuesta "
            "no debe interpretarse como un RC pasivo ideal."
            if fit["r2"] < 0.85
            else None
        ),
    }


# ----------------------------------------------------------------------
# Análisis de una sesión
# ----------------------------------------------------------------------
def _params_obj(params: Optional[Any]) -> CircuitParameters:
    if isinstance(params, CircuitParameters):
        return params
    if isinstance(params, dict):
        return CircuitParameters(**params)
    return CircuitParameters()


def analizar_sesion(
    samples: Sequence[Any],
    params: Optional[Any] = None,
    start_s: Optional[float] = None,
    end_s: Optional[float] = None,
) -> Dict[str, Any]:
    parametros = _params_obj(params)
    if not samples:
        return {"valido": False, "motivo": "No hay muestras para analizar", "segmentos": [], "advertencias": []}

    # Normalizar y filtrar muestras válidas y con voltaje.
    normalizadas: List[Any] = []
    for sample in samples:
        if not bool(_get(sample, "valida", True)):
            continue
        voltage = _sample_voltage(sample)
        if voltage is None or not math.isfinite(float(voltage)):
            continue
        normalizadas.append(sample)

    if len(normalizadas) < 8:
        return {
            "valido": False,
            "motivo": f"Muestras válidas insuficientes ({len(normalizadas)}; mínimo 8)",
            "segmentos": [],
            "advertencias": [],
        }

    tiempos, fuente = _sample_time_seconds(normalizadas)
    if len(tiempos) != len(normalizadas):
        return {"valido": False, "motivo": "No se pudo construir una escala temporal", "segmentos": [], "advertencias": []}

    t0 = float(tiempos[0])
    tiempos = tiempos - t0
    if start_s is not None or end_s is not None:
        inferior = 0.0 if start_s is None else max(0.0, float(start_s))
        superior = float(tiempos[-1]) if end_s is None else max(inferior, float(end_s))
        indices = [i for i, t in enumerate(tiempos) if inferior <= t <= superior]
        if len(indices) < 8:
            return {
                "valido": False,
                "motivo": "El intervalo seleccionado contiene menos de 8 muestras",
                "segmentos": [],
                "advertencias": [],
            }
        normalizadas = [normalizadas[i] for i in indices]
        tiempos = tiempos[indices]

    voltajes = np.asarray([_sample_voltage(s) for s in normalizadas], dtype=float)
    segmentos_base = detectar_segmentos(normalizadas)
    advertencias: List[str] = []
    if fuente == "host_monotonic":
        advertencias.append(
            "Se usó tiempo monotónico del host. Es menos preciso que millis() del Arduino."
        )
    if not segmentos_base:
        advertencias.append(
            "No se detectaron tramos de carga o descarga con duración suficiente. "
            "El estado debe provenir del firmware o de la inferencia del protocolo heredado."
        )

    resultados: List[Dict[str, Any]] = []
    for base in segmentos_base:
        inicio = base["inicio_idx"]
        fin = base["fin_idx"]
        cola = base["cola_idx"]
        modo = "CARGA" if base["modo"] == "C" else "DESCARGA"
        t_seg = tiempos[inicio : fin + 1]
        v_seg = voltajes[inicio : fin + 1]
        if len(t_seg) < 8:
            continue

        v0 = float(np.median(voltajes[inicio : min(inicio + 3, len(voltajes))]))
        vf_cola = float(np.median(voltajes[max(inicio, cola - 4) : cola + 1]))
        vf_origen = "medido_cola"
        if modo == "CARGA":
            if vf_cola <= v0 + 0.02:
                vf_cola = float(np.max(v_seg))
                vf_origen = "maximo_observado"
            delta_v = vf_cola - v0
            umbral = v0 + FACTOR_TAU_CARGA * (vf_cola - v0)
            factor_pct = FACTOR_TAU_CARGA * 100.0
        else:
            if vf_cola >= v0 - 0.02:
                vf_cola = float(np.min(v_seg))
                vf_origen = "minimo_observado"
            delta_v = v0 - vf_cola
            umbral = vf_cola + FACTOR_TAU_DESCARGA * (v0 - vf_cola)
            factor_pct = FACTOR_TAU_DESCARGA * 100.0

        segmento: Dict[str, Any] = {
            "modo": modo,
            "inicio_s": float(t_seg[0]),
            "fin_s": float(t_seg[-1]),
            "duracion_s": float(t_seg[-1] - t_seg[0]),
            "num_muestras": int(len(t_seg)),
            "v0_v": round(v0, 6),
            "vf_v": round(vf_cola, 6),
            "vf_origen": vf_origen,
            "delta_v": round(delta_v, 6),
            "umbral_tau_v": round(umbral, 6),
            "porcentaje_caracteristico": round(factor_pct, 6),
            # Series crudas relativas al inicio del segmento, para las gráficas.
            "tiempo_s": [round(float(x - t_seg[0]), 6) for x in t_seg],
            "voltaje_v": [round(float(x), 6) for x in v_seg],
        }

        if delta_v < 0.20:
            segmento["tau_experimental_s"] = None
            segmento["motivo"] = "Variación de voltaje insuficiente (< 0.20 V)"
            segmento["ajuste"] = {"valido": False, "motivo": segmento["motivo"]}
            resultados.append(segmento)
            continue

        cruce = interpolar_cruce(t_seg, v_seg, umbral)
        if cruce:
            tau_exp = cruce["tiempo_s"] - float(t_seg[0])
            segmento["punto_tau"] = {
                "tiempo_s": round(cruce["tiempo_s"], 6),
                "tau_s": round(tau_exp, 6),
                "voltaje_v": round(cruce["voltaje_v"], 6),
                "fraccion": round(cruce["fraccion"], 6),
            }
            segmento["tau_experimental_s"] = round(tau_exp, 6)
        else:
            segmento["punto_tau"] = None
            segmento["tau_experimental_s"] = None
            segmento["motivo"] = "No se alcanzó el cruce característico con confirmación suficiente"

        tau_teo = (
            parametros.tau_carga_s()
            if modo == "CARGA"
            else parametros.tau_descarga_s()
        )
        segmento["tau_teorica_s"] = round(tau_teo, 6) if tau_teo is not None else None
        if segmento["tau_experimental_s"] is not None and tau_teo:
            error_abs = abs(segmento["tau_experimental_s"] - tau_teo)
            segmento["error_abs_s"] = round(error_abs, 6)
            segmento["error_rel_pct"] = round(error_abs / tau_teo * 100.0, 4)
        else:
            segmento["error_abs_s"] = None
            segmento["error_rel_pct"] = None

        fit = _ajustar_arrays(
            t_seg,
            v_seg,
            v0_inicial=v0,
            vf_inicial=vf_cola,
            tau_inicial=segmento["tau_experimental_s"] or max(0.01, (t_seg[-1] - t_seg[0]) / 3.0),
        )
        segmento["ajuste"] = fit
        if not fit.get("valido"):
            advertencias.append(f"{modo}: el ajuste no fue válido ({fit.get('motivo')}).")
        elif fit.get("r2", 0) < 0.85:
            advertencias.append(
                f"{modo}: R² = {fit['r2']:.4f}. La respuesta puede estar dominada por el "
                "control activo, el filtrado o un intervalo incompleto."
            )

        segmento["incertidumbre"] = analisis_incertidumbre(
            tau_exp=segmento["tau_experimental_s"],
            tau_teo=tau_teo,
            params=parametros,
            tau_fit_err=fit.get("tau_error_s") if fit.get("valido") else None,
            sample_period_s=_periodo_muestreo(t_seg),
        )
        resultados.append(segmento)

    return {
        "valido": bool(resultados),
        "tiempo_fuente": fuente,
        "num_muestras": len(normalizadas),
        "duracion_total_s": round(float(tiempos[-1]), 6) if len(tiempos) else 0.0,
        "parametros": parametros.model_dump(),
        "segmentos": resultados,
        "advertencias": advertencias,
        "puntos_referencia": {
            "carga_63_2": punto_tau_carga(0.0, 1.0),
            "descarga_36_8": punto_tau_descarga(1.0, 0.0),
        },
    }


def _periodo_muestreo(t: np.ndarray) -> Optional[float]:
    if len(t) < 3:
        return None
    diffs = np.diff(t)
    diffs = diffs[np.isfinite(diffs) & (diffs > 0)]
    if len(diffs) == 0:
        return None
    return float(np.median(diffs))


# ----------------------------------------------------------------------
# Incertidumbre
# ----------------------------------------------------------------------
def analisis_incertidumbre(
    tau_exp: Optional[float],
    tau_teo: Optional[float],
    params: Optional[Any] = None,
    tau_fit_err: Optional[float] = None,
    sample_period_s: Optional[float] = None,
    r_tolerancia_pct: Optional[float] = None,
    c_tolerancia_pct: Optional[float] = None,
) -> Dict[str, Any]:
    parametros = _params_obj(params)
    if r_tolerancia_pct is not None:
        parametros.tolerancia_r_pct = r_tolerancia_pct
    if c_tolerancia_pct is not None:
        parametros.tolerancia_c_pct = c_tolerancia_pct

    q_resolucion_v = parametros.vref_v / (2**parametros.adc_bits - 1)
    u_cuantizacion_v = q_resolucion_v / math.sqrt(12.0)
    u_tanque_cuantizacion_v = u_cuantizacion_v * parametros.ganancia_divisor

    componentes: List[Dict[str, Any]] = [
        {
            "nombre": "Cuantización ADC",
            "valor": u_tanque_cuantizacion_v,
            "unidad": "V",
            "origen": f"{parametros.adc_bits} bits, Vref={parametros.vref_v:.3f} V",
        }
    ]

    if parametros.tolerancia_vref_pct is not None:
        u_vref = parametros.vref_v * parametros.tolerancia_vref_pct / 100.0 / math.sqrt(3.0)
        componentes.append(
            {
                "nombre": "Referencia ADC",
                "valor": u_vref,
                "unidad": "V",
                "origen": f"tolerancia declarada ±{parametros.tolerancia_vref_pct:.2f} %",
            }
        )
    else:
        componentes.append(
            {
                "nombre": "Referencia ADC",
                "valor": None,
                "unidad": "V",
                "origen": "desconocida (no declarada)",
            }
        )

    u_tau_rc = None
    if tau_teo is not None and parametros.tolerancia_r_pct is not None and parametros.tolerancia_c_pct is not None:
        rel_r = parametros.tolerancia_r_pct / 100.0 / math.sqrt(3.0)
        rel_c = parametros.tolerancia_c_pct / 100.0 / math.sqrt(3.0)
        u_tau_rc = abs(tau_teo) * math.sqrt(rel_r**2 + rel_c**2)
        componentes.append(
            {
                "nombre": "R y C (tau teórico)",
                "valor": u_tau_rc,
                "unidad": "s",
                "origen": f"R ±{parametros.tolerancia_r_pct:.2f} %, C ±{parametros.tolerancia_c_pct:.2f} %",
            }
        )
    else:
        componentes.append(
            {
                "nombre": "R y C (tau teórico)",
                "valor": None,
                "unidad": "s",
                "origen": "tolerancias desconocidas; usar análisis de sensibilidad",
            }
        )

    u_tiempo = None
    if sample_period_s is not None and sample_period_s > 0:
        u_tiempo = sample_period_s / math.sqrt(12.0)
        componentes.append(
            {
                "nombre": "Muestreo temporal",
                "valor": u_tiempo,
                "unidad": "s",
                "origen": f"periodo mediano {sample_period_s:.4f} s",
            }
        )

    componentes_exp: List[float] = []
    if tau_fit_err is not None and math.isfinite(tau_fit_err):
        componentes_exp.append(float(tau_fit_err))
    if u_tiempo is not None:
        componentes_exp.append(u_tiempo)
    u_tau_exp = math.sqrt(sum(x**2 for x in componentes_exp)) if componentes_exp else None

    error_abs = None
    error_rel = None
    if tau_exp is not None and tau_teo is not None and tau_teo > 0:
        error_abs = abs(tau_exp - tau_teo)
        error_rel = error_abs / tau_teo * 100.0

    return {
        "adc_resolucion_mv": round(q_resolucion_v * 1000.0, 6),
        "incertidumbre_cuantizacion_mv": round(u_cuantizacion_v * 1000.0, 6),
        "incertidumbre_tanque_cuantizacion_mv": round(u_tanque_cuantizacion_v * 1000.0, 6),
        "incertidumbre_tau_teorica_s": round(u_tau_rc, 6) if u_tau_rc is not None else None,
        "incertidumbre_tau_experimental_s": round(u_tau_exp, 6) if u_tau_exp is not None else None,
        "incertidumbre_temporal_s": round(u_tiempo, 6) if u_tiempo is not None else None,
        "error_absoluto_tau_s": round(error_abs, 6) if error_abs is not None else None,
        "diferencia_absoluta_tau_s": round(error_abs, 6) if error_abs is not None else None,
        "error_relativo_tau_pct": round(error_rel, 4) if error_rel is not None else None,
        "componentes": componentes,
        "observacion": (
            "La resolución del ADC no equivale a exactitud. Las tolerancias no declaradas "
            "permanecen como desconocidas y no se inventan."
        ),
    }


# ----------------------------------------------------------------------
# Simulación
# ----------------------------------------------------------------------
def simular_circuito_rc(
    modo: str,
    r_ohm: float,
    c_farad: float,
    v_inicial: float,
    v_final: float,
    t_final: float,
    num_puntos: int = 600,
) -> Dict[str, Any]:
    tau, error = calcular_tau_teorica(r_ohm, c_farad)
    if error or tau is None:
        return {"valido": False, "error": error}

    if t_final <= 0:
        return {"valido": False, "error": "El tiempo final debe ser positivo"}
    num_puntos = max(2, min(5000, int(num_puntos)))
    t = np.linspace(0.0, float(t_final), num_puntos)
    voltaje = modelo_general_rc(t, float(v_inicial), float(v_final), tau)
    carga = float(c_farad) * voltaje
    energia = 0.5 * float(c_farad) * voltaje**2

    modo_norm = modo.upper()
    if modo_norm == "CARGA":
        punto = punto_tau_carga(float(v_inicial), float(v_final))
    else:
        punto = punto_tau_descarga(float(v_inicial), float(v_final))

    return {
        "valido": True,
        "etiqueta": "SIMULACION_TEORICA_IDEAL",
        "modo": modo_norm,
        "tau_segundos": float(tau),
        "r_ohm": float(r_ohm),
        "c_farad": float(c_farad),
        "v_inicial": float(v_inicial),
        "v_final": float(v_final),
        "tiempo": t.tolist(),
        "voltaje": voltaje.tolist(),
        "carga_c": carga.tolist(),
        "energia_j": energia.tolist(),
        "punto_tau": punto,
        "puntos": {
            "carga_63_2": punto_tau_carga(float(v_inicial), float(v_final)),
            "descarga_36_8": punto_tau_descarga(float(v_inicial), float(v_final)),
        },
    }
