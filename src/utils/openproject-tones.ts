import { t, type UiLocale } from '../i18n'
import type {
  OpenProjectPrincipalItem,
  OpenProjectTypeItem,
  OpenProjectWorkPackage
} from '../protocol'

export type SemanticTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
export type CardBackgroundTone =
  | 'none'
  | 'muted'
  | 'card'
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'

export interface VisualToneStyle {
  border: SemanticTone
  background: CardBackgroundTone
  textTone?: SemanticTone
}

export const DEFAULT_OPENPROJECT_TYPES: OpenProjectTypeItem[] = [
  { id: 1, name: 'Task', color: '#1A67A3', isDefault: true, isMilestone: false },
  { id: 2, name: 'Milestone', color: '#35C53F', isDefault: false, isMilestone: true },
  { id: 3, name: 'Phase', color: '#008BD0', isDefault: false, isMilestone: false },
  { id: 4, name: 'Feature', color: '#9775FA', isDefault: false, isMilestone: false },
  { id: 5, name: 'Epic', color: '#F0AD4E', isDefault: false, isMilestone: false },
  { id: 6, name: 'User story', color: '#748FFC', isDefault: false, isMilestone: false },
  { id: 7, name: 'Bug', color: '#D9534F', isDefault: false, isMilestone: false }
]

export const UNUSED_BOILERPLATE_STATUSES = new Set([
  'in specification',
  'specified',
  'confirmed',
  'to be scheduled',
  'scheduled'
])

export function isStatusClosedName(status: string): boolean {
  const s = status.toLowerCase().trim()
  return s === 'closed' || s === 'rejected' || s === 'resolved'
}

/**
 * Parses an OpenProject `#RRGGBB` hex color into RGB and maps it to the closest
 * Orca semantic border + background + text tone combination when custom names are used.
 */
export function classifyHexColorStyle(hex?: string): VisualToneStyle | null {
  if (!hex || typeof hex !== 'string') return null
  const clean = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null
  const r = Number.parseInt(clean.slice(0, 2), 16)
  const g = Number.parseInt(clean.slice(2, 4), 16)
  const b = Number.parseInt(clean.slice(4, 6), 16)

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  // Low saturation -> gray / silver / neutral
  if (delta < 25) {
    return { border: 'neutral', background: 'muted', textTone: 'neutral' }
  }

  // Red / Crimson
  if (r >= g + 45 && r >= b + 35) {
    return { border: 'danger', background: 'danger', textTone: 'danger' }
  }

  // Orange / Amber / Yellow
  if (r > 180 && g > 110 && b < 110) {
    return { border: 'warning', background: 'warning', textTone: 'warning' }
  }

  // Green / Emerald
  if (g >= r + 25 && g >= b + 15) {
    return { border: 'accent', background: 'success', textTone: 'success' }
  }

  // Purple / Magenta / Lavender
  if (r > 130 && b > 160 && g < 165) {
    return { border: 'accent', background: 'neutral', textTone: 'accent' }
  }

  // Pale Cyan / Ice Blue (e.g. Low priority #C5F6FA)
  if (r > 160 && g > 220 && b > 225) {
    return { border: 'neutral', background: 'card', textTone: 'neutral' }
  }

  // Blue / Teal / Cyan
  return { border: 'accent', background: 'accent', textTone: 'accent' }
}

/**
 * Maps an OpenProject status name (and optional `#RRGGBB` color) to a unique
 * `(border, background, textTone)` combination in Orca's declarative token system
 * so all 14 OpenProject statuses are visually distinct:
 * 1. `New`: (`border="neutral"`, `background="card"`)
 * 2. `In specification`: (`border="neutral"`, `background="accent"`)
 * 3. `Specified`: (`border="accent"`, `background="none"`)
 * 4. `Confirmed`: (`border="accent"`, `background="muted"`)
 * 5. `To be scheduled`: (`border="warning"`, `background="card"`)
 * 6. `Scheduled`: (`border="success"`, `background="card"`)
 * 7. `In progress`: (`border="accent"`, `background="accent"`)
 * 8. `Developed`: (`border="success"`, `background="success"`)
 * 9. `In testing`: (`border="success"`, `background="accent"`)
 * 10. `Tested`: (`border="accent"`, `background="success"`)
 * 11. `Test failed`: (`border="danger"`, `background="danger"`)
 * 12. `Closed`: (`border="neutral"`, `background="muted"`)
 * 13. `On hold`: (`border="warning"`, `background="warning"`)
 * 14. `Rejected`: (`border="danger"`, `background="card"`)
 */
