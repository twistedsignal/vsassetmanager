import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { candidateFor, copyValue } from "./capabilities";
import type {
  AssetSummary,
  CreatorTarget,
  ExtensionState,
  HostMessage,
  UploadCandidate,
  UploadJob,
  UploadRecord,
  WebviewMessage,
} from "./model";
import { RobloxApiError, RobloxClient } from "./robloxClient";
import { HistoryStore, ProfileStore } from "./store";

let manager: AssetManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  manager = new AssetManager(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("robloxAssetManager.library", manager, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("robloxAssetManager.open", () =>
      vscode.commands.executeCommand("workbench.view.extension.robloxAssetManager"),
    ),
    vscode.commands.registerCommand("robloxAssetManager.configureApiKey", () =>
      manager?.configure(),
    ),
    vscode.commands.registerCommand("robloxAssetManager.switchProfile", () =>
      manager?.switchProfile(),
    ),
    vscode.commands.registerCommand(
      "robloxAssetManager.uploadFiles",
      (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
        manager?.pickFiles(uris ?? (uri ? [uri] : undefined)),
    ),
    vscode.commands.registerCommand("robloxAssetManager.uploadFolder", () => manager?.pickFolder()),
    vscode.commands.registerCommand("robloxAssetManager.addExistingIds", () =>
      manager?.addExistingIds(),
    ),
    vscode.commands.registerCommand("robloxAssetManager.copyAssetId", (id?: string) =>
      manager?.copyIds(id ? [id] : undefined),
    ),
    vscode.commands.registerCommand("robloxAssetManager.refresh", () => manager?.refresh()),
    vscode.commands.registerCommand("robloxAssetManager.exportIndex", () => manager?.exportIndex()),
    vscode.commands.registerCommand("robloxAssetManager.importIndex", () => manager?.importIndex()),
    vscode.commands.registerCommand("robloxAssetManager.openManifest", () =>
      manager?.openManifest(),
    ),
  );
  await detectRojo();
}

export function deactivate(): void {
  manager?.dispose();
}

async function detectRojo(): Promise<boolean> {
  const files = await vscode.workspace.findFiles("**/*.project.json", "**/node_modules/**", 1);
  const found = files.length > 0;
  await vscode.commands.executeCommand("setContext", "robloxAssetManager.isRojoProject", found);
  return found;
}

class AssetManager implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private readonly profiles: ProfileStore;
  private readonly history: HistoryStore;
  private jobs: UploadJob[] = [];
  private candidates = new Map<string, UploadCandidate>();
  private controllers = new Map<string, AbortController>();
  private loading = false;
  private hasLoaded = false;
  private refreshTimer?: NodeJS.Timeout;
  private error?: string;
  private isRojoProject = false;
  private readonly output = vscode.window.createOutputChannel("Roblox Asset Manager", {
    log: true,
  });

  constructor(private readonly context: vscode.ExtensionContext) {
    this.profiles = new ProfileStore(context);
    this.history = new HistoryStore(context);
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("robloxAssetManager.copy")) void this.sendState();
      }),
    );
    const manifest = this.history.manifestUri();
    if (manifest) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          vscode.Uri.file(path.dirname(manifest.fsPath)),
          path.basename(manifest.fsPath),
        ),
      );
      watcher.onDidCreate(() => void this.sendState());
      watcher.onDidChange(() => void this.sendState());
      watcher.onDidDelete(() => void this.sendState());
      context.subscriptions.push(watcher);
    }
    void detectRojo().then((found) => {
      this.isRojoProject = found;
      void this.sendState();
    });
  }

  dispose(): void {
    for (const controller of this.controllers.values()) controller.abort();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.output.dispose();
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview")],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(
      (message: unknown) => void this.onMessage(message),
      undefined,
      this.context.subscriptions,
    );
    await this.sendState();
    this.startRefreshTimer();
    if (this.profiles.active() && !this.hasLoaded) {
      this.hasLoaded = true;
      void this.refresh().catch((error) => this.fail(error));
    }
  }

  private startRefreshTimer(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    const minutes = vscode.workspace
      .getConfiguration("robloxAssetManager.library")
      .get("refreshIntervalMinutes", 15);
    if (minutes > 0) {
      this.refreshTimer = setInterval(
        () => void this.refresh().catch((error) => this.fail(error)),
        minutes * 60_000,
      );
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("hex");
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "app.js"),
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview", "app.css"),
    );
    return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== "object" || typeof (raw as { type?: unknown }).type !== "string")
      return;
    const message = raw as WebviewMessage;
    try {
      if (message.type === "ready") await this.sendState();
      else if (message.type === "configure") await this.configure();
      else if (message.type === "manageCreators") await this.manageCreators();
      else if (message.type === "removeCreator") await this.removeCreator(message.creator);
      else if (message.type === "addExistingIds") await this.addExistingIds(message.creator);
      else if (message.type === "switchProfile") await this.switchProfile();
      else if (message.type === "refresh") await this.refresh();
      else if (message.type === "openManifest") await this.openManifest();
      else if (message.type === "pickFiles") await this.pickFiles();
      else if (message.type === "pickFolder") await this.pickFolder();
      else if (message.type === "submitUpload")
        await this.submitUpload(message.candidates, message.creator);
      else if (message.type === "copy") await this.copyIds(message.ids);
      else if (message.type === "open" && /^\d+$/.test(message.assetId))
        await vscode.env.openExternal(
          vscode.Uri.parse(`https://create.roblox.com/store/asset/${message.assetId}`),
        );
      else if (message.type === "details") await this.details(message.assetId);
      else if (message.type === "versions") await this.versions(message.assetId);
      else if (message.type === "updateMetadata")
        await this.updateMetadata(message.assetId, message.displayName, message.description);
      else if (message.type === "rollback")
        await this.rollback(message.assetId, message.versionNumber);
      else if (message.type === "archive")
        await this.archive(message.assetId, Boolean(message.restore));
      else if (message.type === "cancelJob") {
        this.controllers.get(message.id)?.abort();
        this.setJob(message.id, { status: "cancelled" });
      }
    } catch (error) {
      await this.fail(error);
    }
  }

  async configure(): Promise<void> {
    const label = await vscode.window.showInputBox({
      title: "Roblox Asset Manager",
      prompt: "Profile name",
      value: "Roblox",
    });
    if (!label) return;
    const userId = await vscode.window.showInputBox({
      title: "Roblox user",
      prompt: "Numeric Roblox user ID",
      validateInput: numeric,
    });
    if (!userId) return;
    const groupText = await vscode.window.showInputBox({
      title: "Creator groups",
      prompt: "Optional group IDs, separated by commas",
      validateInput: groupIds,
    });
    if (groupText === undefined) return;
    const key = await vscode.window.showInputBox({
      title: "Open Cloud API key",
      prompt: "Stored in VS Code SecretStorage",
      password: true,
      ignoreFocusOut: true,
    });
    if (!key) return;
    const client = new RobloxClient(key);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Validating Roblox API key…" },
      async () => {
        await client.validate(userId);
      },
    );
    const user = await client.resolveCreator({
      kind: "user",
      id: userId,
      label: `${label} (${userId})`,
    });
    const groupTargets = groupText
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((id) => ({ kind: "group" as const, id, label: `Group ${id}` }));
    const groups = await this.validateGroups(client, groupTargets);
    await this.profiles.save(
      {
        id: crypto.randomUUID(),
        label,
        userId,
        creators: [user, ...groups],
        defaultCreator: user,
        validatedAt: new Date().toISOString(),
      },
      key,
    );
    this.startRefreshTimer();
    await this.refresh();
  }

  async switchProfile(): Promise<void> {
    const profiles = this.profiles.profiles();
    if (!profiles.length) return this.configure();
    const picked = await vscode.window.showQuickPick(
      profiles.map((profile) => ({ label: profile.label, description: profile.userId, profile })),
      { placeHolder: "Choose a Roblox profile" },
    );
    if (!picked) return;
    await this.profiles.activate(picked.profile.id);
    await this.refresh();
  }

  async manageCreators(): Promise<void> {
    const profile = this.profiles.active();
    if (!profile) return this.configure();
    const current = profile.creators
      .filter((creator) => creator.kind === "group")
      .map((creator) => creator.id)
      .join(", ");
    const groupText = await vscode.window.showInputBox({
      title: "Creator repositories",
      prompt: "Group IDs, separated by commas",
      value: current,
      validateInput: groupIds,
    });
    if (groupText === undefined) return;
    const key = await this.profiles.key(profile.id);
    if (!key) throw new Error(`The API key for ${profile.label} is missing.`);
    const user = profile.creators.find((creator) => creator.kind === "user") ?? {
      kind: "user" as const,
      id: profile.userId,
      label: `${profile.label} (${profile.userId})`,
    };
    const groupTargets = groupText
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((id) => ({ kind: "group" as const, id, label: `Group ${id}` }));
    const groups = await this.validateGroups(new RobloxClient(key), groupTargets);
    await this.profiles.save({ ...profile, creators: [user, ...groups] }, key);
    await this.refresh();
  }

  async removeCreator(creator: CreatorTarget): Promise<void> {
    if (creator.kind !== "group") return;
    const profile = this.profiles.active();
    if (!profile) return;
    const answer = await vscode.window.showWarningMessage(
      `Remove ${creator.label} from this profile?`,
      { modal: true },
      "Remove",
    );
    if (answer !== "Remove") return;
    const key = await this.profiles.key(profile.id);
    if (!key) throw new Error(`The API key for ${profile.label} is missing.`);
    const creators = profile.creators.filter((item) => !sameCreatorTarget(item, creator));
    const defaultCreator = sameCreatorTarget(profile.defaultCreator, creator)
      ? creators[0]!
      : profile.defaultCreator;
    await this.profiles.save({ ...profile, creators, defaultCreator }, key);
    await this.sendState();
  }

  private async validateGroups(
    client: RobloxClient,
    groups: CreatorTarget[],
  ): Promise<CreatorTarget[]> {
    if (!groups.length) return [];
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Checking Roblox groups…" },
      () => Promise.all(groups.map((group) => client.resolveCreator(group))),
    );
  }

  private async client(): Promise<{
    client: RobloxClient;
    profile: NonNullable<ReturnType<ProfileStore["active"]>>;
  }> {
    const profile = this.profiles.active();
    if (!profile) throw new Error("Configure an Open Cloud API key first.");
    const key = await this.profiles.key(profile.id);
    if (!key)
      throw new Error(`The API key for ${profile.label} is missing. Configure the profile again.`);
    return { client: new RobloxClient(key), profile };
  }

  async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.error = undefined;
    await this.sendState();
    try {
      const { client, profile } = await this.client();
      const resolvedCreators = await Promise.all(
        profile.creators.map(async (creator) => {
          try {
            return await client.resolveCreator(creator);
          } catch (error) {
            this.output.warn(`Could not resolve ${creator.kind} ${creator.id}: ${friendly(error)}`);
            return creator;
          }
        }),
      );
      if (
        resolvedCreators.some((creator, index) => creator.label !== profile.creators[index]?.label)
      ) {
        const key = await this.profiles.key(profile.id);
        if (key) {
          const defaultCreator =
            resolvedCreators.find((creator) =>
              sameCreatorTarget(creator, profile.defaultCreator),
            ) ?? resolvedCreators[0]!;
          await this.profiles.save({ ...profile, creators: resolvedCreators, defaultCreator }, key);
        }
      }

      const index = await this.history.read();
      const known = index.assets.filter((asset) =>
        asset.creator
          ? resolvedCreators.some((creator) => sameCreatorTarget(creator, asset.creator!))
          : asset.profileId === profile.id,
      );
      await this.history.syncManifest(known);
      const refreshed: UploadRecord[] = [];
      for (const record of known) {
        try {
          const details = await client.details(record.assetId);
          refreshed.push({
            ...record,
            ...details,
            assetId: record.assetId,
            creator: record.creator,
            source: record.source,
            thumbnailUrl: details.thumbnailUrl ?? record.thumbnailUrl,
          });
        } catch (error) {
          this.output.warn(`Could not refresh asset ${record.assetId}: ${friendly(error)}`);
        }
      }
      if (refreshed.length) await this.history.upsertMany(refreshed);
    } finally {
      this.loading = false;
      await this.sendState();
    }
  }

  async pickFiles(initial?: vscode.Uri[]): Promise<void> {
    const uris =
      initial ??
      (await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: false,
        openLabel: "Review assets",
      }));
    if (!uris?.length) return;
    await this.review(uris);
  }

  async pickFolder(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: false,
      canSelectFolders: true,
      openLabel: "Scan folder",
    });
    if (!selected?.[0]) return;
    const uris = await walk(selected[0]);
    await this.review(uris);
  }

  private async review(uris: vscode.Uri[]): Promise<void> {
    const config = vscode.workspace.getConfiguration("robloxAssetManager.upload");
    const items = await Promise.all(
      uris.map(async (uri) => {
        const candidate = candidateFor(
          uri.fsPath,
          (await vscode.workspace.fs.stat(uri)).size,
          config.get("defaultImageType", "Decal"),
          config.get("defaultDescription", ""),
        );
        if (candidate.mimeType?.startsWith("image/") && this.view) {
          candidate.previewUrl = this.view.webview.asWebviewUri(uri).toString();
        }
        return candidate;
      }),
    );
    if (this.view) {
      const roots = uris.map((uri) => vscode.Uri.file(path.dirname(uri.fsPath)));
      this.view.webview.options = {
        ...this.view.webview.options,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
          ...roots,
        ],
      };
    }
    this.candidates = new Map(items.map((item) => [item.id, item]));
    await vscode.commands.executeCommand("workbench.view.extension.robloxAssetManager");
    await this.post({ type: "candidates", candidates: items });
  }

  private async submitUpload(
    changes: Array<Pick<UploadCandidate, "id" | "assetType" | "displayName" | "description">>,
    creator: CreatorTarget,
  ): Promise<void> {
    const jobs: UploadJob[] = [];
    for (const change of changes) {
      const candidate = this.candidates.get(change.id);
      if (!candidate || !change.assetType || !candidate.allowedTypes.includes(change.assetType))
        continue;
      jobs.push({ ...candidate, ...change, status: "queued" });
    }
    this.jobs = [...jobs, ...this.jobs].slice(0, 500);
    this.candidates.clear();
    await this.sendState();
    const concurrency = vscode.workspace
      .getConfiguration("robloxAssetManager.upload")
      .get("concurrency", 3);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
        while (cursor < jobs.length) {
          const job = jobs[cursor++];
          if (job) await this.runJob(job, creator);
        }
      }),
    );
    await this.sendState();
  }

  private async runJob(job: UploadJob, creator: CreatorTarget): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    try {
      const { client, profile } = await this.client();
      this.setJob(job.id, { status: "uploading", error: undefined });
      const created = await this.retry(
        () =>
          client.create({
            filePath: job.path,
            mimeType: job.mimeType!,
            assetType: job.assetType!,
            displayName: job.displayName,
            description: job.description,
            creator,
          }),
        controller.signal,
      );
      this.setJob(job.id, { status: "processing", operationId: created.operationId });
      const timeout = vscode.workspace
        .getConfiguration("robloxAssetManager.upload")
        .get("operationTimeoutMs", 300000);
      const interval = vscode.workspace
        .getConfiguration("robloxAssetManager.upload")
        .get("pollIntervalMs", 1500);
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if (controller.signal.aborted) throw new Error("Upload cancelled.");
        const result = await client.operation(created.operationId);
        if (result.done) {
          if (!result.asset)
            throw new Error(result.error ?? "Roblox did not return the uploaded asset.");
          const record: UploadRecord = {
            ...result.asset,
            source: "history",
            profileId: profile.id,
            sourcePath: job.path,
            operationId: created.operationId,
            creator,
          };
          await this.history.upsert(record);
          this.setJob(job.id, { status: "done", assetId: record.assetId });
          if (
            this.jobs.filter((x) => x.status === "uploading" || x.status === "processing")
              .length === 0 &&
            vscode.workspace
              .getConfiguration("robloxAssetManager.upload")
              .get("copyOnSuccess", false)
          )
            await this.copyIds([record.assetId]);
          return;
        }
        await delay(interval);
      }
      throw new Error("Roblox did not finish processing before the configured timeout.");
    } catch (error) {
      this.setJob(job.id, {
        status: controller.signal.aborted ? "cancelled" : "failed",
        error: friendly(error),
      });
    } finally {
      this.controllers.delete(job.id);
    }
  }

  private async retry<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const retries = vscode.workspace
      .getConfiguration("robloxAssetManager.upload")
      .get("retryCount", 2);
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const transient =
          !(error instanceof RobloxApiError) || error.status === 429 || error.status >= 500;
        if (!transient || attempt >= retries || signal.aborted) throw error;
        const seconds =
          error instanceof RobloxApiError && error.retryAfter
            ? error.retryAfter * 1000
            : Math.min(1000 * 2 ** attempt, 10000);
        await delay(seconds);
      }
    }
  }

  private setJob(id: string, change: Partial<UploadJob>): void {
    const job = this.jobs.find((item) => item.id === id);
    if (job) Object.assign(job, change);
    void this.sendState();
  }

  async addExistingIds(preselected?: CreatorTarget): Promise<void> {
    const raw = await vscode.window.showInputBox({
      title: "Add existing assets",
      prompt: "Asset IDs separated by commas, spaces, or new lines",
      validateInput: (value) =>
        parseIds(value).length ? undefined : "Enter at least one numeric asset ID",
    });
    if (!raw) return;
    const { client, profile } = await this.client();
    const picked = preselected
      ? undefined
      : await vscode.window.showQuickPick(
          profile.creators.map((creator) => ({
            label: creator.label,
            description: creator.kind === "group" ? "Group" : "User",
            creator,
          })),
          { placeHolder: "Choose the creator repository" },
        );
    const creator = preselected ?? picked?.creator;
    if (!creator) return;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Adding Roblox assets",
        cancellable: false,
      },
      async (progress) => {
        const ids = parseIds(raw);
        for (let i = 0; i < ids.length; i++) {
          progress.report({ message: `${i + 1}/${ids.length}` });
          const asset = await client.details(ids[i]!);
          await this.history.upsert({
            ...asset,
            creator,
            source: "history",
            profileId: profile.id,
          });
        }
      },
    );
    await this.sendState();
  }

  async copyIds(ids?: string[]): Promise<void> {
    if (!ids?.length) {
      const raw = await vscode.window.showInputBox({
        prompt: "Asset ID to copy",
        validateInput: numeric,
      });
      if (!raw) return;
      ids = [raw];
    }
    const config = vscode.workspace.getConfiguration("robloxAssetManager.copy");
    const separator = unescapeSeparator(config.get("separator", "\\n"));
    const result = ids
      .map((id) =>
        copyValue(
          id,
          config.get("format", "uri"),
          config.get("customTemplate", "rbxassetid://${id}"),
        ),
      )
      .join(separator);
    await vscode.env.clipboard.writeText(result);
    void vscode.window.setStatusBarMessage(
      `Copied ${ids.length === 1 ? "asset ID" : `${ids.length} asset IDs`}`,
      2000,
    );
  }

  private async details(assetId: string): Promise<void> {
    const { client, profile } = await this.client();
    const current = (await this.history.read()).assets.find((item) => item.assetId === assetId);
    let asset: AssetSummary;
    try {
      asset = await client.details(assetId);
    } catch (error) {
      if (error instanceof RobloxApiError && error.status === 404 && current) {
        await this.post({ type: "assetDetails", asset: current });
        return;
      }
      throw error;
    }
    const record: UploadRecord = {
      ...current,
      ...asset,
      assetId,
      creator: current?.creator ?? asset.creator,
      profileId: current?.profileId ?? profile.id,
      source: current?.source ?? "history",
      thumbnailUrl: asset.thumbnailUrl ?? current?.thumbnailUrl,
    };
    await this.history.upsert(record);
    await this.post({ type: "assetDetails", asset: record });
    await this.sendState();
  }
  private async versions(assetId: string): Promise<void> {
    const { client } = await this.client();
    await this.post({ type: "assetVersions", assetId, versions: await client.versions(assetId) });
  }
  private async updateMetadata(
    assetId: string,
    displayName: string,
    description: string,
  ): Promise<void> {
    const { client } = await this.client();
    await client.updateMetadata(assetId, displayName.trim(), description);
    await this.details(assetId);
  }
  private async rollback(assetId: string, versionNumber: string): Promise<void> {
    if (vscode.workspace.getConfiguration("robloxAssetManager.confirm").get("rollback", true)) {
      const answer = await vscode.window.showWarningMessage(
        `Roll asset ${assetId} back to version ${versionNumber}?`,
        { modal: true },
        "Rollback",
      );
      if (answer !== "Rollback") return;
    }
    const { client } = await this.client();
    await client.rollback(assetId, versionNumber);
    await this.details(assetId);
  }
  private async archive(assetId: string, restore: boolean): Promise<void> {
    if (
      !restore &&
      vscode.workspace.getConfiguration("robloxAssetManager.confirm").get("archive", true)
    ) {
      const answer = await vscode.window.showWarningMessage(
        `Archive asset ${assetId}?`,
        { modal: true },
        "Archive",
      );
      if (answer !== "Archive") return;
    }
    const { client } = await this.client();
    await client.archive(assetId, restore);
    await this.history.markArchived(assetId, !restore);
    await this.refresh();
  }

  async exportIndex(): Promise<void> {
    const target = await vscode.window.showSaveDialog({
      filters: { JSON: ["json"] },
      saveLabel: "Export index",
    });
    if (target) await this.history.export(target);
  }
  async importIndex(): Promise<void> {
    const source = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { JSON: ["json"] },
      openLabel: "Import index",
    });
    if (source?.[0]) {
      await this.history.import(source[0]);
      await this.sendState();
    }
  }

  async openManifest(): Promise<void> {
    const uri = this.history.manifestUri();
    if (!uri) throw new Error("Open a folder and enable the shared manifest first.");
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      await this.history.syncManifest([]);
    }
    await vscode.window.showTextDocument(uri);
  }

  private async state(): Promise<ExtensionState> {
    const profile = this.profiles.active();
    const index = await this.history.read();
    const copy = vscode.workspace.getConfiguration("robloxAssetManager.copy");
    return {
      configured: Boolean(profile),
      profile,
      profiles: this.profiles.profiles().map((p) => ({ id: p.id, label: p.label })),
      history: index.assets.filter(
        (asset) =>
          asset.profileId === profile?.id ||
          Boolean(
            asset.creator &&
            profile?.creators.some((creator) => sameCreatorTarget(creator, asset.creator!)),
          ),
      ),
      jobs: this.jobs,
      manifestPath: this.history.manifestUri()?.fsPath,
      copyFormat: {
        format: copy.get("format", "uri"),
        customTemplate: copy.get("customTemplate", "rbxassetid://${id}"),
      },
      loading: this.loading,
      isRojoProject: this.isRojoProject,
      error: this.error,
    };
  }
  private async sendState(): Promise<void> {
    await this.post({ type: "state", state: await this.state() });
  }
  private async post(message: HostMessage): Promise<void> {
    await this.view?.webview.postMessage(message);
  }
  private async fail(error: unknown): Promise<void> {
    this.error = friendly(error);
    this.output.error(this.error);
    await this.post({ type: "notice", level: "error", message: this.error });
    await this.sendState();
  }
}

