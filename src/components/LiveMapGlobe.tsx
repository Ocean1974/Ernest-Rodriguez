import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const DEFAULT_GLOBE_ROTATION = { x: 0.12, y: -0.42, z: -0.08 };

function enhanceEarthTexture(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  for (let index = 0; index < pixels.length; index += 4) {
    let red = pixels[index] / 255;
    let green = pixels[index + 1] / 255;
    let blue = pixels[index + 2] / 255;
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const shadowLift = 0.1 * (1 - luma);
    const saturation = 1.22;
    const contrast = 1.16;
    const brightness = 1.18;

    red = (luma + (red - luma) * saturation + shadowLift) * brightness;
    green = (luma + (green - luma) * saturation + shadowLift) * brightness;
    blue = (luma + (blue - luma) * saturation + shadowLift) * brightness;

    pixels[index] = clamp(((red - 0.5) * contrast + 0.5) * 255, 0, 255);
    pixels[index + 1] = clamp(((green - 0.5) * contrast + 0.5) * 255, 0, 255);
    pixels[index + 2] = clamp(((blue - 0.5) * contrast + 0.5) * 255, 0, 255);
  }

  context.putImageData(imageData, 0, 0);
}

function createLoadingEarthTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const ocean = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  ocean.addColorStop(0, "#09295a");
  ocean.addColorStop(0.5, "#0b4f8f");
  ocean.addColorStop(1, "#061936");
  context.fillStyle = ocean;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "rgba(69, 151, 101, 0.72)";
  context.beginPath();
  context.ellipse(260, 210, 110, 54, -0.2, 0, Math.PI * 2);
  context.ellipse(350, 245, 78, 42, 0.35, 0, Math.PI * 2);
  context.ellipse(690, 190, 135, 62, 0.18, 0, Math.PI * 2);
  context.ellipse(760, 260, 70, 88, -0.08, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(229, 238, 226, 0.22)";
  context.fillRect(0, 72, canvas.width, 12);
  context.fillRect(0, 405, canvas.width, 14);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = "earth-loading-texture";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

let sharedLoadingEarthTexture = null;

function getSharedLoadingEarthTexture() {
  if (!sharedLoadingEarthTexture) sharedLoadingEarthTexture = createLoadingEarthTexture();
  return sharedLoadingEarthTexture;
}

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function normalizeRadians(value) {
  let next = Number.isFinite(value) ? value % (Math.PI * 2) : 0;
  if (next > Math.PI) next -= Math.PI * 2;
  if (next < -Math.PI) next += Math.PI * 2;
  return next;
}

function shortestRadiansDelta(from, to) {
  return normalizeRadians(to - from);
}

function coordinatesToGlobeRotation(coordinates) {
  const [lng, lat] = Array.isArray(coordinates) ? coordinates : [];
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return { ...DEFAULT_GLOBE_ROTATION };
  return {
    x: clamp(THREE.MathUtils.degToRad(lat) * 0.34, -0.72, 0.72),
    y: normalizeRadians(-THREE.MathUtils.degToRad(lng) - Math.PI / 2),
    z: -0.08,
  };
}

function GlobeEarth({ earthRef, targetRotationRef, holdUntilRef }) {
  const [earthTexture, setEarthTexture] = useState(null);
  const loadingTexture = getSharedLoadingEarthTexture();

  useEffect(() => {
    let cancelled = false;
    const image = document.createElement("img");
    image.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || 2048;
      canvas.height = image.naturalHeight || 1024;
      const context = canvas.getContext("2d");
      context?.drawImage(image, 0, 0, canvas.width, canvas.height);
      enhanceEarthTexture(canvas);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      setEarthTexture(texture);
    };
    image.onerror = () => {
      if (!cancelled) setEarthTexture(null);
    };
    image.src = "/assets/earth-blue-marble-2048.png";
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      earthTexture?.dispose?.();
    };
  }, [earthTexture]);

  useFrame((_, delta) => {
    if (!earthRef.current) return;
    const target = targetRotationRef.current;
    if (nowMs() > holdUntilRef.current) target.y = normalizeRadians(target.y + delta * 0.055);
    earthRef.current.rotation.x += (target.x - earthRef.current.rotation.x) * 0.07;
    earthRef.current.rotation.y += shortestRadiansDelta(earthRef.current.rotation.y, target.y) * 0.07;
    earthRef.current.rotation.z += (target.z - earthRef.current.rotation.z) * 0.07;
  });

  const displayTexture = earthTexture || loadingTexture;

  return (
    <group ref={earthRef} rotation={[DEFAULT_GLOBE_ROTATION.x, DEFAULT_GLOBE_ROTATION.y, DEFAULT_GLOBE_ROTATION.z]}>
      <mesh>
        <sphereGeometry args={[2.08, 128, 128]} />
        <meshBasicMaterial key={earthTexture ? "earth-blue-marble" : "earth-loading-texture"} color="#ffffff" map={displayTexture || undefined} toneMapped={false} />
      </mesh>
      <mesh scale={1.012}>
        <sphereGeometry args={[2.08, 128, 128]} />
        <meshBasicMaterial color="#8ed8ff" transparent opacity={0.08} side={THREE.BackSide} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function GlobeZoomControls({ controlsApiRef, controlsRef, targetRotationRef, holdUntilRef }) {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(0, 0.15, 6.4);
    camera.fov = 40;
    camera.updateProjectionMatrix();
    controlsRef.current?.target?.set?.(0, 0, 0);
    controlsRef.current?.update?.();

    const zoomBy = (factor) => {
      const distance = camera.position.length();
      const nextDistance = clamp(distance * factor, 6.6, 11);
      camera.position.setLength(nextDistance);
      camera.updateProjectionMatrix();
      controlsRef.current?.update?.();
    };
    controlsApiRef.current = {
      zoomIn: () => zoomBy(0.84),
      zoomOut: () => zoomBy(1.18),
      focusLocation: (coordinates, options = {}) => {
        targetRotationRef.current = coordinatesToGlobeRotation(coordinates);
        holdUntilRef.current = nowMs() + (Number.isFinite(options.holdMs) ? options.holdMs : 1200);
        if (Number.isFinite(options.scale)) {
          const nextDistance = clamp(6.4 / clamp(options.scale, 0.88, 1.34), 5.1, 8.4);
          camera.position.setLength(nextDistance);
          camera.updateProjectionMatrix();
          controlsRef.current?.update?.();
        }
      },
      reset: () => {
        targetRotationRef.current = { ...DEFAULT_GLOBE_ROTATION };
        holdUntilRef.current = nowMs() + 800;
        camera.position.set(0, 0.15, 6.4);
        camera.updateProjectionMatrix();
        controlsRef.current?.update?.();
      },
    };
    return () => {
      controlsApiRef.current = null;
    };
  }, [camera, controlsApiRef, controlsRef, holdUntilRef, targetRotationRef]);

  return null;
}

