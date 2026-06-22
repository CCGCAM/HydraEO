const THREE_URL = "https://esm.sh/three@0.167.1";
const EZ_TREE_URL = "https://esm.sh/@dgreenheck/ez-tree@1.1.0?deps=three@0.167.1";
const GLTF_LOADER_URL = "https://esm.sh/three@0.167.1/examples/jsm/loaders/GLTFLoader.js?deps=three@0.167.1";
const EZ_TREE_MODEL_BASE_URL = "assets/vendor/ez-tree/models";
const EZ_TREE_GROUND_TEXTURE_BASE_URL = "assets/vendor/ez-tree/textures/ground";

const EZ_TREE_PRESET = {
  seed: 36330,
  type: "evergreen",
  bark: {
    type: "willow",
    tint: 13552830,
    flatShading: false,
    textured: true,
    textureScale: { x: 0.5, y: 5 }
  },
  branch: {
    levels: 2,
    angle: { 1: 63, 2: 48, 3: 60 },
    children: { 0: 42, 1: 6, 2: 3 },
    force: {
      direction: { x: 1, y: 1, z: 1 },
      strength: -0.023
    },
    gnarliness: { 0: 0, 1: -0.1, 2: 0.2, 3: -0.5 },
    length: { 0: 33.4, 1: 31.7, 2: 15.1, 3: 0.1 },
    radius: { 0: 1.98, 1: 0.59, 2: 0.76, 3: 0.7 },
    sections: { 0: 4, 1: 8, 2: 6, 3: 4 },
    segments: { 0: 12, 1: 7, 2: 3, 3: 3 },
    start: { 1: 0.23, 2: 0.33, 3: 0 },
    taper: { 0: 0.72, 1: 0.7, 2: 0.7, 3: 0.7 },
    twist: { 0: 0.09, 1: -0.07, 2: 0, 3: 0 }
  },
  leaves: {
    type: "aspen",
    billboard: "single",
    angle: 64,
    count: 16,
    start: 0,
    size: 2.67,
    sizeVariance: 0.72,
    tint: 3064446,
    alphaTest: 0.5,
    roundedNormals: true
  },
  trellis: {
    enabled: false,
    position: { x: 0, y: 0, z: -2 },
    width: 10,
    height: 20,
    spacing: 2,
    force: {
      strength: 0.02,
      maxDistance: 3,
      falloff: 1
    },
    cylinderRadius: 0.05,
    visible: true,
    color: 9127187
  }
};

/**
 * Initialize the browser-only pistachio canopy scene.
 * The returned update method receives derived biophysical parameters only;
 * visual mesh state is never used to compute reflectance.
 */
export async function initPistachioCanopyScene(canvas, options = {}) {
  const statusNode = options.statusNode;
  const loadingOverlay = createLoadingOverlay(canvas.parentElement);
  canvas.hidden = true;
  setTreeStatus(statusNode, "Loading EZ-Tree runtime, tree and grass assets...");
  let THREE;
  try {
    THREE = await importWithTimeout(THREE_URL, 10000);
  } catch (error) {
    loadingOverlay.remove();
    return startFallbackCanvas(canvas, statusNode);
  }
  const ezTree = await createEzTreePistachio(THREE);
  if (!ezTree.loaded) {
    loadingOverlay.remove();
    return startFallbackCanvas(canvas, statusNode);
  }
  loadingOverlay.remove();
  canvas.hidden = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x94b9f8, 0.0015);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 220);
  const root = new THREE.Group();
  scene.add(root);

  const environment = await createEzTreeEnvironment(THREE);
  scene.add(environment.object);

  const treeRoot = new THREE.Group();
  root.add(treeRoot);

  treeRoot.add(ezTree.object);
  let lastLeafState = null;
  let leafUpdateTimer = 0;

  frameScene(THREE, camera, root);

  const resizeObserver = new ResizeObserver(() => resizeRenderer(renderer, camera, canvas));
  resizeObserver.observe(canvas.parentElement);
  resizeRenderer(renderer, camera, canvas);

  let latestParameters = null;
  let frameId = 0;
  const startTime = performance.now();
  setTreeStatus(statusNode, "Visual canopy: EZ-Tree pistachio-style tree driven by biophysical parameters. Spectrum computed separately.");

  function animate(now) {
    frameId = requestAnimationFrame(animate);
    const wind = Math.sin((now - startTime) * 0.00055) * 0.012;
    treeRoot.rotation.z = wind;
    updateEzTreeEnvironment(environment, (now - startTime) * 0.001);
    renderer.render(scene, camera);
  }
  animate(performance.now());

  return {
    update(derivedBiophysicalParameters) {
      latestParameters = derivedBiophysicalParameters;
      lastLeafState = updatePistachioCanopyVisuals(treeRoot, ezTree.object, environment, derivedBiophysicalParameters, lastLeafState, () => {
        clearTimeout(leafUpdateTimer);
        leafUpdateTimer = setTimeout(() => {
          regenerateEzTreeLeaves(THREE, ezTree.object, latestParameters);
          frameScene(THREE, camera, root);
        }, 80);
      });
      updateEnvironmentParameters(environment, derivedBiophysicalParameters);
      frameScene(THREE, camera, root);
    },
    setCameraMode(mode) {
      setCameraMode(THREE, camera, root, mode);
    },
    dispose() {
      cancelAnimationFrame(frameId);
      clearTimeout(leafUpdateTimer);
      resizeObserver.disconnect();
      disposeObject3d(root);
      disposeObject3d(environment.object);
      renderer.dispose();
      latestParameters = null;
    }
  };
}

