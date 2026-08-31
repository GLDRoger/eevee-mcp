export type RelationshipPartFamily =
  | 'worksheet'
  | 'drawing'
  | 'table'
  | 'comments'
  | 'vml'
  | 'chart'
  | 'pivot-cache-records'

const relationshipFamily = {
  worksheet: {
    pattern: /^xl\/worksheets\/[^/]+\.xml$/,
    description: 'an xl/worksheets/*.xml part',
  },
  drawing: {
    pattern: /^xl\/drawings\/[^/]+\.xml$/,
    description: 'an xl/drawings/*.xml part',
  },
  table: {
    pattern: /^xl\/tables\/[^/]+\.xml$/,
    description: 'an xl/tables/*.xml part',
  },
  comments: {
    pattern: /^xl\/comments(?:[^/]*|\/[^/]+)\.xml$/,
    description: 'an xl/comments*.xml part',
  },
  vml: {
    pattern: /^xl\/drawings\/[^/]+\.vml$/,
    description: 'an xl/drawings/*.vml part',
  },
  chart: {
    pattern: /^xl\/charts\/[^/]+\.xml$/,
    description: 'an xl/charts/*.xml part',
  },
  'pivot-cache-records': {
    pattern: /^xl\/pivotCache\/pivotCacheRecords[^/]*\.xml$/,
    description: 'an xl/pivotCache/pivotCacheRecords*.xml part',
  },
} satisfies Record<
  RelationshipPartFamily,
  { readonly pattern: RegExp; readonly description: string }
>

export class RelationshipTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RelationshipTargetError'
  }
}

export function resolveRelationshipTarget(
  fromPart: string,
  target: string,
  family: RelationshipPartFamily,
): string {
  if (!target || target.includes('\\') || target.includes('?') || target.includes('#')) {
    throw new RelationshipTargetError(`The ${family} relationship target is not a safe package path.`)
  }
  const segments = target.startsWith('/') ? [] : fromPart.split('/').slice(0, -1)
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) {
        throw new RelationshipTargetError(
          `The ${family} relationship target leaves the workbook package.`,
        )
      }
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  const resolved = segments.join('/')
  const expected = relationshipFamily[family]
  if (!expected.pattern.test(resolved)) {
    throw new RelationshipTargetError(
      `The ${family} relationship target must resolve to ${expected.description}.`,
    )
  }
  return resolved
}