export function getStatusToneStyle(status: string, hexColor?: string): VisualToneStyle {
  const s = status.toLowerCase().trim()

  if (s === 'new') {
    return { border: 'neutral', background: 'card', textTone: 'neutral' }
  }
  if (s === 'in specification') {
    return { border: 'neutral', background: 'accent', textTone: 'accent' }
  }
  if (s === 'specified') {
    return { border: 'accent', background: 'none', textTone: 'accent' }
  }
  if (s.includes('confirm')) {
    return { border: 'accent', background: 'muted', textTone: 'accent' }
  }
  if (s === 'to be scheduled') {
    return { border: 'warning', background: 'card', textTone: 'warning' }
  }
  if (s === 'scheduled') {
    return { border: 'success', background: 'card', textTone: 'success' }
  }
  if (s.includes('progress') || s.includes('review')) {
    return { border: 'accent', background: 'accent', textTone: 'accent' }
  }
  if (s === 'developed') {
    return { border: 'success', background: 'success', textTone: 'success' }
  }
  if (s.includes('testing')) {
    return { border: 'success', background: 'accent', textTone: 'success' }
  }
  if (s === 'tested') {
    return { border: 'accent', background: 'success', textTone: 'success' }
  }
  if (s.includes('fail') || s.includes('block')) {
    return { border: 'danger', background: 'danger', textTone: 'danger' }
  }
  if (s.includes('reject')) {
    return { border: 'danger', background: 'card', textTone: 'danger' }
  }
  if (s.includes('hold')) {
    return { border: 'warning', background: 'warning', textTone: 'warning' }
  }
  if (s === 'closed' || s === 'resolved') {
    return { border: 'neutral', background: 'muted', textTone: 'neutral' }
  }

  return (
    classifyHexColorStyle(hexColor) ?? {
      border: 'accent',
      background: 'accent',
      textTone: 'accent'
    }
  )
}

export function statusBadgeTone(status: string, hexColor?: string): SemanticTone {
  return getStatusToneStyle(status, hexColor).border
}

export function statusBorderTone(status: string, hexColor?: string): SemanticTone {
  return getStatusToneStyle(status, hexColor).border
}

export function statusCardBackground(status: string, hexColor?: string): CardBackgroundTone {
  return getStatusToneStyle(status, hexColor).background
}

/**
 * Maps an OpenProject priority name (and optional `#RRGGBB` color) to an OpenProject-faithful
 * visual style matching OpenProject's priority palette:
 * - `Low`: Subtle Slate (`border="neutral"`, `background="card"`, `textTone="neutral"`)
 * - `Normal`: Highlighted Accent (`border="accent"`, `background="accent"`, `textTone="accent"`)
 * - `High`: Amber / Orange (`border="warning"`, `background="warning"`, `textTone="warning"`)
 * - `Immediate`: Red / Crimson (`border="danger"`, `background="danger"`, `textTone="danger"`)
 */
export function getPriorityToneStyle(priority: string, hexColor?: string): VisualToneStyle {
  const p = priority.toLowerCase().trim()
  if (p.includes('immediate')) {
    return { border: 'danger', background: 'danger', textTone: 'danger' }
  }
  if (p.includes('high')) {
    return { border: 'warning', background: 'warning', textTone: 'warning' }
  }
  if (p.includes('low')) {
    return { border: 'neutral', background: 'card', textTone: 'neutral' }
  }
  if (p.includes('normal')) {
    return { border: 'accent', background: 'accent', textTone: 'accent' }
  }
  return (
    classifyHexColorStyle(hexColor) ?? {
      border: 'accent',
      background: 'accent',
      textTone: 'accent'
    }
  )
}

export function priorityBadgeTone(priority: string, hexColor?: string): SemanticTone {
  return getPriorityToneStyle(priority, hexColor).border
}

export function priorityBorderTone(priority: string, hexColor?: string): SemanticTone {
  return getPriorityToneStyle(priority, hexColor).border
}

export function priorityCardBackground(
  priority: string,
  hexColor?: string
): CardBackgroundTone {
  return getPriorityToneStyle(priority, hexColor).background
}

/**
 * Maps an OpenProject work package type (`Task`, `Milestone`, `Phase`, `Feature`, `Epic`,
 * `User story`, `Bug`) and optional `#RRGGBB` hex color to 7 distinct `(border, background)` styles.
 */
