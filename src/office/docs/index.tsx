import type { OfficeEditorProps } from '../registry'
import { App } from './App'
import { LocaleProvider } from './i18n/locale'
import './styles.css'

export default function OfficeDocsEditor(props: OfficeEditorProps) {
  return (
    <LocaleProvider initial="en">
      <section className="office-docs" lang="en" aria-label="Documents editor">
        <App {...props} />
      </section>
    </LocaleProvider>
  )
}
