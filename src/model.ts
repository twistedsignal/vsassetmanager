export type AssetType = "Animation" | "Audio" | "Decal" | "Image" | "Mesh" | "Model" | "Video";
export type CreatorTarget = { kind: "user" | "group"; id: string; label: string };
export type CredentialProfile = {
  id: string;
  label: string;
  userId: string;
  creators: CreatorTarget[];
  defaultCreator: CreatorTarget;
  validatedAt?: string;
};

export type AssetSummary = {
  assetId: string;
  displayName: string;
  description?: string;
  assetType?: string;
  creator?: CreatorTarget;
  moderationState?: string;
  revisionId?: string;
  createdAt?: string;
  updatedAt?: string;
  thumbnailUrl?: string;
  source: "history" | "manifest";
  archived?: boolean;
};

export type UploadCandidate = {
  id: string;
  path: string;
  fileName: string;
  size: number;
  assetType?: AssetType;
  allowedTypes: AssetType[];
  mimeType?: string;
  previewUrl?: string;
  displayName: string;
  description: string;
  validationError?: string;
};

export type UploadJob = UploadCandidate & {
  status: "queued" | "uploading" | "processing" | "done" | "failed" | "cancelled";
  assetId?: string;
  operationId?: string;
  error?: string;
};

export type UploadRecord = AssetSummary & {
  profileId: string;
  sourcePath?: string;
  operationId?: string;
};

export type UploadIndex = { schemaVersion: 1; assets: UploadRecord[] };

export type ExtensionState = {
  configured: boolean;
  profile?: Omit<CredentialProfile, "creators"> & { creators: CreatorTarget[] };
  profiles: Array<{ id: string; label: string }>;
  history: AssetSummary[];
  jobs: UploadJob[];
  manifestPath?: string;
  copyFormat: { format: string; customTemplate: string };
  loading: boolean;
  isRojoProject: boolean;
  error?: string;
};

export type WebviewMessage =
  | { type: "ready" }
  | { type: "configure" }
  | { type: "manageCreators" }
  | { type: "removeCreator"; creator: CreatorTarget }
  | { type: "addExistingIds"; creator?: CreatorTarget }
  | { type: "switchProfile" }
  | { type: "refresh" }
  | { type: "openManifest" }
  | { type: "pickFiles" }
  | { type: "pickFolder" }
  | {
      type: "submitUpload";
      candidates: Array<Pick<UploadCandidate, "id" | "assetType" | "displayName" | "description">>;
      creator: CreatorTarget;
    }
  | { type: "copy"; ids: string[] }
  | { type: "open"; assetId: string }
  | { type: "details"; assetId: string }
  | { type: "versions"; assetId: string }
  | { type: "updateMetadata"; assetId: string; displayName: string; description: string }
  | { type: "rollback"; assetId: string; versionNumber: string }
  | { type: "archive"; assetId: string; restore?: boolean }
  | { type: "removeAssets"; ids: string[] }
  | { type: "cancelJob"; id: string };

export type HostMessage =
  | { type: "state"; state: ExtensionState }
  | { type: "candidates"; candidates: UploadCandidate[] }
  | { type: "assetDetails"; asset: AssetSummary }
  | { type: "assetVersions"; assetId: string; versions: unknown[] }
  | { type: "assetsRemoved"; ids: string[] }
  | { type: "notice"; level: "info" | "error"; message: string };
