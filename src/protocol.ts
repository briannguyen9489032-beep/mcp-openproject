export interface OpenProjectStatusItem {
  id: number
  name: string
  color?: string
  isClosed: boolean
}

export interface OpenProjectPriorityItem {
  id: number
  name: string
  color?: string
  isDefault?: boolean
}

export interface OpenProjectTypeItem {
  id: number
  name: string
  color?: string
  isDefault?: boolean
  isMilestone?: boolean
}

export interface OpenProjectPrincipalItem {
  id: number
  name: string
}

export interface OpenProjectProject {
  id: number
  identifier: string
  name: string
  description: string
  canCreateWorkPackage?: boolean
}

export interface OpenProjectWorkPackage {
  id: number
  subject: string
  description: string
  status: string
  statusId: number
  statusColor?: string
  type: string
  typeId?: number
  typeColor?: string
  priority: string
  priorityId?: number
  priorityColor?: string
  project: string
  projectIdentifier: string
  assignee: string
  assigneeId?: number
  responsible?: string
  responsibleId?: number
  parentId?: number
  parentSubject?: string
  ancestorIds?: number[]
  childIds?: number[]
  updatedAt: string
  lockVersion: number
}

export interface OpenProjectActivity {
  id: number
  user: string
  comment: string
  createdAt: string
}

export interface DetectedAgentCli {
  id: string
  label: string
  installed: boolean
  binPath?: string
  mcpConfigPath?: string
  mcpSnippet?: string
}

export interface OpenProjectConfigSummary {
  baseUrl: string
  hasToken: boolean
  tokenSource: 'secrets' | 'storage' | 'env' | 'none'
  readProjects: string
  writeProjects: string
  defaultAgent: string
  mcpBinaryPath: string
  injectEnvOnAgentLaunch: boolean
  pageSize?: number
  focusProject?: string
}

export interface OpenProjectStateSnapshot {
  config: OpenProjectConfigSummary
  currentUser: string
  projects: OpenProjectProject[]
  workPackages: OpenProjectWorkPackage[]
  statuses: OpenProjectStatusItem[]
  types?: OpenProjectTypeItem[]
  priorities?: OpenProjectPriorityItem[]
  principals?: OpenProjectPrincipalItem[]
  selectedTicket: OpenProjectWorkPackage | null
  activities: OpenProjectActivity[]
  detectedAgents?: DetectedAgentCli[]
  lastSyncedAt: number | null
  lastError: string | null
}

export interface GuardedWriteResult<T = OpenProjectWorkPackage> {
  preview: boolean
  confirmed: boolean
  action: 'update_work_package' | 'create_work_package'
  summary: string
  changes: Record<string, { from?: string; to: string }>
  workPackage?: T
}

export interface LaunchAgentInput {
  ticketId: number
  agent?: string
  workspaceId?: string
}

export interface LaunchAgentOutput {
  terminalId: string
  workspaceId: string
  branchSlug: string
  agent: string
}

declare module 'orca' {
  interface PluginRequests {
    'openproject.state.get': {
      input?: { project?: string; pageSize?: number }
      output: OpenProjectStateSnapshot
    }
    'openproject.config.save': {
      input: {
        baseUrl?: string
        apiToken?: string
        readProjects?: string
        writeProjects?: string
        defaultAgent?: string
        mcpBinaryPath?: string
        injectEnvOnAgentLaunch?: boolean
        pageSize?: number
      }
      output: OpenProjectStateSnapshot
    }
    'openproject.token.clear': {
      output: OpenProjectStateSnapshot
    }
    'openproject.projects.list': {
      input?: { refresh?: boolean; pageSize?: number; project?: string }
      output: { projects: OpenProjectProject[]; statuses: OpenProjectStatusItem[] }
    }
    'openproject.workPackages.list': {
      input?: {
        project?: string
        status?: 'open' | 'closed' | 'all' | string
        query?: string
        limit?: number
      }
      output: { workPackages: OpenProjectWorkPackage[] }
    }
    'openproject.workPackages.get': {
      input: { id: number }
      output: { workPackage: OpenProjectWorkPackage; activities: OpenProjectActivity[] }
    }
    'openproject.workPackages.update': {
      input: {
        id: number
        subject?: string
        status?: string
        assigneeId?: number | null
        responsibleId?: number | null
        description?: string
        comment?: string
        confirm?: boolean
      }
      output: GuardedWriteResult<OpenProjectWorkPackage>
    }
    'openproject.workPackages.create': {
      input: {
        project: string
        subject: string
        description?: string
        typeName?: string
        priorityName?: string
        parentId?: number | null
        assigneeId?: number | null
        responsibleId?: number | null
        confirm?: boolean
      }
      output: GuardedWriteResult<OpenProjectWorkPackage>
    }
    'openproject.agent.launch': {
      input: LaunchAgentInput
      output: LaunchAgentOutput
    }
    'openproject.mcp.register': {
      input: {
        agent?: string
      }
      output: {
        agent: string
        configPath: string
        summary: string
      }
    }
  }

  interface PluginPanelEvents {
    'openproject.state.changed': OpenProjectStateSnapshot
  }
}
