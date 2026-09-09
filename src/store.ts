import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import type { CredentialProfile, UploadIndex, UploadRecord } from "./model";

const PROFILES_KEY = "credentialProfiles.v1";
const ACTIVE_KEY = "activeProfile.v1";
const secretKey = (id: string) => `robloxAssetManager.apiKey.${id}`;

export class ProfileStore {
  constructor(private readonly context: vscode.ExtensionContext) {}
  profiles(): CredentialProfile[] { return this.context.globalState.get<CredentialProfile[]>(PROFILES_KEY, []); }
  active(): CredentialProfile | undefined {
    const id = this.context.globalState.get<string>(ACTIVE_KEY);
    return this.profiles().find(p => p.id === id) ?? this.profiles()[0];
  }
  async key(profileId: string): Promise<string | undefined> { return this.context.secrets.get(secretKey(profileId)); }
  async save(profile: CredentialProfile, key: string): Promise<void> {
    const profiles = this.profiles().filter(p => p.id !== profile.id).concat(profile);
    await this.context.globalState.update(PROFILES_KEY, profiles);
    await this.context.globalState.update(ACTIVE_KEY, profile.id);
    await this.context.secrets.store(secretKey(profile.id), key);
  }
  async activate(id: string): Promise<void> { await this.context.globalState.update(ACTIVE_KEY, id); }
}

export class HistoryStore {
  private file: string;
  constructor(private readonly context: vscode.ExtensionContext) { this.file = path.join(context.globalStorageUri.fsPath, "upload-index.json"); }
  async read(): Promise<UploadIndex> {
    try {
      const value = JSON.parse(await fs.readFile(this.file, "utf8")) as UploadIndex;
      return value.schemaVersion === 1 && Array.isArray(value.assets) ? value : { schemaVersion: 1, assets: [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { schemaVersion: 1, assets: [] };
    }
  }
  async upsert(record: UploadRecord): Promise<void> {
    const index = await this.read();
    index.assets = [record, ...index.assets.filter(a => a.assetId !== record.assetId)];
    await this.write(index);
  }
  async markArchived(assetId: string, archived: boolean): Promise<void> {
    const index = await this.read();
    const asset = index.assets.find(item => item.assetId === assetId);
    if (asset) asset.archived = archived;
    await this.write(index);
  }
  async write(index: UploadIndex): Promise<void> {
    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, JSON.stringify(index, null, 2), { mode: 0o600 });
    await fs.rename(temp, this.file);
  }
  async import(from: vscode.Uri): Promise<void> {
    const parsed = JSON.parse(await fs.readFile(from.fsPath, "utf8")) as UploadIndex;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.assets)) throw new Error("This is not a valid Roblox Asset Manager index.");
    const current = await this.read();
    const merged = new Map(current.assets.map(a => [a.assetId, a]));
    for (const asset of parsed.assets) merged.set(asset.assetId, asset);
    await this.write({ schemaVersion: 1, assets: [...merged.values()] });
  }
  async export(to: vscode.Uri): Promise<void> { await fs.writeFile(to.fsPath, JSON.stringify(await this.read(), null, 2)); }
}
