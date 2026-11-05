import {
  Badge,
  Box,
  Button,
  Input,
  plugin,
  Row,
  Select,
  Separator,
  set,
  Stack,
  Text
} from 'orca'
import { createTranslator, type UiLocale } from '../i18n'
import type { OpenProjectPriorityItem } from '../protocol'
import {
  changePageSize,
  changeProjectFilter,
  changeStatusFilter,
  priorityFilterAtom,
  resetAllFilters,
  scopeModeAtom,
  searchQueryAtom
} from '../state/panel-state'
import {
  getPriorityToneStyle
} from '../utils/openproject-tones'

export interface TicketFiltersProps {
  locale: UiLocale
  scopeMode: 'all' | 'my_todos'
  projectFilter: string
  statusFilter: string
  priorityFilter: string
  pageSize: string
  searchQuery: string
  priorities: OpenProjectPriorityItem[]
  projectOptions: Array<{ value: string; label: string }>
  statusFilterOptions: Array<{ value: string; label: string }>
  hasActiveFilters: boolean
}

const PAGE_SIZES = ['50', '100', '200'] as const

export function TicketFilters({
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
}: TicketFiltersProps) {
  const tr = createTranslator(locale)

  return (
    <Stack gap="sm">
      {/* Row 1: Mine toggle switch | All Priority + OpenProject Priority pills */}
      <Row gap="xs" align="center" wrap>
        <Button
          size="xs"
          variant={scopeMode === 'my_todos' ? 'solid' : 'outline'}
          tone={scopeMode === 'my_todos' ? 'accent' : 'neutral'}
          tooltip={tr('filters.mineTooltip')}
          onPress={() =>
            set(scopeModeAtom, scopeMode === 'my_todos' ? 'all' : 'my_todos')
          }
        >
          {tr('filters.mine')}
        </Button>
        <Text size="sm" muted>
          |
        </Text>
        <Button
          size="xs"
          variant={priorityFilter === 'all' ? 'solid' : 'outline'}
          tone={priorityFilter === 'all' ? 'accent' : 'neutral'}
          onPress={() => set(priorityFilterAtom, 'all')}
        >
          {tr('filters.allPriority')}
        </Button>
        {priorities.map((p) => {
          const isSelected =
            priorityFilter.toLowerCase().trim() === p.name.toLowerCase().trim()
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
                onPress={() =>
                  set(priorityFilterAtom, isSelected ? 'all' : p.name)
                }
              >
                {p.name}
              </Button>
            </Box>
          )
        })}
      </Row>
      <Separator />

      {/* Full-Width Stacked Filters: Project, Status, Search */}
      <Stack gap="xs">
        <Select
          label={tr('filters.projectLabel')}
          labelHidden
          value={projectFilter}
          options={projectOptions}
          onChange={(val) => {
            void changeProjectFilter(val)
          }}
        />
        <Select
          label={tr('filters.statusLabel')}
          labelHidden
          value={statusFilter}
          options={statusFilterOptions}
          onChange={(val) => {
            void changeStatusFilter(val)
          }}
        />
        <Input
          label={tr('filters.searchLabel')}
          labelHidden
          type="search"
          placeholder={tr('filters.searchPlaceholder')}
          value={searchQuery}
          onChange={(val) => set(searchQueryAtom, val)}
        />
      </Stack>

      {/* Compact Per-Page Selector (50 / 100 / 200) + Active Filter Reset */}
      <Row justify="between" align="center" gap="xs" wrap>
        <Row gap="xs" align="center" wrap>
          <Text size="xs" muted>
            {tr('filters.pageSizeLabel')}:
          </Text>
          {PAGE_SIZES.map((size) => {
            const isSelected = pageSize === size
            return (
              <Button
                key={size}
                size="xs"
                variant={isSelected ? 'solid' : 'outline'}
                tone={isSelected ? 'accent' : 'neutral'}
                onPress={() => {
                  if (!isSelected) {
                    void changePageSize(size)
                  }
                }}
              >
                {size}
              </Button>
            )
          })}
        </Row>
        {hasActiveFilters ? (
          <Row gap="xs" align="center" wrap>
            {projectFilter !== 'all' ? (
              <Badge tone="neutral">{projectFilter}</Badge>
            ) : null}
            <Button size="xs" variant="ghost" onPress={resetAllFilters}>
              {tr('filters.reset')}
            </Button>
          </Row>
        ) : null}
      </Row>
      <Separator />
    </Stack>
  )
}
