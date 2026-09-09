import path from "node:path";
import type { AssetType, UploadCandidate } from "./model";

type Capability = { mime: string; types: AssetType[]; maxBytes?: number };

export const capabilities: Record<string, Capability> = {
  ".png": { mime: "image/png", types: ["Decal", "Image"], maxBytes: 20_000_000 },
  ".jpg": { mime: "image/jpeg", types: ["Decal", "Image"], maxBytes: 20_000_000 },
  ".jpeg": { mime: "image/jpeg", types: ["Decal", "Image"], maxBytes: 20_000_000 },
  ".bmp": { mime: "image/bmp", types: ["Decal", "Image"], maxBytes: 20_000_000 },
  ".tga": { mime: "image/tga", types: ["Decal", "Image"], maxBytes: 20_000_000 },
  ".mp3": { mime: "audio/mpeg", types: ["Audio"], maxBytes: 20_000_000 },
  ".ogg": { mime: "audio/ogg", types: ["Audio"], maxBytes: 20_000_000 },
  ".wav": { mime: "audio/wav", types: ["Audio"], maxBytes: 20_000_000 },
  ".flac": { mime: "audio/flac", types: ["Audio"], maxBytes: 20_000_000 },
  ".mp4": { mime: "video/mp4", types: ["Video"] },
  ".mov": { mime: "video/quicktime", types: ["Video"] },
  ".fbx": { mime: "model/fbx", types: ["Model"], maxBytes: 20_000_000 },
  ".gltf": { mime: "model/gltf+json", types: ["Model"], maxBytes: 20_000_000 },
  ".glb": { mime: "model/gltf-binary", types: ["Model"], maxBytes: 20_000_000 },
  ".rbxm": { mime: "model/x-rbxm", types: ["Model", "Animation"], maxBytes: 20_000_000 },
  ".rbxmx": { mime: "model/x-rbxm", types: ["Model", "Animation"], maxBytes: 20_000_000 }
};

export function candidateFor(filePath: string, size: number, defaultImageType: "Decal" | "Image", description: string): UploadCandidate {
  const ext = path.extname(filePath).toLowerCase();
  const cap = capabilities[ext];
  const base = path.basename(filePath, ext).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const allowedTypes = cap?.types ?? [];
  let validationError: string | undefined;
  if (!cap) validationError = `Unsupported file type: ${ext || "none"}`;
  else if (cap.maxBytes && size > cap.maxBytes) validationError = `File exceeds the documented ${Math.round(cap.maxBytes / 1_000_000)} MB limit`;
  const assetType = allowedTypes.includes(defaultImageType) ? defaultImageType : allowedTypes.length === 1 ? allowedTypes[0] : undefined;
  return {
    id: `${filePath}:${size}`,
    path: filePath,
    fileName: path.basename(filePath),
    size,
    allowedTypes,
    mimeType: cap?.mime,
    assetType,
    displayName: base || "Untitled asset",
    description,
    validationError
  };
}

export function copyValue(id: string, format: string, template: string): string {
  if (format === "numeric") return id;
  if (format === "lua") return `\"rbxassetid://${id}\"`;
  if (format === "custom") {
    if ((template.match(/\$\{id\}/g) ?? []).length !== 1) throw new Error("Custom copy template must contain exactly one ${id} placeholder.");
    return template.replace("${id}", id);
  }
  return `rbxassetid://${id}`;
}
