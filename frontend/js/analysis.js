/**
 * Módulo de Ajuste Exponencial, Cálculo de Tau Experimental y Análisis de Calidad.
 */

document.addEventListener("DOMContentLoaded", () => {
  const btnRunFit = document.getElementById("btn-run-fit");
  if (!btnRunFit) return;

  btnRunFit.addEventListener("click", async () => {
    // Tomar el buffer actual de la sesión en vivo
    if (!scienceCharts || scienceCharts.timeBuffer.length < 15) {
      alert("Se requieren al menos 15 muestras en la memoria viva para realizar el ajuste. Inicie adquisición o active el modo test.");
      return;
    }

    const rTeorica = parseFloat(document.getElementById("inp-fit-r").value) || 1000.0;
    const cTeorica = parseFloat(document.getElementById("inp-fit-c").value) || 0.001;
    const modoSel = document.getElementById("inp-fit-mode").value;

    btnRunFit.innerText = "⏳ Ajustando modelo...";

    try {
      const resp = await fetch("/api/math/fit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tiempos: scienceCharts.timeBuffer,
          voltajes: scienceCharts.vRealBuffer,
          modo: modoSel === "AUTO" ? null : modoSel,
          r_ohm_teorica: rTeorica,
          c_farad_teorica: cTeorica
        })
      });

      const data = await resp.json();
      btnRunFit.innerText = "🚀 Ajustar Exponencial";

      if (!data.valido) {
        alert("No se pudo realizar el ajuste: " + data.motivo);
        return;
      }

      displayFitResults(data, scienceCharts.timeBuffer, scienceCharts.vRealBuffer);
    } catch (e) {
      btnRunFit.innerText = "🚀 Ajustar Exponencial";
      alert("Error en el ajuste: " + e);
    }
  });
});

function displayFitResults(fitData, rawTimes, rawVoltages) {
  const resultsArea = document.getElementById("fit-results-area");
  const tableBody = document.getElementById("fit-table-body");
  const warningBox = document.getElementById("fit-warning-box");

  resultsArea.style.display = "block";

  const unc = fitData.incertidumbre || {};
  const tauExp = fitData.tau_experimental_s;
  const tauTeo = fitData.tau_teorica_s;
  const r2 = fitData.r2;
  const rmse = fitData.rmse_v;

  tableBody.innerHTML = `
    <tr>
      <td><strong>Constante de Tiempo τ</strong></td>
      <td style="color:var(--cyan-primary); font-weight:bold;">${tauExp} s (±${fitData.incertidumbre_tau_s} s)</td>
      <td>${tauTeo ? tauTeo + " s" : "No especificado"}</td>
      <td>Error Relativo: ${unc.error_relativo_tau_pct !== null ? unc.error_relativo_tau_pct + "%" : "Pendiente de R real"}</td>
    </tr>
    <tr>
      <td><strong>Bondad de Ajuste R²</strong></td>
      <td colspan="2" style="color:${r2 > 0.85 ? 'var(--green-ok)' : 'var(--amber-charge)'}; font-weight:bold;">${r2.toFixed(4)}</td>
      <td>${r2 > 0.85 ? "Ajuste consistente" : "Curva alterada por lazo de control"}</td>
    </tr>
    <tr>
      <td><strong>RMSE Residuos</strong></td>
      <td colspan="2">${rmse.toFixed(4)} V</td>
      <td>Desviación cuadrática media</td>
    </tr>
    <tr>
      <td><strong>Voltaje Inicial V₀</strong></td>
      <td colspan="2">${fitData.v_0_ajustado} V</td>
      <td>Muestras analizadas: ${fitData.num_muestras}</td>
    </tr>
    <tr>
      <td><strong>Resolución ADC</strong></td>
      <td colspan="3">10 bits (cuantización nominal: ~4.89 mV / V_ref = 5.0 V)</td>
    </tr>
  `;

  if (fitData.advertencia_controlador) {
    warningBox.style.display = "block";
    warningBox.innerHTML = `⚠️ ${fitData.advertencia_controlador}`;
  } else {
    warningBox.style.display = "none";
  }

  // Gráfica de comparación Datos Reales vs Modelo Ajustado vs Residuos
  const layout = {
    title: { text: "Contraste: Muestras Experimentales vs Curva Ajustada", font: { color: "#00f0ff", size: 12 } },
    paper_bgcolor: "transparent",
    plot_bgcolor: "rgba(10, 16, 28, 0.7)",
    font: { color: "#8b9bb4", family: "Consolas, monospace" },
    margin: { l: 45, r: 20, t: 30, b: 35 },
    xaxis: { title: "Tiempo Relativo (s)", gridcolor: "rgba(70, 100, 150, 0.2)" },
    yaxis: { title: "Voltaje (V)", gridcolor: "rgba(70, 100, 150, 0.2)" },
    legend: { orientation: "h", y: 1.15 }
  };

  const traces = [
    {
      x: fitData.t_relativo,
      y: rawVoltages.slice(0, fitData.t_relativo.length),
      mode: "markers",
      name: "Muestras Experimentales A1",
      marker: { color: "#00f0ff", size: 5, opacity: 0.7 }
    },
    {
      x: fitData.t_relativo,
      y: fitData.voltaje_ajustado,
      mode: "lines",
      name: `Modelo Ajustado (τ=${tauExp}s)`,
      line: { color: "#ffb703", width: 2.5 }
    }
  ];

  Plotly.newPlot("chart-fit-comparison", traces, layout, { responsive: true, displayModeBar: false });
}
