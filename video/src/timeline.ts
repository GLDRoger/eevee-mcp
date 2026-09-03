// The whole cut, in seconds, derived from the two recorded manifests: the
// narration (public/voice) sets each scene's length, the footage marks
// (public/rec) say where zooms and callouts land inside it.
import rec from "../public/rec/manifest.json";
import voice from "../public/voice/manifest.json";

export const FPS = 30;
export const VOICE_PAD = 0.6;

type ClipName = keyof typeof rec.scenes;
type Clip = { file: string; duration?: number; marks?: { label: string; t: number }[] };

const clips = rec.scenes as Record<ClipName, Clip>;

const markTime = (clip: ClipName, label: string, offset = 0) => {
  const mark = clips[clip].marks?.find((entry) => entry.label === label);
  if (!mark) throw new Error(`${clip} has no mark ${label}`);
  return mark.t + offset;
};
const clipEnd = (clip: ClipName) => clips[clip].duration ?? 0;

export type Segment = { clip: ClipName; from: number; to: number };
export type Zoom = { at: number; scale: number; x: number; y: number };
export type Callout = {
  at: number;
  until?: number;
  text: string;
  kind: "card" | "chip" | "key" | "code";
  x: number;
  y: number;
};
export type Scene = {
  id: string;
  kind: "title" | "screen" | "outro";
  start: number;
  duration: number;
  voice?: { file: string; duration: number; text: string; delay: number };
  segments: Segment[];
  rate: number;
  zooms: Zoom[];
  callouts: Callout[];
};

type Plan = {
  id: string;
  kind: Scene["kind"];
  voice?: string;
  fixed?: number;
  delay?: number;
  segments?: Segment[];
  // Zoom and callout times are relative to the scene start; `m` converts a
  // footage mark into scene time so they follow the recording, not a guess.
  zooms?: (m: (label: string, offset?: number) => number) => Zoom[];
  callouts?: (m: (label: string, offset?: number) => number) => Callout[];
};

