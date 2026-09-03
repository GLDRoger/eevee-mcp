'use client'

import { useRef, useState } from 'react'
import type { HumanAuthorityStatus } from '@/domain/human-authority'
import { IDEAS, MERIDIAN_ACTS, type StarterIdea } from '@/domain/starter-prompts'

const LIBRARY_IDEA = IDEAS.find((idea) => idea.kind.startsWith('Library')) ?? IDEAS[0]
import { EEVEE_TOOL_COUNT, type ToolRegistration } from '@/client/webmcp'

type Surface = 'applets' | 'library' | 'studio' | 'guide'

/**
 * The home of each surface: what you see before an applet or file is open.
 * These pages prompt the person the way the person prompts the agent.
 */

const MAP: ReadonlyArray<{
  name: string
  where: string
  what: string
  surface?: Surface
}> = [
  {
    name: 'Applets',
    where: 'Top bar',
    surface: 'applets',
    what: 'Every app the agent builds, draft or live. Open one to run it, read its code, or publish it. Close it and you are back here.',
  },
  {
    name: 'Library',
    where: 'Top bar',
    surface: 'library',
    what: 'The files you already have. DOCX, XLSX, PPTX, PDF. Every save is a version. The scan shows the agent masked findings, never the text.',
  },
  {
    name: 'Studio',
    where: 'Top bar',
    surface: 'studio',
    what: 'Documents, Sheets, and Slides without the subscription. Start blank or open a Library file. Saving makes a version, not a mess.',
  },
  {
    name: 'Guide',
    where: 'Top bar',
    surface: 'guide',
    what: 'The manual. It is short. The baby keeps the long version in the audit log.',
  },
  {
    name: 'Decisions',
    where: 'Top right chip',
    what: 'Where the agent waits. Every write it wants lands here with its diff. Approve one, reject one with a reason, or lease a few.',
  },
  {
    name: 'Passkey',
    where: 'Top right',
    what: 'Set it up before the agent asks. Fingerprint, face, PIN, or security key. No password to forget, no account to leak.',
  },
  {
    name: 'Agent rail',
    where: 'Right edge, ⟨',
    what: 'The agent’s plan and every tool call as it happens. Closed by default so the app gets the width.',
  },
  {
    name: 'Workspace',
    where: 'Top right menu',
    what: 'About EEVEE, and the only door out. Leaving forgets this browser’s workspace: passkey, applets, files, records.',
  },
]

const GUIDE = [
  {
    title: 'Get an agent in the room',
    body: 'This page registers its tools with WebMCP the moment it opens. ChatGPT’s browser sees them. Chrome 149+ sees them with chrome://flags/#enable-webmcp-testing switched on. If the chip in the agent rail says off, no agent can reach the bench yet, and the ledger buttons on the left do the whole loop by hand.',
    tip: 'A good first call for any agent is get_workbench_state. It returns the same picture you are looking at.',
  },
  {
    title: 'Set up your passkey',
    body: 'Top right. Publishing, approvals, redaction, and leases all ask for it. Each challenge is bound to one version or one request, so a prompt for one write cannot be replayed for another. The baby does not accept a note from your mother.',
  },
  {
    title: 'Build and prove',
    body: 'Ask for an applet, or press Install as draft on Meridian Ops. The agent writes the source and a behavioral suite. Evaluate runs the suite in a browser worker and shows N of M scenarios passed, next to the exact code. Review & publish asks for your key and publishes that version, not a later one.',
    buttons: ['Install as draft', 'Evaluate', 'Review & publish', 'Run', 'Close'],
    prompt: MERIDIAN_ACTS[0].prompt,
  },
  {
    title: 'Run and govern',
    body: 'Run opens the app in the bench. While a run is open, every action it declares is a live tool the agent can call. Reads answer at once. Writes are rehearsed on a copy of current data and wait in Decisions with their diff. Approve one. Reject one with a reason, which the agent receives. Or grant a lease: a few writes for a few minutes, revocable, every spend on the record.',
    prompt: MERIDIAN_ACTS[2].prompt,
  },
  {
    title: 'Library and Studio',
    body: 'Import a DOCX, XLSX, PPTX, or PDF and EEVEE keeps the original bytes plus a version for every save. The agent can list files, read text and tables, and propose a redaction; you approve it with your key. Studio opens the same files in real editors, or starts a blank one.',
    prompt: LIBRARY_IDEA.prompt,
  },
  {
    title: 'Leave',
    body: 'Workspace ▾, then Leave workspace. There is no account, so there is nothing to sign back into. EEVEE forgets the passkey, the applets, the files, and the records. On purpose.',
  },
] as const

export function CopyButton({ text, label = 'Copy prompt' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }
  return (
    <button type="button" className={copied ? 'home-copy is-copied' : 'home-copy'} onClick={() => void copy()}>
      {copied ? 'Copied' : label}
    </button>
  )
}

