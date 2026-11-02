"""
Pruebas unitarias y de robustez para el parser serial de RC LAB 3D.
"""
import pytest
from backend.parser import SerialParser

def test_parse_valid_firmware_line():
    parser = SerialParser()
    line = "Min:0.0,Max:5.0,Límite_Pot:2.50,Curva_Objetivo:2.30,Voltaje_Real:2.10"
    sample, err = parser.parse_line(line)
    
    assert err is None
    assert sample is not None
    assert sample.valida is True
    assert sample.limite_pot == 2.50
    assert sample.voltaje_objetivo == 2.30
    assert sample.voltaje_real == 2.10
    assert sample.min_val == 0.0
    assert sample.max_val == 5.0
    assert sample.error_seguimiento == round(2.10 - 2.30, 3)
    assert sample.led1_logico is True
    assert sample.led2_logico is True
    assert sample.led3_logico is False
    assert sample.led4_logico is False

def test_parse_without_accents_and_arbitrary_order():
    parser = SerialParser()
    line = "Voltaje_Real:4.25, Curva_Objetivo: 3.50 , Limite_Pot: 4.80"
    sample, err = parser.parse_line(line)
    
    assert err is None
    assert sample is not None
    assert sample.voltaje_real == 4.25
    assert sample.voltaje_objetivo == 3.50
    assert sample.limite_pot == 4.80
    assert sample.led4_logico is True

def test_reject_empty_and_whitespace_lines():
    parser = SerialParser()
    sample, err = parser.parse_line("")
    assert sample is None
    assert "vacía" in err.lower()

    sample, err = parser.parse_line("   \r\n   ")
    assert sample is None
    assert "espacios" in err.lower()

def test_reject_missing_required_fields():
    parser = SerialParser()
    line = "Min:0.0,Max:5.0,Límite_Pot:2.50"
    sample, err = parser.parse_line(line)
    assert sample is None
    assert "faltan campos" in err.lower()

def test_reject_non_numeric_and_nan():
    parser = SerialParser()
    line = "Min:0.0,Max:5.0,Límite_Pot:2.50,Curva_Objetivo:NaN,Voltaje_Real:2.10"
    sample, err = parser.parse_line(line)
    assert sample is None
    assert "infinito" in err.lower() or "no numérico" in err.lower()

    line_corrupt = "Min:0.0,Max:5.0,Límite_Pot:abc,Curva_Objetivo:2.30,Voltaje_Real:2.10"
    sample, err = parser.parse_line(line_corrupt)
    assert sample is None
    assert "numérico inválido" in err.lower()

def test_detect_voltage_out_of_bounds_anomaly():
    parser = SerialParser()
    line = "Min:0.0,Max:5.0,Límite_Pot:2.50,Curva_Objetivo:2.30,Voltaje_Real:6.80"
    sample, err = parser.parse_line(line)
    assert err is None
    assert sample is not None
    assert sample.anomalia is True
    assert "supera 5.0v" in sample.mensaje_anomalia.lower()
