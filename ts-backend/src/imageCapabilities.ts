/** Explicit provider metadata only. Missing metadata means unknown. */
export function imageInputCapability(metadata: any): boolean | undefined {
  const modalities = metadata?.architecture?.input_modalities;
  if (Array.isArray(modalities) && modalities.every(value => typeof value === "string")) return modalities.includes("image");
  const modality = metadata?.architecture?.modality;
  if (typeof modality === "string" && modality.includes("->")) return modality.split("->")[0].split("+").includes("image");
  if (typeof metadata?.capabilities?.vision === "boolean") return metadata.capabilities.vision;
  return undefined;
}
