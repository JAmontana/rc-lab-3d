"""
Pruebas para SerialManager: listado de puertos, modo sintético y desconexión.
"""
import time
from backend.serial_manager import SerialManager

def test_list_ports_returns_list():
    ports = SerialManager.list_ports()
    assert isinstance(ports, list)

def test_synthetic_mode_start_stop():
    mgr = SerialManager()
    received = []
    def cb(sample):
        received.append(sample)
    mgr.on_sample_callback = cb
    mgr.start_synthetic_mode()
    
    # Esperar a que lleguen algunas muestras sintéticas
    deadline = time.time() + 2.0
    while time.time() < deadline and len(received) < 3:
        time.sleep(0.05)
    
    assert len(received) > 0, "El modo sintético debería generar muestras"
    assert received[0].origen == "SINTETICO_TEST"
    assert received[0].valida is True
    
    status = mgr.get_status()
    assert status["connected"] is True
    assert status["is_synthetic"] is True
    assert status["sample_rate_hz"] > 0
    
    mgr.disconnect()
    assert mgr.is_connected is False
    assert mgr.is_running is False

def test_synthetic_produces_valid_samples_with_correct_format():
    mgr = SerialManager()
    received = []
    mgr.on_sample_callback = lambda s: received.append(s)
    mgr.start_synthetic_mode()

    deadline = time.time() + 2.0
    while time.time() < deadline and len(received) < 5:
        time.sleep(0.05)

    assert len(received) >= 5, "El modo sintético debería generar muestras continuamente"
    s = received[0]
    assert s.origen == "SINTETICO_TEST"
    assert s.valida is True
    assert s.min_val == 0.0
    assert s.max_val == 5.0
    assert -0.2 <= s.voltaje_real <= 5.2
    assert isinstance(s.error_seguimiento, float)
    assert s.voltaje_objetivo is not None

    status = mgr.get_status()
    assert status["connected"] is True
    assert status["is_synthetic"] is True
    assert status["sample_rate_hz"] > 0

    mgr.disconnect()
    assert mgr.is_connected is False
    assert mgr.is_running is False