export default function LiveMapGlobe({ controlsApiRef }) {
  const controlsRef = useRef(null);
  const earthRef = useRef(null);
  const targetRotationRef = useRef({ ...DEFAULT_GLOBE_ROTATION });
  const holdUntilRef = useRef(0);

  return (
    <div className="absolute inset-0 bg-black" data-live-map-globe="three" data-globe-render-profile="bright-detailed-earth">
      <div className="absolute -inset-6">
        <Canvas camera={{ position: [0, 0.15, 6.4], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true, alpha: false }}>
          <color attach="background" args={["#020817"]} />
          <Stars radius={90} depth={42} count={2200} factor={3.2} saturation={0.45} fade speed={0.24} />
          <GlobeEarth earthRef={earthRef} targetRotationRef={targetRotationRef} holdUntilRef={holdUntilRef} />
          <GlobeZoomControls controlsApiRef={controlsApiRef} controlsRef={controlsRef} targetRotationRef={targetRotationRef} holdUntilRef={holdUntilRef} />
          <OrbitControls
            ref={controlsRef}
            enablePan={false}
            enableDamping
            dampingFactor={0.06}
            enableZoom
            enableRotate
            autoRotate
            autoRotateSpeed={0.32}
            minDistance={6.6}
            maxDistance={11}
            rotateSpeed={0.58}
            zoomSpeed={0.7}
            onStart={() => {
              holdUntilRef.current = nowMs() + 1200;
            }}
            onEnd={() => {
              holdUntilRef.current = nowMs() + 900;
            }}
          />
        </Canvas>
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/0 via-black/5 to-black/20" />
    </div>
  );
}
