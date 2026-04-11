import {
  atom,
  Badge,
  Button,
  Callout,
  Card,
  CodeView,
  EmptyState,
  Heading,
  Input,
  KeyValue,
  List,
  ListItem,
  Markdown,
  plugin,
  read,
  Row,
  Select,
  Separator,
  set,
  Stack,
  Switch,
  Tab,
  Tabs,
  Text,
  Textarea,
  type PanelContext
} from 'orca'
import { formatWorktreeBranchSlug } from './openproject-api'
import type {
  GuardedWriteResult,
  OpenProjectStateSnapshot,
  OpenProjectWorkPackage
} from './protocol'

const stateAtom = atom<OpenProjectStateSnapshot | null>(null)
const activeTabAtom = atom<string>('tickets')
const scopeModeAtom = atom<'all' | 'my_todos'>('all')
const projectFilterAtom = atom<string>('all')
const statusFilterAtom = atom<string>('open')
const searchQueryAtom = atom<string>('')

const nextStatusDraftAtom = atom<string>('')
const commentDraftAtom = atom<string>('')
const pendingPreviewAtom = atom<GuardedWriteResult<OpenProjectWorkPackage> | null>(null)
const feedbackMessageAtom = atom<{ tone: 'success' | 'warning' | 'danger' | 'accent'; text: string } | null>(null)

const newTicketProjectAtom = atom<string>('')
const newTicketSubjectAtom = atom<string>('')
const newTicketTypeAtom = atom<string>('Task')
const newTicketDescAtom = atom<string>('')
const pendingCreatePreviewAtom = atom<GuardedWriteResult<OpenProjectWorkPackage> | null>(null)

const configUrlDraftAtom = atom<string>('')
const configTokenDraftAtom = atom<string>('')
const configReadProjectsDraftAtom = atom<string>('*')
const configWriteProjectsDraftAtom = atom<string>('*')
const configAgentDraftAtom = atom<string>('codex')
const configMcpBinDraftAtom = atom<string>('mcp-openproject')
const configInjectEnvDraftAtom = atom<boolean>(true)

function syncDraftsFromSnapshot(snapshot: OpenProjectStateSnapshot): void {
  set(stateAtom, snapshot)
  set(configUrlDraftAtom, snapshot.config.baseUrl)
  set(configReadProjectsDraftAtom, snapshot.config.readProjects || '*')
  set(configWriteProjectsDraftAtom, snapshot.config.writeProjects || '*')
  set(configAgentDraftAtom, snapshot.config.defaultAgent || 'codex')
  set(configMcpBinDraftAtom, snapshot.config.mcpBinaryPath || 'mcp-openproject')
  set(configInjectEnvDraftAtom, snapshot.config.injectEnvOnAgentLaunch)
  if (snapshot.selectedTicket) {
    set(nextStatusDraftAtom, snapshot.selectedTicket.status)
  }
  if (!read(newTicketProjectAtom) && snapshot.projects[0]) {
    const esg = snapshot.projects.find((p) => p.identifier === 'esg-vrg')
    set(newTicketProjectAtom, (esg ?? snapshot.projects[0]).identifier)
    if (esg && read(projectFilterAtom) === 'all') {
      set(projectFilterAtom, 'esg-vrg')
    }
  }
}

async function refreshAll(): Promise<void> {
  try {
    await plugin.request('openproject.projects.list', { refresh: true })
    const snapshot = await plugin.request('openproject.state.get')
    syncDraftsFromSnapshot(snapshot)
    set(feedbackMessageAtom, {
      tone: 'success',
      text: `Synced ${snapshot.workPackages.length} tasks across ${snapshot.projects.length} projects.`
    })
  } catch (err) {
    set(feedbackMessageAtom, {
      tone: 'danger',
      text: err instanceof Error ? err.message : String(err)
    })
  }
}

async function selectTicket(id: number): Promise<void> {
  try {
    set(pendingPreviewAtom, null)
    await plugin.request('openproject.workPackages.get', { id })
    const snapshot = await plugin.request('openproject.state.get')
    syncDraftsFromSnapshot(snapshot)
  } catch (err) {
    set(feedbackMessageAtom, {
      tone: 'danger',
      text: err instanceof Error ? err.message : String(err)
    })
  }
}

