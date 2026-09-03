// Devpost gallery posters and the thumbnail, rendered as 3:2 stills.
import { AbsoluteFill, Img, staticFile } from "remotion";
import { Background } from "./Background";
import { theme } from "./theme";
import { Wordmark } from "./ui";

const W = 1920;
const H = 1280;

const Chip: React.FC<{
  text: string;
  kind: "chip" | "key" | "code" | "card";
  x: number;
  y: number;
  rotate?: number;
}> = ({ text, kind, x, y, rotate = 0 }) => {
  const base = {
    position: "absolute" as const,
    left: x,
    top: y,
    rotate: `${rotate}deg`,
    whiteSpace: "nowrap" as const,
    borderRadius: 16,
    boxShadow:
      "0 2px 4px rgba(10, 12, 30, 0.08), 0 20px 48px rgba(10, 12, 30, 0.28)",
    fontSize: 34,
    lineHeight: 1,
    padding: "20px 30px",
  };
  if (kind === "code")
    return (
      <div
        style={{
          ...base,
          background: theme.ink,
          color: "#fff",
          fontFamily: theme.mono,
          fontSize: 30,
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        {text}
      </div>
    );
  if (kind === "key")
    return (
      <div
        style={{
          ...base,
          background: theme.paper,
          color: theme.pine,
          fontFamily: theme.body,
          fontWeight: 700,
          border: `1.5px solid ${theme.pine}`,
          display: "flex",
          gap: 14,
          alignItems: "center",
        }}
      >
        <svg
          width={30}
          height={30}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx={8} cy={12} r={4.5} />
          <path d="M12.5 12H21M18 12v3.5M15 12v2.5" />
        </svg>
        {text}
      </div>
    );
  if (kind === "chip")
    return (
      <div
        style={{
          ...base,
          background: theme.paper,
          color: theme.ink,
          fontFamily: theme.body,
          fontWeight: 600,
          border: `1px solid ${theme.ruleStrong}`,
          borderRadius: 999,
        }}
      >
        {text}
      </div>
    );
  return (
    <div
      style={{
        ...base,
        background: theme.paper,
        color: theme.ink,
        fontFamily: theme.display,
        fontSize: 36,
        fontVariationSettings: "'wght' 600",
        border: `1px solid ${theme.ruleStrong}`,
      }}
    >
      {text}
    </div>
  );
};

const Mark: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      display: "inline-block",
      whiteSpace: "nowrap",
      padding: "0 0.28em 0.04em",
      borderRadius: "0.2em",
      background: theme.goldWash,
      boxShadow: `inset 0 0 0 1px ${theme.goldLine}`,
      color: theme.gold,
      fontStyle: "italic",
      fontVariationSettings: "'wght' 520",
    }}
  >
    {children}
  </span>
);

const Kicker: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p
    style={{
      margin: 0,
      fontFamily: theme.body,
      fontSize: 28,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      color: theme.gold,
    }}
  >
    {children}
  </p>
);

const Headline: React.FC<{
  children: React.ReactNode;
  size?: number;
  width?: number;
}> = ({ children, size = 84, width = 1100 }) => (
  <h1
    style={{
      margin: "16px 0 0",
      maxWidth: width,
      fontFamily: theme.display,
      fontVariationSettings: "'wght' 760",
      fontSize: size,
      lineHeight: 1.04,
      color: "#fff",
      letterSpacing: "-0.015em",
    }}
  >
    {children}
  </h1>
);

const Lede: React.FC<{ children: React.ReactNode; width?: number }> = ({
  children,
  width = 1000,
}) => (
  <p
    style={{
      margin: "26px 0 0",
      maxWidth: width,
      fontFamily: theme.body,
      fontSize: 36,
      lineHeight: 1.35,
      color: "rgba(255,255,255,0.78)",
    }}
  >
    {children}
  </p>
);

// A screenshot in the same rounded window as the video, tilted a little.
const Window: React.FC<{
  src: string;
  x: number;
  y: number;
  width: number;
  focus?: string;
  scale?: number;
  tilt?: number;
}> = ({ src, x, y, width, focus = "50% 50%", scale = 1, tilt = 0 }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width,
      height: (width * 9) / 16,
      borderRadius: 22,
      overflow: "hidden",
      background: "#fff",
      boxShadow:
        "0 0 0 1px rgba(255,255,255,0.18), 0 40px 100px rgba(0, 0, 10, 0.6)",
      rotate: `${tilt}deg`,
    }}
  >
    <Img
      src={staticFile(src)}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        transformOrigin: focus,
        scale: String(scale),
      }}
    />
  </div>
);

