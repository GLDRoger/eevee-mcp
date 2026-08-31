type UndoTarget = {
  tagName?: string
  isContentEditable?: boolean
  getAttribute?: (name: string) => string | null
} | null

export function isTextUndoTarget(target: UndoTarget): boolean {
  return (
    !!target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable === true)
  )
}