export function getTypeToneStyle(typeName: string, hexColor?: string): VisualToneStyle {
  const tName = typeName.toLowerCase().trim()
  if (tName.includes('hotfix')) {
    return { border: 'danger', background: 'card', textTone: 'danger' }
  }
  if (tName.includes('bug') || tName.includes('error') || tName.includes('incident')) {
    return { border: 'danger', background: 'danger', textTone: 'danger' }
  }
  if (tName.includes('epic')) {
    return { border: 'warning', background: 'warning', textTone: 'warning' }
  }
  if (tName.includes('milestone') || tName.includes('release')) {
    return { border: 'success', background: 'success', textTone: 'success' }
  }
  if (tName.includes('phase')) {
    return { border: 'success', background: 'card', textTone: 'success' }
  }
  if (tName.includes('feature')) {
    return { border: 'accent', background: 'muted', textTone: 'accent' }
  }
  if (tName.includes('story') || tName.includes('user story')) {
    return { border: 'neutral', background: 'accent', textTone: 'accent' }
  }
  if (tName.includes('task')) {
    return { border: 'accent', background: 'accent', textTone: 'accent' }
  }
  return (
    classifyHexColorStyle(hexColor) ?? {
      border: 'accent',
      background: 'accent',
      textTone: 'accent'
    }
  )
}

export function typeBorderTone(typeName: string, hexColor?: string): SemanticTone {
  return getTypeToneStyle(typeName, hexColor).border
}

export function typeCardBackground(typeName: string, hexColor?: string): CardBackgroundTone {
  return getTypeToneStyle(typeName, hexColor).background
}

export interface HierarchicalTicketRow {
  wp: OpenProjectWorkPackage
  depth: number
  childCount: number
  isCollapsed: boolean
}

export function buildHierarchicalTicketList(
  tickets: OpenProjectWorkPackage[],
  collapsedParentIds: number[]
): HierarchicalTicketRow[] {
  const ticketById = new Map<number, OpenProjectWorkPackage>()
  for (const t of tickets) {
    ticketById.set(t.id, t)
  }

  const childrenByParentId = new Map<number, OpenProjectWorkPackage[]>()
  const roots: OpenProjectWorkPackage[] = []

  for (const t of tickets) {
    if (t.parentId && t.parentId !== t.id && ticketById.has(t.parentId)) {
      const list = childrenByParentId.get(t.parentId) ?? []
      list.push(t)
      childrenByParentId.set(t.parentId, list)
    } else {
      roots.push(t)
    }
  }

  for (const [, children] of childrenByParentId) {
    children.sort((a, b) => a.id - b.id)
  }

  const collapsedSet = new Set<number>(collapsedParentIds)
  const visited = new Set<number>()
  const rows: HierarchicalTicketRow[] = []

  function visit(node: OpenProjectWorkPackage, depth: number): void {
    if (visited.has(node.id)) return
    visited.add(node.id)
    const directChildren = childrenByParentId.get(node.id) ?? []
    const totalChildCount = Math.max(
      directChildren.length,
      node.childIds ? node.childIds.length : 0
    )
    const isCollapsed = collapsedSet.has(node.id)
    rows.push({
      wp: node,
      depth,
      childCount: totalChildCount,
      isCollapsed
    })
    if (!isCollapsed && directChildren.length > 0) {
      for (const child of directChildren) {
        visit(child, depth + 1)
      }
    }
  }

  for (const root of roots) {
    visit(root, 0)
  }
  for (const t of tickets) {
    if (!visited.has(t.id)) {
      visit(t, 0)
    }
  }

  return rows
}

export function formatWorkPackageRowMeta(
  wp: OpenProjectWorkPackage,
  locale: UiLocale,
  childCount = 0
): string {
  const parts: string[] = []
  if (wp.type) {
    parts.push(wp.type)
  }
  if (wp.parentId) {
    parts.push(`↑ #${wp.parentId}`)
  }
  if (childCount > 0) {
    parts.push(t(locale, 'ticket.subtasksCountMeta', { count: childCount }))
  }
  if (wp.project) {
    parts.push(wp.project)
  }
  if (wp.status) {
    parts.push(wp.status)
  }
  if (wp.assignee && wp.assignee !== 'Unassigned') {
    parts.push(wp.assignee)
  } else {
    parts.push(t(locale, 'filters.unassigned'))
  }
  return parts.filter(Boolean).join(' · ')
}

export function formatShortDate(iso: string): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

export function extractHostLabel(baseUrl: string): string {
  if (!baseUrl) return 'unconfigured'
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

export function resolvePrincipalIdString(
  explicitId: number | undefined,
  displayName: string | undefined,
  principals: OpenProjectPrincipalItem[]
): string {
  if (explicitId && explicitId > 0) return String(explicitId)
  const clean = (displayName ?? '').trim().toLowerCase()
  if (!clean || clean === 'unassigned') return '0'
  const matched = principals.find((p) => p.name.trim().toLowerCase() === clean)
  return matched ? String(matched.id) : '0'
}
