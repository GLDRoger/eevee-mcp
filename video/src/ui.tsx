import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Callout as CalloutSpec } from "./timeline";
import { theme } from "./theme";

const rise = (frame: number, fps: number, from: number, to: number) =>
  interpolate(frame, [from, from + 0.55 * fps, to - 0.3 * fps, to], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

// A floating note over the footage, styled like the landing page's cards.
export const Callout: React.FC<{ spec: CalloutSpec; width: number; height: number }> = ({ spec, width, height }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const from = spec.at * fps;
  const to = (spec.until ?? spec.at + 4.6) * fps;
  if (frame < from || frame > to) return null;
  const progress = rise(frame, fps, from, to);
  const base = {
    position: "absolute" as const,
    left: spec.x * width,
    top: spec.y * height,
    translate: `-50% calc(-50% + ${(1 - progress) * 18}px)`,
    opacity: progress,
    scale: String(0.94 + progress * 0.06),
    whiteSpace: "nowrap" as const,
    borderRadius: 14,
    boxShadow: "0 2px 4px rgba(10, 12, 30, 0.08), 0 18px 44px rgba(10, 12, 30, 0.22)",
    fontSize: 30,
    lineHeight: 1,
    padding: "18px 26px",
  };
  if (spec.kind === "code") {
    return (
      <div style={{ ...base, background: theme.ink, color: "#fff", fontFamily: theme.mono, fontSize: 27, border: "1px solid rgba(255,255,255,0.12)" }}>
        {spec.text}
      </div>
    );
  }
  if (spec.kind === "key") {
    return (
      <div style={{ ...base, background: theme.paper, color: theme.pine, fontFamily: theme.body, fontWeight: 700, border: `1.5px solid ${theme.pine}`, display: "flex", gap: 14, alignItems: "center" }}>
        <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx={8} cy={12} r={4.5} />
          <path d="M12.5 12H21M18 12v3.5M15 12v2.5" />
        </svg>
        {spec.text}
      </div>
    );
  }
  if (spec.kind === "chip") {
    return (
      <div style={{ ...base, background: theme.paper, color: theme.ink, fontFamily: theme.body, fontWeight: 600, border: `1px solid ${theme.ruleStrong}`, borderRadius: 999 }}>
        {spec.text}
      </div>
    );
  }
  return (
    <div style={{ ...base, background: theme.paper, color: theme.ink, fontFamily: theme.display, fontSize: 32, fontVariationSettings: "'wght' 600", border: `1px solid ${theme.ruleStrong}` }}>
      {spec.text}
    </div>
  );
};

// Sentence-level subtitle for the narration, so the cut reads on mute.
export const Caption: React.FC<{ text: string; duration: number; delay: number }> = ({ text, duration, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((entry) => entry.trim()) ?? [text];
  const characters = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
  const t = frame / fps - delay;
  if (t < 0) return null;
  let elapsed = 0;
  let current = sentences[sentences.length - 1];
  let sentenceStart = 0;
  for (const sentence of sentences) {
    const share = (sentence.length / characters) * duration;
    if (t < elapsed + share) {
      current = sentence;
      sentenceStart = elapsed;
      break;
    }
    elapsed += share;
  }
  const local = (t - sentenceStart) * fps;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 46,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: 1500,
          padding: "14px 28px",
          borderRadius: 12,
          background: "rgba(8, 10, 26, 0.72)",
          color: "#fff",
          fontFamily: theme.body,
          fontSize: 34,
          lineHeight: 1.3,
          textAlign: "center",
          opacity: interpolate(local, [0, 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          translate: `0 ${interpolate(local, [0, 8], [6, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px`,
        }}
      >
        {current}
      </div>
    </div>
  );
};

export const Wordmark: React.FC<{ size?: number; color?: string }> = ({ size = 64, color = "#fff" }) => (
  <span style={{ fontFamily: theme.display, fontVariationSettings: "'wght' 780", fontSize: size, color, letterSpacing: "-0.01em", lineHeight: 1 }}>
    EEVEE
  </span>
);
