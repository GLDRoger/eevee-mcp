import { describe, expect, it } from 'vitest'
import { videoEditorDefinitionSchema, videoProjectSchema } from './video-editor'

const clip = {
  id: 'opening',
  label: 'Opening',
  startMs: 0,
  durationMs: 1_000,
  track: 0,
  tone: 'pine' as const,
}

describe('video editor definition', () => {
  it('keeps every clip inside the bounded project', () => {
    expect(() =>
      videoProjectSchema.parse({
        width: 1280,
        height: 720,
        fps: 30,
        durationMs: 1_000,
        clips: [{ ...clip, startMs: 500, durationMs: 600 }],
      }),
    ).toThrow('Every clip must end within the project duration')
  })

  it('requires unique clip ids and the canonical React entry', () => {
    expect(() =>
      videoEditorDefinitionSchema.parse({
        kind: 'video-editor',
        entry: 'src/App.tsx',
        files: [{ path: 'src/App.tsx', content: 'export default () => <main />' }],
        actions: [],
        project: {
          width: 1280,
          height: 720,
          fps: 30,
          durationMs: 2_000,
          clips: [clip, { ...clip }],
        },
      }),
    ).toThrow('Video clip ids must be unique')
  })
})
