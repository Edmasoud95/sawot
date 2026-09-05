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
          duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.7,
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
    <div className="captions">
      <Caption
        text={userCaption ? `“${userCaption}”` : ""}
        className="font-sans text-[0.8rem] text-zinc-400"
      />
      <Caption
        text={assistantCaption}
        delay={0.12}
        className="font-sans text-[1rem] text-zinc-100 [text-wrap:balance]"
      />
    </div>
  );
}
