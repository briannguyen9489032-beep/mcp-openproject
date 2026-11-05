import { Badge, Button, Heading, Row, set } from 'orca'
import { createTranslator, type UiLocale } from '../i18n'
import type { OpenProjectStateSnapshot } from '../protocol'
import { localeAtom, refreshAll } from '../state/panel-state'
import { extractHostLabel } from '../utils/openproject-tones'

export interface HeaderBarProps {
  locale: UiLocale
  snapshot: OpenProjectStateSnapshot | null
  filteredCount: number
  totalCount: number
  projectCount: number
}

export function HeaderBar({
  locale,
  snapshot,
  filteredCount,
  totalCount,
  projectCount
}: HeaderBarProps) {
  const tr = createTranslator(locale)
  const hostLabel = extractHostLabel(snapshot?.config.baseUrl || '')
  const countBadgeText =
    snapshot === null
      ? '...'
      : snapshot.config.hasToken
        ? filteredCount !== totalCount
          ? `${filteredCount} / ${totalCount}`
          : `${totalCount}`
        : tr('header.setupBadge')

  return (
    <Row justify="between" align="center" gap="xs" wrap>
      <Row gap="xs" align="center">
        <Heading level={3}>OpenProject</Heading>
        <Badge
          tone={
            snapshot === null
              ? 'neutral'
              : snapshot.config.hasToken
                ? 'success'
                : 'warning'
          }
        >
          {countBadgeText}
        </Badge>
      </Row>
      <Row gap="xs" align="center">
        <Button
          size="xs"
          variant="outline"
          tooltip={tr('header.switchLangTooltip')}
          onPress={() => set(localeAtom, locale === 'vi' ? 'en' : 'vi')}
        >
          {locale.toUpperCase()}
        </Button>
        <Button
          size="xs"
          variant="outline"
          tooltip={
            snapshot?.config.hasToken
              ? tr('header.syncTooltipConfigured', {
                  filteredCount,
                  taskCount: totalCount,
                  projectCount,
                  host: hostLabel
                })
              : tr('header.syncTooltipUnconfigured')
          }
          onPress={refreshAll}
        >
          {tr('header.syncButton')}
        </Button>
      </Row>
    </Row>
  )
}
