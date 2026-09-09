import { describe, expect, it } from "vitest";
import { candidateFor, copyValue } from "./capabilities";

describe("candidateFor", () => {
  it("uses the configured default for ambiguous images", () => {
    const item = candidateFor("/tmp/hero-icon.png", 12_000, "Image", "default");
    expect(item.assetType).toBe("Image");
    expect(item.allowedTypes).toEqual(["Decal", "Image"]);
    expect(item.displayName).toBe("hero icon");
    expect(item.mimeType).toBe("image/png");
  });

  it("requires a choice for rbxm files", () => {
    const item = candidateFor("/tmp/walk.rbxm", 100, "Decal", "");
    expect(item.assetType).toBeUndefined();
    expect(item.allowedTypes).toEqual(["Model", "Animation"]);
  });

  it("rejects unknown formats and oversized bounded files", () => {
    expect(candidateFor("/tmp/readme.txt", 10, "Decal", "").validationError).toContain("Unsupported");
    expect(candidateFor("/tmp/huge.wav", 20_000_001, "Decal", "").validationError).toContain("20 MB");
  });
});

describe("copyValue", () => {
  it.each([
    ["numeric", "123"],
    ["uri", "rbxassetid://123"],
    ["lua", "\"rbxassetid://123\""],
    ["custom", "asset(123)"]
  ])("renders %s format", (format, expected) => {
    expect(copyValue("123", format, "asset(${id})")).toBe(expected);
  });

  it("rejects unsafe custom templates", () => {
    expect(() => copyValue("123", "custom", "no placeholder")).toThrow(/exactly one/);
    expect(() => copyValue("123", "custom", "${id}${id}")).toThrow(/exactly one/);
  });
});
