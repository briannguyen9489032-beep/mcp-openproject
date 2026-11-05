import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const sampleProjects = [
  {
    id: 1,
    identifier: 'acme-backend',
    name: 'Acme Backend',
    description: 'Backend API'
  },
  {
    id: 2,
    identifier: 'secret-proj',
    name: 'Secret Project',
    description: 'Not in allowlist'
  }
]

const sampleWorkPackages = [
  {
    id: 1428,
    subject: 'Fix token refresh',
    description: 'Token refresh edge case',
    status: 'New',
    statusId: 1,
    type: 'Bug',
    priority: 'High',
    project: 'Acme Backend',
    projectIdentifier: 'acme-backend',
    assignee: 'Alex Dev',
    updatedAt: '2026-11-04T08:00:00Z',
    lockVersion: 1
  },
  {
    id: 9999,
    subject: 'Restricted task',
    description: 'Should be filtered out by readProjects',
    status: 'New',
    statusId: 1,
    type: 'Task',
    priority: 'Normal',
    project: 'Secret Project',
    projectIdentifier: 'secret-proj',
    assignee: 'Unassigned',
    updatedAt: '2026-11-04T08:00:00Z',
    lockVersion: 0
  }
]

test('enforces read/write allowlists, 2-step preview-then-confirm, and agent launch hook', async () => {
  const host = mockHost({
    settings: {
      baseUrl: 'https://openproject.example.com',
      readProjects: 'acme-backend',
      writeProjects: 'acme-backend',
      defaultAgent: 'codex',
      injectEnvOnAgentLaunch: true
    },
    secrets: {
      'openproject.apiToken': 'opapi-secret-123'
    },
    storage: {
      'openproject.projects': sampleProjects,
      'openproject.workPackages': sampleWorkPackages
    },
    results: {
      'workspace.list': {
        workspaces: [
          {
            id: 'ws-acme-backend',
            kind: 'worktree',
            name: 'acme-backend',
            path: '/home/dev/orca/acme-backend',
            branch: 'main',
            hostId: null
          }
        ],
        truncated: false
      },
      'agent.launch': {
        terminalId: 'term-99'
      }
    }
  })

  const worker = await mountWorker(main, { host })

  // 1. Verify readProjects filters out secret-proj and detectedAgents includes Antigravity (agy)
  const state = await worker.request('openproject.state.get')
  assert.equal(state.projects.length, 1)
  assert.equal(state.projects[0].identifier, 'acme-backend')
  assert.equal(state.workPackages.length, 1)
  assert.equal(state.workPackages[0].id, 1428)
  assert.ok(Array.isArray(state.detectedAgents))
  assert.ok(state.detectedAgents?.some((a) => a.id === 'antigravity'))

  // 2. Preview update without confirm=true does not mutate storage
  const preview = await worker.request('openproject.workPackages.update', {
    id: 1428,
    status: 'In Progress',
    comment: 'Starting work in Orca',
    confirm: false
  })
  assert.equal(preview.preview, true)
  assert.equal(preview.confirmed, false)
  assert.equal((await worker.request('openproject.state.get')).workPackages[0].status, 'New')

  // 3. Confirm update mutates status, increments lockVersion, and records comment
  const confirmed = await worker.request('openproject.workPackages.update', {
    id: 1428,
    status: 'In Progress',
    comment: 'Starting work in Orca',
    confirm: true
  })
  assert.equal(confirmed.preview, false)
  assert.equal(confirmed.confirmed, true)
  assert.equal(confirmed.workPackage?.status, 'In Progress')
  assert.equal(confirmed.workPackage?.lockVersion, 2)

  const detail = await worker.request('openproject.workPackages.get', { id: 1428 })
  assert.equal(detail.activities.length, 1)
  assert.equal(detail.activities[0].comment, 'Starting work in Orca')

  // 4. Launch agent on ticket #1428
  const launched = await worker.request('openproject.agent.launch', { ticketId: 1428 })
  assert.equal(launched.terminalId, 'term-99')
  assert.equal(launched.branchSlug, 'op-1428-fix-token-refresh')
  assert.equal(worker.host.callsOf('agent.launch').length, 1)

  // 5. Verify agent.launch.before hook injects OpenProject MCP env vars
  const hookDecision = await worker.hooks.fire('agent.launch.before', {
    agent: 'codex',
    workspaceId: 'ws-acme-backend',
    workspaceKind: 'worktree',
    command: 'codex',
    env: { EXISTING: '1' }
  })
  assert.equal(hookDecision.kind, 'continue')
  if (hookDecision.kind === 'continue') {
    assert.equal(hookDecision.event.env.OPENPROJECT_BASE_URL, 'https://openproject.example.com')
    assert.equal(hookDecision.event.env.OPENPROJECT_API_TOKEN, 'opapi-secret-123')
    assert.equal(hookDecision.event.env.OPENPROJECT_READ_PROJECTS, 'acme-backend')
    assert.equal(hookDecision.event.env.OPENPROJECT_WRITE_PROJECTS, 'acme-backend')
  }

  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})
