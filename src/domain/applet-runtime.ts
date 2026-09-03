import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import type { JsonObject } from './json'
import type { AppletActionDefinition } from './applet-action'

type Node = DefaultTreeAdapterTypes.Node

const headInsertionOffset = (html: string): number | null => {
  const document = parse(html, { sourceCodeLocationInfo: true })
  const visit = (node: Node): number | null => {
    if ('tagName' in node && node.tagName === 'head') {
      return node.sourceCodeLocation?.startTag?.endOffset ?? null
    }
    if (!('childNodes' in node)) return null
    for (const child of node.childNodes) {
      const offset = visit(child)
      if (offset !== null) return offset
    }
    return null
  }
  return visit(document)
}

const escapeScriptJson = (value: unknown): string =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')

const runtimeScript = (
  channel: string,
  inputs: JsonObject,
  actions: readonly AppletActionDefinition[],
  media: JsonObject | null,
): string => {
  return `
<script>
(() => {
  const channel = ${escapeScriptJson(channel)};
  const actionDefinitions = ${escapeScriptJson(actions)};
  const media = ${escapeScriptJson(media)};
  const declaredActions = new Map(actionDefinitions.map((action) => [action.name, action]));
  const actionHandlers = new Map();
  const pending = new Map();
  const activeRequests = new Set();
  // Minted here instead of serialized into the markup. Applet code shares this
  // realm and could read a literal token out of document.scripts, then answer
  // evaluator commands itself.
  const evaluationToken = crypto.randomUUID();
  const parentPostMessage = parent.postMessage.bind(parent);
  // Applet code runs after this script in the same realm and could replace
  // document.querySelectorAll, the innerText getter, or the value getter to
  // show the evaluator a fiction. Every DOM read and interaction below goes
  // through references captured before any applet code runs, so prototype
  // patches and instance-level shadowing are both bypassed. Array, Promise,
  // and timer built-ins are deliberately left alone; an applet that rewrites
  // those is a review problem, not an evaluator problem.
  const { HTMLElement, HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement } = window;
  const EventCtor = Event;
  const KeyboardEventCtor = KeyboardEvent;
  const InputEventCtor = typeof InputEvent === 'function' ? InputEvent : null;
  const getter = (prototype, property) => Object.getOwnPropertyDescriptor(prototype, property)?.get ?? null;
  const native = Object.freeze({
    querySelector: Document.prototype.querySelector,
    querySelectorAll: Document.prototype.querySelectorAll,
    execCommand: typeof Document.prototype.execCommand === 'function' ? Document.prototype.execCommand : null,
    closest: Element.prototype.closest,
    dispatchEvent: EventTarget.prototype.dispatchEvent,
    addEventListener: EventTarget.prototype.addEventListener,
    removeEventListener: EventTarget.prototype.removeEventListener,
    click: HTMLElement.prototype.click,
    focus: HTMLElement.prototype.focus,
    requestSubmit: HTMLFormElement.prototype.requestSubmit,
    inputSelect: HTMLInputElement.prototype.select,
    textareaSelect: HTMLTextAreaElement.prototype.select,
    tagName: getter(Element.prototype, 'tagName'),
    innerText: getter(HTMLElement.prototype, 'innerText'),
    textContent: getter(Node.prototype, 'textContent'),
    inputValue: getter(HTMLInputElement.prototype, 'value'),
    textareaValue: getter(HTMLTextAreaElement.prototype, 'value'),
    selectValue: getter(HTMLSelectElement.prototype, 'value'),
  });
  const readText = (element) => {
    const read = element instanceof HTMLElement && native.innerText ? native.innerText : native.textContent;
    const text = read.call(element);
    return typeof text === 'string' ? text : '';
  };
  const readValue = (element) => {
    const read = element instanceof HTMLInputElement
      ? native.inputValue
      : element instanceof HTMLTextAreaElement
        ? native.textareaValue
        : element instanceof HTMLSelectElement
          ? native.selectValue
          : null;
    const value = read ? read.call(element) : null;
    return typeof value === 'string' ? value : null;
  };
  let sequence = 0;
  let revoked = false;
  let activeInvocation = null;
  const post = (message) => parentPostMessage({ source: 'eevee-applet', channel, ...message }, '*');
  const evaluationPost = (message) => parentPostMessage({ source: 'eevee-applet-evaluation', channel, evaluationToken, ...message }, '*');
  const revoke = (event) => {
    if (revoked) return;
    revoked = true;
    const candidate = event?.error?.message
      || event?.reason?.message
      || (typeof event?.reason === 'string' ? event.reason : '')
      || event?.message
      || event?.type;
    const reason = typeof candidate === 'string' && candidate
      ? candidate.slice(0, 500)
      : 'The applet runtime stopped unexpectedly';
    post({ action: 'revoke', reason });
  };
  const request = (action, payload = {}) => {
    const operation = new Promise((resolve, reject) => {
      const id = String(++sequence);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('EEVEE storage request timed out'));
      }, 5000);
      pending.set(id, { resolve, reject, timer });
      post({ id, action, payload, invocation: activeInvocation });
    });
    activeRequests.add(operation);
    return operation.finally(() => activeRequests.delete(operation));
  };
  const afterTurn = () => new Promise((resolve) => setTimeout(resolve, 0));
  const settleBridgeWork = async (budgetMs = 2000) => {
    // Drain bridge requests started by mount or by a UI interaction: keep
    // waiting while storage calls are in flight, then require two consecutive
    // idle turns so requests chained from a resolved call are also observed.
    const deadline = Date.now() + budgetMs;
    let idleTurns = 0;
    let cycles = 0;
    while (Date.now() < deadline) {
      cycles += 1;
      if (activeRequests.size) {
        idleTurns = 0;
        await Promise.allSettled([...activeRequests]);
      } else {
        idleTurns += 1;
      }
      await afterTurn();
      if (idleTurns >= 2 && activeRequests.size === 0) return { settled: true, cycles };
    }
    return { settled: false, cycles };
  };
  const waitForMountWork = () => settleBridgeWork(4000);
  const findElement = (selector) => {
    const element = native.querySelector.call(document, selector);
    if (!element) throw new Error('No element matches ' + selector);
    return element;
  };
  const inspectElements = (selector) => {
    const elements = [...native.querySelectorAll.call(document, selector)];
    const first = elements[0];
    const text = elements.slice(0, 100).map(readText).join('\\n').slice(0, 20000);
    const value = first ? readValue(first) : null;
    return { count: elements.length, text, value };
  };
  const fillElement = (selector, value) => {
    const element = findElement(selector);
    const prototype = element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : null;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) throw new Error('The matched element cannot receive text');
    const select = element instanceof HTMLInputElement ? native.inputSelect : native.textareaSelect;
    const previous = readValue(element);
    native.focus.call(element);
    select.call(element);
    if (native.execCommand && native.execCommand.call(document, 'insertText', false, value)) {
      native.dispatchEvent.call(element, new EventCtor('change', { bubbles: true }));
      return 'browser-insertion';
    }
    setter.call(element, value);
    if (element._valueTracker) element._valueTracker.setValue(previous);
    const inputEvent = InputEventCtor
      ? new InputEventCtor('input', { bubbles: true, data: value, inputType: 'insertText' })
      : new EventCtor('input', { bubbles: true });
    native.dispatchEvent.call(element, inputEvent);
    native.dispatchEvent.call(element, new EventCtor('change', { bubbles: true }));
    return 'input-event';
  };
  const pressElement = (selector, requestedKey) => {
    const element = findElement(selector);
    if (!(element instanceof HTMLElement)) throw new Error('The matched element cannot receive keys');
    const key = requestedKey === 'Space' ? ' ' : requestedKey;
    native.focus.call(element);
    const proceeds = native.dispatchEvent.call(element, new KeyboardEventCtor('keydown', { key, bubbles: true, cancelable: true }));
    native.dispatchEvent.call(element, new KeyboardEventCtor('keyup', { key, bubbles: true }));
    if (proceeds && key === 'Enter') {
      const form = native.closest.call(element, 'form');
      if (form) native.requestSubmit.call(form);
    }
  };
  const evaluateCommand = (command) => {
    switch (command.action) {
      case 'click': {
        const element = findElement(command.selector);
        if (!(element instanceof HTMLElement)) throw new Error('The matched element cannot be clicked');
        const form = native.closest.call(element, 'form');
        let submitted = false;
        const observeSubmit = () => { submitted = true; };
        if (form) native.addEventListener.call(form, 'submit', observeSubmit);
        native.click.call(element);
        if (form) native.removeEventListener.call(form, 'submit', observeSubmit);
        return { submitted, formFound: Boolean(form), tag: native.tagName.call(element).toLowerCase() };
      }
      case 'fill':
        return fillElement(command.selector, command.value);
      case 'press':
        pressElement(command.selector, command.key);
        return true;
      case 'inspect':
        return inspectElements(command.selector);
      case 'settle':
        return settleBridgeWork();
      default:
        throw new Error('The evaluation command is not supported');
    }
  };
  const serializableActionResult = (value) => {
    const encoded = JSON.stringify(value === undefined ? null : value);
    if (encoded === undefined) throw new Error('The applet action returned a non-JSON value');
    if (new TextEncoder().encode(encoded).byteLength > 64000) {
      throw new Error('The applet action result exceeds 64 KB');
    }
    return JSON.parse(encoded);
  };
  const installActions = (handlers) => {
    if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)) {
      throw new Error('The applet actions export must be an object of functions');
    }
    for (const [name, handler] of Object.entries(handlers)) {
      if (!declaredActions.has(name)) throw new Error('The applet registers an undeclared action: ' + name + '. Declare it in the version\\'s actions or remove it from actions.register');
      if (typeof handler !== 'function') throw new Error('Applet action handlers must be functions: ' + name);
      actionHandlers.set(name, handler);
    }
  };
  addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== parent) return;
    if (message && message.source === 'eevee-action' && message.channel === channel) {
      event.stopImmediatePropagation();
      if (revoked) return;
      const definition = declaredActions.get(message.name);
      const handler = actionHandlers.get(message.name);
      if (!definition || !handler || activeInvocation !== null) {
        parentPostMessage({
          source: 'eevee-applet-action',
          channel,
          requestId: message.requestId,
          ok: false,
          error: activeInvocation ? 'Another applet action is running' : 'The applet action is unavailable',
        }, '*');
        return;
      }
      activeInvocation = Object.freeze({ requestId: message.requestId, name: message.name });
      void Promise.resolve()
        .then(() => handler(Object.freeze(message.input || {})))
        .then((value) => parentPostMessage({
          source: 'eevee-applet-action',
          channel,
          requestId: message.requestId,
          ok: true,
          value: serializableActionResult(value),
        }, '*'))
        .catch((error) => parentPostMessage({
          source: 'eevee-applet-action',
          channel,
          requestId: message.requestId,
          ok: false,
          error: error instanceof Error ? error.message.slice(0, 500) : 'The applet action failed',
        }, '*'))
        .finally(() => { activeInvocation = null; });
      return;
    }
    if (message && message.source === 'eevee-evaluator' && message.channel === channel) {
      event.stopImmediatePropagation();
      if (message.evaluationToken !== evaluationToken) return;
      void Promise.resolve()
        .then(() => evaluateCommand(message.command))
        .then(
          (value) => evaluationPost({ id: message.id, ok: true, value }),
          (error) => evaluationPost({
            id: message.id,
            ok: false,
            error: error instanceof Error ? error.message : 'The evaluation command failed',
          }),
        );
      return;
    }
    if (!message || message.source !== 'eevee-harness' || message.channel !== channel) return;
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.ok) item.resolve(message.value);
    else item.reject(new Error(message.error || 'EEVEE storage request failed'));
  }, true);
  addEventListener('error', revoke);
  addEventListener('unhandledrejection', revoke);
  addEventListener('pagehide', revoke, { once: true });
  Object.defineProperty(window, 'eevee', { configurable: false, writable: false, value: Object.freeze({
    inputs: Object.freeze(${escapeScriptJson(inputs)}),
    media: media === null ? null : Object.freeze(media),
    store: Object.freeze({
      get: (key) => request('get', { key }),
      set: (key, value) => request('set', { key, value }),
      all: () => request('all'),
    }),
    files: Object.freeze({
      list: () => request('files-list'),
      read: (fileId) => request('files-read', { fileId }),
      table: (fileId) => request('files-table', { fileId }),
      text: (fileId) => request('files-text', { fileId }),
    }),
    actions: Object.freeze({ register: installActions }),
  }) });
  Object.defineProperty(window, '__eeveeReady', {
    configurable: false,
    writable: false,
    value: () => void waitForMountWork().then(
      () => {
        const missing = actionDefinitions.filter(({ name }) => !actionHandlers.has(name));
        if (missing.length > 0) {
          throw new Error('Declared actions without handlers: ' + missing.map(({ name }) => name).join(', ') + '. Register each with window.eevee.actions.register or remove it from the version\\'s actions');
        }
        post({ action: 'ready', evaluationToken });
      },
      revoke,
    ).catch(revoke),
  });
})();
</script>`
}

const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">`

export const prepareAppletRuntime = (
  artifactHtml: string,
  channel: string,
  inputs: JsonObject,
  actions: readonly AppletActionDefinition[] = [],
  media: JsonObject | null = null,
): string => {
  const insertion = headInsertionOffset(artifactHtml)
  if (insertion === null) throw new Error('The compiled artifact has no explicit head element')
  return `${artifactHtml.slice(0, insertion)}${csp}${runtimeScript(channel, inputs, actions, media)}${artifactHtml.slice(insertion)}`
}
