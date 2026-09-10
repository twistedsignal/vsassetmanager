# Roblox Asset Manager

A thumbnail-first Roblox asset manager for VS Code. It is designed around Rojo workflows, but Rojo is optional.

## What works

- Browse tracked assets in a repository-style explorer, with Roblox usernames and group names resolved automatically.
- Filter each creator by images, audio, models, animations, video, and archived assets.
- Bulk upload images, audio, video, models, and animations supported by Roblox Open Cloud.
- Publish to a user or configured group.
- Review names, descriptions, and ambiguous asset types before uploading.
- Track upload and processing states, cancel queued work, and retry transient failures.
- Copy numeric IDs, `rbxassetid://` URIs, Lua strings, or a custom template.
- Read and edit metadata, inspect versions, roll back, archive, and restore through supported APIs.
- Share a `.roblox-assets.json` manifest with the rest of the repository.
- Import or export an asset index.

The extension indexes every successful upload. **Add IDs** can backfill assets created in Studio or Creator Dashboard. Refresh updates the metadata and thumbnails for known IDs. It does not mix avatar inventory or Creator Store results into the library.

When a workspace is open, the extension creates `.roblox-assets.json` and keeps it in sync with uploads, added IDs, imports, metadata refreshes, and archive changes. Commit that file so everyone working in the repository gets the same asset index. The manifest contains no API keys. Source paths are workspace-relative.

Roblox does not expose the complete private Development Items list used by Creator Dashboard and Studio through Open Cloud. Unknown historical assets cannot be discovered by creator ID alone. The extension never reads browser cookies or undocumented Roblox sessions.

## Setup

1. Create an Open Cloud API key in the [Roblox Creator Dashboard](https://create.roblox.com/dashboard/credentials).
2. Give it the asset read/write permissions needed for the features you use. Restrict the key to the intended creator resources and IP addresses.
3. Open the Roblox Assets sidebar and choose **Configure API key**.
4. Enter your numeric user ID, optional group IDs, and the key.

The extension stores the key in VS Code SecretStorage. It is not placed in settings, the webview, logs, or exported upload indexes.

## Supported upload files

| Family | Extensions |
| --- | --- |
| Images and decals | `.png`, `.jpg`, `.jpeg`, `.bmp`, `.tga` |
| Audio | `.mp3`, `.ogg`, `.wav`, `.flac` |
| Video | `.mp4`, `.mov` |
| Models | `.fbx`, `.gltf`, `.glb`, `.rbxm`, `.rbxmx` |
| Animations | `.rbxm`, `.rbxmx` |

Roblox applies additional size, duration, dimension, moderation, quota, ownership, and pricing rules. The upload review catches local format and size errors; Roblox remains authoritative.

## Development

```sh
pnpm install
pnpm check
pnpm build
```

Press F5 in VS Code to launch an Extension Development Host.

## Intentional boundaries

This extension uses documented Open Cloud APIs. It does not read Roblox cookies, inject code into Studio, reuse Rojo's sync protocol, or claim support for Studio-only importer behavior. OAuth and a companion Studio plugin may be added later.
