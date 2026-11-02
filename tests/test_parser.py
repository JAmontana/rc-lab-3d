"""Pruebas del parser serial R1 y de los protocolos heredados."""
from __future__ import annotations

import pytest

from backend.parser import SerialParser
from backend.protocol import PROTOCOLO_LEGACY_2F, PROTOCOLO_LEGACY_V1


# ---------------------------------------------------------------------------
# Protocolo R1
# ---------------------------------------------------------------------------
def test_r1_valido_completo():
    parser = SerialParser()
    sample, error = parser.parse_line("R1,12345,2.135,4.200,C,0,437,860")
    assert error is None
    assert sample is not None
    assert sample.protocolo == "R1"
    assert sample.device_time_ms == 12345
    assert sample.voltaje_tanque == pytest.approx(2.135)
    assert sample.voltaje_techo == pytest.approx(4.200)
    assert sample.estado == "C"
    assert sample.pwm == 0
    assert sample.adc_a0 == 437
    assert sample.adc_a1 == 860
    assert sample.valida is True


def test_r1_millis_maximo_valido():
    parser = SerialParser()
    sample, error = parser.parse_line("R1,4294967295,4.000,4.000,S,0,1023,1023")
    assert error is None
    assert sample.device_time_ms == 4294967295


def test_r1_millis_fuera_de_rango():
    parser = SerialParser()
    sample, error = parser.parse_line("R1,4294967296,4.000,4.000,S,0,1023,1023")
    assert sample is None
    assert "millis" in error.lower()


@pytest.mark.parametrize(
    "line",
    [
        "R1,1000,2.0,4.0,C,0,437",              # faltan campos
        "R1,1000,2.0,4.0,C,0,437,860,extra",    # sobran campos
        "R1,1000,2.0,4.0,X,0,437,860",          # estado inválido
        "R1,1000,2.0,4.0,C,256,437,860",        # PWM fuera de rango
        "R1,1000,2.0,4.0,C,0,1024,860",         # ADC fuera de rango
        "R1,1000,2.0,4.0,C,0,437,860.5",        # enteros requeridos
        "R1,abc,2.0,4.0,C,0,437,860",           # millis no entero
    ],
)
def test_r1_rechaza_tramas_invalidas(line):
    parser = SerialParser()
    sample, error = parser.parse_line(line)
    assert sample is None
    assert error


@pytest.mark.parametrize("valor", ["nan", "NaN", "inf", "-inf", "Infinity"])
def test_r1_rechaza_nan_e_infinito(valor):
    parser = SerialParser()
    sample, error = parser.parse_line(f"R1,1000,{valor},4.0,C,0,437,860")
    assert sample is None
    assert "infinito" in error.lower() or "nan" in error.lower()


def test_r1_anomalia_por_voltaje_alto():
    parser = SerialParser()
    sample, error = parser.parse_line("R1,1000,18.0,4.0,C,0,900,860")
    assert error is None
    assert sample.anomalia is True
    assert "divisor" in sample.mensaje_anomalia.lower()


def test_r1_leds_con_umbrales_del_firmware():
    parser = SerialParser()
    sample, error = parser.parse_line("R1,1000,3.0,4.0,S,0,600,860")
    assert error is None
    assert sample.led_rojo is True       # 3.0 >= 1.2
    assert sample.led_amarillo1 is True  # 3.0 >= 2.4
    assert sample.led_amarillo2 is False # 3.0 < 3.6


def test_r1_techo_cero_apaga_leds():
    parser = SerialParser()
    sample, error = parser.parse_line("R1,1000,3.0,0.0,S,0,600,0")
    assert error is None
    assert sample.led_rojo is False
    assert sample.led_amarillo1 is False
    assert sample.led_amarillo2 is False


# ---------------------------------------------------------------------------
# Protocolos heredados
# ---------------------------------------------------------------------------
def test_legacy_dos_campos():
    parser = SerialParser()
    sample, error = parser.parse_line("2.10,4.20")
    assert error is None
    assert sample.protocolo == PROTOCOLO_LEGACY_2F
    assert sample.voltaje_tanque == pytest.approx(2.10)
    assert sample.voltaje_techo == pytest.approx(4.20)
    assert sample.device_time_ms is not None
    assert sample.estado in {"C", "D", "S"}


def test_legacy_etiquetado_con_acentos():
    parser = SerialParser()
    line = "Min:0.0,Max:5.0,Límite_Pot:2.50,Curva_Objetivo:2.30,Voltaje_Real:2.10"
    sample, error = parser.parse_line(line)
    assert error is None
    assert sample.protocolo == PROTOCOLO_LEGACY_V1
    assert sample.voltaje_tanque == pytest.approx(2.10)
    assert sample.voltaje_techo == pytest.approx(2.50)


def test_legacy_etiquetado_sin_acentos_y_orden_arbitrario():
    parser = SerialParser()
    sample, error = parser.parse_line("Voltaje_Real:4.25, Curva_Objetivo: 3.50 , Limite_Pot: 4.80")
    assert error is None
    assert sample.voltaje_tanque == pytest.approx(4.25)
    assert sample.voltaje_techo == pytest.approx(4.80)


def test_legacy_faltan_campos():
    parser = SerialParser()
    sample, error = parser.parse_line("Min:0.0,Max:5.0,Límite_Pot:2.50")
    assert sample is None
    assert "faltan" in error.lower()


# ---------------------------------------------------------------------------
# Robustez general
# ---------------------------------------------------------------------------
def test_linea_vacia():
    parser = SerialParser()
    sample, error = parser.parse_line("   ")
    assert sample is None
    assert "vacía" in error.lower() or "espacios" in error.lower()


def test_linea_corrupta_no_numerica():
    parser = SerialParser()
    sample, error = parser.parse_line("R1,1000,abc,4.0,C,0,437,860")
    assert sample is None
    assert "numérico" in error.lower()


def test_cabecera_ignorada_sin_contar_como_error():
    parser = SerialParser()
    sample, error = parser.parse_line("# RC LAB 3D firmware 1.0")
    assert sample is None
    assert error is None
    assert parser.stats["lines_ignored"] == 1


def test_linea_excesivamente_larga():
    parser = SerialParser()
    sample, error = parser.parse_line("R1," + "1" * 2000)
    assert sample is None
    assert "larga" in error.lower()


def test_estadisticas_del_parser():
    parser = SerialParser()
    parser.parse_line("R1,1000,2.0,4.0,C,0,437,860")
    parser.parse_line("basura")
    assert parser.stats["lines_received"] == 2
    assert parser.stats["lines_valid"] == 1
    assert parser.stats["lines_corrupt"] == 1
