import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import workbenchShot from "@/assets/landing/workbench.png";
import { HeroMotion } from "./landing-hero";
import { EEVEE_TOOL_COUNT } from "@/client/webmcp";
import { IDEAS } from "@/domain/starter-prompts";
import { CopyPrompt, LandingMotion } from "./landing-motion";
import { LandingScenarios } from "./landing-scenarios";
import { LandingTools } from "./landing-tools";

const PARENTS = [
  [
    "Lovable",
    "From Lovable",
    "Builds the app from a sentence. Keeps every version. Shows you a preview before it asks for anything.",
  ],
  [
    "ChatGPT",
    "From ChatGPT",
    "Brings the brain. Any WebMCP agent, ChatGPT’s browser first. EEVEE has no model of its own and no plans to adopt one.",
  ],
  [
    "Chrome",
    "From Chrome",
    "Lives in the tab. The tools are on the page, so the agent and you look at the same screen at the same time.",
  ],
] as const;

const QUESTIONS = [
  [
    "What did it build?",
    "Every version is kept. You see a live preview and the source on request, never a mystery bundle.",
  ],
  [
    "Does it work?",
    "Scenarios run the app in a real browser: fill, click, restart, assert. You read verdicts, not code.",
  ],
  [
    "What will this change?",
    "Each write is rehearsed on a copy of current data. The card shows the exact fields, before and after.",
  ],
] as const;

const BENCH = [
  [
    "Build any applet",
    "Describe the job. The agent compiles a React app from source, or a delta on the last version. Meridian Ops, a seven-module ERP, is the reference so you can see the whole loop in three minutes; it is one applet, not the product.",
  ],
  [
    "Use the Office editors",
    "Documents, Sheets, Slides, and PDF run in the browser, ribbons and all. The agent edits cells, formulas, charts, and pivots, or rotates and removes PDF pages, through typed tools.",
  ],
  [
    "Bring your own files",
    "Upload DOCX, XLSX, PPTX, or PDF. Every save is a version. The sensitive-text scan hands the agent masked findings only; redacting needs your key.",
  ],
  [
    "Start from scratch",
    "A blank document, spreadsheet, or presentation in one click. Or an empty applet the agent fills in from your first sentence.",
  ],
] as const;

const BUILT_IN = [
  [
    "The work crosses apps. Their AI stops at the edge.",
    "Gemini helps inside the sheet. Copilot helps inside the document. The credit hold lives in your order system, the contract in Word, the numbers in Excel. EEVEE puts the app, the files, and the decision on one bench.",
  ],
  [
    "Their AI is theirs. EEVEE takes yours.",
    "There is no model inside. Any WebMCP agent, ChatGPT’s browser today, finds the tools on the page. Change agents next year; the bench, the files, and the record stay.",
  ],
  [
    "A prompt box and undo is not a control.",
    "Built-in AI acts, then you look. EEVEE rehearses the write, shows the diff, and waits for a passkey. Then it keeps the record: what was asked, what you decided, and why.",
  ],
  [
    "Some chores have no app yet.",
    "First-party AI works inside software that already exists. The weekly reconcile, the reorder rule, the hold policy: here the agent builds that app, proves it, and runs it under the same key.",
  ],
] as const;

const BEATS = [
  [
    "Reads run at once.",
    "company_snapshot, low_stock_report, receivables_aging: the 13 read actions answer the agent without asking you.",
  ],
  [
    "Writes are rehearsed.",
    "The same code runs on a copy of current data with writes intercepted. The decision card shows the fields that would change.",
  ],
  [
    "Your passkey decides one request.",
    "The challenge is bound to that request id. Approve, or reject with a reason the agent reads back.",
  ],
  [
    "A lease lets a few through.",
    "3 writes in 5 minutes, or 10 in 15. Each spend is recorded, you can revoke any time, and the next write waits again.",
  ],
] as const;

const CANNOT = [
  "Make the agent’s code correct",
  "Know your business rules",
  "Stop you approving a bad diff",
  "Replace a backup or an audit",
];
const CHANGES = [
  "Nothing publishes or writes without you",
  "Every write shows its consequence first",
  "Every decision, and every reason, is on record",
  "Leases are small, timed, and revocable",
];

