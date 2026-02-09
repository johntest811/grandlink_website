"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { FBXLoader, GLTFLoader, OrbitControls } from "three-stdlib";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

function getUrlExtension(url: string): string {
  const clean = (url || "").split("?")[0].split("#")[0];
  const lastDot = clean.lastIndexOf(".");
  if (lastDot === -1) return "";
  return clean.slice(lastDot + 1).toLowerCase();
}

type Props = {
  modelUrls: string[];
  weather: "sunny" | "rainy" | "night" | "foggy";
  frameFinish?: FrameFinish;
  skyboxes?: Partial<Record<"sunny" | "rainy" | "night" | "foggy", string | null>> | null;
  productDimensions?: {
    width?: number | string | null;
    height?: number | string | null;
    thickness?: number | string | null;
    units?: ModelUnits | null;
  };
  width?: number;
  height?: number;
};

type ModelUnits = "mm" | "cm" | "m";

type FrameFinish = "default" | "matteBlack" | "matteGray" | "narra" | "walnut";

const FRAME_FINISH_PRESETS: Record<Exclude<FrameFinish, "default">, { color: number; roughness: number; metalness: number }> = {
  matteBlack: { color: 0x1b1b1b, roughness: 0.82, metalness: 0.06 },
  matteGray: { color: 0x6b6b6b, roughness: 0.82, metalness: 0.06 },
  narra: { color: 0x8a4b2a, roughness: 0.72, metalness: 0.05 },
  walnut: { color: 0x5b3a29, roughness: 0.72, metalness: 0.05 },
};

type MaterialSnapshot = {
  colorHex?: number;
  roughness?: number;
  metalness?: number;
  map?: THREE.Texture | null;
  transparent?: boolean;
  opacity?: number;
};

function mmPerUnit(units: ModelUnits): number {
  switch (units) {
    case "mm":
      return 1;
    case "cm":
      return 10;
    case "m":
      return 1000;
  }
}

function formatMm(valueMm: number): string {
  if (!Number.isFinite(valueMm)) return "—";
  // Keep Ikea-ish formatting integers for >= 10mm, one decimal for small values
  const abs = Math.abs(valueMm);
  const rounded = abs >= 10 ? Math.round(valueMm) : Math.round(valueMm * 10) / 10;
  return `${rounded.toLocaleString()} mm`;
}

function formatLength(valueMm: number, displayUnits: ModelUnits): string {
  if (!Number.isFinite(valueMm)) return "—";
  const divisor = mmPerUnit(displayUnits);
  const value = valueMm / divisor;

  // formatting: mm integers-ish, cm 1dp, m 2dp (trim trailing .0)
  let rounded: number;
  if (displayUnits === "mm") {
    const abs = Math.abs(value);
    rounded = abs >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  } else if (displayUnits === "cm") {
    rounded = Math.round(value * 10) / 10;
  } else {
    rounded = Math.round(value * 100) / 100;
  }

  return `${rounded.toLocaleString()} ${displayUnits}`;
}

function parseDimensionToMm(value: unknown, defaultUnits: ModelUnits): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value * mmPerUnit(defaultUnits) : null;

  const raw = String(value).trim();
  if (!raw) return null;

  const m = raw.match(/^(-?\d+(?:\.\d+)?)(?:\s*(mm|cm|m))?$/i);
  if (!m) return null;

  const num = Number.parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;

  const units = (m[2]?.toLowerCase() as ModelUnits | undefined) ?? defaultUnits;
  return num * mmPerUnit(units);
}

