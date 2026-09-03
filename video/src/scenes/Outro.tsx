import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";
import { Wordmark } from "../ui";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const show = (at: number) =>
    interpolate(frame, [at * fps, (at + 0.7) * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) });
  const exit = interpolate(frame, [durationInFrames - 1.2 * fps, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: exit }}>
      <div style={{ opacity: show(0.1), translate: `0 ${(1 - show(0.1)) * 30}px` }}>
        <Wordmark size={150} />
      </div>
      <div style={{ marginTop: 14, fontFamily: theme.display, fontVariationSettings: "'wght' 600", fontSize: 54, color: "#fff", opacity: show(1.4), translate: `0 ${(1 - show(1.4)) * 20}px` }}>
        Agents build the app.{" "}
        <span style={{ padding: "0 0.28em 0.04em", borderRadius: "0.2em", background: theme.goldWash, boxShadow: `inset 0 0 0 1px ${theme.goldLine}`, color: theme.gold, fontStyle: "italic" }}>
          You hold the key.
        </span>
      </div>
      <div style={{ marginTop: 70, display: "flex", gap: 28, opacity: show(3.4), translate: `0 ${(1 - show(3.4)) * 20}px` }}>
        <div style={{ padding: "22px 40px", borderRadius: 14, background: theme.stamp, color: "#fff", fontFamily: theme.body, fontWeight: 700, fontSize: 44 }}>
          eevee-mcp.vercel.app
        </div>
        <div style={{ padding: "22px 40px", borderRadius: 14, background: "rgba(255,255,255,0.08)", boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.35)", color: "#fff", fontFamily: theme.body, fontSize: 44 }}>
          github.com/GLDRoger/eevee-mcp
        </div>
      </div>
      <div style={{ marginTop: 44, fontFamily: theme.body, fontSize: 30, color: "rgba(255,255,255,0.6)", opacity: show(4.2) }}>
        Built for The WebMCP Challenge · works in ChatGPT's browser and Chrome with WebMCP
      </div>
      <div style={{ marginTop: 18, fontFamily: theme.body, fontSize: 24, color: "rgba(255,255,255,0.45)", opacity: show(4.6) }}>
        Music: "Deliberate Thought" by Kevin MacLeod (incompetech.com), CC BY 4.0
      </div>
    </AbsoluteFill>
  );
};
