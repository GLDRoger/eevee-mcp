import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

const WORDS = ["What", "if", "your", "agent", "could", "run", "the", "office,", "and", "still", "never", "touch", "a", "record"];

export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const out = interpolate(frame, [durationInFrames - 0.5 * fps, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: out }}>
      <div
        style={{
          fontFamily: theme.display,
          fontVariationSettings: "'wght' 720",
          fontSize: 34,
          color: "rgba(255,255,255,0.7)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          marginBottom: 34,
          opacity: interpolate(frame, [0, 0.5 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        EEVEE MCP
      </div>
      <h1
        style={{
          margin: 0,
          maxWidth: 1400,
          textAlign: "center",
          fontFamily: theme.display,
          fontVariationSettings: "'wght' 760",
          fontSize: 108,
          lineHeight: 1.04,
          color: "#fff",
          letterSpacing: "-0.015em",
        }}
      >
        {WORDS.map((word, index) => (
          <span key={index} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "bottom", whiteSpace: "pre" }}>
            <span
              style={{
                display: "inline-block",
                translate: `0 ${interpolate(frame, [index * 1.6 + 4, index * 1.6 + 22], [110, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}%`,
                opacity: interpolate(frame, [index * 1.6 + 4, index * 1.6 + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              }}
            >
              {word}{" "}
            </span>
          </span>
        ))}
        <span style={{ display: "inline-block", overflow: "hidden", verticalAlign: "bottom" }}>
          <span
            style={{
              display: "inline-block",
              padding: "0 0.28em 0.04em",
              borderRadius: "0.2em",
              background: theme.goldWash,
              boxShadow: `inset 0 0 0 1px ${theme.goldLine}`,
              color: theme.gold,
              fontStyle: "italic",
              fontVariationSettings: "'wght' 520",
              translate: `0 ${interpolate(frame, [28, 48], [110, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}%`,
              opacity: interpolate(frame, [28, 42], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            without you?
          </span>
        </span>
      </h1>
      <div
        style={{
          marginTop: 40,
          fontFamily: theme.body,
          fontSize: 36,
          color: "rgba(255,255,255,0.78)",
          opacity: interpolate(frame, [52, 70], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        agents build the app · you hold the key
      </div>
    </AbsoluteFill>
  );
};
