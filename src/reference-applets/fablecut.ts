import type { CreateVersionInput } from '@/domain/applet'
import type { CreateEvaluationSuiteInput } from '@/domain/evaluation'

export const FABLECUT_REFERENCE = {
  slug: 'fablecut',
  name: 'FableCut',
  description:
    'A governed edit-decision timeline where a person and browser agent cut the same video project with durable undo history.',
} as const

const appSource = String.raw`
import { useCallback, useEffect, useMemo, useState } from 'react'
import './app.css'

const EVENT = 'fablecut:changed'
const fallbackProject = { width: 1280, height: 720, fps: 30, durationMs: 18000, clips: [] }
const baseProject = window.eevee.media?.project || fallbackProject

const cleanProject = (candidate) => {
  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.clips)) {
    return structuredClone(baseProject)
  }
  return {
    ...baseProject,
    clips: candidate.clips
      .filter((clip) => clip && typeof clip.id === 'string' && typeof clip.durationMs === 'number')
      .map((clip) => ({ ...clip })),
  }
}

const readTimeline = async () => {
  const saved = await window.eevee.store.get('timeline')
  if (!saved || typeof saved !== 'object') return { project: cleanProject(baseProject), history: [] }
  return {
    project: cleanProject(saved.project),
    history: Array.isArray(saved.history) ? saved.history.slice(-20).map(cleanProject) : [],
  }
}

const writeTimeline = async (project, history) => {
  const timeline = { project: cleanProject(project), history: history.slice(-20).map(cleanProject) }
  await window.eevee.store.set('timeline', timeline)
  window.dispatchEvent(new Event(EVENT))
  return timeline
}

const clipById = (project, clipId) => {
  const clip = project.clips.find(({ id }) => id === clipId)
  if (!clip) throw new Error('No clip has id ' + clipId)
  return clip
}

const splitProject = (project, clipId, atMs) => {
  const clip = clipById(project, clipId)
  const offset = atMs - clip.startMs
  if (offset < 100 || offset > clip.durationMs - 100) {
    throw new Error('The split must leave at least 100 ms on each side')
  }
  const left = { ...clip, id: clip.id + '_a', durationMs: offset, label: clip.label + ' A' }
  const right = {
    ...clip,
    id: clip.id + '_b',
    startMs: atMs,
    durationMs: clip.durationMs - offset,
    label: clip.label + ' B',
  }
  return { ...project, clips: project.clips.flatMap((item) => item.id === clipId ? [left, right] : [item]) }
}

const commit = async (transform) => {
  const timeline = await readTimeline()
  const next = transform(timeline.project)
  return writeTimeline(next, [...timeline.history, timeline.project])
}

export const actions = {
  inspect_timeline: async () => {
    const timeline = await readTimeline()
    return {
      durationMs: timeline.project.durationMs,
      fps: timeline.project.fps,
      clips: timeline.project.clips,
      undoDepth: timeline.history.length,
    }
  },
  split_clip: async ({ clip_id, at_ms }) => commit((project) => splitProject(project, clip_id, at_ms)),
  trim_clip: async ({ clip_id, trim_start_ms, trim_end_ms }) => commit((project) => {
    const clip = clipById(project, clip_id)
    if (trim_start_ms + trim_end_ms > clip.durationMs - 100) {
      throw new Error('Trimming must leave at least 100 ms')
    }
    return {
      ...project,
      clips: project.clips.map((item) => item.id === clip_id ? {
        ...item,
        startMs: item.startMs + trim_start_ms,
        durationMs: item.durationMs - trim_start_ms - trim_end_ms,
      } : item),
    }
  }),
  undo_edit: async () => {
    const timeline = await readTimeline()
    const previous = timeline.history.at(-1)
    if (!previous) return timeline
    return writeTimeline(previous, timeline.history.slice(0, -1))
  },
  reset_timeline: async () => writeTimeline(baseProject, []),
}

export default function App({ inputs, store, media }) {
  const initial = media?.project || baseProject
  const [timeline, setTimeline] = useState({ project: cleanProject(initial), history: [] })
  const [selectedId, setSelectedId] = useState(initial.clips[0]?.id || '')
  const [playhead, setPlayhead] = useState(2500)

  const refresh = useCallback(async () => {
    const saved = await store.get('timeline')
    const next = saved && typeof saved === 'object'
      ? { project: cleanProject(saved.project), history: Array.isArray(saved.history) ? saved.history : [] }
      : { project: cleanProject(initial), history: [] }
    setTimeline(next)
    setSelectedId((current) => next.project.clips.some(({ id }) => id === current)
      ? current
      : next.project.clips[0]?.id || '')
  }, [initial, store])

  useEffect(() => {
    void refresh()
    const changed = () => void refresh()
    window.addEventListener(EVENT, changed)
    return () => window.removeEventListener(EVENT, changed)
  }, [refresh])

  const activeClip = useMemo(
    () => timeline.project.clips.find((clip) => playhead >= clip.startMs && playhead < clip.startMs + clip.durationMs),
    [playhead, timeline.project.clips],
  )

  const persist = async (project) => {
    const next = { project, history: [...timeline.history, timeline.project].slice(-20) }
    setTimeline(next)
    await store.set('timeline', next)
  }

  const split = async () => {
    if (!selectedId) return
    const project = splitProject(timeline.project, selectedId, playhead)
    await persist(project)
    setSelectedId(project.clips.find((clip) => clip.startMs === playhead)?.id || '')
  }

  const undo = async () => {
    const previous = timeline.history.at(-1)
    if (!previous) return
    const next = { project: cleanProject(previous), history: timeline.history.slice(0, -1) }
    setTimeline(next)
    await store.set('timeline', next)
  }

  return <main className="edit-suite">
    <header className="project-heading">
      <div>
        <p>EEVEE video applet · immutable edit definition</p>
        <h1 id="project-title">{String(inputs.projectName || 'FableCut')}</h1>
      </div>
      <dl>
        <div><dt>Format</dt><dd>{initial.width} × {initial.height}</dd></div>
        <div><dt>Rate</dt><dd>{initial.fps} fps</dd></div>
        <div><dt>Clips</dt><dd>{timeline.project.clips.length}</dd></div>
      </dl>
    </header>

    <section className={'viewer tone-' + (activeClip?.tone || 'slate')} aria-labelledby="viewer-title">
      <p id="viewer-title">Frame at {(playhead / 1000).toFixed(2)} s</p>
      <strong>{activeClip?.label || 'Gap'}</strong>
      <span>{activeClip ? 'Track ' + (activeClip.track + 1) : 'No active clip'}</span>
    </section>

    <section className="timeline" aria-labelledby="timeline-title">
      <header>
        <div><h2 id="timeline-title">Edit decision timeline</h2><span>{timeline.history.length} undo steps</span></div>
        <button type="button" disabled={timeline.history.length === 0} onClick={() => void undo()}>Undo last edit</button>
      </header>
      <input
        id="playhead"
        type="range"
        min="0"
        max={timeline.project.durationMs}
        step={Math.round(1000 / timeline.project.fps)}
        value={playhead}
        aria-label="Playhead"
        onChange={(event) => setPlayhead(Number(event.target.value))}
      />
      <div className="timeline-ruler" aria-hidden="true"><span>0 s</span><span>6 s</span><span>12 s</span><span>18 s</span></div>
      <div className="timeline-track">
        {timeline.project.clips.map((clip) => <button
          id={'clip-' + clip.id}
          className={'timeline-clip tone-' + clip.tone + (selectedId === clip.id ? ' is-selected' : '')}
          key={clip.id}
          type="button"
          style={{ left: (clip.startMs / timeline.project.durationMs * 100) + '%', width: (clip.durationMs / timeline.project.durationMs * 100) + '%' }}
          onClick={() => { setSelectedId(clip.id); setPlayhead(clip.startMs + Math.round(clip.durationMs / 2)) }}
        ><strong>{clip.label}</strong><span>{(clip.durationMs / 1000).toFixed(1)} s</span></button>)}
      </div>
      <footer>
        <span>{selectedId ? 'Selected: ' + selectedId : 'Select a clip'}</span>
        <button id="split-at-playhead" type="button" disabled={!selectedId} onClick={() => void split()}>Split at playhead</button>
      </footer>
    </section>
  </main>
}
`