function importWithTimeout(url, timeoutMs) {
  return Promise.race([
    import(url),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out loading ${url}`)), timeoutMs);
    })
  ]);
}

function createLoadingOverlay(parent) {
  const overlay = document.createElement("div");
  overlay.className = "ps-tree-loading";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  const marker = document.createElement("span");
  const title = document.createElement("strong");
  const detail = document.createElement("small");
  title.textContent = "Loading EZ-Tree scene";
  detail.textContent = "Generating tree and loading grass asset";
  overlay.append(marker, title, detail);
  parent.append(overlay);
  return overlay;
}

function startFallbackCanvas(canvas, statusNode) {
  const fallbackCanvas = document.createElement("canvas");
  fallbackCanvas.className = "ps-fallback-canvas";
  canvas.hidden = true;
  canvas.parentElement.insertBefore(fallbackCanvas, canvas);
  return initCanvasPistachioFallback(fallbackCanvas, statusNode);
}

function setTreeStatus(statusNode, message) {
  if (statusNode) statusNode.textContent = message;
}

async function createEzTreePistachio(THREE) {
  try {
    const ezTreeModule = await importWithTimeout(EZ_TREE_URL, 10000);
    const Tree = ezTreeModule.Tree ?? ezTreeModule.default?.Tree ?? ezTreeModule.default;
    if (typeof Tree !== "function") throw new Error("EZ-Tree module did not expose Tree.");
    const tree = new Tree();
    configureEzTreeOptions(tree.options ?? {});
    tree.generate();
    tree.scale.setScalar(0.105);
    tree.rotation.y = -0.28;
    tree.traverse?.((item) => {
      if (item.isMesh) {
        item.castShadow = true;
        item.receiveShadow = true;
      }
    });
    normalizeObjectToGround(THREE, tree);
    return { object: tree, loaded: true };
  } catch (error) {
    return { object: createFallbackPistachioTree(THREE), loaded: false };
  }
}

function configureEzTreeOptions(options) {
  mergeTreeOptions(options, EZ_TREE_PRESET);
}

function mergeTreeOptions(target, source) {
  Object.entries(source).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = target[key] && typeof target[key] === "object" ? target[key] : {};
      mergeTreeOptions(target[key], value);
      return;
    }
    target[key] = value;
  });
}

function createFallbackPistachioTree(THREE) {
  const group = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: 0x74685a, roughness: 0.92 });
  const branchGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
  const trunk = cylinderBetween(THREE, branchGeometry, bark, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3.1, 0), 0.28);
  group.add(trunk);
  for (let i = 0; i < 32; i += 1) {
    const angle = i * 2.399963;
    const startY = 1.4 + (i % 7) * 0.22;
    const length = 1.4 + seededFraction(i) * 1.9;
    const start = new THREE.Vector3(0, startY, 0);
    const end = new THREE.Vector3(Math.cos(angle) * length, startY + 0.45 + seededFraction(i + 21) * 1.25, Math.sin(angle) * length * 0.82);
    group.add(cylinderBetween(THREE, branchGeometry, bark, start, end, 0.055 * (1 - i / 48)));
  }
  group.traverse((item) => {
    if (item.isMesh) {
      item.castShadow = true;
      item.receiveShadow = true;
    }
  });
  return group;
}

async function createEzTreeEnvironment(THREE) {
  const object = new THREE.Group();
  object.name = "EZ-Tree Environment";
  const skybox = createSkybox(THREE);
  const ground = await createGroundLayer(THREE);
  const grass = await createGrassLayer(THREE);
  const rocks = await createRocksLayer(THREE);
  const clouds = createClouds(THREE);
  clouds.object.position.set(0, 90, 0);
  clouds.object.rotation.x = Math.PI / 2;
  object.add(skybox.object, ground.object, grass.object, rocks.object, clouds.object);
  return { object, skybox, ground, grass, rocks, clouds };
}

function createSkybox(THREE) {
  const uniforms = {
    uSunAzimuth: { value: 90 },
    uSunElevation: { value: 30 },
    uSunColor: { value: new THREE.Color(0xffdd6e) },
    uSkyColorLow: { value: new THREE.Color(0xc8e2ff) },
    uSkyColorHigh: { value: new THREE.Color(0x66a8ff) },
    uSunSize: { value: 2.4 }
  };
  const object = new THREE.Mesh(
    new THREE.SphereGeometry(900, 64, 32),
    new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vPosition;
        void main() {
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision mediump float;
        varying vec3 vPosition;
        uniform float uSunAzimuth;
        uniform float uSunElevation;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColorLow;
        uniform vec3 uSkyColorHigh;
        uniform float uSunSize;
        void main() {
          float azimuth = radians(uSunAzimuth);
          float elevation = radians(uSunElevation);
          vec3 sunDirection = normalize(vec3(
            cos(elevation) * sin(azimuth),
            sin(elevation),
            cos(elevation) * cos(azimuth)
          ));
          vec3 direction = normalize(vPosition);
          float t = direction.y * 0.5 + 0.5;
          vec3 skyColor = mix(uSkyColorLow, uSkyColorHigh, t);
          float sunIntensity = pow(max(dot(direction, sunDirection), 0.0), 1000.0 / uSunSize);
          gl_FragColor = vec4(skyColor + uSunColor * sunIntensity, 1.0);
        }
      `,
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false
    })
  );
  object.name = "Skybox";
  const sun = new THREE.DirectionalLight(0xffefb8, 6.2);
  sun.castShadow = true;
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 180;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  const sunDisk = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 32, 18),
    new THREE.MeshBasicMaterial({ color: 0xffd34f, fog: false })
  );
  sunDisk.name = "EZ-Tree visible sun";
  sunDisk.renderOrder = 2;
  object.add(sun, sunDisk);
  object.add(new THREE.AmbientLight(0xffffff, 0.82));
  updateSkyboxSun(THREE, { object, uniforms, sun, sunDisk }, 32, 35);
  return { object, uniforms, sun, sunDisk };
}

