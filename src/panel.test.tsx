import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { OpenProjectStateSnapshot } from './protocol'

function createInitialSnapshot(): OpenProjectStateSnapshot {
  return {
    config: {
      baseUrl: 'https://openproject.example.com',
      hasToken: true,
      tokenSource: 'secrets',
      readProjects: 'acme-backend,acme-frontend',
      writeProjects: 'acme-backend,acme-frontend',
      defaultAgent: 'codex',
      mcpBinaryPath: 'mcp-openproject',
      injectEnvOnAgentLaunch: true
    },
    currentUser: 'Alex Dev',
    projects: [
      {
        id: 1,
        identifier: 'acme-backend',
        name: 'Acme Backend',
        description: 'Core backend API'
      }
    ],
    workPackages: [
      {
        id: 1428,
        subject: 'Fix OAuth token refresh',
        description: 'Prevent duplicate refresh token requests.',
        status: 'In Progress',
        statusId: 7,
        type: 'Bug',
        priority: 'High',
        project: 'Acme Backend',
        projectIdentifier: 'acme-backend',
        assignee: 'Alex Dev',
        updatedAt: '2026-11-04T08:00:00Z',
        lockVersion: 2
      }
    ],
    statuses: [
      { id: 1, name: 'New', isClosed: false },
      { id: 7, name: 'In Progress', isClosed: false },
      { id: 10, name: 'In Review', isClosed: false },
      { id: 12, name: 'Closed', isClosed: true }
    ],
    selectedTicket: {
      id: 1428,
      subject: 'Fix OAuth token refresh',
      description: 'Prevent duplicate refresh token requests.',
      status: 'In Progress',
      statusId: 7,
      type: 'Bug',
      priority: 'High',
      project: 'Acme Backend',
      projectIdentifier: 'acme-backend',
      assignee: 'Alex Dev',
      updatedAt: '2026-11-04T08:00:00Z',
      lockVersion: 2
    },
    activities: [],
    detectedAgents: [
      { id: 'antigravity', label: 'Antigravity (agy)', installed: true, binPath: '/usr/local/bin/agy' },
      { id: 'codex', label: 'Codex', installed: true, binPath: '/usr/local/bin/codex' },
      { id: 'claude', label: 'Claude Code', installed: false }
    ],
    lastSyncedAt: 1793779200000,
    lastError: null
  }
}

