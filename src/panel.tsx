import {
  Box,
  Button,
  Callout,
  Card,
  EmptyState,
  List,
  ListItem,
  plugin,
  read,
  Row,
  set,
  Spinner,
  Stack,
  Tab,
  Tabs,
  Text,
  type PanelContext
} from 'orca'
import { CreateTicketView } from './components/CreateTicketView'
import { HeaderBar } from './components/HeaderBar'
import { SetupView } from './components/SetupView'
import { TicketDetailView } from './components/TicketDetailView'
import { TicketFilters } from './components/TicketFilters'
import { createTranslator } from './i18n'
import type { OpenProjectWorkPackage } from './protocol'
import {
  activeTabAtom,
  collapsedParentIdsAtom,
  feedbackMessageAtom,
  localeAtom,
  pageSizeAtom,
  priorityFilterAtom,
  projectFilterAtom,
  scopeModeAtom,
  searchQueryAtom,
  selectTicket,
  stateAtom,
  statusFilterAtom,
  syncDraftsFromSnapshot,
  ticketDetailExpandedAtom,
  toggleParentChildrenCollapsed
} from './state/panel-state'
import {
  buildHierarchicalTicketList,
  DEFAULT_OPENPROJECT_TYPES,
  formatWorkPackageRowMeta,
  getStatusToneStyle,
  type HierarchicalTicketRow,
  isStatusClosedName,
  UNUSED_BOILERPLATE_STATUSES
} from './utils/openproject-tones'

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('openproject.state.changed', (snapshot) => {
      syncDraftsFromSnapshot(snapshot)
    })
  )
  const initialProject = read(projectFilterAtom)
  const initialPageSize = Number(read(pageSizeAtom) || '100')
  void plugin
    .request('openproject.state.get', {
      project: initialProject,
      pageSize: initialPageSize
    })
    .then((snapshot) => {
      syncDraftsFromSnapshot(snapshot)
    })
}

