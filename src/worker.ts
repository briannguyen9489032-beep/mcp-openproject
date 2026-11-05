import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import {
  buildAgentTicketPrompt,
  buildBasicAuthHeader,
  formatWorktreeBranchSlug,
  isHalWorkPackageProjectValid,
  isProjectAllowed,
  mapHalActivity,
  mapHalPrincipal,
  mapHalPriority,
  mapHalProject,
  mapHalStatus,
  mapHalType,
  mapHalWorkPackage,
  normalizeBaseUrl,
  sanitizePathSegment
} from './openproject-api'
import type {
  DetectedAgentCli,
  OpenProjectActivity,
  OpenProjectConfigSummary,
  OpenProjectPrincipalItem,
  OpenProjectPriorityItem,
  OpenProjectProject,
  OpenProjectStateSnapshot,
  OpenProjectStatusItem,
  OpenProjectTypeItem,
  OpenProjectWorkPackage
} from './protocol'

const STORAGE_KEYS = {
  CURRENT_USER: 'openproject.currentUser',
  PROJECTS: 'openproject.projects',
  WORK_PACKAGES: 'openproject.workPackages',
  STATUSES: 'openproject.statuses',
  TYPES: 'openproject.types',
  PRIORITIES: 'openproject.priorities',
  PRINCIPALS: 'openproject.principals',
  SELECTED_TICKET_ID: 'openproject.selectedTicketId',
  ACTIVITIES_BY_TICKET: 'openproject.activitiesByTicket',
  LAST_SYNCED_AT: 'openproject.lastSyncedAt',
  LAST_ERROR: 'openproject.lastError',
  FALLBACK_TOKEN: 'openproject.fallbackToken',
  PAGE_SIZE: 'openproject.pageSize',
  FOCUS_PROJECT: 'openproject.projectFilter'
} as const

const METADATA_TTL_MS = 5 * 60 * 1000

function normalizePageSize(val: unknown): 50 | 100 | 200 {
  const num = Number(val)
  if (num === 50) return 50
  if (num === 200) return 200
  return 100
}

const SECRET_TOKEN_KEY = 'openproject.apiToken'

const DEFAULT_STATUSES: OpenProjectStatusItem[] = [
  { id: 1, name: 'New', color: '#1098AD', isClosed: false },
  { id: 7, name: 'In Progress', color: '#CC5DE8', isClosed: false },
  { id: 8, name: 'Developed', color: '#8CE99A', isClosed: false },
  { id: 9, name: 'In testing', color: '#22B8CF', isClosed: false },
  { id: 10, name: 'Tested', color: '#12B886', isClosed: false },
  { id: 12, name: 'Closed', color: '#DEE2E6', isClosed: true }
]

const DEFAULT_PRIORITIES: OpenProjectPriorityItem[] = [
  { id: 7, name: 'Low', color: '#C5F6FA', isDefault: false },
  { id: 8, name: 'Normal', color: '#74C0FC', isDefault: true },
  { id: 9, name: 'High', color: '#F59F00', isDefault: false },
  { id: 10, name: 'Immediate', color: '#FA5252', isDefault: false }
]

const DEFAULT_TYPES: OpenProjectTypeItem[] = [
  { id: 1, name: 'Task', color: '#1A67A3', isDefault: true, isMilestone: false },
  { id: 2, name: 'Milestone', color: '#35C53F', isDefault: false, isMilestone: true },
  { id: 3, name: 'Phase', color: '#008BD0', isDefault: false, isMilestone: false },
  { id: 4, name: 'Feature', color: '#9775FA', isDefault: false, isMilestone: false },
  { id: 5, name: 'Epic', color: '#F0AD4E', isDefault: false, isMilestone: false },
  { id: 6, name: 'User story', color: '#748FFC', isDefault: false, isMilestone: false },
  { id: 7, name: 'Bug', color: '#D9534F', isDefault: false, isMilestone: false }
]

const liveCache: {
  currentUser: string
  projects: OpenProjectProject[] | null
  workPackages: OpenProjectWorkPackage[] | null
  statuses: OpenProjectStatusItem[] | null
  types: OpenProjectTypeItem[] | null
  priorities: OpenProjectPriorityItem[] | null
  principals: OpenProjectPrincipalItem[] | null
  pageSize: 50 | 100 | 200
  focusProject: string | null
  lastMetadataSyncedAt: number | null
  lastSyncedAt: number | null
  lastError: string | null
} = {
  currentUser: '',
  projects: null,
  workPackages: null,
  statuses: null,
  types: null,
  priorities: null,
  principals: null,
  pageSize: 100,
  focusProject: null,
  lastMetadataSyncedAt: null,
  lastSyncedAt: null,
  lastError: null
}

interface ResolvedCredentials {
  baseUrl: string
  apiToken: string
  tokenSource: 'secrets' | 'storage' | 'env' | 'none'
  readProjects: string
  writeProjects: string
  defaultAgent: string
  mcpBinaryPath: string
  injectEnvOnAgentLaunch: boolean
}

const SUPPORTED_AGENT_CATALOG: ReadonlyArray<{
  id: string
  label: string
  binaries: string[]
}> = [
  { id: 'antigravity', label: 'Antigravity (agy)', binaries: ['agy', 'antigravity'] },
  { id: 'codex', label: 'Codex', binaries: ['codex'] },
  { id: 'claude', label: 'Claude Code', binaries: ['claude'] },
  { id: 'gemini', label: 'Gemini CLI', binaries: ['gemini'] },
  { id: 'opencode', label: 'OpenCode', binaries: ['opencode'] },
  { id: 'kilocode', label: 'KiloCode', binaries: ['kilocode'] },
  { id: 'cursor-agent', label: 'Cursor Agent', binaries: ['cursor-agent'] },
  { id: 'droid', label: 'Droid', binaries: ['droid'] },
  { id: 'omp', label: 'OMP', binaries: ['omp'] },
  { id: 'pi', label: 'Pi', binaries: ['pi'] },
  { id: 'grok', label: 'Grok', binaries: ['grok'] }
]

export function detectLocalAgentClis(): DetectedAgentCli[] {
  const searchDirs: string[] = []
  try {
    const home = os.homedir()
    const pathEnv = (typeof process !== 'undefined' && process.env?.PATH) || ''
    for (const seg of pathEnv.split(path.delimiter)) {
      if (seg.trim()) searchDirs.push(seg.trim())
    }
    searchDirs.push(
      path.join(home, '.local', 'bin'),
      path.join(home, '.cargo', 'bin'),
      path.join(home, '.gemini', 'antigravity-cli'),
      path.join(home, '.gemini', 'antigravity', 'bin')
    )
    if (typeof process !== 'undefined' && process.platform === 'win32') {
      const localAppData =
        process.env?.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
      const appData =
        process.env?.APPDATA || path.join(home, 'AppData', 'Roaming')
      searchDirs.push(
        path.join(localAppData, 'agy', 'bin'),
        path.join(localAppData, 'Programs', 'Antigravity', 'bin'),
        path.join(appData, 'npm')
      )
    }
  } catch {
    // Fallback to static catalog when filesystem introspection is restricted
  }

  const isWin = typeof process !== 'undefined' && process.platform === 'win32'
  const exts = isWin ? ['', '.exe', '.cmd', '.bat', '.ps1'] : ['']

  const findBinary = (candidates: string[]): string | undefined => {
    for (const binName of candidates) {
      for (const dir of searchDirs) {
        for (const ext of exts) {
          const full = path.join(dir, `${binName}${ext}`)
          try {
            if (fs.existsSync(full) && fs.statSync(full).isFile()) {
              return full
            }
          } catch {
            // Ignore unreadable path entries
          }
        }
      }
    }
    return undefined
  }

  const detected = SUPPORTED_AGENT_CATALOG.map((entry) => {
    const binPath = findBinary(entry.binaries)
    return {
      id: entry.id,
      label: entry.label,
      installed: Boolean(binPath),
      ...(binPath ? { binPath } : {})
    }
  })

  // Sort installed agents first while preserving catalog order within each group
  return [
    ...detected.filter((a) => a.installed),
    ...detected.filter((a) => !a.installed)
  ]
}

function isPlaceholderEnvValue(val: string | undefined | null): boolean {
  if (!val) return true
  const lower = val.trim().toLowerCase()
  return (
    lower === '' ||
    lower === 'https://openproject.example.com' ||
    lower === 'http://openproject.example.com' ||
    lower === 'opapi-...' ||
    lower === 'opapi-your-token' ||
    lower.startsWith('<your_')
  )
}