function numeric(value: string): string | undefined {
  return /^\d+$/.test(value.trim()) ? undefined : "Enter a numeric ID";
}
function groupIds(value: string): string | undefined {
  return !value.trim() || value.split(",").every((x) => /^\d+$/.test(x.trim()))
    ? undefined
    : "Use numeric IDs separated by commas";
}
function sameCreatorTarget(left: CreatorTarget, right: CreatorTarget): boolean {
  return left.kind === right.kind && left.id === right.id;
}
function parseIds(value: string): string[] {
  return [...new Set(value.match(/\d+/g) ?? [])];
}
function friendly(error: unknown): string {
  if (error instanceof RobloxApiError) {
    if (error.status === 401) return "Roblox rejected the API key. Check that it is current.";
    if (error.status === 403)
      return `Roblox denied this action. Check the key's scopes, creator access, and IP restrictions. ${error.message}`;
    if (error.status === 429) return "Roblox rate-limited the request. Wait a moment and retry.";
  }
  return error instanceof Error ? error.message : String(error);
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function unescapeSeparator(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
}
async function walk(root: vscode.Uri): Promise<vscode.Uri[]> {
  const result: vscode.Uri[] = [];
  for (const [name, type] of await vscode.workspace.fs.readDirectory(root)) {
    const child = vscode.Uri.joinPath(root, name);
    if (type === vscode.FileType.Directory) result.push(...(await walk(child)));
    else if (type === vscode.FileType.File) result.push(child);
  }
  return result;
}