export default function Panel() {
  const locale = read(localeAtom)
  const tr = createTranslator(locale)
  const snapshot = read(stateAtom)
  const activeTab = read(activeTabAtom)
  const feedback = read(feedbackMessageAtom)
  const projectFilter = read(projectFilterAtom)
  const scopeMode = read(scopeModeAtom)
  const statusFilter = read(statusFilterAtom)
  const priorityFilter = read(priorityFilterAtom)
  const pageSize = read(pageSizeAtom) || '100'
  const searchQuery = read(searchQueryAtom)

  const projects = snapshot?.projects ?? []
  const writableProjects = projects.filter(
    (p) => p.canCreateWorkPackage !== false
  )
  const canCreateAnyTask =
    Boolean(snapshot?.config.hasToken) && writableProjects.length > 0

  const allWorkPackages = snapshot?.workPackages ?? []
  const statuses = snapshot?.statuses ?? []
  const types =
    snapshot?.types && snapshot.types.length > 0
      ? snapshot.types
      : DEFAULT_OPENPROJECT_TYPES
  const priorities =
    snapshot?.priorities && snapshot.priorities.length > 0
      ? snapshot.priorities
      : [
          { id: 1, name: 'Low', color: '#C5F6FA' },
          { id: 2, name: 'Normal', color: '#74C0FC' },
          { id: 3, name: 'High', color: '#F59F00' },
          { id: 4, name: 'Immediate', color: '#FA5252' }
        ]
  const principals = snapshot?.principals ?? []
  const detectedAgents = snapshot?.detectedAgents ?? []
  const selectedTicket = snapshot?.selectedTicket ?? null
  const activities = snapshot?.activities ?? []
  const ticketDetailExpanded = read(ticketDetailExpandedAtom)

  const currentUserName = (snapshot?.currentUser || '').toLowerCase().trim()
  const closedStatusMap = new Map<string, boolean>()
  for (const st of statuses) {
    closedStatusMap.set(
      st.name.toLowerCase().trim(),
      st.isClosed ?? isStatusClosedName(st.name)
    )
  }
  const isWorkPackageClosed = (statusName: string): boolean => {
    const key = statusName.toLowerCase().trim()
    return closedStatusMap.get(key) ?? isStatusClosedName(statusName)
  }

  // Compute project-scoped work packages for status counts
  const projectScopedWorkPackages = allWorkPackages.filter((wp) => {
    if (projectFilter && projectFilter !== 'all') {
      return (
        wp.projectIdentifier === projectFilter ||
        wp.project === projectFilter ||
        String(wp.id) === projectFilter
      )
    }
    return true
  })

  const statusCounts = new Map<string, number>()
  for (const wp of projectScopedWorkPackages) {
    const key = wp.status.toLowerCase().trim()
    statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1)
  }

  // Build dynamic Status options from OpenProject /api/v3/statuses + discovered statuses
  const discoveredStatuses = [...statuses]
  for (const wp of allWorkPackages) {
    const exists = discoveredStatuses.some(
      (s) => s.name.toLowerCase().trim() === wp.status.toLowerCase().trim()
    )
    if (!exists && wp.status) {
      discoveredStatuses.push({
        id: wp.statusId || discoveredStatuses.length + 100,
        name: wp.status,
        isClosed: isStatusClosedName(wp.status)
      })
    }
  }

  const activeFilterStatuses = discoveredStatuses.filter((s) => {
    const key = s.name.toLowerCase().trim()
    const count = statusCounts.get(key) ?? 0
    if (count === 0 && UNUSED_BOILERPLATE_STATUSES.has(key)) {
      return false
    }
    return true
  })

  const statusFilterOptions = [
    {
      value: 'all',
      label: tr('filters.allStatuses', { count: activeFilterStatuses.length })
    },
    ...activeFilterStatuses.map((s) => {
      const key = s.name.toLowerCase().trim()
      const count = statusCounts.get(key) ?? 0
      const isClosedOpt = s.isClosed ?? isStatusClosedName(s.name)
      return {
        value: s.name,
        label: isClosedOpt && count === 0 ? s.name : `${s.name} (${count})`
      }
    })
  ]

  const statusTransitionOptions =
    discoveredStatuses.length > 0
      ? discoveredStatuses.map((s) => ({
          value: s.name,
          label: s.name,
          color: s.color
        }))
      : [
          { value: 'New', label: 'New', color: '#008BD0' },
          { value: 'In specification', label: 'In specification', color: '#74C0FC' },
          { value: 'Specified', label: 'Specified', color: '#74C0FC' },
          { value: 'Confirmed', label: 'Confirmed', color: '#B197FC' },
          { value: 'To be scheduled', label: 'To be scheduled', color: '#F59F00' },
          { value: 'Scheduled', label: 'Scheduled', color: '#12B886' },
          { value: 'In progress', label: 'In progress', color: '#CC5DE8' },
          { value: 'Developed', label: 'Developed', color: '#8CE99A' },
          { value: 'In testing', label: 'In testing', color: '#22B8CF' },
          { value: 'Tested', label: 'Tested', color: '#12B886' },
          { value: 'Test failed', label: 'Test failed', color: '#FA5252' },
          { value: 'Closed', label: 'Closed', color: '#DEE2E6' },
          { value: 'On hold', label: 'On hold', color: '#FD7E14' },
          { value: 'Rejected', label: 'Rejected', color: '#FA5252' }
        ]

  // Build Principal / Member options for Assignee & Responsible dropdowns
  const discoveredPrincipals = new Map<string, string>()
  for (const p of principals) {
    if (p.id && p.name) {
      discoveredPrincipals.set(String(p.id), p.name)
    }
  }
  for (const wp of allWorkPackages) {
    if (wp.assigneeId && wp.assignee && wp.assignee !== 'Unassigned') {
      discoveredPrincipals.set(String(wp.assigneeId), wp.assignee)
    }
    if (wp.responsibleId && wp.responsible) {
      discoveredPrincipals.set(String(wp.responsibleId), wp.responsible)
    }
  }
  const memberOptions = [
    { value: '0', label: tr('filters.unassignedOption') },
    ...Array.from(discoveredPrincipals.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => ({ value: id, label: name }))
  ]

  const projectOptions = [
    {
      value: 'all',
      label: tr('filters.allProjects', { count: projects.length })
    },
    ...projects.map((p) => ({
      value: p.identifier,
      label: p.name
    }))
  ]

  const filteredTickets = allWorkPackages.filter((wp) => {
    if (projectFilter && projectFilter !== 'all') {
      if (
        wp.projectIdentifier !== projectFilter &&
        wp.project !== projectFilter &&
        String(wp.id) !== projectFilter
      ) {
        return false
      }
    }
    if (scopeMode === 'my_todos') {
      if (isWorkPackageClosed(wp.status)) {
        return false
      }
      if (currentUserName) {
        const assigneeLower = wp.assignee.toLowerCase().trim()
        const responsibleLower = (wp.responsible || '').toLowerCase().trim()
        if (
          !assigneeLower.includes(currentUserName) &&
          !responsibleLower.includes(currentUserName)
        ) {
          return false
        }
      } else if (wp.assignee === 'Unassigned' && !wp.responsible) {
        return false
      }
    }
    if (statusFilter === 'open' || !statusFilter || statusFilter === 'all') {
      if (isWorkPackageClosed(wp.status)) {
        return false
      }
    } else if (statusFilter === 'closed') {
      if (!isWorkPackageClosed(wp.status)) {
        return false
      }
    } else {
      if (wp.status.toLowerCase().trim() !== statusFilter.toLowerCase().trim()) {
        return false
      }
    }
    if (priorityFilter && priorityFilter !== 'all') {
      if (
        (wp.priority || '').toLowerCase().trim() !==
        priorityFilter.toLowerCase().trim()
      ) {
        return false
      }
    }
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.trim().toLowerCase()
      const hay =
        `#${wp.id} ${wp.subject} ${wp.project} ${wp.status} ${wp.priority || ''} ${wp.assignee} ${wp.responsible || ''}`.toLowerCase()
      if (!hay.includes(q)) {
        return false
      }
    }
    return true
  })

  const childCountByParentId = new Map<number, number>()
  for (const wp of allWorkPackages) {
    if (wp.parentId && wp.parentId > 0) {
      childCountByParentId.set(
        wp.parentId,
        (childCountByParentId.get(wp.parentId) ?? 0) + 1
      )
    }
  }

  const hasActiveFilters =
    projectFilter !== 'all' ||
    scopeMode !== 'all' ||
    statusFilter !== 'all' ||
    priorityFilter !== 'all' ||
    searchQuery.trim().length > 0

  function renderWorkPackageCard(wp: OpenProjectWorkPackage) {
    const isExpanded = Boolean(
      selectedTicket?.id === wp.id && ticketDetailExpanded
    )
    const stStyle = getStatusToneStyle(wp.status, wp.statusColor)
    const childCount = Math.max(
      childCountByParentId.get(wp.id) ?? 0,
      wp.childIds ? wp.childIds.length : 0
    )
    const canWriteTicketProject = writableProjects.some(
      (p) =>
        p.identifier === wp.projectIdentifier || p.name === wp.project
    )

    return (
      <Box
        key={String(wp.id)}
        border={stStyle.border}
        background={stStyle.background}
        radius="md"
      >
        <List label={`Work Package #${wp.id}`}>
          <ListItem
            key={String(wp.id)}
            title={`#${wp.id} ${wp.subject}`}
            description={formatWorkPackageRowMeta(wp, locale, childCount)}
            onPress={() => selectTicket(wp.id)}
          />
        </List>
        {isExpanded && selectedTicket ? (
          <Box padding="sm">
            {TicketDetailView({
              locale,
              ticket: selectedTicket,
              allWorkPackages,
              canCreateSubtask: canWriteTicketProject,
              activities,
              statusTransitionOptions,
              memberOptions
            })}
          </Box>
        ) : null}
      </Box>
    )
  }

  const openProjectScopedWorkPackages = projectScopedWorkPackages.filter(
    (wp) => !isWorkPackageClosed(wp.status)
  )
  const closedProjectScopedWorkPackages = projectScopedWorkPackages.filter(
    (wp) => isWorkPackageClosed(wp.status)
  )
  const isFilteringClosed =
    statusFilter === 'closed' || isWorkPackageClosed(statusFilter)
  const effectiveTotalCount = isFilteringClosed
    ? closedProjectScopedWorkPackages.length
    : openProjectScopedWorkPackages.length

  return (
    <Stack gap="sm">
      {HeaderBar({
        locale,
        snapshot,
        filteredCount: filteredTickets.length,
        totalCount: effectiveTotalCount,
        projectCount: projects.length
      })}

      {feedback ? (
        <Callout tone={feedback.tone} title={tr('callout.statusTitle')}>
          <Text size="xs">{feedback.text}</Text>
        </Callout>
      ) : null}

      {snapshot?.lastError ? (
        <Callout tone="warning" title={tr('callout.providerWarningTitle')}>
          <Text size="xs">{snapshot.lastError}</Text>
        </Callout>
      ) : null}

      <Tabs
        label="OpenProject Views"
        value={activeTab}
        onChange={(nextTab) => set(activeTabAtom, nextTab)}
      >
        <Tab value="tickets" label={tr('tabs.tickets')}>
          <Stack gap="sm">
            {TicketFilters({
              locale,
              scopeMode,
              projectFilter,
              statusFilter,
              priorityFilter,
              pageSize,
              searchQuery,
              priorities,
              projectOptions,
              statusFilterOptions,
              hasActiveFilters
            })}

            {snapshot === null ? (
              <Spinner label={tr('tickets.loading')} />
            ) : !snapshot.config.hasToken && allWorkPackages.length === 0 ? (
              <Card
                title={tr('tickets.onboardingTitle')}
                description={tr('tickets.onboardingDesc')}
              >
                <Row gap="xs" align="center" wrap>
                  <Button
                    size="xs"
                    tone="accent"
                    onPress={() => set(activeTabAtom, 'setup')}
                  >
                    {tr('tickets.configureButton')}
                  </Button>
                </Row>
              </Card>
            ) : filteredTickets.length === 0 ? (
              <EmptyState
                title={tr('tickets.emptyTitle')}
                description={tr('tickets.emptyDesc')}
              />
            ) : (
              <Stack gap="xs">
                {filteredTickets
                  .slice(0, Number(pageSize) || 100)
                  .map((wp) => renderWorkPackageCard(wp))}
                <Box height={180} />
              </Stack>
            )}
          </Stack>
        </Tab>

        <Tab
          value="create"
          label={tr('tabs.newTask')}
          disabled={!canCreateAnyTask}
        >
          {CreateTicketView({
            locale,
            writableProjects,
            allWorkPackages,
            types,
            priorities,
            memberOptions
          })}
        </Tab>

        <Tab value="setup" label={tr('tabs.setup')}>
          {SetupView({
            locale,
            snapshot,
            detectedAgents
          })}
        </Tab>
      </Tabs>
    </Stack>
  )
}
