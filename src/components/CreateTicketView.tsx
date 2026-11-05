import {
  Box,
  Button,
  Callout,
  Input,
  read,
  Row,
  Select,
  set,
  Stack,
  Text,
  Textarea
} from 'orca'
import { createTranslator, type UiLocale } from '../i18n'
import type {
  OpenProjectPriorityItem,
  OpenProjectProject,
  OpenProjectTypeItem,
  OpenProjectWorkPackage
} from '../protocol'
import {
  createNewTicket,
  newTicketAssigneeAtom,
  newTicketDescAtom,
  newTicketParentAtom,
  newTicketPriorityAtom,
  newTicketProjectAtom,
  newTicketResponsibleAtom,
  newTicketSubjectAtom,
  newTicketTypeAtom
} from '../state/panel-state'
import {
  DEFAULT_OPENPROJECT_TYPES,
  getPriorityToneStyle,
  getTypeToneStyle
} from '../utils/openproject-tones'

export interface CreateTicketViewProps {
  locale: UiLocale
  writableProjects: OpenProjectProject[]
  allWorkPackages: OpenProjectWorkPackage[]
  types: OpenProjectTypeItem[]
  priorities: OpenProjectPriorityItem[]
  memberOptions: Array<{ value: string; label: string }>
}

export function CreateTicketView({
  locale,
  writableProjects,
  allWorkPackages,
  types,
  priorities,
  memberOptions
}: CreateTicketViewProps) {
  const tr = createTranslator(locale)
  const canCreate = writableProjects.length > 0

  const availableTypes =
    types && types.length > 0 ? types : DEFAULT_OPENPROJECT_TYPES

  const selectedProject =
    read(newTicketProjectAtom) || writableProjects[0]?.identifier || 'none'
  const parentDraft = read(newTicketParentAtom) || '0'
  const subjectDraft = read(newTicketSubjectAtom)
  const typeDraft = read(newTicketTypeAtom) || availableTypes[0]?.name || 'Task'
  const priorityDraft = read(newTicketPriorityAtom) || 'Normal'
  const assigneeDraft = read(newTicketAssigneeAtom) || '0'
  const responsibleDraft = read(newTicketResponsibleAtom) || '0'
  const descDraft = read(newTicketDescAtom)

  const projectOptions = writableProjects.map((p) => ({
    value: p.identifier,
    label: p.name
  }))

  const parentOptions = [
    { value: '0', label: tr('create.noParentOption') },
    ...allWorkPackages
      .filter(
        (wp) =>
          wp.projectIdentifier === selectedProject ||
          wp.project === selectedProject
      )
      .map((wp) => ({
        value: String(wp.id),
        label: `#${wp.id} [${wp.type}] ${wp.subject}`
      }))
  ]

  return (
    <Stack gap="sm">
      {!canCreate ? (
        <Callout tone="warning" title={tr('create.unauthorizedTitle')}>
          <Text size="xs">{tr('create.unauthorizedDesc')}</Text>
        </Callout>
      ) : null}

      <Select
        label={tr('create.projectLabel')}
        value={selectedProject}
        options={
          projectOptions.length > 0
            ? projectOptions
            : [{ value: 'none', label: '-' }]
        }
        disabled={!canCreate}
        onChange={(val) => {
          set(newTicketProjectAtom, val)
          set(newTicketParentAtom, '0')
        }}
      />
      <Select
        label={tr('create.parentLabel')}
        value={parentDraft}
        options={parentOptions}
        disabled={!canCreate}
        onChange={(val) => set(newTicketParentAtom, val)}
      />
      <Input
        label={tr('create.subjectLabel')}
        placeholder={tr('create.subjectPlaceholder')}
        value={subjectDraft}
        disabled={!canCreate}
        onChange={(val) => set(newTicketSubjectAtom, val)}
      />
      <Stack gap="xs">
        <Text size="xs" weight="medium">
          {tr('create.typeLabel')}
        </Text>
        <Row gap="xs" align="center" wrap>
          {availableTypes.map((typeItem) => {
            const isSelected =
              typeDraft.toLowerCase().trim() ===
              typeItem.name.toLowerCase().trim()
            const tStyle = getTypeToneStyle(typeItem.name, typeItem.color)
            return (
              <Box
                key={String(typeItem.id || typeItem.name)}
                border={tStyle.border}
                background={tStyle.background}
                radius="md"
              >
                <Button
                  size="xs"
                  variant={isSelected ? 'solid' : 'ghost'}
                  tone={isSelected ? 'accent' : tStyle.textTone ?? 'neutral'}
                  disabled={!canCreate}
                  onPress={() => set(newTicketTypeAtom, typeItem.name)}
                >
                  {typeItem.name}
                </Button>
              </Box>
            )
          })}
        </Row>
      </Stack>
      <Stack gap="xs">
        <Text size="xs" weight="medium">
          {tr('create.priorityLabel')}
        </Text>
        <Row gap="xs" align="center" wrap>
          {priorities.map((p) => {
            const isSelected =
              priorityDraft.toLowerCase().trim() ===
              p.name.toLowerCase().trim()
            const pStyle = getPriorityToneStyle(p.name, p.color)
            return (
              <Box
                key={String(p.id)}
                border={pStyle.border}
                background={pStyle.background}
                radius="md"
              >
                <Button
                  size="xs"
                  variant={isSelected ? 'solid' : 'ghost'}
                  tone={isSelected ? 'accent' : pStyle.textTone ?? 'neutral'}
                  disabled={!canCreate}
                  onPress={() => set(newTicketPriorityAtom, p.name)}
                >
                  {p.name}
                </Button>
              </Box>
            )
          })}
        </Row>
      </Stack>
      <Select
        label={tr('ticket.assignee')}
        value={assigneeDraft}
        options={memberOptions}
        disabled={!canCreate}
        onChange={(val) => set(newTicketAssigneeAtom, val)}
      />
      <Select
        label={tr('ticket.responsible')}
        value={responsibleDraft}
        options={memberOptions}
        disabled={!canCreate}
        onChange={(val) => set(newTicketResponsibleAtom, val)}
      />
      <Textarea
        label={tr('create.descriptionLabel')}
        placeholder={tr('create.descriptionPlaceholder')}
        rows={4}
        value={descDraft}
        disabled={!canCreate}
        onChange={(val) => set(newTicketDescAtom, val)}
      />
      <Row gap="xs" align="center" wrap>
        <Button
          size="xs"
          tone="accent"
          disabled={
            !canCreate ||
            !subjectDraft.trim() ||
            !selectedProject ||
            selectedProject === 'none'
          }
          onPress={createNewTicket}
        >
          {tr('create.submitButton')}
        </Button>
      </Row>
      <Box height={180} />
    </Stack>
  )
}
