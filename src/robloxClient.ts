import fs from "node:fs/promises";
import path from "node:path";
import type { AssetSummary, AssetType, CreatorTarget } from "./model";

const API = "https://apis.roblox.com";

export class RobloxApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export class RobloxClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: { "x-api-key": this.apiKey, ...init.headers },
    });
    if (!response.ok) {
      const raw = await response.text();
      let detail = raw.slice(0, 500);
      try {
        const json = JSON.parse(raw) as { message?: string; errors?: Array<{ message?: string }> };
        detail =
          json.message ??
          json.errors
            ?.map((e) => e.message)
            .filter(Boolean)
            .join("; ") ??
          detail;
      } catch {
        /* response is not JSON */
      }
      const retryAfter = Number(response.headers.get("retry-after")) || undefined;
      throw new RobloxApiError(
        detail || `Roblox returned HTTP ${response.status}`,
        response.status,
        retryAfter,
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async validate(userId: string): Promise<void> {
    await this.request(`${API}/cloud/v2/users/${encodeURIComponent(userId)}/asset-quotas`);
  }

  async inventory(
    userId: string,
    pageSize: number,
    pageToken?: string,
  ): Promise<{ assets: AssetSummary[]; nextPageToken?: string }> {
    const params = new URLSearchParams({
      maxPageSize: String(pageSize),
      filter: "inventoryItemAssetTypes=*",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const value = await this.request<{
      inventoryItems?: Array<Record<string, unknown>>;
      nextPageToken?: string;
    }>(`${API}/cloud/v2/users/${encodeURIComponent(userId)}/inventory-items?${params}`);
    const rows = value.inventoryItems ?? [];
    const assets = rows
      .map((item) => this.inventoryItem(item))
      .filter((item): item is AssetSummary => Boolean(item));
    await this.addThumbnails(assets);
    return { assets, nextPageToken: value.nextPageToken || undefined };
  }

  private inventoryItem(item: Record<string, unknown>): AssetSummary | undefined {
    const details = (item.assetDetails ?? item) as Record<string, unknown>;
    const rawId =
      details.assetId ??
      item.assetId ??
      String(item.path ?? "")
        .split("/")
        .pop();
    if (!rawId) return undefined;
    return {
      assetId: String(rawId),
      displayName: String(details.displayName ?? details.name ?? `Asset ${rawId}`),
      assetType: String(details.assetType ?? details.inventoryItemAssetType ?? ""),
      createdAt: typeof item.createTime === "string" ? item.createTime : undefined,
      source: "inventory",
    };
  }

  async details(assetId: string): Promise<AssetSummary> {
    const value = await this.request<Record<string, unknown>>(
      `${API}/assets/v1/assets/${encodeURIComponent(assetId)}?readMask=assetType,displayName,description,creationContext,moderationResult,revisionId,revisionCreateTime`,
    );
    const asset = this.asset(value, "history");
    await this.addThumbnails([asset]);
    return asset;
  }

  async versions(assetId: string): Promise<unknown[]> {
    const value = await this.request<
      unknown[] | { assetVersions?: unknown[]; versions?: unknown[] }
    >(`${API}/assets/v1/assets/${encodeURIComponent(assetId)}/versions`);
    return Array.isArray(value) ? value : (value.assetVersions ?? value.versions ?? []);
  }

  async create(input: {
    filePath: string;
    mimeType: string;
    assetType: AssetType;
    displayName: string;
    description: string;
    creator: CreatorTarget;
  }): Promise<{ operationId: string }> {
    const form = new FormData();
    const bytes = await fs.readFile(input.filePath);
    const request = {
      assetType: input.assetType,
      displayName: input.displayName,
      description: input.description,
      creationContext: {
        creator:
          input.creator.kind === "group"
            ? { groupId: input.creator.id }
            : { userId: input.creator.id },
      },
    };
    form.set("request", JSON.stringify(request));
    form.set(
      "fileContent",
      new Blob([bytes], { type: input.mimeType }),
      path.basename(input.filePath),
    );
    const value = await this.request<Record<string, unknown>>(`${API}/assets/v1/assets`, {
      method: "POST",
      body: form,
    });
    const operationId = String(value.path ?? value.operationId ?? "").replace(/^operations\//, "");
    if (!operationId)
      throw new Error("Roblox accepted the upload but did not return an operation ID.");
    return { operationId };
  }

  async operation(
    operationId: string,
  ): Promise<{ done: boolean; asset?: AssetSummary; error?: string }> {
    const value = await this.request<Record<string, unknown>>(
      `${API}/assets/v1/operations/${encodeURIComponent(operationId)}`,
    );
    if (!value.done) return { done: false };
    if (value.error) {
      const error = value.error as Record<string, unknown>;
      return { done: true, error: String(error.message ?? "Roblox could not process this asset.") };
    }
    const response = value.response as Record<string, unknown> | undefined;
    return response
      ? { done: true, asset: this.asset(response, "history") }
      : { done: true, error: "The completed operation did not contain an asset." };
  }

  async updateMetadata(assetId: string, displayName: string, description: string): Promise<void> {
    const form = new FormData();
    form.set("request", JSON.stringify({ assetId, displayName, description }));
    await this.request(
      `${API}/assets/v1/assets/${encodeURIComponent(assetId)}?updateMask=description%2CdisplayName`,
      {
        method: "PATCH",
        body: form,
      },
    );
  }

  async rollback(assetId: string, versionNumber: string): Promise<void> {
    await this.request(`${API}/assets/v1/assets/${encodeURIComponent(assetId)}/versions:rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetVersion: `assets/${assetId}/versions/${versionNumber}` }),
    });
  }

  async archive(assetId: string, restore = false): Promise<void> {
    await this.request(
      `${API}/assets/v1/assets/${encodeURIComponent(assetId)}:${restore ? "restore" : "archive"}`,
      { method: "POST" },
    );
  }

  private asset(value: Record<string, unknown>, source: "history" | "inventory"): AssetSummary {
    const assetId = String(
      value.assetId ??
        String(value.path ?? "")
          .split("/")
          .pop() ??
        "",
    );
    const moderation = value.moderationResult as Record<string, unknown> | undefined;
    const context = value.creationContext as
      { creator?: { userId?: string; groupId?: string } } | undefined;
    const creator = context?.creator?.groupId
      ? {
          kind: "group" as const,
          id: String(context.creator.groupId),
          label: `Group ${context.creator.groupId}`,
        }
      : context?.creator?.userId
        ? {
            kind: "user" as const,
            id: String(context.creator.userId),
            label: `User ${context.creator.userId}`,
          }
        : undefined;
    return {
      assetId,
      displayName: String(value.displayName ?? `Asset ${assetId}`),
      description: typeof value.description === "string" ? value.description : undefined,
      assetType:
        typeof value.assetType === "string"
          ? value.assetType.replace(/^ASSET_TYPE_/, "")
          : undefined,
      moderationState:
        typeof moderation?.moderationState === "string"
          ? moderation.moderationState.replace(/^MODERATION_STATE_/, "")
          : undefined,
      revisionId: value.revisionId ? String(value.revisionId) : undefined,
      createdAt:
        typeof value.revisionCreateTime === "string" ? value.revisionCreateTime : undefined,
      creator,
      source,
    };
  }

  private async addThumbnails(assets: AssetSummary[]): Promise<void> {
    const ids = assets.map((a) => a.assetId).filter(Boolean);
    for (let index = 0; index < ids.length; index += 100) {
      const batch = ids.slice(index, index + 100);
      try {
        const response = await fetch(
          `https://thumbnails.roblox.com/v1/assets?assetIds=${batch.join(",")}&returnPolicy=PlaceHolder&size=420x420&format=Png&isCircular=false`,
        );
        if (!response.ok) continue;
        const value = (await response.json()) as {
          data?: Array<{ targetId: number; imageUrl?: string }>;
        };
        const urls = new Map((value.data ?? []).map((x) => [String(x.targetId), x.imageUrl]));
        for (const asset of assets) asset.thumbnailUrl = urls.get(asset.assetId);
      } catch {
        /* thumbnails are optional */
      }
    }
  }
}
