import type { CreateVersionInput } from '@/domain/applet'
import type { CreateEvaluationSuiteInput } from '@/domain/evaluation'

export const SPARKBENCH_REFERENCE = {
  slug: 'sparkbench',
  name: 'Sparkbench',
  description:
    'A shared electronics bench where a person and browser agent inspect one circuit and approve durable changes.',
} as const

const appSource = String.raw`
import { useCallback, useEffect, useMemo, useState } from 'react'
import './app.css'

const INITIAL = Object.freeze({ voltage: 9, resistance: 330, switchClosed: false })
const EVENT = 'sparkbench:changed'

const validCircuit = (value) => {
  if (!value || typeof value !== 'object') return { ...INITIAL }
  const voltage = typeof value.voltage === 'number' && value.voltage >= 1 && value.voltage <= 24
    ? value.voltage
    : INITIAL.voltage
  const resistance = typeof value.resistance === 'number' && value.resistance >= 1 && value.resistance <= 1000000
    ? value.resistance
    : INITIAL.resistance
  return { voltage, resistance, switchClosed: value.switchClosed === true }
}

const readCircuit = async () => validCircuit(await window.eevee.store.get('circuit'))

const measurements = (circuit) => {
  const ledDrop = 2
  const current = circuit.switchClosed
    ? Math.max(0, (circuit.voltage - ledDrop) / circuit.resistance)
    : 0
  const milliamps = Number((current * 1000).toFixed(2))
  return {
    voltage: circuit.voltage,
    resistance: circuit.resistance,
    currentMilliamps: milliamps,
    ledState: !circuit.switchClosed ? 'off' : milliamps > 30 ? 'overloaded' : milliamps < 4 ? 'dim' : 'lit',
  }
}

const saveCircuit = async (next) => {
  const circuit = validCircuit(next)
  await window.eevee.store.set('circuit', circuit)
  window.dispatchEvent(new Event(EVENT))
  return { circuit, measurements: measurements(circuit) }
}

export const actions = {
  inspect_circuit: async () => {
    const circuit = await readCircuit()
    return { circuit, components: ['9V battery', 'resistor', 'red LED', 'switch'] }
  },
  read_measurements: async () => measurements(await readCircuit()),
  set_resistance: async ({ ohms }) => {
    const circuit = await readCircuit()
    return saveCircuit({ ...circuit, resistance: ohms })
  },
  toggle_switch: async () => {
    const circuit = await readCircuit()
    return saveCircuit({ ...circuit, switchClosed: !circuit.switchClosed })
  },
  reset_bench: async () => saveCircuit(INITIAL),
}

export default function App({ inputs, store }) {
  const [circuit, setCircuit] = useState({ ...INITIAL })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const saved = validCircuit(await store.get('circuit'))
    setCircuit(saved)
    setLoading(false)
  }, [store])

  useEffect(() => {
    void refresh()
    const changed = () => void refresh()
    window.addEventListener(EVENT, changed)
    return () => window.removeEventListener(EVENT, changed)
  }, [refresh])

  const meter = useMemo(() => measurements(circuit), [circuit])

  const change = async (next) => {
    const circuitValue = validCircuit(next)
    setCircuit(circuitValue)
    await store.set('circuit', circuitValue)
  }

  return <main className="lab-shell">
    <header className="lab-heading">
      <div>
        <p>EEVEE reference applet · governed actions</p>
        <h1 id="lab-title">{String(inputs.lab_name || 'Sparkbench')}</h1>
      </div>
      <span>{loading ? 'Reading bench' : 'Circuit ready'}</span>
    </header>

    <section className="bench" aria-labelledby="circuit-title">
      <div className="circuit-board">
        <div className="trace trace-top" />
        <div className="trace trace-bottom" />
        <div className="component battery"><strong>{circuit.voltage}V</strong><span>Battery</span></div>
        <div className="component resistor"><strong>{circuit.resistance}Ω</strong><span>Resistor</span></div>
        <div className={'component led is-' + meter.ledState}><strong>LED</strong><span>{meter.ledState}</span></div>
        <button
          id="bench-switch"
          className={circuit.switchClosed ? 'switch is-closed' : 'switch'}
          type="button"
          aria-pressed={circuit.switchClosed}
          onClick={() => void change({ ...circuit, switchClosed: !circuit.switchClosed })}
        >
          {circuit.switchClosed ? 'Open switch' : 'Close switch'}
        </button>
      </div>

      <aside className="meter" aria-live="polite">
        <p id="circuit-state">{circuit.switchClosed ? 'Closed circuit' : 'Open circuit'}</p>
        <strong>{meter.currentMilliamps} mA</strong>
        <dl>
          <div><dt>Source</dt><dd>{meter.voltage} V</dd></div>
          <div><dt>Load</dt><dd>{meter.resistance} Ω</dd></div>
          <div><dt>LED</dt><dd>{meter.ledState}</dd></div>
        </dl>
      </aside>
    </section>

    <section className="bench-controls" aria-labelledby="controls-title">
      <div>
        <h2 id="controls-title">Resistance drawer</h2>
        <p>The person can change the bench directly. Agent changes wait in EEVEE for approval.</p>
      </div>
      <div className="resistance-options">
        {[220, 330, 1000].map((ohms) => <button
          key={ohms}
          type="button"
          aria-pressed={circuit.resistance === ohms}
          onClick={() => void change({ ...circuit, resistance: ohms })}
        >{ohms} Ω</button>)}
      </div>
    </section>
  </main>
}
`

