const PRINTING_CLASS = 'office-printing'

const rootSelector = (rootClass: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(rootClass)) {
    throw new Error('Print root must be one CSS class name')
  }
  return `.${rootClass}`
}

export const printOfficeRoot = (rootClass: string): void => {
  const selector = rootSelector(rootClass)
  if (!document.querySelector(selector)) throw new Error(`Print root ${selector} was not found`)

  const style = document.createElement('style')
  style.textContent = `@media print {
    body.${PRINTING_CLASS} * { visibility: hidden !important; }
    body.${PRINTING_CLASS} ${selector}, body.${PRINTING_CLASS} ${selector} * { visibility: visible !important; }
    body.${PRINTING_CLASS} ${selector} { position: absolute !important; inset: 0 !important; }
  }`
  document.head.append(style)
  document.body.classList.add(PRINTING_CLASS)
  try {
    window.print()
  } finally {
    document.body.classList.remove(PRINTING_CLASS)
    style.remove()
  }
}
