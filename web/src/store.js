import { create } from "zustand";

// High-frequency mic/playback level, deliberately OUTSIDE React state:
// the orb reads it per-frame in its render loop; pushing 60Hz updates
// through React would re-render the tree pointlessly.
export const levelBus = { value: 0 };

export const useVoiceStore = create((set) => ({
  status: "connecting", // connecting | idle | recording | thinking | speaking
  userCaption: "",
  assistantCaption: "",
  history: [], // [{ role: "user" | "assistant", text }]
  drawerOpen: false,

  setStatus: (status) => set({ status }),
  setUserCaption: (text) => set({ userCaption: text }),
  setAssistantCaption: (text) => set({ assistantCaption: text }),
  clearCaptions: () => set({ userCaption: "", assistantCaption: "" }),
  addTurn: (role, text) =>
    set((s) => ({ history: [...s.history, { role, text }] })),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
}));
