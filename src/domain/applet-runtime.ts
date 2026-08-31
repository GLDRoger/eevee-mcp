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
): string => {
  const evaluationToken = crypto.randomUUID()
  return `
<script>
(() => {
  const channel = ${escapeScriptJson(channel)};
  const actionDefinitions = ${escapeScriptJson(actions)};
  const declaredActions = new Map(actionDefinitions.map((action) => [action.name, action]));
  const actionHandlers = new Map();
  const pending = new Map();
  const activeRequests = new Set();
  const evaluationToken = ${escapeScriptJson(evaluationToken)};
  const parentPostMessage = parent.postMessage.bind(parent);
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
  const waitForMountWork = async () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      if (activeRequests.size) await Promise.allSettled([...activeRequests]);
      await afterTurn();
    }
  };
  const findElement = (selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error('No element matches ' + selector);
    return element;
  };
  const inspectElements = (selector) => {
    const elements = [...document.querySelectorAll(selector)];
    const first = elements[0];
    const text = elements.slice(0, 100).map((element) =>
      element instanceof HTMLElement ? element.innerText : element.textContent || ''
    ).join('\\n').slice(0, 20000);
    const value = first && 'value' in first && typeof first.value === 'string' ? first.value : null;
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
    const previous = element.value;
    element.focus();
    element.select();
    if (document.execCommand('insertText', false, value)) {
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return 'browser-insertion';
    }
    setter.call(element, value);
    if (element._valueTracker) element._valueTracker.setValue(previous);
    const inputEvent = typeof InputEvent === 'function'
      ? new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })
      : new Event('input', { bubbles: true });
    element.dispatchEvent(inputEvent);
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return 'input-event';
  };
  const pressElement = (selector, requestedKey) => {
    const element = findElement(selector);
    if (!(element instanceof HTMLElement)) throw new Error('The matched element cannot receive keys');
    const key = requestedKey === 'Space' ? ' ' : requestedKey;
    element.focus();
    const proceeds = element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
    if (proceeds && key === 'Enter') element.closest('form')?.requestSubmit();
  };
  const evaluateCommand = (command) => {
    switch (command.action) {
      case 'click': {
        const element = findElement(command.selector);
        if (!(element instanceof HTMLElement)) throw new Error('The matched element cannot be clicked');
        const form = element.closest('form');
        let submitted = false;
        const observeSubmit = () => { submitted = true; };
        form?.addEventListener('submit', observeSubmit);
        element.click();
        form?.removeEventListener('submit', observeSubmit);
        return { submitted, formFound: Boolean(form), tag: element.tagName.toLowerCase() };
      }
      case 'fill':
        return fillElement(command.selector, command.value);
      case 'press':
        pressElement(command.selector, command.key);
        return true;
      case 'inspect':
        return inspectElements(command.selector);
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
      if (!declaredActions.has(name)) throw new Error('The applet implements an undeclared action: ' + name);
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
      try {
        evaluationPost({ id: message.id, ok: true, value: evaluateCommand(message.command) });
      } catch (error) {
        evaluationPost({
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : 'The evaluation command failed',
        });
      }
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
          throw new Error('Missing applet action handlers: ' + missing.map(({ name }) => name).join(', '));
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
): string => {
  const insertion = headInsertionOffset(artifactHtml)
  if (insertion === null) throw new Error('The compiled artifact has no explicit head element')
  return `${artifactHtml.slice(0, insertion)}${csp}${runtimeScript(channel, inputs, actions)}${artifactHtml.slice(insertion)}`
}
