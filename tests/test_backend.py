"""Pruebas de integración del backend FastAPI sin hardware físico.

Cubren REST, WebSocket, configuración, sesiones, análisis, simulación y
exportación. Las sesiones se escriben en un directorio temporal.
"""
from __future__ import annotations

import json
import math
import os
import time

import pytest
from fastapi.testclient import TestClient


def _synthetic_telemetry(tau: float = 2.0, vf: float = 4.0) -> list[dict]:
    samples: list[dict] = []
    t_ms = 0
    for i in range(81):  # carga 0..8 s
        t = i * 0.1
        samples.append(
            {
                "voltaje_tanque": vf * (1 - math.exp(-t / tau)),
                "voltaje_techo": vf,
                "estado": "C",
                "device_time_ms": t_ms,
            }
        )
        t_ms += 100
    for _ in range(5):
        samples.append(
            {
                "voltaje_tanque": vf,
                "voltaje_techo": vf,
                "estado": "S",
                "device_time_ms": t_ms,
            }
        )
        t_ms += 100
    for i in range(81):  # descarga 0..8 s
        t = i * 0.1
        samples.append(
            {
                "voltaje_tanque": vf * math.exp(-t / tau),
                "voltaje_techo": vf,
                "estado": "D",
                "device_time_ms": t_ms,
            }
        )
        t_ms += 100
    for _ in range(5):
        samples.append(
            {
                "voltaje_tanque": 0.0,
                "voltaje_techo": vf,
                "estado": "S",
                "device_time_ms": t_ms,
            }
        )
        t_ms += 100
    return samples


def test_raiz_sirve_el_frontend():
    from backend.app import app

    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
    assert "RC LAB" in response.text
    assert "scene-live" in response.text


def test_listar_puertos(isolated_app, monkeypatch):
    monkeypatch.setattr(isolated_app.serial_mgr, "list_ports", lambda: [])
    client = TestClient(isolated_app.app)
    response = client.get("/api/ports")
    assert response.status_code == 200
    assert response.json() == {"ports": []}


def test_estado_inicial(isolated_app):
    client = TestClient(isolated_app.app)
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json()
    assert data["serial"]["connected"] is False
    assert data["serial"]["connection_state"] == "DESCONECTADO"
    assert data["session"]["active"] is False
    assert data["protocol"]["actual"] == "R1"
    assert data["protocol"]["baudrate"] == 9600
    assert data["version"]


def test_configuracion_y_tau(isolated_app):
    client = TestClient(isolated_app.app)
    get_response = client.get("/api/config")
    assert get_response.status_code == 200
    initial = get_response.json()
    assert initial["config"]["capacitancia_f"] == pytest.approx(0.004)
    assert initial["tau_carga_s"] == pytest.approx(18.8)
    assert initial["tau_descarga_s"] is None

    update = client.put(
        "/api/config",
        json={"capacitancia_f": 0.002, "resistencia_carga_ohm": 1000.0},
    )
    assert update.status_code == 200
    body = update.json()
    assert body["tau_carga_s"] == pytest.approx(2.0)

    after = client.get("/api/config").json()
    assert after["config"]["capacitancia_f"] == pytest.approx(0.002)
    assert after["tau_carga_s"] == pytest.approx(2.0)


def test_configuracion_invalida(isolated_app):
    client = TestClient(isolated_app.app)
    response = client.put("/api/config", json={"capacitancia_f": 0})
    assert response.status_code == 422


def test_conectar_puerto_inexistente(isolated_app, monkeypatch):
    monkeypatch.setattr(
        isolated_app.serial_mgr,
        "connect",
        lambda port, baudrate=9600: (False, f"No se pudo abrir {port}"),
    )
    client = TestClient(isolated_app.app)
    response = client.post("/api/connect", json={"port": "COM999", "baudrate": 9600})
    assert response.status_code == 400
    assert "COM999" in response.json()["detail"]


def test_sesion_sin_fuente_activa_falla(isolated_app):
    client = TestClient(isolated_app.app)
    response = client.post("/api/session/start")
    assert response.status_code == 400
    assert "tramas válidas" in response.json()["detail"]


def test_flujo_sintetico_y_sesion(isolated_app):
    with TestClient(isolated_app.app) as client:
        start = client.post("/api/synthetic/start")
        assert start.status_code == 200
        assert start.json()["serial"]["is_synthetic"] is True

        # Esperar la primera trama válida del emulador.
        deadline = time.time() + 4.0
        status = {}
        while time.time() < deadline:
            status = client.get("/api/status").json()
            if status["serial"]["has_valid_frame"]:
                break
            time.sleep(0.05)
        assert status["serial"]["has_valid_frame"] is True
        assert status["serial"]["connected"] is True
        assert status["serial"]["connection_state"] == "SIMULACION_ACTIVA"
        assert status["serial"]["sample_rate_hz"] > 0

        session_response = client.post("/api/session/start")
        assert session_response.status_code == 200
        session = session_response.json()["session"]
        session_id = session["session_id"]
        assert session["origen_datos"] == "SIMULACION"
        assert session["protocolo"] == "R1"

        time.sleep(0.45)  # dejar entrar varias muestras

        annotation = client.post(
            "/api/session/annotate",
            json={"text": "Inicio de observación", "categoria": "NOTA"},
        )
        assert annotation.status_code == 200

        summary = client.get("/api/status").json()["session"]
        assert summary["active"] is True
        assert summary["samples_count"] >= 3
        assert summary["valid_samples"] >= 3
        assert summary["annotations_count"] == 1

        stop = client.post("/api/session/stop")
        assert stop.status_code == 200
        assert stop.json()["session"]["session_id"] == session_id
        assert stop.json()["session"]["duracion_s"] is not None

        history = client.get("/api/sessions").json()["sessions"]
        assert any(item["session_id"] == session_id for item in history)

        exported = client.get(f"/api/sessions/{session_id}/export/csv")
        assert exported.status_code == 200
        assert "session_id,origen" in exported.text
        assert "SIMULACION" in exported.text

        exported_json = client.get(f"/api/sessions/{session_id}/export/json")
        assert exported_json.status_code == 200
        payload = json.loads(exported_json.text)
        assert payload["metadata"]["session_id"] == session_id

        stop_synthetic = client.post("/api/synthetic/stop")
        assert stop_synthetic.status_code == 200
        assert client.get("/api/status").json()["serial"]["connected"] is False

    data_files = os.listdir(isolated_app.session_mgr.session_dir)
    assert any(name.endswith(".json") for name in data_files)
    assert any(name.endswith(".csv") for name in data_files)


