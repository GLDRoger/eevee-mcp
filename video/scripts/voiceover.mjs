#!/usr/bin/env node
// Generates the narration with Gemini TTS, one MP3 per line, plus a manifest
// of durations the composition uses to lay scenes out.
//
// Usage: GEMINI_API_KEY=... node scripts/voiceover.mjs [--only 01-hook,02-webmcp] [--force]
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const key = process.env.GEMINI_API_KEY
if (!key) {
  console.error('Set GEMINI_API_KEY')
  process.exit(2)
}
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}
const only = argument('--only', '')?.split(',').filter(Boolean) ?? []
const force = process.argv.includes('--force')
const script = JSON.parse(readFileSync(join(here, 'narration.json'), 'utf8'))
const out = resolve(here, '..', 'public', 'voice')
mkdirSync(out, { recursive: true })

const speak = async (line) => {
  const body = {
    contents: [{ role: 'user', parts: [{ text: `Read the following transcript based on the director's note.\n\n# Director's note\n${script.direction}\n\n## Transcript:\n${line.text}` }] }],
    generationConfig: {
      responseModalities: ['audio'],
      temperature: 1,
      speech_config: { voice_config: { prebuilt_voice_config: { voice_name: script.voice } } },
    },
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${script.model}:streamGenerateContent?key=${key}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  )
  if (!response.ok) throw new Error(`${line.id}: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`)
  const chunks = await response.json()
  const parts = []
  let mime = ''
  for (const chunk of chunks) {
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData) {
        parts.push(Buffer.from(part.inlineData.data, 'base64'))
        mime = part.inlineData.mimeType
      }
    }
  }
  if (parts.length === 0) throw new Error(`${line.id}: no audio in response ${JSON.stringify(chunks).slice(0, 300)}`)
  const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000)
  const pcm = join(out, `${line.id}.pcm`)
  writeFileSync(pcm, Buffer.concat(parts))
  const mp3 = join(out, `${line.id}.mp3`)
  // Trim leading and trailing silence so scene timing follows the words; a
  // small atempo keeps the cut under three minutes without touching pitch.
  const ffmpeg = spawnSync('ffmpeg', [
    '-v', 'error', '-y', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', pcm,
    '-af', `silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.25,areverse,atempo=${script.tempo ?? 1},loudnorm=I=-16:TP=-1.5:LRA=11`,
    '-c:a', 'libmp3lame', '-q:a', '2', mp3,
  ])
  if (ffmpeg.status !== 0) throw new Error(`${line.id}: ffmpeg ${ffmpeg.stderr}`)
  spawnSync('rm', [pcm])
}

const duration = (file) =>
  Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim())

for (const line of script.lines) {
  if (only.length > 0 && !only.includes(line.id)) continue
  const mp3 = join(out, `${line.id}.mp3`)
  if (existsSync(mp3) && !force) {
    console.log(`skip ${line.id} (exists)`)
    continue
  }
  process.stdout.write(`${line.id} … `)
  await speak(line)
  console.log(`${duration(mp3).toFixed(2)}s`)
}

const manifest = {
  lines: script.lines
    .filter((line) => existsSync(join(out, `${line.id}.mp3`)))
    .map((line) => ({ id: line.id, text: line.text, file: `voice/${line.id}.mp3`, duration: duration(join(out, `${line.id}.mp3`)) })),
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`total speech ${manifest.lines.reduce((sum, line) => sum + line.duration, 0).toFixed(1)}s across ${manifest.lines.length} lines`)
