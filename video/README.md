# EEVEE demo video

A three-minute demo of EEVEE MCP, cut with [Remotion](https://www.remotion.dev). Screen footage is recorded from a real Chrome driving the local workbench through WebMCP; the narration is Gemini TTS; the music is CC BY 4.0.

## Pipeline

1. Start the app (`npm run dev` in the repo root, PostgreSQL up).
2. `node scripts/record.mjs` records `public/rec/*.mp4` plus `public/rec/manifest.json` (named marks, in seconds, that the composition lines zooms and callouts up with) and the phone still. It needs Chrome 149+ with WebMCP; every agent step is a real `document.modelContext.executeTool` call, every click is a real pointer event on a drawn cursor, and a CDP virtual authenticator stands in for the fingerprint.
3. `GEMINI_API_KEY=… node scripts/voiceover.mjs` turns `scripts/narration.json` into `public/voice/*.mp3` and a manifest of durations. Each narration line sets the length of its scene; the footage speeds up or slows down a little (0.72×–1.3×) to land on it.
4. `npm run dev` opens Remotion Studio; `npm run render` writes `out/eevee-demo.mp4`.

`src/timeline.ts` is the whole cut: which clip range plays under which line, where the camera zooms, which callouts appear. Change a mark offset there, not in the scene components.

## Credits

- Music: "Deliberate Thought" by Kevin MacLeod (incompetech.com), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See `public/music/CREDITS.md`.
- Fonts: Avara (OFL), Carlito and Liberation Mono (OFL), copied from the app.
- Voice: Gemini `gemini-3.1-flash-tts-preview`, voice Zephyr.