async function createGroundLayer(THREE) {
  try {
    const loader = new THREE.TextureLoader();
    const [grassTexture, dirtTexture, dirtNormal] = await Promise.all([
      loader.loadAsync(`${EZ_TREE_GROUND_TEXTURE_BASE_URL}/grass.jpg`),
      loader.loadAsync(`${EZ_TREE_GROUND_TEXTURE_BASE_URL}/dirt_color.jpg`),
      loader.loadAsync(`${EZ_TREE_GROUND_TEXTURE_BASE_URL}/dirt_normal.jpg`)
    ]);
    [grassTexture, dirtTexture, dirtNormal].forEach((texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
    });
    grassTexture.colorSpace = THREE.SRGBColorSpace;
    dirtTexture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshPhongMaterial({
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.01,
      normalMap: dirtNormal,
      shininess: 0.1
    });
    const uniforms = {
      uNoiseScale: { value: 100 },
      uPatchiness: { value: 0.7 },
      uGrassTexture: { value: grassTexture },
      uDirtTexture: { value: dirtTexture }
    };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = "varying vec3 vWorldPosition;\n" + shader.vertexShader;
      shader.fragmentShader = `
        varying vec3 vWorldPosition;
        uniform float uNoiseScale;
        uniform float uPatchiness;
        uniform sampler2D uGrassTexture;
        uniform sampler2D uDirtTexture;
      ` + shader.fragmentShader;
      shader.vertexShader = shader.vertexShader.replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
        vWorldPosition = worldPosition.xyz;
      `);
      shader.fragmentShader = shader.fragmentShader.replace("void main() {", `${simplex2dShaderSource()}
        void main() {`);
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
        vec2 uv = vec2(vWorldPosition.x, vWorldPosition.z);
        vec3 grassColor = texture2D(uGrassTexture, uv / 30.0).rgb;
        vec3 dirtColor = texture2D(uDirtTexture, uv / 30.0).rgb;
        float n = 0.5 + 0.5 * simplex2d(uv / uNoiseScale);
        float s = smoothstep(uPatchiness - 0.1, uPatchiness + 0.1, n);
        diffuseColor *= vec4(mix(grassColor, dirtColor, s), 1.0);
      `);
      shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `
        vec2 groundNormalUv = vec2(vWorldPosition.x, vWorldPosition.z);
        vec3 mapN = texture2D(normalMap, groundNormalUv / 30.0).xyz * 2.0 - 1.0;
        mapN.xy *= normalScale;
        normal = normalize(tbn * mapN);
      `);
      material.userData.shader = shader;
    };
    const object = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), material);
    object.rotation.x = -Math.PI / 2;
    object.receiveShadow = true;
    const shadowReceiver = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.34, transparent: true })
    );
    shadowReceiver.rotation.x = -Math.PI / 2;
    shadowReceiver.position.y = 0.012;
    shadowReceiver.receiveShadow = true;
    const group = new THREE.Group();
    group.add(object, shadowReceiver);
    return { object: group, surface: object, shadowReceiver, uniforms, materials: [material] };
  } catch (error) {
    const object = new THREE.Mesh(
      new THREE.CircleGeometry(80, 128),
      new THREE.MeshStandardMaterial({ color: 0x5f4b32, roughness: 0.96 })
    );
    object.rotation.x = -Math.PI / 2;
    object.receiveShadow = true;
    return { object, surface: object, uniforms: {}, materials: [object.material] };
  }
}