const FIXES = [
  ["Confirm dialog", "Yes or no, with no preview"],
  ["Read-only agent", "Safe, and cannot finish the job"],
  ["Review the code", "Does not scale past the first app"],
  ["Chat and paste", "You become the integration"],
] as const;

const WATCH = [
  "The agent installs Meridian Ops and its four scenarios pass in your browser.",
  "Your fingerprint publishes version 1. Thirty-two applet tools appear for the agent.",
  "A credit hold arrives as a diff. You approve it, and the record shows who did.",
  "A three-write lease lets a shipment through. You revoke it; the next write waits again.",
] as const;

const PRINCIPLES = [
  [
    "Ask before any write",
    "Reads run free. Writes wait for your decision, or for a lease you granted.",
  ],
  [
    "Show the exact diff first",
    "Rehearsed on a copy of current data. You see fields, before and after.",
  ],
  [
    "Bind each challenge to one request",
    "A passkey prompt for one version or write cannot be replayed for another.",
  ],
  [
    "Record every decision and its reason",
    "Approvals, rejections, lease spends: who, what, when, and why.",
  ],
  [
    "Let you take a lease back any time",
    "Revoke it, and the very next write waits for you again.",
  ],
  [
    "Keep Office files in Office formats",
    "DOCX, XLSX, PPTX, PDF, versioned on your own Postgres. You can always leave.",
  ],
] as const;

const PROMPT =
  "Install the Meridian Ops reference applet in EEVEE, evaluate it against its behavioral suite, and bring the passing version to me for review.";

const stagger = (index: number): CSSProperties =>
  ({ "--i": index }) as CSSProperties;

const STARS: ReadonlyArray<readonly [number, number, number]> = [
  [466.3, 78.4, 1.45],
  [104.3, 278.7, 1.08],
  [83.5, 263.9, 0.65],
  [624.4, 36.3, 0.72],
  [611.3, 430.0, 0.76],
  [321.5, 326.3, 1.83],
  [831.0, 206.3, 1.87],
  [67.1, 446.4, 0.98],
  [207.7, 61.3, 1.0],
  [1175.2, 94.0, 1.36],
  [920.0, 193.6, 1.31],
  [90.4, 31.0, 0.87],
  [979.8, 222.3, 1.01],
  [843.2, 235.7, 0.99],
  [1143.9, 363.5, 0.92],
  [827.2, 273.1, 1.74],
  [1050.4, 149.7, 1.87],
  [170.0, 217.4, 1.58],
  [218.9, 254.3, 0.65],
  [962.2, 397.6, 1.34],
  [1260.7, 163.1, 1.5],
  [855.9, 301.5, 1.19],
  [1209.6, 491.2, 1.22],
  [956.4, 31.5, 1.51],
  [931.9, 516.4, 1.67],
  [409.8, 200.6, 1.47],
  [32.5, 240.1, 0.82],
  [168.6, 30.7, 1.6],
  [186.2, 128.8, 1.11],
  [1254.8, 41.9, 1.18],
  [791.2, 459.4, 1.67],
  [1244.1, 144.8, 1.14],
  [516.6, 459.8, 1.85],
  [217.3, 91.6, 0.9],
  [336.0, 252.2, 1.37],
  [378.4, 2.1, 1.14],
  [531.7, 294.5, 1.84],
  [994.3, 268.1, 1.4],
  [973.7, 28.1, 1.77],
  [1123.2, 454.7, 1.64],
  [565.0, 207.5, 0.73],
  [913.4, 32.4, 0.69],
  [300.6, 84.4, 1.04],
  [75.7, 0.1, 0.8],
  [146.1, 189.1, 0.63],
  [1259.0, 319.3, 0.79],
  [363.3, 180.6, 1.07],
  [176.9, 441.4, 1.89],
  [671.0, 251.6, 0.71],
  [147.2, 178.2, 0.94],
  [1193.6, 83.9, 0.63],
  [1369.4, 274.7, 0.79],
  [782.2, 14.1, 1.29],
  [1409.0, 448.9, 1.51],
  [376.0, 190.7, 0.82],
  [1111.6, 276.9, 1.61],
  [474.7, 116.0, 1.65],
  [1418.3, 443.4, 1.65],
  [1178.4, 384.7, 0.89],
  [745.4, 184.9, 0.64],
  [40.2, 145.3, 0.94],
  [997.2, 497.4, 1.18],
  [1349.3, 513.8, 1.84],
  [525.1, 114.6, 0.89],
  [283.3, 106.3, 1.41],
  [1296.4, 437.0, 1.22],
  [940.3, 415.8, 0.71],
  [951.2, 473.1, 1.62],
  [1080.2, 248.6, 0.83],
  [1136.4, 172.9, 1.64],
  [1399.2, 205.8, 1.12],
  [1363.4, 376.9, 0.82],
  [182.9, 78.6, 1.78],
  [1161.4, 76.0, 1.67],
  [1411.6, 341.8, 1.06],
  [790.1, 68.1, 0.62],
  [1398.1, 337.8, 1.28],
  [1344.4, 225.6, 1.73],
  [1189.7, 109.7, 0.93],
  [421.9, 125.1, 1.36],
  [373.5, 217.9, 0.77],
  [1310.4, 184.0, 1.2],
  [840.0, 470.2, 1.15],
  [1321.5, 260.9, 1.29],
  [753.8, 9.7, 1.17],
  [263.7, 2.0, 1.64],
  [248.2, 246.2, 1.54],
  [801.3, 169.5, 1.27],
  [799.8, 407.8, 0.74],
  [806.8, 129.2, 0.96],
];

