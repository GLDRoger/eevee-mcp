import type { QualityReport } from '@/domain/quality'

export function QualityLedger({ report }: { report: QualityReport }) {
  return (
    <section className="quality-ledger" aria-labelledby="quality-title">
      <header>
        <div>
          <p>Evaluation</p>
          <h3 id="quality-title">Quality evidence</h3>
        </div>
        <strong>{report.score}/100</strong>
      </header>
      <ul>
        {report.checks.map((item) => (
          <li key={item.id}>
            <span className={`quality-mark is-${item.status}`} aria-hidden="true" />
            <div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
            <span className="quality-status">{item.status}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
