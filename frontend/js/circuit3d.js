/**
 * RC LAB 3D — Escena tridimensional del montaje.
 *
 * La escena es un esquema conceptual: no afirma conexiones físicas no
 * verificadas. Se alimenta de la misma telemetría validada que las gráficas.
 * Los símbolos + y − representan pedagógicamente la separación de cargas en
 * las placas; no son partículas que llenan el dieléctrico.
 */
(function (global) {
  "use strict";

  const Core = global.RCCore;
  const clamp = Core.clamp;

  function makeTextTexture(text, options = {}) {
    const font = options.font || "600 30px 'Segoe UI', Arial, sans-serif";
    const color = options.color || "#EDF3F5";
    const background = options.background || "rgba(16,24,32,0.88)";
    const padding = options.padding === undefined ? 14 : options.padding;
    const glow = options.glow || 0;
    const glowColor = options.glowColor || color;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(text).width) + padding * 2;
    const height = options.height || 54;
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d");
    if (background !== "transparent") {
      c.fillStyle = background;
      const radius = 10;
      c.beginPath();
      c.moveTo(radius, 0);
      c.arcTo(width, 0, width, height, radius);
      c.arcTo(width, height, 0, height, radius);
      c.arcTo(0, height, 0, 0, radius);
      c.arcTo(0, 0, width, 0, radius);
      c.closePath();
      c.fill();
    }
    c.font = font;
    if (glow > 0) {
      c.shadowBlur = glow;
      c.shadowColor = glowColor;
    }
    c.fillStyle = color;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, width / 2, height / 2 + 1);
    c.shadowBlur = 0;
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return { texture, aspect: width / height };
  }

  function makeLabel(text, options = {}) {
    const { texture, aspect } = makeTextTexture(text, options);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    const height = options.scale || 0.34;
    sprite.scale.set(height * aspect, height, 1);
    sprite.userData.label = true;
    sprite.userData.labelText = text;
    sprite.userData.labelStyle = options;
    sprite.userData.labelHeight = height;
    return sprite;
  }

  /** Regenera el texto de una etiqueta existente conservando su estilo. */
  function updateSpriteLabel(sprite, text) {
    if (!sprite || !sprite.material) return;
    const style = sprite.userData.labelStyle || {};
    const { texture, aspect } = makeTextTexture(text, style);
    if (sprite.material.map) sprite.material.map.dispose();
    sprite.material.map = texture;
    sprite.material.needsUpdate = true;
    sprite.userData.labelText = text;
    const height = sprite.userData.labelHeight || style.scale || 0.34;
    sprite.scale.set(height * aspect, height, 1);
  }

  function makeSymbolTexture(sign, color) {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 24, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(20, 32); ctx.lineTo(44, 32); // horizontal de + y −
    if (sign === "+") { ctx.moveTo(32, 20); ctx.lineTo(32, 44); }
    ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  /**
   * Textura grande y luminosa para el aura de signos. El tinte real lo aporta
   * el atributo `color` de `THREE.Points`; aquí solo se dibuja el glifo.
   */
  function makeDotTexture() {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.9)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  function makeSignTexture(sign) {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 17;
    ctx.lineCap = "round";
    ctx.shadowBlur = 16;
    ctx.shadowColor = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.moveTo(22, 64);
    ctx.lineTo(106, 64);
    if (sign === "+") {
      ctx.moveTo(64, 22);
      ctx.lineTo(64, 106);
    }
    ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  const COMPONENTS = {
    bank: {
      title: "Banco de condensadores",
      what: "Cuatro condensadores electrolíticos de 1000 µF / 25 V conectados en paralelo según la descripción del montaje.",
      role: "Almacenan carga y energía. La capacitancia equivalente nominal es 0,004 F. La tolerancia real no se ha medido.",
      kicker: "Almacenamiento",
    },
    resistor: {
      title: "Resistencia de carga 4,7 kΩ",
      what: "Resistencia que limita la corriente durante la carga del banco.",
      role: "Junto con C define τ = R · C. Con los valores nominales, τ_carga = 18,8 s. No se asume que sea la resistencia efectiva de descarga.",
      kicker: "Carga",
    },
    pot: {
      title: "Potenciómetro 50 kΩ",
      what: "Entrega una tensión variable leída por A1.",
      role: "Selecciona el voltaje techo de referencia. No modifica físicamente la capacitancia ni se ha verificado que cambie la resistencia efectiva.",
      kicker: "Referencia",
    },
    lm358: {
      title: "LM358",
      what: "Amplificador operacional configurado como seguidor de tensión.",
      role: "Acondiciona la señal de medición para que el ADC la lea con una impedancia adecuada. La topología exacta debe confirmarse en el montaje.",
      kicker: "Acondicionamiento",
    },
    arduino: {
      title: "Arduino Uno",
      what: "Microcontrolador ATmega328P con ADC de 10 bits y PWM.",
      role: "Mide A0 (voltaje del banco) y A1 (voltaje techo), controla D9 y los LEDs D2–D4, y transmite la telemetría por USB a 9600 baudios.",
      kicker: "Adquisición y control",
    },
    mosfet: {
      title: "MOSFET IRLZ44N",
      what: "Transistor de efecto de campo tipo N en encapsulado TO-220.",
      role: "Recibe la señal PWM de D9. La rampa 255 → 0 busca controlar la descarga, pero la ruta eléctrica exacta está pendiente de verificación física.",
      kicker: "Control de descarga",
    },
    button: {
      title: "Pulsador D7",
      what: "Pulsador de dos terminales con configuración INPUT_PULLUP.",
      role: "Inicia la secuencia de descarga. El firmware aplica antirrebote por software y no bloquea la telemetría.",
      kicker: "Entrada del usuario",
    },
    leds: {
      title: "LEDs indicadores",
      what: "Un LED rojo en D2 y dos amarillos en D3 y D4.",
      role: "Se encienden al 30 %, 60 % y 90 % del voltaje techo. La interfaz reproduce el estado lógico esperado; no hay sensores individuales de realimentación.",
      kicker: "Indicación visual",
    },
    divider: {
      title: "Divisor 1 MΩ / 470 kΩ",
      what: "Divisor resistivo entre el voltaje del banco y la entrada A0.",
      role: "Reduce la tensión medida. Con Vref = 5 V, el máximo medible es 15,64 V; eso no autoriza aplicar esa tensión al montaje.",
      kicker: "Medición segura",
    },
    protoboard: {
      title: "Protoboard",
      what: "Placa de 830 puntos para montar el circuito sin soldadura.",
      role: "Soporte físico del montaje. Las pistas dibujadas en la escena son conceptuales y no sustituyen el esquema eléctrico verificado.",
      kicker: "Montaje",
    },
  };

  class RCLab3D {
    constructor(containerId, options = {}) {
      this.container = document.getElementById(containerId);
      if (!this.container || typeof THREE === "undefined") {
        if (!this.container) console.warn(`No existe el contenedor ${containerId}`);
        return;
      }
      this.options = options;
      this.onSelect = options.onSelect || null;
      this.simulation = Boolean(options.simulation);
      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.controls = null;
      this.raf = null;
      this.clock = new THREE.Clock();
      this.symbols = [];
      this.capFills = [];
      this.capFillTops = [];
      this.capLabels = [];
      this.capValueLabels = [];
      this.capHalos = [];
      this.capTargetRings = [];
      this.tauRings = [];
      this.flowCurves = [];
      this.flowGeometry = null;
      this.flowPoints = {};
      this.flowParticles = [];
      this.flowMode = "S";
      this.auraPhase = 0;
      this.auraPlus = null;
      this.auraMinus = null;
      this.tauFlash = null;
      this.tauBanner = null;
      this.shockwave = null;
      this.shockwaveT = 0;
      this.resistorBody = null;
      this.resistorGlow = null;
      this.resistorPulses = null;
      this.resistorPulseT = 0;
      this.potKnob = null;
      this.potMarker = null;
      this.potReadout = null;
      this.potReadoutValue = null;
      this.displayKnobAngle = 0;
      this.displaySlope = 0;
      this._vPrev = null;
      this._tPrev = null;
      this.flowLevel = 0;
      this.flowTarget = 0;
      this.ledMeshes = [];
      this.energyFill = null;
      this.chargeFill = null;
      this.energyLabel = null;
      this.chargeLabel = null;
      this.voltageFill = null;
      this.capacitorGroup = null;
      this.selectedHelper = null;
      this.targetVoltage = 0;
      this.displayVoltage = 0;
      this.targetCeiling = 4;
      this.displayCeiling = 4;
      this.targetEnergyPct = 0;
      this.displayEnergyPct = 0;
      this.targetChargePct = 0;
      this.displayChargePct = 0;
      // Nivel de carga q(t)/Qmax que llena el núcleo interno de cada
      // condensador (0..1). Es independiente del voltaje: se alimenta con la
      // carga calculada por la fórmula del profesor o por q = C · Vc.
      this.targetChargeLevel = 0;
      this.displayChargeLevel = 0;
      this.qMaxC = 0;
      this.qTotalC = 0;
      this.perCapacitorC = [0, 0, 0, 0];
      this.perCapacitorFraction = [0, 0, 0, 0];
      this.perCapacitorMaxC = [0, 0, 0, 0];
      this.selectedCapIndex = null;
      this.stale = false;
      this.cameraTarget = null;
      this.cameraLookAt = null;
      this._raycaster = new THREE.Raycaster();
      this._pointer = new THREE.Vector2();
      this._pointerDown = null;
      this._visible = true;
      this._disposed = false;
      this.init();
    }

    init() {
      const width = this.container.clientWidth || 640;
      const height = this.container.clientHeight || 460;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x101F27);
      this.scene.fog = new THREE.Fog(0x101F27, 20, 34);

      this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 120);
      this.camera.position.set(0, 9.5, 13.5);

      this.renderer = null;
      try {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      } catch (error) {
        this.showWebGLError(error);
        return;
      }
      this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
      this.renderer.setSize(width, height);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if ("outputColorSpace" in this.renderer && THREE.SRGBColorSpace) {
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      }
      this.container.appendChild(this.renderer.domElement);

      if (THREE.OrbitControls) {
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.07;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 26;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
        this.controls.target.set(0, 1.2, 0);
        this.controls.update();
      }

      this.buildLights();
      this.buildWorld();
      this.bindEvents();
      this.animate();
      this.setView("general", true);
    }

    showWebGLError(error) {
      if (!this.container) return;
      const box = document.createElement("div");
      box.className = "scene-diagnostic";
      box.innerHTML = "<strong>WebGL no disponible</strong><p>Activa la aceleración por hardware del navegador o prueba en Chrome/Edge actualizado.</p><small></small>";
      box.querySelector("small").textContent = String(error && error.message ? error.message : error);
      this.container.appendChild(box);
    }

    buildLights() {
      this.scene.add(new THREE.HemisphereLight(0xdff8ff, 0x0a1016, 0.72));
      const key = new THREE.DirectionalLight(0xffffff, 0.95);
      key.position.set(7, 14, 9);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 40;
      key.shadow.camera.left = -12;
      key.shadow.camera.right = 12;
      key.shadow.camera.top = 12;
      key.shadow.camera.bottom = -12;
      this.scene.add(key);

      const fill = new THREE.DirectionalLight(0x26DCE0, 0.38);
      fill.position.set(-8, 7, -6);
      this.scene.add(fill);
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.28));
    }

    buildWorld() {
      // Piso de laboratorio
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(34, 26),
        new THREE.MeshStandardMaterial({ color: 0x16333E, roughness: 0.94, metalness: 0.05 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.02;
      floor.receiveShadow = true;
      this.scene.add(floor);

      const grid = new THREE.GridHelper(30, 30, 0x26DCE0, 0x27444F);
      grid.position.y = 0;
      grid.material.transparent = true;
      grid.material.opacity = 0.35;
      this.scene.add(grid);

      // Protoboard
      const board = this.makeComponent(
        new THREE.Mesh(
          new THREE.BoxGeometry(12.4, 0.32, 8.2),
          new THREE.MeshStandardMaterial({ color: 0x21404D, roughness: 0.72, metalness: 0.08 })
        ),
        "protoboard"
      );
      board.position.y = 0.16;
      board.castShadow = true;
      board.receiveShadow = true;
      this.scene.add(board);

      const boardEdge = new THREE.Mesh(
        new THREE.BoxGeometry(12.5, 0.1, 8.3),
        new THREE.MeshStandardMaterial({ color: 0x182E38, roughness: 0.75 })
      );
      boardEdge.position.y = 0.0;
      this.scene.add(boardEdge);

      this.buildArduino();
      this.buildCapacitorBank();
      this.buildResistor();
      this.buildPotentiometer();
      this.buildLM358();
      this.buildMosfet();
      this.buildButton();
      this.buildLeds();
      this.buildDivider();
      this.buildMeters();
      this.buildWires();
    }

    makeComponent(object, key) {
      const data = COMPONENTS[key];
      object.userData.component = data;
      object.userData.componentKey = key;
      object.traverse((child) => {
        if (child !== object) child.userData.component = data;
      });
      return object;
    }

    buildArduino() {
      const group = new THREE.Group();
      group.position.set(-4.35, 0.5, 2.25);
      const pcb = new THREE.Mesh(
        new THREE.BoxGeometry(3.5, 0.16, 2.4),
        new THREE.MeshStandardMaterial({ color: 0x187a7f, roughness: 0.55, metalness: 0.12 })
      );
      pcb.castShadow = true;
      group.add(pcb);

      const mcu = new THREE.Mesh(
        new THREE.BoxGeometry(1.55, 0.18, 0.52),
        new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.5, metalness: 0.2 })
      );
      mcu.position.set(-0.35, 0.17, -0.18);
      group.add(mcu);

      const usb = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.32, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xb9c2c8, roughness: 0.35, metalness: 0.75 })
      );
      usb.position.set(-1.55, 0.24, 0.72);
      group.add(usb);

      const pinHeader = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 1.9),
        new THREE.MeshStandardMaterial({ color: 0x16191c, roughness: 0.6 })
      );
      pinHeader.position.set(1.45, 0.15, -0.1);
      group.add(pinHeader);

      for (let i = 0; i < 14; i += 1) {
        const pin = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.12, 0.06),
          new THREE.MeshStandardMaterial({ color: 0xd9b64a, metalness: 0.85, roughness: 0.25 })
        );
        pin.position.set(1.45, 0.28, -0.95 + i * 0.14);
        group.add(pin);
      }

      const label = makeLabel("Arduino Uno", { scale: 0.3, color: "#0f5f63" });
      label.position.set(0, 0.9, 0);
      group.add(label);

      this.makeComponent(group, "arduino");
      group.traverse((child) => { if (child.isMesh) { child.castShadow = true; } });
      this.scene.add(group);
    }

    buildCapacitorBank() {
      const bank = new THREE.Group();
      bank.position.set(1.55, 0.34, -0.35);
      const positions = [
        [-1.05, 0, -0.85], [0.95, 0, -0.85],
        [-1.05, 0, 0.85], [0.95, 0, 0.85],
      ];
      this.capacitors = [];
      positions.forEach((pos, index) => {
        const cap = this.buildCapacitor(index);
        cap.position.set(pos[0], 0, pos[2]);
        cap.userData.capIndex = index;
        bank.add(cap);
        this.capacitors.push(cap);
      });

      const bankLabel = makeLabel("4 × 1000 µF  →  C_eq = 0,004 F", { scale: 0.34, color: "#EDF3F5" });
      bankLabel.position.set(0, 2.65, 0);
      bank.add(bankLabel);
      this.bankLabel = bankLabel;

      const chargeRingLabel = makeLabel("63,2 % · 1τ carga", { scale: 0.2, color: "#00D9FF" });
      chargeRingLabel.position.set(-1.15, 2.32, 0.2);
      bank.add(chargeRingLabel);

      const dischargeRingLabel = makeLabel("36,8 % · 1τ descarga", { scale: 0.2, color: "#FF9D32" });
      dischargeRingLabel.position.set(1.15, 2.32, 0.2);
      bank.add(dischargeRingLabel);

      const basePlate = new THREE.Mesh(
        new THREE.BoxGeometry(3.7, 0.08, 3.1),
        new THREE.MeshStandardMaterial({ color: 0x24424D, roughness: 0.85 })
      );
      basePlate.position.y = -0.12;
      basePlate.receiveShadow = true;
      bank.add(basePlate);

      this.makeComponent(bank, "bank");
      this.capacitorGroup = bank;
      this.scene.add(bank);
    }

    buildCapacitor(index) {
      const group = new THREE.Group();
      const radius = 0.62;
      const height = 1.8;
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: index % 2 === 0 ? 0x2c3e50 : 0x354a5f,
        roughness: 0.28,
        metalness: 0.35,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
      });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 36, 1, true), bodyMaterial);
      body.position.y = height / 2 + 0.02;
      body.castShadow = true;
      group.add(body);

      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.02, radius + 0.02, 0.07, 36),
        new THREE.MeshStandardMaterial({ color: 0xc6d0d5, metalness: 0.85, roughness: 0.25 })
      );
      top.position.y = height + 0.04;
      group.add(top);

      const bottom = top.clone();
      bottom.position.y = 0.008;
      group.add(bottom);

      // Franja de polaridad negativa
      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(radius + 0.012, radius + 0.012, height * 0.55, 24, 1, true, 0, Math.PI * 0.34),
        new THREE.MeshStandardMaterial({ color: 0x83939e, metalness: 0.45, roughness: 0.4, side: THREE.DoubleSide })
      );
      stripe.position.y = height * 0.5;
      group.add(stripe);

      // Placas internas y dieléctrico (esquema científico)
      const plateMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa8b1, metalness: 0.8, roughness: 0.25 });
      const platePositive = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.28, 0.045), plateMaterial);
      platePositive.position.set(0, height / 2 + 0.02, 0.16);
      group.add(platePositive);
      const plateNegative = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.28, 0.045), plateMaterial.clone());
      plateNegative.position.set(0, height / 2 + 0.02, -0.16);
      group.add(plateNegative);

      const dielectric = new THREE.Mesh(
        new THREE.BoxGeometry(0.86, 1.34, 0.24),
        new THREE.MeshStandardMaterial({ color: 0xFF963D, transparent: true, opacity: 0.2, roughness: 0.5 })
      );
      dielectric.position.set(0, height / 2 + 0.02, 0);
      group.add(dielectric);

      // Terminales
      const leadMaterial = new THREE.MeshStandardMaterial({ color: 0xb9c2c8, metalness: 0.9, roughness: 0.2 });
      const leadPositive = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 10), leadMaterial);
      leadPositive.position.set(0.18, height + 0.25, 0);
      group.add(leadPositive);
      const leadNegative = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 10), leadMaterial.clone());
      leadNegative.position.set(-0.18, height + 0.25, 0);
      group.add(leadNegative);

      // Símbolos + y −
      const plusTexture = makeSymbolTexture("+", "#B7F400");
      const minusTexture = makeSymbolTexture("−", "#83939E");
      const symbolTotal = 6;
      for (let i = 0; i < symbolTotal; i += 1) {
        const y = 0.42 + (i / Math.max(1, symbolTotal - 1)) * (height - 0.42);
        const plus = new THREE.Sprite(new THREE.SpriteMaterial({ map: plusTexture, transparent: true, opacity: 0, depthWrite: false }));
        plus.position.set(0.28, y, 0.52);
        plus.scale.set(0.24, 0.24, 1);
        plus.userData.threshold = (i + 0.5) / symbolTotal;
        plus.userData.sign = "plus";
        group.add(plus);
        this.symbols.push(plus);

        const minus = new THREE.Sprite(new THREE.SpriteMaterial({ map: minusTexture, transparent: true, opacity: 0, depthWrite: false }));
        minus.position.set(-0.28, y, -0.52);
        minus.scale.set(0.24, 0.24, 1);
        minus.userData.threshold = (i + 0.5) / symbolTotal;
        minus.userData.sign = "minus";
        group.add(minus);
        this.symbols.push(minus);
      }

      const label = makeLabel("1000 µF", { scale: 0.22, color: "#EDF3F5", font: "600 24px 'Segoe UI', Arial" });
      label.position.set(0, 0.22, 0.68);
      group.add(label);
      this.capLabels.push(label);

      // Carga individual visible sobre cada condensador: qi y su porcentaje.
      const valueLabel = makeLabel(`q${index + 1} = 0,00 mC · 0 %`, {
        scale: 0.15,
        color: "#EDF3F5",
        background: "rgba(8, 20, 26, 0.85)",
        font: "700 22px 'Cascadia Mono', Consolas, monospace",
      });
      valueLabel.position.set(0, 2.12, 0.34);
      group.add(valueLabel);
      this.capValueLabels.push(valueLabel);

      // Núcleo interno: carga visible DENTRO de la carcasa. Tres piezas:
      //  - Columna de energía (núcleo) que crece desde la base.
      //  - Superficie brillante en el nivel actual (efecto "nivel de líquido").
      //  - Halo volumétrico aditivo que aporta profundidad y brillo.
      // Nada de esto es un líquido real: es una analogía pedagógica de la
      // separación de cargas y del voltaje presente en el dieléctrico.
      const innerGlass = new THREE.Mesh(
        new THREE.CylinderGeometry(radius - 0.13, radius - 0.13, height - 0.12, 28, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0xBFE9EF, transparent: true, opacity: 0.10,
          roughness: 0.15, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false,
        })
      );
      innerGlass.position.y = height / 2 + 0.02;
      group.add(innerGlass);

      const fill = new THREE.Mesh(
        new THREE.CylinderGeometry(radius - 0.16, radius - 0.16, 1, 28, 1, false),
        new THREE.MeshStandardMaterial({
          color: 0x26DCE0,
          emissive: new THREE.Color(0x0E9AA0),
          emissiveIntensity: 0.45,
          transparent: true,
          opacity: 0.62,
          roughness: 0.35,
          depthWrite: false,
        })
      );
      fill.position.y = 0.14 + 0.5;
      fill.userData.role = "cap-fill";
      group.add(fill);
      this.capFills.push(fill);

      const fillTop = new THREE.Mesh(
        new THREE.CylinderGeometry(radius - 0.145, radius - 0.145, 0.07, 28, 1, false),
        new THREE.MeshStandardMaterial({
          color: 0xEAFBFF,
          emissive: new THREE.Color(0x26DCE0),
          emissiveIntensity: 1.6,
          transparent: true,
          opacity: 0.95,
          roughness: 0.2,
          depthWrite: false,
        })
      );
      fillTop.position.y = 0.14;
      group.add(fillTop);
      this.capFillTops.push(fillTop);

      const halo = new THREE.Mesh(
        new THREE.CylinderGeometry(radius - 0.06, radius - 0.06, 1.62, 24, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x26DCE0,
          transparent: true,
          opacity: 0.14,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      halo.position.y = 0.14 + 0.81;
      group.add(halo);
      this.capHalos.push(halo);

      // Anillo de nivel objetivo (voltaje techo seleccionado). Se mueve con
      // el potenciómetro y NO representa el voltaje medido del condensador.
      const targetRing = new THREE.Mesh(
        new THREE.TorusGeometry(radius + 0.075, 0.018, 8, 60),
        new THREE.MeshBasicMaterial({
          color: 0xF3D45C, transparent: true, opacity: 0.95, depthWrite: false,
        })
      );
      targetRing.rotation.x = Math.PI / 2;
      targetRing.position.y = 0.9;
      targetRing.userData.role = "target-ring";
      group.add(targetRing);
      this.capTargetRings.push(targetRing);

      // Anillos de referencia 63,2 % (carga) y 36,8 % (descarga).
      [
        { mode: "C", level: 0.632, color: 0x26DCE0 },
        { mode: "D", level: 0.368, color: 0xFF963D },
      ].forEach((ringInfo) => {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(radius + 0.025, 0.016, 8, 52),
          new THREE.MeshBasicMaterial({
            color: ringInfo.color,
            transparent: true,
            opacity: 0.14,
            depthWrite: false,
          })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.12 + height * ringInfo.level;
        ring.userData.role = "tau-ring";
        ring.userData.mode = ringInfo.mode;
        group.add(ring);
        this.tauRings.push(ring);
      });

      return group;
    }

    buildResistor() {
      const group = new THREE.Group();
      group.position.set(-2.35, 0.53, -0.55);
      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0xd8b27a, roughness: 0.5,
        emissive: new THREE.Color(0x26DCE0), emissiveIntensity: 0,
      });
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.17, 1.15, 20),
        bodyMaterial
      );
      body.rotation.z = Math.PI / 2;
      body.castShadow = true;
      group.add(body);

      // Halo aditivo que respira con la actividad del evento (no mide corriente).
      const glow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.215, 0.215, 1.18, 20, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x26DCE0, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
        })
      );
      glow.rotation.z = Math.PI / 2;
      group.add(glow);
      this.resistorGlow = glow;
      this.resistorBody = body;

      const bandColors = [0x8b5a2b, 0x111111, 0xd64b43, 0xd9b64a];
      bandColors.forEach((color, i) => {
        const band = new THREE.Mesh(
          new THREE.CylinderGeometry(0.178, 0.178, 0.09, 20),
          new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
        );
        band.rotation.z = Math.PI / 2;
        band.position.x = -0.34 + i * 0.22;
        group.add(band);
      });

      const leadMaterial = new THREE.MeshStandardMaterial({ color: 0xb9c2c8, metalness: 0.9, roughness: 0.2 });
      [-1, 1].forEach((sign) => {
        const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.5, 10), leadMaterial);
        lead.rotation.z = Math.PI / 2;
        lead.position.x = sign * 0.82;
        group.add(lead);
      });

      // Pulsos luminosos recorriendo los terminales según la actividad
      // (|dV/dt| normalizada). No es una medición de corriente.
      const pulseCount = 8;
      const pulseGeometry = new THREE.BufferGeometry();
      pulseGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pulseCount * 3), 3));
      const pulseMaterial = new THREE.PointsMaterial({
        map: makeDotTexture(),
        color: 0x26DCE0,
        size: 0.085,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      const pulses = new THREE.Points(pulseGeometry, pulseMaterial);
      pulses.frustumCulled = false;
      group.add(pulses);
      this.resistorPulses = { points: pulses, count: pulseCount };
      this.resistorPulseT = 0;

      const label = makeLabel("4,7 kΩ", { scale: 0.24, color: "#8a5a10" });
      label.position.set(0, 0.55, 0);
      group.add(label);

      this.makeComponent(group, "resistor");
      this.scene.add(group);
    }

    buildPotentiometer() {
      const group = new THREE.Group();
      group.position.set(-3.05, 0.48, -2.05);
      // Base mineral turquesa con dial: el mando gira según el voltaje techo
      // (ADC A1) y un marcador orbita por el arco indicando el objetivo.
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.32, 0.85),
        new THREE.MeshStandardMaterial({ color: 0x286A70, roughness: 0.5, metalness: 0.15 })
      );
      base.castShadow = true;
      group.add(base);

      // Anillo del dial (arco de 270°) grabado sobre la base.
      const dial = new THREE.Mesh(
        new THREE.TorusGeometry(0.36, 0.016, 8, 40, Math.PI * 1.5),
        new THREE.MeshStandardMaterial({ color: 0x7899A4, metalness: 0.6, roughness: 0.35, emissive: new THREE.Color(0x26DCE0), emissiveIntensity: 0.12 })
      );
      dial.rotation.x = Math.PI / 2;
      dial.rotation.z = Math.PI * 0.75;
      dial.position.y = 0.165;
      group.add(dial);

      // Marcas del dial (mín → máx, paso 0,9 V).
      for (let i = 0; i <= 4; i += 1) {
        const angle = (i / 4) * Math.PI * 1.5 - Math.PI * 0.75;
        const tick = new THREE.Mesh(
          new THREE.BoxGeometry(0.035, 0.02, 0.085),
          new THREE.MeshStandardMaterial({ color: 0xE8E7D9, emissive: new THREE.Color(0x26DCE0), emissiveIntensity: 0.35 })
        );
        tick.position.set(Math.sin(angle) * 0.36, 0.165, Math.cos(angle) * 0.36);
        tick.rotation.y = angle;
        group.add(tick);
      }

      // Marcador luminoso del objetivo sobre el arco.
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0xF3D45C, emissive: new THREE.Color(0xF3D45C), emissiveIntensity: 1.4, roughness: 0.3 })
      );
      marker.position.y = 0.2;
      group.add(marker);
      this.potMarker = marker;

      // Grupo giratorio: cuerpo del mando + puntero.
      const knobGroup = new THREE.Group();
      knobGroup.position.y = 0.16;
      const knob = new THREE.Mesh(
        new THREE.CylinderGeometry(0.27, 0.27, 0.18, 24),
        new THREE.MeshStandardMaterial({ color: 0x1B3540, roughness: 0.35, metalness: 0.3, emissive: new THREE.Color(0x26DCE0), emissiveIntensity: 0.08 })
      );
      knob.position.y = 0.09;
      knob.castShadow = true;
      knobGroup.add(knob);
      const pointer = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.035, 0.22),
        new THREE.MeshStandardMaterial({ color: 0xE8E7D9, emissive: new THREE.Color(0x26DCE0), emissiveIntensity: 0.55 })
      );
      pointer.position.set(0, 0.185, 0.0);
      pointer.geometry.translate(0, 0, 0.065);
      knobGroup.add(pointer);
      group.add(knobGroup);
      this.potKnob = knobGroup;

      // Lectura digital del techo (sprite actualizado solo cuando cambia).
      const readout = makeLabel("V techo 4,00 V", { scale: 0.24, color: "#F3D45C", background: "rgba(16,24,32,0.92)", font: "700 26px 'Cascadia Mono', Consolas, monospace" });
      readout.position.set(0, 0.82, 0);
      group.add(readout);
      this.potReadout = readout;
      this.potReadoutValue = "V techo 4,00 V";
      // Ángulo inicial según el techo objetivo por defecto.
      this.displayKnobAngle = (clamp(this.targetCeiling / 5.5, 0, 1) * 1.5 - 0.75) * Math.PI;
      const label = makeLabel("50 kΩ  ·  V techo", { scale: 0.24, color: "#16699b" });
      label.position.set(0, 0.72, 0);
      group.add(label);
      this.makeComponent(group, "pot");
      this.scene.add(group);
    }

    buildLM358() {
      const group = new THREE.Group();
      group.position.set(-1.6, 0.47, -2.35);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.78, 0.22, 0.42),
        new THREE.MeshStandardMaterial({ color: 0x171a1d, roughness: 0.55 })
      );
      body.castShadow = true;
      group.add(body);
      for (let i = 0; i < 8; i += 1) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.16, 0.04),
          new THREE.MeshStandardMaterial({ color: 0xc6d0d5, metalness: 0.85, roughness: 0.25 })
        );
        leg.position.set(-0.3 + (i % 4) * 0.2, -0.15, i < 4 ? -0.22 : 0.22);
        group.add(leg);
      }
      const label = makeLabel("LM358", { scale: 0.22, color: "#263849" });
      label.position.set(0, 0.44, 0);
      group.add(label);
      this.makeComponent(group, "lm358");
      this.scene.add(group);
    }

    buildMosfet() {
      const group = new THREE.Group();
      group.position.set(0.35, 0.55, 2.55);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.78, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.5, metalness: 0.2 })
      );
      body.castShadow = true;
      group.add(body);
      const tab = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.36, 0.04),
        new THREE.MeshStandardMaterial({ color: 0xc6d0d5, metalness: 0.9, roughness: 0.2 })
      );
      tab.position.set(0, 0.44, -0.02);
      group.add(tab);
      [-0.17, 0, 0.17].forEach((x) => {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.045, 0.28, 0.045),
          new THREE.MeshStandardMaterial({ color: 0xc6d0d5, metalness: 0.9, roughness: 0.2 })
        );
        leg.position.set(x, -0.5, 0);
        group.add(leg);
      });
      const label = makeLabel("IRLZ44N · D9", { scale: 0.22, color: "#263849" });
      label.position.set(0, 0.95, 0);
      group.add(label);
      this.makeComponent(group, "mosfet");
      this.scene.add(group);
    }

    buildButton() {
      const group = new THREE.Group();
      group.position.set(-1.55, 0.5, 2.55);
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.72, 0.24, 0.62),
        new THREE.MeshStandardMaterial({ color: 0x2b333a, roughness: 0.6 })
      );
      base.castShadow = true;
      group.add(base);
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 0.16, 20),
        new THREE.MeshStandardMaterial({ color: 0xd64b43, roughness: 0.4 })
      );
      cap.position.y = 0.2;
      group.add(cap);
      const label = makeLabel("Pulsador · D7", { scale: 0.22, color: "#a6322b" });
      label.position.set(0, 0.62, 0);
      group.add(label);
      this.makeComponent(group, "button");
      this.scene.add(group);
    }

    buildLeds() {
      const group = new THREE.Group();
      group.position.set(4.45, 0.5, 2.5);
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.12, 0.7),
        new THREE.MeshStandardMaterial({ color: 0xf8faf9, roughness: 0.8 })
      );
      board.receiveShadow = true;
      group.add(board);

      const colors = [0xd64b43, 0xe6b83f, 0xe6b83f];
      const keys = ["red", "amber60", "amber90"];
      const labels = ["30 %", "60 %", "90 %"];
      this.ledMeshes = [];
      colors.forEach((color, index) => {
        const led = new THREE.Mesh(
          new THREE.SphereGeometry(0.16, 18, 18),
          new THREE.MeshStandardMaterial({ color: 0x7c878d, emissive: new THREE.Color(color), emissiveIntensity: 0, roughness: 0.25 })
        );
        led.position.set(-0.45 + index * 0.45, 0.2, 0);
        group.add(led);
        const label = makeLabel(labels[index], { scale: 0.16, color: "#4a5d6e" });
        label.position.set(-0.45 + index * 0.45, 0.48, 0);
        group.add(label);
        this.ledMeshes.push({ mesh: led, key: keys[index], color });
      });

      const title = makeLabel("Indicadores", { scale: 0.22, color: "#263849" });
      title.position.set(0, 0.8, 0);
      group.add(title);

      this.makeComponent(group, "leds");
      this.scene.add(group);
    }

    buildDivider() {
      const group = new THREE.Group();
      group.position.set(3.15, 0.5, 2.7);
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.1, 0.55),
        new THREE.MeshStandardMaterial({ color: 0xf8faf9, roughness: 0.8 })
      );
      group.add(board);
      const r1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.7, 14),
        new THREE.MeshStandardMaterial({ color: 0x4f6d8a, roughness: 0.55 })
      );
      r1.rotation.z = Math.PI / 2;
      r1.position.set(-0.25, 0.18, 0);
      group.add(r1);
      const r2 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.5, 14),
        new THREE.MeshStandardMaterial({ color: 0x8a6a4f, roughness: 0.55 })
      );
      r2.rotation.z = Math.PI / 2;
      r2.position.set(0.38, 0.18, 0);
      group.add(r2);
      const label = makeLabel("Divisor 1 MΩ / 470 kΩ", { scale: 0.19, color: "#16699b" });
      label.position.set(0, 0.52, 0);
      group.add(label);
      this.makeComponent(group, "divider");
      this.scene.add(group);
    }

    buildMeters() {
      const group = new THREE.Group();
      group.position.set(5.35, 0.38, -1.9);

      const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xc7d3d8, roughness: 0.5, metalness: 0.25 });
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.4, 0.7), frameMaterial);
      frame.position.y = 1.7;
      frame.castShadow = true;
      group.add(frame);

      const slot = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 3.12, 0.72),
        new THREE.MeshStandardMaterial({ color: 0xeef3f4, roughness: 0.7 })
      );
      slot.position.y = 1.7;
      group.add(slot);

      const energyFill = new THREE.Mesh(
        new THREE.BoxGeometry(0.58, 1, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xB4DC55, emissive: new THREE.Color(0x3F5A12), emissiveIntensity: 0.25, roughness: 0.35 })
      );
      energyFill.position.set(0, 0.2, 0.02);
      group.add(energyFill);
      this.energyFill = energyFill;

      const chargeFill = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 1, 0.36),
        new THREE.MeshStandardMaterial({ color: 0x26DCE0, emissive: new THREE.Color(0x0E6E73), emissiveIntensity: 0.3, roughness: 0.35 })
      );
      chargeFill.position.set(0.18, 0.2, 0.36);
      group.add(chargeFill);
      this.chargeFill = chargeFill;

      const energyLabel = makeLabel("Energía", { scale: 0.2, color: "#B7F400" });
      energyLabel.position.set(-0.1, 3.62, 0);
      group.add(energyLabel);
      this.energyLabel = energyLabel;

      const chargeLabel = makeLabel("Carga", { scale: 0.16, color: "#00D9FF" });
      chargeLabel.position.set(0.42, 2.95, 0.4);
      group.add(chargeLabel);
      this.chargeLabel = chargeLabel;

      this.makeComponent(group, "bank");
      this.scene.add(group);
    }

    buildWires() {
      const wireMaterial = new THREE.LineDashedMaterial({ color: 0x6f8090, dashSize: 0.16, gapSize: 0.12, transparent: true, opacity: 0.75 });
      const paths = [
        [[-3.1, 0.55, 2.2], [-2.6, 0.8, 1.2], [-1.4, 0.9, -0.2], [0.2, 0.9, -0.5]],
        [[-3.1, 0.55, 2.0], [-3.05, 0.7, -1.3]],
        [[-1.3, 0.55, 2.5], [-1.3, 0.8, 0.4], [-1.1, 0.9, -0.2]],
        [[0.35, 0.55, 2.2], [0.5, 0.8, 1.3], [0.8, 0.9, 0.3]],
        [[-0.5, 0.55, 2.55], [2.6, 0.72, 2.5]],
        [[3.4, 0.55, 2.7], [4.1, 0.58, 2.5]],
        [[3.1, 0.55, -0.2], [3.5, 0.55, 1.8]],
      ];
      this.flowCurves = paths.map((points) => new THREE.CatmullRomCurve3(
        points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
      ));
      this.flowCurves.forEach((curve) => {
        const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
        const line = new THREE.Line(geometry, wireMaterial.clone());
        line.computeLineDistances();
        this.scene.add(line);
      });
      this.buildFlowParticles(this.flowCurves);
      this.buildSignAura();

      const note = makeLabel("Conexiones conceptuales — topología pendiente de verificación", {
        scale: 0.26,
        color: "#FF9D32",
        background: "rgba(16,24,32,0.92)",
      });
      note.position.set(0, 0.55, 4.3);
      this.scene.add(note);
    }

    /**
     * Particulas didacticas sobre las conexiones existentes. No representan
     * una topologia electrica verificada; solo el sentido convencional del
     * flujo durante carga y descarga. Las posiciones se precargan una vez y
     * se integran por fotograma; no se recrean geometrías ni materiales.
     */
    buildFlowParticles(curves) {
      const perCurve = 2;
      const total = curves.length * perCurve;
      const positions = new Float32Array(total * 3);
      this.flowParticles = [];
      let index = 0;
      curves.forEach((curve, curveIndex) => {
        for (let k = 0; k < perCurve; k += 1) {
          const offset = (k + 0.35) / perCurve;
          const point = curve.getPoint(offset);
          positions[index * 3] = point.x;
          positions[index * 3 + 1] = point.y;
          positions[index * 3 + 2] = point.z;
          this.flowParticles.push({
            curve,
            offset,
            speed: 0.09 + (curveIndex % 3) * 0.015,
          });
          index += 1;
        }
      });

      this.flowGeometry = new THREE.BufferGeometry();
      this.flowGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const makeMaterial = (color) => new THREE.PointsMaterial({
        color,
        size: 0.12,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.flowPoints.charge = new THREE.Points(this.flowGeometry, makeMaterial(0x26DCE0));
      this.flowPoints.discharge = new THREE.Points(this.flowGeometry, makeMaterial(0xFF963D));
      this.flowPoints.charge.frustumCulled = false;
      this.flowPoints.discharge.frustumCulled = false;
      this.scene.add(this.flowPoints.charge);
      this.scene.add(this.flowPoints.discharge);
    }

    /**
     * Aura de signos matemáticos alrededor del banco de condensadores.
     *
     * Dos sistemas de `THREE.Points` (sin objetos individuales adicionales):
     *  - Positivos: suben en hélice durante la carga, iluminados en verde
     *    tecnológico y cian; su densidad crece con el voltaje.
     *  - Negativos: descienden y se dispersan radialmente durante la
     *    descarga, iluminados en naranja y coral; su densidad cae con el voltaje.
     *
     * Cada sistema es dual: el 60 % forma el aura exterior (hélice alrededor
     * del banco) y el 40 % son signos interiores que suben/caen dentro de las
     * carcasas transparentes, como semillas en una columna luminosa.
     *
     * Las posiciones se precargan una sola vez y se integran por fotograma;
     * no se generan posiciones aleatorias dentro del bucle RAF. La cantidad
     * de signos visibles se controla con `setDrawRange`, no recreando
     * geometría. Es una representación educativa, no medición instrumental.
     */
    buildSignAura() {
      const COUNT = 500;
      const AURA_TOP = 2.05;
      const INNER_TOP = 1.74;
      const CAP_CENTERS = [[-1.05, -0.85], [0.95, -0.85], [-1.05, 0.85], [0.95, 0.85]];
      const RADIUS_MIN = 2.15;
      const RADIUS_SPAN = 1.1;
      const makeSystem = (sign, palette) => {
        const positions = new Float32Array(COUNT * 3);
        const colors = new Float32Array(COUNT * 3);
        const seeds = [];
        const paletteObjects = palette.map((hex) => new THREE.Color(hex));
        for (let i = 0; i < COUNT; i += 1) {
          const inner = i % 5 < 2; // 40 % dentro de las carcasas
          const seed = {
            inner,
            radius: RADIUS_MIN + (i % 14) * (RADIUS_SPAN / 13) + (i % 3) * 0.04,
            angle: (i * 2.399963229728653) + (i % 7) * 0.11,
            y: ((i * 0.61803398875) % 1) * (inner ? INNER_TOP : AURA_TOP),
            speed: 0.32 + (i % 11) * 0.028,
            drift: 0.22 + (i % 9) * 0.045,
            phase: (i % 17) * 0.37,
            cap: i % 4,
            offsetX: (((i * 37) % 9) - 4) * 0.048,
            offsetZ: (((i * 53) % 9) - 4) * 0.048,
            spin: (i % 6) * 0.9,
            sway: 0.05 + (i % 5) * 0.013,
          };
          seeds.push(seed);
          const pick = paletteObjects[i % paletteObjects.length];
          colors[i * 3] = pick.r;
          colors[i * 3 + 1] = pick.g;
          colors[i * 3 + 2] = pick.b;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geometry.setDrawRange(0, 0);
        const material = new THREE.PointsMaterial({
          map: makeSignTexture(sign),
          size: 0.28,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexColors: true,
          sizeAttenuation: true,
        });
        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        points.userData.seeds = seeds;
        points.userData.sign = sign;
        points.userData.auraTop = AURA_TOP;
        points.userData.innerTop = INNER_TOP;
        points.userData.capCenters = CAP_CENTERS;
        points.visible = false;
        return points;
      };

      this.auraPlus = makeSystem("+", [0xB4DC55, 0xB4DC55, 0x26DCE0]);
      this.auraMinus = makeSystem("-", [0xFF963D, 0xFF963D, 0xFF655B, 0x26DCE0]);
      if (this.capacitorGroup) {
        this.capacitorGroup.add(this.auraPlus);
        this.capacitorGroup.add(this.auraMinus);
      } else {
        this.scene.add(this.auraPlus);
        this.scene.add(this.auraMinus);
      }
    }

    /**
     * Integra el aura por fotograma. No crea geometrías ni materiales;
     * reutiliza los buffers precargados en `buildSignAura`.
     */
    updateSignAura(dt, voltsLevel) {
      const mode = this.flowMode;
      this.auraPhase += dt * 0.45;
      const pairs = [
        { sign: "+", system: this.auraPlus, active: mode === "C" },
        { sign: "-", system: this.auraMinus, active: mode === "D" },
      ];
      pairs.forEach(({ sign, system, active }) => {
        if (!system) return;
        const motion = this.stale ? 0 : 1;
        const targetOpacity = (active && !this.stale) ? 0.95 : (active ? 0.4 : 0);
        system.material.opacity += (targetOpacity - system.material.opacity) * Math.min(1, dt * 5);
        const visibleCount = active
          ? Math.floor(system.userData.seeds.length * clamp(voltsLevel, 0, 1))
          : 0;
        if (system.material.opacity <= 0.03) {
          system.visible = false;
          system.geometry.setDrawRange(0, 0);
          return;
        }
        system.visible = true;
        system.geometry.setDrawRange(0, Math.max(0, visibleCount));
        const seeds = system.userData.seeds;
        const top = system.userData.auraTop;
        const innerTop = system.userData.innerTop;
        const capCenters = system.userData.capCenters;
        const attribute = system.geometry.attributes.position;
        const array = attribute.array;
        for (let i = 0; i < seeds.length; i += 1) {
          const s = seeds[i];
          if (s.inner) {
            // Signos dentro de la carcasa: ascienden/caen en columna con una
            // oscilación leve. x/z fijos alrededor del centro de cada carcasa.
            const center = capCenters[s.cap];
            if (sign === "+") {
              s.y += s.speed * 0.75 * motion * dt;
              if (s.y > innerTop) s.y = 0.05;
            } else {
              s.y -= s.speed * 0.75 * motion * dt;
              if (s.y < 0.05) s.y = innerTop;
            }
            const swayA = Math.sin(this.auraPhase * 1.7 + s.spin) * s.sway;
            const swayB = Math.cos(this.auraPhase * 1.35 + s.spin * 1.7) * s.sway;
            array[i * 3] = center[0] + s.offsetX + swayA;
            array[i * 3 + 1] = s.y;
            array[i * 3 + 2] = center[1] + s.offsetZ + swayB;
            continue;
          }
          if (sign === "+") {
            s.y += s.speed * motion * dt;
            if (s.y > top) s.y = 0.04;
            const angle = s.angle + s.y * 1.7 + this.auraPhase;
            array[i * 3] = Math.cos(angle) * s.radius;
            array[i * 3 + 1] = s.y;
            array[i * 3 + 2] = Math.sin(angle) * s.radius;
          } else {
            s.y -= s.speed * motion * dt;
            s.radius += s.drift * motion * dt;
            if (s.y < 0.04 || s.radius > 3.7) {
              s.y = top;
              s.radius = 2.15 + (i % 10) * 0.09;
            }
            const angle = s.angle + s.y * 1.7 - this.auraPhase;
            array[i * 3] = Math.cos(angle) * s.radius;
            array[i * 3 + 1] = s.y;
            array[i * 3 + 2] = Math.sin(angle) * s.radius;
          }
        }
        attribute.needsUpdate = true;
      });
    }

    /**
     * Resistencia viva: halo y pulsos puntuales recorriendo los terminales.
     * La actividad se normaliza desde |dV/dt| del propio banco; NO es una
     * medición de corriente ni se presentan amperios inventados.
     */
    updateResistor(dt) {
      const slope = this.displaySlope || 0;
      const mode = this.flowMode;
      const active = mode === "C" || mode === "D";
      const modeColor = mode === "D" ? 0xFF963D : 0x26DCE0;
      if (this.stale) this.displaySlope = Math.max(0, slope - dt * 0.35);

      if (this.resistorBody) {
        this.resistorBody.material.emissive.setHex(modeColor);
        const target = active ? 0.06 + slope * 0.55 : 0.03;
        this.resistorBody.material.emissiveIntensity +=
          (target - this.resistorBody.material.emissiveIntensity) * Math.min(1, dt * 6);
      }
      if (this.resistorGlow) {
        this.resistorGlow.material.color.setHex(modeColor);
        const target = active ? 0.08 + slope * 0.75 : 0.015;
        this.resistorGlow.material.opacity +=
          (target - this.resistorGlow.material.opacity) * Math.min(1, dt * 6);
      }
      if (this.resistorPulses) {
        const dir = mode === "D" ? -1 : 1;
        const speed = 0.22 + slope * 1.5;
        this.resistorPulseT = (this.resistorPulseT + dir * speed * dt) % 1;
        if (this.resistorPulseT < 0) this.resistorPulseT += 1;
        const attribute = this.resistorPulses.points.geometry.attributes.position;
        const array = attribute.array;
        for (let i = 0; i < this.resistorPulses.count; i += 1) {
          const phase = (this.resistorPulseT + i / this.resistorPulses.count) % 1;
          array[i * 3] = -0.82 + phase * 1.64;
          array[i * 3 + 1] = 0;
          array[i * 3 + 2] = 0;
        }
        attribute.needsUpdate = true;
        const targetOpacity = active ? 0.3 + slope * 0.7 : 0;
        this.resistorPulses.points.material.opacity +=
          (targetOpacity - this.resistorPulses.points.material.opacity) * Math.min(1, dt * 6);
        this.resistorPulses.points.material.color.setHex(modeColor);
      }
    }

    /**
     * Potenciómetro vivo: el mando gira con el techo seleccionado (A1), el
     * marcador orbita por el arco y la lectura digital se actualiza cuando
     * cambia. El nivel interno del banco NO reacciona al giro del mando:
     * solo el anillo objetivo amarillo se mueve.
     */
    updatePotentiometer(dt) {
      const frac = clamp(this.displayCeiling / 5.5, 0, 1);
      const targetAngle = (frac * 1.5 - 0.75) * Math.PI;
      this.displayKnobAngle += (targetAngle - this.displayKnobAngle) * Math.min(1, dt * 6);

      if (this.potKnob) this.potKnob.rotation.y = this.displayKnobAngle;
      if (this.potMarker) {
        this.potMarker.position.set(
          Math.sin(this.displayKnobAngle) * 0.36,
          0.185,
          Math.cos(this.displayKnobAngle) * 0.36
        );
        this.potMarker.material.emissiveIntensity = 1.1 + 0.6 * Math.sin(this.animTime * 4.2);
      }

      // Lectura digital: solo reconstruir el sprite cuando cambia el texto.
      const value = this.displayCeiling;
      const text = `V techo ${value.toFixed(2).replace(".", ",")} V`;
      if (this.potReadout && this.potReadoutValue !== text) {
        const parent = this.potReadout.parent;
        const position = this.potReadout.position.clone();
        parent.remove(this.potReadout);
        if (this.potReadout.material.map) this.potReadout.material.map.dispose();
        this.potReadout.material.dispose();
        const label = makeLabel(text, {
          scale: 0.24,
          color: "#F3D45C",
          background: "rgba(16,24,32,0.92)",
          font: "700 26px 'Cascadia Mono', Consolas, monospace",
        });
        label.position.copy(position);
        parent.add(label);
        this.potReadout = label;
        this.potReadoutValue = text;
      }
    }

    /**
     * Efecto protagonista al alcanzar 1τ: anillo pulsante y etiqueta central.
     * La adquisición y el almacenamiento continúan con normalidad.
     */
    flashTau(event) {
      if (!event) return;
      const mode = event.mode === "CARGA" ? "C" : "D";
      this.tauFlash = {
        mode,
        elapsed: 0,
        time_s: Number(event.time_s) || 0,
        percent: Number(event.percent) || (mode === "C" ? 63.2 : 36.8),
      };
      const timeFormatted = `${(Number(event.time_s) || 0).toFixed(2)} s`;
      const label = makeLabel(
        `1τ · ${mode === "C" ? "63,2 %" : "36,8 %"}  ·  t = ${timeFormatted}`,
        {
          scale: 0.42,
          color: mode === "C" ? "#B4DC55" : "#FF963D",
          background: "rgba(16,24,32,0.94)",
          font: "800 30px 'Segoe UI', Arial, sans-serif",
        }
      );
      if (this.tauBanner) {
        this.scene.remove(this.tauBanner);
        if (this.tauBanner.material && this.tauBanner.material.map) {
          this.tauBanner.material.map.dispose();
        }
        this.tauBanner.material.dispose();
      }
      // Onda expansiva: anillo aditivo que nace en el banco y se desvanece.
      if (this.shockwave) {
        this.scene.remove(this.shockwave);
        this.shockwave.geometry.dispose();
        this.shockwave.material.dispose();
      }
      this.shockwave = new THREE.Mesh(
        new THREE.TorusGeometry(1.35, 0.03, 8, 56),
        new THREE.MeshBasicMaterial({
          color: mode === "C" ? 0x26DCE0 : 0xFF963D,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      this.shockwave.rotation.x = Math.PI / 2;
      this.shockwave.position.set(this.capacitorGroup ? this.capacitorGroup.position.x : 0, 1.0, this.capacitorGroup ? this.capacitorGroup.position.z : 0);
      this.shockwaveT = 0;
      this.scene.add(this.shockwave);

      label.position.set(0, 3.65, 0);
      this.tauBanner = label;
      this.scene.add(label);
    }

    updateFromSample(sample) {
      if (!sample) return;
      const derived = sample.derived || {};
      const voltage = Number(sample.voltaje_tanque);
      const ceiling = Number(sample.voltaje_techo);
      this.targetVoltage = Number.isFinite(voltage) ? voltage : this.targetVoltage;
      this.targetCeiling = Number.isFinite(ceiling) && ceiling > 0.05 ? ceiling : this.targetCeiling;
      this.targetEnergyPct = clamp(Number(derived.energyPct) || 0, 0, 100);
      this.targetChargePct = clamp(Number(derived.voltagePct) || 0, 0, 100);

      // Nivel de llenado = q(t)/Qmax. Si el proveedor entrega la fracción de
      // carga se usa directamente; si no, se reconstruye como Vc/Ve (válido
      // para condensadores en paralelo que comparten el mismo voltaje).
      const chargeLevel = Number(derived.chargeFraction);
      if (Number.isFinite(chargeLevel)) {
        this.targetChargeLevel = clamp(chargeLevel, 0, 1);
      } else if (this.targetCeiling > 0.05) {
        this.targetChargeLevel = clamp(this.targetVoltage / this.targetCeiling, 0, 1);
      } else {
        this.targetChargeLevel = 0;
      }
      if (Number.isFinite(Number(derived.qMaxC))) this.qMaxC = Math.max(0, Number(derived.qMaxC));
      if (Number.isFinite(Number(derived.chargeC))) this.qTotalC = Math.max(0, Number(derived.chargeC));
      if (Array.isArray(derived.perCapacitorC)) {
        this.perCapacitorC = derived.perCapacitorC.slice(0, 4).map((q) => Number(q) || 0);
      }
      if (Array.isArray(derived.perCapacitorFraction)) {
        this.perCapacitorFraction = derived.perCapacitorFraction.slice(0, 4).map((f) => clamp(Number(f) || 0, 0, 1));
      }
      if (Array.isArray(derived.perCapacitorMaxC)) {
        this.perCapacitorMaxC = derived.perCapacitorMaxC.slice(0, 4).map((q) => Number(q) || 0);
      }
      this.flowMode = sample.estado === "D" ? "D" : (sample.estado === "C" ? "C" : "S");
      this.flowTarget = this.flowMode === "S" ? 0 : 1;
      // Actividad del evento como |dV/dt| normalizada (2,5 V/s = máxima actividad visual).
      const timeRel = Number(sample.t_rel);
      if (Number.isFinite(voltage) && Number.isFinite(timeRel)) {
        if (this._tPrev !== null && this._vPrev !== null) {
          const dtSample = Math.max(0.05, timeRel - this._tPrev);
          const raw = Math.abs(voltage - this._vPrev) / dtSample;
          const norm = clamp(raw / 0.8, 0, 1);
          this.displaySlope += (norm - this.displaySlope) * 0.35;
        }
        this._vPrev = voltage;
        this._tPrev = timeRel;
      }
      const leds = derived.leds || {
        red: this.targetVoltage >= this.targetCeiling * 0.3,
        amber60: this.targetVoltage >= this.targetCeiling * 0.6,
        amber90: this.targetVoltage >= this.targetCeiling * 0.9,
      };
      this.ledMeshes.forEach((item) => {
        item.mesh.userData.on = Boolean(leds[item.key]);
      });
      this.stale = false;
      if (this.options.onDerived) this.options.onDerived(sample);
    }

    setStale(stale) {
      this.stale = Boolean(stale);
    }

    /**
     * Estado de carga explícito para la escena. Lo usan tanto la simulación
     * como el montaje físico, de modo que el nivel interior de los cuatro
     * condensadores siempre corresponde a q(t)/Qmax.
     *
     * state = {
     *   level, perCapacitorC, perCapacitorFraction, perCapacitorMaxC,
     *   qTotalC, qMaxC, voltage, ceiling, mode
     * }
     */
    setChargeState(state) {
      if (!state) return;
      if (Number.isFinite(Number(state.level))) {
        this.targetChargeLevel = clamp(Number(state.level), 0, 1);
      } else if (Number(state.qMaxC) > 0 && Number.isFinite(Number(state.qTotalC))) {
        this.targetChargeLevel = clamp(Number(state.qTotalC) / Number(state.qMaxC), 0, 1);
      }
      if (Number.isFinite(Number(state.qTotalC))) this.qTotalC = Math.max(0, Number(state.qTotalC));
      if (Number.isFinite(Number(state.qMaxC))) this.qMaxC = Math.max(0, Number(state.qMaxC));
      if (Array.isArray(state.perCapacitorC)) {
        this.perCapacitorC = state.perCapacitorC.slice(0, 4).map((q) => Number(q) || 0);
      }
      if (Array.isArray(state.perCapacitorFraction)) {
        this.perCapacitorFraction = state.perCapacitorFraction.slice(0, 4).map((f) => clamp(Number(f) || 0, 0, 1));
      }
      if (Array.isArray(state.perCapacitorMaxC)) {
        this.perCapacitorMaxC = state.perCapacitorMaxC.slice(0, 4).map((q) => Number(q) || 0);
      }
      if (Number.isFinite(Number(state.voltage))) this.targetVoltage = Number(state.voltage);
      if (Number.isFinite(Number(state.ceiling)) && Number(state.ceiling) > 0.05) {
        this.targetCeiling = Number(state.ceiling);
      }
      if (state.mode) {
        const mode = String(state.mode).toUpperCase();
        this.flowMode = mode === "D" || mode === "DESCARGA" ? "D"
          : (mode === "C" || mode === "CARGA" ? "C" : "S");
        this.flowTarget = this.flowMode === "S" ? 0 : 1;
      }
      this.updateCapValueLabels();
      this.stale = false;
    }

    /** Carga individual qi y porcentaje sobre cada condensador 3D. */
    updateCapValueLabels() {
      if (!Array.isArray(this.capValueLabels)) return;
      const fmt = (value, digits) => {
        const n = Number(value);
        return Number.isFinite(n) ? n.toFixed(digits).replace(".", ",") : "—";
      };
      this.capValueLabels.forEach((label, index) => {
        const q = Number(this.perCapacitorC[index]) || 0;
        const fraction = Number(this.perCapacitorFraction[index]) || 0;
        const text = `q${index + 1} = ${fmt(q * 1000, 2)} mC · ${fmt(fraction * 100, 0)} %`;
        if (label.userData.labelText !== text) updateSpriteLabel(label, text);
      });
    }

    getChargeSnapshot() {
      return {
        qTotalC: this.qTotalC,
        qMaxC: this.qMaxC,
        level: this.targetChargeLevel,
        perCapacitorC: this.perCapacitorC.slice(),
        perCapacitorFraction: this.perCapacitorFraction.slice(),
        perCapacitorMaxC: this.perCapacitorMaxC.slice(),
        voltage: this.targetVoltage,
        ceiling: this.targetCeiling,
        mode: this.flowMode,
      };
    }

    /**
     * Actualiza las etiquetas 3D cuando cambian C_eq o el reparto nominal.
     * Así la escena no afirma "1000 µF" si el usuario configuró otro banco.
     */
    setCapacitance(totalF, parts) {
      const total = Number(totalF);
      if (!(total > 0)) return;
      const list = Array.isArray(parts) && parts.length === 4
        ? parts.map((value) => Number(value) || 0)
        : [total / 4, total / 4, total / 4, total / 4];
      const micro = (value) => {
        const uf = Math.max(0, Number(value) || 0) * 1e6;
        return Math.abs(uf - Math.round(uf)) < 0.05
          ? String(Math.round(uf))
          : uf.toFixed(1).replace(".", ",");
      };
      const farad = (value) => (value >= 1 ? value.toFixed(2) : value.toFixed(4)).replace(".", ",");
      const equal = list.every((value) => Math.abs(value - list[0]) < 1e-15);
      const prefix = equal ? `4 × ${micro(list[0])} µF → ` : "Banco → ";
      updateSpriteLabel(this.bankLabel, `${prefix}C_eq = ${farad(total)} F`);
      this.capLabels.forEach((sprite, index) => updateSpriteLabel(sprite, `${micro(list[index] || 0)} µF`));
    }

    setSimulation(isSimulation) {
      this.simulation = Boolean(isSimulation);
    }

    setView(name, immediate = false) {
      const views = {
        general: { pos: [0, 9.5, 13.5], target: [0, 1.2, 0] },
        capacitor: { pos: [3.6, 3.1, 5.2], target: [1.55, 1.3, -0.35] },
        guided: { pos: [-2.2, 6.2, 10.5], target: [0.7, 1.3, 0] },
      };
      const view = views[name] || views.general;
      if (immediate || !this.controls) {
        this.camera.position.set(...view.pos);
        if (this.controls) {
          this.controls.target.set(...view.target);
          this.controls.update();
        }
      } else {
        this.cameraTarget = new THREE.Vector3(...view.pos);
        this.cameraLookAt = new THREE.Vector3(...view.target);
      }
    }

    bindEvents() {
      this._onPointerDown = (event) => {
        this._pointerDown = { x: event.clientX, y: event.clientY };
      };
      this._onPointerUp = (event) => {
        if (!this._pointerDown) return;
        const dx = event.clientX - this._pointerDown.x;
        const dy = event.clientY - this._pointerDown.y;
        this._pointerDown = null;
        if (Math.hypot(dx, dy) > 6) return;
        this.pick(event);
      };
      this.renderer.domElement.addEventListener("pointerdown", this._onPointerDown);
      this.renderer.domElement.addEventListener("pointerup", this._onPointerUp);

      this._onResize = () => this.resize();
      if (global.ResizeObserver) {
        this._resizeObserver = new ResizeObserver(() => this.resize());
        this._resizeObserver.observe(this.container);
      } else {
        global.addEventListener("resize", this._onResize);
      }

      if (global.IntersectionObserver) {
        this._intersection = new IntersectionObserver((entries) => {
          this._visible = entries[0] ? entries[0].isIntersecting : true;
        }, { threshold: 0.05 });
        this._intersection.observe(this.container);
      }
    }

    pick(event) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this._raycaster.setFromCamera(this._pointer, this.camera);
      const intersections = this._raycaster.intersectObjects(this.scene.children, true);
      const hit = intersections.find((item) => item.object.userData && item.object.userData.component);
      if (!hit) {
        this.clearSelection();
        return;
      }

      // ¿Se seleccionó uno de los cuatro condensadores? Se informa su carga
      // individual qi(t) = Ci · Vc en lugar de la ficha genérica del banco.
      let capNode = hit.object;
      while (capNode && capNode.userData && capNode.userData.capIndex === undefined) capNode = capNode.parent;
      if (capNode && capNode.userData && capNode.userData.capIndex !== undefined) {
        this.selectedCapIndex = capNode.userData.capIndex;
        this.select(capNode);
        if (this.options.onCapacitorSelect) {
          this.options.onCapacitorSelect(capNode.userData.capIndex, this.getChargeSnapshot());
        }
        return;
      }

      let root = hit.object;
      let component = root.userData.component;
      while (root.parent && !root.userData.componentKey) root = root.parent;
      if (root.userData.component) component = root.userData.component;
      this.select(root);
      if (this.options.onSelect) this.options.onSelect(component || null);
    }

    select(object) {
      this.clearSelection();
      if (!object) return;
      try {
        const helper = new THREE.BoxHelper(object, 0x26DCE0);
        helper.material.depthTest = false;
        helper.material.transparent = true;
        helper.material.opacity = 0.9;
        this.scene.add(helper);
        this.selectedHelper = helper;
      } catch (error) {
        console.warn("No se pudo resaltar el componente", error);
      }
    }

    clearSelection() {
      if (this.selectedHelper) {
        this.scene.remove(this.selectedHelper);
        if (this.selectedHelper.geometry) this.selectedHelper.geometry.dispose();
        if (this.selectedHelper.material) this.selectedHelper.material.dispose();
        this.selectedHelper = null;
      }
    }

    resize() {
      if (!this.container || !this.renderer || !this.camera) return;
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      if (width < 10 || height < 10) return;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    }

    animate() {
      if (this._disposed) return;
      this.raf = requestAnimationFrame(() => this.animate());
      if (!this._visible) return;

      const dt = Math.min(0.12, this.clock.getDelta());
      this.animTime = (this.animTime || 0) + dt;
      const smoothing = 1 - Math.exp(-dt * 7);
      this.displayVoltage += (this.targetVoltage - this.displayVoltage) * smoothing;
      this.displayCeiling += (this.targetCeiling - this.displayCeiling) * smoothing;
      this.displayEnergyPct += (this.targetEnergyPct - this.displayEnergyPct) * smoothing;
      this.displayChargePct += (this.targetChargePct - this.displayChargePct) * smoothing;
      this.displayChargeLevel += (this.targetChargeLevel - this.displayChargeLevel) * smoothing;

      const voltsLevel = clamp(this.displayVoltage / 5.5, 0, 1);
      const chargeLevel = clamp(this.displayChargeLevel, 0, 1);
      const energyLevel = voltsLevel * voltsLevel;
      const energyFraction = clamp(this.displayEnergyPct / 100, 0, 1);

      this.symbols.forEach((symbol) => {
        const threshold = symbol.userData.threshold;
        const distance = voltsLevel - threshold;
        let opacity = clamp((distance + 0.10) / 0.20, 0, 1);
        if (symbol.userData.sign === "minus") opacity *= 0.92;
        if (this.stale) opacity *= 0.45;
        symbol.material.opacity = opacity;
        const scale = 0.16 + 0.11 * opacity;
        symbol.scale.set(scale, scale, 1);
      });

      if (this.energyFill) {
        const height = Math.max(0.001, 3.08 * energyLevel);
        this.energyFill.scale.y = height;
        this.energyFill.position.y = 0.16 + height / 2;
        this.energyFill.material.emissiveIntensity = 0.12 + energyLevel * 0.55;
      }
      if (this.chargeFill) {
        const height = Math.max(0.001, 3.08 * voltsLevel);
        this.chargeFill.scale.y = height;
        this.chargeFill.position.y = 0.16 + height / 2;
        this.chargeFill.material.emissiveIntensity = 0.12 + voltsLevel * 0.5;
      }

      // Núcleo interno de cada condensador: crece desde la base y cambia de
      // color según el sentido del intercambio de carga. El nivel representa
      // SOLO el voltaje medido (escala 0–5,5 V); el potenciómetro mueve el
      // anillo objetivo, no el nivel real.
      const discharge = this.flowMode === "D";
      const fillColor = discharge ? 0xFF963D : 0x26DCE0;
      const fillEmissive = discharge ? 0xC2500A : 0x0E9AA0;
      const topEmissive = discharge ? 0xFFC79A : 0xC4FBFF;
      const haloColor = discharge ? 0xFF963D : 0x26DCE0;
      this.capFills.forEach((fill, index) => {
        // Nivel individual: qi/qmax_i. Si no se conoce la fracción propia se
        // usa la fracción del banco q/Qmax. El núcleo crece desde abajo.
        const own = Number(this.perCapacitorFraction[index]);
        const level = clamp(Number.isFinite(own) ? own : chargeLevel, 0, 1);
        const height = Math.max(0.001, 1.6 * level);
        fill.scale.y = height;
        fill.position.y = 0.14 + height / 2;
        fill.material.color.setHex(fillColor);
        fill.material.emissive.setHex(fillEmissive);
        fill.material.emissiveIntensity = 0.35 + level * 1.15;
        fill.material.opacity = 0.40 + level * 0.50;
        const top = this.capFillTops[index];
        if (top) {
          top.position.y = 0.14 + height + 0.028;
          top.material.color.setHex(topEmissive);
          top.material.emissive.setHex(fillColor);
          top.material.emissiveIntensity = 0.6 + level * 2.4;
          top.material.opacity = 0.55 + level * 0.45;
          const surfaceScale = 0.85 + level * 0.15;
          top.scale.set(surfaceScale, 1, surfaceScale);
        }
        const halo = this.capHalos[index];
        if (halo) {
          halo.material.color.setHex(haloColor);
          halo.material.opacity = 0.04 + level * 0.24;
        }
        const target = this.capTargetRings[index];
        if (target) {
          const ceilingLevel = clamp(this.displayCeiling / 5.5, 0, 1);
          target.position.y = 0.14 + 1.6 * ceilingLevel;
          target.material.opacity = 0.55 + 0.35 * Math.sin(this.animTime * 3.2);
        }
      });

      // Anillos 63,2 % / 36,8 %: se iluminan al acercarse al punto y al
      // activarse el modo correspondiente; pulsan cuando se alcanza 1τ.
      const flash = this.tauFlash;
      this.tauRings.forEach((ring) => {
        const level = ring.userData.mode === "C" ? 0.632 : 0.368;
        const matches = ring.userData.mode === this.flowMode;
        const near = Math.abs(chargeLevel - level) < 0.055;
        let opacity = (matches ? 0.45 : 0.10) + (near ? 0.45 : 0);
        let scale = 1;
        if (flash && flash.mode === ring.userData.mode && flash.elapsed < 3.4) {
          const decay = 1 - flash.elapsed / 3.4;
          const pulse = 0.5 + 0.5 * Math.sin(flash.elapsed * 9);
          opacity = Math.min(1, opacity + pulse * 0.55 * decay);
          scale = 1 + pulse * 0.09 * decay;
        }
        ring.material.opacity = opacity;
        ring.material.color.setHex(ring.userData.mode === "C" ? 0x26DCE0 : 0xFF963D);
        ring.scale.set(scale, scale, scale);
      });

      // Resistencia viva: halo y pulsos según la actividad |dV/dt| (no mide corriente).
      this.updateResistor(dt);

      // Potenciómetro vivo: el mando gira, el marcador orbita y la lectura cambia.
      this.updatePotentiometer(dt);

      // Onda expansiva al alcanzar 1τ.
      if (this.shockwave) {
        this.shockwaveT += dt;
        const t = this.shockwaveT / 1.15;
        if (t >= 1) {
          this.scene.remove(this.shockwave);
          this.shockwave.geometry.dispose();
          this.shockwave.material.dispose();
          this.shockwave = null;
        } else {
          const eased = 1 - Math.pow(1 - t, 2.2);
          this.shockwave.scale.set(1 + eased * 2.6, 1 + eased * 2.6, 1 + eased * 2.6);
          this.shockwave.material.opacity = 0.85 * (1 - t);
        }
      }

      // Aura de signos matemáticos del banco de condensadores.
      this.updateSignAura(dt, Math.max(chargeLevel, voltsLevel * 0.35));

      // Ciclo de vida de la etiqueta central "1τ alcanzado".
      if (this.tauFlash) {
        this.tauFlash.elapsed += dt;
        const elapsed = this.tauFlash.elapsed;
        if (this.tauBanner) {
          const fadeIn = Math.min(1, elapsed / 0.3);
          const fadeOut = elapsed > 3.3 ? Math.max(0, 1 - (elapsed - 3.3) / 0.8) : 1;
          this.tauBanner.material.opacity = fadeIn * fadeOut;
        }
        if (elapsed > 4.2) {
          if (this.tauBanner) {
            this.scene.remove(this.tauBanner);
            if (this.tauBanner.material.map) this.tauBanner.material.map.dispose();
            this.tauBanner.material.dispose();
            this.tauBanner = null;
          }
          this.tauFlash = null;
        }
      }

      // Partículas conceptuales por los cables, en el mismo bucle RAF.
      this.flowLevel += ((this.stale ? 0 : this.flowTarget) - this.flowLevel) * Math.min(1, dt * 4);
      if (this.flowGeometry && this.flowLevel > 0.04 && this.flowMode !== "S") {
        const direction = this.flowMode === "D" ? -1 : 1;
        const attribute = this.flowGeometry.attributes.position;
        const array = attribute.array;
        this.flowParticles.forEach((particle, index) => {
          particle.offset = (particle.offset + direction * particle.speed * dt * (0.5 + this.flowLevel)) % 1;
          if (particle.offset < 0) particle.offset += 1;
          const point = particle.curve.getPoint(particle.offset);
          array[index * 3] = point.x;
          array[index * 3 + 1] = point.y;
          array[index * 3 + 2] = point.z;
        });
        attribute.needsUpdate = true;
      }
      if (this.flowPoints.charge) {
        this.flowPoints.charge.material.opacity = this.flowMode === "C" ? 0.25 + 0.7 * this.flowLevel : 0;
      }
      if (this.flowPoints.discharge) {
        this.flowPoints.discharge.material.opacity = this.flowMode === "D" ? 0.25 + 0.7 * this.flowLevel : 0;
      }

      this.ledMeshes.forEach((item) => {
        const on = Boolean(item.mesh.userData.on);
        const target = on ? 1.4 : 0;
        item.mesh.material.emissiveIntensity += (target - item.mesh.material.emissiveIntensity) * Math.min(1, dt * 9);
        item.mesh.material.color.setHex(on ? item.color : 0x7c878d);
      });

      if (this.cameraTarget && this.controls) {
        this.camera.position.lerp(this.cameraTarget, Math.min(1, dt * 4.5));
        this.controls.target.lerp(this.cameraLookAt, Math.min(1, dt * 4.5));
        if (this.camera.position.distanceTo(this.cameraTarget) < 0.03) {
          this.camera.position.copy(this.cameraTarget);
          this.controls.target.copy(this.cameraLookAt);
          this.cameraTarget = null;
          this.cameraLookAt = null;
        }
      }

      if (this.controls) this.controls.update();
      if (this.selectedHelper) this.selectedHelper.update();
      this.renderer.render(this.scene, this.camera);
    }

    dispose() {
      this._disposed = true;
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this.controls) this.controls.dispose();
      if (this._resizeObserver) this._resizeObserver.disconnect();
      if (this._intersection) this._intersection.disconnect();
      if (this.renderer) {
        this.renderer.dispose();
        if (this.renderer.domElement && this.renderer.domElement.parentNode) {
          this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
      }
      if (this.scene) {
        this.scene.traverse((object) => {
          if (object.geometry) object.geometry.dispose();
          if (object.material) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
              if (material.map) material.map.dispose();
              material.dispose();
            });
          }
        });
      }
    }
  }

  global.RCLab3D = RCLab3D;
  global.RC_COMPONENTS = COMPONENTS;
})(typeof globalThis !== "undefined" ? globalThis : this);
