export interface OpenProjectStatusItem {
  id: number
  name: string
  isClosed: boolean
}

export interface OpenProjectProject {
  id: number
  identifier: string
  name: string
  description: string
}

export interface OpenProjectWorkPackage {
  id: number
  subject: string
  description: string
  status: string
  statusId: number
  type: string
  priority: string
  project: string
  projectIdentifier: string
  assignee: string
  updatedAt: string
  lockVersion: number
}

export interface OpenProjectActivity {
  id: number
  user: string
  comment: string
  createdAt: string
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
}

export interface OpenProjectStateSnapshot {
  config: OpenProjectConfigSummary
  currentUser: string
  projects: OpenProjectProject[]
  workPackages: OpenProjectWorkPackage[]
  statuses: OpenProjectStatusItem[]
  selectedTicket: OpenProjectWorkPackage | null
  activities: OpenProjectActivity[]
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
      }
      output: OpenProjectStateSnapshot
    }
    'openproject.token.clear': {
      output: OpenProjectStateSnapshot
    }
    'openproject.projects.list': {
      input?: { refresh?: boolean }
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
        confirm?: boolean
      }
      output: GuardedWriteResult<OpenProjectWorkPackage>
    }
    'openproject.agent.launch': {
      input: LaunchAgentInput
      output: LaunchAgentOutput
    }
  }

  interface PluginPanelEvents {
    'openproject.state.changed': OpenProjectStateSnapshot
  }
}
