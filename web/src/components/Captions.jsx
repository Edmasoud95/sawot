import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { useVoiceStore } from "../store";

function Caption({ text, className, delay = 0 }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (text) {
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 10, filter: "blur(6px)" },
        {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 0.7,
          delay,
          ease: "power3.out",
        }
      );
    } else {
      gsap.set(ref.current, { opacity: 0 });
    }
  }, [text, delay]);
  return (
    <p ref={ref} className={`leading-relaxed opacity-0 ${className}`}>
      {text}
    </p>
  );
}

export default function Captions() {
  const userCaption = useVoiceStore((s) => s.userCaption);
  const assistantCaption = useVoiceStore((s) => s.assistantCaption);
  return (
    <div className="row-start-2 flex min-h-[6.5em] max-w-[min(85vw,580px)] flex-col gap-3 px-4 text-center">
      {/* What the machine heard: light mono, quoted, deliberately technical */}
      <Caption
        text={userCaption ? `“${userCaption}”` : ""}
        className="font-mono text-[0.8rem] font-light tracking-wide text-zinc-500"
      />
      {/* What the assistant says: editorial serif — the voice itself */}
      <Caption
        text={assistantCaption}
        delay={0.12}
        className="font-serif text-[1.45rem] tracking-[0.01em] text-zinc-100 [text-wrap:balance]"
      />
    </div>
  );
}