test('renders tickets, previews guarded update, confirms update, and launches agent', async () => {
  const snapshot = createInitialSnapshot()
  let confirmCalls = 0
  let launchedTicketId = 0

  const host = mockHost({
    requests: {
      'openproject.state.get': () => snapshot,
      'openproject.workPackages.update': (input) => {
        if (!input.confirm) {
          return {
            preview: true,
            confirmed: false,
            action: 'update_work_package',
            summary: `[PREVIEW] Update #${input.id} (status: "In Progress" -> "${input.status ?? 'In Review'}")`,
            changes: { status: { from: 'In Progress', to: input.status ?? 'In Review' } },
            workPackage: snapshot.selectedTicket!
          }
        }
        confirmCalls += 1
        snapshot.selectedTicket!.status = input.status ?? 'In Review'
        return {
          preview: false,
          confirmed: true,
          action: 'update_work_package',
          summary: `[CONFIRMED] Updated #${input.id} to ${snapshot.selectedTicket!.status}`,
          changes: { status: { from: 'In Progress', to: snapshot.selectedTicket!.status } },
          workPackage: snapshot.selectedTicket!
        }
      },
      'openproject.agent.launch': ({ ticketId, agent }) => {
        launchedTicketId = ticketId
        return {
          terminalId: 'term-1428',
          workspaceId: 'ws-1',
          branchSlug: 'op-1428-fix-oauth-token-refresh',
          agent: agent ?? 'codex'
        }
      }
    }
  })

  const view = await mount(panel, { host })
  assert.ok(view.find({ text: /#1428 Fix OAuth token refresh/ }))

  // Direct 1-click update in UI
  await view.press({ text: 'In Review' })
  await view.press({ text: 'Update' })
  assert.equal(confirmCalls, 1)
  assert.ok(view.find({ text: /\[CONFIRMED\] Updated #1428/ }))

  // Launch agent on ticket
  await view.press({ text: 'Launch Agent' })
  assert.equal(launchedTicketId, 1428)
  assert.ok(view.find({ text: /op-1428-fix-oauth-token-refresh/ }))

  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('clicking a task in the list toggles its inline detail drawer open and closed in-place', async () => {
  const snapshot = createInitialSnapshot()
  const secondTask = {
    id: 1429,
    subject: 'Add warehouse inventory UI',
    description: 'Inline accordion test task.',
    status: 'New',
    statusId: 1,
    type: 'Task',
    priority: 'Normal',
    project: 'Acme Backend',
    projectIdentifier: 'acme-backend',
    assignee: 'Unassigned',
    updatedAt: '2026-11-04T09:00:00Z',
    lockVersion: 1
  }
  snapshot.workPackages.push(secondTask)

  const host = mockHost({
    requests: {
      'openproject.state.get': () => snapshot,
      'openproject.workPackages.get': ({ id }) => {
        const found = snapshot.workPackages.find((wp) => wp.id === id) ?? snapshot.workPackages[0]
        snapshot.selectedTicket = found
        return { workPackage: found, activities: [] }
      }
    }
  })

  const view = await mount(panel, { host })
  // Initially #1428 is open inline (shows Launch Agent + Assignee/Responsible controls without duplicating the title)
  assert.ok(view.find({ text: 'Launch Agent' }))
  assert.ok(view.find({ label: 'Assignee' }))
  assert.ok(view.find({ label: 'Responsible' }))

  // Clicking #1428 again collapses it in-place
  await view.press({ text: /#1428 Fix OAuth token refresh/ })
  assert.equal(view.find({ text: 'Launch Agent' }), null)

  // Clicking #1429 opens #1429 inline right beneath #1429
  await view.press({ text: /#1429 Add warehouse inventory UI/ })
  assert.ok(view.find({ text: 'Launch Agent' }))

  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('unconfigured state shows clean onboarding without mock URLs or fake sync success', async () => {
  const unconfiguredSnapshot: OpenProjectStateSnapshot = {
    config: {
      baseUrl: '',
      hasToken: false,
      tokenSource: 'none',
      readProjects: '*',
      writeProjects: '*',
      defaultAgent: 'codex',
      mcpBinaryPath: 'mcp-openproject',
      injectEnvOnAgentLaunch: true
    },
    currentUser: '',
    projects: [],
    workPackages: [],
    statuses: [],
    selectedTicket: null,
    activities: [],
    detectedAgents: [
      { id: 'antigravity', label: 'Antigravity (agy)', installed: true },
      { id: 'codex', label: 'Codex', installed: true }
    ],
    lastSyncedAt: null,
    lastError: null
  }

  const host = mockHost({
    requests: {
      'openproject.state.get': () => unconfiguredSnapshot,
      'openproject.projects.list': () => ({ projects: [], statuses: [] })
    }
  })

  const view = await mount(panel, { host })

  // Shows onboarding card in Tickets tab when unconfigured
  assert.ok(view.find({ text: /Connect to OpenProject/ }))
  assert.ok(view.find({ text: 'Configure Connection' }))

  // Clicking Sync when unconfigured warns user and opens Setup tab instead of showing "Synced 0 tasks"
  await view.press({ text: 'Sync' })
  assert.ok(
    view.find({
      text: /Enter your OpenProject Base URL and API Token below/
    })
  )

  // Clicking the language button switches the entire UI to Vietnamese (Vietsub)
  await view.press({ text: /EN/ })
  assert.ok(view.find({ text: /VI/ }))
  assert.ok(view.find({ text: 'Đồng bộ' }))
  assert.ok(view.find({ text: 'Lưu cấu hình' }))

  // Switch back to English
  await view.press({ text: /VI/ })
  assert.ok(view.find({ text: 'Sync' }))

  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('supports 50/100/200 per-page selector and checks OpenProject permission for + New Task tab', async () => {
  const snapshot = createInitialSnapshot()
  let requestedLimit = 100
  let createdSubject = ''

  const host = mockHost({
    requests: {
      'openproject.state.get': () => snapshot,
      'openproject.workPackages.list': (input) => {
        if (input?.limit) {
          requestedLimit = input.limit
          snapshot.config.pageSize = input.limit
        }
        return { workPackages: snapshot.workPackages }
      },
      'openproject.workPackages.create': (input) => {
        createdSubject = input.subject
        const created = {
          id: 1500,
          subject: input.subject,
          description: input.description ?? '',
          status: 'New',
          statusId: 1,
          type: input.typeName ?? 'Task',
          priority: input.priorityName ?? 'Normal',
          project: 'Acme Backend',
          projectIdentifier: input.project,
          assignee: 'Unassigned',
          updatedAt: '2026-11-04T10:00:00Z',
          lockVersion: 0
        }
        snapshot.workPackages.unshift(created)
        snapshot.selectedTicket = created
        return {
          preview: false,
          confirmed: true,
          action: 'create_work_package',
          summary: `[CONFIRMED] Created #1500: ${input.subject}`,
          changes: { subject: { to: input.subject } },
          workPackage: created
        }
      }
    }
  })

  const view = await mount(panel, { host })

  // Switch page size to 200
  await view.press({ text: '200' })
  assert.equal(requestedLimit, 200)

  // Open + New Task tab and create a work package
  await view.select({ label: 'OpenProject Views' }, 'create')
  await view.type({ label: 'Subject / Title' }, 'Optimize API pagination cache', { replace: true })
  await view.press({ text: 'Create Task' })
  assert.equal(createdSubject, 'Optimize API pagination cache')
  assert.ok(view.find({ text: /#1500 Optimize API pagination cache/ }))

  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})
