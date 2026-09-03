import { Video } from "@remotion/media";
import { AbsoluteFill, Easing, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Scene, Zoom } from "../timeline";
import { Callout } from "../ui";

const WINDOW_WIDTH = 1600;
const WINDOW_HEIGHT = 900;
const ZOOM_SECONDS = 0.9;

// The camera: a scale around a focus point, easing between the scene's zoom
// keyframes. Between keyframes it holds; ZOOM_SECONDS before the next one it
// starts moving so the move lands on the mark.
const camera = (t: number, zooms: Zoom[]) => {
  let previous: Zoom = { at: -1, scale: 1, x: 0.5, y: 0.5 };
  for (const zoom of zooms) {
    if (t >= zoom.at) {
      previous = zoom;
      continue;
    }
    const startAt = zoom.at - ZOOM_SECONDS;
    if (t <= startAt) return previous;
    const p = Easing.bezier(0.45, 0, 0.2, 1)((t - startAt) / ZOOM_SECONDS);
    return {
      at: t,
      scale: previous.scale + (zoom.scale - previous.scale) * p,
      x: previous.x + (zoom.x - previous.x) * p,
      y: previous.y + (zoom.y - previous.y) * p,
    };
  }
  return previous;
};

export const Screen: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const view = camera(t, scene.zooms);
  const enter = interpolate(frame, [0, 0.6 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) });
  const exit = interpolate(frame, [durationInFrames - 0.4 * fps, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  let offset = 0;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 30 }}>
      <div
        style={{
          position: "relative",
          width: WINDOW_WIDTH,
          height: WINDOW_HEIGHT,
          borderRadius: 18,
          overflow: "hidden",
          background: "#fff",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.18), 0 30px 80px rgba(0, 0, 10, 0.55)",
          opacity: enter * exit,
          translate: `0 ${(1 - enter) * 40}px`,
          scale: String(0.985 + enter * 0.015),
        }}
      >
        <div
          style={{
            width: WINDOW_WIDTH,
            height: WINDOW_HEIGHT,
            transformOrigin: `${view.x * 100}% ${view.y * 100}%`,
            scale: String(view.scale),
          }}
        >
          {scene.segments.map((segment, index) => {
            const length = (segment.to - segment.from) / scene.rate;
            const from = Math.round(offset * fps);
            offset += length;
            return (
              <Sequence key={index} from={from} durationInFrames={Math.max(1, Math.round(length * fps) + (index === scene.segments.length - 1 ? 6 * fps : 0))} premountFor={fps}>
                <Video
                  src={staticFile(`rec/${segment.clip}.mp4`)}
                  trimBefore={Math.round(segment.from * fps)}
                  playbackRate={scene.rate}
                  muted
                  style={{ width: WINDOW_WIDTH, height: WINDOW_HEIGHT, display: "block" }}
                />
              </Sequence>
            );
          })}
        </div>
        {scene.callouts.map((callout, index) => (
          <Callout key={index} spec={callout} width={WINDOW_WIDTH} height={WINDOW_HEIGHT} />
        ))}
      </div>
    </AbsoluteFill>
  );
};