function discoverLocalMcpEnv(): Record<string, string> {
  const discovered: Record<string, string> = {}
  try {
    const home = os.homedir()
    const jsonPaths = [
      path.join(home, '.claude.json'),
      path.join(home, '.gemini', 'config', 'mcp_config.json'),
      path.join(home, '.gemini', 'antigravity', 'mcp_config.json')
    ]
    for (const jsonPath of jsonPaths) {
      if (fs.existsSync(jsonPath)) {
        const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
        const envObj =
          parsed?.mcpServers?.openproject?.env ??
          parsed?.mcpServers?.['openproject-ce']?.env
        if (envObj && typeof envObj === 'object') {
          for (const [k, v] of Object.entries(envObj)) {
            if (typeof v === 'string' && !isPlaceholderEnvValue(v) && !discovered[k]) {
              discovered[k] = v.trim()
            }
          }
        }
      }
    }
    const codexPath = path.join(home, '.codex', 'config.toml')
    if (fs.existsSync(codexPath) && (!discovered.OPENPROJECT_BASE_URL || !discovered.OPENPROJECT_API_TOKEN)) {
      const text = fs.readFileSync(codexPath, 'utf8')
      const matches = text.matchAll(/^(OPENPROJECT_[A-Z0-9_]+)\s*=\s*"([^"]*)"/gm)
      for (const m of matches) {
        if (!discovered[m[1]] && !isPlaceholderEnvValue(m[2])) {
          discovered[m[1]] = m[2].trim()
        }
      }
    }
  } catch {
    // Ignore file discovery errors in restricted environments
  }
  return discovered
}

async function resolveCredentials(orca: OrcaWorkerApi): Promise<ResolvedCredentials> {
  const settings = (await orca.settings.get()) ?? {}
  const localMcpEnv = discoverLocalMcpEnv()

  const rawEnvBaseUrl =
    (typeof process !== 'undefined' &&
      (process.env?.OPENPROJECT_BASE_URL || process.env?.OPENPROJECT_URL)) ||
    localMcpEnv.OPENPROJECT_BASE_URL ||
    localMcpEnv.OPENPROJECT_URL ||
    ''
  const envBaseUrl = isPlaceholderEnvValue(rawEnvBaseUrl) ? '' : rawEnvBaseUrl

  const rawEnvToken =
    (typeof process !== 'undefined' &&
      (process.env?.OPENPROJECT_API_TOKEN || process.env?.OPENPROJECT_API_KEY)) ||
    localMcpEnv.OPENPROJECT_API_TOKEN ||
    localMcpEnv.OPENPROJECT_API_KEY ||
    ''
  const envToken = isPlaceholderEnvValue(rawEnvToken) ? '' : rawEnvToken

  const envReadProjects =
    (typeof process !== 'undefined' && process.env?.OPENPROJECT_READ_PROJECTS) ||
    localMcpEnv.OPENPROJECT_READ_PROJECTS ||
    '*'
  const envWriteProjects =
    (typeof process !== 'undefined' && process.env?.OPENPROJECT_WRITE_PROJECTS) ||
    localMcpEnv.OPENPROJECT_WRITE_PROJECTS ||
    '*'

  const settingsBaseUrl =
    typeof settings.baseUrl === 'string' && settings.baseUrl.trim()
      ? settings.baseUrl.trim()
      : ''

  const rawBaseUrl = settingsBaseUrl || envBaseUrl
  let baseUrl = normalizeBaseUrl(rawBaseUrl)

  const readProjects =
    typeof settings.readProjects === 'string' && settings.readProjects.trim() && settings.readProjects.trim() !== '*'
      ? settings.readProjects.trim()
      : envReadProjects

  const writeProjects =
    typeof settings.writeProjects === 'string' && settings.writeProjects.trim() && settings.writeProjects.trim() !== '*'
      ? settings.writeProjects.trim()
      : envWriteProjects

  const defaultAgent =
    typeof settings.defaultAgent === 'string' && settings.defaultAgent.trim()
      ? settings.defaultAgent.trim()
      : 'codex'

  const mcpBinaryPath =
    typeof settings.mcpBinaryPath === 'string' && settings.mcpBinaryPath.trim()
      ? settings.mcpBinaryPath.trim()
      : 'mcp-openproject'

  const injectEnvOnAgentLaunch =
    typeof settings.injectEnvOnAgentLaunch === 'boolean' ? settings.injectEnvOnAgentLaunch : true

  let apiToken = ''
  let tokenSource: 'secrets' | 'storage' | 'env' | 'none' = 'none'

  try {
    const secretVal = await orca.secrets.get(SECRET_TOKEN_KEY)
    if (typeof secretVal === 'string' && secretVal.trim()) {
      apiToken = secretVal.trim()
      tokenSource = 'secrets'
    }
  } catch {
    // Fallback when secrets keyring is unavailable
  }

  if (!apiToken) {
    const storedToken = await orca.storage.get(STORAGE_KEYS.FALLBACK_TOKEN)
    if (typeof storedToken === 'string' && storedToken.trim()) {
      apiToken = storedToken.trim()
      tokenSource = 'storage'
    }
  }

  if (!apiToken && envToken.trim()) {
    apiToken = envToken.trim()
    tokenSource = 'env'
  }

  if (!apiToken && isPlaceholderEnvValue(baseUrl)) {
    baseUrl = ''
  }

  return {
    baseUrl,
    apiToken,
    tokenSource,
    readProjects: readProjects || '*',
    writeProjects: writeProjects || '*',
    defaultAgent,
    mcpBinaryPath,
    injectEnvOnAgentLaunch
  }
}

async function readStoredProjects(orca: OrcaWorkerApi): Promise<OpenProjectProject[]> {
  if (liveCache.projects !== null) {
    return liveCache.projects
  }
  const val = await orca.storage.get(STORAGE_KEYS.PROJECTS)
  if (Array.isArray(val) && val.length > 0) {
    return val as unknown as OpenProjectProject[]
  }
  return []
}

async function readStoredWorkPackages(orca: OrcaWorkerApi): Promise<OpenProjectWorkPackage[]> {
  if (liveCache.workPackages !== null) {
    return liveCache.workPackages
  }
  const val = await orca.storage.get(STORAGE_KEYS.WORK_PACKAGES)
  if (Array.isArray(val) && val.length > 0) {
    return val as unknown as OpenProjectWorkPackage[]
  }
  return []
}

async function readStoredStatuses(orca: OrcaWorkerApi): Promise<OpenProjectStatusItem[]> {
  if (liveCache.statuses !== null && liveCache.statuses.length > 0) {
    return liveCache.statuses
  }
  const val = await orca.storage.get(STORAGE_KEYS.STATUSES)
  if (Array.isArray(val) && val.length > 0) {
    return val as unknown as OpenProjectStatusItem[]
  }
  return DEFAULT_STATUSES
}

async function readStoredPriorities(orca: OrcaWorkerApi): Promise<OpenProjectPriorityItem[]> {
  if (liveCache.priorities !== null && liveCache.priorities.length > 0) {
    return liveCache.priorities
  }
  const val = await orca.storage.get(STORAGE_KEYS.PRIORITIES)
  if (Array.isArray(val) && val.length > 0) {
    return val as unknown as OpenProjectPriorityItem[]
  }
  return DEFAULT_PRIORITIES
}

async function readStoredTypes(orca: OrcaWorkerApi): Promise<OpenProjectTypeItem[]> {
  if (liveCache.types !== null && liveCache.types.length > 0) {
    return liveCache.types
  }
  const val = await orca.storage.get(STORAGE_KEYS.TYPES)
  if (Array.isArray(val) && val.length > 0) {
    return val as unknown as OpenProjectTypeItem[]
  }
  return DEFAULT_TYPES
}

async function readStoredPrincipals(orca: OrcaWorkerApi): Promise<OpenProjectPrincipalItem[]> {
  if (liveCache.principals !== null && liveCache.principals.length > 0) {
    return liveCache.principals
  }
  const val = await orca.storage.get(STORAGE_KEYS.PRINCIPALS)
  if (Array.isArray(val) && val.length > 0) {
    return val as unknown as OpenProjectPrincipalItem[]
  }
  return []
}

async function readStoredActivitiesMap(
  orca: OrcaWorkerApi
): Promise<Record<string, OpenProjectActivity[]>> {
  const val = await orca.storage.get(STORAGE_KEYS.ACTIVITIES_BY_TICKET)
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as unknown as Record<string, OpenProjectActivity[]>)
    : {}
}

