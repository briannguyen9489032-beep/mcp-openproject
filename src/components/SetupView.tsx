import {
  Box,
  Button,
  Checkbox,
  CodeView,
  Collapsible,
  Input,
  read,
  Row,
  Select,
  set,
  Stack,
  Text
} from 'orca'
import { createTranslator, type UiLocale } from '../i18n'
import type { DetectedAgentCli, OpenProjectStateSnapshot } from '../protocol'
import {
  configAgentDraftAtom,
  configInjectEnvDraftAtom,
  configReadProjectsDraftAtom,
  configTokenDraftAtom,
  configUrlDraftAtom,
  configWriteProjectsDraftAtom,
  registerMcpInSelectedAgent,
  saveConfiguration
} from '../state/panel-state'

export interface SetupViewProps {
  locale: UiLocale
  snapshot: OpenProjectStateSnapshot | null
  detectedAgents: DetectedAgentCli[]
}

export function SetupView({
  locale,
  snapshot,
  detectedAgents
}: SetupViewProps) {
  const tr = createTranslator(locale)

  const installedAgents = detectedAgents.filter((a) => a.installed)
  const agentSelectSource =
    installedAgents.length > 0 ? installedAgents : detectedAgents
  const agentOptions =
    agentSelectSource.length > 0
      ? agentSelectSource.map((a) => ({
          value: a.id,
          label: a.installed
            ? a.label
            : `${a.label}${tr('agent.notDetectedSuffix')}`
        }))
      : [
          { value: 'antigravity', label: 'Antigravity (agy)' },
          { value: 'codex', label: 'Codex CLI' },
          { value: 'claude', label: 'Claude Code' },
          { value: 'gemini', label: 'Gemini CLI' },
          { value: 'cursor-agent', label: 'Cursor Agent' },
          { value: 'opencode', label: 'OpenCode' }
        ]

  const currentAgentId =
    read(configAgentDraftAtom) || snapshot?.config.defaultAgent || 'codex'
  const selectedAgentInfo = detectedAgents.find((a) => a.id === currentAgentId)
  const mcpSnippet =
    selectedAgentInfo?.mcpSnippet ||
    `[mcp_servers.openproject]\ncommand = "cargo"\nargs = ["run", "--release", "--quiet", "--manifest-path", "Cargo.toml"]\n\n[mcp_servers.openproject.env]\nOPENPROJECT_URL = "${snapshot?.config.baseUrl || 'https://openproject.example.com'}"\nOPENPROJECT_API_TOKEN = "<YOUR_OPENPROJECT_API_TOKEN>"\nOPENPROJECT_READ_PROJECTS = "${read(configReadProjectsDraftAtom) || '*'}"\nOPENPROJECT_WRITE_PROJECTS = "${read(configWriteProjectsDraftAtom) || '*'}"`
  const mcpConfigLabel =
    selectedAgentInfo?.mcpConfigPath || '~/.codex/config.toml'
  const isJsonMcpAgent =
    currentAgentId === 'claude' ||
    currentAgentId === 'antigravity' ||
    currentAgentId === 'gemini' ||
    currentAgentId === 'cursor-agent' ||
    currentAgentId === 'opencode' ||
    currentAgentId === 'kilocode'

  return (
    <Stack gap="sm">
      <Input
        label={tr('setup.baseUrlLabel')}
        placeholder="https://openproject.example.com"
        value={read(configUrlDraftAtom)}
        onChange={(val) => set(configUrlDraftAtom, val)}
      />
      <Input
        label={tr('setup.apiTokenLabel')}
        type="password"
        placeholder={
          snapshot?.config.hasToken
            ? tr('setup.apiTokenSavedPlaceholder', {
                source: snapshot.config.tokenSource
              })
            : tr('setup.apiTokenEmptyPlaceholder')
        }
        value={read(configTokenDraftAtom)}
        onChange={(val) => set(configTokenDraftAtom, val)}
      />
      <Select
        label={tr('setup.defaultAgentLabel')}
        value={read(configAgentDraftAtom)}
        options={agentOptions}
        onChange={(val) => set(configAgentDraftAtom, val)}
      />
      <Checkbox
        label={tr('setup.autoInjectLabel')}
        description={tr('setup.autoInjectDesc')}
        checked={read(configInjectEnvDraftAtom)}
        onChange={(checked) => set(configInjectEnvDraftAtom, checked)}
      />
      <Row gap="xs" align="center" wrap>
        <Button size="xs" tone="accent" onPress={saveConfiguration}>
          {tr('setup.saveButton')}
        </Button>
        <Button
          size="xs"
          variant="outline"
          tooltip={tr('setup.registerMcpTooltip', {
            target: mcpConfigLabel
          })}
          onPress={registerMcpInSelectedAgent}
        >
          {tr('setup.registerMcpButton')}
        </Button>
      </Row>

      <Collapsible title={tr('setup.advancedTitle')} defaultOpen={false}>
        <Stack gap="sm">
          <Text size="xs" muted>
            {tr('setup.advancedDesc')}
          </Text>
          <Input
            label={tr('setup.readAllowlistLabel')}
            placeholder="*"
            value={read(configReadProjectsDraftAtom)}
            onChange={(val) => set(configReadProjectsDraftAtom, val)}
          />
          <Input
            label={tr('setup.writeAllowlistLabel')}
            placeholder="*"
            value={read(configWriteProjectsDraftAtom)}
            onChange={(val) => set(configWriteProjectsDraftAtom, val)}
          />
          <Text size="xs" muted>
            {tr('setup.mcpSnippetDesc', { target: mcpConfigLabel })}
          </Text>
          <CodeView
            language={isJsonMcpAgent ? 'json' : 'toml'}
            code={mcpSnippet}
            wrap
            maxHeight="sm"
          />
        </Stack>
      </Collapsible>
      <Box height={180} />
    </Stack>
  )
}
