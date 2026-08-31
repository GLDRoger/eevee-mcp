import 'server-only'

import type { WorkbookSaveRequest } from '@/office/sheets/shared/desktop-api'
import {
  assembleWithJsZip,
  assertOnlyTouchedEntriesChanged,
  createBufferEntrySource,
  planCellEditsToXlsx,
  readBasicWorkbook,
  type SheetFormulaValues,
  type SheetHyperlinkEdits,
  type SheetStructuralOps,
} from '@/office/sheets/gateway/xlsx-gateway'
import type { SheetEditPlan } from '@/office/sheets/gateway/xlsx-sheets'
import { RequestFailure } from './http'
import { getOfficeFileSummary, readOfficeFileBytes, saveOfficeFile } from './office-files'

const missingSheet = (sheetId: string): never => {
  throw new RequestFailure(400, 'invalid_sheet_id', `The workbook does not contain sheet ${sheetId}`)
}

interface SheetNames {
  readonly working: (sheetId: string) => string
  readonly final: (sheetId: string) => string
  readonly plan: SheetEditPlan | undefined
}

const sheetNamesFor = (
  request: WorkbookSaveRequest,
  original: Readonly<Record<string, string>>,
): SheetNames => {
  const added = new Map<string, { name: string; sourceSheetId?: string }>()
  const final = new Map(Object.entries(original))

  for (const operation of request.sheetOps) {
    switch (operation.kind) {
      case 'add-sheet':
        added.set(operation.sheetId, { name: operation.name })
        final.set(operation.sheetId, operation.name)
        break
      case 'duplicate-sheet':
        added.set(operation.sheetId, {
          name: operation.name,
          sourceSheetId: operation.sourceSheetId,
        })
        final.set(operation.sheetId, operation.name)
        break
      case 'rename-sheet':
        if (!final.has(operation.sheetId)) missingSheet(operation.sheetId)
        final.set(operation.sheetId, operation.newName)
        break
      case 'remove-sheet':
        final.delete(operation.sheetId)
        break
      case 'set-sheet-hidden':
      case 'reorder-sheets':
        break
      default: {
        const exhaustive: never = operation
        return exhaustive
      }
    }
  }

  const working = (sheetId: string): string =>
    original[sheetId] ?? added.get(sheetId)?.name ?? missingSheet(sheetId)
  const finalName = (sheetId: string): string => final.get(sheetId) ?? missingSheet(sheetId)

  if (request.sheetOps.length === 0) return { working, final: finalName, plan: undefined }

  const plan: SheetEditPlan = {
    renames: request.sheetOps.flatMap((operation) =>
      operation.kind === 'rename-sheet'
        ? [{ sheetName: original[operation.sheetId] ?? missingSheet(operation.sheetId), newName: operation.newName }]
        : [],
    ),
    additions: request.sheetOps.flatMap((operation) => {
      if (operation.kind === 'add-sheet') return [{ name: operation.name }]
      if (operation.kind !== 'duplicate-sheet') return []
      return [{ name: operation.name, sourceSheetName: working(operation.sourceSheetId) }]
    }),
    removals: request.sheetOps.flatMap((operation) =>
      operation.kind === 'remove-sheet'
        ? [original[operation.sheetId] ?? missingSheet(operation.sheetId)]
        : [],
    ),
    order: request.sheetOrder.map(finalName),
    hiddenChanges: request.sheetOps.flatMap((operation) =>
      operation.kind === 'set-sheet-hidden'
        ? [{ sheetName: working(operation.sheetId), hidden: operation.hidden }]
        : [],
    ),
    orderChanged: request.sheetOps.some(
      (operation) =>
        operation.kind === 'add-sheet' ||
        operation.kind === 'duplicate-sheet' ||
        operation.kind === 'remove-sheet' ||
        operation.kind === 'reorder-sheets',
    ),
  }
  return { working, final: finalName, plan }
}

const structuralOpsFor = (
  request: WorkbookSaveRequest,
  nameFor: (sheetId: string) => string,
): SheetStructuralOps[] => {
  const grouped = new Map<string, SheetStructuralOps['ops'][number][]>()
  for (const operation of request.structuralOps) {
    const { sheetId, ...op } = operation
    const sheetName = nameFor(sheetId)
    grouped.set(sheetName, [...(grouped.get(sheetName) ?? []), op])
  }
  return [...grouped].map(([sheetName, ops]) => ({ sheetName, ops }))
}

