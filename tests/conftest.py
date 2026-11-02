"""Configuración común de pruebas de RC LAB 3D.

Aísla el directorio de sesiones y la configuración eléctrica para no escribir
nunca en data_sessions/ ni alterar el estado real del laboratorio.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture()
def isolated_app(tmp_path, monkeypatch):
    """Devuelve el módulo backend.app con sesiones y serial aislados."""
    from backend import app as app_module
    from backend.models import CircuitParameters

    sessions = tmp_path / "sessions"
    sessions.mkdir()

    monkeypatch.setattr(app_module.session_mgr, "session_dir", str(sessions))
    monkeypatch.setattr(app_module, "circuit_config", CircuitParameters())

    app_module.session_mgr.current_session = None
    app_module.session_mgr.samples = []
    app_module.session_mgr.is_recording = False
    app_module.session_mgr._last_state = None
    app_module.session_mgr._samples_at_checkpoint = 0
    app_module.serial_mgr.disconnect()

    yield app_module

    app_module.serial_mgr.disconnect()
    app_module.session_mgr.is_recording = False
