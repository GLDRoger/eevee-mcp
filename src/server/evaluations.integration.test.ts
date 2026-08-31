import { afterAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type {
  EvaluationSuite,
  EvaluationVersionEvidenceInput,
} from '@/domain/evaluation'
import type { CreateVersionInput } from '@/domain/applet'
import { createApplet, createVersion, ensureWorkspace, publishVersion } from './applets'
import {
  completeEvaluation,
  failEvaluation,
  getEvaluationExecution,
  startEvaluation,
} from './evaluations'
import { createEvaluationSuite } from './evaluation-suites'
import { getDatabase } from './db/client'
import { evaluationRun, workspace } from './db/schema'

const runIntegration = Boolean(process.env.DATABASE_URL)
const workspaceId = crypto.randomUUID()

const passingEvidence = (
  versionId: string,
  suite: EvaluationSuite,
  failingCaseId?: string,
): EvaluationVersionEvidenceInput => ({
  versionId,
  cases: suite.cases.map((evaluationCase) => ({
    caseId: evaluationCase.id,
    steps: evaluationCase.steps.map((step, index) => ({
      index,
      action: step.action,
      verdict: evaluationCase.id === failingCaseId && index === 0 ? 'fail' : 'pass',
      detail: evaluationCase.id === failingCaseId && index === 0
        ? 'The expected control did not respond.'
        : 'The browser step passed.',
      durationMs: 8,
    })),
  })),
})

describe.runIf(runIntegration)('behavioral evaluation lifecycle', () => {
  afterAll(async () => {
    await getDatabase().delete(workspace).where(eq(workspace.id, workspaceId))
  })

  it('compares a candidate with the published version and blocks regressions', async () => {
    await ensureWorkspace(workspaceId)
    const applet = await createApplet(workspaceId, {
      name: 'Evaluation specimen',
      description: 'Proves browser scenario comparison.',
      medium: 'web-app',
    })
    const versionInput: Omit<CreateVersionInput, 'note'> = {
      inputs: [
        {
          key: 'title',
          label: 'Title',
          description: 'Shown as the primary heading.',
          required: true,
          kind: 'text',
        },
      ],
      definition: {
        kind: 'react-app',
        entry: 'src/App.tsx',
        files: [
          {
            path: 'src/App.tsx',
            content: 'export default function App({ inputs }) { return <main className="app"><h1>{String(inputs.title)}</h1><button type="button">Save</button></main> }',
          },
        ],
      },
    }
    const baseline = await createVersion(workspaceId, applet.id, {
      ...versionInput,
      note: 'Baseline',
    })
    const suite = await createEvaluationSuite(workspaceId, applet.id, {
      name: 'Save behavior',
      cases: [
        {
          id: 'save-control',
          name: 'Save control is available',
          criticality: 'required',
          input: { title: 'Baseline' },
          steps: [{ action: 'assert-count', selector: 'button', count: 1 }],
        },
      ],
    })
    const baselineRun = await startEvaluation(workspaceId, applet.id, {
      versionId: baseline.version.id,
      suiteId: suite.id,
    })
    await completeEvaluation(workspaceId, baselineRun.run.id, {
      candidate: passingEvidence(baseline.version.id, suite),
      baseline: null,
    })
    await publishVersion(workspaceId, applet.id, baseline.version.id)

    const candidate = await createVersion(workspaceId, applet.id, {
      ...versionInput,
      note: 'Candidate',
    })
    const comparison = await startEvaluation(workspaceId, applet.id, {
      versionId: candidate.version.id,
      suiteId: suite.id,
    })
    expect(comparison.run.baselineVersionId).toBe(baseline.version.id)
    expect(
      (await getEvaluationExecution(workspaceId, comparison.run.id, 'candidate', 'save-control'))
        .output.html,
    ).toContain('window.eevee')
    const regressed = await completeEvaluation(workspaceId, comparison.run.id, {
      candidate: passingEvidence(candidate.version.id, suite, 'save-control'),
      baseline: passingEvidence(baseline.version.id, suite),
    })
    expect(regressed).toMatchObject({
      state: 'failed',
      report: { verdict: 'fail', regressions: ['save-control'] },
    })
    await expect(
      publishVersion(workspaceId, applet.id, candidate.version.id),
    ).rejects.toMatchObject({ status: 409, code: 'behavioral_evaluation_required' })

    const passingComparison = await startEvaluation(workspaceId, applet.id, {
      versionId: candidate.version.id,
      suiteId: suite.id,
    })
    const passed = await completeEvaluation(workspaceId, passingComparison.run.id, {
      candidate: passingEvidence(candidate.version.id, suite),
      baseline: passingEvidence(baseline.version.id, suite),
    })
    expect(passed).toMatchObject({ state: 'passed', report: { regressions: [] } })
    await publishVersion(workspaceId, applet.id, candidate.version.id)

    const suiteBoundCandidate = await createVersion(workspaceId, applet.id, {
      ...versionInput,
      note: 'Latest-suite candidate',
    })
    const oldSuiteRun = await startEvaluation(workspaceId, applet.id, {
      versionId: suiteBoundCandidate.version.id,
      suiteId: suite.id,
    })
    await completeEvaluation(workspaceId, oldSuiteRun.run.id, {
      candidate: passingEvidence(suiteBoundCandidate.version.id, suite),
      baseline: passingEvidence(candidate.version.id, suite),
    })
    const latestSuite = await createEvaluationSuite(workspaceId, applet.id, {
      name: 'Revised save behavior',
      cases: suite.cases,
    })
    await expect(
      publishVersion(workspaceId, applet.id, suiteBoundCandidate.version.id),
    ).rejects.toMatchObject({ status: 409, code: 'behavioral_evaluation_required' })
    const latestSuiteRun = await startEvaluation(workspaceId, applet.id, {
      versionId: suiteBoundCandidate.version.id,
      suiteId: latestSuite.id,
    })
    await completeEvaluation(workspaceId, latestSuiteRun.run.id, {
      candidate: passingEvidence(suiteBoundCandidate.version.id, latestSuite),
      baseline: passingEvidence(candidate.version.id, latestSuite),
    })
    await publishVersion(workspaceId, applet.id, suiteBoundCandidate.version.id)
  })

  it('rejects malformed evidence and caps concurrent browser work', async () => {
    const [applet] = await getDatabase()
      .query.applet.findMany({ where: (table, { eq: equals }) => equals(table.workspaceId, workspaceId), limit: 1 })
    if (!applet) throw new Error('The comparison test did not create its applet')
    const suites = await getDatabase().query.evaluationSuite.findMany({
      where: (table, { eq: equals }) => equals(table.workspaceId, workspaceId),
      limit: 1,
    })
    const suite = suites[0]
    if (!suite) throw new Error('The comparison test did not create its suite')
    const versions = await getDatabase().query.appletVersion.findMany({
      where: (table, { eq: equals }) => equals(table.appletId, applet.id),
      orderBy: (table, { desc }) => [desc(table.version)],
      limit: 1,
    })
    const version = versions[0]
    if (!version) throw new Error('The comparison test did not create its version')
    const incompatible = await createVersion(workspaceId, applet.id, {
      note: 'Input-incompatible evaluation candidate',
      inputs: [],
      definition: {
        kind: 'react-app',
        entry: 'src/App.tsx',
        files: [
          {
            path: 'src/App.tsx',
            content: 'export default function App() { return <main><button type="button">Save</button></main> }',
          },
        ],
      },
    })
    await expect(
      startEvaluation(workspaceId, applet.id, {
        versionId: incompatible.version.id,
        suiteId: suite.id,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'suite_input_mismatch' })
    const leaked = await getDatabase()
      .select({ id: evaluationRun.id })
      .from(evaluationRun)
      .where(
        and(
          eq(evaluationRun.workspaceId, workspaceId),
          eq(evaluationRun.candidateVersionId, incompatible.version.id),
          eq(evaluationRun.state, 'running'),
        ),
      )
    expect(leaked).toEqual([])
    const malformed = await startEvaluation(workspaceId, applet.id, {
      versionId: version.id,
      suiteId: suite.id,
    })
    await expect(
      completeEvaluation(workspaceId, malformed.run.id, {
        candidate: { versionId: version.id, cases: [] },
        baseline: null,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'evaluation_case_mismatch' })
    await failEvaluation(workspaceId, malformed.run.id, 'Malformed evidence test finished')

    const active = await Promise.all(
      Array.from({ length: 3 }, () =>
        startEvaluation(workspaceId, applet.id, { versionId: version.id, suiteId: suite.id }),
      ),
    )
    await expect(
      startEvaluation(workspaceId, applet.id, { versionId: version.id, suiteId: suite.id }),
    ).rejects.toMatchObject({ status: 409, code: 'evaluation_capacity_reached' })
    await Promise.all(
      active.map(({ run }) => failEvaluation(workspaceId, run.id, 'Capacity test finished')),
    )
  })
})