const styles = String.raw`
:root { color-scheme: dark; font-family: "Avenir Next", Avenir, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: #171b18; color: #ece8da; }
button, input { font: inherit; }
.edit-suite { min-height: 100vh; padding: 24px; background: #171b18; }
.project-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding-bottom: 18px; border-bottom: 1px solid #69736b; }
.project-heading div, .project-heading h1, .project-heading p, .project-heading dl { margin: 0; }
.project-heading > div { display: grid; gap: 4px; }
.project-heading p { color: #d57961; font-size: 12px; font-weight: 700; }
.project-heading h1 { font-family: Georgia, serif; font-size: 34px; font-weight: 500; }
.project-heading dl { display: flex; gap: 22px; }
.project-heading dl div { display: grid; gap: 2px; }
.project-heading dt { color: #aeb7af; font-size: 11px; }
.project-heading dd { margin: 0; font-variant-numeric: tabular-nums; }
.viewer { display: grid; min-height: 300px; place-content: center; place-items: center; margin-top: 20px; border: 1px solid #69736b; }
.viewer p, .viewer span { margin: 0; color: #d6d1c2; font-size: 12px; }
.viewer strong { margin: 10px 0; font-family: Georgia, serif; font-size: 42px; font-weight: 500; }
.tone-pine { background: #274437; }
.tone-vermilion { background: #77382d; }
.tone-ochre { background: #78612d; }
.tone-slate { background: #3f4b48; }
.tone-paper { background: #d6d1c2; color: #171b18; }
.timeline { display: grid; gap: 14px; margin-top: 22px; }
.timeline > header, .timeline > footer { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.timeline > header div { display: flex; align-items: baseline; gap: 12px; }
.timeline h2 { margin: 0; font-family: Georgia, serif; font-size: 20px; font-weight: 500; }
.timeline header span, .timeline footer span { color: #aeb7af; font-size: 12px; }
.timeline button { min-height: 38px; padding: 6px 12px; border: 1px solid #89938b; background: transparent; color: #ece8da; }
.timeline button:hover, .timeline button:focus-visible { border-color: #ece8da; background: #29302c; }
#playhead { width: 100%; accent-color: #d57961; }
.timeline-ruler { display: flex; justify-content: space-between; color: #89938b; font-size: 10px; }
.timeline-track { position: relative; height: 92px; background: #222824; border-block: 1px solid #69736b; }
.timeline-clip { position: absolute; top: 12px; display: grid; align-content: center; min-width: 5.5rem; height: 66px; overflow: hidden; border: 0 !important; border-right: 2px solid #171b18 !important; text-align: left; }
.timeline-clip strong, .timeline-clip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.timeline-clip span { font-size: 10px; opacity: .78; }
.timeline-clip.is-selected { outline: 3px solid #ece8da; outline-offset: -4px; }
button:focus-visible, input:focus-visible { outline: 3px solid #d57961; outline-offset: 3px; }
@media (max-width: 680px) {
  .edit-suite { padding: 16px; }
  .project-heading { align-items: start; flex-direction: column; }
  .project-heading dl { width: 100%; justify-content: space-between; }
  .viewer { min-height: 230px; }
  .viewer strong { font-size: 30px; }
  .timeline > header, .timeline > footer { align-items: start; flex-direction: column; }
  .timeline-track { overflow-x: auto; }
}
`

