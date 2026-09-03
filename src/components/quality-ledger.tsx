import type { QualityReport } from '@/domain/quality'

/** "required · pass" reads like a log line; people read "Required · Passed". */
export const verdictLabel = (
  criticality: 'required' | 'informational',
  verdict: 'pass' | 'fail',
): string =>
  `${criticality === 'required' ? 'Required' : 'Informational'} · ${verdict === 'pass' ? 'Passed' : 'Failed'}`

export function QualityLedger({ report }: { report: QualityReport }) {
  return (
    <section className="quality-ledger" aria-labelledby="quality-title">
      <header>
        <div>
          <p>Static checks</p>
          <h3 id="quality-title">Compile and quality checks</h3>
        </div>
        <strong>{report.score}/100</strong>
      </header>
      <ul>
        {report.checks.map((item) => (
          <li key={item.id}>
            <span className={`quality-mark is-${item.verdict}`} aria-hidden="true" />
            <div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
            <span className="quality-status">{verdictLabel(item.criticality, item.verdict)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
