"""Pruebas del gestor serial: puertos, conexión fallida, emulador y estado."""
from __future__ import annotations

import time

import pytest

import backend.serial_manager as serial_manager_module
from backend.serial_manager import SerialManager


def _wait_for(predicate, timeout=3.0, interval=0.05):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


def test_list_ports_returns_list():
    ports = SerialManager.list_ports()
    assert isinstance(ports, list)
    for port in ports:
        assert {"device", "description", "is_arduino"}.issubset(port)


def test_estado_inicial_desconectado():
    manager = SerialManager()
    status = manager.get_status()
    assert status["connected"] is False
    assert status["port_open"] is False
    assert status["is_synthetic"] is False
    assert status["connection_state"] == "DESCONECTADO"
    assert status["protocol"] == "R1"


def test_conexion_a_puerto_inexistente(monkeypatch):
    def fake_serial(*args, **kwargs):
        raise OSError("puerto simulado inexistente")

    monkeypatch.setattr(serial_manager_module.serial, "Serial", fake_serial)
    manager = SerialManager()
    success, message = manager.connect("COM999", 9600)
    assert success is False
    assert "COM999" in message
    status = manager.get_status()
    assert status["connected"] is False
    assert status["connection_state"] == "ERROR"
    assert status["last_error"]


def test_emulador_sintetico_genera_muestras_validas():
    manager = SerialManager()
    received = []
    manager.on_sample_callback = received.append

    success, message = manager.start_synthetic_mode(r_ohm=500.0, c_farad=0.004, voltaje_techo_v=4.0)
    assert success is True
    assert "SIMULACION" in message

    try:
        assert _wait_for(lambda: len(received) >= 5)
        first = received[0]
        assert first.origen == "SIMULACION"
        assert first.protocolo == "R1"
        assert first.valida is True
        assert 0.0 <= first.voltaje_tanque <= 5.0
        assert 0.0 <= first.voltaje_techo <= 5.0
        assert first.estado in {"C", "D", "S"}
        assert first.device_time_ms is not None
        assert first.adc_a0 is not None
        assert first.adc_a1 is not None

        status = manager.get_status()
        assert status["connected"] is True
        assert status["is_synthetic"] is True
        assert status["has_valid_frame"] is True
        assert status["connection_state"] == "SIMULACION_ACTIVA"
        assert status["sample_rate_hz"] > 0
        assert status["total_samples"] >= 5
    finally:
        manager.disconnect()

    assert manager.is_running is False
    assert manager.is_synthetic is False
    status = manager.get_status()
    assert status["connected"] is False
    assert status["connection_state"] == "DESCONECTADO"


def test_emulador_rechaza_parametros_invalidos():
    manager = SerialManager()
    success, message = manager.start_synthetic_mode(r_ohm=0.0, c_farad=0.004)
    assert success is False
    assert "positivos" in message
    manager.disconnect()


def test_emulador_transiciona_de_carga_a_descarga():
    manager = SerialManager()
    received = []
    manager.on_sample_callback = received.append
    manager.start_synthetic_mode(r_ohm=200.0, c_farad=0.002, voltaje_techo_v=3.0)
    try:
        # tau = 0.4 s; la fase dura como mínimo 4 s, así que la transición
        # a descarga se observa dentro de la ventana de espera.
        assert _wait_for(
            lambda: {"C", "D"}.issubset({sample.estado for sample in received}),
            timeout=8.0,
            interval=0.1,
        )
    finally:
        manager.disconnect()
    states = {sample.estado for sample in received}
    assert {"C", "D"}.issubset(states)


def test_datos_obsoletos_se_detectan():
    manager = SerialManager()
    manager.is_synthetic = True
    manager.is_running = True
    manager.has_valid_frame = True
    manager.parser.stats["samples_received"] = 1
    manager.last_valid_sample_time = time.time() - 10.0

    status = manager.get_status()
    assert status["stale"] is True
    assert status["connected"] is False
    assert status["connection_state"] == "DATOS_OBSOLETOS"
    manager.is_running = False


def test_conexion_real_establece_estado_esperando_primera_trama(monkeypatch):
    class FakePort:
        is_open = True

        def __init__(self, *args, **kwargs):
            self.dtr = False

        def reset_input_buffer(self):
            return None

        def readline(self):
            time.sleep(0.01)
            return b""

        def close(self):
            self.is_open = False

    monkeypatch.setattr(serial_manager_module.serial, "Serial", FakePort)
    manager = SerialManager()
    try:
        success, message = manager.connect("COM_TEST", 9600)
        assert success is True
        assert "Esperando la primera trama" in message
        status = manager.get_status()
        assert status["port_open"] is True
        assert status["has_valid_frame"] is False
        assert status["connection_state"] == "ESPERANDO_PRIMERA_TRAMA"
        assert status["connected"] is False
    finally:
        manager.disconnect()
    assert manager.get_status()["connected"] is False
