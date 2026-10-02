export const FILE_ID=/^[0-9a-f]{32}$/;
export const CHAT_ID=/^[0-9a-f]{12}$/;
export interface AnalysisScope { conversationId:string; turnId:string; visibleTurnIds:string[] }
export interface AnalysisFile {id:string; conversationId:string; turnId:string; name:string; size:number; sha256:string; mediaType:string; source?:{originalUrl:string;finalUrl:string}; inputIds:string[]; uploadId?:string}
export type AnalysisStatus='success'|'python_error'|'timeout'|'resource_limit'|'cancelled'|'unavailable'|'policy_rejected'|'busy';
export interface AnalysisResult { inputs?:{id:string;name:string;path:string}[];status:AnalysisStatus;stdout:string;stderr:string;exitCode:number|null;durationMs:number;truncated:boolean;files:AnalysisFile[];error?:string }
export interface AnalysisEvent {id:string;turnId:string;tool:'download_file'|'run_python';phase:'start'|'complete'|'error';inputs?:{id:string;name:string;path:string}[];code?:string;result?:AnalysisResult;file?:AnalysisFile;error?:string}
export interface AnalysisInput {id:string;name:string;data:Buffer}
export interface Readiness {ready:boolean;reason?:string;runtime:string;imageDigest:string}
export interface RunnerResult extends Omit<AnalysisResult,'files'> {outputs:{name:string;data:Buffer}[]}
export interface Runner {ready():Promise<Readiness>;run(code:string,inputs:AnalysisInput[],signal:AbortSignal):Promise<RunnerResult>}

export class AnalysisError extends Error { constructor(public readonly status:AnalysisStatus,message:string){super(message);this.name="AnalysisError";} }
