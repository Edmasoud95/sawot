import MemoryActivity from "./chat/MemoryActivity";
import { useRef } from "react";
import { useArrivalMotion } from "../hooks/useArrivalMotion";
import { useVoiceStore } from "../store";

function Caption({ text, className }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useArrivalMotion(ref, text ? 'visible' : null, 'reveal');
  return <p ref={ref} className={`leading-relaxed ${className}`}>{text}</p>;
}

export default function Captions() {
  const memory = useVoiceStore(s => s.memoryActivity);
  const userCaption = useVoiceStore((s) => s.userCaption);
  const assistantCaption = useVoiceStore((s) => s.assistantCaption);
  return (
    <div className="captions">
      <Caption
        text={userCaption ? `“${userCaption}”` : ""}
        className="font-sans text-[0.8rem] text-zinc-400"
      />
      <Caption
        text={assistantCaption}
        className="font-sans text-[1rem] text-zinc-100 [text-wrap:balance]"
      />
      <MemoryActivity events={memory}/>
    </div>
  );
}