def test_exportar_sin_sesion_devuelve_400(isolated_app):
    client = TestClient(isolated_app.app)
    csv_response = client.get("/api/session/export/csv")
    json_response = client.get("/api/session/export/json")
    assert csv_response.status_code == 400
    assert json_response.status_code == 400


def test_sesion_inexistente_devuelve_404(isolated_app):
    client = TestClient(isolated_app.app)
    response = client.get("/api/sessions/RC_SES_NO_EXISTE")
    assert response.status_code == 404


def test_analizar_muestras_explicitas(isolated_app):
    client = TestClient(isolated_app.app)
    response = client.post(
        "/api/math/analyze",
        json={
            "samples": _synthetic_telemetry(tau=2.0, vf=4.0),
            "parametros": {
                "capacitancia_f": 0.004,
                "resistencia_carga_ohm": 500.0,
                "resistencia_descarga_ohm": 500.0,
            },
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["valido"] is True
    assert data["tiempo_fuente"] == "device_millis"
    assert len(data["segmentos"]) == 2
    charge = [s for s in data["segmentos"] if s["modo"] == "CARGA"][0]
    assert charge["tau_experimental_s"] == pytest.approx(2.075, abs=0.08)
    assert charge["tau_teorica_s"] == pytest.approx(2.0)
    assert len(charge["tiempo_s"]) == charge["num_muestras"]
    assert charge["ajuste"]["r2"] > 0.999


def test_simular_endpoint(isolated_app):
    client = TestClient(isolated_app.app)
    response = client.post(
        "/api/math/simulate",
        json={
            "modo": "CARGA",
            "r_ohm": 1000.0,
            "c_farad": 0.001,
            "v_inicial": 0.0,
            "v_final": 5.0,
            "t_final": 5.0,
            "num_puntos": 101,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["valido"] is True
    assert data["tau_segundos"] == pytest.approx(1.0)
    assert len(data["tiempo"]) == 101
    assert len(data["voltaje"]) == 101
    assert data["etiqueta"] == "SIMULACION_TEORICA_IDEAL"


def test_ajuste_endpoint_con_datos_suficientes(isolated_app):
    client = TestClient(isolated_app.app)
    times = [i * 0.1 for i in range(71)]
    values = [4.0 * (1 - math.exp(-t / 1.5)) for t in times]
    response = client.post(
        "/api/math/fit",
        json={
            "tiempos": times,
            "voltajes": values,
            "modo": "CARGA",
            "r_ohm_teorica": 1500.0,
            "c_farad_teorica": 0.001,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["valido"] is True
    assert data["tau_experimental_s"] == pytest.approx(1.5, rel=0.02)
    assert data["tau_teorica_s"] == pytest.approx(1.5)
    assert data["incertidumbre"]["error_relativo_tau_pct"] is not None


def test_ajuste_endpoint_datos_insuficientes(isolated_app):
    client = TestClient(isolated_app.app)
    response = client.post(
        "/api/math/fit",
        json={"tiempos": [0.0, 1.0], "voltajes": [0.0, 1.0], "modo": "CARGA"},
    )
    assert response.status_code == 200
    assert response.json()["valido"] is False


def test_websocket_envia_estado_y_responde_ping(isolated_app):
    with TestClient(isolated_app.app) as client:
        with client.websocket_connect("/ws/live") as websocket:
            initial = websocket.receive_json()
            assert initial["type"] == "STATUS_INIT"
            assert initial["serial"]["connected"] is False

            websocket.send_json({"action": "PING"})
            pong = websocket.receive_json()
            assert pong["type"] == "PONG"

            websocket.send_json({"action": "STATUS"})
            status = websocket.receive_json()
            assert status["type"] == "STATUS"
            assert status["protocol"]["actual"] == "R1"


def test_diagnostico_incluye_firmware(isolated_app):
    client = TestClient(isolated_app.app)
    response = client.get("/api/diagnostics")
    assert response.status_code == 200
    data = response.json()
    assert data["version"]
    assert data["firmware"]["present"] is True
    assert data["firmware"]["protocol_r1"] is True
    assert data["firmware"]["baud_9600"] is True
    assert data["session_dir"] == isolated_app.session_mgr.session_dir
    assert data["warnings"]
