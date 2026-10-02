import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';

export function publicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.range() !== 'unicast') return false;
    if (parsed.kind() === 'ipv6' && !parsed.match(ipaddr.parse('2000::') as any,3)) return false;
    // Conservatively reject special-use ranges not classified by the library.
    const blocks = parsed.kind() === 'ipv4'
      ? ['192.0.0.0/24','192.0.2.0/24','198.51.100.0/24','203.0.113.0/24']
      : ['2001::/23','2002::/16','3fff::/20','64:ff9b::/96','64:ff9b:1::/48'];
    return !blocks.some(cidr => { const [net,bits] = ipaddr.parseCIDR(cidr); return parsed.kind() === net.kind() && parsed.match(net as any,bits); });
  } catch { return false; }
}
export type Lookup = (host: string) => Promise<string[]>;
const resolve: Lookup = async host => (await lookup(host,{all:true})).map(r=>r.address);
export async function validatePublicUrl(raw: string, resolver: Lookup = resolve) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw)>8192) throw Error('Invalid URL');
  const url=new URL(raw); url.hash='';
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw Error('Only public HTTP/HTTPS on ports 80/443 is allowed');
  const host=url.hostname.replace(/^\[|\]$/g,'');
  const addresses=isIP(host) ? [host] : await resolver(host);
  if (!addresses.length || addresses.some(a=>!publicAddress(a))) throw Error('refusing to fetch a private or reserved destination');
  return {url,address:addresses[0]};
}
export function safeFileName(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f/\\\u202a-\u202e\u2066-\u2069]/g,'_').slice(0,160) || 'file';
}
export interface FetchOptions { signal: AbortSignal; deadlineMs: number; maxBytes: number; oversize: 'reject'|'truncate' }
export interface PublicBody { body: AsyncIterable<Uint8Array>; finalUrl: string; mediaType: string; displayName: string; truncated(): boolean; close(): void }
export interface PublicDeps { resolve?: Lookup; connect?: typeof connect }
function connect(url: URL, address: string, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((accept,reject)=>{
    const request=(url.protocol==='https:'?https:http).request(url,{
      agent:false, signal, maxHeaderSize:16384,
      headers:{Accept:'*/*','Accept-Encoding':'identity','User-Agent':'SAWOT/0.1'},
      lookup: ((_host: string, options: any, cb: any)=> options.all
        ? cb(null,[{address,family:isIP(address)}]) : cb(null,address,isIP(address))) as any,
    },accept);
    request.once('error',reject); request.end();
  });
}
function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((accept,reject)=>{
    const abort=()=>reject(signal.reason ?? Error('Cancelled'));
    signal.throwIfAborted(); signal.addEventListener('abort',abort,{once:true});
    promise.then(accept,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
export async function fetchPublic(raw: string, options: FetchOptions, deps: PublicDeps = {}): Promise<PublicBody> {
  options.signal.throwIfAborted();
  const remaining=options.deadlineMs-performance.now();
  if (remaining<=0) throw new DOMException('Download deadline exceeded','TimeoutError');
  const deadline=new AbortController();
  const timer=setTimeout(()=>deadline.abort(new DOMException('Download deadline exceeded','TimeoutError')),Math.ceil(remaining));
  const signal=AbortSignal.any([options.signal,deadline.signal]);
  let response: IncomingMessage|undefined;
  const close=()=>{clearTimeout(timer); response?.destroy();};
  try {
    let next=raw;
    for (let hop=0;hop<=5;hop++) {
      signal.throwIfAborted();
      const {url,address}=await cancellable(validatePublicUrl(next,deps.resolve),signal);
      response=await (deps.connect ?? connect)(url,address,signal);
      const status=response.statusCode ?? 0;
      if ([301,302,303,307,308].includes(status)) {
        const location=response.headers.location;
        response.destroy();
        if (!location || hop===5) throw Error('Invalid or excessive redirects');
        const destination=new URL(location,url);
        if(url.protocol==='https:' && destination.protocol==='http:') throw Error('HTTPS downgrade blocked');
        next=destination.href; continue;
      }
      if(status<200 || status>=300) throw Error(`Download returned HTTP ${status}`);
      if(response.headers['content-encoding'] && response.headers['content-encoding']!=='identity') throw Error('Encoded downloads are unsupported');
      const length=Number(response.headers['content-length']);
      if(options.oversize==='reject' && length>options.maxBytes) throw Error('File exceeds download limit');
      let truncated=false;
      const source=response;
      async function* body() {
        let bytes=0;
        try {
          for await(const value of source) {
            signal.throwIfAborted();
            const chunk=Buffer.from(value); const available=options.maxBytes-bytes;
            bytes+=chunk.length;
            if(bytes>options.maxBytes) {
              if(options.oversize==='reject') throw Error('File exceeds download limit');
              truncated=true; if(available>0) yield chunk.subarray(0,available); break;
            }
            yield chunk;
          }
        } finally { close(); }
      }
      let name=url.pathname.split('/').pop() || 'file';
      try { name=decodeURIComponent(name); } catch { /* display hint only */ }
      return {body:body(),finalUrl:url.href,mediaType:String(response.headers['content-type'] ?? 'application/octet-stream').slice(0,160),displayName:safeFileName(name),truncated:()=>truncated,close};
    }
    throw Error('Too many redirects');
  } catch(error) { close(); throw error; }
}
