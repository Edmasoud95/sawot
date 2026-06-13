import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { useVoiceStore } from "../../store";
import EntityCard from "./EntityCard";

export default function CardGrid({ sendControl }) {
  const cards = useVoiceStore((s) => s.cards);
  const grid = useRef(null);

  // Staggered entrance whenever a new entity set arrives — the cards rise out
  // of the dark the same way the drawer turns do. Keyed on the id signature so
  // state-only updates (toggles, slider moves) don't replay the entrance.
  const signature = cards.map((c) => c.entity_id).join("|");
  useLayoutEffect(() => {
    if (!grid.current) return;
    gsap.fromTo(
      grid.current.querySelectorAll(".entity-card"),
      { opacity: 0, y: 22, scale: 0.97 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.7,
        ease: "expo.out",
        stagger: 0.06,
        clearProps: "opacity,transform",
      }
    );
  }, [signature]);

  if (cards.length === 0) {
    return (
      <div className="flex animate-rise-in flex-col items-center gap-3">
        <span className="font-mono text-[0.6rem] uppercase tracking-[0.3em] text-zinc-700">
          Control
        </span>
        <p className="max-w-[26ch] text-center font-serif text-xl italic leading-relaxed text-zinc-600">
          Ask about a device and its controls will appear here.
        </p>
      </div>
    );
  }
  return (
    <div
      ref={grid}
      className="grid w-full max-w-[640px] grid-cols-1 gap-3 px-5 sm:grid-cols-2"
    >
      {cards.map((card) => (
        <EntityCard key={card.entity_id} card={card} sendControl={sendControl} />
      ))}
    </div>
  );
}