const PLAN: Plan[] = [
  { id: "title", kind: "title", fixed: 3.6 },
  {
    id: "01-hook",
    kind: "screen",
    voice: "01-hook",
    segments: [{ clip: "landing", from: 0, to: markTime("landing", "family", 0.4) }],
  },
  {
    id: "02-baby",
    kind: "screen",
    voice: "02-baby",
    segments: [{ clip: "landing", from: markTime("landing", "family", 0.4), to: markTime("landing", "builtin", 0.3) }],
    callouts: (m) => [
      { at: m("parents", 1.2), text: "build from a sentence", kind: "chip", x: 0.2, y: 0.86 },
      { at: m("parents", 3.0), text: "any WebMCP agent · no model inside", kind: "chip", x: 0.5, y: 0.86 },
      { at: m("parents", 4.8), text: "tools on the page, same screen", kind: "chip", x: 0.8, y: 0.86 },
      { at: m("builtin", -4.2), text: "Rehearsals · Approvals · Receipts", kind: "card", x: 0.5, y: 0.5 },
    ],
  },
  {
    id: "03-builtin",
    kind: "screen",
    voice: "03-builtin",
    segments: [{ clip: "landing", from: markTime("landing", "builtin", 0.3), to: clipEnd("landing") }],
    callouts: (m) => [
      { at: m("builtin-list", 1.0), text: "their AI stops at the edge of the file", kind: "chip", x: 0.5, y: 0.86 },
      { at: m("builtin-list", 6.0), text: "app + files + decision · one bench · your agent", kind: "card", x: 0.5, y: 0.86 },
    ],
  },
  {
    id: "04-home",
    kind: "screen",
    voice: "04-home",
    segments: [{ clip: "home", from: 0, to: clipEnd("home") }],
    callouts: (m) => [{ at: m("guide", 0.8), text: "prompts you can paste", kind: "chip", x: 0.5, y: 0.14 }],
  },
  {
    id: "05-prove",
    kind: "screen",
    voice: "05-prove",
    segments: [{ clip: "install", from: 0, to: clipEnd("install") }],
    zooms: (m) => [
      { at: m("code", 1.0), scale: 1.38, x: 0.42, y: 0.16 },
      { at: m("app", -1.2), scale: 1, x: 0.5, y: 0.5 },
    ],
    callouts: (m) => [
      { at: m("agent:install_reference_applet", 0.6), text: "installed as a draft", kind: "chip", x: 0.2, y: 0.2 },
      { at: m("code", 2.0), text: "15 files · 7 modules · 32 typed actions", kind: "card", x: 0.5, y: 0.86 },
      { at: m("evaluate", 0.2), text: "evaluate_applet_version", kind: "code", x: 0.9, y: 0.34 },
      { at: m("evaluated", 1.2), text: "4 of 4 scenarios passed · sandboxed worker", kind: "card", x: 0.5, y: 0.86 },
    ],
  },
  {
    id: "06-publish",
    kind: "screen",
    voice: "06-publish",
    segments: [{ clip: "publish", from: 0, to: clipEnd("publish") }],
    zooms: (m) => [
      { at: m("passkey", 0.2), scale: 1.5, x: 0.78, y: 0.04 },
      { at: m("review", 0.4), scale: 1, x: 0.5, y: 0.5 },
      { at: m("approve", -0.8), scale: 1.35, x: 0.7, y: 0.12 },
      { at: m("published", 0.8), scale: 1, x: 0.5, y: 0.5 },
    ],
    callouts: (m) => [
      { at: m("passkey", 1.4), text: "passkey · ready", kind: "key", x: 0.6, y: 0.2 },
      { at: m("published", 0.5), text: "published v1 · bound to this exact version", kind: "key", x: 0.5, y: 0.86 },
    ],
  },
  {
    id: "07-run",
    kind: "screen",
    voice: "07-run",
    segments: [{ clip: "run", from: 0, to: clipEnd("run") }],
    zooms: (m) => [
      { at: m("tools-live", 0.4), scale: 1.45, x: 0.92, y: 0.1 },
      { at: m("agent:company_snapshot", 1.0), scale: 1, x: 0.5, y: 0.5 },
      { at: m("centered", 0.8), scale: 1.55, x: 0.36, y: 0.5 },
      { at: m("approved", 0.6), scale: 1, x: 0.5, y: 0.5 },
    ],
    callouts: (m) => [
      { at: m("tools-live", 1.0), text: "32 of 32 live as agent tools", kind: "chip", x: 0.68, y: 0.3 },
      { at: m("centered", 1.8), text: "INK-CY stock 12 → 20 · audit entry added", kind: "code", x: 0.5, y: 0.86 },
      { at: m("approved", 0.8), text: "approved with the passkey · tool call returned", kind: "key", x: 0.5, y: 0.86 },
    ],
  },
  {
    id: "08-lease",
    kind: "screen",
    voice: "08-lease",
    segments: [{ clip: "lease", from: 0, to: clipEnd("lease") }],
    zooms: (m) => [
      { at: m("lease", 0.8), scale: 1.5, x: 0.8, y: 0.04 },
      { at: m("agent:allocate_order", 0.3), scale: 1, x: 0.5, y: 0.5 },
      { at: m("reject", -0.3), scale: 1.45, x: 0.36, y: 0.48 },
      { at: m("rejected", 0.3), scale: 1, x: 0.5, y: 0.5 },
    ],
    callouts: (m) => [
      { at: m("lease", 1.6), text: "lease · 3 writes · 5 min", kind: "key", x: 0.6, y: 0.2 },
      { at: m("revoke", 0.6), text: "revoked · the next write waits", kind: "chip", x: 0.5, y: 0.86 },
      { at: m("rejected", 0.6), text: "rejected: They paid INV-5000 last week.", kind: "code", x: 0.5, y: 0.86 },
    ],
  },
  {
    id: "09-studio",
    kind: "screen",
    voice: "09-studio",
    segments: [{ clip: "studio", from: 0, to: clipEnd("studio") }],
    zooms: (m) => [
      { at: m("agent:edit_spreadsheet", 1.2), scale: 1.35, x: 0.45, y: 0.32 },
      { at: m("second", 3.2), scale: 1, x: 0.5, y: 0.5 },
    ],
    callouts: (m) => [
      { at: m("agent:edit_spreadsheet", 1.6), text: "edit_spreadsheet · cells + formulas → v2", kind: "code", x: 0.5, y: 0.86 },
      { at: m("second", 1.4), text: "every save is an immutable version", kind: "chip", x: 0.5, y: 0.86 },
    ],
  },
  {
    id: "10-library",
    kind: "screen",
    voice: "10-library",
    segments: [{ clip: "library", from: 0, to: clipEnd("library") }],
    zooms: (m) => [
      { at: m("review", 1.6), scale: 1.35, x: 0.42, y: 0.62 },
      { at: m("redacted", 0.8), scale: 1, x: 0.5, y: 0.5 },
    ],
    callouts: (m) => [
      { at: m("scan", 0.4), text: "scan_document_review → masks only", kind: "code", x: 0.5, y: 0.86 },
      { at: m("remove", -0.4), text: "removing them needs your passkey", kind: "key", x: 0.72, y: 0.86 },
      { at: m("redacted", 1.0), text: "v2 saved · the original stays v1", kind: "chip", x: 0.5, y: 0.86 },
    ],
  },
  { id: "11-close", kind: "outro", voice: "11-close", fixed: 11.5, delay: 0.6 },
];