const HEADLINE = [
  "What",
  "if",
  "your",
  "agent",
  "could",
  "run",
  "the",
  "office,",
  "and",
  "still",
  "never",
  "touch",
  "a",
  "record",
] as const;

/** Night sky and three hills: pure SVG, parallaxed by HeroMotion. */
function Scenery() {
  return (
    <div className="lp-scenery" aria-hidden="true">
      <svg
        className="lp-stars"
        viewBox="0 0 1440 520"
        preserveAspectRatio="xMidYMin slice"
      >
        {STARS.map(([x, y, r], index) => (
          <circle
            key={index}
            cx={x}
            cy={y}
            r={r}
            style={{ animationDelay: `${(index % 9) * 0.7}s` }}
          />
        ))}
      </svg>
      <svg
        className="lp-hill is-far"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
      >
        <path d="M0 220 C 180 140, 330 150, 480 190 S 760 260, 940 200 S 1240 110, 1440 170 L1440 320 L0 320 Z" />
      </svg>
      <svg
        className="lp-hill is-mid"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
      >
        <path d="M0 250 C 200 200, 360 230, 520 240 S 820 180, 1000 230 S 1300 260, 1440 210 L1440 320 L0 320 Z" />
      </svg>
      <svg
        className="lp-hill is-near"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
      >
        <path d="M0 290 C 240 250, 420 270, 620 280 S 980 250, 1180 275 S 1380 300, 1440 280 L1440 320 L0 320 Z" />
      </svg>
    </div>
  );
}

