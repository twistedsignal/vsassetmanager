import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  Archive as ArchiveIcon,
  ArrowClockwise,
  CaretDown,
  CaretRight,
  Check,
  CloudArrowUp,
  Copy,
  DotsThree,
  FileAudio,
  FileImage,
  FileVideo,
  FolderSimple,
  MagnifyingGlass,
  Package,
  Plus,
  Queue,
  Rows,
  SlidersHorizontal,
  Trash,
  User,
  Users,
  X,
} from "@phosphor-icons/react";
import type {
  AssetSummary,
  CreatorTarget,
  ExtensionState,
  HostMessage,
  UploadCandidate,
  WebviewMessage,
} from "../../src/model";
import "./style.css";

declare function acquireVsCodeApi<T = unknown>(): { postMessage(message: WebviewMessage): void };
const vscode = acquireVsCodeApi();
const empty: ExtensionState = {
  configured: false,
  profiles: [],
  history: [],
  jobs: [],
  copyFormat: { format: "uri", customTemplate: "rbxassetid://${id}" },
  loading: false,
  isRojoProject: false,
};
type Folder = "all" | "images" | "audio" | "models" | "animations" | "video" | "archived";
const folders: Array<{ id: Folder; label: string }> = [
  { id: "all", label: "All assets" },
  { id: "images", label: "Images" },
  { id: "audio", label: "Audio" },
  { id: "models", label: "Models" },
  { id: "animations", label: "Animations" },
  { id: "video", label: "Video" },
  { id: "archived", label: "Archived" },
];

