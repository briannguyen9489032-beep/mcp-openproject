import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { OpenProjectStateSnapshot } from './protocol'

function createInitialSnapshot(): OpenProjectStateSnapshot {
  return {
    config: {
      baseUrl: 'https://openproject.example.com',
      hasToken: true,
      tokenSource: 'secrets',
      readProjects: 'esg-backend,esg-frontend',
      writeProjects: 'esg-backend,esg-frontend',
      defaultAgent: 'codex',
      mcpBinaryPath: 'mcp-openproject',
      injectEnvOnAgentLaunch: true
    },
    currentUser: 'Ivan Ha',
    projects: [
      {
        id: 1,
        identifier: 'esg-backend',
        name: 'ESG Backend',
        description: 'Core ESG backend'
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
        project: 'ESG Backend',
        projectIdentifier: 'esg-backend',
        assignee: 'Ivan Ha',
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
      project: 'ESG Backend',
      projectIdentifier: 'esg-backend',
      assignee: 'Ivan Ha',
      updatedAt: '2026-11-04T08:00:00Z',
      lockVersion: 2
    },
    activities: [],
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

  // Step 1: Preview update
  await view.select({ label: 'Transition Status' }, 'In Review')
  await view.press({ text: 'Preview Update' })
  assert.ok(view.find({ text: /\[PREVIEW\] Update #1428/ }))
  assert.equal(confirmCalls, 0)

  // Step 2: Confirm update
  await view.press({ text: 'Confirm Update' })
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
