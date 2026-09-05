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
      <div className="devices-empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></svg>
        <p>Ask about a device to see its controls.</p>
      </div>
    );
  }
  return (
    <div
      ref={grid}
      className="grid w-full max-w-[920px] grid-cols-1 gap-4 sm:grid-cols-2"
    >
      {cards.map((card) => (
        <EntityCard key={card.entity_id} card={card} sendControl={sendControl} />
      ))}
    </div>
  );
}
