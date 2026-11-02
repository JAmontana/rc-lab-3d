"""
Pruebas de integración del backend FastAPI (endpoints REST y WebSocket)
sin necesidad de hardware físico.
"""
from fastapi.testclient import TestClient
from backend.app import app, session_mgr, serial_mgr

def test_list_ports_endpoint():
    client = TestClient(app)
    resp = client.get("/api/ports")
    assert resp.status_code == 200
    assert "ports" in resp.json()

def test_status_endpoint_without_hardware():
    client = TestClient(app)
    resp = client.get("/api/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "serial" in data
    assert data["serial"]["connected"] is False

def test_connect_nonexistent_port():
    client = TestClient(app)
    resp = client.post("/api/connect", json={"port": "COM999", "baudrate": 115200})
    assert resp.status_code == 400

def test_synthetic_start_and_stop_flow():
    client = TestClient(app)
    
    # Iniciar modo sintético
    resp = client.post("/api/synthetic/start")
    assert resp.status_code == 200
    
    # Estado debería estar conectado
    status = client.get("/api/status").json()
    assert status["serial"]["connected"] is True
    assert status["serial"]["is_synthetic"] is True
    
    # Iniciar sesión
    resp = client.post("/api/session/start")
    assert resp.status_code == 200
    
    # Anotar
    resp = client.post("/api/session/annotate", json={"text": "Test", "categoria": "NOTA"})
    assert resp.status_code == 200
    
    # Detener sesión
    resp = client.post("/api/session/stop")
    assert resp.status_code == 200
    
    # Desconectar
    resp = client.post("/api/disconnect")
    assert resp.status_code == 200
    
    status = client.get("/api/status").json()
    assert status["serial"]["connected"] is False

def test_simulation_endpoint():
    client = TestClient(app)
    resp = client.post("/api/math/simulate", json={
        "modo": "CARGA",
        "r_ohm": 1000.0,
        "c_farad": 0.001,
        "v_s": 5.0,
        "v_0": 0.0,
        "t_final": 2.0
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["valido"] is True
    assert "tiempo" in data
    assert "voltaje" in data

def test_fit_endpoint_with_insufficient_data():
    client = TestClient(app)
    resp = client.post("/api/math/fit", json={
        "tiempos": [0.0, 1.0],
        "voltajes": [0.0, 1.0],
        "modo": "CARGA"
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["valido"] is False

def test_export_endpoints_without_session():
    client = TestClient(app)
    # Asegurar que no haya sesión activa grabada en el manager compartido
    session_mgr.is_recording = False
    session_mgr.current_session = None
    resp = client.get("/api/session/export/csv")
    assert resp.status_code == 400
    resp = client.get("/api/session/export/json")
    assert resp.status_code == 400
