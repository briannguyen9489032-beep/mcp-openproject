import { defineCheck } from 'orca/testing'

const sampleProjects = [
  {
    id: 1,
    identifier: 'esg-backend',
    name: 'ESG Backend',
    description: 'Core ESG API and background workers'
  },
  {
    id: 2,
    identifier: 'esg-frontend',
    name: 'ESG Frontend',
    description: 'ESG portal and dashboard'
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
    project: 'ESG Backend',
    projectIdentifier: 'esg-backend',
    assignee: 'Ivan Ha',
    updatedAt: '2026-11-04T08:00:00Z',
    lockVersion: 3
  },
  {
    id: 1432,
    subject: 'Add emission scope 3 CSV export',
    description: 'Allow exporting filtered scope 3 metrics from dashboard.',
    status: 'New',
    statusId: 1,
    type: 'Feature',
    priority: 'Normal',
    project: 'ESG Frontend',
    projectIdentifier: 'esg-frontend',
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
      readProjects: 'esg-backend,esg-frontend',
      writeProjects: 'esg-backend,esg-frontend',
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
            user: 'Ivan Ha',
            comment: 'Investigating refresh token lock timeout.',
            createdAt: '2026-11-04T08:05:00Z'
          }
        ]
      }
    }
  }
})
