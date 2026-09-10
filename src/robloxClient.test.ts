import { afterEach, describe, expect, it, vi } from "vitest";
import { RobloxClient } from "./robloxClient";

afterEach(() => vi.unstubAllGlobals());

describe("RobloxClient creator identity", () => {
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

  it("keeps the requested ID when an asset response omits its identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("thumbnails.roblox.com")) {
          return Response.json({
            data: [{ targetId: 42, imageUrl: "https://tr.rbxcdn.com/example.png" }],
          });
        }
        return Response.json({ displayName: "Icon", assetType: "Decal" });
      }),
    );

    await expect(new RobloxClient("secret").details("42")).resolves.toMatchObject({
      assetId: "42",
      displayName: "Icon",
      thumbnailUrl: "https://tr.rbxcdn.com/example.png",
    });
  });
});