const styles = String.raw`
:root { color-scheme: light; font-family: "Avenir Next", Avenir, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: #d8d4c7; color: #17231d; }
button { font: inherit; }
.lab-shell { min-height: 100vh; padding: 28px; background: #d8d4c7; }
.lab-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding-bottom: 18px; border-bottom: 2px solid #17231d; }
.lab-heading div { display: grid; gap: 4px; }
.lab-heading p, .lab-heading h1 { margin: 0; }
.lab-heading p { color: #8c3a2c; font-size: 12px; font-weight: 700; }
.lab-heading h1 { font-family: Georgia, serif; font-size: 36px; font-weight: 500; }
.lab-heading > span { color: #4b5d52; font-size: 13px; }
.bench { display: grid; grid-template-columns: minmax(0, 1fr) 220px; min-height: 350px; border-bottom: 1px solid #7f8177; }
.circuit-board { position: relative; min-height: 350px; overflow: hidden; background: #1d372a; }
.trace { position: absolute; left: 13%; right: 13%; height: 6px; background: #c59c4a; }
.trace-top { top: 34%; }
.trace-bottom { bottom: 28%; }
.component { position: absolute; display: grid; place-items: center; min-width: 94px; min-height: 66px; padding: 10px; background: #d8d4c7; color: #17231d; }
.component span { color: #4b5d52; font-size: 11px; }
.battery { left: 8%; top: 24%; }
.resistor { left: 44%; top: 24%; }
.led { right: 8%; top: 24%; border-radius: 50%; min-width: 74px; width: 74px; }
.led.is-lit { background: #c85c42; color: #24120d; }
.led.is-overloaded { background: #54241c; color: #f0e9d7; }
.led.is-dim { background: #9b6b5d; }
.switch { position: absolute; left: 42%; bottom: 18%; min-width: 130px; min-height: 46px; border: 2px solid #d8d4c7; background: transparent; color: #f0e9d7; }
.switch:hover, .switch:focus-visible { background: #2f503e; }
.switch.is-closed { background: #c59c4a; color: #17231d; }
.meter { display: grid; align-content: center; gap: 12px; padding: 24px; background: #ebe6d8; }
.meter p, .meter dl { margin: 0; }
.meter > strong { font-family: Georgia, serif; font-size: 34px; font-weight: 500; }
.meter dl { display: grid; gap: 8px; }
.meter dl div { display: flex; justify-content: space-between; gap: 16px; }
.meter dt { color: #4b5d52; }
.meter dd { margin: 0; font-variant-numeric: tabular-nums; }
.bench-controls { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-top: 22px; }
.bench-controls h2, .bench-controls p { margin: 0; }
.bench-controls h2 { font-family: Georgia, serif; font-size: 20px; font-weight: 500; }
.bench-controls p { max-width: 58ch; margin-top: 5px; color: #4b5d52; font-size: 13px; }
.resistance-options { display: flex; gap: 8px; }
.resistance-options button { min-height: 40px; padding: 6px 12px; border: 1px solid #4b5d52; background: transparent; color: #17231d; }
.resistance-options button[aria-pressed="true"] { background: #17231d; color: #f0e9d7; }
button:focus-visible { outline: 3px solid #c85c42; outline-offset: 3px; }
@media (max-width: 680px) {
  .lab-shell { padding: 18px; }
  .lab-heading, .bench-controls { align-items: start; flex-direction: column; }
  .bench { grid-template-columns: 1fr; }
  .circuit-board { min-height: 300px; }
  .meter { grid-template-columns: 1fr 1fr; }
  .meter dl { grid-column: 1 / -1; }
  .component { transform: scale(.86); }
  .resistance-options { width: 100%; }
  .resistance-options button { flex: 1; }
}
`