const project = {
  width: 1280,
  height: 720,
  fps: 30,
  durationMs: 18_000,
  clips: [
    { id: 'opening', label: 'Opening question', startMs: 0, durationMs: 5_000, track: 0, tone: 'pine' as const },
    { id: 'evidence', label: 'Evidence sequence', startMs: 5_000, durationMs: 7_000, track: 0, tone: 'vermilion' as const },
    { id: 'decision', label: 'Human decision', startMs: 12_000, durationMs: 6_000, track: 0, tone: 'ochre' as const },
  ],
}

export const fablecutVersion: CreateVersionInput = {
  note: 'Reference video timeline with governed edit actions',
  inputs: [
    {
      key: 'projectName',
      label: 'Project name',
      description: 'Heading shown over the shared edit timeline.',
      kind: 'text',
      required: true,
      defaultValue: 'WebMCP launch cut',
      maxLength: 80,
    },
  ],
  definition: {
    kind: 'video-editor',
    entry: 'src/App.tsx',
    files: [
      { path: 'src/App.tsx', content: appSource },
      { path: 'src/app.css', content: styles },
    ],
    project,
    actions: [
      {
        name: 'inspect_timeline',
        title: 'Inspect timeline',
        description: 'Read the live edit-decision list and undo depth.',
        inputs: [],
        effects: ['state:read'],
        authority: 'automatic',
      },
      {
        name: 'split_clip',
        title: 'Split clip',
        description: 'Propose splitting one clip at an absolute timeline position.',
        inputs: [
          { key: 'clip_id', label: 'Clip id', description: 'Stable clip id from inspect_timeline.', kind: 'text', required: true, maxLength: 40 },
          { key: 'at_ms', label: 'Split position', description: 'Absolute timeline position in milliseconds.', kind: 'number', required: true, minimum: 0, maximum: 600_000 },
        ],
        effects: ['state:read', 'state:write'],
        authority: 'human',
      },
      {
        name: 'trim_clip',
        title: 'Trim clip',
        description: 'Propose removing bounded time from the start and end of one clip.',
        inputs: [
          { key: 'clip_id', label: 'Clip id', description: 'Stable clip id from inspect_timeline.', kind: 'text', required: true, maxLength: 40 },
          { key: 'trim_start_ms', label: 'Start trim', description: 'Milliseconds to remove from the clip start.', kind: 'number', required: true, minimum: 0, maximum: 120_000 },
          { key: 'trim_end_ms', label: 'End trim', description: 'Milliseconds to remove from the clip end.', kind: 'number', required: true, minimum: 0, maximum: 120_000 },
        ],
        effects: ['state:read', 'state:write'],
        authority: 'human',
      },
      {
        name: 'undo_edit',
        title: 'Undo edit',
        description: 'Propose restoring the preceding edit-decision project.',
        inputs: [],
        effects: ['state:read', 'state:write'],
        authority: 'human',
      },
      {
        name: 'reset_timeline',
        title: 'Reset timeline',
        description: 'Propose restoring the immutable reference video project.',
        inputs: [],
        effects: ['state:write'],
        authority: 'human',
      },
    ],
  },
}

export const fablecutEvaluation: CreateEvaluationSuiteInput = {
  name: 'FableCut timeline behavior',
  cases: [
    {
      id: 'split-survives-restart',
      name: 'A person splits a clip and the EDL survives restart',
      criticality: 'required',
      input: { projectName: 'WebMCP launch cut' },
      steps: [
        { action: 'assert-text', selector: '#project-title', contains: 'WebMCP launch cut' },
        { action: 'click', selector: '#split-at-playhead' },
        { action: 'assert-count', selector: '.timeline-clip', count: 4 },
        { action: 'restart' },
        { action: 'assert-count', selector: '.timeline-clip', count: 4 },
      ],
    },
  ],
}
