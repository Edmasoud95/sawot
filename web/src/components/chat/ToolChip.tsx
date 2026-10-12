import { ActivityChevron, ActivityLabel, type ToolKind } from './ToolActivity';

const tools: Record<string, { kind: ToolKind; label: string }> = {
  get_entities: { kind: 'home', label: 'Devices checked' },
  call_service: { kind: 'home', label: 'Home Assistant' },
  web_search: { kind: 'search', label: 'Web search' },
  fetch_page: { kind: 'search', label: 'Reading a page' },
  find_in_page: { kind: 'search', label: 'Searching a page' },
  run_python: { kind: 'code', label: 'Code execution' },
  download_file: { kind: 'download', label: 'File download' },
  search_memories: { kind: 'memory', label: 'Memory recall' },
  save_memory: { kind: 'memory', label: 'Saving memory' },
};

export default function ToolChip({ tool }) {
  const { kind, label } = tools[tool.name] ?? { kind: 'tool', label: tool.name.replace(/_/g, ' ') };
  const isError = (typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result ?? '')).includes('"error"');
  const args = tool.args ?? {};
  const detail = [args.area, args.entity_id, (typeof args.service === 'string' ? args.service.replace(/_/g, ' ') : args.domain), args.query].filter(value => typeof value === 'string').join(' · ');
  return <details className="tool-activity" data-error={isError || undefined}>
    <summary className="tool-activity-row">
      <ActivityLabel kind={kind} label={label} detail={isError ? 'Failed' : detail}/>
      <ActivityChevron/>
    </summary>
    <div className="tool-activity-body">
      <p>{tool.name}</p>
      <pre>{JSON.stringify(args, null, 2)}</pre>
      {tool.result && <pre>{typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}</pre>}
    </div>
  </details>;
}