async function previewTicketUpdate(ticketId: number): Promise<void> {
  try {
    const res = await plugin.request('openproject.workPackages.update', {
      id: ticketId,
      status: read(nextStatusDraftAtom),
      comment: read(commentDraftAtom),
      confirm: false
    })
    set(pendingPreviewAtom, res)
    set(feedbackMessageAtom, null)
  } catch (err) {
    set(feedbackMessageAtom, {
      tone: 'danger',
      text: err instanceof Error ? err.message : String(err)
    })
  }
}

async function confirmTicketUpdate(ticketId: number): Promise<void> {
  try {
    const res = await plugin.request('openproject.workPackages.update', {
      id: ticketId,
      status: read(nextStatusDraftAtom),
      comment: read(commentDraftAtom),
      confirm: true
    })
    set(pendingPreviewAtom, null)
    set(commentDraftAtom, '')
    set(feedbackMessageAtom, { tone: 'success', text: res.summary })
  } catch (err) {
    set(feedbackMessageAtom, {
      tone: 'danger',
      text: err instanceof Error ? err.message : String(err)
    })
  }
}

async function launchAgentForSelectedTicket(ticketId: number): Promise<void> {
  try {
    const res = await plugin.request('openproject.agent.launch', {
      ticketId,
      agent: read(configAgentDraftAtom)
    })
    set(feedbackMessageAtom, {
      tone: 'accent',
      text: `Launched ${res.agent} (${res.branchSlug}) in terminal ${res.terminalId}`
    })
  } catch (err) {
    set(feedbackMessageAtom, {
      tone: 'danger',
      text: err instanceof Error ? err.message : String(err)
    })
  }
}

async function previewCreateTicket(): Promise<void> {
  try {
    const snapshot = read(stateAtom)
    const project =
      read(newTicketProjectAtom) || snapshot?.projects[0]?.identifier || 'default'
    const res = await plugin.request('openproject.workPackages.create', {
      project,
      subject: read(newTicketSubjectAtom),
      description: read(newTicketDescAtom),
      typeName: read(newTicketTypeAtom) || 'Task',
      confirm: false
    })
    set(pendingCreatePreviewAtom, res)
    set(feedbackMessageAtom, null)
  } catch (err) {
    set(feedbackMessageAtom, {
      tone: 'danger',
      text: err instanceof Error ? err.message : String(err)
    })
  }
}

async function confirmCreateTicket(): Promise<void> {
  try {
    const snapshot = read(stateAtom)
    const project =
      read(newTicketProjectAtom) || snapshot?.projects[0]?.identifier || 'default'
    const res = await plugin.request('openproject.workPackages.create', {
      project,
      subject: read(newTicketSubjectAtom),
      description: read(newTicketDescAtom),
      typeName: read(newTicketTypeAtom) || 'Task',
      confirm: true
    })
    set(pendingCreatePreviewAtom, null)
    set(newTicketSubjectAtom, '')
    set(newTicketDescAtom, '')
    set(activeTabAtom, 'tickets')
    set(feedbackMessageAtom, { tone: 'success', text: res.summary })
  } catch (err) {
    set(feedbackMessageAtom, {
      tone: 'danger',
      text: err instanceof Error ? err.message : String(err)
    })
  }
}

async function saveConfiguration(): Promise<void> {
  try {
    const tokenDraft = read(configTokenDraftAtom).trim()
    const snapshot = await plugin.request('openproject.config.save', {
      baseUrl: read(configUrlDraftAtom),
      apiToken: tokenDraft || undefined,
      readProjects: read(configReadProjectsDraftAtom),
      writeProjects: read(configWriteProjectsDraftAtom),
      defaultAgent: read(configAgentDraftAtom),
      mcpBinaryPath: read(configMcpBinDraftAtom),
      injectEnvOnAgentLaunch: read(configInjectEnvDraftAtom)
    })
    set(configTokenDraftAtom, '')
    syncDraftsFromSnapshot(snapshot)
    set(feedbackMessageAtom, { tone: 'success', text: 'Saved OpenProject settings.' })
  } catch (err) {
    set(feedbackMessageAtom, {
      tone: 'danger',
      text: err instanceof Error ? err.message : String(err)
    })
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('openproject.state.changed', (snapshot) => {
      syncDraftsFromSnapshot(snapshot)
    })
  )
  void plugin.request('openproject.state.get').then((snapshot) => {
    syncDraftsFromSnapshot(snapshot)
  })
}

