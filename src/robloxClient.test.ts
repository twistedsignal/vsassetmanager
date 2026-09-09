import { afterEach, describe, expect, it, vi } from "vitest";
import { RobloxClient } from "./robloxClient";

afterEach(() => vi.unstubAllGlobals());

describe("RobloxClient creator discovery", () => {
  it("resolves user and group display names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("users.roblox.com")) {
          return Response.json({ name: "builderman", displayName: "Builderman" });
        }
        return Response.json({ name: "Roblox" });
      }),
    );
    const client = new RobloxClient("secret");
    await expect(
      client.resolveCreator({ kind: "user", id: "156", label: "156" }),
    ).resolves.toMatchObject({ label: "Builderman (@builderman)" });
    await expect(
      client.resolveCreator({ kind: "group", id: "1", label: "Group 1" }),
    ).resolves.toMatchObject({ label: "Roblox" });
  });

  it("loads each Creator Store category and maps results", async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("thumbnails.roblox.com")) return Response.json({ data: [] });
      const category = new URL(url).searchParams.get("searchCategoryType");
      return Response.json({
        creatorStoreAssets:
          category === "Decal"
            ? [
                {
                  asset: {
                    id: 42,
                    name: "UI texture",
                    assetTypeId: 13,
                    createTime: "2026-01-01T00:00:00Z",
                  },
                },
              ]
            : [],
      });
    });
    vi.stubGlobal("fetch", request);
    const assets = await new RobloxClient("secret").creatorAssets({
      kind: "group",
      id: "7",
      label: "Studio",
    });
    expect(assets).toEqual([
      expect.objectContaining({ assetId: "42", assetType: "Decal", source: "creator" }),
    ]);
    expect(
      request.mock.calls.filter(([input]) => String(input).includes("assets:search")),
    ).toHaveLength(7);
    expect(request.mock.calls.some(([input]) => String(input).includes("groupId=7"))).toBe(true);
  });
});
