import { resourceBytes, resourcePercent, type ResourceSnapshot } from "../lib/resources";

export default function ResourcePanel({ snapshot, error }: { snapshot: ResourceSnapshot | null; error: boolean }) {
  if (!snapshot) return <p className="dbg-empty">{error ? "Resource counters unavailable. Check the backend connection." : "Loading resource counters…"}</p>;
  return (
    <div className="dbg-resources">
      <div className="dbg-resource-head">
        <span>{snapshot.cpu.name} · {snapshot.cpu.cores} logical cores</span>
        <span>Updated {new Date(snapshot.sampledAt).toLocaleTimeString()} · refreshes every 5 s</span>
      </div>
      <div className="dbg-resource-table-wrap">
        <table className="dbg-resource-table">
          <caption>SAWOT components</caption>
          <thead><tr><th scope="col">Component</th><th scope="col">CPU</th><th scope="col">RAM</th><th scope="col">VRAM</th></tr></thead>
          <tbody>
            {snapshot.components.map(c => <tr key={c.id}>
              <th scope="row">{c.name}{c.pid !== null && <span className="dbg-resource-pid">PID {c.pid}{c.includedIn && ` · included in ${c.includedIn === "backend" ? "Backend" : "Speech"}`}</span>}</th>
              <td>{resourcePercent(c.cpuPercent)}</td><td>{resourceBytes(c.ramBytes)}</td><td>{resourceBytes(c.vramBytes)}</td>
            </tr>)}
          </tbody>
          <tfoot><tr><th scope="row">SAWOT total</th><td>{resourcePercent(snapshot.total.cpuPercent)}</td>
            <td>{resourceBytes(snapshot.total.ramBytes)}</td><td>{resourceBytes(snapshot.total.vramBytes)}</td></tr></tfoot>
        </table>
      </div>
      {snapshot.gpus.map(g => <section key={g.uuid} className="dbg-resource-gpu">
        <h4>{g.name} <span>device-wide</span></h4>
        <dl className="dbg-context">
          <div><dt>GPU activity</dt><dd>{resourcePercent(g.utilizationPercent)}</dd></div>
          <div><dt>VRAM used / total</dt><dd>{resourceBytes(g.vramUsedBytes)} / {resourceBytes(g.vramTotalBytes)}</dd></div>
        </dl>
      </section>)}
      {!snapshot.gpus.length && <p className="dbg-empty">GPU / VRAM: N/A</p>}
      <ul className="dbg-resource-notes">{snapshot.notes.map(note => <li key={note}>{note}</li>)}</ul>
    </div>
  );
}
