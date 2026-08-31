import { sql } from 'drizzle-orm'
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import type {
  AppletVersionDefinition,
  WebAppRunOutput,
} from '@/domain/applet'
import type { InputDefinition } from '@/domain/input'
import type { JsonObject, JsonValue } from '@/domain/json'
import type { QualityReport } from '@/domain/quality'
import type { WebAppArtifact } from '@/domain/react-app'
import type { EvaluationCaseDefinition, EvaluationReport } from '@/domain/evaluation'

export const appletMedium = pgEnum('applet_medium', [
  'web-app',
  'document',
  'spreadsheet',
  'presentation',
  'pdf',
  'workflow',
  'image',
  'video',
])
export const appletState = pgEnum('applet_state', ['active', 'archived'])
export const versionState = pgEnum('applet_version_state', ['draft', 'approved', 'rejected'])
export const runState = pgEnum('applet_run_state', ['queued', 'running', 'succeeded', 'failed'])
export const correctionState = pgEnum('correction_state', ['proposed', 'applied', 'dismissed'])
export const evaluationRunState = pgEnum('evaluation_run_state', ['running', 'passed', 'failed'])
export const officeFileMedium = pgEnum('office_file_medium', [
  'document',
  'spreadsheet',
  'presentation',
  'pdf',
])
export const officeFileState = pgEnum('office_file_state', ['active', 'archived'])

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => Uint8Array.from(value),
})

export const workspace = pgTable('workspace', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const applet = pgTable(
  'applet',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    medium: appletMedium('medium').notNull(),
    state: appletState('state').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('applet_workspace_id_id_unique').on(table.workspaceId, table.id),
    index('applet_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
  ],
)

export const officeFile = pgTable(
  'office_file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    medium: officeFileMedium('medium').notNull(),
    state: officeFileState('state').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('office_file_workspace_id_unique').on(table.workspaceId, table.id),
    index('office_file_workspace_updated_idx').on(table.workspaceId, table.updatedAt),
    check('office_file_name_length_check', sql`char_length(${table.name}) between 1 and 160`),
  ],
)

export const officeFileVersion = pgTable(
  'office_file_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    fileId: uuid('file_id').notNull(),
    version: integer('version').notNull(),
    bytes: bytea('bytes').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    note: text('note').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('office_file_version_workspace_file_id_unique').on(
      table.workspaceId,
      table.fileId,
      table.id,
    ),
    unique('office_file_version_number_unique').on(
      table.workspaceId,
      table.fileId,
      table.version,
    ),
    index('office_file_version_workspace_file_created_idx').on(
      table.workspaceId,
      table.fileId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.workspaceId, table.fileId],
      foreignColumns: [officeFile.workspaceId, officeFile.id],
      name: 'office_file_version_file_tenant_fk',
    }).onDelete('cascade'),
    check('office_file_version_number_check', sql`${table.version} > 0`),
    check(
      'office_file_version_size_check',
      sql`${table.size} = octet_length(${table.bytes}) and ${table.size} between 1 and 26214400`,
    ),
    check('office_file_version_sha256_check', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
)

export const appletVersion = pgTable(
  'applet_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    appletId: uuid('applet_id').notNull(),
    version: integer('version').notNull(),
    state: versionState('state').notNull().default('draft'),
    note: text('note').notNull(),
    inputs: jsonb('inputs').$type<InputDefinition>().notNull(),
    definition: jsonb('definition').$type<AppletVersionDefinition>().notNull(),
    artifact: jsonb('artifact').$type<WebAppArtifact>(),
    qualityReport: jsonb('quality_report').$type<QualityReport>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('applet_version_workspace_applet_id_unique').on(
      table.workspaceId,
      table.appletId,
      table.id,
    ),
    unique('applet_version_number_unique').on(table.workspaceId, table.appletId, table.version),
    foreignKey({
      columns: [table.workspaceId, table.appletId],
      foreignColumns: [applet.workspaceId, applet.id],
      name: 'applet_version_applet_tenant_fk',
    }).onDelete('cascade'),
  ],
)

export const appletDeployment = pgTable(
  'applet_deployment',
  {
    workspaceId: uuid('workspace_id').notNull(),
    appletId: uuid('applet_id').notNull(),
    versionId: uuid('version_id').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.appletId] }),
    foreignKey({
      columns: [table.workspaceId, table.appletId],
      foreignColumns: [applet.workspaceId, applet.id],
      name: 'applet_deployment_applet_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId, table.appletId, table.versionId],
      foreignColumns: [
        appletVersion.workspaceId,
        appletVersion.appletId,
        appletVersion.id,
      ],
      name: 'applet_deployment_version_tenant_fk',
    }).onDelete('cascade'),
  ],
)

