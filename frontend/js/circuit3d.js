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
    const color = options.color || "#263849";
    const background = options.background || "rgba(255,255,255,0.9)";
    const padding = options.padding === undefined ? 14 : options.padding;
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
    c.fillStyle = color;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, width / 2, height / 2 + 1);
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
    return sprite;
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
      this.scene.background = new THREE.Color(0xeaf0f1);
      this.scene.fog = new THREE.Fog(0xeaf0f1, 18, 30);

      this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 120);
      this.camera.position.set(0, 9.5, 13.5);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
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

    buildLights() {
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb2bd, 0.9));
      const key = new THREE.DirectionalLight(0xffffff, 1.05);
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

      const fill = new THREE.DirectionalLight(0xbfe3f5, 0.45);
      fill.position.set(-8, 7, -6);
      this.scene.add(fill);
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    }

    buildWorld() {
      // Piso de laboratorio
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(34, 26),
        new THREE.MeshStandardMaterial({ color: 0xdde5e6, roughness: 0.95, metalness: 0 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.02;
      floor.receiveShadow = true;
      this.scene.add(floor);

      const grid = new THREE.GridHelper(30, 30, 0xb9c8ce, 0xcfdadd);
      grid.position.y = 0;
      grid.material.transparent = true;
      grid.material.opacity = 0.55;
      this.scene.add(grid);

      // Protoboard
      const board = this.makeComponent(
        new THREE.Mesh(
          new THREE.BoxGeometry(12.4, 0.32, 8.2),
          new THREE.MeshStandardMaterial({ color: 0xf8faf9, roughness: 0.7 })
        ),
        "protoboard"
      );
      board.position.y = 0.16;
      board.castShadow = true;
      board.receiveShadow = true;
      this.scene.add(board);

      const boardEdge = new THREE.Mesh(
        new THREE.BoxGeometry(12.5, 0.1, 8.3),
        new THREE.MeshStandardMaterial({ color: 0xd7e0e2, roughness: 0.75 })
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
        bank.add(cap);
      });

      const bankLabel = makeLabel("4 × 1000 µF  →  C_eq = 0,004 F", { scale: 0.34, color: "#16699b" });
      bankLabel.position.set(0, 2.65, 0);
      bank.add(bankLabel);

      const basePlate = new THREE.Mesh(
        new THREE.BoxGeometry(3.7, 0.08, 3.1),
        new THREE.MeshStandardMaterial({ color: 0xe8eef0, roughness: 0.8 })
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
        new THREE.MeshStandardMaterial({ color: 0x258bc7, metalness: 0.4, roughness: 0.4, side: THREE.DoubleSide })
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
        new THREE.MeshStandardMaterial({ color: 0xe6b83f, transparent: true, opacity: 0.24, roughness: 0.5 })
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
      const plusTexture = makeSymbolTexture("+", "#d64b43");
      const minusTexture = makeSymbolTexture("−", "#258bc7");
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

      const label = makeLabel("1000 µF", { scale: 0.22, color: "#263849", font: "600 24px 'Segoe UI', Arial" });
      label.position.set(0, 0.22, 0.68);
      group.add(label);

      return group;
    }

    buildResistor() {
      const group = new THREE.Group();
      group.position.set(-2.35, 0.53, -0.55);
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.17, 1.15, 20),
        new THREE.MeshStandardMaterial({ color: 0xd8b27a, roughness: 0.65 })
      );
      body.rotation.z = Math.PI / 2;
      body.castShadow = true;
      group.add(body);

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

      const label = makeLabel("4,7 kΩ", { scale: 0.24, color: "#8a5a10" });
      label.position.set(0, 0.55, 0);
      group.add(label);

      this.makeComponent(group, "resistor");
      this.scene.add(group);
    }

    buildPotentiometer() {
      const group = new THREE.Group();
      group.position.set(-3.05, 0.48, -2.05);
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.32, 0.85),
        new THREE.MeshStandardMaterial({ color: 0x2e6f98, roughness: 0.55 })
      );
      base.castShadow = true;
      group.add(base);
      const knob = new THREE.Mesh(
        new THREE.CylinderGeometry(0.27, 0.27, 0.18, 24),
        new THREE.MeshStandardMaterial({ color: 0x1b2b38, roughness: 0.4 })
      );
      knob.position.y = 0.23;
      group.add(knob);
      const pointer = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.04, 0.2),
        new THREE.MeshStandardMaterial({ color: 0xf1f3f2 })
      );
      pointer.position.set(0, 0.33, 0.09);
      group.add(pointer);
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
        this.ledMeshes.push({ mesh: led, key, color });
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
        new THREE.MeshStandardMaterial({ color: 0x36a878, emissive: new THREE.Color(0x0d5c3c), emissiveIntensity: 0.25, roughness: 0.35 })
      );
      energyFill.position.set(0, 0.2, 0.02);
      group.add(energyFill);
      this.energyFill = energyFill;

      const chargeFill = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 1, 0.36),
        new THREE.MeshStandardMaterial({ color: 0x258bc7, emissive: new THREE.Color(0x0b4a6e), emissiveIntensity: 0.3, roughness: 0.35 })
      );
      chargeFill.position.set(0.18, 0.2, 0.36);
      group.add(chargeFill);
      this.chargeFill = chargeFill;

      const energyLabel = makeLabel("Energía", { scale: 0.2, color: "#196d4d" });
      energyLabel.position.set(-0.1, 3.62, 0);
      group.add(energyLabel);
      this.energyLabel = energyLabel;

      const chargeLabel = makeLabel("Carga", { scale: 0.16, color: "#16699b" });
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
      paths.forEach((points) => {
        const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
        const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
        const line = new THREE.Line(geometry, wireMaterial.clone());
        line.computeLineDistances();
        this.scene.add(line);
      });

      const note = makeLabel("Conexiones conceptuales — topología pendiente de verificación", {
        scale: 0.26,
        color: "#8a6508",
        background: "rgba(253,245,223,0.92)",
      });
      note.position.set(0, 0.55, 4.3);
      this.scene.add(note);
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
        const helper = new THREE.BoxHelper(object, 0x258bc7);
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
      const smoothing = 1 - Math.exp(-dt * 7);
      this.displayVoltage += (this.targetVoltage - this.displayVoltage) * smoothing;
      this.displayCeiling += (this.targetCeiling - this.displayCeiling) * smoothing;
      this.displayEnergyPct += (this.targetEnergyPct - this.displayEnergyPct) * smoothing;
      this.displayChargePct += (this.targetChargePct - this.displayChargePct) * smoothing;

      const fraction = clamp(this.displayVoltage / Math.max(this.displayCeiling, 0.15), 0, 1);
      const energyFraction = clamp(this.displayEnergyPct / 100, 0, 1);
      const chargeFraction = clamp(this.displayChargePct / 100, 0, 1);

      this.symbols.forEach((symbol) => {
        const threshold = symbol.userData.threshold;
        const distance = fraction - threshold;
        let opacity = clamp((distance + 0.10) / 0.20, 0, 1);
        if (symbol.userData.sign === "minus") opacity *= 0.92;
        if (this.stale) opacity *= 0.45;
        symbol.material.opacity = opacity;
        const scale = 0.16 + 0.11 * opacity;
        symbol.scale.set(scale, scale, 1);
      });

      if (this.energyFill) {
        const height = Math.max(0.001, 3.08 * energyFraction);
        this.energyFill.scale.y = height;
        this.energyFill.position.y = 0.16 + height / 2;
        this.energyFill.material.emissiveIntensity = 0.12 + energyFraction * 0.55;
      }
      if (this.chargeFill) {
        const height = Math.max(0.001, 3.08 * chargeFraction);
        this.chargeFill.scale.y = height;
        this.chargeFill.position.y = 0.16 + height / 2;
        this.chargeFill.material.emissiveIntensity = 0.12 + chargeFraction * 0.5;
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