const voiceLines = new Map(voice.lines.map((line) => [line.id, line]));

export const buildTimeline = (): Scene[] => {
  const scenes: Scene[] = [];
  let cursor = 0;
  // Where each clip's playhead actually stopped at the end of the previous
  // scene. A scene that continues the same clip picks up from there, so a
  // slowed-down scene never makes the next one jump back a few seconds.
  const reach = new Map<ClipName, number>();
  for (const plan of PLAN) {
    const line = plan.voice ? voiceLines.get(plan.voice) : undefined;
    if (plan.voice && !line) throw new Error(`no voice line ${plan.voice}; run scripts/voiceover.mjs`);
    const delay = plan.delay ?? 0;
    const duration = plan.fixed ?? (line ? line.duration + delay + VOICE_PAD : 0);
    const segments = (plan.segments ?? []).map((segment, index) => {
      const carried = reach.get(segment.clip);
      return index === 0 && carried !== undefined && carried > segment.from && carried < segment.to
        ? { ...segment, from: carried }
        : segment;
    });
    const footage = segments.reduce((sum, segment) => sum + (segment.to - segment.from), 0);
    // Footage plays a touch faster or slower to land on the narration; the
    // cursor and scroll easing hide anything inside this band.
    const rate = footage > 0 ? Math.min(1.3, Math.max(0.65, footage / duration)) : 1;
    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      const before = segments.slice(0, -1).reduce((sum, segment) => sum + (segment.to - segment.from), 0);
      reach.set(last.clip, last.from + Math.max(0, duration * rate - before));
    }
    if (footage > 0 && footage / rate < duration - 0.05) {
      console.warn(`${plan.id}: footage ${footage.toFixed(1)}s covers ${(footage / rate).toFixed(1)}s of a ${duration.toFixed(1)}s scene`);
    }
    const m = (label: string, offset = 0) => {
      const segment = segments[0];
      const at = markTime(segment.clip, label, offset);
      return (at - segment.from) / rate;
    };
    scenes.push({
      id: plan.id,
      kind: plan.kind,
      start: cursor,
      duration,
      voice: line ? { file: line.file, duration: line.duration, text: line.text, delay } : undefined,
      segments,
      rate,
      zooms: plan.zooms ? plan.zooms(m) : [],
      callouts: plan.callouts ? plan.callouts(m) : [],
    });
    cursor += duration;
  }
  return scenes;
};

export const totalDuration = (scenes: Scene[]) => scenes.reduce((sum, scene) => sum + scene.duration, 0);
export const frames = (seconds: number) => Math.round(seconds * FPS);