export const evaluationSuite = pgTable(
  'evaluation_suite',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    appletId: uuid('applet_id').notNull(),
    revision: integer('revision').notNull(),
    name: text('name').notNull(),
    cases: jsonb('cases').$type<EvaluationCaseDefinition[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('evaluation_suite_workspace_applet_id_unique').on(
      table.workspaceId,
      table.appletId,
      table.id,
    ),
    unique('evaluation_suite_revision_unique').on(
      table.workspaceId,
      table.appletId,
      table.revision,
    ),
    foreignKey({
      columns: [table.workspaceId, table.appletId],
      foreignColumns: [applet.workspaceId, applet.id],
      name: 'evaluation_suite_applet_tenant_fk',
    }).onDelete('cascade'),
  ],
)

export const evaluationRun = pgTable(
  'evaluation_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    appletId: uuid('applet_id').notNull(),
    candidateVersionId: uuid('candidate_version_id').notNull(),
    baselineVersionId: uuid('baseline_version_id'),
    suiteId: uuid('suite_id').notNull(),
    state: evaluationRunState('state').notNull().default('running'),
    report: jsonb('report').$type<EvaluationReport>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    unique('evaluation_run_workspace_id_unique').on(table.workspaceId, table.id),
    index('evaluation_run_workspace_applet_created_idx').on(
      table.workspaceId,
      table.appletId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.workspaceId, table.appletId],
      foreignColumns: [applet.workspaceId, applet.id],
      name: 'evaluation_run_applet_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId, table.appletId, table.suiteId],
      foreignColumns: [
        evaluationSuite.workspaceId,
        evaluationSuite.appletId,
        evaluationSuite.id,
      ],
      name: 'evaluation_run_suite_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId, table.appletId, table.candidateVersionId],
      foreignColumns: [
        appletVersion.workspaceId,
        appletVersion.appletId,
        appletVersion.id,
      ],
      name: 'evaluation_run_candidate_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId, table.appletId, table.baselineVersionId],
      foreignColumns: [
        appletVersion.workspaceId,
        appletVersion.appletId,
        appletVersion.id,
      ],
      name: 'evaluation_run_baseline_tenant_fk',
    }).onDelete('cascade'),
  ],
)

export const appletRun = pgTable(
  'applet_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    appletId: uuid('applet_id').notNull(),
    appletVersionId: uuid('applet_version_id').notNull(),
    state: runState('state').notNull().default('queued'),
    input: jsonb('input').$type<JsonObject>().notNull(),
    output: jsonb('output').$type<WebAppRunOutput>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    unique('applet_run_workspace_id_id_unique').on(table.workspaceId, table.id),
    index('applet_run_workspace_applet_created_idx').on(
      table.workspaceId,
      table.appletId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.workspaceId, table.appletId, table.appletVersionId],
      foreignColumns: [
        appletVersion.workspaceId,
        appletVersion.appletId,
        appletVersion.id,
      ],
      name: 'applet_run_version_tenant_fk',
    }).onDelete('cascade'),
  ],
)

export const appletValue = pgTable(
  'applet_value',
  {
    workspaceId: uuid('workspace_id').notNull(),
    appletId: uuid('applet_id').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').$type<JsonValue>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.appletId, table.key] }),
    foreignKey({
      columns: [table.workspaceId, table.appletId],
      foreignColumns: [applet.workspaceId, applet.id],
      name: 'applet_value_applet_tenant_fk',
    }).onDelete('cascade'),
  ],
)

export const correction = pgTable(
  'correction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    appletId: uuid('applet_id').notNull(),
    runId: uuid('run_id').notNull(),
    state: correctionState('state').notNull().default('proposed'),
    instruction: text('instruction').notNull(),
    observedIssue: text('observed_issue').notNull(),
    desiredOutcome: text('desired_outcome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('correction_workspace_applet_created_idx').on(
      table.workspaceId,
      table.appletId,
      table.createdAt,
    ),
    foreignKey({
      columns: [table.workspaceId, table.appletId],
      foreignColumns: [applet.workspaceId, applet.id],
      name: 'correction_applet_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.workspaceId, table.runId],
      foreignColumns: [appletRun.workspaceId, appletRun.id],
      name: 'correction_run_tenant_fk',
    }).onDelete('cascade'),
  ],
)