async function createGrassLayer(THREE) {
  try {
    const { GLTFLoader } = await importWithTimeout(GLTF_LOADER_URL, 10000);
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(`${EZ_TREE_MODEL_BASE_URL}/grass.glb`);
    return createGrassScatterFromGltf(THREE, gltf.scene);
  } catch (error) {
    return createFallbackGrassLayer(THREE);
  }
}

function createGrassScatterFromGltf(THREE, grassScene) {
  const source = findFirstMesh(grassScene);
  if (!source?.geometry || !source?.material) throw new Error("EZ-Tree grass asset did not contain a renderable mesh.");
  const count = 720;
  const group = new THREE.Group();
  const sourceMaterials = Array.isArray(source.material) ? source.material : [source.material];
  const material = sourceMaterials[0].clone();
  material.side = THREE.DoubleSide;
  material.transparent = true;
  material.alphaTest = Math.max(material.alphaTest || 0, 0.22);
  material.depthWrite = true;
  const mesh = new THREE.InstancedMesh(source.geometry.clone(), material, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scatterGrassInstances(THREE, mesh, count, 0.32);
  group.add(mesh);
  return { object: group, materials: [material], source: "ez-tree-grass-glb" };
}

async function createRocksLayer(THREE) {
  const group = new THREE.Group();
  try {
    const { GLTFLoader } = await importWithTimeout(GLTF_LOADER_URL, 10000);
    const loader = new GLTFLoader();
    const scenes = await Promise.all([1, 2, 3].map(async (index) => {
      const gltf = await loader.loadAsync(`${EZ_TREE_MODEL_BASE_URL}/rock${index}.glb`);
      return gltf.scene;
    }));
    scenes.forEach((scene, index) => {
      const source = findFirstMesh(scene);
      if (!source?.geometry || !source?.material) return;
      const count = 5;
      const materials = Array.isArray(source.material) ? source.material : [source.material];
      const material = materials[0].clone();
      const mesh = new THREE.InstancedMesh(source.geometry.clone(), material, count);
      scatterRockInstances(THREE, mesh, count, index);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
  } catch (error) {
    addFallbackRocks(THREE, group);
  }
  return { object: group };
}

function scatterRockInstances(THREE, mesh, count, offset) {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  for (let i = 0; i < count; i += 1) {
    const seed = i + offset * 97;
    const radius = 5 + seededFraction(seed * 4.3) * 22;
    const angle = seededFraction(seed * 9.1) * Math.PI * 2;
    position.set(Math.cos(angle) * radius, 0.14, Math.sin(angle) * radius);
    euler.set(0, seededFraction(seed * 6.7) * Math.PI * 2, 0);
    quaternion.setFromEuler(euler);
    const s = 0.16 + seededFraction(seed * 8.9) * 0.28;
    scale.set(s, s * (0.75 + seededFraction(seed * 11.2) * 0.5), s);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function addFallbackRocks(THREE, group) {
  const material = new THREE.MeshStandardMaterial({ color: 0x6c6559, roughness: 0.9 });
  const geometry = new THREE.DodecahedronGeometry(0.65, 0);
  for (let i = 0; i < 36; i += 1) {
    const mesh = new THREE.Mesh(geometry, material);
    const radius = 10 + seededFraction(i * 4.3) * 50;
    const angle = seededFraction(i * 9.1) * Math.PI * 2;
    mesh.position.set(Math.cos(angle) * radius, 0.38, Math.sin(angle) * radius);
    mesh.rotation.y = seededFraction(i * 6.7) * Math.PI * 2;
    mesh.scale.setScalar(0.4 + seededFraction(i * 8.9) * 0.7);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function createClouds(THREE) {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.9,
    fog: true,
    depthWrite: false
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
    ` + shader.vertexShader;
    shader.fragmentShader = `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorldPosition;
    ` + shader.fragmentShader;
    shader.vertexShader = shader.vertexShader.replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
      vUv = uv;
      vWorldPosition = worldPosition.xyz;
    `);
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", `${simplex2dShaderSource()}
      void main() {`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      float n = simplex2d(vUv * 5.0 + uTime / 40.0) + simplex2d(vUv * 10.0 + uTime / 30.0);
      float cloud = smoothstep(0.2, 0.8, 0.5 * n + 0.4);
      diffuseColor = vec4(1.0, 1.0, 1.0, cloud * opacity / (0.01 * length(vWorldPosition)));
    `);
    material.userData.shader = shader;
  };
  const object = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), material);
  return { object, material };
}

function updateEzTreeEnvironment(environment, elapsedTime) {
  const cloudShader = environment.clouds.material.userData.shader;
  if (cloudShader) cloudShader.uniforms.uTime.value = elapsedTime;
  environment.grass.materials.forEach((material) => {
    const shader = material.userData.shader;
    if (shader?.uniforms?.uTime) shader.uniforms.uTime.value = elapsedTime;
  });
}

function updateEnvironmentParameters(environment, params) {
  updateSkyboxSun(null, environment.skybox, params.tts, params.saa);
  updateGrassLayer(environment.grass, params);
  if (environment.ground.uniforms.uPatchiness) {
    environment.ground.uniforms.uPatchiness.value = clamp(0.52 + params.pSoil * 0.34, 0.45, 0.9);
  }
}

function updateSkyboxSun(THREE, skybox, solarZenithDeg, solarAzimuthDeg) {
  const elevation = 90 - solarZenithDeg;
  skybox.uniforms.uSunAzimuth.value = solarAzimuthDeg;
  skybox.uniforms.uSunElevation.value = elevation;
  const el = elevation * Math.PI / 180;
  const az = solarAzimuthDeg * Math.PI / 180;
  skybox.sun.position.set(
    100 * Math.cos(el) * Math.sin(az),
    100 * Math.sin(el),
    100 * Math.cos(el) * Math.cos(az)
  );
  skybox.sun.intensity = 7.2;
  skybox.sun.target?.position.set(0, 1.2, 0);
  skybox.sun.target?.updateMatrixWorld();
  skybox.sunDisk?.position.set(14, 19 + Math.max(-4, Math.min(5, 0.12 * (90 - solarZenithDeg))), -18);
}

function simplex2dShaderSource() {
  return `
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
    float simplex2d(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
      vec2 i = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289(i);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
      m = m * m;
      m = m * m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
      vec3 g;
      g.x = a0.x * x0.x + h.x * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }
  `;
}

function findFirstMesh(object) {
  let mesh = null;
  object.traverse?.((item) => {
    if (!mesh && item.isMesh) mesh = item;
  });
  return mesh;
}

function scatterGrassInstances(THREE, mesh, count, baseScale) {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  for (let i = 0; i < count; i += 1) {
    const radius = Math.sqrt(seededFraction(i * 8.17)) * 14.8;
    const angle = seededFraction(i * 31.3) * Math.PI * 2;
    const height = baseScale * (0.65 + seededFraction(i * 3.9) * 0.85);
    position.set(Math.cos(angle) * radius, 0.018, Math.sin(angle) * radius);
    euler.set((seededFraction(i * 4.7) - 0.5) * 0.22, angle + Math.PI * 0.5, (seededFraction(i * 6.1) - 0.5) * 0.16);
    quaternion.setFromEuler(euler);
    scale.setScalar(height);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function createFallbackGrassLayer(THREE) {
  const count = 950;
  const geometry = new THREE.PlaneGeometry(0.055, 0.42);
  geometry.translate(0, 0.21, 0);
  const material = new THREE.MeshStandardMaterial({
    color: 0x3f6f37,
    roughness: 0.86,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.82,
    alphaTest: 0.08
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  for (let i = 0; i < count; i += 1) {
    const radius = Math.sqrt(seededFraction(i * 8.17)) * 14.8;
    const angle = seededFraction(i * 31.3) * Math.PI * 2;
    const height = 0.18 + seededFraction(i * 3.9) * 0.28;
    position.set(Math.cos(angle) * radius, 0.012, Math.sin(angle) * radius);
    euler.set((seededFraction(i * 4.7) - 0.5) * 0.28, angle + Math.PI * 0.5, (seededFraction(i * 6.1) - 0.5) * 0.18);
    quaternion.setFromEuler(euler);
    scale.set(0.72 + seededFraction(i * 2.3) * 0.9, height, 1);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  const group = new THREE.Group();
  group.add(mesh);
  return { object: group, materials: [material], source: "procedural-fallback" };
}

function updatePistachioCanopyVisuals(treeRoot, tree, environment, params, previousLeafState, scheduleLeafRegeneration) {
  const density01 = clamp((params.LAI - 0.2) / 6.3, 0, 1);
  const leafState = getEzTreeLeafState(params);
  applyEzTreeLeafMaterials(tree, leafState);
  if (!previousLeafState || previousLeafState.count !== leafState.count || previousLeafState.angle !== leafState.angle) {
    scheduleLeafRegeneration();
  }
  const scale = 0.92 + density01 * 0.18;
  treeRoot.scale.set(scale, 1 + density01 * 0.05, scale);
  if (environment.ground.surface?.material?.color) {
    const soil = clamp(params.pSoil, 0, 1);
    environment.ground.surface.material.color.setRGB(0.22 + soil * 0.34, 0.17 + soil * 0.25, 0.10 + soil * 0.15);
  }
  return leafState;
}

function updateGrassLayer(grass, params) {
  const soil = clamp(params.pSoil, 0, 1);
  const water01 = clamp((params.Cw - 0.003) / 0.047, 0, 1);
  const brown = clamp(params.Cbrown, 0, 1);
  grass.materials.forEach((material) => {
    material.color?.setRGB?.(
      clamp(0.18 + water01 * 0.10 + soil * 0.04 + brown * 0.12, 0, 1),
      clamp(0.34 + water01 * 0.18 - soil * 0.06 - brown * 0.16, 0, 1),
      clamp(0.14 + water01 * 0.08 - brown * 0.08, 0, 1)
    );
    material.opacity = clamp(0.7 + water01 * 0.2 - brown * 0.12, 0.52, 0.95);
    material.transparent = material.opacity < 1 || material.transparent;
    material.needsUpdate = true;
  });
}

function regenerateEzTreeLeaves(THREE, tree, params) {
  if (!params?.LAI || !tree?.options?.leaves) return;
  const leafState = getEzTreeLeafState(params);
  tree.options.leaves.count = leafState.count;
  tree.options.leaves.angle = leafState.angle;
  tree.options.leaves.tint = leafState.color;
  tree.options.leaves.size = leafState.size;
  disposeObject3d(tree);
  tree.generate();
  tree.scale.setScalar(0.105);
  tree.rotation.y = -0.28;
  tree.position.set(0, 0, 0);
  tree.traverse?.((item) => {
    if (item.isMesh) {
      item.castShadow = true;
      item.receiveShadow = true;
    }
  });
  normalizeObjectToGround(THREE, tree);
  applyEzTreeLeafMaterials(tree, leafState);
}

function getEzTreeLeafState(params) {
  const density01 = clamp((params.LAI - 0.2) / 6.3, 0, 1);
  const brown = clamp(params.Cbrown, 0, 1);
  return {
    count: Math.round(4 + density01 * 44),
    angle: Math.round(clamp(params.ALA, 10, 80)),
    color: leafColorHex(params),
    opacity: clamp(0.58 + density01 * 0.28 - brown * 0.16, 0.42, 0.9),
    roughness: clamp(0.62 + (params.Cm - 0.002) / 0.018 * 0.22 + brown * 0.16, 0.5, 0.96),
    size: clamp(EZ_TREE_PRESET.leaves.size * (0.82 + density01 * 0.28 - brown * 0.1), 1.6, 3.2)
  };
}

function applyEzTreeLeafMaterials(tree, leafState) {
  const leafMeshes = new Set([tree.leavesMesh].filter(Boolean));
  tree.traverse?.((item) => {
    if (item.isMesh && /leaf|leaves/i.test(item.name || "")) leafMeshes.add(item);
  });
  leafMeshes.forEach((item) => {
    const materials = Array.isArray(item.material) ? item.material : [item.material].filter(Boolean);
    materials.forEach((material) => {
      material.color?.setHex?.(leafState.color);
      material.opacity = leafState.opacity;
      material.roughness = leafState.roughness;
      material.transparent = leafState.opacity < 1;
      material.needsUpdate = true;
    });
  });
  if (tree.options?.leaves) {
    tree.options.leaves.tint = leafState.color;
    tree.options.leaves.angle = leafState.angle;
    tree.options.leaves.count = leafState.count;
    tree.options.leaves.size = leafState.size;
  }
}

function setCameraMode(THREE, camera, root, mode) {
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  if (mode === "top") camera.position.set(center.x, 12, center.z + 0.1);
  else if (mode === "side") camera.position.set(center.x + 8, center.y + 2.4, center.z);
  else frameScene(THREE, camera, root);
  camera.lookAt(center.x, center.y + 1.4, center.z);
  camera.updateProjectionMatrix();
}

function frameScene(THREE, camera, object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const distance = maxDim / (2 * Math.tan(camera.fov * Math.PI / 360)) * 1.35;
  camera.position.set(center.x + distance * 0.35, center.y - maxDim * 0.04, center.z + distance);
  camera.near = 0.05;
  camera.far = Math.max(distance * 7, 2200);
  camera.lookAt(center.x, center.y - size.y * 0.12, center.z);
  camera.updateProjectionMatrix();
}

function resizeRenderer(renderer, camera, canvas) {
  const box = canvas.parentElement.getBoundingClientRect();
  const width = Math.max(320, Math.floor(box.width));
  const height = Math.max(360, Math.floor(box.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function normalizeObjectToGround(THREE, object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
}

function cylinderBetween(THREE, geometry, material, start, end, radius) {
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const direction = new THREE.Vector3().subVectors(end, start);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(midpoint);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  mesh.scale.set(radius, direction.length(), radius);
  return mesh;
}

function leafColorHex(params) {
  const cab01 = clamp((params.Cab - 5) / 75, 0, 1);
  const water01 = clamp((params.Cw - 0.003) / 0.047, 0, 1);
  const dry01 = clamp((params.Cm - 0.002) / 0.018, 0, 1);
  const brown = clamp(params.Cbrown, 0, 1);
  const r = Math.round(92 + brown * 94 + dry01 * 26 - cab01 * 12);
  const g = Math.round(112 + cab01 * 56 - brown * 54 - dry01 * 16);
  const b = Math.round(84 + water01 * 22 - brown * 35);
  return (clamp(r, 38, 220) << 16) + (clamp(g, 56, 190) << 8) + clamp(b, 34, 150);
}

function disposeObject3d(object) {
  object.traverse?.((item) => {
    item.geometry?.dispose?.();
    const materials = Array.isArray(item.material) ? item.material : [item.material].filter(Boolean);
    materials.forEach((material) => material.dispose?.());
  });
}

function seededFraction(value) {
  const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function initCanvasPistachioFallback(canvas, statusNode) {
  const context = canvas.getContext("2d");
  let params = {
    LAI: 2.1,
    Cab: 52,
    Cw: 0.02,
    Cm: 0.009,
    Cbrown: 0.14,
    ALA: 42,
    pSoil: 0.36,
    tts: 32,
    saa: 35
  };
  let frameId = 0;
  if (statusNode) {
    statusNode.textContent = "EZ-Tree runtime import is unavailable in this browser session. Showing parameter-coupled pistachio canopy fallback; spectrum remains computed separately.";
  }
  function draw(now) {
    frameId = requestAnimationFrame(draw);
    resizeCanvas(canvas, context);
    drawPistachioFallback(context, canvas, params, now * 0.00035);
  }
  draw(performance.now());
  return {
    update(nextParameters) {
      params = { ...params, ...nextParameters };
    },
    setCameraMode() {},
    dispose() {
      cancelAnimationFrame(frameId);
    }
  };
}

function resizeCanvas(canvas, context) {
  const box = canvas.parentElement.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(320, Math.floor(box.width));
  const height = Math.max(360, Math.floor(box.height));
  if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawPistachioFallback(context, canvas, params, time) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.clearRect(0, 0, width, height);
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#08242c");
  sky.addColorStop(1, "#06161b");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);
  drawFallbackSun(context, width, height, params);
  drawFallbackSoil(context, width, height, params.pSoil);
  drawFallbackBranches(context, width, height);
  drawFallbackLeaves(context, width, height, params, time);
}

function drawFallbackSun(context, width, height, params) {
  const zenith = params.tts * Math.PI / 180;
  const azimuth = params.saa * Math.PI / 180;
  const x = width * (0.5 + Math.sin(zenith) * Math.sin(azimuth) * 0.38);
  const y = height * (0.13 + (1 - Math.cos(zenith)) * 0.28);
  const glow = context.createRadialGradient(x, y, 4, x, y, 52);
  glow.addColorStop(0, "rgba(255, 218, 120, 0.95)");
  glow.addColorStop(0.35, "rgba(255, 218, 120, 0.2)");
  glow.addColorStop(1, "rgba(255, 218, 120, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(x, y, 52, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffd36a";
  context.beginPath();
  context.arc(x, y, 8, 0, Math.PI * 2);
  context.fill();
}

function drawFallbackSoil(context, width, height, pSoil) {
  const shade = 62 + clamp(pSoil, 0, 1) * 88;
  context.fillStyle = `rgb(${shade}, ${shade * 0.74}, ${shade * 0.46})`;
  context.beginPath();
  context.ellipse(width * 0.5, height * 0.86, width * 0.44, height * 0.10, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(245, 201, 106, 0.16)";
  for (let i = -4; i <= 4; i += 1) {
    context.beginPath();
    context.moveTo(width * 0.5 + i * 40, height * 0.82);
    context.lineTo(width * 0.5 + i * 92, height * 0.96);
    context.stroke();
  }
}

function drawFallbackBranches(context, width, height) {
  const baseX = width * 0.5;
  const baseY = height * 0.84;
  context.strokeStyle = "rgba(128, 117, 96, 0.92)";
  context.lineCap = "round";
  context.lineWidth = 10;
  context.beginPath();
  context.moveTo(baseX, baseY);
  context.bezierCurveTo(baseX - 18, height * 0.70, baseX + 10, height * 0.56, baseX, height * 0.43);
  context.stroke();
  for (let i = 0; i < 34; i += 1) {
    const angle = -Math.PI * 0.88 + i * (Math.PI * 1.76 / 33);
    const level = seededFraction(i * 9.7);
    const startX = baseX + Math.sin(i) * 15;
    const startY = height * (0.47 + level * 0.18);
    const length = width * (0.12 + seededFraction(i * 3.1) * 0.18);
    context.lineWidth = 2.4 + (1 - level) * 3;
    context.beginPath();
    context.moveTo(startX, startY);
    context.quadraticCurveTo(
      startX + Math.cos(angle) * length * 0.45,
      startY - Math.abs(Math.sin(angle)) * height * 0.12,
      startX + Math.cos(angle) * length,
      startY - Math.sin(Math.abs(angle)) * height * 0.16
    );
    context.stroke();
  }
}

function drawFallbackLeaves(context, width, height, params, time) {
  const density01 = clamp((params.LAI - 0.2) / 6.3, 0, 1);
  const visibleLeafletCount = Math.round(260 + density01 * 720);
  const color = fallbackLeafColor(params);
  const water01 = clamp((params.Cw - 0.003) / 0.047, 0, 1);
  const droop = (1 - water01) * 18 + params.Cbrown * 12;
  const crownW = width * (0.26 + density01 * 0.06);
  const crownH = height * (0.25 + density01 * 0.05);
  const centerX = width * 0.5;
  const centerY = height * 0.47 + droop * 0.18;
  context.fillStyle = color;
  context.strokeStyle = "rgba(234, 246, 243, 0.12)";
  for (let i = 0; i < visibleLeafletCount; i += 1) {
    const u = seededFraction(i * 15.31);
    const v = seededFraction(i * 41.17);
    const angle = i * 2.399963;
    const radius = Math.sqrt(u);
    const x = centerX + Math.cos(angle) * radius * crownW;
    const y = centerY + Math.sin(angle) * radius * crownH * 0.78 + Math.sin(time + i) * 1.1 + droop * v;
    const tilt = (params.ALA - 45) * Math.PI / 220 + angle * 0.12;
    drawCompoundLeaflet(context, x, y, 8 + density01 * 2, 3.2, tilt);
  }
}

function drawCompoundLeaflet(context, x, y, length, width, angle) {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  for (let leaflet = -2; leaflet <= 2; leaflet += 1) {
    const lx = leaflet * width * 1.2;
    const ly = Math.abs(leaflet) * 0.6;
    context.beginPath();
    context.ellipse(lx, ly, width, length * (leaflet === 0 ? 0.78 : 0.62), leaflet * 0.25, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.restore();
}

function fallbackLeafColor(params) {
  const cab01 = clamp((params.Cab - 5) / 75, 0, 1);
  const dry01 = clamp((params.Cm - 0.002) / 0.018, 0, 1);
  const brown = clamp(params.Cbrown, 0, 1);
  const r = Math.round(92 + brown * 95 + dry01 * 22 - cab01 * 10);
  const g = Math.round(112 + cab01 * 48 - brown * 48);
  const b = Math.round(82 - brown * 34 + (1 - dry01) * 12);
  return `rgba(${clamp(r, 35, 220)}, ${clamp(g, 50, 190)}, ${clamp(b, 32, 150)}, 0.82)`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
