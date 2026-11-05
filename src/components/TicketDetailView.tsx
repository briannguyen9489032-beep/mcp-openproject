import {
  Box,
  Button,
  Card,
  Collapsible,
  IconButton,
  Input,
  List,
  ListItem,
  Markdown,
  read,
  Row,
  Select,
  Separator,
  set,
  Stack,
  Text
} from 'orca'
import { createTranslator, type UiLocale } from '../i18n'
import { formatWorktreeBranchSlug } from '../openproject-api'
import type {
  OpenProjectActivity,
  OpenProjectWorkPackage
} from '../protocol'
import {
  commentDraftAtom,
  confirmTicketUpdate,
  descriptionOpenAtom,
  launchAgentForSelectedTicket,
  nextAssigneeDraftAtom,
  nextResponsibleDraftAtom,
  nextStatusDraftAtom,
  selectTicket,
  startCreatingSubtask,
  ticketDetailExpandedAtom
} from '../state/panel-state'
import {
  formatShortDate,
  formatWorkPackageRowMeta,
  getPriorityToneStyle,
  getStatusToneStyle,
  getTypeToneStyle
} from '../utils/openproject-tones'

export interface TicketDetailViewProps {
  locale: UiLocale
  ticket: OpenProjectWorkPackage
  allWorkPackages: OpenProjectWorkPackage[]
  canCreateSubtask?: boolean
  activities: OpenProjectActivity[]
  statusTransitionOptions: Array<{ value: string; label: string; color?: string }>
  memberOptions: Array<{ value: string; label: string }>
}

