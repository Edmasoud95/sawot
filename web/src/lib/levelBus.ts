// High-frequency mic/playback level, kept outside React state and app stores
// so leaf components and lib helpers can share it without importing app state.
export const levelBus = { value: 0 };