export function Landing() {
  const videoUrl = process.env.EEVEE_DEMO_VIDEO_URL;
  const repoUrl = process.env.EEVEE_REPO_URL;
  return (
    <div className="lp">
      <LandingTools />
      <LandingMotion />
      <header className="lp-nav">
        <Link className="wordmark" href="/" aria-label="EEVEE home">
          EEVEE
        </Link>
        <nav aria-label="Sections">
          <a href="#family">The baby</a>
          <a href="#story">The story</a>
          <a href="#bench">The bench</a>
          <a href="#ideas">Prompts</a>
          <a href="#builtin">Built in?</a>
          <a href="#key">The key</a>
          <a href="#limits">Limits</a>
          <a href="#try">Try it</a>
          <a href="#principles">Principles</a>
        </nav>
        <div className="lp-nav-actions">
          {videoUrl ? (
            <a
              className="lp-ghost"
              href={videoUrl}
              target="_blank"
              rel="noreferrer"
            >
              Watch demo
            </a>
          ) : null}
          <Link className="primary-action lp-cta" href="/workbench">
            Open demo
          </Link>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <HeroMotion />
          <Scenery />
          <div className="lp-wrap lp-hero-copy">
            <h1>
              {HEADLINE.map((word, index) => (
                <span className="lp-word-mask" key={index}>
                  <span className="lp-word">{word}</span>{" "}
                </span>
              ))}
              <span className="lp-word-mask">
                <span className="lp-word lp-word-mark">without you?</span>
              </span>
            </h1>
            <p className="lp-hero-lede">
              An agent builds the small app you need, or opens the Office file
              you already have. It proves its work in your browser. Every change
              it wants is rehearsed and shown to you first. Nothing lands
              without your key.
            </p>
            <div className="lp-actions lp-hero-actions">
              <Link
                className="primary-action lp-cta is-large"
                href="/workbench"
              >
                Open demo
              </Link>
              {videoUrl ? (
                <a
                  className="lp-ghost"
                  href={videoUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Watch demo
                </a>
              ) : null}
              <a className="lp-ghost" href="#family">
                Meet the baby
              </a>
            </div>
          </div>
          <div className="lp-wrap lp-shot-wrap">
            <div className="lp-shot-stage">
              <div className="lp-shot">
                <Image
                  src={workbenchShot}
                  alt="The EEVEE workbench with Meridian Ops published and running"
                  priority
                  sizes="(max-width: 1000px) 100vw, 72rem"
                />
                <div className="lp-float is-card" aria-hidden="true">
                  <header>
                    <strong>Set credit hold</strong>
                    <span>waiting for you</span>
                  </header>
                  <dl>
                    <dt>
                      <i>customers</i>
                      <b>Foundry North</b>
                      <i>hold</i>
                    </dt>
                    <dd>
                      <s>false</s> → <ins>true</ins>
                    </dd>
                  </dl>
                  <div>
                    <span className="is-approve">Approve</span>
                    <span className="is-reject">Reject</span>
                  </div>
                </div>
                <div className="lp-float is-chip" aria-hidden="true">
                  <b>32 of 32</b> live as agent tools
                </div>
                <div className="lp-float is-key" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <circle
                      cx="8"
                      cy="12"
                      r="5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      d="M13 12h9M19 12v4M22 12v3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                  passkey verified · 14:32
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-band is-paper lp-family" id="family">
          <div className="lp-wrap">
            <p className="lp-kicker" data-reveal="">
              Parentage
            </p>
            <h2 className="lp-huge" data-reveal="">
              <span>Lovable</span>
              <i>×</i>
              <span>ChatGPT</span>
              <i>×</i>
              <span>Chrome</span>
              <em>had a baby.</em>
            </h2>
            <p className="lp-family-line" data-reveal="">
              The baby got the trust issues. It rehearses every write before it
              happens, asks you before it touches a record, and keeps receipts
              on everything. Compulsively.
            </p>
            <ul className="lp-parents">
              {PARENTS.map(([name, from, trait], index) => (
                <li key={name} data-reveal="" style={stagger(index)}>
                  <span>{from}</span>
                  <p>{trait}</p>
                </li>
              ))}
              <li className="is-baby" data-reveal="" style={stagger(3)}>
                <span>What it added</span>
                <p>
                  <b>Rehearsals.</b> <b>Approvals.</b> <b>Receipts.</b> The
                  three things nobody asked for and everybody needed.
                </p>
              </li>
            </ul>
          </div>
        </section>

        <section className="lp-band lp-story" id="story">
          <div className="lp-wrap lp-two">
            <div data-reveal="">
              <p className="lp-kicker">How this started</p>
              <h2>The agents got good. The trust didn&rsquo;t.</h2>
            </div>
            <div className="lp-prose" data-reveal="">
              <p className="is-lead">
                Browser agents can already click through your apps. Give one a
                task and it will find the buttons. That is real progress, and it
                has a flaw you notice on the second day: it acts live. You learn
                what it changed after it changed it, from a screenshot if you
                are lucky.
              </p>
              <p>
                The other path is to wire the agent into each app by hand:
                tools, guardrails, a review step. That works, and it costs an
                integration per app, per team, per quarter.
              </p>
              <p className="lp-answer">
                EEVEE is our answer: a workbench with one key. The agent builds
                the tool and works it through typed actions. Every write shows
                you its consequence before it happens. Only your passkey lets
                anything publish or land.
              </p>
            </div>
          </div>
          <div className="lp-wrap">
            <ol className="lp-questions">
              {QUESTIONS.map(([question, answer], index) => (
                <li key={question} data-reveal="" style={stagger(index)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{question}</h3>
                  <p>{answer}</p>
                </li>
              ))}
            </ol>
            <p className="lp-pointer" data-reveal="">
              The Decisions ledger in this demo already works this way. It shows
              the diff before you ask.
            </p>
            <p className="lp-fine">
              Independent hackathon prototype for The WebMCP Challenge. Meridian
              Ops, its customers, and its numbers are fictional and seeded.
            </p>
          </div>
        </section>

        <section className="lp-band is-paper lp-benchwork" id="bench">
          <div className="lp-wrap">
            <div className="lp-heading" data-reveal="">
              <p className="lp-kicker">Not just the demo</p>
              <h2>
                Meridian Ops is one applet. The bench is for whatever your week
                needs.
              </h2>
            </div>
            <ul className="lp-bench">
              {BENCH.map(([name, body], index) => (
                <li key={name} data-reveal="" style={stagger(index)}>
                  <h3>{name}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-band lp-ideas-band" id="ideas">
          <div className="lp-wrap">
            <div className="lp-heading" data-reveal="">
              <p className="lp-kicker">Prompts to steal</p>
              <h2>Ask for more than an ERP.</h2>
              <p>
                People are getting good at prompting AI. A product should be
                just as good at prompting people. These are six jobs from real
                plants, pharmacies, docks, and credit desks, written as the
                prompt you would paste, ready to copy.
              </p>
            </div>
            <ul className="lp-ideas">
              {IDEAS.map((idea, index) => (
                <li key={idea.name} data-reveal="" style={stagger(index)}>
                  <span className="lp-ideas-kind">{idea.kind}</span>
                  <h3>{idea.name}</h3>
                  <p>{idea.what}</p>
                  <div className="lp-prompt is-compact">
                    <pre>
                      <code>{idea.prompt}</code>
                    </pre>
                    <CopyPrompt prompt={idea.prompt} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="lp-fine">
              Each one ends with the same beat: the agent evaluates its work and
              brings it to you. Nothing publishes until your passkey says so.
            </p>
          </div>
        </section>

        <section className="lp-band lp-builtin" id="builtin">
          <div className="lp-wrap lp-two">
            <div data-reveal="">
              <p className="lp-kicker">But Sheets has Gemini now</p>
              <h2>Isn&rsquo;t this already built in?</h2>
              <p className="lp-prose-p">
                Some of it, and it helps. Gemini writes the formula in Sheets,
                Copilot drafts in Word, Claude and Codex render a spreadsheet on
                your desktop. If your whole job lives inside one file, use the
                built-in pane. EEVEE starts where the second app begins.
              </p>
              <p className="lp-concession">
                EEVEE is not a better formula bar. It is the part those panes
                leave out.
              </p>
            </div>
            <ul className="lp-builtin-grid">
              {BUILT_IN.map(([claim, body], index) => (
                <li key={claim} data-reveal="" style={stagger(index)}>
                  <h3>{claim}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="lp-wrap">
            <p className="lp-pointer" data-reveal="">
              Your files stay DOCX, XLSX, PPTX, and PDF. The bench runs on your
              own Postgres. Nothing here is a format you cannot leave with.
            </p>
          </div>
        </section>

        <section className="lp-band is-dark lp-keyband" id="key">
          <div className="lp-wrap">
            <div className="lp-heading" data-reveal="">
              <p className="lp-kicker">Graded authority</p>
              <h2>
                One key. Four grades of trust. The baby does not share keys.
              </h2>
              <p>
                This is the same rule for every applet on the bench, shown with
                Meridian Ops: 13 reads, 19 writes, one passkey.
              </p>
            </div>
            <div className="lp-key-grid">
              <figure className="lp-ladder" data-step="0" aria-hidden="true">
                <div className="lp-ladder-key">
                  <svg viewBox="0 0 24 24" width="28" height="28">
                    <circle
                      cx="8"
                      cy="12"
                      r="5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      d="M13 12h9M19 12v4M22 12v3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                  <b>your passkey</b>
                </div>
                <ol>
                  <li data-rung="1">
                    <b>Read</b>
                    <span>13 actions · no ask</span>
                  </li>
                  <li data-rung="2">
                    <b>Rehearse</b>
                    <span>every write · diff first</span>
                  </li>
                  <li data-rung="3">
                    <b>Decide</b>
                    <span>one request · one challenge</span>
                  </li>
                  <li data-rung="4">
                    <b>Lease</b>
                    <span>3 or 10 writes · timed · revocable</span>
                  </li>
                </ol>
                <figcaption>Meridian Ops · 32 actions · 1 key</figcaption>
              </figure>
              <ol className="lp-beats">
                {BEATS.map(([title, body], index) => (
                  <li key={title} data-beat={index + 1}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="lp-band lp-limits" id="limits">
          <div className="lp-wrap lp-two">
            <div data-reveal="">
              <p className="lp-kicker">Where the key stops</p>
              <p className="lp-big">Still your call.</p>
              <p className="lp-aside">
                A green diff can still be the wrong decision. EEVEE will
                rehearse your mistake beautifully.
              </p>
            </div>
            <div data-reveal="">
              <h2>A key cannot make the agent right.</h2>
              <p className="lp-prose-p">
                If the agent misreads the job, the rehearsal shows a correct
                diff of the wrong idea. So EEVEE sticks to what a key can do.
              </p>
              <div className="lp-columns">
                <div>
                  <h3 className="is-no">A key cannot</h3>
                  <ul className="lp-list is-no">
                    {CANNOT.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="is-yes">What EEVEE changes</h3>
                  <ul className="lp-list is-yes">
                    {CHANGES.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-band is-paper lp-fixes">
          <div className="lp-wrap lp-two">
            <div data-reveal="">
              <p className="lp-kicker">Built for The WebMCP Challenge</p>
              <h2>The obvious fixes only go so far.</h2>
              <p className="lp-prose-p">
                Confirm dialogs, read-only modes, and code review each help a
                little. None of them fixes the real problem: you cannot see what
                a write will do until it is done.
              </p>
            </div>
            <div data-reveal="">
              <table className="lp-fixes-table">
                <tbody>
                  {FIXES.map(([fix, verdict]) => (
                    <tr key={fix}>
                      <th scope="row">{fix}</th>
                      <td>{verdict}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="lp-holds">
                <p className="lp-kicker">What holds it together</p>
                <h3>Rehearsal, then one key</h3>
                <p>
                  The write runs first on a copy. You see the diff. Your
                  passkey, or a lease it granted, is the only way through.
                </p>
              </div>
              <a
                className="lp-link"
                href="https://webmcp.devpost.com"
                target="_blank"
                rel="noreferrer"
              >
                Visit The WebMCP Challenge ↗
              </a>
            </div>
          </div>
        </section>

        <section className="lp-band lp-tryband" id="try">
          <div className="lp-wrap">
            <div className="lp-card">
              <div className="lp-two is-tight">
                <h2>Choose a job. Watch the key work.</h2>
                <p className="lp-prose-p">
                  This is the same ERP the demo installs. Three writes, three
                  different decisions, one record that shows every one of them.
                  Yes, it asks every time. That is the feature.
                </p>
              </div>
              <LandingScenarios />
            </div>
          </div>
        </section>

        <section className="lp-band lp-watch">
          <div className="lp-wrap lp-two">
            <h2 data-reveal="">Now watch it work.</h2>
            <p className="lp-prose-p" data-reveal="">
              Paste one prompt to any WebMCP agent, or click through by hand.
              The bench shows every step as it happens.
            </p>
          </div>
          <div className="lp-wrap">
            <ol className="lp-watch-list">
              {WATCH.map((item, index) => (
                <li key={item} data-reveal="" style={stagger(index)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{item}</p>
                </li>
              ))}
            </ol>
            <div className="lp-prompt" data-reveal="">
              <pre>
                <code>{PROMPT}</code>
              </pre>
              <CopyPrompt prompt={PROMPT} />
            </div>
            <p className="lp-fine">
              Works in ChatGPT&rsquo;s browser (GPT-5.6 Sol or Terra) and in
              Chrome 149+ with chrome://flags/#enable-webmcp-testing. No agent?
              Install as draft, Evaluate, Review &amp; publish, Run, then send a
              request by hand. Two more prompts wait in the workbench Guide.
            </p>
          </div>
        </section>

        <section className="lp-band is-dark lp-principles-band" id="principles">
          <div className="lp-wrap">
            <h2 data-reveal="">You hold the key.</h2>
            <p className="lp-prose-p" data-reveal="">
              Every rule below is enforced by the server, not by the
              agent&rsquo;s good manners.
            </p>
            <ol className="lp-principles">
              {PRINCIPLES.map(([rule, how], index) => (
                <li key={rule} data-reveal="" style={stagger(index)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{rule}</h3>
                  <p>{how}</p>
                </li>
              ))}
            </ol>
            <div className="lp-closing" data-reveal="">
              <p className="lp-kicker">That is the whole pitch</p>
              <h2>Open the bench and try it.</h2>
              <p className="lp-closing-line">
                Three minutes. No account. A passkey when you publish, and the
                baby asks before anything else.
              </p>
              <div className="lp-actions">
                <Link
                  className="primary-action lp-cta is-large"
                  href="/workbench"
                >
                  Open demo
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-grid">
          <div className="lp-footer-brand">
            <span className="wordmark">EEVEE</span>
            <p>
              Rehearses everything. Asks before touching. Keeps receipts. A baby
              with excellent manners.
            </p>
            <Link className="primary-action lp-cta" href="/workbench">
              Open demo
            </Link>
          </div>
          <div>
            <h4>Go</h4>
            <ul>
              <li>
                <Link href="/workbench">Workbench</Link>
              </li>
              {repoUrl ? (
                <li>
                  <a href={repoUrl} target="_blank" rel="noreferrer">
                    GitHub
                  </a>
                </li>
              ) : null}
              {videoUrl ? (
                <li>
                  <a href={videoUrl} target="_blank" rel="noreferrer">
                    Demo video
                  </a>
                </li>
              ) : null}
              <li>
                <a
                  href="https://webmcp.devpost.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  The WebMCP Challenge
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h4>On this page</h4>
            <ul>
              <li>
                <a href="#story">The story</a>
              </li>
              <li>
                <a href="#bench">The bench</a>
              </li>
              <li>
                <a href="#builtin">Built in?</a>
              </li>
              <li>
                <a href="#key">The key</a>
              </li>
              <li>
                <a href="#try">Try it</a>
              </li>
              <li>
                <a href="#principles">Principles</a>
              </li>
            </ul>
          </div>
          <div>
            <h4>Under the hood</h4>
            <ul>
              <li>{EEVEE_TOOL_COUNT} WebMCP tools</li>
              <li>Passkeys over WebAuthn</li>
              <li>Next.js 16 · React 19</li>
              <li>PostgreSQL 17, self-hosted</li>
              <li>DOCX · XLSX · PPTX · PDF</li>
            </ul>
          </div>
        </div>
        <div className="lp-wrap lp-footer-fine">
          <span>
            Independent prototype for The WebMCP Challenge, 25 August to 3
            September 2026. Not affiliated with OpenAI or Google. Meridian Ops,
            its customers, and its numbers are fictional.
          </span>
          <span>No agent was handed a key in the making of this page.</span>
        </div>
      </footer>
    </div>
  );
}