async function readStoredPageSize(orca: OrcaWorkerApi): Promise<50 | 100 | 200> {
  const val = await orca.storage.get(STORAGE_KEYS.PAGE_SIZE)
  if (val !== undefined && val !== null) {
    const normalized = normalizePageSize(val)
    liveCache.pageSize = normalized
    return normalized
  }
  return liveCache.pageSize
}

async function readStoredFocusProject(orca: OrcaWorkerApi): Promise<string> {
  if (liveCache.focusProject) {
    return liveCache.focusProject
  }
  const val = await orca.storage.get(STORAGE_KEYS.FOCUS_PROJECT)
  if (typeof val === 'string' && val.trim()) {
    liveCache.focusProject = val.trim()
    return liveCache.focusProject
  }
  return 'all'
}

async function buildSnapshot(orca: OrcaWorkerApi): Promise<OpenProjectStateSnapshot> {
  const creds = await resolveCredentials(orca)
  const [
    currentUserRaw,
    projects,
    workPackages,
    statuses,
    types,
    priorities,
    principals,
    selectedIdRaw,
    activitiesMap,
    lastSyncedRaw,
    lastErrRaw,
    pageSize,
    focusProject
  ] = await Promise.all([
    orca.storage.get(STORAGE_KEYS.CURRENT_USER),
    readStoredProjects(orca),
    readStoredWorkPackages(orca),
    readStoredStatuses(orca),
    readStoredTypes(orca),
    readStoredPriorities(orca),
    readStoredPrincipals(orca),
    orca.storage.get(STORAGE_KEYS.SELECTED_TICKET_ID),
    readStoredActivitiesMap(orca),
    orca.storage.get(STORAGE_KEYS.LAST_SYNCED_AT),
    orca.storage.get(STORAGE_KEYS.LAST_ERROR),
    readStoredPageSize(orca),
    readStoredFocusProject(orca)
  ])

  const filteredProjects = projects
    .filter(
      (p) =>
        isProjectAllowed(p.identifier, creds.readProjects) ||
        isProjectAllowed(p.id, creds.readProjects)
    )
    .map((p) => {
      const canWriteAllowlist =
        isProjectAllowed(p.identifier, creds.writeProjects) ||
        isProjectAllowed(p.id, creds.writeProjects)
      return {
        ...p,
        canCreateWorkPackage: p.canCreateWorkPackage !== false && canWriteAllowlist
      }
    })

  const filteredWorkPackages = workPackages.filter(
    (wp) =>
      isProjectAllowed(wp.projectIdentifier, creds.readProjects) ||
      isProjectAllowed(wp.project, creds.readProjects)
  )

  const selectedId =
    typeof selectedIdRaw === 'number'
      ? selectedIdRaw
      : filteredWorkPackages[0]?.id ?? null

  const selectedTicket =
    selectedId !== null
      ? filteredWorkPackages.find((wp) => wp.id === selectedId) ?? null
      : null

  const activities = selectedTicket ? activitiesMap[String(selectedTicket.id)] ?? [] : []

  const config: OpenProjectConfigSummary = {
    baseUrl: creds.baseUrl,
    hasToken: Boolean(creds.apiToken),
    tokenSource: creds.tokenSource,
    readProjects: creds.readProjects,
    writeProjects: creds.writeProjects,
    defaultAgent: creds.defaultAgent,
    mcpBinaryPath: creds.mcpBinaryPath,
    injectEnvOnAgentLaunch: creds.injectEnvOnAgentLaunch,
    pageSize,
    focusProject
  }

  return {
    config,
    currentUser:
      typeof currentUserRaw === 'string' && currentUserRaw
        ? currentUserRaw
        : liveCache.currentUser,
    projects: filteredProjects,
    workPackages: filteredWorkPackages,
    statuses,
    types,
    priorities,
    principals,
    selectedTicket,
    activities,
    detectedAgents: detectLocalAgentClis(),
    lastSyncedAt:
      typeof lastSyncedRaw === 'number' ? lastSyncedRaw : liveCache.lastSyncedAt,
    lastError: typeof lastErrRaw === 'string' ? lastErrRaw : liveCache.lastError
  }
}

async function broadcastSnapshot(orca: OrcaWorkerApi): Promise<OpenProjectStateSnapshot> {
  const snapshot = await buildSnapshot(orca)
  orca.panels.post('openproject.state.changed', snapshot)
  try {
    const openCount = snapshot.workPackages.filter(
      (wp) => !['closed', 'rejected', 'resolved'].includes(wp.status.toLowerCase())
    ).length
    const statusText = snapshot.config.baseUrl
      ? `OP: ${openCount} open`
      : 'OpenProject: Setup'
    await orca.host.call('statusBar.update', {
      id: 'openproject-status',
      text: statusText,
      tone: snapshot.lastError ? 'warning' : snapshot.config.hasToken ? 'accent' : 'neutral',
      tooltip: snapshot.lastError
        ? `OpenProject error: ${snapshot.lastError}`
        : snapshot.config.baseUrl
          ? `Connected to ${snapshot.config.baseUrl} (${openCount} open work packages)`
          : 'Configure OpenProject URL and API token in the OpenProject panel'
    })
  } catch {
    // Ignore status bar update errors in headless test environments
  }
  return snapshot
}

async function fetchOpenProjectJson(
  creds: ResolvedCredentials,
  pathStr: string,
  init?: RequestInit
): Promise<Record<string, any>> {
  if (!creds.baseUrl || !creds.apiToken) {
    throw new Error('OpenProject Base URL and API Token must be configured before calling remote API.')
  }
  if (pathStr.includes('://') || pathStr.startsWith('//') || pathStr.includes('..')) {
    throw new Error(`Refusing suspicious or cross-origin OpenProject API path: ${pathStr}`)
  }
  const baseParsed = new URL(creds.baseUrl)
  if (baseParsed.protocol !== 'http:' && baseParsed.protocol !== 'https:') {
    throw new Error(`Unsupported OpenProject Base URL scheme: ${baseParsed.protocol}`)
  }
  const url = `${creds.baseUrl}${pathStr.startsWith('/') ? pathStr : `/${pathStr}`}`
  const targetParsed = new URL(url)
  if (targetParsed.origin !== baseParsed.origin) {
    throw new Error('Cross-origin OpenProject API request blocked.')
  }
  const headers: Record<string, string> = {
    Accept: 'application/hal+json, application/json',
    Authorization: buildBasicAuthHeader(creds.apiToken),
    ...(init?.body ? { 'Content-Type': 'application/json' } : {})
  }
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    headers: {
      ...headers,
      ...((init?.headers as Record<string, string>) ?? {})
    }
  })
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw new Error(`OpenProject API ${response.status}: ${bodyText.slice(0, 240) || response.statusText}`)
  }
  if (response.status === 204) return {}
  return (await response.json()) as Record<string, any>
}