const Frame: React.FC<{ children: React.ReactNode; dim?: number }> = ({
  children,
  dim = 0.1,
}) => (
  <AbsoluteFill style={{ width: W, height: H }}>
    <Background dim={dim} />
    {children}
    <div
      style={{
        position: "absolute",
        left: 100,
        bottom: 70,
        display: "flex",
        alignItems: "baseline",
        gap: 22,
      }}
    >
      <Wordmark size={54} />
      <span
        style={{
          fontFamily: theme.body,
          fontSize: 28,
          color: "rgba(255,255,255,0.6)",
        }}
      >
        agents build the app · you hold the key
      </span>
    </div>
    <div
      style={{
        position: "absolute",
        right: 100,
        bottom: 78,
        fontFamily: theme.body,
        fontSize: 28,
        color: "rgba(255,255,255,0.6)",
      }}
    >
      eevee-mcp.vercel.app
    </div>
  </AbsoluteFill>
);

export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{ width: W, height: H }}>
    <Background dim={0} />
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        paddingBottom: 60,
      }}
    >
      <div
        style={{
          fontFamily: theme.display,
          fontVariationSettings: "'wght' 720",
          fontSize: 40,
          color: "rgba(255,255,255,0.7)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          marginBottom: 44,
        }}
      >
        EEVEE MCP
      </div>
      <h1
        style={{
          margin: 0,
          maxWidth: 1500,
          textAlign: "center",
          fontFamily: theme.display,
          fontVariationSettings: "'wght' 760",
          fontSize: 118,
          lineHeight: 1.04,
          color: "#fff",
          letterSpacing: "-0.015em",
        }}
      >
        What if your agent could run the office, and still never touch a record{" "}
        <Mark>without you?</Mark>
      </h1>
      <div
        style={{
          marginTop: 54,
          fontFamily: theme.body,
          fontSize: 44,
          color: "rgba(255,255,255,0.8)",
        }}
      >
        agents build the app · you hold the key
      </div>
      <div style={{ marginTop: 60, display: "flex", gap: 24 }}>
        <span
          style={{
            padding: "18px 34px",
            borderRadius: 999,
            background: theme.paper,
            color: theme.ink,
            fontFamily: theme.body,
            fontWeight: 600,
            fontSize: 32,
          }}
        >
          28 WebMCP tools on the bench
        </span>
        <span
          style={{
            padding: "18px 34px",
            borderRadius: 999,
            background: theme.paper,
            color: theme.pine,
            fontFamily: theme.body,
            fontWeight: 700,
            fontSize: 32,
            border: `1.5px solid ${theme.pine}`,
          }}
        >
          passkey on every write
        </span>
      </div>
    </AbsoluteFill>
    <div
      style={{
        position: "absolute",
        right: 100,
        bottom: 78,
        fontFamily: theme.body,
        fontSize: 28,
        color: "rgba(255,255,255,0.6)",
      }}
    >
      eevee-mcp.vercel.app
    </div>
  </AbsoluteFill>
);

export const PosterRehearsal: React.FC = () => (
  <Frame>
    <div style={{ position: "absolute", left: 100, top: 110 }}>
      <Kicker>Every write, rehearsed first</Kicker>
      <Headline>
        The agent asks. You see the <Mark>exact diff.</Mark>
      </Headline>
      <Lede width={760}>
        Rehearsed against current data before anything changes: which record,
        which field, from what, to what. Approve with your passkey, reject with
        a reason, or grant a short lease.
      </Lede>
    </div>
    <Window
      src="gallery-frames/rehearsal.png"
      x={880}
      y={470}
      width={1150}
      focus="18% 45%"
      scale={1.45}
      tilt={-2}
    />
    <Chip
      text="INK-CY stock 12 → 20 · audit entry added"
      kind="code"
      x={760}
      y={1000}
      rotate={-2}
    />
    <Chip
      text="approved with the passkey"
      kind="key"
      x={1300}
      y={380}
      rotate={2}
    />
  </Frame>
);

export const PosterProve: React.FC = () => (
  <Frame>
    <div style={{ position: "absolute", left: 100, top: 110 }}>
      <Kicker>Prove, then publish</Kicker>
      <Headline>
        Nothing publishes until your <Mark>passkey</Mark> says so.
      </Headline>
      <Lede width={760}>
        The agent builds the app and runs its behavioral suite in a sandboxed
        worker in your browser. You read the source, the verdicts, and the live
        preview. Approve & publish binds to that exact version.
      </Lede>
    </div>
    <Window
      src="gallery-frames/review.png"
      x={880}
      y={470}
      width={1150}
      focus="40% 30%"
      scale={1.25}
      tilt={-2}
    />
    <Chip
      text="4 of 4 scenarios passed"
      kind="card"
      x={720}
      y={1010}
      rotate={-2}
    />
    <Chip
      text="published v1 · bound to this version"
      kind="key"
      x={1220}
      y={380}
      rotate={2}
    />
  </Frame>
);

