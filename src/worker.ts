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
  mapHalProject,
  mapHalStatus,
  mapHalWorkPackage,
  normalizeBaseUrl,
  sanitizePathSegment
} from './openproject-api'
import type {
  OpenProjectActivity,
  OpenProjectConfigSummary,
  OpenProjectProject,
  OpenProjectStateSnapshot,
  OpenProjectStatusItem,
  OpenProjectWorkPackage
} from './protocol'

const STORAGE_KEYS = {
  CURRENT_USER: 'openproject.currentUser',
  PROJECTS: 'openproject.projects',
  WORK_PACKAGES: 'openproject.workPackages',
  STATUSES: 'openproject.statuses',
  SELECTED_TICKET_ID: 'openproject.selectedTicketId',
  ACTIVITIES_BY_TICKET: 'openproject.activitiesByTicket',
  LAST_SYNCED_AT: 'openproject.lastSyncedAt',
  LAST_ERROR: 'openproject.lastError',
  FALLBACK_TOKEN: 'openproject.fallbackToken'
} as const

const SECRET_TOKEN_KEY = 'openproject.apiToken'

const DEFAULT_STATUSES: OpenProjectStatusItem[] = [
  { id: 1, name: 'New', isClosed: false },
  { id: 7, name: 'In Progress', isClosed: false },
  { id: 10, name: 'In Review', isClosed: false },
  { id: 12, name: 'Closed', isClosed: true }
]