export const sparkbenchVersion: CreateVersionInput = {
  note: 'Reference circuit workbench with governed actions',
  inputs: [
    {
      key: 'lab_name',
      label: 'Lab name',
      description: 'Heading shown above the shared electronics bench.',
      kind: 'text',
      required: true,
      defaultValue: 'WebMCP electronics lab',
      maxLength: 80,
    },
  ],
  definition: {
    kind: 'react-app',
    entry: 'src/App.tsx',
    files: [
      { path: 'src/App.tsx', content: appSource },
      { path: 'src/app.css', content: styles },
    ],
    actions: [
      {
        name: 'inspect_circuit',
        title: 'Inspect circuit',
        description: 'Read the components and current switch state on the shared bench.',
        inputs: [],
        effects: ['state:read'],
        authority: 'automatic',
      },
      {
        name: 'read_measurements',
        title: 'Read measurements',
        description: 'Calculate source voltage, resistance, current, and LED state.',
        inputs: [],
        effects: ['state:read'],
        authority: 'automatic',
      },
      {
        name: 'set_resistance',
        title: 'Set resistance',
        description: 'Propose a resistor value for the shared circuit.',
        inputs: [
          {
            key: 'ohms',
            label: 'Resistance',
            description: 'Resistance in ohms from 1 to 1,000,000.',
            kind: 'number',
            required: true,
            minimum: 1,
            maximum: 1_000_000,
          },
        ],
        effects: ['state:read', 'state:write'],
        authority: 'human',
      },
      {
        name: 'toggle_switch',
        title: 'Toggle switch',
        description: 'Propose opening or closing the circuit switch.',
        inputs: [],
        effects: ['state:read', 'state:write'],
        authority: 'human',
      },
      {
        name: 'reset_bench',
        title: 'Reset bench',
        description: 'Propose restoring the reference circuit to its initial values.',
        inputs: [],
        effects: ['state:write'],
        authority: 'human',
      },
    ],
  },
}

export const sparkbenchEvaluation: CreateEvaluationSuiteInput = {
  name: 'Sparkbench shared-state behavior',
  cases: [
    {
      id: 'switch-survives-restart',
      name: 'A person closes the circuit and the state survives restart',
      criticality: 'required',
      input: { lab_name: 'WebMCP electronics lab' },
      steps: [
        { action: 'assert-text', selector: '#lab-title', contains: 'WebMCP electronics lab' },
        { action: 'click', selector: '#bench-switch' },
        { action: 'assert-text', selector: '#circuit-state', contains: 'Closed circuit' },
        {
          action: 'assert-stored-value',
          key: 'circuit',
          value: { voltage: 9, resistance: 330, switchClosed: true },
        },
        { action: 'restart' },
        { action: 'assert-text', selector: '#circuit-state', contains: 'Closed circuit' },
      ],
    },
  ],
}
