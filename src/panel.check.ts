import { defineCheck } from 'orca/testing'

const sampleProjects = [
  {
    id: 1,
    identifier: 'acme-backend',
    name: 'Acme Backend',
    description: 'Core API and background workers'
  },
  {
    id: 2,
    identifier: 'acme-frontend',
    name: 'Acme Frontend',
    description: 'Web portal and dashboard'
  }
]

const sampleWorkPackages = [
  {
    id: 1428,
    subject: 'Fix OAuth token refresh race condition',
    description: 'Ensure concurrent API calls share a single refresh lock.',
    status: 'In Progress',
    statusId: 7,
    type: 'Bug',
    priority: 'High',
    project: 'Acme Backend',
    projectIdentifier: 'acme-backend',
    assignee: 'Alex Dev',
    updatedAt: '2026-11-04T08:00:00Z',
    lockVersion: 3
  },
  {
    id: 1432,
    subject: 'Add analytics CSV export',
    description: 'Allow exporting filtered metrics from dashboard.',
    status: 'New',
    statusId: 1,
    type: 'Feature',
    priority: 'Normal',
    project: 'Acme Frontend',
    projectIdentifier: 'acme-frontend',
    assignee: 'Unassigned',
    updatedAt: '2026-11-04T08:15:00Z',
    lockVersion: 1
  }
]

export default defineCheck({
  unconfigured: {},
  populated: {
    settings: {
      baseUrl: 'https://openproject.example.com',
      readProjects: 'acme-backend,acme-frontend',
      writeProjects: 'acme-backend,acme-frontend',
      defaultAgent: 'codex'
    },
    secrets: {
      'openproject.apiToken': 'opapi-test-token'
    },
    storage: {
      'openproject.projects': sampleProjects,
      'openproject.workPackages': sampleWorkPackages,
      'openproject.selectedTicketId': 1428,
      'openproject.activitiesByTicket': {
        '1428': [
          {
            id: 1,
            user: 'Alex Dev',
            comment: 'Investigating refresh token lock timeout.',
            createdAt: '2026-11-04T08:05:00Z'
          }
        ]
      }
    }
  }
})
