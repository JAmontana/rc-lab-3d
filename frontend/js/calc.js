/**
 * RC LAB 3D — Panel «Comprueba el cálculo».
 *
 * Convierte el modelo RC ya calculado (gráfica, HUD y escena 3D) en el
 * procedimiento de papel que un estudiante puede copiar:
 *   1 datos y unidades · 2 Ceq · 3 Req · 4 τ · 5 Qmax ·
 *   6 ecuación · 7 sustitución · 8 resultado en C y mC.
 *
 * No mide, no calibra y no inventa valores. Si falta un parámetro escribe
 * «Dato pendiente de configurar». El laboratorio en vivo y la simulación
 * comparten el mismo panel mediante un prefijo de IDs.
 */
(function (global) {
  "use strict";

  const Core = global.RCCore || null;

  function trimZeros(text) {
    if (!text.includes(",")) return text;
    return text.replace(/0+$/, "").replace(/,$/, "");
  }

  function fmt(value, digits = 2) {
    if (!Number.isFinite(Number(value))) return "—";
    return trimZeros(Number(value).toFixed(digits).replace(".", ","));
  }

  function groupThousands(value) {
    const fixed = Number(value).toFixed(0);
    return fixed.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  function fmtR(value) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) return "—";
    if (Math.abs(Number(value) - Math.round(Number(value))) < 1e-6) {
      return `${groupThousands(value)} Ω`;
    }
    return `${fmt(value, 2)} Ω`;
  }

  function fmtC(value) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) return "—";
    const farads = Number(value);
    return `${fmt(farads, farads >= 1 ? 4 : 6)} F`;
  }

  function fmtUf(valueFarads) {
    if (!Number.isFinite(Number(valueFarads)) || Number(valueFarads) <= 0) return "—";
    return `${fmt(Number(valueFarads) * 1e6, 2)} µF`;
  }

  function fmtV(value) {
    if (!Number.isFinite(Number(value))) return "—";
    return `${fmt(value, 2)} V`;
  }

  function fmtSeconds(value) {
    if (!Number.isFinite(Number(value))) return "—";
    return `${fmt(value, 2)} s`;
  }

  function fmtCoulombs(value) {
    if (!Number.isFinite(Number(value))) return "—";
    const abs = Math.abs(Number(value));
    const digits = abs > 0 && abs < 1e-4 ? 7 : abs < 0.01 ? 6 : 5;
    return `${fmt(value, digits)} C`;
  }

  function fmtMc(coulombs) {
    if (!Number.isFinite(Number(coulombs))) return "—";
    // Dos decimales fijos: en el resultado final el estudiante necesita ver
    // la misma precisión aunque el último decimal sea cero.
    return `${(Number(coulombs) * 1000).toFixed(2).replace(".", ",")} mC`;
  }

  function setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
  }

  function setHtml(id, html) {
    const element = document.getElementById(id);
    if (element) element.innerHTML = html;
  }

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function finite(value) {
    return value === null || value === undefined || value === ""
      ? null
      : (Number.isFinite(Number(value)) ? Number(value) : null);
  }

  function sameNumber(a, b) {
    if (!(Number.isFinite(Number(a)) && Number.isFinite(Number(b)))) return false;
    const scale = Math.max(1, Math.abs(Number(a)), Math.abs(Number(b)));
    return Math.abs(Number(a) - Number(b)) <= scale * 1e-6;
  }

  /**
   * Elige la ecuación correcta según el proceso y la condición inicial.
   * Devuelve HTML porque la exponencial lleva superíndice.
   */
  function equationFor(data, qMaxC, q0C, qInfC) {
    const discharge = String(data.mode || "CARGA").toUpperCase() === "DESCARGA";
    const tolerance = Math.max(1e-12, Math.abs(Number(qMaxC) || 0) * 1e-9);
    const startsEmpty = Math.abs(Number(q0C) || 0) <= tolerance;
    const endsEmpty = Math.abs(Number(qInfC) || 0) <= tolerance;

    if (discharge && endsEmpty) {
      return {
        html: "q(t) = Q₀ · e<sup>−t/τ</sup>",
        general: false,
        qRefC: q0C,
        qRefLabel: "Q₀ = Ceq × V₀",
      };
    }
    if (!discharge && startsEmpty) {
      return {
        html: "q(t) = Q<sub>max</sub> · (1 − e<sup>−t/τ</sup>)",
        general: false,
        qRefC: qMaxC,
        qRefLabel: "Qmax = Ceq × Ve",
      };
    }
    return {
      html: "q(t) = Q∞ + (Q₀ − Q∞) · e<sup>−t/τ</sup>",
      general: true,
      qRefC: Math.max(Math.abs(Number(q0C) || 0), Math.abs(Number(qInfC) || 0)),
      qRefLabel: discharge ? "Q₀ = Ceq × V₀" : "Qmax = Ceq × Ve",
    };
  }

  function substitutionFor(data, equation, tau, qMaxC, q0C, qInfC, qC) {
    const t = Math.max(0, Number(data.t) || 0);
    if (!(tau > 0)) return null;

    if (!equation.general && String(data.mode || "CARGA").toUpperCase() !== "DESCARGA") {
      return `q(${fmtSeconds(t)}) = ${fmtCoulombs(qMaxC)} × (1 − e^(−${fmt(t, 2)} s / ${fmt(tau, 2)} s))`
        + ` = ${fmtCoulombs(qC)} = ${fmtMc(qC)}`;
    }
    if (!equation.general) {
      return `q(${fmtSeconds(t)}) = ${fmtCoulombs(q0C)} × e^(−${fmt(t, 2)} s / ${fmt(tau, 2)} s)`
        + ` = ${fmtCoulombs(qC)} = ${fmtMc(qC)}`;
    }
    return `q(${fmtSeconds(t)}) = ${fmtCoulombs(qInfC)} + (${fmtCoulombs(q0C)} − ${fmtCoulombs(qInfC)})`
      + ` × e^(−${fmt(t, 2)} s / ${fmt(tau, 2)} s) = ${fmtCoulombs(qC)} = ${fmtMc(qC)}`;
  }

  function update(prefix, data) {
    if (!data) return;
    const discharge = String(data.mode || "CARGA").toUpperCase() === "DESCARGA";
    const summary = data.summary || null;

    const c = positive(data.c);
    const rCharge = positive(data.rCharge !== undefined ? data.rCharge : data.r);
    const rDischarge = positive(data.rDischarge);
    const r = discharge ? rDischarge : rCharge;
    const ve = positive(data.ve);
    const v0 = finite(data.v0);
    const t = Math.max(0, Number(data.t) || 0);
    const qC = Number(data.qC);
    const hasQ = data.qC !== null && data.qC !== undefined && Number.isFinite(qC);

    const qMaxC = positive(data.qMaxC) || (c && ve ? c * ve : null);
    const q0C = finite(data.q0C) !== null
      ? finite(data.q0C)
      : (c && v0 !== null ? c * v0 : null);
    const qInfC = finite(data.qInfC) !== null
      ? finite(data.qInfC)
      : (discharge ? 0 : qMaxC);

    const tau = positive(data.tau)
      || (Core && r && c ? Core.tauOf(r, c) : null);

    const missing = [];
    if (!(c > 0)) missing.push("Ceq");
    if (!(r > 0)) missing.push(discharge ? "Req de descarga" : "Req de carga");
    if (!(ve > 0) && !(discharge && q0C > 0)) missing.push("Ve");

    const badge = document.getElementById(`${prefix}-badge`);
    if (badge) badge.textContent = data.source || "REFERENCIA";

    // ----------------------------------------------------------------
    // 1 · Datos y unidades
    // ----------------------------------------------------------------
    const veDisplay = discharge && v0 !== null ? v0 : ve;
    const veNote = discharge
      ? (data.v0Note || "voltaje inicial del proceso")
      : (data.veNote || "voltaje de referencia");
    setText(`${prefix}-ve`, fmtV(veDisplay));
    setText(`${prefix}-ve-note`, veNote);
    setText(`${prefix}-t`, fmtSeconds(t));
    setText(`${prefix}-r`, rCharge ? fmtR(rCharge) : "—");
    setText(`${prefix}-r-note`, rCharge
      ? (summary && summary.reqCargaSource === "medido" ? "resistencia medida" : "valor configurado")
      : "Dato pendiente de configurar");
    setText(`${prefix}-rd`, rDischarge ? fmtR(rDischarge) : "—");
    setText(`${prefix}-rd-note`, rDischarge
      ? (summary && summary.reqDescargaSource === "medido" ? "resistencia medida" : "valor configurado")
      : "Dato pendiente de configurar");
    setText(`${prefix}-c`, c ? fmtC(c) : "—");
    setText(`${prefix}-c-note`, c
      ? (summary && summary.ceqSource === "medido" ? "capacitancia medida" : "calculada desde los componentes")
      : "Dato pendiente de configurar");
    setText(`${prefix}-components`, (summary && summary.componentsText)
      || data.componentsText
      || "Valores del modelo de simulación (no componentes físicos)");

    // ----------------------------------------------------------------
    // 2 · Ceq
    // ----------------------------------------------------------------
    const ceqFormula = summary && sameNumber(summary.ceq, c)
      ? summary.ceqFormula
      : (c ? `Ceq = ${fmtC(c)} = ${fmtUf(c)} (equivalente configurado)` : null);
    setText(`${prefix}-ceq`, ceqFormula || "Dato pendiente de configurar: añade al menos un condensador.");

    // ----------------------------------------------------------------
    // 3 · Req
    // ----------------------------------------------------------------
    const reqFormula = summary
      ? (discharge ? summary.reqDescargaFormula : summary.reqCargaFormula)
      : null;
    const reqValue = discharge ? summary && summary.reqDescarga : summary && summary.reqCarga;
    const reqText = reqFormula && sameNumber(reqValue, r)
      ? reqFormula
      : (r ? `Req = ${fmtR(r)} (resistencia del proceso)` : null);
    setText(`${prefix}-req`, reqText || "Dato pendiente de configurar: falta la resistencia del proceso.");

    // ----------------------------------------------------------------
    // 4 · τ = Req · Ceq
    // ----------------------------------------------------------------
    setText(
      `${prefix}-tau`,
      tau > 0
        ? `τ = Req × Ceq = ${fmtR(r)} × ${fmtC(c)} = ${fmtSeconds(tau)}`
        : "Dato pendiente de configurar: completa Req y Ceq."
    );

    // ----------------------------------------------------------------
    // 5 · Qmax = Ceq · Ve (o Q0 en descarga)
    // ----------------------------------------------------------------
    let qmaxText;
    if (discharge) {
      const q0Ref = q0C !== null && q0C >= 0 ? q0C : null;
      qmaxText = c && v0 !== null && q0Ref !== null
        ? `Q₀ = Ceq × V₀ = ${fmtC(c)} × ${fmtV(v0)} = ${fmtCoulombs(q0Ref)} = ${fmtMc(q0Ref)}`
          + (qMaxC > 0 ? ` · Qmax con Ve = ${fmtMc(qMaxC)}` : "")
        : "Dato pendiente de configurar: falta la carga inicial o el voltaje inicial.";
    } else {
      qmaxText = c && ve
        ? `Qmax = Ceq × Ve = ${fmtC(c)} × ${fmtV(ve)} = ${fmtCoulombs(qMaxC)} = ${fmtMc(qMaxC)}`
        : "Dato pendiente de configurar: completa Ceq y Ve.";
    }
    setText(`${prefix}-qmax`, qmaxText);

    // ----------------------------------------------------------------
    // 6 · Ecuación
    // ----------------------------------------------------------------
    const equation = equationFor(data, qMaxC, q0C, qInfC);
    setHtml(`${prefix}-formula`, equation.html);

    // ----------------------------------------------------------------
    // 7 · Sustitución
    // ----------------------------------------------------------------
    const substitution = hasQ && tau > 0
      ? substitutionFor(data, equation, tau, qMaxC, q0C, qInfC, qC)
      : null;
    setText(`${prefix}-subst`, substitution
      || "Dato pendiente de configurar: completa Req, Ceq y el voltaje de referencia.");

    // ----------------------------------------------------------------
    // 8 · Resultado en C y mC
    // ----------------------------------------------------------------
    // Sin τ no hay resultado teórico: el cálculo queda pendiente aunque la
    // muestra física exista. La medición q_exp se muestra en la comparación.
    const theoreticalReady = hasQ && tau > 0;
    const resultC = theoreticalReady ? fmtCoulombs(qC) : "—";
    const resultMc = theoreticalReady ? fmtMc(qC) : "—";
    setText(`${prefix}-result`, resultC);
    setText(`${prefix}-result-mc`, resultMc);
    setText(`${prefix}-result-step`, theoreticalReady
      ? `q(${fmtSeconds(t)}) = ${resultC} = ${resultMc}`
      : "Dato pendiente de configurar.");

    const base = discharge ? (q0C || 0) : (qMaxC || 0);
    const pct = theoreticalReady && base > 0 ? Math.max(0, (qC / base) * 100) : null;
    setText(`${prefix}-pct`, pct === null
      ? "—"
      : `${fmt(pct, 1)} % ${discharge ? "de la carga inicial" : "de Qmax"}`
        + (equation.general ? " · condición inicial distinta de cero" : ""));

    // ----------------------------------------------------------------
    // Comparación teoría / experimento
    // ----------------------------------------------------------------
    const theoryC = hasQ && tau > 0 ? qC : null;
    setText(`${prefix}-theory`, theoryC === null ? "—" : fmtMc(theoryC));

    const measured = data.measured;
    const hasMeasured = measured && Number.isFinite(Number(measured.qC));
    const expC = hasMeasured ? Number(measured.qC) : null;
    setText(`${prefix}-exp`, hasMeasured
      ? fmtMc(expC)
      : (data.synthetic ? "— (sintético)" : "Dato pendiente de configurar"));

    let diffC = null;
    if (hasMeasured && theoryC !== null) {
      diffC = expC - theoryC;
      const sign = diffC >= 0 ? "+" : "−";
      setText(`${prefix}-diff`, `${sign}${fmtMc(Math.abs(diffC))}`);
    } else {
      setText(`${prefix}-diff`, "—");
    }

    const compare = document.getElementById(`${prefix}-compare`);
    if (compare) {
      compare.classList.toggle("is-physical", hasMeasured && !data.synthetic);
      if (hasMeasured) {
        const origin = data.synthetic ? "Datos sintéticos de simulación" : "Medición del Arduino";
        const pieces = [
          `${origin}: q_exp = Ceq × Vc = ${fmtC(c)} × ${fmtV(measured.voltage)} = ${fmtMc(expC)}`,
        ];
        if (Number.isFinite(Number(measured.time))) {
          pieces.push(`muestra en t = ${fmtSeconds(measured.time)}`);
        }
        if (diffC !== null) {
          const sign = diffC >= 0 ? "+" : "−";
          pieces.push(`Diferencia = ${sign}${fmtMc(Math.abs(diffC))}`);
        }
        if (data.synthetic) {
          pieces.push("Estos datos no son mediciones del Arduino.");
        } else if (missing.length) {
          pieces.push("Comparación provisional: faltan parámetros por confirmar.");
        } else {
          pieces.push("La diferencia puede deberse a tolerancias, a la medición y al comportamiento real del circuito.");
        }
        compare.textContent = pieces.join(" · ");
      } else if (data.synthetic) {
        compare.textContent =
          "SIMULACIÓN — DATOS SINTÉTICOS. No hay medición experimental que comparar: usa la gráfica y el resultado teórico para practicar.";
      } else if (data.nominal) {
        compare.textContent =
          "Sin medición real todavía: la curva es nominal (SIMULACIÓN). Conecta el Arduino o usa el Modo prueba para comparar q = Ceq × Vc.";
      } else {
        compare.textContent =
          "Dato pendiente de configurar: todavía no hay una muestra física válida para comparar.";
      }
    }

    const warning = document.getElementById(`${prefix}-warning`);
    if (warning) {
      if (missing.length) {
        warning.textContent = `Dato pendiente de configurar: ${missing.join(", ")}.`;
        warning.classList.remove("hidden");
      } else {
        warning.classList.add("hidden");
      }
    }
  }

  global.RCCalc = { update };
})(typeof window !== "undefined" ? window : globalThis);
