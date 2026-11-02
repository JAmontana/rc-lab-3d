/**
 * Visualización 3D interactiva con Three.js del montaje experimental RC LAB 3D.
 * Incluye Arduino Uno conceptual, Condensador 1000uF con polaridad, Resistencia,
 * MOSFET D9, Pulsador D7, LEDs indicadores D2-D5 y Sonda A1.
 */

class CircuitScene3D {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.animationFrameId = null;

    // Elementos dinámicos en la escena
    this.capacitorCylinder = null;
    this.capacitorChargeGlow = null;
    this.ledMeshes = [];
    this.voltageTextSprite = null;

    this.init();
  }

  init() {
    const width = this.container.clientWidth || 500;
    const height = this.container.clientHeight || 420;

    // Escena
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050811);
    this.scene.fog = new THREE.FogExp2(0x050811, 0.035);

    // Cámara
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(0, 7, 12);

    // Renderizador
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    // Controles orbitales
    if (typeof THREE.OrbitControls !== 'undefined') {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.maxPolarAngle = Math.PI / 2 + 0.1;
    }

    // Iluminación
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x00f0ff, 0.8);
    dirLight.position.set(5, 10, 7);
    this.scene.add(dirLight);

    const pointLight = new THREE.PointLight(0xffffff, 0.5, 20);
    pointLight.position.set(-5, 5, 2);
    this.scene.add(pointLight);

    // Rejilla base estilo laboratorio cibernético
    const gridHelper = new THREE.GridHelper(16, 32, 0x00f0ff, 0x1a2638);
    gridHelper.position.y = -0.01;
    this.scene.add(gridHelper);

    // Construir modelos de componentes
    this.buildCircuitComponents();

    // Evento redimensionamiento
    window.addEventListener('resize', () => this.onWindowResize());

    // Loop de render
    this.animate();
  }

  buildCircuitComponents() {
    // 1. Placa base representativa (Arduino Uno)
    const pcbGeo = new THREE.BoxGeometry(4.5, 0.2, 3.2);
    const pcbMat = new THREE.MeshStandardMaterial({ color: 0x005f73, roughness: 0.4 });
    const pcb = new THREE.Mesh(pcbGeo, pcbMat);
    pcb.position.set(-3.5, 0.1, 0);
    this.scene.add(pcb);

    // Microcontrolador ATmega328P DIP
    const mcuGeo = new THREE.BoxGeometry(2.2, 0.25, 0.7);
    const mcuMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.3 });
    const mcu = new THREE.Mesh(mcuGeo, mcuMat);
    mcu.position.set(-3.5, 0.3, 0);
    this.scene.add(mcu);

    // 2. Condensador Electrolítico C = 1000uF 25V (Cilíndrico con franja negativa)
    const capGeo = new THREE.CylinderGeometry(0.7, 0.7, 2.0, 32);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x1b263b, metalness: 0.6, roughness: 0.2 });
    this.capacitorCylinder = new THREE.Mesh(capGeo, capMat);
    this.capacitorCylinder.position.set(2.5, 1.0, 0);
    this.scene.add(this.capacitorCylinder);

    // Banda plateada de polaridad negativa
    const stripeGeo = new THREE.CylinderGeometry(0.705, 0.705, 2.0, 32, 1, false, 0, Math.PI / 4);
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.9, roughness: 0.2 });
    const capStripe = new THREE.Mesh(stripeGeo, stripeMat);
    this.capacitorCylinder.add(capStripe);

    // Brillo / campo de carga del condensador
    const glowGeo = new THREE.SphereGeometry(1.2, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.05,
      wireframe: true
    });
    this.capacitorChargeGlow = new THREE.Mesh(glowGeo, glowMat);
    this.capacitorChargeGlow.position.set(2.5, 1.0, 0);
    this.scene.add(this.capacitorChargeGlow);

    // 3. Resistencia con bandas de color
    const resBodyGeo = new THREE.CylinderGeometry(0.2, 0.2, 1.2, 16);
    const resBodyMat = new THREE.MeshStandardMaterial({ color: 0xd4a373, roughness: 0.6 });
    const res = new THREE.Mesh(resBodyGeo, resBodyMat);
    res.rotation.z = Math.PI / 2;
    res.position.set(0.5, 0.5, -1.5);
    this.scene.add(res);

    // 4. MOSFET (TO-220 Pin D9)
    const mosfetGeo = new THREE.BoxGeometry(0.6, 0.9, 0.2);
    const mosfetMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 });
    const mosfet = new THREE.Mesh(mosfetGeo, mosfetMat);
    mosfet.position.set(0.5, 0.55, 1.5);
    this.scene.add(mosfet);

    // Disipador metálico TO-220
    const heatsinkGeo = new THREE.BoxGeometry(0.55, 0.4, 0.05);
    const heatsinkMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.95 });
    const heatsink = new THREE.Mesh(heatsinkGeo, heatsinkMat);
    heatsink.position.set(0.5, 0.9, 1.4);
    this.scene.add(heatsink);

    // 5. Potenciómetro A0
    const potBaseGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
    const potBaseMat = new THREE.MeshStandardMaterial({ color: 0x0077b6 });
    const pot = new THREE.Mesh(potBaseGeo, potBaseMat);
    pot.position.set(-1.0, 0.2, 2.2);
    this.scene.add(pot);

    // 6. Pulsador Físico D7
    const btnBaseGeo = new THREE.BoxGeometry(0.5, 0.3, 0.5);
    const btnBaseMat = new THREE.MeshStandardMaterial({ color: 0x2b2d42 });
    const btnMesh = new THREE.Mesh(btnBaseGeo, btnBaseMat);
    btnMesh.position.set(-2.0, 0.2, 2.2);
    this.scene.add(btnMesh);

    // 7. Los 4 LEDs físicos (D2, D3, D4, D5)
    this.ledMeshes = [];
    const ledThresholds = [1.0, 2.0, 3.0, 4.0];
    for (let i = 0; i < 4; i++) {
      const ledGeo = new THREE.SphereGeometry(0.18, 16, 16);
      const ledMat = new THREE.MeshStandardMaterial({
        color: 0x1e2638,
        emissive: 0x000000,
        roughness: 0.3
      });
      const ledMesh = new THREE.Mesh(ledGeo, ledMat);
      ledMesh.position.set(-0.8 + (i * 0.6), 0.3, 0);
      this.scene.add(ledMesh);
      this.ledMeshes.push({ mesh: ledMesh, threshold: ledThresholds[i] });
    }

    // 8. Trazas / Pistas de conexión esquemáticas
    this.buildWiring();
  }

  buildWiring() {
    // Línea conceptual A1 -> Condensador (+)
    const curveA1 = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-1.5, 0.2, 0.8), // Zona analógica Arduino
      new THREE.Vector3(0.5, 0.6, 0.4),
      new THREE.Vector3(2.5, 1.8, 0)      // Borne condensador
    ]);
    const wireGeo = new THREE.TubeGeometry(curveA1, 20, 0.04, 8, false);
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x002233 });
    const wire = new THREE.Mesh(wireGeo, wireMat);
    this.scene.add(wire);
  }

  updateFromSample(sample) {
    if (!sample) return;

    const vReal = sample.voltaje_real || 0.0;

    // Actualizar brillo y escala del condensador
    if (this.capacitorChargeGlow) {
      const scale = 1.0 + (vReal / 5.0) * 0.4;
      this.capacitorChargeGlow.scale.set(scale, scale, scale);
      this.capacitorChargeGlow.material.opacity = Math.min(0.6, 0.08 + (vReal / 5.0) * 0.35);
    }

    // Actualizar LEDs lógicos
    this.ledMeshes.forEach(item => {
      const active = vReal >= item.threshold;
      if (active) {
        item.mesh.material.color.setHex(0x00f0ff);
        item.mesh.material.emissive.setHex(0x00a8cc);
      } else {
        item.mesh.material.color.setHex(0x1e2638);
        item.mesh.material.emissive.setHex(0x000000);
      }
    });
  }

  onWindowResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  resetCamera() {
    if (this.camera && this.controls) {
      this.camera.position.set(0, 7, 12);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  focusCapacitor() {
    if (this.camera && this.controls) {
      this.camera.position.set(2.5, 2.5, 4.0);
      this.controls.target.set(2.5, 1.0, 0);
      this.controls.update();
    }
  }

  animate() {
    this.animationFrameId = requestAnimationFrame(() => this.animate());

    if (this.controls) {
      this.controls.update();
    }

    // Rotación suave del condensador
    if (this.capacitorCylinder) {
      this.capacitorCylinder.rotation.y += 0.005;
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

// Instanciar globalmente al cargar
let circuit3D = null;
let circuit3DFull = null;
document.addEventListener("DOMContentLoaded", () => {
  circuit3D = new CircuitScene3D("scene3d-canvas");
  
  // Botones de cámara
  const btnReset = document.getElementById("btn-reset-camera");
  if (btnReset) btnReset.addEventListener("click", () => {
    if (circuit3DFull) circuit3DFull.resetCamera();
    if (circuit3D) circuit3D.resetCamera();
  });

  const btnFocusCap = document.getElementById("btn-focus-cap");
  if (btnFocusCap) btnFocusCap.addEventListener("click", () => {
    if (circuit3DFull) circuit3DFull.focusCapacitor();
    if (circuit3D) circuit3D.focusCapacitor();
  });
});