const formulaValuesFor = (
  request: WorkbookSaveRequest,
  nameFor: (sheetId: string) => string,
): SheetFormulaValues[] => {
  const grouped = new Map<string, SheetFormulaValues['cells'][number][]>()
  for (const { sheetId, ...cell } of request.formulaValues) {
    const sheetName = nameFor(sheetId)
    grouped.set(sheetName, [...(grouped.get(sheetName) ?? []), cell])
  }
  return [...grouped].map(([sheetName, cells]) => ({ sheetName, cells }))
}

const hyperlinkEditsFor = (
  request: WorkbookSaveRequest,
  nameFor: (sheetId: string) => string,
): SheetHyperlinkEdits[] => {
  const grouped = new Map<string, SheetHyperlinkEdits['edits'][number][]>()
  for (const { sheetId, ...edit } of request.hyperlinkEdits) {
    const sheetName = nameFor(sheetId)
    grouped.set(sheetName, [...(grouped.get(sheetName) ?? []), edit])
  }
  return [...grouped].map(([sheetName, edits]) => ({ sheetName, edits }))
}

export const applySpreadsheetSave = async (
  bytes: Uint8Array,
  request: WorkbookSaveRequest,
): Promise<{ bytes: Uint8Array; touchedEntries: readonly string[] }> => {
  const source = Buffer.from(bytes)
  const imported = await readBasicWorkbook(source)
  const names = sheetNamesFor(request, imported.sheetNamesById)
  const withSheetName = <Item extends { sheetId: string }>(item: Item) => {
    const { sheetId, ...rest } = item
    return { ...rest, sheetName: names.working(sheetId) }
  }
  const pivots = request.pivotAdditions.map(({ sheetId, sourceSheetId, ...pivot }) => ({
    ...pivot,
    sheetName: names.working(sheetId),
    sourceSheetName: names.working(sourceSheetId),
  }))
  const pivotRefreshUpdates = request.pivotRefreshUpdates.map(
    ({ sheetId, relayout, ...update }) => ({
      ...update,
      sheetName: names.working(sheetId),
      ...(relayout
        ? {
            relayout: {
              ...relayout,
              sheetName: names.working(relayout.sheetId),
              sourceSheetName: names.working(relayout.sourceSheetId),
            },
          }
        : {}),
    }),
  )
  const edits = request.edits.map(
    ({ sheetId, value, formula, ...edit }) => ({
      ...edit,
      sheetName: names.working(sheetId),
      cell: { value, ...(formula ? { formula } : {}) },
    }),
  )
  const plan = await planCellEditsToXlsx(
    await createBufferEntrySource(source),
    edits,
    structuralOpsFor(request, names.working),
    request.chartEdits,
    names.plan,
    request.filterStates.map(withSheetName),
    hyperlinkEditsFor(request, names.working),
    request.cfStates.map(withSheetName),
    request.dvStates.map(withSheetName),
    request.sheetProtections.map(withSheetName),
    request.definedNamesState,
    request.visualAdditions.map(withSheetName),
    request.pageSetupStates.map(withSheetName),
    request.noteStates.map(withSheetName),
    request.tableAdditions.map(withSheetName),
    pivots,
    request.pivotCacheRefreshPaths,
    pivotRefreshUpdates,
    request.visualEdits,
    request.sparklineAdditions.map(withSheetName),
    formulaValuesFor(request, names.working),
  )
  const mutation = await assembleWithJsZip(source, plan)
  assertOnlyTouchedEntriesChanged(mutation)
  return { bytes: new Uint8Array(mutation.buffer), touchedEntries: mutation.touchedEntries }
}

export const editSpreadsheetFile = async (
  workspaceId: string,
  fileId: string,
  baseVersionId: string,
  request: WorkbookSaveRequest,
) => {
  const current = await getOfficeFileSummary(workspaceId, fileId)
  if (current.medium !== 'spreadsheet') {
    throw new RequestFailure(409, 'file_medium_mismatch', 'This operation requires an XLSX file')
  }
  if (current.versionId !== baseVersionId) {
    throw new RequestFailure(
      409,
      'file_version_conflict',
      'This workbook changed after it was opened. Reload before saving your edits.',
    )
  }
  const { bytes } = await readOfficeFileBytes(workspaceId, fileId, baseVersionId)
  let saved: Awaited<ReturnType<typeof applySpreadsheetSave>>
  try {
    saved = await applySpreadsheetSave(bytes, request)
  } catch (error) {
    throw new RequestFailure(
      400,
      'invalid_spreadsheet_edit',
      error instanceof Error ? error.message : 'The workbook edit is not valid',
    )
  }
  return {
    file: await saveOfficeFile(workspaceId, fileId, baseVersionId, saved.bytes),
    touchedEntries: saved.touchedEntries,
  }
}