const liveCache: {
  currentUser: string
  projects: OpenProjectProject[] | null
  workPackages: OpenProjectWorkPackage[] | null
  statuses: OpenProjectStatusItem[] | null
  lastSyncedAt: number | null
  lastError: string | null
} = {
  currentUser: '',
  projects: null,
  workPackages: null,
  statuses: null,
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

function discoverLocalMcpEnv(): Record<string, string> {
  const discovered: Record<string, string> = {}
  try {
    const home = os.homedir()
    const claudePath = path.join(home, '.claude.json')
    if (fs.existsSync(claudePath)) {
      const parsed = JSON.parse(fs.readFileSync(claudePath, 'utf8'))
      const envObj =
        parsed?.mcpServers?.openproject?.env ??
        parsed?.mcpServers?.['openproject-ce']?.env
      if (envObj && typeof envObj === 'object') {
        for (const [k, v] of Object.entries(envObj)) {
          if (typeof v === 'string' && v.trim()) {
            discovered[k] = v.trim()
          }
        }
      }
    }
    const codexPath = path.join(home, '.codex', 'config.toml')
    if (fs.existsSync(codexPath) && (!discovered.OPENPROJECT_BASE_URL || !discovered.OPENPROJECT_API_TOKEN)) {
      const text = fs.readFileSync(codexPath, 'utf8')
      const matches = text.matchAll(/^(OPENPROJECT_[A-Z0-9_]+)\s*=\s*"([^"]*)"/gm)
      for (const m of matches) {
        if (!discovered[m[1]] && m[2].trim()) {
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

  const envBaseUrl =
    (typeof process !== 'undefined' &&
      (process.env?.OPENPROJECT_BASE_URL || process.env?.OPENPROJECT_URL)) ||
    localMcpEnv.OPENPROJECT_BASE_URL ||
    localMcpEnv.OPENPROJECT_URL ||
    ''
  const envToken =
    (typeof process !== 'undefined' &&
      (process.env?.OPENPROJECT_API_TOKEN || process.env?.OPENPROJECT_API_KEY)) ||
    localMcpEnv.OPENPROJECT_API_TOKEN ||
    localMcpEnv.OPENPROJECT_API_KEY ||
    ''
  const envReadProjects =
    (typeof process !== 'undefined' && process.env?.OPENPROJECT_READ_PROJECTS) ||
    localMcpEnv.OPENPROJECT_READ_PROJECTS ||
    '*'
  const envWriteProjects =
    (typeof process !== 'undefined' && process.env?.OPENPROJECT_WRITE_PROJECTS) ||
    localMcpEnv.OPENPROJECT_WRITE_PROJECTS ||
    '*'

  const rawBaseUrl =
    typeof settings.baseUrl === 'string' && settings.baseUrl.trim()
      ? settings.baseUrl
      : envBaseUrl
  const baseUrl = normalizeBaseUrl(rawBaseUrl)

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

  return {
    baseUrl,
    apiToken,
    tokenSource,
    readProjects,
    writeProjects,
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

async function readStoredActivitiesMap(
  orca: OrcaWorkerApi
): Promise<Record<string, OpenProjectActivity[]>> {
  const val = await orca.storage.get(STORAGE_KEYS.ACTIVITIES_BY_TICKET)
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as unknown as Record<string, OpenProjectActivity[]>)
    : {}
}

async function buildSnapshot(orca: OrcaWorkerApi): Promise<OpenProjectStateSnapshot> {
  const creds = await resolveCredentials(orca)
  const [
    currentUserRaw,
    projects,
    workPackages,
    statuses,
    selectedIdRaw,
    activitiesMap,
    lastSyncedRaw,
    lastErrRaw
  ] = await Promise.all([
    orca.storage.get(STORAGE_KEYS.CURRENT_USER),
    readStoredProjects(orca),
    readStoredWorkPackages(orca),
    readStoredStatuses(orca),
    orca.storage.get(STORAGE_KEYS.SELECTED_TICKET_ID),
    readStoredActivitiesMap(orca),
    orca.storage.get(STORAGE_KEYS.LAST_SYNCED_AT),
    orca.storage.get(STORAGE_KEYS.LAST_ERROR)
  ])

  const filteredProjects = projects.filter(
    (p) =>
      isProjectAllowed(p.identifier, creds.readProjects) ||
      isProjectAllowed(p.id, creds.readProjects)
  )

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
      ? filteredWorkPackages.find((wp) => wp.id === selectedId) ?? filteredWorkPackages[0] ?? null
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
    injectEnvOnAgentLaunch: creds.injectEnvOnAgentLaunch
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
    selectedTicket,
    activities,
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
  focusProject?: string
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
    const openFilter = encodeURIComponent(
      JSON.stringify([{ status_id: { operator: 'o', values: [] } }])
    )
    const sortIdDesc = encodeURIComponent(JSON.stringify([['id', 'desc']]))
    const sortUpdatedDesc = encodeURIComponent(JSON.stringify([['updatedAt', 'desc']]))

    const [meRes, projectsRes, statusesRes, globalOpenRes] = await Promise.all([
      fetchOpenProjectJson(creds, '/api/v3/users/me').catch(() => ({})),
      fetchOpenProjectJson(creds, '/api/v3/projects?pageSize=100'),
      fetchOpenProjectJson(creds, '/api/v3/statuses'),
      fetchOpenProjectJson(
        creds,
        `/api/v3/work_packages?pageSize=100&filters=${openFilter}&sortBy=${sortUpdatedDesc}`
      )
    ])

    const currentUser = typeof meRes?.name === 'string' ? meRes.name : ''

    const allMappedProjects: OpenProjectProject[] = Array.isArray(projectsRes._embedded?.elements)
      ? projectsRes._embedded.elements.map(mapHalProject)
      : []

    const projectIdToIdentifier = new Map<number, string>()
    for (const p of allMappedProjects) {
      projectIdToIdentifier.set(p.id, p.identifier)
    }

    const projects = allMappedProjects.filter(
      (p: OpenProjectProject) =>
        isProjectAllowed(p.identifier, creds.readProjects) ||
        isProjectAllowed(p.id, creds.readProjects)
    )

    // Also fetch project-specific open work packages (e.g. esg-vrg or selected project)
    // so projects with 89+ open tasks are completely populated
    const targetIdentifiers = new Set<string>()
    if (focusProject && focusProject !== 'all') {
      targetIdentifiers.add(focusProject)
    }
    if (projects.some((p) => p.identifier === 'esg-vrg')) {
      targetIdentifiers.add('esg-vrg')
    }

    const perProjectElements: Record<string, any>[] = []
    for (const ident of targetIdentifiers) {
      try {
        const safeSeg = sanitizePathSegment(ident, 'project')
        const projWpRes = await fetchOpenProjectJson(
          creds,
          `/api/v3/projects/${safeSeg}/work_packages?pageSize=100&filters=${openFilter}&sortBy=${sortIdDesc}`
        )
        if (Array.isArray(projWpRes._embedded?.elements)) {
          perProjectElements.push(...projWpRes._embedded.elements)
        }
      } catch {
        // Ignore individual project fetch errors
      }
    }

    const statuses = Array.isArray(statusesRes._embedded?.elements)
      ? statusesRes._embedded.elements.map(mapHalStatus)
      : DEFAULT_STATUSES

    const combinedRawElements = [
      ...perProjectElements,
      ...(Array.isArray(globalOpenRes._embedded?.elements)
        ? globalOpenRes._embedded.elements
        : [])
    ]

    const seenIds = new Set<number>()
    const workPackages: OpenProjectWorkPackage[] = []
    for (const raw of combinedRawElements) {
      if (!isHalWorkPackageProjectValid(raw)) continue
      const mapped = mapHalWorkPackage(raw, projectIdToIdentifier)
      if (!mapped.id || seenIds.has(mapped.id)) continue
      if (
        !isProjectAllowed(mapped.projectIdentifier, creds.readProjects) &&
        !isProjectAllowed(mapped.project, creds.readProjects)
      ) {
        continue
      }
      seenIds.add(mapped.id)
      workPackages.push(mapped)
    }

    workPackages.sort((a, b) => b.id - a.id)

    liveCache.currentUser = currentUser
    liveCache.projects = projects
    liveCache.statuses = statuses
    liveCache.workPackages = workPackages
    liveCache.lastSyncedAt = Date.now()
    liveCache.lastError = null

    await Promise.all([
      currentUser
        ? orca.storage.set(STORAGE_KEYS.CURRENT_USER, currentUser).catch(() => {})
        : Promise.resolve(),
      orca.storage.set(STORAGE_KEYS.PROJECTS, projects as unknown as any).catch(() => {}),
      orca.storage.set(STORAGE_KEYS.STATUSES, statuses as unknown as any).catch(() => {}),
      orca.storage
        .set(STORAGE_KEYS.WORK_PACKAGES, workPackages.slice(0, 35) as unknown as any)
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
    await syncFromRemoteIfConfigured(orca)
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

  orca.panels.handle('openproject.state.get', async () => {
    const creds = await resolveCredentials(orca)
    const existingWps = await readStoredWorkPackages(orca)
    if (
      existingWps.length === 0 ||
      (liveCache.lastSyncedAt === null &&
        creds.baseUrl &&
        creds.baseUrl !== 'https://openproject.example.com')
    ) {
      await syncFromRemoteIfConfigured(orca)
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
    await syncFromRemoteIfConfigured(orca)
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
    if (input?.refresh) {
      await syncFromRemoteIfConfigured(orca)
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
    if (
      projectFilter &&
      projectFilter !== 'all' &&
      creds.baseUrl &&
      creds.baseUrl !== 'https://openproject.example.com'
    ) {
      await syncFromRemoteIfConfigured(orca, projectFilter)
      await broadcastSnapshot(orca)
    }
    const allWorkPackages = await readStoredWorkPackages(orca)
    const statusFilter = input?.status?.trim().toLowerCase()
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
    const existing = workPackages.find((wp) => wp.id === id)
    if (!existing) {
      throw new Error(`Work package #${id} not found in accessible projects.`)
    }
    if (
      !isProjectAllowed(existing.projectIdentifier, creds.readProjects) &&
      !isProjectAllowed(existing.project, creds.readProjects)
    ) {
      throw new Error(`Project '${existing.projectIdentifier}' is not in readProjects allowlist.`)
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

    const changes: Record<string, { from?: string; to: string }> = {}
    if (typeof input.subject === 'string' && input.subject.trim() && input.subject.trim() !== target.subject) {
      changes.subject = { from: target.subject, to: input.subject.trim() }
    }
    if (typeof input.status === 'string' && input.status.trim() && input.status.trim() !== target.status) {
      changes.status = { from: target.status, to: input.status.trim() }
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
      description: changes.description ? changes.description.to : target.description,
      updatedAt: new Date().toISOString(),
      lockVersion: target.lockVersion + 1
    }

    if (
      creds.baseUrl &&
      creds.apiToken &&
      creds.baseUrl !== 'https://openproject.example.com' &&
      typeof fetch === 'function'
    ) {
      const statuses = await readStoredStatuses(orca)
      const patchBody: Record<string, any> = {
        lockVersion: target.lockVersion
      }
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
          patchBody._links = {
            status: { href: `/api/v3/statuses/${matchedStatus.id}` }
          }
        }
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
        updated = mapHalWorkPackage(remoteUpdated)
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
    await orca.storage
      .set(STORAGE_KEYS.WORK_PACKAGES, nextWorkPackages.slice(0, 35) as unknown as any)
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

    const changes: Record<string, { from?: string; to: string }> = {
      project: { to: projectIdentifier },
      subject: { to: input.subject.trim() },
      type: { to: input.typeName?.trim() || 'Task' }
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
    const projects = await readStoredProjects(orca)
    const matchedProject = projects.find(
      (p) => p.identifier.toLowerCase() === projectIdentifier.toLowerCase()
    )
    const nextId =
      workPackages.reduce((maxId, wp) => (wp.id > maxId ? wp.id : maxId), 1000) + 1

    let created: OpenProjectWorkPackage = {
      id: nextId,
      subject: input.subject.trim(),
      description: input.description?.trim() ?? '',
      status: 'New',
      statusId: 1,
      type: input.typeName?.trim() || 'Task',
      priority: 'Normal',
      project: matchedProject?.name ?? projectIdentifier,
      projectIdentifier: matchedProject?.identifier ?? projectIdentifier,
      assignee: 'Unassigned',
      updatedAt: new Date().toISOString(),
      lockVersion: 0
    }

    if (
      creds.baseUrl &&
      creds.apiToken &&
      creds.baseUrl !== 'https://openproject.example.com' &&
      typeof fetch === 'function'
    ) {
      const targetProjSeg = matchedProject?.identifier ?? projectIdentifier
      const remoteCreated = await fetchOpenProjectJson(
        creds,
        `/api/v3/projects/${targetProjSeg}/work_packages`,
        {
          method: 'POST',
          body: JSON.stringify({
            subject: input.subject.trim(),
            description: { raw: input.description?.trim() ?? '' },
            _links: {
              type: { href: '/api/v3/types/1' }
            }
          })
        }
      )
      created = mapHalWorkPackage(remoteCreated)
      created.projectIdentifier = matchedProject?.identifier ?? projectIdentifier
    }

    const nextWorkPackages = [created, ...workPackages]
    liveCache.workPackages = nextWorkPackages
    await Promise.all([
      orca.storage
        .set(STORAGE_KEYS.WORK_PACKAGES, nextWorkPackages.slice(0, 35) as unknown as any)
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
}
