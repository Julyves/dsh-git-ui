/**
 * 设置持久化的 zod 校验规则。
 *
 * 与 remote.ts 同一模式：wire/持久化边界用 zod 校验，未知字段被 strip。
 * 校验失败（损坏 / 旧版本 / 缺字段）→ 由 store 回退默认设置——宁可丢
 * 偏好，不可产出坏 UI（v1 → v2 的差异字段经 migrateSettings 补齐，
 * 不丢既有偏好）。
 */
import { z } from 'zod'
import { MAX_DIFF_FONT_SIZE, MAX_RECENT_COMMITS, MIN_DIFF_FONT_SIZE } from '../../contracts/settings.ts'

/** 设置开关布尔（宽松解析：非布尔一律回退 false 由后再归一？否——严格布尔）。
 * 校验失败即整体回退默认，字段级宽松反而掩盖损坏。 */
const boolSchema = z.boolean()

export const countsSettingsSchema = z.object({
  staged: boolSchema,
  modified: boolSchema,
  untracked: boolSchema,
})

export const pillSettingsSchema = z.object({
  dot: boolSchema,
  branch: boolSchema,
  counts: countsSettingsSchema,
  sync: boolSchema,
  // workRecord 为宽松可选(旧版数据缺字段),读取后经 migrateSettings 补齐默认。
  workRecord: boolSchema.optional(),
})

export const popupSettingsSchema = z.object({
  rootPath: boolSchema,
  statusBar: boolSchema,
  branchSwitcher: boolSchema,
  branchCreate: boolSchema,
  recentCommits: z.number().int().min(0).max(MAX_RECENT_COMMITS),
  changesList: boolSchema,
})

export const diffSettingsSchema = z.object({
  fontSize: z.number().int().min(MIN_DIFF_FONT_SIZE).max(MAX_DIFF_FONT_SIZE),
  syntaxHighlight: boolSchema,
  foldContext: boolSchema,
})

/**
 * 持久化设置本体（宽松形态）：diff 维度可选——旧版（v1）数据缺该字段，
 * 读取后统一经 migrateSettings 补齐默认值（幂等）。版本判定由解析方
 * （store.parseSettings）按信封 `v` 字段执行。
 */
export const gitUISettingsSchema = z.object({
  pill: pillSettingsSchema,
  popup: popupSettingsSchema,
  diff: diffSettingsSchema.optional(),
})

/** 持久化信封：版本号 + 设置本体（版本不匹配时回退默认，为将来迁移留门）。 */
export const settingsEnvelopeSchema = z.object({
  v: z.number().int(),
  settings: gitUISettingsSchema,
})
