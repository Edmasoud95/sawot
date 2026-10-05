import {analysisFileUrl,normalizeAnalysisEvent,safeSource} from '../../lib/chatAnalysis';
import ChatLink from './ChatLink';

type Props = {conversationId:string;events:unknown[]};

function FileLink({conversationId,file,source=false}:{conversationId:string;file:any;source?:boolean}) {
  const href=analysisFileUrl(conversationId,file.id);
  if(!href)return null;
  const origin=source&&safeSource(file.source?.finalUrl);
  return <span className="inline-flex max-w-full flex-wrap gap-2 break-all">
    <a className="underline underline-offset-2" href={href} target="_blank" rel="noopener noreferrer" download>{file.name}</a>
    {origin&&<ChatLink className="text-zinc-500 underline" href={origin}>Source</ChatLink>}
  </span>;
}

export function AnalysisFiles({conversationId,events}:Props) {
  const files=new Map<string,any>();
  for(const raw of events??[]) {
    const event=normalizeAnalysisEvent(raw);
    if(event?.tool==='run_python')for(const file of event.result?.files??[])files.set(file.id,file);
  }
  if(!files.size)return null;
  return <div aria-label="Generated files" className="my-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-300">
    {[...files.values()].map(file=><FileLink key={file.id} conversationId={conversationId} file={file}/>)}
  </div>;
}

export default function AnalysisActivity({conversationId,events}:Props){
  const items=(events??[]).map(normalizeAnalysisEvent).filter(Boolean);
  if(!items.length)return null;
  const running=items.filter(e=>e.phase==='start');
  const downloads=items.filter(e=>e.tool==='download_file').length;
  const runs=items.length-downloads;
  const failures=items.filter(e=>e.phase==='error').length;
  const counts=[downloads&&`${downloads} download${downloads===1?'':'s'}`,runs&&`${runs} code run${runs===1?'':'s'}`].filter(Boolean).join(' · ');
  const current=running[running.length-1];
  // Native disclosure state survives event updates; never force it open on a new call.
  return <details className="my-3 text-xs text-zinc-400" aria-label="File analysis">
    <summary className="min-h-11 cursor-pointer py-3 leading-relaxed">
      <span role="status" className={current?'thinking-shimmer':''}>
        {current?`${current.tool==='run_python'?'Running code…':'Downloading files…'} · ${items.length} step${items.length===1?'':'s'}`:counts}
      </span>
      {failures>0&&<span className="ml-2 text-amber-300/80">{failures} failed attempt{failures===1?'':'s'}</span>}
    </summary>
    <ol className="ml-1 space-y-3 border-l border-white/10 py-1 pl-4">
      {items.map((e,index)=>{
        const active=e.phase==='start';
        const label=e.tool==='run_python'?'Code execution':'File download';
        return <li key={e.id} className="min-w-0">
          <p className="text-zinc-300">{index+1}. {label} <span className="text-zinc-500">· {active?'Running':e.phase==='error'?'Failed':'Complete'}</span></p>
          {e.error&&<p className="mt-1 text-red-300">{e.error}</p>}
          {(e.code||e.result)&&<details className="mt-1">
            <summary className="cursor-pointer py-2">Code and output</summary>
            {e.code&&<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words py-2"><code>{e.code}</code></pre>}
            {e.result&&<><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words">{e.result.stdout}{e.result.stderr?`\n${e.result.stderr}`:''}</pre>{e.result.truncated&&<p>Output truncated.</p>}</>}
          </details>}
          {e.file&&<div className="mt-1"><FileLink conversationId={conversationId} file={e.file} source/></div>}
        </li>;
      })}
    </ol>
  </details>;
}
