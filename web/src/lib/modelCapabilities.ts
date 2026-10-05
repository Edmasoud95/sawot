import type { ProviderLike } from "./fuzzy";

export function modelImageInput(value: string, providers: ProviderLike[]): boolean | undefined {
  const at = value.indexOf("::");
  const provider = providers.find(p => at < 0 ? p.builtin : p.id === value.slice(0, at));
  const model = at < 0 ? value : value.slice(at + 2);
  if (!provider || provider.state !== "ready" || !Object.prototype.hasOwnProperty.call(provider.imageInput ?? {}, model)) return undefined;
  const supported = provider.imageInput?.[model];
  return typeof supported === "boolean" ? supported : undefined;
}

export function firstImageModel(providers: ProviderLike[]): string | undefined {
  for (const provider of providers) {
    if (provider.state !== "ready") continue;
    const model = provider.models.find(model => modelImageInput(`${provider.id}::${model}`, providers) === true);
    if (model) return `${provider.id}::${model}`;
  }
  return undefined;
}
