"""Pruebas de persistencia, historial y exportación de sesiones."""
from __future__ import annotations

import csv
import json
import os
import time

import pytest

from backend.models import CircuitParameters, SCHEMA_VERSION, TelemetrySample
from backend.session_manager import SessionManager


def _sample(voltage: float = 1.0, state: str = "C", t_ms: int = 1000) -> TelemetrySample:
    return TelemetrySample(
        voltaje_tanque=voltage,
        voltaje_techo=4.0,
        estado=state,
        device_time_ms=t_ms,
        pwm=0,
        adc_a0=200,
        adc_a1=800,
        led_rojo=voltage >= 1.2,
        led_amarillo1=voltage >= 2.4,
        led_amarillo2=voltage >= 3.6,
    )


@pytest.fixture()
def manager(tmp_path):
    return SessionManager(session_dir=str(tmp_path / "sessions"))


def test_sesion_completa_guarda_json_y_csv(manager):
    meta = manager.start_new_session(port="COM3", baudrate=9600, origin="SERIAL")
    assert meta.session_id.startswith("RC_SES_")
    assert meta.schema_version == SCHEMA_VERSION
    assert manager.is_recording is True

    manager.add_sample(_sample(1.2, "C", 1000))
    manager.add_sample(_sample(1.8, "C", 1100))
    annotation = manager.add_annotation("Prueba de carga", "EVENTO_CARGA")
    assert annotation is not None
    assert annotation.text == "Prueba de carga"

    summary = manager.get_summary()
    assert summary["active"] is True
    assert summary["samples_count"] == 2
    assert summary["valid_samples"] == 2
    assert summary["origen"] == "SERIAL"
    assert summary["annotations_count"] == 1

    stopped = manager.stop_session(reason="prueba")
    assert stopped is not None
    assert manager.is_recording is False
    assert stopped.duracion_s is not None

    json_path = os.path.join(manager.session_dir, f"{meta.session_id}.json")
    assert os.path.isfile(json_path)
    with open(json_path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    assert data["schema_version"] == SCHEMA_VERSION
    assert data["metadata"]["session_id"] == meta.session_id
    assert data["metadata"]["origen_datos"] == "SERIAL"
    assert len(data["samples"]) == 2
    assert data["samples"][0]["voltaje_tanque"] == pytest.approx(1.2)

    csv_path = manager.export_csv()
    assert csv_path.endswith(".csv")
    with open(csv_path, "r", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 2
    assert rows[0]["session_id"] == meta.session_id
    assert rows[0]["origen"] == "SERIAL"
    assert rows[0]["protocolo"] == "R1"
    assert rows[0]["puerto"] == "COM3"
    assert float(rows[0]["voltaje_tanque_v"]) == pytest.approx(1.2)
    assert float(rows[0]["tiempo_relativo_s"]) == pytest.approx(0.0)
    assert float(rows[1]["tiempo_relativo_s"]) == pytest.approx(0.1)
    assert float(rows[0]["carga_c"]) == pytest.approx(0.004 * 1.2)


def test_identificadores_unicos(manager):
    first = manager.start_new_session(origin="SERIAL")
    manager.stop_session()
    second = manager.start_new_session(origin="SERIAL")
    manager.stop_session()
    assert first.session_id != second.session_id
    assert first.session_id.startswith("RC_SES_")
    assert len(first.session_id) > len("RC_SES_20260101_000000_")


def test_origen_simulacion_se_conserva(manager):
    meta = manager.start_new_session(port="SINTETICO_TEST", origin="SIMULACION")
    manager.add_sample(_sample(2.0, "C", 1000))
    manager.stop_session()
    listed = manager.list_saved_sessions()
    assert len(listed) == 1
    assert listed[0]["session_id"] == meta.session_id
    assert listed[0]["origen"] == "SIMULACION"

    csv_path = manager.export_csv(meta.session_id)
    with open(csv_path, "r", encoding="utf-8") as handle:
        row = next(csv.DictReader(handle))
    assert row["origen"] == "SIMULACION"


def test_stop_sin_sesion_devuelve_none(manager):
    assert manager.stop_session() is None
    assert manager.get_summary() == {"active": False}
    assert manager.add_annotation("sin sesion") is None


def test_checkpoint_automatico(manager):
    manager._checkpoint_every_samples = 2
    meta = manager.start_new_session(origin="SERIAL")
    manager.add_sample(_sample(1.0, "C", 1000))
    manager.add_sample(_sample(1.1, "C", 1100))
    path = os.path.join(manager.session_dir, f"{meta.session_id}.json")
    assert os.path.isfile(path), "El checkpoint debe escribir la sesión sin esperar al cierre"
    manager.stop_session()


def test_historial_ordena_y_cuenta_muestras(manager):
    first = manager.start_new_session(origin="SERIAL")
    manager.add_sample(_sample(1.0, "C", 1000))
    manager.add_sample(_sample(1.1, "C", 1100))
    manager.stop_session()
    time.sleep(0.01)
    second = manager.start_new_session(origin="SIMULACION")
    manager.add_sample(_sample(2.0, "C", 1000))
    manager.stop_session()

    listed = manager.list_saved_sessions()
    ids = {item["session_id"] for item in listed}
    assert ids == {first.session_id, second.session_id}
    by_id = {item["session_id"]: item for item in listed}
    assert by_id[first.session_id]["samples"] == 2
    assert by_id[second.session_id]["samples"] == 1
    assert by_id[first.session_id]["archivo_csv"] is None  # aún no exportado


def test_carga_de_sesion_y_exportacion_por_id(manager):
    meta = manager.start_new_session(origin="SERIAL")
    manager.add_sample(_sample(1.5, "C", 1000))
    manager.stop_session()

    data = manager.load_session(meta.session_id, include_samples=True)
    assert len(data["samples"]) == 1
    reduced = manager.load_session(meta.session_id, include_samples=False)
    assert reduced["samples"] == []

    json_path = manager.get_session_file(meta.session_id, "json")
    assert json_path.endswith(".json")
    csv_path = manager.get_session_file(meta.session_id, "csv")
    assert csv_path.endswith(".csv")
    assert os.path.isfile(csv_path)

    with pytest.raises(ValueError):
        manager.get_session_file(meta.session_id, "xml")
    with pytest.raises(FileNotFoundError):
        manager.load_session("RC_SES_INEXISTENTE")


def test_rechaza_travesia_de_rutas(manager):
    with pytest.raises(ValueError):
        manager.load_session("../evil")
    with pytest.raises(ValueError):
        manager.get_session_file("..\\evil", "json")


def test_csv_heredado_se_marca_no_verificado(manager):
    legacy = {
        "schema_version": 1,
        "metadata": {
            "session_id": "RC_SES_LEGACY",
            "created_at_utc": "2026-01-01T00:00:00Z",
            "origen_datos": "SERIAL",
            "protocolo": "LEGACY_V1",
        },
        "samples": [
            {
                "voltaje_real": 2.5,
                "limite_pot": 4.0,
                "monotonic_time": 10.0,
                "timestamp_host": 1000.0,
            }
        ],
    }
    path = os.path.join(manager.session_dir, "RC_SES_LEGACY.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(legacy, handle)

    listed = manager.list_saved_sessions()
    assert any(item["session_id"] == "RC_SES_LEGACY" and item["schema_version"] == 1 for item in listed)

    csv_path = manager.export_csv("RC_SES_LEGACY")
    with open(csv_path, "r", encoding="utf-8") as handle:
        row = next(csv.DictReader(handle))
    assert row["origen"] == "LEGACY_NO_VERIFICADO"
    assert float(row["voltaje_tanque_v"]) == pytest.approx(2.5)


def test_eventos_de_desconexion_y_reconexion(manager):
    manager.start_new_session(origin="SERIAL")
    manager.record_disconnection("Cable retirado")
    manager.record_reconnection("Cable reconectado")
    session = manager.current_session
    assert session is not None
    assert len(session.desconexiones) == 2
    tipos = [event.tipo for event in session.eventos]
    assert "DESCONEXION" in tipos
    assert "RECONEXION" in tipos
    manager.stop_session()


def test_parametros_de_circuito_se_copian_en_la_sesion(manager):
    params = CircuitParameters(
        capacitancia_f=0.002,
        resistencia_carga_ohm=1000.0,
        tolerancia_r_pct=5.0,
    )
    meta = manager.start_new_session(parametros=params, origin="SERIAL")
    assert meta.parametros_circuito.capacitancia_f == pytest.approx(0.002)
    assert meta.parametros_circuito.resistencia_carga_ohm == pytest.approx(1000.0)
    manager.stop_session()

    data = manager.load_session(meta.session_id, include_samples=True)
    assert data["metadata"]["parametros_circuito"]["capacitancia_f"] == pytest.approx(0.002)
    assert data["metadata"]["parametros_circuito"]["tolerancia_r_pct"] == pytest.approx(5.0)