async function syncFromRemoteIfConfigured(
  orca: OrcaWorkerApi,
  focusProject?: string,
  requestedPageSize?: number,
  forceMetadata = false,
  includeClosed = false
): Promise<void> {
  const creds = await resolveCredentials(orca)
  if (
    !creds.baseUrl ||
    !creds.apiToken ||
    creds.baseUrl === 'https://openproject.example.com' ||
    typeof fetch !== 'function'
  ) {
    return
  }
  try {
    const effectivePageSize = requestedPageSize
      ? normalizePageSize(requestedPageSize)
      : await readStoredPageSize(orca)
    liveCache.pageSize = effectivePageSize

    const openFilter = encodeURIComponent(
      JSON.stringify([{ status_id: { operator: 'o', values: [] } }])
    )
    const closedFilter = encodeURIComponent(
      JSON.stringify([{ status_id: { operator: 'c', values: [] } }])
    )
    const sortIdDesc = encodeURIComponent(JSON.stringify([['id', 'desc']]))
    const sortUpdatedDesc = encodeURIComponent(JSON.stringify([['updatedAt', 'desc']]))

    const now = Date.now()
    const canReuseCachedMetadata =
      !forceMetadata &&
      liveCache.lastMetadataSyncedAt !== null &&
      now - liveCache.lastMetadataSyncedAt < METADATA_TTL_MS &&
      liveCache.projects !== null &&
      liveCache.projects.length > 0 &&
      liveCache.statuses !== null &&
      liveCache.types !== null &&
      liveCache.priorities !== null &&
      liveCache.principals !== null

    let currentUser = liveCache.currentUser
    let projects: OpenProjectProject[] = liveCache.projects ?? []
    let statuses: OpenProjectStatusItem[] = liveCache.statuses ?? DEFAULT_STATUSES
    let types: OpenProjectTypeItem[] = liveCache.types ?? DEFAULT_TYPES
    let priorities: OpenProjectPriorityItem[] = liveCache.priorities ?? DEFAULT_PRIORITIES
    let rawPrincipals: OpenProjectPrincipalItem[] = liveCache.principals ?? []
    const projectIdToIdentifier = new Map<number, string>()

    if (canReuseCachedMetadata) {
      for (const p of projects) {
        projectIdToIdentifier.set(p.id, p.identifier)
      }
    } else {
      const [meRes, projectsRes, statusesRes, typesRes, prioritiesRes, principalsRes] =
        await Promise.all([
          fetchOpenProjectJson(creds, '/api/v3/users/me').catch(() => ({})),
          fetchOpenProjectJson(creds, '/api/v3/projects?pageSize=100'),
          fetchOpenProjectJson(creds, '/api/v3/statuses'),
          fetchOpenProjectJson(creds, '/api/v3/types').catch(() => ({})),
          fetchOpenProjectJson(creds, '/api/v3/priorities').catch(() => ({})),
          fetchOpenProjectJson(creds, '/api/v3/principals?pageSize=100').catch(() => ({}))
        ])

      currentUser = typeof meRes?.name === 'string' ? meRes.name : ''
      const allMappedProjects: OpenProjectProject[] = Array.isArray(
        projectsRes._embedded?.elements
      )
        ? projectsRes._embedded.elements.map(mapHalProject)
        : []

      for (const p of allMappedProjects) {
        projectIdToIdentifier.set(p.id, p.identifier)
      }

      projects = allMappedProjects.filter(
        (p: OpenProjectProject) =>
          isProjectAllowed(p.identifier, creds.readProjects) ||
          isProjectAllowed(p.id, creds.readProjects)
      )

      statuses = Array.isArray(statusesRes._embedded?.elements)
        ? statusesRes._embedded.elements.map(mapHalStatus)
        : DEFAULT_STATUSES

      types = Array.isArray(typesRes._embedded?.elements)
        ? typesRes._embedded.elements.map(mapHalType)
        : DEFAULT_TYPES

      priorities = Array.isArray(prioritiesRes._embedded?.elements)
        ? prioritiesRes._embedded.elements.map(mapHalPriority)
        : DEFAULT_PRIORITIES

      rawPrincipals = Array.isArray(principalsRes._embedded?.elements)
        ? principalsRes._embedded.elements
            .map(mapHalPrincipal)
            .filter((u) => u.id > 0 && u.name)
        : []

      liveCache.lastMetadataSyncedAt = now
    }

    // Fetch work packages with the user-selected pageSize (50, 100, or 200)
    if (focusProject) {
      liveCache.focusProject = focusProject
      await orca.storage.set(STORAGE_KEYS.FOCUS_PROJECT, focusProject).catch(() => {})
    }
    const storedFocus = focusProject || (await readStoredFocusProject(orca))
    const isSpecificProject = Boolean(storedFocus && storedFocus !== 'all')
    let primaryProjectElements: Record<string, any>[] = []
    let secondaryGlobalElements: Record<string, any>[] = []

    if (isSpecificProject && storedFocus) {
      const matchedProj = projects.find(
        (p) =>
          p.identifier.toLowerCase() === storedFocus.toLowerCase() ||
          p.name.toLowerCase() === storedFocus.toLowerCase() ||
          String(p.id) === storedFocus
      )
      const safeSeg = sanitizePathSegment(
        matchedProj?.identifier ?? storedFocus,
        'project'
      )
      const [projOpenRes, projClosedRes, globalOpenRes] = await Promise.all([
        fetchOpenProjectJson(
          creds,
          `/api/v3/projects/${safeSeg}/work_packages?pageSize=${effectivePageSize}&filters=${openFilter}&sortBy=${sortIdDesc}`
        ),
        includeClosed
          ? fetchOpenProjectJson(
              creds,
              `/api/v3/projects/${safeSeg}/work_packages?pageSize=${effectivePageSize}&filters=${closedFilter}&sortBy=${sortIdDesc}`
            ).catch(() => ({}))
          : Promise.resolve({ _embedded: { elements: [] } }),
        liveCache.workPackages && liveCache.workPackages.length > 0
          ? Promise.resolve({ _embedded: { elements: [] } })
          : fetchOpenProjectJson(
              creds,
              `/api/v3/work_packages?pageSize=${effectivePageSize}&filters=${openFilter}&sortBy=${sortUpdatedDesc}`
            ).catch(() => ({}))
      ])
      primaryProjectElements = [
        ...(Array.isArray(projOpenRes._embedded?.elements)
          ? projOpenRes._embedded.elements
          : []),
        ...(Array.isArray(projClosedRes._embedded?.elements)
          ? projClosedRes._embedded.elements
          : [])
      ]
      secondaryGlobalElements = Array.isArray(globalOpenRes._embedded?.elements)
        ? globalOpenRes._embedded.elements
        : []
    } else {
      const [globalOpenRes, globalClosedRes] = await Promise.all([
        fetchOpenProjectJson(
          creds,
          `/api/v3/work_packages?pageSize=${effectivePageSize}&filters=${openFilter}&sortBy=${sortIdDesc}`
        ),
        includeClosed
          ? fetchOpenProjectJson(
              creds,
              `/api/v3/work_packages?pageSize=${effectivePageSize}&filters=${closedFilter}&sortBy=${sortIdDesc}`
            ).catch(() => ({}))
          : Promise.resolve({ _embedded: { elements: [] } })
      ])
      primaryProjectElements = [
        ...(Array.isArray(globalOpenRes._embedded?.elements)
          ? globalOpenRes._embedded.elements
          : []),
        ...(Array.isArray(globalClosedRes._embedded?.elements)
          ? globalClosedRes._embedded.elements
          : [])
      ]
    }

    const statusColorById = new Map<number, string>()
    for (const s of statuses) {
      if (s.color) statusColorById.set(s.id, s.color)
    }
    const typeColorById = new Map<number, string>()
    for (const t of types) {
      if (t.color) typeColorById.set(t.id, t.color)
    }
    const priorityColorById = new Map<number, string>()
    for (const p of priorities) {
      if (p.color) priorityColorById.set(p.id, p.color)
    }

    const seenIds = new Set<number>()
    const primaryWorkPackages: OpenProjectWorkPackage[] = []
    for (const raw of primaryProjectElements) {
      if (!isHalWorkPackageProjectValid(raw)) continue
      const mapped = mapHalWorkPackage(
        raw,
        projectIdToIdentifier,
        statusColorById,
        priorityColorById,
        typeColorById
      )
      if (!mapped.id || seenIds.has(mapped.id)) continue
      if (
        !isProjectAllowed(mapped.projectIdentifier, creds.readProjects) &&
        !isProjectAllowed(mapped.project, creds.readProjects)
      ) {
        continue
      }
      seenIds.add(mapped.id)
      primaryWorkPackages.push(mapped)
    }
    primaryWorkPackages.sort((a, b) => b.id - a.id)
    const boundedPrimary = primaryWorkPackages.slice(0, effectivePageSize * 2)

    // Keep cached tasks from other projects after the focused project's full pageSize slice
    // so focused project tasks (#123..#820) are NEVER evicted by other projects' tasks!
    const secondaryWorkPackages: OpenProjectWorkPackage[] = []
    for (const raw of secondaryGlobalElements) {
      if (!isHalWorkPackageProjectValid(raw)) continue
      const mapped = mapHalWorkPackage(
        raw,
        projectIdToIdentifier,
        statusColorById,
        priorityColorById,
        typeColorById
      )
      if (!mapped.id || seenIds.has(mapped.id)) continue
      if (
        !isProjectAllowed(mapped.projectIdentifier, creds.readProjects) &&
        !isProjectAllowed(mapped.project, creds.readProjects)
      ) {
        continue
      }
      seenIds.add(mapped.id)
      secondaryWorkPackages.push(mapped)
    }
    if (isSpecificProject && liveCache.workPackages) {
      for (const existingWp of liveCache.workPackages) {
        if (!seenIds.has(existingWp.id)) {
          seenIds.add(existingWp.id)
          secondaryWorkPackages.push(existingWp)
        }
      }
    }
    secondaryWorkPackages.sort((a, b) => b.id - a.id)

    const boundedWorkPackages = isSpecificProject
      ? [...boundedPrimary, ...secondaryWorkPackages.slice(0, effectivePageSize)]
      : boundedPrimary

    // Cross-link parent <-> child relationships across all loaded work packages
    const wpById = new Map<number, OpenProjectWorkPackage>()
    for (const wp of boundedWorkPackages) {
      wpById.set(wp.id, wp)
    }
    for (const wp of boundedWorkPackages) {
      if (wp.parentId && wp.parentId > 0) {
        const parentWp = wpById.get(wp.parentId)
        if (parentWp) {
          if (!wp.parentSubject && parentWp.subject) {
            wp.parentSubject = parentWp.subject
          }
          const existingChildren = new Set<number>(parentWp.childIds ?? [])
          existingChildren.add(wp.id)
          parentWp.childIds = Array.from(existingChildren).sort((a, b) => a - b)
        }
      }
    }

    // Ensure any custom work package types discovered on tasks are included in types list
    const existingTypeNames = new Set(types.map((t) => t.name.toLowerCase().trim()))
    for (const wp of boundedWorkPackages) {
      const cleanType = (wp.type || '').trim()
      if (cleanType && !existingTypeNames.has(cleanType.toLowerCase())) {
        existingTypeNames.add(cleanType.toLowerCase())
        types.push({
          id: wp.typeId || types.length + 100,
          name: cleanType,
          color: wp.typeColor,
          isDefault: false,
          isMilestone: cleanType.toLowerCase().includes('milestone')
        })
      }
    }

    const principalById = new Map<number, OpenProjectPrincipalItem>()
    for (const p of rawPrincipals) {
      principalById.set(p.id, p)
    }
    for (const wp of boundedWorkPackages) {
      if (wp.assigneeId && wp.assignee && wp.assignee !== 'Unassigned') {
        principalById.set(wp.assigneeId, { id: wp.assigneeId, name: wp.assignee })
      }
      if (wp.responsibleId && wp.responsible && wp.responsible !== 'Unassigned') {
        principalById.set(wp.responsibleId, { id: wp.responsibleId, name: wp.responsible })
      }
    }
    const principals = Array.from(principalById.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    )

    liveCache.currentUser = currentUser
    liveCache.projects = projects
    liveCache.statuses = statuses
    liveCache.types = types
    liveCache.priorities = priorities
    liveCache.principals = principals
    liveCache.workPackages = boundedWorkPackages
    liveCache.lastSyncedAt = Date.now()
    liveCache.lastError = null

    await Promise.all([
      currentUser
        ? orca.storage.set(STORAGE_KEYS.CURRENT_USER, currentUser).catch(() => {})
        : Promise.resolve(),
      orca.storage.set(STORAGE_KEYS.PROJECTS, projects as unknown as any).catch(() => {}),
      orca.storage.set(STORAGE_KEYS.STATUSES, statuses as unknown as any).catch(() => {}),
      orca.storage.set(STORAGE_KEYS.TYPES, types as unknown as any).catch(() => {}),
      orca.storage.set(STORAGE_KEYS.PRIORITIES, priorities as unknown as any).catch(() => {}),
      orca.storage.set(STORAGE_KEYS.PRINCIPALS, principals as unknown as any).catch(() => {}),
      orca.storage.set(STORAGE_KEYS.PAGE_SIZE, String(effectivePageSize)).catch(() => {}),
      orca.storage
        .set(
          STORAGE_KEYS.WORK_PACKAGES,
          boundedWorkPackages.map((wp) => ({
            ...wp,
            description: wp.description.length > 600 ? `${wp.description.slice(0, 600)}…` : wp.description
          })) as unknown as any
        )
        .catch(() => {}),
      orca.storage.set(STORAGE_KEYS.LAST_SYNCED_AT, liveCache.lastSyncedAt).catch(() => {}),
      orca.storage.delete(STORAGE_KEYS.LAST_ERROR).catch(() => {})
    ])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    liveCache.lastError = message
    await orca.storage.set(STORAGE_KEYS.LAST_ERROR, message).catch(() => {})
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  liveCache.currentUser = ''
  liveCache.projects = null
  liveCache.workPackages = null
  liveCache.statuses = null
  liveCache.priorities = null
  liveCache.principals = null
  liveCache.pageSize = 100
  liveCache.focusProject = null
  liveCache.lastMetadataSyncedAt = null
  liveCache.lastSyncedAt = null
  liveCache.lastError = null

  // Automatically inject OpenProject MCP environment variables when Orca starts an agent CLI
  orca.hooks.on('agent.launch.before', async (event, next) => {
    const creds = await resolveCredentials(orca)
    if (!creds.injectEnvOnAgentLaunch || !creds.baseUrl || !creds.apiToken) {
      return next(event)
    }
    return next({
      ...event,
      env: {
        ...event.env,
        OPENPROJECT_BASE_URL: creds.baseUrl,
        OPENPROJECT_API_TOKEN: creds.apiToken,
        OPENPROJECT_READ_PROJECTS: creds.readProjects,
        OPENPROJECT_WRITE_PROJECTS: creds.writeProjects
      }
    })
  })

  orca.commands.register('openproject.refresh', async () => {
    await syncFromRemoteIfConfigured(orca, undefined, undefined, true)
    const snapshot = await broadcastSnapshot(orca)
    return `OpenProject synced (${snapshot.workPackages.length} work packages across ${snapshot.projects.length} projects).`
  })

  orca.commands.register('openproject.clearCache', async () => {
    await Promise.all([
      orca.storage.delete(STORAGE_KEYS.PROJECTS),
      orca.storage.delete(STORAGE_KEYS.WORK_PACKAGES),
      orca.storage.delete(STORAGE_KEYS.ACTIVITIES_BY_TICKET),
      orca.storage.delete(STORAGE_KEYS.SELECTED_TICKET_ID),
      orca.storage.delete(STORAGE_KEYS.LAST_SYNCED_AT),
      orca.storage.delete(STORAGE_KEYS.LAST_ERROR)
    ])
    await broadcastSnapshot(orca)
    return 'OpenProject local cache cleared.'
  })

  orca.panels.handle('openproject.state.get', async (input) => {
    const creds = await resolveCredentials(orca)
    const [existingWps, existingPrincipals] = await Promise.all([
      readStoredWorkPackages(orca),
      readStoredPrincipals(orca)
    ])
    const hasConfiguredRemote =
      Boolean(creds.baseUrl) &&
      Boolean(creds.apiToken) &&
      creds.baseUrl !== 'https://openproject.example.com'

    const hasLegacyTruncatedDesc = existingWps.some(
      (wp) =>
        (wp.description.length === 281 || wp.description.length === 601) &&
        wp.description.endsWith('…')
    )
    const storedFocus = await readStoredFocusProject(orca)
    const requestedProject =
      input?.project && input.project.trim() && input.project.trim() !== 'all'
        ? input.project.trim()
        : storedFocus
    const requestedPageSize = input?.pageSize

    if (
      (existingWps.length === 0 || existingPrincipals.length === 0 || hasLegacyTruncatedDesc) &&
      hasConfiguredRemote
    ) {
      await syncFromRemoteIfConfigured(orca, requestedProject, requestedPageSize)
    } else if (liveCache.lastSyncedAt === null && hasConfiguredRemote) {
      // Stale-while-revalidate: serve cached tasks immediately and refresh in background
      void syncFromRemoteIfConfigured(orca, requestedProject, requestedPageSize, true).then(
        () => broadcastSnapshot(orca)
      )
    }
    return await broadcastSnapshot(orca)
  })

  orca.panels.handle('openproject.config.save', async (input) => {
    const updates: Promise<unknown>[] = []
    if (typeof input.baseUrl === 'string') {
      updates.push(orca.settings.set('baseUrl', normalizeBaseUrl(input.baseUrl)))
    }
    if (typeof input.readProjects === 'string') {
      updates.push(orca.settings.set('readProjects', input.readProjects.trim() || '*'))
    }
    if (typeof input.writeProjects === 'string') {
      updates.push(orca.settings.set('writeProjects', input.writeProjects.trim() || '*'))
    }
    if (typeof input.defaultAgent === 'string' && input.defaultAgent.trim()) {
      updates.push(orca.settings.set('defaultAgent', input.defaultAgent.trim()))
    }
    if (typeof input.mcpBinaryPath === 'string' && input.mcpBinaryPath.trim()) {
      updates.push(orca.settings.set('mcpBinaryPath', input.mcpBinaryPath.trim()))
    }
    if (typeof input.injectEnvOnAgentLaunch === 'boolean') {
      updates.push(orca.settings.set('injectEnvOnAgentLaunch', input.injectEnvOnAgentLaunch))
    }
    if (input.pageSize !== undefined) {
      const normalized = normalizePageSize(input.pageSize)
      liveCache.pageSize = normalized
      updates.push(orca.storage.set(STORAGE_KEYS.PAGE_SIZE, String(normalized)))
    }
    if (typeof input.apiToken === 'string' && input.apiToken.trim()) {
      const trimmed = input.apiToken.trim()
      try {
        await orca.secrets.set(SECRET_TOKEN_KEY, trimmed)
        await orca.storage.delete(STORAGE_KEYS.FALLBACK_TOKEN)
      } catch {
        await orca.storage.set(STORAGE_KEYS.FALLBACK_TOKEN, trimmed)
      }
    }
    await Promise.all(updates)
    await orca.storage.delete(STORAGE_KEYS.LAST_ERROR)
    const currentFocus = await readStoredFocusProject(orca)
    await syncFromRemoteIfConfigured(orca, currentFocus, input.pageSize, true)
    return await broadcastSnapshot(orca)
  })

  orca.panels.handle('openproject.token.clear', async () => {
    try {
      await orca.secrets.delete(SECRET_TOKEN_KEY)
    } catch {
      // Ignore if keyring unavailable
    }
    await orca.storage.delete(STORAGE_KEYS.FALLBACK_TOKEN)
    return await broadcastSnapshot(orca)
  })

  orca.panels.handle('openproject.projects.list', async (input) => {
    if (input?.pageSize) {
      const normalized = normalizePageSize(input.pageSize)
      liveCache.pageSize = normalized
      await orca.storage.set(STORAGE_KEYS.PAGE_SIZE, String(normalized)).catch(() => {})
    }
    if (input?.refresh) {
      await syncFromRemoteIfConfigured(
        orca,
        input.project,
        input.pageSize,
        true
      )
    }
    const snapshot = await broadcastSnapshot(orca)
    return {
      projects: snapshot.projects,
      statuses: snapshot.statuses
    }
  })

  orca.panels.handle('openproject.workPackages.list', async (input) => {
    const creds = await resolveCredentials(orca)
    const projectFilter = input?.project?.trim().toLowerCase()
    const statusFilter = input?.status?.trim().toLowerCase()
    const wantClosed =
      statusFilter === 'closed' ||
      statusFilter === 'rejected' ||
      statusFilter === 'resolved'
    const requestedLimit = input?.limit ? normalizePageSize(input.limit) : undefined
    if (requestedLimit) {
      liveCache.pageSize = requestedLimit
      await orca.storage.set(STORAGE_KEYS.PAGE_SIZE, String(requestedLimit)).catch(() => {})
    }
    if (
      (projectFilter || requestedLimit || wantClosed) &&
      creds.baseUrl &&
      creds.baseUrl !== 'https://openproject.example.com'
    ) {
      await syncFromRemoteIfConfigured(
        orca,
        projectFilter || 'all',
        requestedLimit,
        false,
        wantClosed
      )
      await broadcastSnapshot(orca)
    }
    const allWorkPackages = await readStoredWorkPackages(orca)
    const queryFilter = input?.query?.trim().toLowerCase()
    const limit = input?.limit && input.limit > 0 ? input.limit : 100

    const filtered = allWorkPackages
      .filter(
        (wp) =>
          isProjectAllowed(wp.projectIdentifier, creds.readProjects) ||
          isProjectAllowed(wp.project, creds.readProjects)
      )
      .filter((wp) => {
        if (!projectFilter || projectFilter === 'all') return true
        return (
          wp.projectIdentifier.toLowerCase() === projectFilter ||
          wp.project.toLowerCase() === projectFilter
        )
      })
      .filter((wp) => {
        if (!statusFilter || statusFilter === 'all') return true
        const closed = ['closed', 'rejected', 'resolved'].includes(wp.status.toLowerCase())
        if (statusFilter === 'open') return !closed
        if (statusFilter === 'closed') return closed
        return wp.status.toLowerCase() === statusFilter
      })
      .filter((wp) => {
        if (!queryFilter) return true
        return (
          String(wp.id).includes(queryFilter) ||
          wp.subject.toLowerCase().includes(queryFilter) ||
          wp.description.toLowerCase().includes(queryFilter) ||
          wp.assignee.toLowerCase().includes(queryFilter)
        )
      })
      .slice(0, limit)

    return { workPackages: filtered }
  })

  orca.panels.handle('openproject.workPackages.get', async ({ id }) => {
    const creds = await resolveCredentials(orca)
    const workPackages = await readStoredWorkPackages(orca)
    const activitiesMap = await readStoredActivitiesMap(orca)
    const idx = workPackages.findIndex((wp) => wp.id === id)
    if (idx === -1) {
      throw new Error(`Work package #${id} not found in accessible projects.`)
    }
    let existing = workPackages[idx]
    if (
      !isProjectAllowed(existing.projectIdentifier, creds.readProjects) &&
      !isProjectAllowed(existing.project, creds.readProjects)
    ) {
      throw new Error(`Project '${existing.projectIdentifier}' is not in readProjects allowlist.`)
    }

    if (
      existing.description.endsWith('…') &&
      creds.baseUrl &&
      creds.apiToken &&
      creds.baseUrl !== 'https://openproject.example.com' &&
      typeof fetch === 'function'
    ) {
      try {
        const remoteWp = await fetchOpenProjectJson(creds, `/api/v3/work_packages/${id}`)
        const fullDesc = String(remoteWp?.description?.raw ?? '').trim()
        if (fullDesc) {
          existing = { ...existing, description: fullDesc.slice(0, 8000) }
          const nextWps = [...workPackages]
          nextWps[idx] = existing
          liveCache.workPackages = nextWps
        }
      } catch {
        // Keep cached description if remote detail fetch fails
      }
    }

    await orca.storage.set(STORAGE_KEYS.SELECTED_TICKET_ID, id)
    const activities = activitiesMap[String(id)] ?? []
    await broadcastSnapshot(orca)
    return { workPackage: existing, activities }
  })

  orca.panels.handle('openproject.workPackages.update', async (input) => {
    const creds = await resolveCredentials(orca)
    const workPackages = await readStoredWorkPackages(orca)
    const idx = workPackages.findIndex((wp) => wp.id === input.id)
    if (idx === -1) {
      throw new Error(`Work package #${input.id} not found.`)
    }
    const target = workPackages[idx]
    const canRead =
      isProjectAllowed(target.projectIdentifier, creds.readProjects) ||
      isProjectAllowed(target.project, creds.readProjects)
    const canWrite =
      isProjectAllowed(target.projectIdentifier, creds.writeProjects) ||
      isProjectAllowed(target.project, creds.writeProjects)
    if (!canRead || !canWrite) {
      throw new Error(
        `Guarded write blocked: project '${target.projectIdentifier}' is not in readProjects/writeProjects allowlist (${creds.writeProjects}).`
      )
    }

    const principals = await readStoredPrincipals(orca)
    const principalNameById = new Map<number, string>(principals.map((p) => [p.id, p.name]))

    const changes: Record<string, { from?: string; to: string }> = {}
    if (typeof input.subject === 'string' && input.subject.trim() && input.subject.trim() !== target.subject) {
      changes.subject = { from: target.subject, to: input.subject.trim() }
    }
    if (typeof input.status === 'string' && input.status.trim() && input.status.trim() !== target.status) {
      changes.status = { from: target.status, to: input.status.trim() }
    }
    if (input.assigneeId !== undefined) {
      const nextAssigneeId = input.assigneeId && input.assigneeId > 0 ? input.assigneeId : undefined
      const currentAssigneeId = target.assigneeId || undefined
      if (nextAssigneeId !== currentAssigneeId) {
        const nextName = nextAssigneeId
          ? principalNameById.get(nextAssigneeId) ?? `User #${nextAssigneeId}`
          : 'Unassigned'
        changes.assignee = { from: target.assignee || 'Unassigned', to: nextName }
      }
    }
    if (input.responsibleId !== undefined) {
      const nextRespId =
        input.responsibleId && input.responsibleId > 0 ? input.responsibleId : undefined
      const currentRespId = target.responsibleId || undefined
      if (nextRespId !== currentRespId) {
        const nextName = nextRespId
          ? principalNameById.get(nextRespId) ?? `User #${nextRespId}`
          : 'Unassigned'
        changes.responsible = { from: target.responsible || 'Unassigned', to: nextName }
      }
    }
    if (
      typeof input.description === 'string' &&
      input.description.trim() !== target.description
    ) {
      changes.description = { from: target.description, to: input.description.trim() }
    }
    if (typeof input.comment === 'string' && input.comment.trim()) {
      changes.comment = { to: input.comment.trim() }
    }

    const changeParts = Object.entries(changes).map(([k, v]) =>
      v.from !== undefined ? `${k}: "${v.from}" -> "${v.to}"` : `${k}: "${v.to}"`
    )
    const summary =
      changeParts.length > 0
        ? `Update #${target.id} (${changeParts.join(', ')})`
        : `No changes specified for #${target.id}`

    if (!input.confirm) {
      return {
        preview: true,
        confirmed: false,
        action: 'update_work_package',
        summary: `[PREVIEW] ${summary}. Pass confirm=true to execute.`,
        changes,
        workPackage: target
      }
    }

    let updated: OpenProjectWorkPackage = {
      ...target,
      subject: changes.subject ? changes.subject.to : target.subject,
      status: changes.status ? changes.status.to : target.status,
      assignee: changes.assignee ? changes.assignee.to : (target.assignee || 'Unassigned'),
      responsible: changes.responsible ? changes.responsible.to : (target.responsible || 'Unassigned'),
      description: changes.description ? changes.description.to : target.description,
      updatedAt: new Date().toISOString(),
      lockVersion: target.lockVersion + 1
    }
    if (input.assigneeId !== undefined) {
      if (input.assigneeId && input.assigneeId > 0) {
        updated.assigneeId = input.assigneeId
      } else {
        delete updated.assigneeId
      }
    }
    if (input.responsibleId !== undefined) {
      if (input.responsibleId && input.responsibleId > 0) {
        updated.responsibleId = input.responsibleId
      } else {
        delete updated.responsibleId
      }
    }

    if (
      creds.baseUrl &&
      creds.apiToken &&
      creds.baseUrl !== 'https://openproject.example.com' &&
      typeof fetch === 'function'
    ) {
      const statuses = await readStoredStatuses(orca)
      const priorities = await readStoredPriorities(orca)
      const statusColorById = new Map<number, string>()
      for (const s of statuses) {
        if (s.color) statusColorById.set(s.id, s.color)
      }
      const priorityColorById = new Map<number, string>()
      for (const p of priorities) {
        if (p.color) priorityColorById.set(p.id, p.color)
      }

      const patchBody: Record<string, any> = {
        lockVersion: target.lockVersion
      }
      const patchLinks: Record<string, any> = {}
      if (changes.subject) {
        patchBody.subject = changes.subject.to
      }
      if (changes.description) {
        patchBody.description = { raw: changes.description.to }
      }
      if (changes.status) {
        const matchedStatus = statuses.find(
          (s) => s.name.toLowerCase() === changes.status.to.toLowerCase()
        )
        if (matchedStatus) {
          patchLinks.status = { href: `/api/v3/statuses/${matchedStatus.id}` }
        }
      }
      if (changes.assignee) {
        const nextId = input.assigneeId && input.assigneeId > 0 ? input.assigneeId : null
        patchLinks.assignee = { href: nextId ? `/api/v3/users/${nextId}` : null }
      }
      if (changes.responsible) {
        const nextId = input.responsibleId && input.responsibleId > 0 ? input.responsibleId : null
        patchLinks.responsible = { href: nextId ? `/api/v3/users/${nextId}` : null }
      }
      if (Object.keys(patchLinks).length > 0) {
        patchBody._links = patchLinks
      }
      if (Object.keys(patchBody).length > 1) {
        const remoteUpdated = await fetchOpenProjectJson(
          creds,
          `/api/v3/work_packages/${target.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify(patchBody)
          }
        )
        updated = mapHalWorkPackage(
          remoteUpdated,
          undefined,
          statusColorById,
          priorityColorById
        )
        updated.projectIdentifier = target.projectIdentifier
      }
      if (changes.comment) {
        await fetchOpenProjectJson(creds, `/api/v3/work_packages/${target.id}/activities`, {
          method: 'POST',
          body: JSON.stringify({ comment: { raw: changes.comment.to } })
        })
      }
    }

    const nextWorkPackages = [...workPackages]
    nextWorkPackages[idx] = updated
    liveCache.workPackages = nextWorkPackages
    const currentPageSize = await readStoredPageSize(orca)
    await orca.storage
      .set(STORAGE_KEYS.WORK_PACKAGES, nextWorkPackages.slice(0, currentPageSize * 3) as unknown as any)
      .catch(() => {})

    if (changes.comment) {
      const activitiesMap = await readStoredActivitiesMap(orca)
      const list = activitiesMap[String(target.id)] ?? []
      const newActivity: OpenProjectActivity = {
        id: list.length + 1,
        user: 'Orca User',
        comment: changes.comment.to,
        createdAt: updated.updatedAt
      }
      activitiesMap[String(target.id)] = [...list, newActivity]
      await orca.storage.set(STORAGE_KEYS.ACTIVITIES_BY_TICKET, activitiesMap as unknown as any)
    }

    await broadcastSnapshot(orca)

    return {
      preview: false,
      confirmed: true,
      action: 'update_work_package',
      summary: `[CONFIRMED] ${summary}`,
      changes,
      workPackage: updated
    }
  })

  orca.panels.handle('openproject.workPackages.create', async (input) => {
    const creds = await resolveCredentials(orca)
    const projectIdentifier = sanitizePathSegment(input.project, 'project identifier')
    if (!input.subject || !input.subject.trim()) {
      throw new Error('Subject is required to create a work package.')
    }
    if (
      !isProjectAllowed(projectIdentifier, creds.readProjects) ||
      !isProjectAllowed(projectIdentifier, creds.writeProjects)
    ) {
      throw new Error(
        `Guarded write blocked: project '${projectIdentifier}' must be allowed by both readProjects (${creds.readProjects}) and writeProjects (${creds.writeProjects}).`
      )
    }

    const projects = await readStoredProjects(orca)
    const matchedProject = projects.find(
      (p) => p.identifier.toLowerCase() === projectIdentifier.toLowerCase()
    )
    if (matchedProject && matchedProject.canCreateWorkPackage === false) {
      throw new Error(
        `Permission denied: your OpenProject API token does not have 'Create work packages' permission in project '${matchedProject.name}'.`
      )
    }

    const principals = await readStoredPrincipals(orca)
    const priorities = await readStoredPriorities(orca)
    const principalNameById = new Map<number, string>(principals.map((p) => [p.id, p.name]))
    const priorityText = input.priorityName?.trim() || 'Normal'

    const changes: Record<string, { from?: string; to: string }> = {
      project: { to: projectIdentifier },
      subject: { to: input.subject.trim() },
      type: { to: input.typeName?.trim() || 'Task' },
      priority: { to: priorityText }
    }
    if (input.parentId && input.parentId > 0) {
      changes.parent = { to: `#${input.parentId}` }
    }
    if (input.assigneeId && input.assigneeId > 0) {
      changes.assignee = {
        to: principalNameById.get(input.assigneeId) ?? `User #${input.assigneeId}`
      }
    }
    if (input.responsibleId && input.responsibleId > 0) {
      changes.responsible = {
        to: principalNameById.get(input.responsibleId) ?? `User #${input.responsibleId}`
      }
    }
    if (input.description?.trim()) {
      changes.description = { to: input.description.trim() }
    }

    const summary = `Create ${changes.type.to} "${changes.subject.to}" in project ${projectIdentifier}`

    if (!input.confirm) {
      return {
        preview: true,
        confirmed: false,
        action: 'create_work_package',
        summary: `[PREVIEW] ${summary}. Pass confirm=true to execute.`,
        changes
      }
    }

    const workPackages = await readStoredWorkPackages(orca)
    const nextId =
      workPackages.reduce((maxId, wp) => (wp.id > maxId ? wp.id : maxId), 1000) + 1

    let created: OpenProjectWorkPackage = {
      id: nextId,
      subject: input.subject.trim(),
      description: input.description?.trim() ?? '',
      status: 'New',
      statusId: 1,
      type: input.typeName?.trim() || 'Task',
      priority: priorityText,
      project: matchedProject?.name ?? projectIdentifier,
      projectIdentifier: matchedProject?.identifier ?? projectIdentifier,
      assignee: changes.assignee?.to ?? 'Unassigned',
      responsible: changes.responsible?.to ?? 'Unassigned',
      updatedAt: new Date().toISOString(),
      lockVersion: 0
    }
    if (input.parentId && input.parentId > 0) {
      created.parentId = input.parentId
    }
    if (input.assigneeId && input.assigneeId > 0) {
      created.assigneeId = input.assigneeId
    }
    if (input.responsibleId && input.responsibleId > 0) {
      created.responsibleId = input.responsibleId
    }

    if (
      creds.baseUrl &&
      creds.apiToken &&
      creds.baseUrl !== 'https://openproject.example.com' &&
      typeof fetch === 'function'
    ) {
      const targetProjSeg = matchedProject?.identifier ?? projectIdentifier
      let resolvedTypeHref = '/api/v3/types/1'
      try {
        const typesRes = await fetchOpenProjectJson(
          creds,
          `/api/v3/projects/${targetProjSeg}/types`
        )
        if (Array.isArray(typesRes._embedded?.elements)) {
          const wantedType = (input.typeName?.trim() || 'Task').toLowerCase()
          const matchedType =
            typesRes._embedded.elements.find(
              (t: any) => String(t.name ?? '').toLowerCase() === wantedType
            ) ?? typesRes._embedded.elements[0]
          if (matchedType?.id) {
            resolvedTypeHref = `/api/v3/types/${matchedType.id}`
          }
        }
      } catch {
        // Fallback to default type /api/v3/types/1
      }

      const createLinks: Record<string, any> = {
        type: { href: resolvedTypeHref }
      }
      const matchedPriority = priorities.find(
        (p) => p.name.toLowerCase() === priorityText.toLowerCase()
      )
      if (matchedPriority?.id) {
        createLinks.priority = { href: `/api/v3/priorities/${matchedPriority.id}` }
      }
      if (input.parentId && input.parentId > 0) {
        createLinks.parent = { href: `/api/v3/work_packages/${input.parentId}` }
      }
      if (input.assigneeId && input.assigneeId > 0) {
        createLinks.assignee = { href: `/api/v3/users/${input.assigneeId}` }
      }
      if (input.responsibleId && input.responsibleId > 0) {
        createLinks.responsible = { href: `/api/v3/users/${input.responsibleId}` }
      }
      const remoteCreated = await fetchOpenProjectJson(
        creds,
        `/api/v3/projects/${targetProjSeg}/work_packages`,
        {
          method: 'POST',
          body: JSON.stringify({
            subject: input.subject.trim(),
            description: { raw: input.description?.trim() ?? '' },
            _links: createLinks
          })
        }
      )
      created = mapHalWorkPackage(remoteCreated)
      created.projectIdentifier = matchedProject?.identifier ?? projectIdentifier
    }

    const nextWorkPackages = [created, ...workPackages]
    liveCache.workPackages = nextWorkPackages
    const currentPageSize = await readStoredPageSize(orca)
    await Promise.all([
      orca.storage
        .set(
          STORAGE_KEYS.WORK_PACKAGES,
          nextWorkPackages.slice(0, currentPageSize) as unknown as any
        )
        .catch(() => {}),
      orca.storage.set(STORAGE_KEYS.SELECTED_TICKET_ID, created.id).catch(() => {})
    ])
    await broadcastSnapshot(orca)

    return {
      preview: false,
      confirmed: true,
      action: 'create_work_package',
      summary: `[CONFIRMED] Created #${created.id}: ${created.subject}`,
      changes,
      workPackage: created
    }
  })

  orca.panels.handle('openproject.agent.launch', async (input) => {
    const creds = await resolveCredentials(orca)
    const workPackages = await readStoredWorkPackages(orca)
    const ticket = workPackages.find((wp) => wp.id === input.ticketId)
    if (!ticket) {
      throw new Error(`Work package #${input.ticketId} not found.`)
    }
    if (
      !isProjectAllowed(ticket.projectIdentifier, creds.readProjects) &&
      !isProjectAllowed(ticket.project, creds.readProjects)
    ) {
      throw new Error(`Project '${ticket.projectIdentifier}' is not in readProjects allowlist.`)
    }

    let workspaceId = input.workspaceId?.trim() || ''
    if (!workspaceId) {
      const listRes = await orca.host.call('workspace.list', {})
      workspaceId = listRes.workspaces[0]?.id ?? 'default-workspace'
    }

    const agent = input.agent?.trim() || creds.defaultAgent || 'codex'
    const branchSlug = formatWorktreeBranchSlug(ticket.id, ticket.subject)
    const prompt = buildAgentTicketPrompt(ticket, branchSlug)

    const launchRes = await orca.host.call('agent.launch', {
      workspaceId,
      agent,
      prompt
    })

    await orca.host.call('notifications.show', {
      title: `Started ${agent} on #${ticket.id}`,
      body: `${ticket.subject} (${branchSlug})`
    })

    return {
      terminalId: launchRes.terminalId,
      workspaceId,
      branchSlug,
      agent
    }
  })

  orca.panels.handle('openproject.mcp.register', async (input) => {
    const creds = await resolveCredentials(orca)
    const agent = (input?.agent?.trim() || creds.defaultAgent || 'codex').toLowerCase()
    const home = os.homedir()
    const baseUrl = creds.baseUrl || ''
    const apiToken = creds.apiToken || ''
    const mcpBin = creds.mcpBinaryPath || 'mcp-openproject'
    const readAllow = creds.readProjects || '*'
    const writeAllow = creds.writeProjects || '*'

    const envMap: Record<string, string> = {
      OPENPROJECT_BASE_URL: baseUrl,
      OPENPROJECT_API_TOKEN: apiToken,
      OPENPROJECT_READ_PROJECTS: readAllow,
      OPENPROJECT_WRITE_PROJECTS: writeAllow
    }

    if (agent === 'antigravity' || agent === 'agy' || agent === 'gemini') {
      const configDir = path.join(home, '.gemini', 'config')
      const configPath = path.join(configDir, 'mcp_config.json')
      fs.mkdirSync(configDir, { recursive: true })
      let parsed: Record<string, any> = {}
      if (fs.existsSync(configPath)) {
        try {
          parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        } catch {
          parsed = {}
        }
      }
      if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
        parsed.mcpServers = {}
      }
      parsed.mcpServers.openproject = {
        command: mcpBin,
        args: [],
        env: envMap
      }
      fs.writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
      return {
        agent,
        configPath,
        summary: `Registered OpenProject MCP server in Antigravity config (${configPath}).`
      }
    }

    if (agent === 'claude') {
      const configPath = path.join(home, '.claude.json')
      let parsed: Record<string, any> = {}
      if (fs.existsSync(configPath)) {
        try {
          parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        } catch {
          parsed = {}
        }
      }
      if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
        parsed.mcpServers = {}
      }
      parsed.mcpServers.openproject = {
        command: mcpBin,
        env: envMap
      }
      fs.writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
      return {
        agent,
        configPath,
        summary: `Registered OpenProject MCP server in Claude Code (${configPath}).`
      }
    }

    const codexDir = path.join(home, '.codex')
    const configPath = path.join(codexDir, 'config.toml')
    fs.mkdirSync(codexDir, { recursive: true })
    const tomlBlock = [
      '[mcp_servers.openproject]',
      `command = "${mcpBin}"`,
      '',
      '[mcp_servers.openproject.env]',
      `OPENPROJECT_BASE_URL = "${baseUrl}"`,
      `OPENPROJECT_API_TOKEN = "${apiToken}"`,
      `OPENPROJECT_READ_PROJECTS = "${readAllow}"`,
      `OPENPROJECT_WRITE_PROJECTS = "${writeAllow}"`
    ].join('\n')

    let existing = ''
    if (fs.existsSync(configPath)) {
      existing = fs.readFileSync(configPath, 'utf8')
    }
    if (!existing.includes('[mcp_servers.openproject]')) {
      const nextContent = existing.trim() ? `${existing.trim()}\n\n${tomlBlock}\n` : `${tomlBlock}\n`
      fs.writeFileSync(configPath, nextContent, 'utf8')
    }
    return {
      agent,
      configPath,
      summary: `Registered OpenProject MCP server in Codex (${configPath}).`
    }
  })
}
