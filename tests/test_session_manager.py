"""
Pruebas para session_manager y backend de sesiones.
"""
import os
import time
from backend.session_manager import SessionManager
from backend.models import TelemetrySample

def test_start_and_stop_session(tmp_path, monkeypatch):
    from backend import session_manager as sm
    # Redirigir directorio de sesiones a temporal
    sm.SESSION_DIR = str(tmp_path / "sessions")
    os.makedirs(sm.SESSION_DIR, exist_ok=True)
    
    mgr = SessionManager()
    meta = mgr.start_new_session(port="COM3", baudrate=115200, origin="SERIAL")
    assert meta.session_id.startswith("RC_SES_")
    assert mgr.is_recording is True

    # Agregar una muestra válida
    sample = TelemetrySample(
        limite_pot=2.5, voltaje_objetivo=2.0, voltaje_real=2.1,
        error_seguimiento=0.1, porcentaje_escala=42.0
    )
    mgr.add_sample(sample)
    assert mgr.current_session.total_muestras_validas == 1
    assert len(mgr.samples) == 1

    # Agregar anotación
    ann = mgr.add_annotation("Prueba de carga", "EVENTO_CARGA")
    assert ann.text == "Prueba de carga"

    # Detener y guardar
    meta_stop = mgr.stop_session()
    assert meta_stop is not None
    assert mgr.is_recording is False

    # Verificar archivo guardado
    files = os.listdir(sm.SESSION_DIR)
    assert any(f.endswith(".json") for f in files)

    # Exportar CSV
    csv_path = mgr.export_csv()
    assert os.path.exists(csv_path)
    assert csv_path.endswith(".csv")

    # Listar sesiones
    listed = mgr.list_saved_sessions()
    assert len(listed) >= 1
