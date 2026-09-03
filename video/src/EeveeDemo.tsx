import { Audio } from "@remotion/media";
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./Background";
import { Outro } from "./scenes/Outro";
import { Screen } from "./scenes/Screen";
import { Title } from "./scenes/Title";
import { buildTimeline, frames, totalDuration, type Scene } from "./timeline";
import { Caption } from "./ui";

export const timeline = buildTimeline();
export const DURATION = totalDuration(timeline);

const SceneBody: React.FC<{ scene: Scene }> = ({ scene }) => {
  if (scene.kind === "title") return <Title />;
  if (scene.kind === "outro") return <Outro />;
  return <Screen scene={scene} />;
};

// Music sits under the voice and comes up when nobody is talking.
const musicVolume = (t: number, total: number) => {
  const speaking = timeline.some((scene) => scene.voice && t >= scene.start + scene.voice.delay - 0.3 && t <= scene.start + scene.voice.delay + scene.voice.duration + 0.4);
  const bed = speaking ? 0.16 : 0.32;
  const fadeIn = interpolate(t, [0, 1.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(t, [total - 3, total - 0.2], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return bed * fadeIn * fadeOut;
};

export const EeveeDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Background dim={timeline.find((scene) => scene.kind === "screen" && frame >= frames(scene.start) && frame < frames(scene.start + scene.duration)) ? 0.25 : 0} />
      {timeline.map((scene) => (
        <Sequence key={scene.id} name={scene.id} from={frames(scene.start)} durationInFrames={frames(scene.duration)} premountFor={fps}>
          <SceneBody scene={scene} />
          {scene.voice ? (
            <Sequence from={frames(scene.voice.delay)} layout="none">
              <Audio src={staticFile(scene.voice.file)} />
              {scene.kind === "outro" ? null : <Caption text={scene.voice.text} duration={scene.voice.duration} delay={0} />}
            </Sequence>
          ) : null}
        </Sequence>
      ))}
      <Audio
        src={staticFile("music/deliberate-thought.mp3")}
        loop
        loopVolumeCurveBehavior="extend"
        volume={(f) => musicVolume(f / fps, DURATION)}
      />
    </AbsoluteFill>
  );
};