export const PosterTools: React.FC = () => (
  <Frame>
    <div style={{ position: "absolute", left: 100, top: 110 }}>
      <Kicker>Built on WebMCP</Kicker>
      <Headline>
        A published app becomes <Mark>32 tools.</Mark>
      </Headline>
      <Lede width={760}>
        28 tools on the bench through document.modelContext, plus one per
        declared action the moment a run opens. Reads run at once. Writes wait
        for you. No model inside: bring any WebMCP agent.
      </Lede>
    </div>
    <Window
      src="gallery-frames/run.png"
      x={880}
      y={470}
      width={1150}
      focus="88% 12%"
      scale={1.4}
      tilt={-2}
    />
    <Chip
      text="document.modelContext.registerTool"
      kind="code"
      x={700}
      y={1010}
      rotate={-2}
    />
    <Chip
      text="32 of 32 live as agent tools"
      kind="chip"
      x={1240}
      y={380}
      rotate={2}
    />
  </Frame>
);

export const PosterStudio: React.FC = () => (
  <Frame>
    <div style={{ position: "absolute", left: 100, top: 110 }}>
      <Kicker>Studio</Kicker>
      <Headline>
        Word, Sheets, and Slides <Mark>without the subscription.</Mark>
      </Headline>
      <Lede width={760}>
        Start blank or open a Library file in a real editor. The agent edits
        cells, formulas, charts, and pivots through a typed tool, and you watch
        each save land as a new version.
      </Lede>
    </div>
    <Window
      src="gallery-frames/studio.png"
      x={880}
      y={470}
      width={1150}
      focus="30% 25%"
      scale={1.3}
      tilt={-2}
    />
    <Chip
      text="edit_spreadsheet · formulas only → v3"
      kind="code"
      x={720}
      y={1010}
      rotate={-2}
    />
    <Chip
      text="every save is an immutable version"
      kind="chip"
      x={1200}
      y={380}
      rotate={2}
    />
  </Frame>
);

export const PosterLibrary: React.FC = () => (
  <Frame>
    <div style={{ position: "absolute", left: 100, top: 110 }}>
      <Kicker>Library</Kicker>
      <Headline>
        The agent sees <Mark>masks,</Mark> never the values.
      </Headline>
      <Lede width={760}>
        Your own DOCX, XLSX, PPTX, and PDF, versioned on your own Postgres. A
        sensitive-text scan hands the agent masked findings; removing them is a
        new version behind your passkey.
      </Lede>
    </div>
    <Window
      src="gallery-frames/library.png"
      x={880}
      y={470}
      width={1150}
      focus="35% 65%"
      scale={1.35}
      tilt={-2}
    />
    <Chip
      text="p•••@n•••.example · ••• ••• 0142"
      kind="code"
      x={720}
      y={1010}
      rotate={-2}
    />
    <Chip
      text="removing them needs your passkey"
      kind="key"
      x={1180}
      y={380}
      rotate={2}
    />
  </Frame>
);

export const PosterBaby: React.FC = () => (
  <Frame dim={0}>
    <div style={{ position: "absolute", left: 100, top: 120, width: 1720 }}>
      <Kicker>Parentage</Kicker>
      <Headline size={110} width={1700}>
        <span style={{ whiteSpace: "nowrap" }}>Lovable × ChatGPT × Chrome</span>{" "}
        <Mark>had a baby.</Mark>
      </Headline>
      <Lede width={1500}>
        The baby got the trust issues. It rehearses every write before it
        happens, asks you before it touches a record, and keeps receipts on
        everything. Compulsively.
      </Lede>
      <div style={{ display: "flex", gap: 28, marginTop: 70 }}>
        {[
          [
            "From Lovable",
            "Builds the app from a sentence. Keeps every version. Shows a preview before it asks for anything.",
          ],
          [
            "From ChatGPT",
            "Brings the brain. Any WebMCP agent, ChatGPT's browser first. EEVEE has no model of its own.",
          ],
          [
            "From Chrome",
            "Lives in the tab. The tools are on the page, so the agent and you look at the same screen.",
          ],
          [
            "What it added",
            "Rehearsals. Approvals. Receipts. The three things nobody asked for and everybody needed.",
          ],
        ].map(([from, trait], index) => (
          <div
            key={from}
            style={{
              flex: 1,
              padding: "28px 30px",
              borderRadius: 18,
              background: index === 3 ? theme.paper : "rgba(255,255,255,0.06)",
              border: index === 3 ? "none" : "1px solid rgba(255,255,255,0.18)",
              color: index === 3 ? theme.ink : "#fff",
            }}
          >
            <div
              style={{
                fontFamily: theme.body,
                fontSize: 24,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: index === 3 ? theme.stamp : theme.gold,
                marginBottom: 14,
              }}
            >
              {from}
            </div>
            <div
              style={{ fontFamily: theme.body, fontSize: 30, lineHeight: 1.35 }}
            >
              {trait}
            </div>
          </div>
        ))}
      </div>
    </div>
  </Frame>
);