export default function ThreeDFBXViewer({ modelUrls, weather, frameFinish = "default", skyboxes, productDimensions, width = 1200, height = 700 }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [currentFbxIndex, setCurrentFbxIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [modelUnits, setModelUnits] = useState<ModelUnits>("mm");
  const [dimsMm, setDimsMm] = useState<{ width: number; height: number; thickness: number } | null>(null);

  const frameMaterialsRef = useRef<THREE.Material[]>([]);
  const frameMaterialSnapshotsRef = useRef<WeakMap<THREE.Material, MaterialSnapshot>>(new WeakMap());

  const labelElsRef = useRef<{ w?: HTMLDivElement; h?: HTMLDivElement; t?: HTMLDivElement }>({});
  const originalSizeRef = useRef<THREE.Vector3 | null>(null);
  const showMeasurementsRef = useRef<boolean>(true);
  const modelUnitsRef = useRef<ModelUnits>("mm");
  const assumedModelUnitsRef = useRef<ModelUnits>("m");

  // Ensure we have valid model URLs and current index
  const validFbxUrls = Array.isArray(modelUrls) ? modelUrls.filter(url => url && url.trim() !== '') : [];
  const currentFbx = validFbxUrls[currentFbxIndex] || validFbxUrls[0];

  const productDimsMm = useMemo(() => {
    const defaultUnits = (productDimensions?.units ?? "mm") as ModelUnits;
    const w = parseDimensionToMm(productDimensions?.width, defaultUnits);
    const h = parseDimensionToMm(productDimensions?.height, defaultUnits);
    const t = parseDimensionToMm(productDimensions?.thickness, defaultUnits);
    if (w === null || h === null || t === null) return null;
    return { width: w, height: h, thickness: t };
  }, [productDimensions?.width, productDimensions?.height, productDimensions?.thickness, productDimensions?.units]);

  const usesProductDimensions = !!productDimsMm;

  const storageKey = useMemo(() => (currentFbx ? `gl:fbxUnits:${currentFbx}` : ""), [currentFbx]);

  useEffect(() => {
    showMeasurementsRef.current = showMeasurements;
  }, [showMeasurements]);

  useEffect(() => {
    modelUnitsRef.current = modelUnits;

    // When product dimensions are provided (from Supabase), keep base mm stable
    // and only change how we *display* it.
    if (usesProductDimensions && productDimsMm) {
      setDimsMm(productDimsMm);
      if (labelElsRef.current.w) labelElsRef.current.w.textContent = formatLength(productDimsMm.width, modelUnits);
      if (labelElsRef.current.h) labelElsRef.current.h.textContent = formatLength(productDimsMm.height, modelUnits);
      if (labelElsRef.current.t) labelElsRef.current.t.textContent = formatLength(productDimsMm.thickness, modelUnits);
      return;
    }

    // Update label DOM text without forcing a 3D reload
    const s = originalSizeRef.current;
    if (s && labelElsRef.current) {
      const mpu = mmPerUnit(assumedModelUnitsRef.current);
      const next = {
        width: s.x * mpu,
        height: s.y * mpu,
        thickness: s.z * mpu,
      };
      setDimsMm(next);
      if (labelElsRef.current.w) labelElsRef.current.w.textContent = formatLength(next.width, modelUnits);
      if (labelElsRef.current.h) labelElsRef.current.h.textContent = formatLength(next.height, modelUnits);
      if (labelElsRef.current.t) labelElsRef.current.t.textContent = formatLength(next.thickness, modelUnits);
    }

  }, [modelUnits, usesProductDimensions, productDimsMm]);

  // Restore per-model *assumed model units* (used only for converting FBX raw size into mm)
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey) as ModelUnits | null;
      if (saved === "mm" || saved === "cm" || saved === "m") assumedModelUnitsRef.current = saved;
    } catch {}
  }, [storageKey]);

  // Navigation functions
  const goToPrevious = () => {
    if (validFbxUrls.length > 1) {
      setCurrentFbxIndex((prev) => (prev > 0 ? prev - 1 : validFbxUrls.length - 1));
    }
  };

  const goToNext = () => {
    if (validFbxUrls.length > 1) {
      setCurrentFbxIndex((prev) => (prev < validFbxUrls.length - 1 ? prev + 1 : 0));
    }
  };

  const goToIndex = (index: number) => {
    if (index >= 0 && index < validFbxUrls.length) {
      setCurrentFbxIndex(index);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (validFbxUrls.length <= 1) return;
      
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          goToPrevious();
          break;
        case 'ArrowRight':
          event.preventDefault();
          goToNext();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [validFbxUrls.length]);

  useEffect(() => {
    if (!mountRef.current || !currentFbx) return;

    setLoading(true);

    // Make colors consistent across three.js versions (r152+).
    try {
      const anyTHREE: any = THREE;
      if (anyTHREE.ColorManagement && typeof anyTHREE.ColorManagement.enabled === "boolean") {
        anyTHREE.ColorManagement.enabled = true;
      }
    } catch {}


    const hwConcurrency = (navigator as any).hardwareConcurrency || 4;
    const deviceDpr = window.devicePixelRatio || 1;
 
    const dprForPerf = Math.min(deviceDpr, 1.5);
    const performanceFactor = Math.min(1, hwConcurrency / 4) * (1 / dprForPerf);
    
    // Detect if running on lower-end hardware
    const isLowEnd = hwConcurrency < 4 || performanceFactor < 0.5;
    const detailLevel = isLowEnd ? 0.5 : (performanceFactor > 0.8 ? 1.0 : 0.75);

    
    const dpr = Math.min(deviceDpr, isLowEnd ? 1.25 : 2);

    // particle budgets (scaled)
    const BASE_RAIN = Math.round(8000 * performanceFactor);
    const STORM_RAIN = Math.round(22000 * performanceFactor);
    const BASE_WIND = Math.round(300 * performanceFactor);
    const STRONG_WIND = Math.round(600 * performanceFactor);

  
    const container = mountRef.current;
    const renderWidth = Math.floor(container.clientWidth || width);
    const renderHeight = Math.floor(container.clientHeight || height);

 
    try {
      container.style.position = "relative";
    } catch {}


    while (container.firstChild) container.removeChild(container.firstChild);

    // scene + camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);

    const camera = new THREE.PerspectiveCamera(50, renderWidth / renderHeight, 0.1, 2000);
    
    // Enhanced renderer with better shadow and reflection settings
    const renderer = new THREE.WebGLRenderer({ 
      antialias: !isLowEnd,
      alpha: false,
      powerPreference: isLowEnd ? "low-power" : "high-performance",
      logarithmicDepthBuffer: !isLowEnd, 
      preserveDrawingBuffer: false,
      premultipliedAlpha: false
    });
    renderer.setSize(renderWidth, renderHeight);
    renderer.setPixelRatio(dpr);
    
    // ENHANCED SHADOW CONFIGURATION
    renderer.shadowMap.enabled = true;
    if (!isLowEnd) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
      renderer.shadowMap.autoUpdate = true;
    } else {
      renderer.shadowMap.type = THREE.BasicShadowMap; 
    }

    // runtime-safe color management (matches UpdateProducts viewer)
    try {
      const anyTHREE: any = THREE;
      if ("outputColorSpace" in (renderer as any) && anyTHREE.SRGBColorSpace !== undefined) {
        (renderer as any).outputColorSpace = anyTHREE.SRGBColorSpace;
      } else if ("outputEncoding" in (renderer as any) && anyTHREE.sRGBEncoding !== undefined) {
        (renderer as any).outputEncoding = anyTHREE.sRGBEncoding;
      }
    } catch {}
    if ("physicallyCorrectLights" in renderer) try { (renderer as any).physicallyCorrectLights = true; } catch(e){}

    // Enhanced tone mapping for better reflections
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

  
    let labelRenderer: CSS2DRenderer | null = null;
    try {
      labelRenderer = new CSS2DRenderer();
      labelRenderer.setSize(renderWidth, renderHeight);
      labelRenderer.domElement.style.position = "absolute";
      labelRenderer.domElement.style.top = "0";
      labelRenderer.domElement.style.left = "0";
      labelRenderer.domElement.style.pointerEvents = "none";
      labelRenderer.domElement.style.zIndex = "2";
      container.appendChild(labelRenderer.domElement);
    } catch (e) {
      console.warn("CSS2DRenderer init failed", e);
    }

    //set up for center focus
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.enableRotate = true;


    const ambient = new THREE.AmbientLight(0xffffff, 0.4); 
    scene.add(ambient);

   
    const sunLight = new THREE.DirectionalLight(0xfff1c0, 2.0); 
    sunLight.position.set(100, 150, 50); 
    sunLight.castShadow = true;
    
  
    const shadowMapSize = isLowEnd ? 1024 : (detailLevel > 0.75 ? 4096 : 2048);
    sunLight.shadow.mapSize.width = shadowMapSize;
    sunLight.shadow.mapSize.height = shadowMapSize;
    sunLight.shadow.camera.near = 0.1;
    sunLight.shadow.camera.far = 1000;
    sunLight.shadow.camera.left = -200;
    sunLight.shadow.camera.right = 200;
    sunLight.shadow.camera.top = 200;
    sunLight.shadow.camera.bottom = -200;
    sunLight.shadow.bias = -0.0001;
    sunLight.shadow.normalBias = 0.02; 
    sunLight.shadow.radius = isLowEnd ? 2 : 8;
    scene.add(sunLight);

   
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-80, 100, 80);
    fillLight.castShadow = !isLowEnd; 
    if (!isLowEnd) {
      fillLight.shadow.mapSize.width = 1024;
      fillLight.shadow.mapSize.height = 1024;
      fillLight.shadow.camera.near = 0.1;
      fillLight.shadow.camera.far = 500;
      fillLight.shadow.camera.left = -100;
      fillLight.shadow.camera.right = 100;
      fillLight.shadow.camera.top = 100;
      fillLight.shadow.camera.bottom = -100;
      fillLight.shadow.bias = -0.0002;
      fillLight.shadow.normalBias = 0.015;
      fillLight.shadow.radius = 4;
    }
    scene.add(fillLight);

   
    if (!isLowEnd) {
      const rimLight1 = new THREE.DirectionalLight(0xccddff, 0.8);
      rimLight1.position.set(0, 50, -150);
      scene.add(rimLight1);

      const rimLight2 = new THREE.DirectionalLight(0xffeecc, 0.6);
      rimLight2.position.set(150, 80, 0);
      scene.add(rimLight2);
    }

   
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemi.position.set(0, 200, 0);
    scene.add(hemi);

    // Match UpdateProducts viewer behavior: stable lighting via lights only.
    // Skyboxes are applied as BACKGROUND ONLY so they won't change the model's texture/material look.
    scene.environment = null;

    let skyboxTex: THREE.Texture | null = null;
    let activeSkyboxUrl: string | null = null;

    const setTexColorSpace = (tex: any) => {
      const anyTHREE: any = THREE;
      if (!tex) return;
      if ("colorSpace" in tex && anyTHREE.SRGBColorSpace !== undefined) {
        tex.colorSpace = anyTHREE.SRGBColorSpace;
      } else if ("encoding" in tex && anyTHREE.sRGBEncoding !== undefined) {
        tex.encoding = anyTHREE.sRGBEncoding;
      }
    };

    
    const createRainTexture = () => {
      const size = 32;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, size, size);
      const grd = ctx.createLinearGradient(size / 2, 0, size / 2, size);
      grd.addColorStop(0, "rgba(255,255,255,0.98)");
      grd.addColorStop(0.6, "rgba(200,200,255,0.5)");
      grd.addColorStop(1, "rgba(200,200,255,0.05)");
      ctx.fillStyle = grd;
      // Thinner rain streak (1px)
      ctx.fillRect(size / 2, 0, 1, size);
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    };

    const createWindTexture = () => {
      const size = 32;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, size, size);
      
      const grd = ctx.createLinearGradient(0, size/2, size, size/2);
      grd.addColorStop(0, "rgba(220,230,255,0.0)");
      grd.addColorStop(0.3, "rgba(200,220,255,0.6)");
      grd.addColorStop(0.7, "rgba(180,200,255,0.8)");
      grd.addColorStop(1, "rgba(160,180,255,0.0)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, size/2 - 2, size, 4);
      
      ctx.strokeStyle = "rgba(190,210,255,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, size/2 - 1);
      ctx.quadraticCurveTo(size/2, size/2 + 2, size, size/2 - 1);
      ctx.stroke();
      
      const tex = new THREE.CanvasTexture(canvas);
      tex.needsUpdate = true;
      return tex;
    };

    const rainTexture = createRainTexture();
    const windTexture = createWindTexture();

    // particle holders
    // NOTE: Rain is implemented as LineSegments (streaks) instead of Points.
    // Points-based rain can appear invisible depending on camera/model scale.
    let rainSystem: THREE.LineSegments | null = null;
    let rainVelY: Float32Array | null = null;
    let rainVelX: Float32Array | null = null;
    let rainLen: Float32Array | null = null;
    let rainArea: {
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
      minZ: number;
      maxZ: number;
    } | null = null;
    let rainBaseOpacity = 0.6;
    let windSystem: THREE.Points | null = null;
    let windVel: Float32Array | null = null;
    let windLifetime: Float32Array | null = null;
    let windBaseOpacity = 0.3;
    let modelBounds: THREE.Box3 | null = null;
    let measurementGroup: THREE.Group | null = null;

    const disposeMeasurementGroup = () => {
      if (!measurementGroup) return;
      try {
        measurementGroup.traverse((obj: any) => {
          if (obj.geometry) {
            try { obj.geometry.dispose(); } catch {}
          }
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m: any) => {
                try { m.dispose(); } catch {}
              });
            } else {
              try { obj.material.dispose(); } catch {}
            }
          }
        });
      } catch {}
      try { scene.remove(measurementGroup); } catch {}
      measurementGroup = null;
    };

    const makeLabel = (initialText: string, kind: "w" | "h" | "t") => {
      const el = document.createElement("div");
      el.textContent = initialText;
      el.style.padding = "6px 10px";
      el.style.borderRadius = "999px";
      el.style.background = "rgba(15, 23, 42, 0.78)";
      el.style.color = "white";
      el.style.fontSize = "12px";
      el.style.fontWeight = "600";
      el.style.letterSpacing = "0.2px";
      el.style.whiteSpace = "nowrap";
      el.style.boxShadow = "0 6px 18px rgba(0,0,0,0.25)";
      el.style.backdropFilter = "blur(6px)";
      labelElsRef.current[kind] = el;
      return new CSS2DObject(el);
    };

    const addDimension = (opts: {
      start: THREE.Vector3;
      end: THREE.Vector3;
      extAStart?: THREE.Vector3;
      extAEnd?: THREE.Vector3;
      extBStart?: THREE.Vector3;
      extBEnd?: THREE.Vector3;
      tickDir: THREE.Vector3;
      label: CSS2DObject;
      color?: number;
    }) => {
      const color = opts.color ?? 0x1e88e5;
      // Use mesh-based lines (cylinders) so thickness is reliable across browsers/GPUs.
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      });
      const group = new THREE.Group();

      const mkLine = (a: THREE.Vector3, b: THREE.Vector3) => {
        const dir = b.clone().sub(a);
        const len = dir.length();
        if (!Number.isFinite(len) || len <= 1e-6) return;

        const radius = THREE.MathUtils.clamp(len * 0.01, 0.06, 0.28);
        const geom = new THREE.CylinderGeometry(radius, radius, len, 10, 1, true);
        const mesh = new THREE.Mesh(geom, mat);

        // Cylinder is Y-aligned; rotate to match segment direction.
        const mid = a.clone().add(b).multiplyScalar(0.5);
        mesh.position.copy(mid);
        const axis = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(axis, dir.clone().normalize());
        mesh.quaternion.copy(quat);

        mesh.renderOrder = 3;
        group.add(mesh);
      };

      mkLine(opts.start, opts.end);

      // extension lines 
      if (opts.extAStart && opts.extAEnd) mkLine(opts.extAStart, opts.extAEnd);
      if (opts.extBStart && opts.extBEnd) mkLine(opts.extBStart, opts.extBEnd);

      // ticks
      const tickLen = opts.start.distanceTo(opts.end) * 0.03;
      const tick = opts.tickDir.clone().normalize().multiplyScalar(Math.max(1.5, tickLen));
      mkLine(opts.start.clone().add(tick), opts.start.clone().sub(tick));
      mkLine(opts.end.clone().add(tick), opts.end.clone().sub(tick));

   
      const mid = opts.start.clone().add(opts.end).multiplyScalar(0.5);
      opts.label.position.copy(mid);
      group.add(opts.label);

      return group;
    };

  
    let frameCounter = 0;
    let lastFrameMs = performance.now();

    const computeRainArea = () => {
      if (modelBounds) {
        const center = modelBounds.getCenter(new THREE.Vector3());
        const size = modelBounds.getSize(new THREE.Vector3());
        // Slightly tighter volume so it reads like an "animation" rain layer
        // rather than filling the whole scene.
        const spanX = Math.max(size.x * 2.4, 120);
        const spanZ = Math.max(size.z * 2.4, 120);
        const height = Math.max(size.y * 2.6, 200);
        const padY = Math.max(size.y * 0.6, 40);

        return {
          minX: center.x - spanX * 0.5,
          maxX: center.x + spanX * 0.5,
          minY: center.y - padY,
          maxY: center.y + height * 0.5,
          minZ: center.z - spanZ * 0.5,
          maxZ: center.z + spanZ * 0.5,
        };
      }

      // Fallback: sensible default around origin
      return {
        minX: -110,
        maxX: 110,
        minY: -40,
        maxY: 170,
        minZ: -110,
        maxZ: 110,
      };
    };

    const applyWeather = (type: string) => {
   
      if (rainSystem) {
        try {
          scene.remove(rainSystem);
          rainSystem.geometry.dispose();
          (rainSystem.material as THREE.LineBasicMaterial).dispose();
        } catch (e) {}
        rainSystem = null;
        rainVelY = null;
        rainVelX = null;
        rainLen = null;
        rainArea = null;
      }
      if (windSystem) {
        try {
          scene.remove(windSystem);
          windSystem.geometry.dispose();
          (windSystem.material as THREE.PointsMaterial).dispose();
        } catch (e) {}
        windSystem = null;
        windVel = null;
        windLifetime = null;
      }
      scene.fog = null;

      // Reset skybox (if any) when weather changes
      activeSkyboxUrl = null;
      if (skyboxTex) {
        try { skyboxTex.dispose(); } catch {}
        skyboxTex = null;
      }

      // Keep lighting stable. Skyboxes are background-only so they won't change textures/materials.
      scene.environment = null;

      // If a skybox is configured for this weather, load it asynchronously.
      const skyUrlRaw = (skyboxes && typeof skyboxes === "object") ? (skyboxes as any)[type] : null;
      const skyUrl = typeof skyUrlRaw === "string" ? skyUrlRaw.trim() : "";
      if (skyUrl) {
        activeSkyboxUrl = skyUrl;
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin("anonymous");
        loader.load(
          skyUrl,
          (tex) => {
            // ignore late loads after weather switch
            if (activeSkyboxUrl !== skyUrl) {
              try { tex.dispose(); } catch {}
              return;
            }
            skyboxTex = tex;
            setTexColorSpace(skyboxTex);
            skyboxTex.mapping = THREE.EquirectangularReflectionMapping;
            scene.background = skyboxTex;

            // Optional smoothing if supported by current three version
            try {
              const extras = scene as unknown as Record<string, unknown>;
              if ("backgroundBlurriness" in extras) {
                (scene as unknown as { backgroundBlurriness: number }).backgroundBlurriness = 0.08;
              }
              if ("backgroundIntensity" in extras) {
                (scene as unknown as { backgroundIntensity: number }).backgroundIntensity = 1.0;
              }
            } catch {}
          },
          undefined,
          () => {
            // keep default background
            if (activeSkyboxUrl === skyUrl) activeSkyboxUrl = null;
          }
        );
      }

      if (type === "sunny") {
        scene.background = new THREE.Color(0x87ceeb);
        ambient.intensity = 0.45;
        hemi.intensity = 0.6;
        fillLight.intensity = 0.6;
        try { sunLight.color.set(0xfff1c0); } catch {}
        sunLight.visible = true;
        sunLight.intensity = 2.2;
        renderer.setClearColor(0x87ceeb, 1);
      } else if (type === "rainy") {
        scene.background = new THREE.Color(0xbfd1e5);
        ambient.intensity = 0.3;
        hemi.intensity = 0.5;
        fillLight.intensity = 0.55;
        try { sunLight.color.set(0xfff1c0); } catch {}
        sunLight.visible = true;
        sunLight.intensity = 0.8;
        renderer.setClearColor(0xbfd1e5, 1);

        // Streak rain (LineSegments) anchored to model bounds so it always appears.
        // Lower density to match typical "animation rain" (readable, not a wall).
        const rainDensity = isLowEnd ? 0.10 : 0.16;
        const rainCount = Math.max(
          250,
          Math.round((performanceFactor > 0.6 ? STORM_RAIN : BASE_RAIN) * rainDensity)
        );
        rainArea = computeRainArea();

        const positions = new Float32Array(rainCount * 2 * 3);
        rainVelY = new Float32Array(rainCount);
        rainVelX = new Float32Array(rainCount);
        rainLen = new Float32Array(rainCount);

        const spawnOne = (i: number) => {
          if (!rainArea) return;
          const headX = rainArea.minX + Math.random() * (rainArea.maxX - rainArea.minX);
          const headY = rainArea.maxY + Math.random() * (rainArea.maxY - rainArea.minY) * 0.3;
          const headZ = rainArea.minZ + Math.random() * (rainArea.maxZ - rainArea.minZ);

          // Shorter streaks (user requested) while keeping thin lines.
          const baseLen = 7 + Math.random() * 12;
          const len = baseLen * (0.85 + Math.min(1, performanceFactor) * 0.25);
          rainLen![i] = len;

          // Natural-ish pace (units are in scene space per second).
          // Too fast makes it look like "teleporting"; too slow looks like drifting snow.
          // Much faster fall speed (user requested)
          rainVelY![i] = (44 + Math.random() * 34) * (1 + (0.75 - performanceFactor) * 0.2);
          // Wind slant (x direction)
          rainVelX![i] = (Math.random() - 0.5) * (6 + Math.random() * 10);

          const idx = i * 6;
          positions[idx + 0] = headX;
          positions[idx + 1] = headY;
          positions[idx + 2] = headZ;
          // Tail computed from head + velocity for slant.
          positions[idx + 3] = headX - rainVelX![i] * 0.015 * len;
          positions[idx + 4] = headY - len;
          positions[idx + 5] = headZ - 0.01 * len;
        };

        for (let i = 0; i < rainCount; i++) spawnOne(i);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

        const mat = new THREE.LineBasicMaterial({
          // Blue, but less intense so it reads like rain not neon.
          color: 0x6bb6ff,
          transparent: true,
          opacity: Math.min(0.42, Math.max(0.22, rainBaseOpacity * 0.75)),
          depthWrite: false,
          blending: THREE.NormalBlending,
        });
        rainSystem = new THREE.LineSegments(geo, mat);
        rainSystem.frustumCulled = false;
        rainSystem.renderOrder = 1;
        scene.add(rainSystem);

        const fogDensity = performanceFactor > 0.5 ? 0.001 : 0.0006;
        scene.fog = new THREE.FogExp2(0xbfd1e5, fogDensity);
      } else if (type === "night") {
        // Night mode
        scene.background = new THREE.Color(0x0b1020);
        renderer.setClearColor(0x0b1020, 1);
        // "moonlight"
        ambient.intensity = 0.32;
        hemi.intensity = 0.35;
        fillLight.intensity = 0.75;
        try { sunLight.color.set(0xbdd1ff); } catch {}
        sunLight.visible = true;
        sunLight.intensity = 1.15;
      
        scene.fog = new THREE.FogExp2(0x0b1020, 0.0006);
      } else if (type === "foggy") {
        scene.background = new THREE.Color(0xd6dbe0);
        ambient.intensity = 0.6;
        hemi.intensity = 0.65;
        fillLight.intensity = 0.6;
        try { sunLight.color.set(0xfff1c0); } catch {}
        sunLight.visible = true;
        sunLight.intensity = 0.8;
        scene.fog = new THREE.FogExp2(0xd6dbe0, 0.002);
        renderer.setClearColor(0xd6dbe0, 1);
      }
    };

    applyWeather(weather);

    const modelExt = getUrlExtension(currentFbx);

    const applyFrameFinishToTargets = (finish: FrameFinish) => {
      const materials = frameMaterialsRef.current;
      if (!materials || materials.length === 0) return;

      if (finish === "default") {
        for (const mat of materials) {
          if (!mat) continue;
          const snap = frameMaterialSnapshotsRef.current.get(mat);
          if (!snap) continue;
          const anyMat: any = mat as any;

          try {
            if (anyMat.color && typeof anyMat.color.setHex === "function" && typeof snap.colorHex === "number") {
              anyMat.color.setHex(snap.colorHex);
            }
          } catch {}
          try {
            if (typeof snap.roughness === "number" && typeof anyMat.roughness === "number") anyMat.roughness = snap.roughness;
          } catch {}
          try {
            if (typeof snap.metalness === "number" && typeof anyMat.metalness === "number") anyMat.metalness = snap.metalness;
          } catch {}
          try {
            if ("map" in anyMat) anyMat.map = snap.map ?? null;
          } catch {}
          try {
            if (typeof snap.transparent === "boolean") anyMat.transparent = snap.transparent;
            if (typeof snap.opacity === "number") anyMat.opacity = snap.opacity;
          } catch {}
          try {
            anyMat.needsUpdate = true;
          } catch {}
        }
        return;
      }

      const preset = FRAME_FINISH_PRESETS[finish];
      if (!preset) return;

      for (const mat of materials) {
        if (!mat) continue;
        const anyMat: any = mat as any;

        try {
          if (anyMat.color && typeof anyMat.color.set === "function") {
            anyMat.color.set(preset.color);
          }
        } catch {}

        // Force solid color finish for the frame.
        try {
          if ("map" in anyMat) anyMat.map = null;
        } catch {}

        try {
          if (typeof anyMat.roughness === "number") anyMat.roughness = preset.roughness;
        } catch {}

        try {
          if (typeof anyMat.metalness === "number") anyMat.metalness = preset.metalness;
        } catch {}

        try {
          anyMat.transparent = false;
          anyMat.opacity = 1;
        } catch {}

        try {
          anyMat.needsUpdate = true;
        } catch {}
      }
    };

    const handleLoaded = (object: THREE.Object3D) => {
        console.log("3D model loaded successfully");

        // Frame materials are detected after we normalize + scale the model (below),
        // so our geometry/bounds heuristic works reliably for GLB/GLTF.
        frameMaterialsRef.current = [];

        const upgradeMaterial = (orig: any) => {
          if (!orig) return null;
          const baseColor = orig.color ? orig.color.clone() : new THREE.Color(0xffffff);
          let map = orig.map ?? null;
          let normalMap = orig.normalMap ?? null;
          let roughnessMap = orig.roughnessMap ?? null;
          let metalnessMap = orig.metalnessMap ?? null;
          const opacity = typeof orig.opacity === "number" ? orig.opacity : 1;
          const roughness = orig.roughness ?? (orig.specular ? 1 - (orig.specular.r ?? 0) : 0.6);
          const metalness = orig.metalness ?? 0;

          const enhanceTex = (tex: any) => {
            if (!tex || !tex.isTexture) return;
            try {
              tex.minFilter = THREE.LinearMipmapLinearFilter;
              tex.magFilter = THREE.LinearFilter;
              tex.generateMipmaps = true;
              tex.needsUpdate = true;
            } catch {}
            try {
              const maxAniso = Math.max(1, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
              tex.anisotropy = maxAniso;
            } catch {}
          };

          if (map && map.isTexture) {
            try {
              setTexColorSpace(map);
            } catch (e) {}
            enhanceTex(map);
          }
          enhanceTex(normalMap);
          enhanceTex(roughnessMap);
          enhanceTex(metalnessMap);

          const name = ((orig && orig.name) || "").toString().toLowerCase();
          const isTransparentCandidate =
            name.includes("glass") ||
            (orig && ((orig.transparent && opacity < 0.95) || (orig.specular && orig.specular.r > 0.1)));

          if (isTransparentCandidate) {
            const glass = new THREE.MeshPhysicalMaterial({
              map,
              normalMap,
              roughnessMap,
              metalnessMap,
              color: baseColor,
              metalness: 0.0,
            
              roughness: Math.max(0.02, Math.min(0.12, roughness)),
              transmission: 0.92,
              transparent: true,
              opacity: Math.max(0.05, Math.min(0.85, opacity)),
              ior: 1.5,
              thickness: 0.08,
              clearcoat: 0.6,
              clearcoatRoughness: 0.02,
              envMapIntensity: detailLevel * 3.0,
              side: THREE.FrontSide,
            });
            
            try {
              glass.depthWrite = false;
              glass.depthTest = true;
            } catch {}
    
            try {
              (glass as any).specularIntensity = 1.1;
              (glass as any).specularColor = new THREE.Color(0xffffff);
            } catch {}
            return glass;
          }

         
          const material = new THREE.MeshStandardMaterial({
            map,
            normalMap,
            roughnessMap,
            metalnessMap,
            color: baseColor,
            metalness: metalness,
            roughness: Math.max(0.05, roughness),
            envMapIntensity: detailLevel * 2.0, // Enhanced reflections
          });

          // Make non-glass materials solid/opaque (FBX exports sometimes mark frames as transparent)
          material.transparent = false;
          material.opacity = 1;
          material.depthWrite = true;
          material.side = THREE.DoubleSide;

          
          if (!isLowEnd) {
            if (normalMap) {
              material.normalScale = new THREE.Vector2(detailLevel * 1.2, detailLevel * 1.2);
            }
            
            material.flatShading = false;
            
       
            if (name.includes("metal") || metalness > 0.5) {
              material.envMapIntensity = detailLevel * 3.0;
              material.roughness = Math.max(0.02, material.roughness * 0.8); // Smoother metals
            }
            
           
            if (name.includes("chrome") || name.includes("mirror")) {
              material.metalness = 1.0;
              material.roughness = 0.02;
              material.envMapIntensity = 4.0;
            }
          }

          return material;
        };

        // Match UpdateProducts viewer: keep original materials for FBX/GLTF.
        // Aggressive FBX "upgrades" can shift the look (e.g., dark frame lines).
        const shouldUpgradeMaterials = false;

        // materials and shadow settings
        object.traverse((child: any) => {
          if (!child.isMesh) return;
          
      
          child.castShadow = true;
          child.receiveShadow = true;
          
          const orig = child.material;
          if (shouldUpgradeMaterials) {
            // FBX exports are often inconsistent (wrong transparency, weak reflections, etc).
            // Upgrade them to stable PBR-ish materials.
            try {
              if (Array.isArray(orig)) {
                child.material = orig.map((m: any) => upgradeMaterial(m) || m);
              } else {
                const nm = upgradeMaterial(orig);
                if (nm) child.material = nm;
              }
            } catch (e) {
              console.warn("material upgrade error", e);
            }
          } else {
            // GLB/GLTF already provides correct PBR materials; keep them.
            // Only apply safe texture-quality tweaks.
            const enhanceTex = (tex: any) => {
              if (!tex || !tex.isTexture) return;
              try {
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.magFilter = THREE.LinearFilter;
                tex.generateMipmaps = true;
                tex.needsUpdate = true;
              } catch {}
              try {
                const maxAniso = Math.max(1, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
                tex.anisotropy = maxAniso;
              } catch {}
            };

            const tweakMat = (mat: any) => {
              if (!mat) return;
              // Ensure base-color textures are treated as sRGB.
              // (normal/roughness/metalness/AO remain linear)
              try { if (mat.map) setTexColorSpace(mat.map); } catch {}
              try { if (mat.emissiveMap) setTexColorSpace(mat.emissiveMap); } catch {}
              enhanceTex(mat.map);
              enhanceTex(mat.normalMap);
              enhanceTex(mat.roughnessMap);
              enhanceTex(mat.metalnessMap);
              enhanceTex(mat.aoMap);
              enhanceTex(mat.emissiveMap);
              try { mat.side = THREE.DoubleSide; } catch {}
              mat.needsUpdate = true;
            };

            try {
              if (Array.isArray(orig)) orig.forEach(tweakMat);
              else tweakMat(orig);
            } catch {}
          }

          
          if (!isLowEnd && detailLevel > 0.75 && child.geometry) {
            try {
              child.geometry.computeVertexNormals();
              if (child.material && child.material.normalMap) {
                child.geometry.computeTangents();
              }
              // Compute bounding sphere for better shadow culling
              child.geometry.computeBoundingSphere();
            } catch (e) {
              console.warn("geometry enhancement error", e);
            }
          }
        });

    
        const rawBox = new THREE.Box3().setFromObject(object);
        const rawSize = rawBox.getSize(new THREE.Vector3());
        const rawCenter = rawBox.getCenter(new THREE.Vector3());

       
        originalSizeRef.current = rawSize.clone();
        const mpuNow = mmPerUnit(assumedModelUnitsRef.current);
        const computedMm = {
          width: rawSize.x * mpuNow,
          height: rawSize.y * mpuNow,
          thickness: rawSize.z * mpuNow,
        };
        const displayMm = productDimsMm ?? computedMm;
        setDimsMm(displayMm);

        const modelGroup = new THREE.Group();

        
        object.position.set(-rawCenter.x, -rawBox.min.y, -rawCenter.z);
        modelGroup.add(object);

        const maxDimension = Math.max(rawSize.x, rawSize.y, rawSize.z);
        if (maxDimension > 0) {
          const targetSize = 100;
          const scale = targetSize / maxDimension;
          modelGroup.scale.setScalar(scale);
        }

        modelGroup.position.set(0, 0, 0);
        scene.add(modelGroup);

        modelBounds = new THREE.Box3().setFromObject(modelGroup);

        // Detect likely frame materials.
        // Priorities:
        // 1) mesh/material name tokens (when available)
        // 2) geometry close to the outer bounds (frame parts usually touch edges)
        // 3) dark/neutral default colors (common for frames)
        const frameTokens = ["frame", "border", "mould", "mold", "molding", "trim", "casing", "bezel", "edge"];
        const overall = modelBounds.clone();
        const overallSize = overall.getSize(new THREE.Vector3());
        const overallVol = Math.max(1e-6, overallSize.x * overallSize.y * overallSize.z);
        const eps = Math.max(1.25, Math.min(5, overallSize.length() * 0.015));

        const isGlassLike = (mat: any, name: string) => {
          if (name.includes("glass")) return true;
          try {
            if (typeof mat?.transmission === "number" && mat.transmission > 0.2) return true;
          } catch {}
          try {
            if (mat?.transparent && typeof mat?.opacity === "number" && mat.opacity < 0.95) return true;
          } catch {}
          return false;
        };

        const scoreByMaterial = new Map<THREE.Material, { score: number; tokenMatch: boolean }>();

        const perMeshBox = new THREE.Box3();
        modelGroup.traverse((child: any) => {
          if (!child?.isMesh) return;

          const meshName = (child?.name || "").toString().toLowerCase();
          try {
            perMeshBox.setFromObject(child);
          } catch {
            return;
          }
          if (perMeshBox.isEmpty()) return;

          const size = perMeshBox.getSize(new THREE.Vector3());
          const vol = Math.max(1e-6, size.x * size.y * size.z);
          const volRatio = vol / overallVol;

          const touches =
            (Math.abs(perMeshBox.min.x - overall.min.x) < eps ? 1 : 0) +
            (Math.abs(perMeshBox.max.x - overall.max.x) < eps ? 1 : 0) +
            (Math.abs(perMeshBox.min.y - overall.min.y) < eps ? 1 : 0) +
            (Math.abs(perMeshBox.max.y - overall.max.y) < eps ? 1 : 0) +
            (Math.abs(perMeshBox.min.z - overall.min.z) < eps ? 1 : 0) +
            (Math.abs(perMeshBox.max.z - overall.max.z) < eps ? 1 : 0);

          const mats: any[] = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) {
            if (!m) continue;
            const mat = m as THREE.Material;
            const matName = (m?.name || "").toString().toLowerCase();
            const haystack = `${meshName} ${matName}`;

            if (isGlassLike(m, haystack)) continue;

            let score = 0;
            const tokenMatch = frameTokens.some((t) => haystack.includes(t));
            if (tokenMatch) score += 5;

            if (touches >= 2) score += 2;
            if (touches >= 4) score += 1;

            if (volRatio < 0.5) score += 1;
            if (volRatio < 0.2) score += 1;

            try {
              const c = (m?.color as THREE.Color | undefined) ?? undefined;
              if (c && (c as any).isColor) {
                const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
                if (lum < 0.45) score += 1;
              }
            } catch {}

            const prev = scoreByMaterial.get(mat);
            if (!prev || score > prev.score) {
              scoreByMaterial.set(mat, { score, tokenMatch });
            } else if (tokenMatch && !prev.tokenMatch) {
              scoreByMaterial.set(mat, { score: prev.score, tokenMatch: true });
            }
          }
        });

        const sorted = Array.from(scoreByMaterial.entries()).sort((a, b) => b[1].score - a[1].score);
        let selected = sorted.filter(([, v]) => v.tokenMatch || v.score >= 4).map(([m]) => m);
        if (selected.length === 0) {
          selected = sorted.filter(([, v]) => v.score > 0).slice(0, 3).map(([m]) => m);
        }

        frameMaterialsRef.current = selected;

        // Snapshot original values so "Default" can restore them.
        for (const mat of frameMaterialsRef.current) {
          if (!mat) continue;
          if (frameMaterialSnapshotsRef.current.has(mat)) continue;
          const anyMat: any = mat as any;
          const snap: MaterialSnapshot = {};
          try { if (anyMat.color && typeof anyMat.color.getHex === "function") snap.colorHex = anyMat.color.getHex(); } catch {}
          try { if (typeof anyMat.roughness === "number") snap.roughness = anyMat.roughness; } catch {}
          try { if (typeof anyMat.metalness === "number") snap.metalness = anyMat.metalness; } catch {}
          try { if ("map" in anyMat) snap.map = anyMat.map ?? null; } catch {}
          try {
            if (typeof anyMat.transparent === "boolean") snap.transparent = anyMat.transparent;
            if (typeof anyMat.opacity === "number") snap.opacity = anyMat.opacity;
          } catch {}
          frameMaterialSnapshotsRef.current.set(mat, snap);
        }

        // Apply chosen finish after we have stable material targets.
        // (If no frame materials were detected, this is a no-op.)
        applyFrameFinishToTargets(frameFinish);

       
        disposeMeasurementGroup();
        labelElsRef.current = {};
        if (modelBounds) {
          const bounds = modelBounds.clone();
          const bSize = bounds.getSize(new THREE.Vector3());
          const maxS = Math.max(bSize.x, bSize.y, bSize.z);
          const offset = Math.max(maxS * 0.08, 3);

          measurementGroup = new THREE.Group();
          measurementGroup.renderOrder = 3;

          const min = bounds.min;
          const max = bounds.max;

          // Width (X) - front/bottom
          const wStart = new THREE.Vector3(min.x, min.y, max.z + offset);
          const wEnd = new THREE.Vector3(max.x, min.y, max.z + offset);
          const wExtAStart = new THREE.Vector3(min.x, min.y, max.z);
          const wExtAEnd = wStart.clone();
          const wExtBStart = new THREE.Vector3(max.x, min.y, max.z);
          const wExtBEnd = wEnd.clone();
          const wLabel = makeLabel(formatLength(displayMm.width, modelUnitsRef.current), "w");
          measurementGroup.add(
            addDimension({
              start: wStart,
              end: wEnd,
              extAStart: wExtAStart,
              extAEnd: wExtAEnd,
              extBStart: wExtBStart,
              extBEnd: wExtBEnd,
              tickDir: new THREE.Vector3(0, 1, 0),
              label: wLabel,
            })
          );

          // Height (Y) 
          const hStart = new THREE.Vector3(max.x + offset, min.y, max.z + offset);
          const hEnd = new THREE.Vector3(max.x + offset, max.y, max.z + offset);
          const hExtAStart = new THREE.Vector3(max.x, min.y, max.z);
          const hExtAEnd = hStart.clone();
          const hExtBStart = new THREE.Vector3(max.x, max.y, max.z);
          const hExtBEnd = hEnd.clone();
          const hLabel = makeLabel(formatLength(displayMm.height, modelUnitsRef.current), "h");
          measurementGroup.add(
            addDimension({
              start: hStart,
              end: hEnd,
              extAStart: hExtAStart,
              extAEnd: hExtAEnd,
              extBStart: hExtBStart,
              extBEnd: hExtBEnd,
              tickDir: new THREE.Vector3(1, 0, 0),
              label: hLabel,
            })
          );

          // Thickness (Z)
          const tStart = new THREE.Vector3(min.x - offset, min.y, min.z);
          const tEnd = new THREE.Vector3(min.x - offset, min.y, max.z);
          const tExtAStart = new THREE.Vector3(min.x, min.y, min.z);
          const tExtAEnd = tStart.clone();
          const tExtBStart = new THREE.Vector3(min.x, min.y, max.z);
          const tExtBEnd = tEnd.clone();
          const tLabel = makeLabel(formatLength(displayMm.thickness, modelUnitsRef.current), "t");
          measurementGroup.add(
            addDimension({
              start: tStart,
              end: tEnd,
              extAStart: tExtAStart,
              extAEnd: tExtAEnd,
              extBStart: tExtBStart,
              extBEnd: tExtBEnd,
              tickDir: new THREE.Vector3(0, 1, 0),
              label: tLabel,
            })
          );

          measurementGroup.visible = !!showMeasurementsRef.current;
          scene.add(measurementGroup);
        }

        // Camera positioning
        const scaledSize = maxDimension * modelGroup.scale.x;
        const distance = scaledSize * 1.5;

        camera.position.set(distance * 0.5, distance * 0.35, distance * 0.8);

        const target = modelBounds ? modelBounds.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0);
        camera.lookAt(target);
        controls.target.copy(target);
        controls.minDistance = distance * 0.3;
        controls.maxDistance = distance * 4;
        controls.update();

        setLoading(false);
        applyWeather(weather);
    };

    const handleProgress = (progress: any) => {
      console.log("Loading progress:", progress);
    };

    const handleError = (err: any) => {
      console.error("3D model load error:", err);
      setLoading(false);
    };

    let objectURLToRevoke: string | null = null;

    const manager = new THREE.LoadingManager();
    manager.onError = (url) => console.warn("Failed to load asset:", url);

    const fbxLoader = new FBXLoader(manager);
    fbxLoader.setCrossOrigin("anonymous");
    const gltfLoader = new GLTFLoader(manager);
    (gltfLoader as any).setCrossOrigin?.("anonymous");

    const tryFetchAsObjectUrl = async (url: string): Promise<string | null> => {
      const tryUrls: string[] = [url];
      if (url.includes(" ")) tryUrls.push(encodeURI(url));
      for (const u of tryUrls) {
        try {
          const res = await fetch(u, { mode: "cors" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          objectURLToRevoke = URL.createObjectURL(blob);
          return objectURLToRevoke;
        } catch {
          // try next
        }
      }
      return null;
    };

    const loadModel = async () => {
      const ext = modelExt;

      // For .gltf, load directly so relative .bin/textures resolve.
      if (ext === "gltf") {
        try {
          const base = new URL(currentFbx, window.location.href);
          base.search = "";
          base.hash = "";
          base.pathname = base.pathname.slice(0, base.pathname.lastIndexOf("/") + 1);
          manager.setURLModifier((requested) => {
            if (!requested) return requested;
            const lower = requested.toLowerCase();
            if (lower.startsWith("data:") || lower.startsWith("blob:") || lower.startsWith("http://") || lower.startsWith("https://")) return requested;
            try {
              return new URL(requested, base).toString();
            } catch {
              return requested;
            }
          });
        } catch {}

        gltfLoader.load(
          currentFbx,
          (gltf: any) => {
            const object = gltf?.scene as THREE.Object3D | undefined;
            if (!object) return handleError(new Error("Missing gltf.scene"));
            handleLoaded(object);
          },
          handleProgress,
          handleError
        );
        return;
      }

      // For .fbx and .glb, prefer blob-load (matches UpdateProducts viewer; avoids content-type/CORS quirks).
      let loadUrl = currentFbx;
      if (ext === "fbx" || ext === "glb") {
        const objUrl = await tryFetchAsObjectUrl(currentFbx);
        if (objUrl) loadUrl = objUrl;
      }

      if (ext === "fbx") {
        fbxLoader.load(loadUrl, (object) => handleLoaded(object), handleProgress, handleError);
        return;
      }

      if (ext === "glb") {
        gltfLoader.load(
          loadUrl,
          (gltf: any) => {
            const object = gltf?.scene as THREE.Object3D | undefined;
            if (!object) return handleError(new Error("Missing gltf.scene"));
            handleLoaded(object);
          },
          handleProgress,
          handleError
        );
        return;
      }

      handleError(new Error(`Unsupported 3D model type: .${ext || "?"}`));
    };

    void loadModel();

    // Enhanced animation loop
    let rafId = 0;
    const animate = () => {
      frameCounter++;
      const heavyStep = frameCounter % (isLowEnd ? 4 : 3) === 0;

      const nowMs = performance.now();
      const dt = Math.min(0.05, (nowMs - lastFrameMs) / 1000);
      lastFrameMs = nowMs;

      if (measurementGroup) {
        measurementGroup.visible = !!showMeasurementsRef.current;
      }

      // Weather animations
      const shouldUpdateRain = !isLowEnd || heavyStep;
      if (shouldUpdateRain && rainSystem && rainVelY && rainVelX && rainLen) {
        // Re-anchor rain bounds if model bounds changed (e.g., switching models)
        if (!rainArea || modelBounds) {
          rainArea = computeRainArea();
        }

        const posAttr = rainSystem.geometry.attributes.position as THREE.BufferAttribute;
        const arr = posAttr.array as Float32Array;
        const count = rainVelY.length;

        const t = nowMs * 0.001;
        for (let i = 0; i < count; i++) {
          const idx = i * 6;

          const gust = Math.sin(i * 0.013 + t * 1.7) * 0.4;

          let headX = arr[idx + 0] + (rainVelX[i] + gust) * dt;
          let headY = arr[idx + 1] - rainVelY[i] * dt;
          let headZ = arr[idx + 2];

          const bounds = rainArea;
          if (bounds) {
            if (headY < bounds.minY) {
              headX = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
              headY = bounds.maxY + Math.random() * (bounds.maxY - bounds.minY) * 0.25;
              headZ = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);
            }

            if (headX < bounds.minX) headX = bounds.maxX;
            if (headX > bounds.maxX) headX = bounds.minX;
            if (headZ < bounds.minZ) headZ = bounds.maxZ;
            if (headZ > bounds.maxZ) headZ = bounds.minZ;
          }

          const len = rainLen[i];
          arr[idx + 0] = headX;
          arr[idx + 1] = headY;
          arr[idx + 2] = headZ;
          // Tail to create long thin streaks
          arr[idx + 3] = headX - (rainVelX[i] + gust) * 0.012 * len;
          arr[idx + 4] = headY - len;
          arr[idx + 5] = headZ - 0.01 * len;
        }

        posAttr.needsUpdate = true;
      }

      if (heavyStep && windSystem && windVel && windLifetime && modelBounds) {
        const positions = windSystem.geometry.attributes.position as THREE.BufferAttribute;
        const arr = positions.array as Float32Array;
        const count = windVel.length / 3;
        const t = Date.now() * 0.001;
        const modelCenter = modelBounds.getCenter(new THREE.Vector3());
        const modelSize = modelBounds.getSize(new THREE.Vector3());
        const windRange = Math.max(modelSize.x, modelSize.y, modelSize.z) * 3;

        for (let i = 0; i < count; i++) {
          const base = i * 3;
          windLifetime[i] += 0.8;

          const turbulence = Math.sin(t * 2 + i * 0.1) * 0.8;
          const gustFactor = 1 + Math.sin(t * 0.3 + i * 0.05) * 0.4;
          
          arr[base + 0] += windVel[base + 0] * gustFactor + turbulence;
          arr[base + 1] += windVel[base + 1] + Math.sin(t * 3 + i * 0.02) * 0.3;
          arr[base + 2] += windVel[base + 2] + turbulence * 0.3;

          const distanceFromModel = Math.sqrt(
            Math.pow(arr[base + 0] - modelCenter.x, 2) + 
            Math.pow(arr[base + 2] - modelCenter.z, 2)
          );

          if (distanceFromModel > windRange * 1.2 || windLifetime[i] > 150 || 
              arr[base + 1] < modelCenter.y - modelSize.y * 3 || 
              arr[base + 1] > modelCenter.y + modelSize.y * 3) {
            
            const side = Math.random();
            let startX, startY, startZ;
            
            if (side < 0.7) {
              startX = modelCenter.x - windRange * (0.8 + Math.random() * 0.4);
              startY = modelCenter.y + (Math.random() - 0.5) * modelSize.y * 2;
              startZ = modelCenter.z + (Math.random() - 0.5) * windRange;
            } else if (side < 0.9) {
              startX = modelCenter.x + (Math.random() - 0.5) * windRange;
              startY = modelCenter.y + (Math.random() - 0.5) * modelSize.y * 2;
              startZ = modelCenter.z - windRange * (0.8 + Math.random() * 0.4);
            } else {
              startX = modelCenter.x + (Math.random() - 0.5) * windRange * 0.5;
              startY = modelCenter.y + windRange * (0.5 + Math.random() * 0.3);
              startZ = modelCenter.z + (Math.random() - 0.5) * windRange * 0.5;
            }

            arr[base + 0] = startX;
            arr[base + 1] = startY;
            arr[base + 2] = startZ;
            
            const baseWindSpeed = 8 + Math.random() * 12;
            const windDirection = Math.PI * 0.1 * (Math.random() - 0.5);
            
            windVel[base + 0] = baseWindSpeed * Math.cos(windDirection);
            windVel[base + 1] = (Math.random() - 0.5) * 2;
            windVel[base + 2] = baseWindSpeed * Math.sin(windDirection) * 0.3;
            
            windLifetime[i] = 0;
          }
        }
        positions.needsUpdate = true;
      }

      controls.update();
      renderer.render(scene, camera);
      if (labelRenderer) {
        try {
          labelRenderer.render(scene, camera);
        } catch {}
      }
      rafId = requestAnimationFrame(animate);
    };
    animate();

    // Prevent page scrolling while using mouse-wheel zoom
    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    try {
      renderer.domElement.addEventListener("wheel", wheelHandler, { passive: false });
    } catch {}

    // Cleanup
    return () => {
      try {
        renderer.domElement.removeEventListener("wheel", wheelHandler as any);
      } catch {}
      cancelAnimationFrame(rafId);
      disposeMeasurementGroup();
      try { controls.dispose(); } catch(e) {}
      try { renderer.dispose(); } catch(e) {}
      if (objectURLToRevoke) {
        try { URL.revokeObjectURL(objectURLToRevoke); } catch {}
      }
      try { skyboxTex?.dispose(); } catch(e) {}
      try { rainTexture.dispose(); } catch(e) {}
      try { windTexture.dispose(); } catch(e) {}
      if (labelRenderer) {
        try {
          container.removeChild(labelRenderer.domElement);
        } catch {}
      }
      while (container && container.firstChild) container.removeChild(container.firstChild);
    };
  }, [currentFbx, weather, skyboxes, productDimsMm, usesProductDimensions]);

  // Update frame finish without reloading the 3D scene.
  useEffect(() => {
    const materials = frameMaterialsRef.current;
    if (!materials || materials.length === 0) return;

    if (frameFinish === "default") {
      for (const mat of materials) {
        if (!mat) continue;
        const snap = frameMaterialSnapshotsRef.current.get(mat);
        if (!snap) continue;
        const anyMat: any = mat as any;
        try {
          if (anyMat.color && typeof anyMat.color.setHex === "function" && typeof snap.colorHex === "number") {
            anyMat.color.setHex(snap.colorHex);
          }
        } catch {}
        try {
          if (typeof snap.roughness === "number" && typeof anyMat.roughness === "number") anyMat.roughness = snap.roughness;
        } catch {}
        try {
          if (typeof snap.metalness === "number" && typeof anyMat.metalness === "number") anyMat.metalness = snap.metalness;
        } catch {}
        try {
          if ("map" in anyMat) anyMat.map = snap.map ?? null;
        } catch {}
        try {
          if (typeof snap.transparent === "boolean") anyMat.transparent = snap.transparent;
          if (typeof snap.opacity === "number") anyMat.opacity = snap.opacity;
        } catch {}
        try {
          anyMat.needsUpdate = true;
        } catch {}
      }
      return;
    }

    const preset = FRAME_FINISH_PRESETS[frameFinish];
    if (!preset) return;
    for (const mat of materials) {
      if (!mat) continue;
      const anyMat: any = mat as any;
      try {
        if (anyMat.color && typeof anyMat.color.set === "function") anyMat.color.set(preset.color);
      } catch {}
      try {
        if ("map" in anyMat) anyMat.map = null;
      } catch {}
      try {
        if (typeof anyMat.roughness === "number") anyMat.roughness = preset.roughness;
      } catch {}
      try {
        if (typeof anyMat.metalness === "number") anyMat.metalness = preset.metalness;
      } catch {}
      try {
        anyMat.transparent = false;
        anyMat.opacity = 1;
      } catch {}
      try {
        anyMat.needsUpdate = true;
      } catch {}
    }
  }, [frameFinish]);

  // Show loading or no files message
  if (!validFbxUrls.length) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-gray-100">
        <div className="text-center">
          <div className="text-gray-500 text-lg">No 3D models available</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {/* Loading indicator */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="text-lg font-medium">Loading 3D model...</span>
            </div>
          </div>
        </div>
      )}

      {/* 3D Viewer */}
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

      {/* Measurements UI */}
      <div className="absolute top-3 left-3 z-[9999] pointer-events-auto">
        <div className="bg-black/70 backdrop-blur-md rounded-xl px-4 py-3 shadow-lg text-white min-w-[220px]">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">Measurements</div>
            <label className="flex items-center gap-2 text-xs text-white/90">
              <input
                type="checkbox"
                checked={showMeasurements}
                onChange={(e) => setShowMeasurements(e.target.checked)}
              />
              Show
            </label>
          </div>

          <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-white/90">
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/70">Width</span>
              <span className="font-semibold">{dimsMm ? formatLength(dimsMm.width, modelUnits) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/70">Height</span>
              <span className="font-semibold">{dimsMm ? formatLength(dimsMm.height, modelUnits) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/70">Thickness</span>
              <span className="font-semibold">{dimsMm ? formatLength(dimsMm.thickness, modelUnits) : "—"}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="text-xs text-white/70">Units</label>
            <select
              value={modelUnits}
              onChange={(e) => setModelUnits(e.target.value as ModelUnits)}
              className="gl-units-select bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-xs text-white outline-none"
              aria-label="Model units"
            >
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="m">m</option>
            </select>
          </div>

          <div className="mt-2 text-[11px] text-white/60 leading-snug">
            {usesProductDimensions
              ? "Using product dimensions from Supabase. Use “Units” to convert display."
              : "Use “Units” to change measurement display."}
          </div>
        </div>
      </div>

      {/* Force native option popup colors (many browsers ignore Tailwind on <option>) */}
      <style jsx>{`
        .gl-units-select option {
          color: #0f172a; /* slate-900 */
          background: #ffffff;
        }
      `}</style>

      {/* Controls Overlay */}
      <div className="pointer-events-none">
        {/* Multiple FBX Navigation Controls */}
        {validFbxUrls.length > 1 && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-[9999] pointer-events-auto">
            <div className="bg-black bg-opacity-80 backdrop-blur-sm rounded-lg p-4 shadow-lg">
              {/* Model Info */}
              <div className="text-center mb-3">
                <div className="text-white text-sm font-medium">
                  3D Model {currentFbxIndex + 1} of {validFbxUrls.length}
                </div>
                <div className="text-gray-300 text-xs">
                  {validFbxUrls[currentFbxIndex]?.split('/').pop()?.split('.')[0] || `Model ${currentFbxIndex + 1}`}
                </div>
              </div>

              {/* Navigation Buttons */}
              <div className="flex items-center justify-center space-x-4">
                <button
                  onClick={goToPrevious}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                  aria-label="Previous model"
                >
                  ← Back
                </button>

                {/* Dot Indicators */}
                <div className="flex space-x-2">
                  {validFbxUrls.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => goToIndex(index)}
                      className={`w-3 h-3 rounded-full transition-colors ${
                        index === currentFbxIndex
                          ? "bg-blue-500"
                          : "bg-gray-400 hover:bg-gray-300"
                      }`}
                      aria-label={`Go to model ${index + 1}`}
                    />
                  ))}
                </div>

                <button
                  onClick={goToNext}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  Next →
                </button>
              </div>

              {/* Keyboard Shortcuts Hint */}
              <div className="text-center mt-2">
                <div className="text-gray-400 text-xs">
                  Use ← → arrow keys or click dots to navigate
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}