/** The line drawn under each subagent's `Agent(…)` row in the transcript, by the Agent call's tool use id. */
export type RowLines = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'arlesh-notify': { rows: RowLines }
  }
}
