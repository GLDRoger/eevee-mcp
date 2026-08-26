import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import type { JsonObject } from './json'

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

const runtimeScript = (channel: string, inputs: JsonObject): string => `
<script>
(() => {
  const channel = ${escapeScriptJson(channel)};
  const pending = new Map();
  let sequence = 0;
  const request = (action, payload = {}) => new Promise((resolve, reject) => {
    const id = String(++sequence);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('EEVEE storage request timed out'));
    }, 5000);
    pending.set(id, { resolve, reject, timer });
    parent.postMessage({ source: 'eevee-applet', channel, id, action, payload }, '*');
  });
  addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.source !== 'eevee-harness' || message.channel !== channel) return;
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.ok) item.resolve(message.value);
    else item.reject(new Error(message.error || 'EEVEE storage request failed'));
  });
  addEventListener('pagehide', () => {
    parent.postMessage({ source: 'eevee-applet', channel, action: 'revoke' }, '*');
  }, { once: true });
  window.eevee = Object.freeze({
    inputs: Object.freeze(${escapeScriptJson(inputs)}),
    store: Object.freeze({
      get: (key) => request('get', { key }),
      set: (key, value) => request('set', { key, value }),
      all: () => request('all'),
    }),
  });
  parent.postMessage({ source: 'eevee-applet', channel, action: 'ready' }, '*');
})();
</script>`

const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">`

export const compileWebAppRun = (html: string, channel: string, inputs: JsonObject): string => {
  const insertion = headInsertionOffset(html)
  if (insertion === null) throw new Error('The web app source has no explicit head element')
  return `${html.slice(0, insertion)}${csp}${runtimeScript(channel, inputs)}${html.slice(insertion)}`
}
