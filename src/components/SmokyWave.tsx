import { useEffect, useRef } from "react";

interface SmokyWaveProps {
  level: number;
  active?: boolean;
  className?: string;
  isDark?: boolean;
}

export default function SmokyWave({
  level,
  active = true,
  className = "",
  isDark,
}: SmokyWaveProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentAmpRef = useRef<number>(0.14);
  const phaseRef = useRef<number>(0);
  const animFrameIdRef = useRef<number | null>(null);
  const targetLevelRef = useRef<number>(level);
  const activeRef = useRef<boolean>(active);
  const isDarkRef = useRef<boolean>(isDark ?? false);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const startRenderRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    targetLevelRef.current = Math.max(0, Math.min(1, level));
  }, [level]);

  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    } else {
      if (animFrameIdRef.current === null && startRenderRef.current) {
        startRenderRef.current();
      }
    }
  }, [active]);

  useEffect(() => {
    if (isDark !== undefined) {
      isDarkRef.current = isDark;
    }
  }, [isDark]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ResizeObserver ensures canvas updates dynamically as the pill springs from compact to expanded
    const updateDimensions = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        sizeRef.current = { width: rect.width, height: rect.height };
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
    };

    updateDimensions();
    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(container);

    let lastTime = performance.now();

    const render = (time: number) => {
      if (!activeRef.current) {
        const { width: W, height: H } = sizeRef.current;
        if (W > 0 && H > 0) {
          const dpr = window.devicePixelRatio || 1;
          ctx.save();
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, W, H);
          ctx.restore();
        }
        animFrameIdRef.current = null;
        return;
      }

      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      // Boost voice sensitivity using non-linear curve so normal speech creates expressive peaks
      const rawLevel = targetLevelRef.current;
      const boosted = activeRef.current
        ? Math.min(1, Math.pow(rawLevel * 3.8, 0.65))
        : 0;
      const targetAmp = activeRef.current ? Math.max(0.14, boosted) : 0;

      // Smoothly interpolate currentAmp
      const lerpSpeed = 12;
      currentAmpRef.current +=
        (targetAmp - currentAmpRef.current) * Math.min(1, dt * lerpSpeed);

      // Advance wave phase
      phaseRef.current += dt * 3.6;
      const phase = phaseRef.current;

      const { width: W, height: H } = sizeRef.current;
      if (W === 0 || H === 0) {
        animFrameIdRef.current = requestAnimationFrame(render);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      // Subtle breathing modulation for natural organic feeling
      const breathingAmp =
        currentAmpRef.current * (1 + 0.05 * Math.sin(phase * 1.5));
      const maxRise = H * 0.92 * breathingAmp;

      const step = 2; // Smooth 2px horizontal sampling

      // Helper to compute multi-harmonic peak height for Wave 1 (Back)
      const getWave1Peak = (x: number) => {
        const h =
          Math.sin(x * ((Math.PI * 2 * 1.35) / W) + phase * 0.85) * 0.6 +
          Math.sin(x * ((Math.PI * 2 * 2.7) / W) - phase * 0.65) * 0.4;
        const norm = (h + 1) * 0.5;
        return Math.pow(norm, 1.2) * maxRise * 0.75;
      };

      // Helper to compute multi-harmonic peak height for Wave 2 (Mid)
      const getWave2Peak = (x: number) => {
        const h =
          Math.sin(x * ((Math.PI * 2 * 2.05) / W) - phase * 1.05 + 1.2) * 0.55 +
          Math.sin(x * ((Math.PI * 2 * 4.1) / W) + phase * 0.75) * 0.35 +
          Math.cos(x * ((Math.PI * 2 * 1.1) / W) + phase * 0.4) * 0.1;
        const norm = (h + 1) * 0.5;
        return Math.pow(norm, 1.3) * maxRise * 0.88;
      };

      // Helper to compute multi-harmonic peak height for Wave 3 (Front)
      const getWave3Peak = (x: number) => {
        const h =
          Math.sin(x * ((Math.PI * 2 * 2.85) / W) + phase * 1.3 + 2.4) * 0.6 +
          Math.sin(x * ((Math.PI * 2 * 5.4) / W) - phase * 0.95 + 0.8) * 0.4;
        const norm = (h + 1) * 0.5;
        return Math.pow(norm, 1.35) * maxRise * 1.0;
      };

      const dark =
        isDarkRef.current ||
        document.documentElement.classList.contains("dark");

      // 1. BACK WAVE
      {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += step) {
          ctx.lineTo(x, H - getWave1Peak(x));
        }
        ctx.lineTo(W, H);
        ctx.closePath();

        const grad1 = ctx.createLinearGradient(0, 0, 0, H);
        if (dark) {
          grad1.addColorStop(0, "rgba(165, 180, 252, 0.02)");
          grad1.addColorStop(1, "rgba(129, 140, 248, 0.22)");
        } else {
          grad1.addColorStop(0, "rgba(129, 140, 248, 0.02)");
          grad1.addColorStop(1, "rgba(129, 140, 248, 0.16)");
        }
        ctx.fillStyle = grad1;
        ctx.fill();

        // Stroke along top crest
        ctx.beginPath();
        for (let x = 0; x <= W; x += step) {
          const y = H - getWave1Peak(x);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = dark
          ? "rgba(165, 180, 252, 0.35)"
          : "rgba(129, 140, 248, 0.25)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      // 2. MID WAVE
      {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += step) {
          ctx.lineTo(x, H - getWave2Peak(x));
        }
        ctx.lineTo(W, H);
        ctx.closePath();

        const grad2 = ctx.createLinearGradient(0, 0, 0, H);
        if (dark) {
          grad2.addColorStop(0, "rgba(129, 140, 248, 0.04)");
          grad2.addColorStop(1, "rgba(99, 102, 241, 0.30)");
        } else {
          grad2.addColorStop(0, "rgba(99, 102, 241, 0.03)");
          grad2.addColorStop(1, "rgba(99, 102, 241, 0.20)");
        }
        ctx.fillStyle = grad2;
        ctx.fill();

        // Stroke along top crest
        ctx.beginPath();
        for (let x = 0; x <= W; x += step) {
          const y = H - getWave2Peak(x);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = dark
          ? "rgba(129, 140, 248, 0.55)"
          : "rgba(99, 102, 241, 0.35)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }

      // 3. FRONT WAVE
      {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += step) {
          ctx.lineTo(x, H - getWave3Peak(x));
        }
        ctx.lineTo(W, H);
        ctx.closePath();

        const grad3 = ctx.createLinearGradient(0, 0, 0, H);
        if (dark) {
          grad3.addColorStop(0, "rgba(99, 102, 241, 0.06)");
          grad3.addColorStop(1, "rgba(79, 70, 229, 0.40)");
        } else {
          grad3.addColorStop(0, "rgba(79, 70, 229, 0.04)");
          grad3.addColorStop(1, "rgba(79, 70, 229, 0.25)");
        }
        ctx.fillStyle = grad3;
        ctx.fill();

        // Stroke along top crest
        ctx.beginPath();
        for (let x = 0; x <= W; x += step) {
          const y = H - getWave3Peak(x);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = dark
          ? "rgba(165, 180, 252, 0.85)"
          : "rgba(79, 70, 229, 0.50)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }

      // Top-edge vertical fade mask so peaks dissolve seamlessly into the pill background
      ctx.save();
      ctx.globalCompositeOperation = "destination-in";
      const maskGrad = ctx.createLinearGradient(0, 0, 0, H);
      maskGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
      maskGrad.addColorStop(0.3, "rgba(0, 0, 0, 0.75)");
      maskGrad.addColorStop(0.55, "rgba(0, 0, 0, 1)");
      maskGrad.addColorStop(1, "rgba(0, 0, 0, 1)");
      ctx.fillStyle = maskGrad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      ctx.restore();
      animFrameIdRef.current = requestAnimationFrame(render);
    };

    startRenderRef.current = () => {
      lastTime = performance.now();
      if (animFrameIdRef.current === null) {
        animFrameIdRef.current = requestAnimationFrame(render);
      }
    };

    if (activeRef.current) {
      animFrameIdRef.current = requestAnimationFrame(render);
    }

    return () => {
      startRenderRef.current = null;
      resizeObserver.disconnect();
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full relative overflow-hidden pointer-events-none select-none ${className}`}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block pointer-events-none select-none"
      />
    </div>
  );
}