function statusBadgeTone(status: string): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  const s = status.toLowerCase()
  if (s.includes('progress')) return 'accent'
  if (s.includes('review')) return 'warning'
  if (s.includes('closed') || s.includes('resolved')) return 'success'
  if (s.includes('rejected') || s.includes('blocked')) return 'danger'
  return 'neutral'
}

function formatShortDate(iso: string): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function extractHostLabel(baseUrl: string): string {
  if (!baseUrl) return 'unconfigured'
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

export default function Panel() {
  const snapshot = read(stateAtom)
  const activeTab = read(activeTabAtom)
  const scopeMode = read(scopeModeAtom)
  const projectFilter = read(projectFilterAtom)
  const statusFilter = read(statusFilterAtom)
  const searchQuery = read(searchQueryAtom)
  const feedback = read(feedbackMessageAtom)
  const pendingPreview = read(pendingPreviewAtom)
  const pendingCreatePreview = read(pendingCreatePreviewAtom)

  const projects = snapshot?.projects ?? []
  const allWorkPackages = snapshot?.workPackages ?? []
  const statuses = snapshot?.statuses ?? []
  const selectedTicket = snapshot?.selectedTicket ?? null
  const activities = snapshot?.activities ?? []
  const currentUser = snapshot?.currentUser ?? ''

  const filteredTickets = allWorkPackages.filter((wp) => {
    if (
      projectFilter !== 'all' &&
      wp.projectIdentifier.toLowerCase() !== projectFilter.toLowerCase() &&
      wp.project.toLowerCase() !== projectFilter.toLowerCase()
    ) {
      return false
    }
    if (scopeMode === 'my_todos' && currentUser) {
      if (wp.assignee.toLowerCase() !== currentUser.toLowerCase()) {
        return false
      }
    }
    const statusLower = wp.status.toLowerCase()
    const closed = ['closed', 'rejected', 'resolved'].includes(statusLower)
    if (statusFilter === 'open' && closed) return false
    if (statusFilter === 'in_progress' && !statusLower.includes('progress')) return false
    if (statusFilter === 'in_review' && !statusLower.includes('review')) return false
    if (statusFilter === 'closed' && !closed) return false

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const matches =
        String(wp.id).includes(q) ||
        wp.subject.toLowerCase().includes(q) ||
        wp.project.toLowerCase().includes(q) ||
        wp.assignee.toLowerCase().includes(q)
      if (!matches) return false
    }
    return true
  })

  const projectOptions = [
    { value: 'all', label: `All projects (${projects.length})` },
    ...projects.map((p) => ({ value: p.identifier, label: p.name }))
  ]

  const statusFilterOptions = [
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'in_review', label: 'In Review' },
    { value: 'closed', label: 'Closed' },
    { value: 'all', label: 'All' }
  ]

  const statusTransitionOptions =
    statuses.length > 0
      ? statuses.map((s) => ({ value: s.name, label: s.name }))
      : [
          { value: 'New', label: 'New' },
          { value: 'In Progress', label: 'In Progress' },
          { value: 'In Review', label: 'In Review' },
          { value: 'Closed', label: 'Closed' }
        ]

  const baseUrl = snapshot?.config.baseUrl || 'https://openproject.example.com'
  const hostLabel = extractHostLabel(snapshot?.config.baseUrl || '')
  const mcpBin = snapshot?.config.mcpBinaryPath || 'mcp-openproject'
  const readAllow = snapshot?.config.readProjects || '*'
  const writeAllow = snapshot?.config.writeProjects || '*'

  const codexSnippet = [
    '[mcp_servers.openproject]',
    `command = "${mcpBin}"`,
    '',
    '[mcp_servers.openproject.env]',
    `OPENPROJECT_BASE_URL = "${baseUrl}"`,
    'OPENPROJECT_API_TOKEN = "opapi-..."',
    `OPENPROJECT_READ_PROJECTS = "${readAllow}"`,
    `OPENPROJECT_WRITE_PROJECTS = "${writeAllow}"`
  ].join('\n')

  return (
    <Stack gap="sm">
      {/* Provider Header Bar — styled after Orca's native GitLab/GitHub Tasks header */}
      <Row justify="between" align="center">
        <Row gap="xs" align="center">
          <Heading level={2}>OpenProject</Heading>
          <Badge tone={snapshot?.config.hasToken ? 'accent' : 'warning'}>
            {snapshot?.config.hasToken
              ? `${hostLabel} · ${projects.length} projects`
              : 'Provider auth needed'}
          </Badge>
        </Row>
        <Button size="xs" variant="outline" icon="refresh" onPress={refreshAll}>
          Sync
        </Button>
      </Row>

      {feedback ? (
        <Callout tone={feedback.tone} title="Status">
          <Text size="xs">{feedback.text}</Text>
        </Callout>
      ) : null}

      {snapshot?.lastError ? (
        <Callout tone="warning" title="OpenProject Provider Warning">
          <Text size="xs">{snapshot.lastError}</Text>
        </Callout>
      ) : null}

      <Tabs
        label="OpenProject Views"
        value={activeTab}
        onChange={(nextTab) => set(activeTabAtom, nextTab)}
      >
        <Tab value="tickets" label="Tickets" icon="blocks">
          <Stack gap="sm">
            {/* Row 1: Issues / My Todos pills + Project selector (matching Orca Tasks view) */}
            <Row justify="between" align="center" gap="xs">
              <Row gap="xs" align="center">
                <Button
                  size="xs"
                  variant={scopeMode === 'all' ? 'solid' : 'outline'}
                  tone={scopeMode === 'all' ? 'accent' : 'neutral'}
                  onPress={() => set(scopeModeAtom, 'all')}
                >
                  Work Packages
                </Button>
                <Button
                  size="xs"
                  variant={scopeMode === 'my_todos' ? 'solid' : 'outline'}
                  tone={scopeMode === 'my_todos' ? 'accent' : 'neutral'}
                  onPress={() => set(scopeModeAtom, 'my_todos')}
                >
                  My Todos
                </Button>
              </Row>
              <Select
                label="Filter Project"
                labelHidden
                value={projectFilter}
                options={projectOptions}
                onChange={(val) => {
                  set(projectFilterAtom, val)
                  if (val && val !== 'all') {
                    void plugin.request('openproject.workPackages.list', { project: val })
                  }
                }}
              />
            </Row>

            {/* Row 2: State filter pills (Open | In Progress | In Review | Closed | All) */}
            <Row justify="between" align="center" gap="xs">
              <Row gap="xs" align="center">
                <Button
                  size="xs"
                  variant={statusFilter === 'open' ? 'solid' : 'outline'}
                  onPress={() => set(statusFilterAtom, 'open')}
                >
                  Open
                </Button>
                <Button
                  size="xs"
                  variant={statusFilter === 'in_progress' ? 'solid' : 'outline'}
                  onPress={() => set(statusFilterAtom, 'in_progress')}
                >
                  In Progress
                </Button>
                <Button
                  size="xs"
                  variant={statusFilter === 'closed' ? 'solid' : 'outline'}
                  onPress={() => set(statusFilterAtom, 'closed')}
                >
                  Closed
                </Button>
                <Button
                  size="xs"
                  variant={statusFilter === 'all' ? 'solid' : 'outline'}
                  onPress={() => set(statusFilterAtom, 'all')}
                >
                  All
                </Button>
              </Row>
              <Select
                label="Filter Status"
                labelHidden
                value={statusFilter}
                options={statusFilterOptions}
                onChange={(val) => set(statusFilterAtom, val)}
              />
            </Row>

            <Input
              label="Search tickets"
              labelHidden
              type="search"
              placeholder="Search #ID, title, project, assignee..."
              value={searchQuery}
              onChange={(val) => set(searchQueryAtom, val)}
            />

            {/* Column Header Bar matching Orca Tasks table: ID | TITLE | TYPE / STATE | UPDATED */}
            <Row justify="between" align="center">
              <Text size="xs">
                ID / TITLE ({filteredTickets.length})
              </Text>
              <Text size="xs">
                PROJECT · TYPE / STATE · UPDATED
              </Text>
            </Row>
            <Separator />

            {filteredTickets.length === 0 ? (
              <EmptyState
                title="No matching work packages"
                description="Click Sync to load tasks from OpenProject or adjust your project/status filters."
                icon="blocks"
              />
            ) : (
              <List label="Work Packages">
                {filteredTickets.map((wp) => (
                  <ListItem
                    key={String(wp.id)}
                    title={`#${wp.id} ${wp.subject}`}
                    description={`${wp.project} · ${wp.type} / ${wp.status} · ${wp.assignee} · ${formatShortDate(wp.updatedAt)}`}
                    icon="file-text"
                    current={selectedTicket?.id === wp.id}
                    onPress={() => selectTicket(wp.id)}
                  />
                ))}
              </List>
            )}

            {selectedTicket ? (
              <Card
                title={`#${selectedTicket.id}: ${selectedTicket.subject}`}
                description={`${selectedTicket.type} in ${selectedTicket.project} (${selectedTicket.projectIdentifier})`}
              >
                <Stack gap="sm">
                  <Row justify="between" align="center">
                    <Row gap="xs" align="center">
                      <Badge tone={statusBadgeTone(selectedTicket.status)}>
                        {selectedTicket.status}
                      </Badge>
                      <Badge tone="neutral">{selectedTicket.priority}</Badge>
                    </Row>
                    <Button
                      size="xs"
                      tone="accent"
                      icon="rocket"
                      onPress={() => launchAgentForSelectedTicket(selectedTicket.id)}
                    >
                      Launch Agent
                    </Button>
                  </Row>

                  <KeyValue
                    label="Ticket Metadata"
                    items={[
                      {
                        label: 'Project',
                        value: `${selectedTicket.project} (${selectedTicket.projectIdentifier})`
                      },
                      { label: 'Assignee', value: selectedTicket.assignee },
                      { label: 'Updated', value: formatShortDate(selectedTicket.updatedAt) },
                      {
                        label: 'Worktree Slug',
                        value: formatWorktreeBranchSlug(selectedTicket.id, selectedTicket.subject)
                      }
                    ]}
                  />

                  {selectedTicket.description ? (
                    <Markdown content={selectedTicket.description} />
                  ) : null}

                  <Separator />

                  <Heading level={3}>Guarded Update (Preview → Confirm)</Heading>
                  <Select
                    label="Transition Status"
                    value={read(nextStatusDraftAtom) || selectedTicket.status}
                    options={statusTransitionOptions}
                    onChange={(val) => {
                      set(nextStatusDraftAtom, val)
                      set(pendingPreviewAtom, null)
                    }}
                  />
                  <Textarea
                    label="Completion / Activity Comment"
                    placeholder="Add markdown comment or implementation summary..."
                    rows={3}
                    value={read(commentDraftAtom)}
                    onChange={(val) => {
                      set(commentDraftAtom, val)
                      set(pendingPreviewAtom, null)
                    }}
                  />

                  <Row gap="xs">
                    <Button
                      size="xs"
                      variant="outline"
                      icon="check"
                      onPress={() => previewTicketUpdate(selectedTicket.id)}
                    >
                      Preview Update
                    </Button>
                    {pendingPreview ? (
                      <Button
                        size="xs"
                        tone="success"
                        icon="play"
                        onPress={() => confirmTicketUpdate(selectedTicket.id)}
                      >
                        Confirm Update
                      </Button>
                    ) : null}
                  </Row>

                  {pendingPreview ? (
                    <Callout tone="accent" title="Preview Ready">
                      <Text size="xs">{pendingPreview.summary}</Text>
                    </Callout>
                  ) : null}

                  {activities.length > 0 ? (
                    <Stack gap="xs">
                      <Heading level={3}>Recent Comments ({activities.length})</Heading>
                      {activities.map((act) => (
                        <Card
                          key={String(act.id)}
                          title={act.user}
                          description={act.createdAt}
                        >
                          <Text size="xs">{act.comment}</Text>
                        </Card>
                      ))}
                    </Stack>
                  ) : null}
                </Stack>
              </Card>
            ) : null}
          </Stack>
        </Tab>

        <Tab value="create" label="New Ticket" icon="add">
          <Card title="Create Work Package" description="Guarded 2-step creation (Preview → Confirm)">
            <Stack gap="sm">
              <Input
                label="Project Identifier"
                placeholder="e.g. esg-vrg, nha-tro-365"
                value={read(newTicketProjectAtom)}
                onChange={(val) => {
                  set(newTicketProjectAtom, val)
                  set(pendingCreatePreviewAtom, null)
                }}
              />
              <Input
                label="Subject"
                placeholder="Short summary of the task or bug"
                value={read(newTicketSubjectAtom)}
                onChange={(val) => {
                  set(newTicketSubjectAtom, val)
                  set(pendingCreatePreviewAtom, null)
                }}
              />
              <Select
                label="Work Package Type"
                value={read(newTicketTypeAtom)}
                options={[
                  { value: 'Task', label: 'Task' },
                  { value: 'Bug', label: 'Bug' },
                  { value: 'Feature', label: 'Feature' },
                  { value: 'User story', label: 'User story' }
                ]}
                onChange={(val) => {
                  set(newTicketTypeAtom, val)
                  set(pendingCreatePreviewAtom, null)
                }}
              />
              <Textarea
                label="Description"
                placeholder="Acceptance criteria and implementation notes..."
                rows={4}
                value={read(newTicketDescAtom)}
                onChange={(val) => {
                  set(newTicketDescAtom, val)
                  set(pendingCreatePreviewAtom, null)
                }}
              />

              <Row gap="xs">
                <Button size="xs" variant="outline" onPress={previewCreateTicket}>
                  Preview Create
                </Button>
                {pendingCreatePreview ? (
                  <Button size="xs" tone="success" onPress={confirmCreateTicket}>
                    Confirm Create
                  </Button>
                ) : null}
              </Row>

              {pendingCreatePreview ? (
                <Callout tone="accent" title="Create Preview">
                  <Text size="xs">{pendingCreatePreview.summary}</Text>
                </Callout>
              ) : null}
            </Stack>
          </Card>
        </Tab>

        <Tab value="setup" label="Setup & MCP" icon="settings">
          <Stack gap="sm">
            <Card title="OpenProject Connection" description="Credentials & Project Scope Allowlists">
              <Stack gap="sm">
                <Input
                  label="OpenProject Base URL"
                  placeholder="https://openproject.example.com"
                  value={read(configUrlDraftAtom)}
                  onChange={(val) => set(configUrlDraftAtom, val)}
                />
                <Input
                  label="API Token (stored in Orca Secrets)"
                  type="password"
                  placeholder={
                    snapshot?.config.hasToken
                      ? `Configured (${snapshot.config.tokenSource})`
                      : 'Paste OpenProject API token...'
                  }
                  value={read(configTokenDraftAtom)}
                  onChange={(val) => set(configTokenDraftAtom, val)}
                />
                <Input
                  label="Read Projects Allowlist"
                  placeholder="esg-vrg,nha-tro-365 or *"
                  value={read(configReadProjectsDraftAtom)}
                  onChange={(val) => set(configReadProjectsDraftAtom, val)}
                />
                <Input
                  label="Write Projects Allowlist"
                  placeholder="esg-vrg,nha-tro-365 or *"
                  value={read(configWriteProjectsDraftAtom)}
                  onChange={(val) => set(configWriteProjectsDraftAtom, val)}
                />
                <Select
                  label="Default Agent CLI"
                  value={read(configAgentDraftAtom)}
                  options={[
                    { value: 'codex', label: 'Codex' },
                    { value: 'claude', label: 'Claude Code' },
                    { value: 'omp', label: 'OMP' },
                    { value: 'pi', label: 'Pi' },
                    { value: 'grok', label: 'Grok' }
                  ]}
                  onChange={(val) => set(configAgentDraftAtom, val)}
                />
                <Switch
                  label="Auto-inject OpenProject env vars on Agent Launch"
                  checked={read(configInjectEnvDraftAtom)}
                  onChange={(checked) => set(configInjectEnvDraftAtom, checked)}
                />
                <Row gap="xs">
                  <Button size="xs" tone="accent" onPress={saveConfiguration}>
                    Save Settings
                  </Button>
                </Row>
              </Stack>
            </Card>

            <Card
              title="Rust MCP Server Config"
              description="Use the compiled Rust mcp-openproject binary in Codex or Claude"
            >
              <Stack gap="xs">
                <CodeView
                  label="Codex config.toml"
                  language="toml"
                  code={codexSnippet}
                />
              </Stack>
            </Card>
          </Stack>
        </Tab>
      </Tabs>
    </Stack>
  )
}