function Prompt({ text }: { text: string }) {
  return (
    <div className="home-prompt">
      <code>{text}</code>
      <CopyButton text={text} />
    </div>
  )
}

function Ideas({ ideas = IDEAS, title = 'Prompts to steal', lede }: { ideas?: readonly StarterIdea[]; title?: string; lede?: string }) {
  return (
    <section className="home-section" aria-labelledby="home-ideas-title">
      <header>
        <h3 id="home-ideas-title">{title}</h3>
        <p>{lede ?? 'Paste one to your agent. Each ends the same way: the agent proves its work and brings it to you.'}</p>
      </header>
      <ul className="home-ideas">
        {ideas.map((idea) => (
          <li key={idea.name} className="home-card is-idea">
            <span className="home-card-kind">{idea.kind}</span>
            <strong>{idea.name}</strong>
            <p>{idea.what}</p>
            <Prompt text={idea.prompt} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function Readiness({ toolsLive, humanAuthority }: { toolsLive: ToolRegistration | null; humanAuthority: HumanAuthorityStatus | null }) {
  const off = toolsLive !== null && toolsLive.live === 0
  return (
    <div className="home-readiness">
      <p className={off ? 'home-status is-off' : 'home-status is-on'} role={off ? 'alert' : undefined}>
        <strong>{off ? 'No agent can reach this page yet.' : `${toolsLive?.live ?? EEVEE_TOOL_COUNT} tools live for your agent.`}</strong>{' '}
        {off
          ? 'Open it in ChatGPT’s browser, or in Chrome 149+ enable chrome://flags/#enable-webmcp-testing and relaunch.'
          : 'Anything with WebMCP can call them: ChatGPT’s browser, or Chrome 149+ with the WebMCP flag.'}
      </p>
      <p className={humanAuthority?.enrolled ? 'home-status is-on' : 'home-status is-wait'}>
        <strong>{humanAuthority?.enrolled ? 'Passkey ready.' : 'Set up your passkey, top right.'}</strong>{' '}
        Publishing, approvals, redaction, and leases ask for your fingerprint, face, device PIN, or security key.
      </p>
    </div>
  )
}

export function AppletsHome({
  toolsLive,
  humanAuthority,
  hasApplets,
  onSurface,
  onOpenApplets,
}: {
  toolsLive: ToolRegistration | null
  humanAuthority: HumanAuthorityStatus | null
  hasApplets: boolean
  onSurface: (surface: Surface) => void
  onOpenApplets: () => void
}) {
  return (
    <div className="home">
      <header className="home-hero">
        <p className="home-kicker">Applets · a workbench for people and browser agents</p>
        <h2>
          Your agent builds the app.
          <br />
          You hold the key that ships it.
        </h2>
        <p className="home-lede">
          An agent writes a small app here, proves it in the browser, and asks you to publish. Once
          published, the app’s own actions become tools the agent can call. Every write is rehearsed,
          shown to you, and waits for your passkey.
        </p>
        <ol className="home-loop" aria-label="How the loop works">
          <li><b>Build</b><span>the agent writes a small app</span></li>
          <li><b>Prove</b><span>browser scenarios run the whole app</span></li>
          <li><b>Key</b><span>your passkey publishes the exact version</span></li>
          <li><b>Tools</b><span>its actions register as agent tools</span></li>
          <li><b>Rehearse</b><span>every write shows its diff and waits</span></li>
        </ol>
      </header>
      <Readiness toolsLive={toolsLive} humanAuthority={humanAuthority} />
      {hasApplets ? (
        <p className="home-open">
          You already have applets in the ledger.{' '}
          <button type="button" className="text-action" onClick={onOpenApplets}>
            Open the latest
          </button>
        </p>
      ) : null}
      <section className="home-section" aria-labelledby="home-map-title">
        <header>
          <h3 id="home-map-title">Find your way around</h3>
          <p>Four surfaces, one chip, one key. Eight things to know, none of them long.</p>
        </header>
        <ul className="home-map">
          {MAP.map((item) => {
            const inner = (
              <>
                <span className="home-card-kind">{item.where}</span>
                <strong>{item.name}</strong>
                <p>{item.what}</p>
              </>
            )
            return (
              <li key={item.name}>
                {item.surface ? (
                  <button type="button" className="home-card is-link" onClick={() => onSurface(item.surface as Surface)}>
                    {inner}
                  </button>
                ) : (
                  <div className="home-card">{inner}</div>
                )}
              </li>
            )
          })}
        </ul>
      </section>
      <section className="home-section" aria-labelledby="home-acts-title">
        <header>
          <h3 id="home-acts-title">Start here: Meridian Ops in three acts</h3>
          <p>
            A seven-module ERP, 32 typed actions, and a behavioral suite. No agent yet? Press Install as
            draft on the left, then Evaluate, then Review &amp; publish. The whole loop by hand, no baby
            required.
          </p>
        </header>
        <ol className="home-acts">
          {MERIDIAN_ACTS.map((entry) => (
            <li key={entry.act} className="home-card is-act">
              <span className="home-act-number" aria-hidden="true">{entry.act}</span>
              <div>
                <strong>
                  {entry.name} <span>· {entry.claim}</span>
                </strong>
                <p>{entry.detail}</p>
                <Prompt text={entry.prompt} />
              </div>
            </li>
          ))}
        </ol>
      </section>
      <Ideas />
      <p className="home-coda">
        Rehearses everything. Asks before touching. Keeps receipts. Full manual under{' '}
        <button type="button" className="text-action" onClick={() => onSurface('guide')}>
          Guide
        </button>
        .
      </p>
    </div>
  )
}

export function Guide({ toolsLive, humanAuthority }: { toolsLive: ToolRegistration | null; humanAuthority: HumanAuthorityStatus | null }) {
  return (
    <div className="home">
      <header className="home-hero">
        <p className="home-kicker">Guide · {toolsLive?.total ?? EEVEE_TOOL_COUNT} WebMCP tools on this page</p>
        <h2>The manual. Short on purpose.</h2>
        <p className="home-lede">
          EEVEE has four surfaces, one chip, and one key. Here is how they fit together, in the
          order you will meet them, with the prompts that prove each step.
        </p>
      </header>
      <Readiness toolsLive={toolsLive} humanAuthority={humanAuthority} />
      <ol className="home-guide">
        {GUIDE.map((step, index) => (
          <li key={step.title} className="home-card is-act">
            <span className="home-act-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
              {'buttons' in step ? (
                <ul className="home-buttons" aria-label="Buttons on an applet">
                  {step.buttons.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              ) : null}
              {'tip' in step ? <p className="home-tip">{step.tip}</p> : null}
              {'prompt' in step ? <Prompt text={step.prompt} /> : null}
            </div>
          </li>
        ))}
      </ol>
      <Ideas />
    </div>
  )
}

export function LibraryHome({ onUpload }: { onUpload: (file: File) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const fileIdeas = IDEAS.filter((idea) => !idea.kind.startsWith('Applet'))
  return (
    <div className="home">
      <header className="home-hero">
        <p className="home-kicker">Library</p>
        <h2>Bring the files you already have.</h2>
        <p className="home-lede">
          Word, Excel, PowerPoint, PDF. EEVEE keeps the original bytes and a version for every save.
          The agent can read them and propose changes. It cannot redact a line without your key.
        </p>
        <div className="home-actions">
          <input
            ref={inputRef}
            type="file"
            accept=".docx,.xlsx,.pptx,.pdf"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (!file) return
              setUploading(true)
              void onUpload(file).catch(() => undefined).finally(() => setUploading(false))
            }}
          />
          <button type="button" className="primary-action" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? 'Importing…' : 'Import a file'}
          </button>
          <span>DOCX, XLSX, PPTX, or PDF. It stays in this browser’s workspace.</span>
        </div>
      </header>
      <ol className="home-loop is-three" aria-label="What happens to a file">
        <li><b>Import</b><span>the original bytes are kept, version 1</span></li>
        <li><b>Scan</b><span>names, emails, account numbers, shown to the agent masked</span></li>
        <li><b>Open in Studio</b><span>edit in a real editor; every save is a new version</span></li>
      </ol>
      <Ideas ideas={fileIdeas} title="Try these with a file" lede="Two prompts that use the Library and Studio. Paste one after you import." />
      <p className="home-coda">
        The sensitive-text scan returns masked findings to the agent. Opening a file in Studio shows
        its full content on screen, to you.
      </p>
    </div>
  )
}

export function StudioHome() {
  const studioIdeas = IDEAS.filter((idea) => idea.kind.startsWith('Studio'))
  return (
    <div className="home">
      <header className="home-hero">
        <p className="home-kicker">Studio</p>
        <h2>Start from scratch.</h2>
        <p className="home-lede">
          A document, a spreadsheet, or a deck, blank, in a real editor. Pick one on the left, or open
          a Library file. Every save becomes a version in the Library, and the agent can build in
          here too.
        </p>
      </header>
      <ol className="home-loop is-three" aria-label="Studio in three beats">
        <li><b>New</b><span>New document, New spreadsheet, or New presentation on the left</span></li>
        <li><b>Edit</b><span>formulas, charts, pages, slides; the file stays a real Office file</span></li>
        <li><b>Save</b><span>a new version in the Library, with a note if you want one</span></li>
      </ol>
      <Ideas ideas={studioIdeas} title="Try this in Studio" lede="Paste it to your agent and watch the sheet fill with formulas, not pasted numbers." />
    </div>
  )
}
