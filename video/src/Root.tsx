import "./index.css";
import { Composition, Folder, Still } from "remotion";
import {
  PosterBaby,
  PosterLibrary,
  PosterProve,
  PosterRehearsal,
  PosterStudio,
  PosterTools,
  Thumbnail,
} from "./Gallery";
import { DURATION, EeveeDemo } from "./EeveeDemo";
import { fontsReady } from "./fonts";
import { FPS } from "./timeline";

export const RemotionRoot: React.FC = () => {
  const posters = [
    ["Thumbnail", Thumbnail],
    ["PosterRehearsal", PosterRehearsal],
    ["PosterProve", PosterProve],
    ["PosterTools", PosterTools],
    ["PosterStudio", PosterStudio],
    ["PosterLibrary", PosterLibrary],
    ["PosterBaby", PosterBaby],
  ] as const;
  return (
    <>
      <Folder name="Gallery">
        {posters.map(([id, component]) => (
          <Still
            key={id}
            id={id}
            component={component}
            width={1920}
            height={1280}
            calculateMetadata={async () => {
              await fontsReady;
              return {};
            }}
          />
        ))}
      </Folder>
      <Composition
        id="EeveeDemo"
        component={EeveeDemo}
        durationInFrames={Math.round(DURATION * FPS)}
        fps={FPS}
        width={1920}
        height={1080}
        calculateMetadata={async () => {
          await fontsReady;
          return {};
        }}
      />
    </>
  );
};
