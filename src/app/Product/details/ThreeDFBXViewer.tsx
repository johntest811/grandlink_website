"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { FBXLoader, OrbitControls } from "three-stdlib";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

type Props = {
  fbxUrls: string[];
  weather: "sunny" | "rainy" | "night" | "foggy";
  width?: number;
  height?: number;
};

type ModelUnits = "mm" | "cm" | "m";

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

export default function ThreeDFBXViewer({ fbxUrls, weather, width = 1200, height = 700 }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [currentFbxIndex, setCurrentFbxIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [modelUnits, setModelUnits] = useState<ModelUnits>("m");
  const [dimsMm, setDimsMm] = useState<{ width: number; height: number; thickness: number } | null>(null);

  const labelElsRef = useRef<{ w?: HTMLDivElement; h?: HTMLDivElement; t?: HTMLDivElement }>({});
  const originalSizeRef = useRef<THREE.Vector3 | null>(null);
  const showMeasurementsRef = useRef<boolean>(true);
  const modelUnitsRef = useRef<ModelUnits>("m");

  // Ensure we have valid FBX URLs and current index
  const validFbxUrls = Array.isArray(fbxUrls) ? fbxUrls.filter(url => url && url.trim() !== '') : [];
  const currentFbx = validFbxUrls[currentFbxIndex] || validFbxUrls[0];

  const storageKey = useMemo(() => (currentFbx ? `gl:fbxUnits:${currentFbx}` : ""), [currentFbx]);

  useEffect(() => {
    showMeasurementsRef.current = showMeasurements;
  }, [showMeasurements]);

  useEffect(() => {
    modelUnitsRef.current = modelUnits;

    // Update label DOM text without forcing a 3D reload
    const s = originalSizeRef.current;
    if (s && labelElsRef.current) {
      const mpu = mmPerUnit(modelUnits);
      const next = {
        width: s.x * mpu,
        height: s.y * mpu,
        thickness: s.z * mpu,
      };
      setDimsMm(next);
      if (labelElsRef.current.w) labelElsRef.current.w.textContent = formatMm(next.width);
      if (labelElsRef.current.h) labelElsRef.current.h.textContent = formatMm(next.height);
      if (labelElsRef.current.t) labelElsRef.current.t.textContent = formatMm(next.thickness);
    }

    if (storageKey) {
      try {
        localStorage.setItem(storageKey, modelUnits);
      } catch {}
    }
  }, [modelUnits, storageKey]);

  // Restore per-model unit preference
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey) as ModelUnits | null;
      if (saved === "mm" || saved === "cm" || saved === "m") setModelUnits(saved);
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

    // runtime-safe color management
    const sRGB = THREE.SRGBColorSpace ?? 3001; 
    try {
      if ("outputColorSpace" in renderer) {
        (renderer as any).outputColorSpace = sRGB;
      } else if ("outputEncoding" in renderer) {
        (renderer as any).outputEncoding = sRGB;
      }
    } catch (e) {}
    if ("physicallyCorrectLights" in renderer) try { (renderer as any).physicallyCorrectLights = true; } catch(e){}

    // Enhanced tone mapping for better reflections
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2; 
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

    // High-quality "studio" 
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const roomEnv = new RoomEnvironment();
    const roomRT = pmremGenerator.fromScene(roomEnv, isLowEnd ? 0.08 : 0.04);
    const studioEnvMap = roomRT.texture;
    scene.environment = studioEnvMap;

    
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
      ctx.fillRect(size / 2 - 1, 0, 2, size);
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
    let rainSystem: THREE.Points | null = null;
    let rainVelY: Float32Array | null = null;
    let rainVelX: Float32Array | null = null;
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
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
      const group = new THREE.Group();

      const mkLine = (a: THREE.Vector3, b: THREE.Vector3) => {
        const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
        const line = new THREE.Line(geom, mat);
        group.add(line);
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

    const applyWeather = (type: string) => {
   
      if (rainSystem) {
        try {
          scene.remove(rainSystem);
          rainSystem.geometry.dispose();
          (rainSystem.material as THREE.PointsMaterial).dispose();
        } catch (e) {}
        rainSystem = null;
        rainVelY = null;
        rainVelX = null;
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

        const rainCount = performanceFactor > 0.6 ? STORM_RAIN : BASE_RAIN;
        const positions = new Float32Array(rainCount * 3);
        rainVelY = new Float32Array(rainCount);
        rainVelX = new Float32Array(rainCount);
        for (let i = 0; i < rainCount; i++) {
          positions[i * 3 + 0] = Math.random() * 1000 - 500;
          positions[i * 3 + 1] = Math.random() * 800 + 100;
          positions[i * 3 + 2] = Math.random() * 1000 - 500;
          rainVelY[i] = (12 + Math.random() * 18) * (1 + (1 - performanceFactor));
          rainVelX[i] = (Math.random() - 0.5) * (2 + Math.random() * 6);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
          map: rainTexture,
          size: Math.max(8, 12 * performanceFactor),
          sizeAttenuation: true,
          transparent: true,
          opacity: rainBaseOpacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        rainSystem = new THREE.Points(geo, mat);
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

   
    const loader = new FBXLoader();
    loader.load(
      currentFbx,
      (object) => {
        console.log("FBX Loaded successfully");

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
              if (sRGB !== undefined) map.encoding = sRGB;
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

        //materials and shadow settings
        object.traverse((child: any) => {
          if (!child.isMesh) return;
          
      
          child.castShadow = true;
          child.receiveShadow = true;
          
          const orig = child.material;
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
        const mpuNow = mmPerUnit(modelUnitsRef.current);
        const computedMm = {
          width: rawSize.x * mpuNow,
          height: rawSize.y * mpuNow,
          thickness: rawSize.z * mpuNow,
        };
        setDimsMm(computedMm);

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
          const wLabel = makeLabel(formatMm(computedMm.width), "w");
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
          const hLabel = makeLabel(formatMm(computedMm.height), "h");
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
          const tLabel = makeLabel(formatMm(computedMm.thickness), "t");
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
      },
      (progress) => {
        console.log("Loading progress:", progress);
      },
      (err) => {
        console.error("FBX load error:", err);
        setLoading(false);
      }
    );

    // Enhanced animation loop
    let rafId = 0;
    const animate = () => {
      frameCounter++;
      const heavyStep = frameCounter % (isLowEnd ? 4 : 3) === 0;

      if (measurementGroup) {
        measurementGroup.visible = !!showMeasurementsRef.current;
      }

      // Weather animations (same as before)
      if (heavyStep && rainSystem && rainVelY && rainVelX) {
        const posAttr = rainSystem.geometry.attributes.position as THREE.BufferAttribute;
        const arr = posAttr.array as Float32Array;
        const count = rainVelY.length;
        const timeFactor = (Date.now() % 10000) / 10000;
        for (let i = 0; i < count; i++) {
          const idx = i * 3;
          const gust = Math.sin(i * 0.01 + timeFactor * Math.PI * 2) * 0.5;
          let x = arr[idx + 0] + (rainVelX[i] * 0.5) + gust;
          let y = arr[idx + 1] - rainVelY[i] * (0.85 + Math.random() * 0.2);
          if (y < -100) {
            y = 600 + Math.random() * 200;
            x = Math.random() * 1000 - 500;
            arr[idx + 2] = Math.random() * 1000 - 500;
          }
          if (x > 500) x = -500;
          if (x < -500) x = 500;
          arr[idx + 0] = x;
          arr[idx + 1] = y;
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

    // Cleanup
    return () => {
      cancelAnimationFrame(rafId);
      disposeMeasurementGroup();
      try { controls.dispose(); } catch(e) {}
      try { renderer.dispose(); } catch(e) {}
      try { pmremGenerator.dispose(); } catch(e) {}
      try { roomRT.dispose(); } catch(e) {}
      try { rainTexture.dispose(); } catch(e) {}
      try { windTexture.dispose(); } catch(e) {}
      if (labelRenderer) {
        try {
          container.removeChild(labelRenderer.domElement);
        } catch {}
      }
      while (container && container.firstChild) container.removeChild(container.firstChild);
    };
  }, [currentFbx, weather]);

  // Show loading or no files message
  if (!validFbxUrls.length) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-100" style={{ width, height }}>
        <div className="text-center">
          <div className="text-gray-500 text-lg">No 3D models available</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative" style={{ width, height }}>
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
              <span className="font-semibold">{dimsMm ? formatMm(dimsMm.width) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/70">Height</span>
              <span className="font-semibold">{dimsMm ? formatMm(dimsMm.height) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/70">Thickness</span>
              <span className="font-semibold">{dimsMm ? formatMm(dimsMm.thickness) : "—"}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="text-xs text-white/70">Model units</label>
            <select
              value={modelUnits}
              onChange={(e) => setModelUnits(e.target.value as ModelUnits)}
              className="bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-xs text-white outline-none"
              aria-label="Model units"
            >
              <option value="mm" className="text-white bg-black">mm</option>
              <option value="cm" className="text-white bg-black">cm</option>
              <option value="m" className="text-white bg-black">m</option>
            </select>
          </div>

          <div className="mt-2 text-[11px] text-white/60 leading-snug">
            If numbers look off, switch “Model units” (saved per model).
          </div>
        </div>
      </div>

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