export function TicketDetailView({
  locale,
  ticket,
  allWorkPackages,
  canCreateSubtask,
  activities,
  statusTransitionOptions,
  memberOptions
}: TicketDetailViewProps) {
  const tr = createTranslator(locale)
  const assigneeDraft = read(nextAssigneeDraftAtom) || '0'
  const responsibleDraft = read(nextResponsibleDraftAtom) || '0'

  const ticketMemberOptions = [...memberOptions]
  if (
    ticket.assigneeId &&
    !ticketMemberOptions.some((o) => o.value === String(ticket.assigneeId))
  ) {
    ticketMemberOptions.push({
      value: String(ticket.assigneeId),
      label: ticket.assignee
    })
  }
  if (
    ticket.responsibleId &&
    !ticketMemberOptions.some((o) => o.value === String(ticket.responsibleId))
  ) {
    ticketMemberOptions.push({
      value: String(ticket.responsibleId),
      label: ticket.responsible || `User #${ticket.responsibleId}`
    })
  }

  const branchSlug = formatWorktreeBranchSlug(ticket.id, ticket.subject)
  const typeStyle = getTypeToneStyle(ticket.type, ticket.typeColor)
  const prioStyle = getPriorityToneStyle(ticket.priority, ticket.priorityColor)

  const parentWp = ticket.parentId
    ? allWorkPackages.find((w) => w.id === ticket.parentId)
    : undefined
  const fullParentSubject =
    ticket.parentSubject || parentWp?.subject || ''
  const subtasks = allWorkPackages
    .filter((w) => w.parentId === ticket.id)
    .sort((a, b) => a.id - b.id)

  return (
    <Stack gap="md">
      <Separator />
      {/* Row 1: Launch Agent + Bordered Type Box + Bordered Priority Box + Pinned Collapse IconButton */}
      <Row justify="between" align="center" gap="xs">
        <Row gap="xs" align="center" wrap>
          <Button
            size="xs"
            tone="accent"
            tooltip={tr('ticket.launchAgentTooltip', { branch: branchSlug })}
            onPress={() => launchAgentForSelectedTicket(ticket.id)}
          >
            {tr('ticket.launchAgent')}
          </Button>
          <Box
            border={typeStyle.border}
            background={typeStyle.background}
            radius="sm"
            padding="xs"
          >
            <Text size="xs" tone={typeStyle.textTone}>
              {ticket.type}
            </Text>
          </Box>
          <Box
            border={prioStyle.border}
            background={prioStyle.background}
            radius="sm"
            padding="xs"
          >
            <Text size="xs" tone={prioStyle.textTone}>
              {tr('ticket.priorityBadge', { priority: ticket.priority })}
            </Text>
          </Box>
        </Row>
        <IconButton
          size="xs"
          variant="outline"
          icon="collapse"
          label={tr('ticket.close')}
          tooltip={tr('ticket.closeTooltip')}
          onPress={() => set(ticketDetailExpandedAtom, false)}
        />
      </Row>

      {/* Row 2: Parent Jump + Add Subtask + Bordered Updated Date */}
      {ticket.parentId || canCreateSubtask || ticket.updatedAt ? (
        <Row justify="between" align="center" gap="xs" wrap>
          <Row gap="xs" align="center" wrap>
            {ticket.parentId ? (
              <Button
                size="xs"
                variant="outline"
                tooltip={
                  fullParentSubject
                    ? `#${ticket.parentId} ${fullParentSubject}`
                    : tr('ticket.parentTooltip', { id: ticket.parentId })
                }
                onPress={() => selectTicket(ticket.parentId!)}
              >
                {tr('ticket.parentButton', {
                  id: ticket.parentId
                })}
              </Button>
            ) : null}
            {canCreateSubtask ? (
              <Button
                size="xs"
                variant="outline"
                tooltip={tr('ticket.addSubtaskTooltip', { id: ticket.id })}
                onPress={() =>
                  startCreatingSubtask(ticket.projectIdentifier, ticket.id)
                }
              >
                {tr('ticket.addSubtask')}
              </Button>
            ) : null}
          </Row>
          {ticket.updatedAt ? (
            <Box
              border="neutral"
              background="card"
              radius="sm"
              padding="xs"
            >
              <Text size="xs" muted>
                {formatShortDate(ticket.updatedAt)}
              </Text>
            </Box>
          ) : null}
        </Row>
      ) : null}

      {subtasks.length > 0 ? (
        <Collapsible
          title={tr('ticket.subtasksTitle', { count: subtasks.length })}
          defaultOpen={true}
        >
          <Stack gap="xs">
            {subtasks.map((child) => {
              const childStyle = getStatusToneStyle(
                child.status,
                child.statusColor
              )
              return (
                <Box
                  key={String(child.id)}
                  border={childStyle.border}
                  background={childStyle.background}
                  radius="sm"
                >
                  <List label={`Subtask #${child.id}`}>
                    <ListItem
                      key={String(child.id)}
                      title={`↳ #${child.id} ${child.subject}`}
                      description={formatWorkPackageRowMeta(child, locale)}
                      onPress={() => selectTicket(child.id)}
                    />
                  </List>
                </Box>
              )
            })}
          </Stack>
        </Collapsible>
      ) : null}

      {ticket.description ? (
        <Stack gap="xs">
          <Collapsible
            title={tr('ticket.description')}
            open={read(descriptionOpenAtom)}
            onChange={(nextOpen) => set(descriptionOpenAtom, Boolean(nextOpen))}
          />
          {read(descriptionOpenAtom) ? (
            <Box
              width="100%"
              minHeight={140}
              maxHeight={190}
              scroll="y"
              border="neutral"
              background="card"
              radius="sm"
              padding="sm"
            >
              <Box padding="xs">
                <Markdown content={ticket.description} />
              </Box>
            </Box>
          ) : null}
        </Stack>
      ) : null}

      <Stack gap="sm">
        <Stack gap="xs">
          <Text size="xs" weight="medium">
            {tr('ticket.transitionStatus')}
          </Text>
          <Row gap="xs" align="center" wrap>
            {statusTransitionOptions.map((opt) => {
              const currentStatus = read(nextStatusDraftAtom) || ticket.status
              const isSelected =
                currentStatus.toLowerCase().trim() ===
                opt.value.toLowerCase().trim()
              const stStyle = getStatusToneStyle(opt.value, opt.color)
              return (
                <Box
                  key={opt.value}
                  border={stStyle.border}
                  background={stStyle.background}
                  radius="md"
                >
                  <Button
                    size="xs"
                    variant={isSelected ? 'solid' : 'ghost'}
                    tone={
                      isSelected
                        ? 'accent'
                        : stStyle.border === 'danger' &&
                            stStyle.background === 'danger'
                          ? 'danger'
                          : 'neutral'
                    }
                    onPress={() => set(nextStatusDraftAtom, opt.value)}
                  >
                    {opt.label}
                  </Button>
                </Box>
              )
            })}
          </Row>
        </Stack>
        <Select
          label={tr('ticket.assignee')}
          value={assigneeDraft}
          options={ticketMemberOptions}
          onChange={(val) => {
            set(nextAssigneeDraftAtom, val)
          }}
        />
        <Select
          label={tr('ticket.responsible')}
          value={responsibleDraft}
          options={ticketMemberOptions}
          onChange={(val) => {
            set(nextResponsibleDraftAtom, val)
          }}
        />
        <Input
          label={tr('ticket.comment')}
          placeholder={tr('ticket.commentPlaceholder')}
          value={read(commentDraftAtom)}
          onChange={(val) => {
            set(commentDraftAtom, val)
          }}
        />
      </Stack>

      <Row gap="xs" align="center" wrap>
        <Button
          size="xs"
          tone="accent"
          onPress={() => confirmTicketUpdate(ticket.id)}
        >
          {tr('ticket.update')}
        </Button>
      </Row>

      {activities.length > 0 ? (
        <Collapsible
          title={tr('ticket.commentsHistory', { count: activities.length })}
          defaultOpen={false}
        >
          <Stack gap="xs">
            {activities.map((act) => (
              <Card
                key={String(act.id)}
                title={act.user}
                description={formatShortDate(act.createdAt)}
              >
                <Text size="xs">{act.comment}</Text>
              </Card>
            ))}
          </Stack>
        </Collapsible>
      ) : null}
    </Stack>
  )
}
