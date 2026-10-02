export const MiB=1024*1024;
export const LIMITS={downloadBytes:20*MiB,sourceBytes:65536,inputFiles:10,inputBytes:100*MiB,
 outputFiles:10,outputFileBytes:20*MiB,outputBytes:50*MiB,logBytes:65536,
 conversationFiles:100,conversationBytes:200*MiB,globalBytes:2*1024*MiB,calls:5,seconds:30} as const;
