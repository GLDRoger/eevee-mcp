import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "./theme";

// Deterministic star field: the same 110 stars every render.
const STARS = Array.from({ length: 110 }, (_, index) => {
  const seed = Math.sin(index * 12.9898) * 43758.5453;
  const x = seed - Math.floor(seed);
  const seed2 = Math.sin(index * 78.233) * 43758.5453;
  const y = seed2 - Math.floor(seed2);
  const seed3 = Math.sin(index * 39.425) * 43758.5453;
  const r = 0.6 + (seed3 - Math.floor(seed3)) * 1.4;
  return { x: x * 1920, y: y * 720, r, phase: index * 0.7 };
});

export const Background: React.FC<{ dim?: number }> = ({ dim = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1400px 620px at 50% 118%, oklch(62% 0.13 70 / 0.5), transparent 62%), linear-gradient(180deg, ${theme.nightDeep} 0%, ${theme.night} 55%, oklch(24% 0.07 280) 100%)`,
      }}
    >
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {STARS.map((star, index) => (
          <circle
            key={index}
            cx={star.x}
            cy={star.y}
            r={star.r}
            fill="#fff"
            opacity={0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.6 + star.phase))}
          />
        ))}
      </svg>
      <svg
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        width={2100}
        height={420}
        style={{ position: "absolute", left: -90 + Math.sin(t * 0.25) * 20, bottom: -20, opacity: 0.9 }}
      >
        <path fill={theme.hillFar} d="M0 220 C 180 140, 330 150, 480 190 S 760 260, 940 200 S 1240 110, 1440 170 L1440 320 L0 320 Z" />
      </svg>
      <svg
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        width={2100}
        height={360}
        style={{ position: "absolute", left: -90 + Math.sin(t * 0.25 + 1) * 12, bottom: -30 }}
      >
        <path fill={theme.hillMid} d="M0 250 C 200 200, 360 230, 520 240 S 820 180, 1000 230 S 1300 260, 1440 210 L1440 320 L0 320 Z" />
      </svg>
      <svg
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        width={2100}
        height={300}
        style={{ position: "absolute", left: -90, bottom: -40 }}
      >
        <path fill={theme.hillNear} d="M0 290 C 240 250, 420 270, 620 280 S 980 250, 1180 275 S 1380 300, 1440 280 L1440 320 L0 320 Z" />
      </svg>
      {dim > 0 ? <AbsoluteFill style={{ background: `rgba(8, 10, 24, ${dim})` }} /> : null}
    </AbsoluteFill>
  );
};
