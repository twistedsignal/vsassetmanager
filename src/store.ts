import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import type { CredentialProfile, UploadIndex, UploadRecord } from "./model";

const PROFILES_KEY = "credentialProfiles.v1";
const ACTIVE_KEY = "activeProfile.v1";
const secretKey = (id: string) => `robloxAssetManager.apiKey.${id}`;

export class ProfileStore {
  constructor(private readonly context: vscode.ExtensionContext) {}
  profiles(): CredentialProfile[] {
    return this.context.globalState.get<CredentialProfile[]>(PROFILES_KEY, []);
  }
  active(): CredentialProfile | undefined {
    const id = this.context.globalState.get<string>(ACTIVE_KEY);
    return this.profiles().find((p) => p.id === id) ?? this.profiles()[0];
  }
  async key(profileId: string): Promise<string | undefined> {
    return this.context.secrets.get(secretKey(profileId));
  }
  async save(profile: CredentialProfile, key: string): Promise<void> {
    const profiles = this.profiles()
      .filter((p) => p.id !== profile.id)
      .concat(profile);
    await this.context.globalState.update(PROFILES_KEY, profiles);
    await this.context.globalState.update(ACTIVE_KEY, profile.id);
    await this.context.secrets.store(secretKey(profile.id), key);
  }
  async activate(id: string): Promise<void> {
    await this.context.globalState.update(ACTIVE_KEY, id);
  }
}

export class HistoryStore {
  private file: string;
  private writeQueue: Promise<void> = Promise.resolve();
  constructor(private readonly context: vscode.ExtensionContext) {
    this.file = path.join(context.globalStorageUri.fsPath, "upload-index.json");
  }
  async read(): Promise<UploadIndex> {
    const local = await this.readFile(this.file);
    const uri = this.manifestUri();
    if (uri) {
      try {
        await fs.access(uri.fsPath);
        return this.readFile(uri.fsPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return local;
  }
  private async readFile(file: string): Promise<UploadIndex> {
    try {
      const value = JSON.parse(await fs.readFile(file, "utf8")) as UploadIndex;
      return value.schemaVersion === 1 && Array.isArray(value.assets)
        ? { schemaVersion: 1, assets: validRecords(value.assets) }
        : { schemaVersion: 1, assets: [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { schemaVersion: 1, assets: [] };
    }
  }
  async upsert(record: UploadRecord): Promise<void> {
    await this.upsertMany([record]);
  }
  async upsertMany(records: UploadRecord[]): Promise<void> {
    await this.serialized(async () => {
      const local = await this.readFile(this.file);
      local.assets = mergeRecords(local.assets, records);
      await this.writeLocal(local);
      const manifest = await this.readManifest();
      manifest.assets = mergeRecords(
        manifest.assets,
        records.map((record) => this.portable(record)),
      );
      await this.writeManifest(manifest);
    });
  }
  async markArchived(assetId: string, archived: boolean): Promise<void> {
    const index = await this.read();
    const asset = index.assets.find((item) => item.assetId === assetId);
    if (asset) {
      asset.archived = archived;
      await this.upsert(asset);
    }
  }
  private async writeLocal(index: UploadIndex): Promise<void> {
    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(index, null, 2), { mode: 0o600 });
    await fs.rename(temp, this.file);
  }
  async import(from: vscode.Uri): Promise<void> {
    const parsed = JSON.parse(await fs.readFile(from.fsPath, "utf8")) as UploadIndex;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.assets))
      throw new Error("This is not a valid Roblox Asset Manager index.");
    await this.upsertMany(parsed.assets);
  }
  async export(to: vscode.Uri): Promise<void> {
    await fs.writeFile(to.fsPath, JSON.stringify(await this.read(), null, 2));
  }

  manifestUri(): vscode.Uri | undefined {
    if (!vscode.workspace.getConfiguration("robloxAssetManager.manifest").get("enabled", true))
      return undefined;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root || root.scheme !== "file") return undefined;
    const configured = vscode.workspace
      .getConfiguration("robloxAssetManager.manifest")
      .get("path", ".roblox-assets.json");
    const file = path.resolve(root.fsPath, configured);
    const relative = path.relative(root.fsPath, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    return vscode.Uri.file(file);
  }

  async syncManifest(records: UploadRecord[]): Promise<void> {
    if (!this.manifestUri()) return;
    await this.serialized(async () => {
      const manifest = await this.readManifest();
      manifest.assets = mergeRecords(
        manifest.assets,
        records.map((record) => this.portable(record)),
      );
      await this.writeManifest(manifest);
    });
  }

  private async readManifest(): Promise<UploadIndex> {
    const uri = this.manifestUri();
    return uri ? this.readFile(uri.fsPath) : { schemaVersion: 1, assets: [] };
  }

  private async writeManifest(index: UploadIndex): Promise<void> {
    const uri = this.manifestUri();
    if (!uri) return;
    await fs.mkdir(path.dirname(uri.fsPath), { recursive: true });
    const temp = `${uri.fsPath}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(index, null, 2)}\n`);
    await fs.rename(temp, uri.fsPath);
  }

  private portable(record: UploadRecord): UploadRecord {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const sourcePath =
      record.sourcePath && root && path.isAbsolute(record.sourcePath)
        ? path.relative(root, record.sourcePath)
        : record.sourcePath;
    return { ...record, source: "manifest", sourcePath, profileId: "shared" };
  }

  private async serialized(action: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(action, action);
    this.writeQueue = next.catch(() => undefined);
    await next;
  }
}

function mergeRecords(current: UploadRecord[], incoming: UploadRecord[]): UploadRecord[] {
  const merged = new Map(validRecords(current).map((asset) => [asset.assetId, asset]));
  for (const asset of validRecords(incoming)) merged.set(asset.assetId, asset);
  return [...merged.values()].sort((left, right) =>
    String(right.updatedAt ?? right.createdAt ?? "").localeCompare(
      String(left.updatedAt ?? left.createdAt ?? ""),
    ),
  );
}

function validRecords(records: UploadRecord[]): UploadRecord[] {
  return records.filter((asset) => /^\d+$/.test(asset.assetId));
}
