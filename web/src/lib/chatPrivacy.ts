import type { ProviderLike } from './fuzzy';

export function privateChatProviders<T extends ProviderLike>(providers: T[], privateMemoryUsed: boolean): T[] {
  return privateMemoryUsed ? providers.filter(p => p.privateMemoryAccess === true) : providers;
}

/** Privacy is permanent even when an older response arrives during recovery. */
export function mergeChatPrivacy(current: boolean | undefined, incoming: boolean | undefined): boolean {
  return current === true || incoming === true;
}
