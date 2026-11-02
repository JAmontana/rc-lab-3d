/**
 * Simulador RC Independiente.
 * No contamina datos de adquisición física ni altera variables del hardware.
 */

document.addEventListener("DOMContentLoaded", () => {
  const btnRunSim = document.getElementById("btn-run-sim");
  if (!btnRunSim) return;

  btnRunSim.addEventListener("click", async () => {
    const modo = document.getElementById("sim-mode").value;
    const rOhm = parseFloat(document.getElementById("sim-r").value) || 1000.0;
    const cFarad = parseFloat(document.getElementById("sim-c").value) || 0.001;
    const vS = parseFloat(document.getElementById("sim-vs").value) || 5.0;
    const v0 = parseFloat(document.getElementById("sim-v0").value) || 0.0;
    const tFinal = parseFloat(document.getElementById("sim-tfinal").value) || 5.0;

    btnRunSim.innerText = "⏳ Simulando...";

    try {
      const resp = await fetch("/api/math/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modo: modo,
          r_ohm: rOhm,
          c_farad: cFarad,
          v_s: vS,
          v_0: v0,
          t_final: tFinal
        })
      });

      const data = await resp.json();
      btnRunSim.innerText = "▶ Simular Curvas Ideales";

      if (data.error) {
        alert("Error en simulación: " + data.error);
        return;
      }

      plotSimulationResults(data);
    } catch (e) {
      btnRunSim.innerText = "▶ Simular Curvas Ideales";
      alert("Error al conectar con la API de simulación: " + e);
    }
  });
});

function plotSimulationResults(simData) {
  const layout = {
    title: {
      text: `Respuesta Teórica RC Ideal [Modo: ${simData.modo} | τ = ${simData.tau_segundos.toFixed(3)} s]`,
      font: { color: "#00f0ff", size: 13, family: "Consolas, monospace" }
    },
    paper_bgcolor: "transparent",
    plot_bgcolor: "rgba(10, 16, 28, 0.7)",
    font: { color: "#8b9bb4", family: "Consolas, monospace" },
    margin: { l: 50, r: 50, t: 40, b: 40 },
    xaxis: { title: "Tiempo t (segundos)", gridcolor: "rgba(70, 100, 150, 0.2)" },
    yaxis: { title: "Voltaje V_C(t) (V)", gridcolor: "rgba(70, 100, 150, 0.2)", range: [-0.2, 5.5] },
    yaxis2: {
      title: "Corriente I(t) (mA)",
      overlaying: "y",
      side: "right",
      gridcolor: "transparent"
    },
    legend: { orientation: "h", y: 1.15 }
  };

  // Convertir corriente a mA
  const i_mA = simData.corriente.map(i => i * 1000.0);

  const traces = [
    {
      x: simData.tiempo,
      y: simData.voltaje,
      name: "V_C(t) [Voltios]",
      line: { color: "#00f0ff", width: 2.5 }
    },
    {
      x: simData.tiempo,
      y: i_mA,
      name: "I_C(t) [mA]",
      yaxis: "y2",
      line: { color: "#ffb703", width: 1.8, dash: "dot" }
    }
  ];

  Plotly.newPlot("chart-simulator-area", traces, layout, { responsive: true, displayModeBar: false });
}