function App() {
  const [state, setState] = useState(empty),
    [creatorKey, setCreatorKey] = useState(""),
    [folder, setFolder] = useState<Folder>("all"),
    [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [candidates, setCandidates] = useState<UploadCandidate[]>(),
    [details, setDetails] = useState<AssetSummary>(),
    [versions, setVersions] = useState<unknown[]>(),
    [notice, setNotice] = useState<string>(),
    [queueOpen, setQueueOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) => {
      const m = event.data;
      if (m.type === "state") setState(m.state);
      else if (m.type === "candidates") setCandidates(m.candidates);
      else if (m.type === "assetDetails") setDetails(m.asset);
      else if (m.type === "assetVersions") setVersions(m.versions);
      else if (m.type === "assetsRemoved") {
        setSelected((current) => {
          const next = new Set(current);
          for (const id of m.ids) next.delete(id);
          return next;
        });
        setDetails((current) => (current && m.ids.includes(current.assetId) ? undefined : current));
      } else if (m.type === "notice") {
        setNotice(m.message);
        window.setTimeout(() => setNotice(undefined), 5000);
      }
    };
    window.addEventListener("message", listener);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", listener);
  }, []);
  const creators = state.profile?.creators ?? [],
    activeCreator = creators.find((c) => keyFor(c) === creatorKey) ?? creators[0];
  useEffect(() => {
    if (!creatorKey && creators[0]) setCreatorKey(keyFor(creators[0]));
  }, [creatorKey, creators]);
  const repositoryAssets = useMemo(() => {
    if (!activeCreator) return [];
    return state.history.filter((asset) => sameCreator(asset.creator, activeCreator));
  }, [activeCreator, state.history]);
  const shown = useMemo(
    () =>
      repositoryAssets.filter((asset) => {
        const matchesFolder =
          folder === "archived" ? asset.archived : !asset.archived && inFolder(asset, folder);
        return (
          matchesFolder &&
          `${asset.displayName} ${asset.assetId} ${asset.assetType}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
        );
      }),
    [repositoryAssets, folder, query],
  );
  useGSAP(
    () => {
      if (listRef.current)
        gsap.fromTo(
          listRef.current.querySelectorAll(".asset-row"),
          { opacity: 0, y: 8 },
          {
            opacity: 1,
            y: 0,
            duration: 0.28,
            stagger: 0.025,
            ease: "power2.out",
            clearProps: "all",
          },
        );
    },
    { scope: listRef, dependencies: [creatorKey, folder, query, shown.length] },
  );
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  if (!state.configured) return <Welcome />;
  return (
    <main className="app-shell">
      <aside className="repo-sidebar">
        <div className="repo-head">
          <strong>Creators</strong>
          <button
            className="icon-button"
            title="Manage creators"
            onClick={() => vscode.postMessage({ type: "manageCreators" })}
          >
            <Plus size={15} weight="bold" />
          </button>
        </div>
        <div className="repo-tree">
          {creators.map((creator) => {
            const active = activeCreator && keyFor(activeCreator) === keyFor(creator);
            const creatorIds = new Set(
              state.history
                .filter((asset) => sameCreator(asset.creator, creator) && !asset.archived)
                .map((asset) => asset.assetId),
            );
            const count = creatorIds.size;
            return (
              <div className="repo-entry" key={keyFor(creator)}>
                <div className={`repo ${active ? "active" : ""}`}>
                  <button
                    className="repo-select"
                    onClick={() => {
                      setCreatorKey(keyFor(creator));
                      setFolder("all");
                      setSelected(new Set());
                    }}
                  >
                    {active ? (
                      <CaretDown size={13} weight="bold" />
                    ) : (
                      <CaretRight size={13} weight="bold" />
                    )}
                    {creator.kind === "group" ? (
                      <Users size={16} weight="fill" />
                    ) : (
                      <User size={16} weight="fill" />
                    )}
                    <span>{creator.label}</span>
                    <small>{count}</small>
                  </button>
                  {creator.kind === "group" && (
                    <button
                      className="icon-button repo-remove"
                      title={`Remove ${creator.label}`}
                      onClick={() => vscode.postMessage({ type: "removeCreator", creator })}
                    >
                      <Trash size={14} />
                    </button>
                  )}
                </div>
                {active && (
                  <div className="folder-tree">
                    {folders.map((item) => (
                      <button
                        key={item.id}
                        className={folder === item.id ? "active" : ""}
                        onClick={() => {
                          setFolder(item.id);
                          setSelected(new Set());
                        }}
                      >
                        <FolderSimple size={14} weight={folder === item.id ? "fill" : "regular"} />
                        <span>{item.label}</span>
                        <small>{countFolder(repositoryAssets, item.id)}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {state.manifestPath && (
          <button className="account" onClick={() => vscode.postMessage({ type: "openManifest" })}>
            <Rows size={15} />
            <span>Shared manifest</span>
          </button>
        )}
        <button className="account" onClick={() => vscode.postMessage({ type: "switchProfile" })}>
          <SlidersHorizontal size={15} />
          <span>{state.profile?.label}</span>
        </button>
      </aside>
      <section className="content">
        <header className="command-bar">
          <div className="repo-title">
            {activeCreator?.kind === "group" ? (
              <Users size={17} weight="fill" />
            ) : (
              <User size={17} weight="fill" />
            )}
            <strong>{activeCreator?.label ?? "Assets"}</strong>
            <span>/</span>
            <span>{folders.find((item) => item.id === folder)?.label}</span>
          </div>
          <div className="commands">
            <button
              className="secondary"
              onClick={() => vscode.postMessage({ type: "addExistingIds", creator: activeCreator })}
            >
              <Plus size={15} weight="bold" />
              Add IDs
            </button>
            <button onClick={() => vscode.postMessage({ type: "pickFiles" })}>
              <CloudArrowUp size={16} weight="bold" />
              Upload
            </button>
          </div>
        </header>
        <div className="filter-bar">
          <label className="search">
            <MagnifyingGlass size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter assets"
              aria-label="Filter assets"
            />
          </label>
          <button
            className="icon-button"
            title="Refresh"
            onClick={() => vscode.postMessage({ type: "refresh" })}
          >
            <ArrowClockwise size={16} weight="bold" />
          </button>
          <button
            className={`icon-button ${queueOpen ? "active" : ""}`}
            title="Upload queue"
            onClick={() => setQueueOpen((v) => !v)}
          >
            <Queue size={17} weight="bold" />
            {state.jobs.some((j) => j.status === "uploading" || j.status === "processing") && <i />}
          </button>
        </div>
        {selected.size > 0 && (
          <div className="selection-bar">
            <span>{selected.size} selected</span>
            <button
              className="secondary"
              onClick={() => vscode.postMessage({ type: "copy", ids: [...selected] })}
            >
              <Copy size={15} />
              Copy IDs
            </button>
            <button
              className="danger"
              onClick={() => vscode.postMessage({ type: "removeAssets", ids: [...selected] })}
            >
              <Trash size={15} />
              Remove
            </button>
            <button className="icon-button" title="Clear" onClick={() => setSelected(new Set())}>
              <X size={15} />
            </button>
          </div>
        )}
        {state.loading && <div className="loading-line" />}
        {state.error && <div className="inline-error">{state.error}</div>}
        <div className="asset-list" ref={listRef}>
          <div className="list-head">
            <span>Name</span>
            <span>Type</span>
            <span>ID</span>
            <span />
          </div>
          {shown.map((asset) => (
            <AssetRow
              key={asset.assetId}
              asset={asset}
              selected={selected.has(asset.assetId)}
              displayId={formatId(asset.assetId, state.copyFormat)}
              onToggle={() => toggle(asset.assetId)}
              onOpen={() => {
                setDetails(asset);
                setVersions(undefined);
                vscode.postMessage({ type: "details", assetId: asset.assetId });
              }}
            />
          ))}
          {!shown.length && <Empty folder={folder} hasAssets={repositoryAssets.length > 0} />}
        </div>
      </section>
      {queueOpen && <QueuePanel state={state} onClose={() => setQueueOpen(false)} />}{" "}
      {candidates && (
        <UploadReview
          candidates={candidates}
          creators={creators}
          initialCreator={activeCreator}
          onClose={() => setCandidates(undefined)}
          onSubmit={(items, creator) => {
            vscode.postMessage({ type: "submitUpload", candidates: items, creator });
            setCandidates(undefined);
            setQueueOpen(true);
          }}
        />
      )}{" "}
      {details && (
        <Details
          asset={details}
          displayId={formatId(details.assetId, state.copyFormat)}
          versions={versions}
          onClose={() => {
            setDetails(undefined);
            setVersions(undefined);
          }}
        />
      )}{" "}
      {notice && (
        <div className="toast" role="alert">
          {notice}
        </div>
      )}
    </main>
  );
}

function Welcome() {
  return (
    <main className="welcome">
      <Package size={34} weight="duotone" />
      <h1>Roblox assets</h1>
      <p>Connect an Open Cloud key to begin.</p>
      <button onClick={() => vscode.postMessage({ type: "configure" })}>Connect</button>
      <a href="https://create.roblox.com/dashboard/credentials">Create API key</a>
    </main>
  );
}
function AssetRow({
  asset,
  displayId,
  selected,
  onToggle,
  onOpen,
}: {
  asset: AssetSummary;
  displayId: string;
  selected: boolean;
  onToggle(): void;
  onOpen(): void;
}) {
  return (
    <div className={`asset-row ${selected ? "selected" : ""}`}>
      <label className="check">
        <input type="checkbox" checked={selected} onChange={onToggle} />
        <span>
          <Check size={11} weight="bold" />
        </span>
      </label>
      <button className="asset-main" onClick={onOpen}>
        <Thumbnail asset={asset} />
        <strong>{asset.displayName}</strong>
      </button>
      <span className="type">{cleanType(asset.assetType)}</span>
      <button
        className="asset-id"
        onClick={() => vscode.postMessage({ type: "copy", ids: [asset.assetId] })}
      >
        {displayId}
      </button>
      <button className="icon-button row-menu" title="Details" onClick={onOpen}>
        <DotsThree size={18} weight="bold" />
      </button>
    </div>
  );
}
function Thumbnail({ asset }: { asset: AssetSummary }) {
  if (asset.thumbnailUrl)
    return (
      <span className="row-thumb">
        <img src={asset.thumbnailUrl} alt="" />
      </span>
    );
  const type = cleanType(asset.assetType).toLowerCase(),
    Icon = type.includes("audio")
      ? FileAudio
      : type.includes("video")
        ? FileVideo
        : type.includes("image") || type.includes("decal")
          ? FileImage
          : Package;
  return (
    <span className="row-thumb fallback">
      <Icon size={19} weight="duotone" />
    </span>
  );
}
function Empty({ folder, hasAssets }: { folder: Folder; hasAssets: boolean }) {
  return (
    <div className="empty">
      <Rows size={28} weight="duotone" />
      <strong>
        {hasAssets
          ? `No ${folders.find((i) => i.id === folder)?.label.toLowerCase()}`
          : "No indexed assets"}
      </strong>
      <div>
        <button onClick={() => vscode.postMessage({ type: "pickFiles" })}>Upload</button>
        <button
          className="secondary"
          onClick={() => vscode.postMessage({ type: "addExistingIds" })}
        >
          Add IDs
        </button>
      </div>
    </div>
  );
}
function QueuePanel({ state, onClose }: { state: ExtensionState; onClose(): void }) {
  return (
    <aside className="side-panel">
      <div className="panel-head">
        <strong>Uploads</strong>
        <button className="icon-button" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="jobs">
        {state.jobs.length ? (
          state.jobs.map((job) => (
            <div className="job" key={job.id}>
              <span className={`job-dot ${job.status}`} />
              <div>
                <strong>{job.displayName}</strong>
                <small>
                  {job.status}
                  {job.error ? `: ${job.error}` : ""}
                </small>
              </div>
              {["queued", "uploading", "processing"].includes(job.status) && (
                <button
                  className="icon-button"
                  onClick={() => vscode.postMessage({ type: "cancelJob", id: job.id })}
                >
                  <X size={14} />
                </button>
              )}
              {job.assetId && (
                <button
                  className="icon-button"
                  onClick={() => vscode.postMessage({ type: "copy", ids: [job.assetId!] })}
                >
                  <Copy size={14} />
                </button>
              )}
            </div>
          ))
        ) : (
          <div className="panel-empty">No uploads</div>
        )}
      </div>
    </aside>
  );
}
function UploadReview({
  candidates: initial,
  creators,
  initialCreator,
  onClose,
  onSubmit,
}: {
  candidates: UploadCandidate[];
  creators: CreatorTarget[];
  initialCreator?: CreatorTarget;
  onClose(): void;
  onSubmit(items: UploadCandidate[], creator: CreatorTarget): void;
}) {
  const [items, setItems] = useState(initial),
    [creatorIndex, setCreatorIndex] = useState(
      Math.max(
        0,
        creators.findIndex((c) => initialCreator && sameCreator(c, initialCreator)),
      ),
    );
  const update = (id: string, change: Partial<UploadCandidate>) =>
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, ...change } : item)),
      ),
    valid = items.filter((item) => item.assetType && !item.validationError);
  return (
    <div className="overlay">
      <section className="modal">
        <div className="panel-head">
          <strong>Upload {items.length} files</strong>
          <button className="icon-button" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <label className="field">
          Creator
          <select value={creatorIndex} onChange={(e) => setCreatorIndex(Number(e.target.value))}>
            {creators.map((c, i) => (
              <option value={i} key={keyFor(c)}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div className="review-list">
          {items.map((item) => (
            <div className="review-row" key={item.id}>
              <span className={`file-tile ${item.previewUrl ? "preview" : ""}`}>
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt="" />
                ) : (
                  item.fileName.split(".").pop()?.toUpperCase()
                )}
              </span>
              <div>
                <input
                  value={item.displayName}
                  onChange={(e) => update(item.id, { displayName: e.target.value })}
                />
                <small>
                  {item.fileName} · {formatBytes(item.size)}
                </small>
                {item.validationError && <small className="error">{item.validationError}</small>}
              </div>
              <select
                value={item.assetType ?? ""}
                onChange={(e) =>
                  update(item.id, { assetType: e.target.value as UploadCandidate["assetType"] })
                }
              >
                <option value="">Type</option>
                {item.allowedTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
              <button
                className="icon-button"
                onClick={() => setItems((current) => current.filter((x) => x.id !== item.id))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <span>{valid.length} ready</span>
          <button
            disabled={!valid.length || !creators[creatorIndex]}
            onClick={() => onSubmit(valid, creators[creatorIndex]!)}
          >
            Upload
          </button>
        </div>
      </section>
    </div>
  );
}
function Details({
  asset,
  displayId,
  versions,
  onClose,
}: {
  asset: AssetSummary;
  displayId: string;
  versions?: unknown[];
  onClose(): void;
}) {
  const [name, setName] = useState(asset.displayName),
    [description, setDescription] = useState(asset.description ?? ""),
    imageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setName(asset.displayName);
    setDescription(asset.description ?? "");
  }, [asset]);
  useGSAP(
    () => {
      if (imageRef.current)
        gsap.fromTo(
          imageRef.current,
          { opacity: 0.2, scale: 0.94 },
          { opacity: 1, scale: 1, duration: 0.45, ease: "power3.out" },
        );
    },
    { scope: imageRef, dependencies: [asset.assetId] },
  );
  return (
    <aside className="side-panel details">
      <div className="panel-head">
        <strong>{asset.displayName}</strong>
        <button className="icon-button" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="detail-image" ref={imageRef}>
        {asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" /> : <Thumbnail asset={asset} />}
      </div>
      <div className="detail-id">
        <code>{displayId}</code>
        <button
          className="icon-button"
          onClick={() => vscode.postMessage({ type: "copy", ids: [asset.assetId] })}
        >
          <Copy size={15} />
        </button>
      </div>
      <label className="field">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <dl>
        <dt>Type</dt>
        <dd>{cleanType(asset.assetType)}</dd>
        <dt>Status</dt>
        <dd>{asset.moderationState || "Unknown"}</dd>
        <dt>Revision</dt>
        <dd>{asset.revisionId || "Unknown"}</dd>
      </dl>
      <button
        onClick={() =>
          vscode.postMessage({
            type: "updateMetadata",
            assetId: asset.assetId,
            displayName: name,
            description,
          })
        }
      >
        Save
      </button>
      <div className="detail-links">
        <button
          className="secondary"
          onClick={() => vscode.postMessage({ type: "versions", assetId: asset.assetId })}
        >
          Versions
        </button>
        {asset.archived ? (
          <button
            className="secondary"
            onClick={() =>
              vscode.postMessage({ type: "archive", assetId: asset.assetId, restore: true })
            }
          >
            Restore
          </button>
        ) : (
          <button
            className="danger"
            onClick={() => vscode.postMessage({ type: "archive", assetId: asset.assetId })}
          >
            <ArchiveIcon size={15} />
            Archive
          </button>
        )}
      </div>
      <button
        className="remove-index"
        onClick={() => vscode.postMessage({ type: "removeAssets", ids: [asset.assetId] })}
      >
        <Trash size={15} />
        Remove from index
      </button>
      {versions && (
        <div className="versions">
          {versions.length ? (
            versions.map((raw, i) => {
              const v = raw as Record<string, unknown>,
                n = String(
                  v.versionNumber ??
                    String(v.path ?? "")
                      .split("/")
                      .pop() ??
                    i + 1,
                );
              return (
                <div key={n}>
                  <span>Version {n}</span>
                  <button
                    className="secondary"
                    onClick={() =>
                      vscode.postMessage({
                        type: "rollback",
                        assetId: asset.assetId,
                        versionNumber: n,
                      })
                    }
                  >
                    Rollback
                  </button>
                </div>
              );
            })
          ) : (
            <span>No versions</span>
          )}
        </div>
      )}
    </aside>
  );
}
function keyFor(c: CreatorTarget) {
  return `${c.kind}:${c.id}`;
}
function sameCreator(a: CreatorTarget | undefined, b: CreatorTarget) {
  return Boolean(a && a.kind === b.kind && a.id === b.id);
}

function formatId(id: string, setting: { format: string; customTemplate: string }): string {
  if (setting.format === "numeric") return id;
  if (setting.format === "lua") return `"rbxassetid://${id}"`;
  if (setting.format === "custom" && setting.customTemplate.includes("${id}")) {
    return setting.customTemplate.replace("${id}", id);
  }
  return `rbxassetid://${id}`;
}
function cleanType(v?: string) {
  return (v || "Asset")
    .replace(/^ASSET_TYPE_/, "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (x) => x.toUpperCase());
}
function inFolder(asset: AssetSummary, folder: Folder) {
  const type = cleanType(asset.assetType).toLowerCase();
  if (folder === "all") return true;
  if (folder === "images") return /image|decal|texture|shirt|tshirt|pants/.test(type);
  if (folder === "audio") return /audio|sound/.test(type);
  if (folder === "models") return /model|mesh|package/.test(type);
  if (folder === "animations") return /animation/.test(type);
  if (folder === "video") return /video/.test(type);
  return false;
}
function countFolder(assets: AssetSummary[], folder: Folder) {
  return assets.filter((a) =>
    folder === "archived" ? a.archived : !a.archived && inFolder(a, folder),
  ).length;
}
function formatBytes(v: number) {
  return v < 1000
    ? `${v} B`
    : v < 1_000_000
      ? `${(v / 1000).toFixed(1)} KB`
      : `${(v / 1_000_000).toFixed(1)} MB`;
}
createRoot(document.getElementById("root")!).render(<App />);
