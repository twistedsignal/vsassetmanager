import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AssetSummary, CreatorTarget, ExtensionState, HostMessage, UploadCandidate, WebviewMessage } from "../../src/model";
import "./style.css";

declare function acquireVsCodeApi<T = unknown>(): { postMessage(message: WebviewMessage): void; getState(): T; setState(value: T): void };
const vscode = acquireVsCodeApi();
const empty: ExtensionState = { configured: false, profiles: [], history: [], inventory: [], jobs: [], loading: false, isRojoProject: false };

function App() {
  const [state, setState] = useState(empty);
  const [tab, setTab] = useState<"history" | "inventory" | "archived" | "queue">("history");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [candidates, setCandidates] = useState<UploadCandidate[]>();
  const [details, setDetails] = useState<AssetSummary>();
  const [versions, setVersions] = useState<unknown[]>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message.type === "state") setState(message.state);
      else if (message.type === "candidates") setCandidates(message.candidates);
      else if (message.type === "assetDetails") setDetails(message.asset);
      else if (message.type === "assetVersions") setVersions(message.versions);
      else if (message.type === "notice") { setNotice(message.message); window.setTimeout(() => setNotice(undefined), 6000); }
    };
    window.addEventListener("message", listener);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", listener);
  }, []);

  const assets = tab === "inventory" ? state.inventory : tab === "archived" ? state.history.filter(asset => asset.archived) : state.history.filter(asset => !asset.archived);
  const shown = useMemo(() => assets.filter(asset => `${asset.displayName} ${asset.assetId} ${asset.assetType}`.toLowerCase().includes(query.toLowerCase())), [assets, query]);
  const toggle = (id: string) => setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });

  if (!state.configured) return <Welcome rojo={state.isRojoProject} />;
  return <main>
    <header>
      <div><p className="eyebrow">{state.isRojoProject ? "Rojo project" : "Roblox workspace"}</p><h1>Assets</h1></div>
      <div className="header-actions"><button className="quiet" onClick={() => vscode.postMessage({ type: "switchProfile" })}>{state.profile?.label}</button><button onClick={() => vscode.postMessage({ type: "pickFiles" })}>Upload</button></div>
    </header>
    <nav aria-label="Asset sections">
      <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>My uploads <span>{state.history.length}</span></button>
      <button className={tab === "inventory" ? "active" : ""} onClick={() => setTab("inventory")}>Inventory <span>{state.inventory.length}</span></button>
      <button className={tab === "archived" ? "active" : ""} onClick={() => setTab("archived")}>Archived <span>{state.history.filter(asset => asset.archived).length}</span></button>
      <button className={tab === "queue" ? "active" : ""} onClick={() => setTab("queue")}>Queue <span>{state.jobs.filter(j => j.status !== "done").length}</span></button>
    </nav>
    {tab !== "queue" && <section className="toolbar"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, ID, or type" aria-label="Search assets"/><button className="icon" title="Refresh" onClick={() => vscode.postMessage({ type: "refresh" })}>↻</button></section>}
    {selected.size > 0 && <div className="selection"><span>{selected.size} selected</span><button onClick={() => vscode.postMessage({ type: "copy", ids: [...selected] })}>Copy IDs</button><button className="quiet" onClick={() => setSelected(new Set())}>Clear</button></div>}
    {state.loading && <div className="progress" />}
    {state.error && <p className="error">{state.error}</p>}
    {tab === "queue" ? <Queue state={state} /> : shown.length ? <div className="grid">{shown.map(asset => <AssetCard key={`${asset.source}-${asset.assetId}`} asset={asset} selected={selected.has(asset.assetId)} onToggle={() => toggle(asset.assetId)} onDetails={() => { setDetails(asset); setVersions(undefined); vscode.postMessage({ type: "details", assetId: asset.assetId }); }}/>)}</div> : <Empty tab={tab} onUpload={() => vscode.postMessage({ type: "pickFiles" })}/>} 
    {tab === "inventory" && state.inventoryNextPageToken && <button className="load" onClick={() => vscode.postMessage({ type: "loadMore" })}>Load more</button>}
    {candidates && <UploadReview candidates={candidates} creators={state.profile?.creators ?? []} onClose={() => setCandidates(undefined)} onSubmit={(items, creator) => { vscode.postMessage({ type: "submitUpload", candidates: items, creator }); setCandidates(undefined); setTab("queue"); }}/>} 
    {details && <Details asset={details} versions={versions} onClose={() => { setDetails(undefined); setVersions(undefined); }}/>} 
    {notice && <div className="toast" role="alert">{notice}</div>}
  </main>;
}

function Welcome({ rojo }: { rojo: boolean }) { return <main className="welcome"><div className="mark">◇</div><p className="eyebrow">{rojo ? "Rojo project detected" : "Roblox Open Cloud"}</p><h1>Your assets, inside VS Code.</h1><p>Browse your inventory, bulk upload files, and copy usable asset IDs without bouncing through Studio.</p><button onClick={() => vscode.postMessage({ type: "configure" })}>Configure API key</button><a href="https://create.roblox.com/dashboard/credentials">Create a key on Roblox ↗</a><small>Keys stay in VS Code SecretStorage and never enter the webview.</small></main> }

function Empty({ tab, onUpload }: { tab: string; onUpload(): void }) { return <div className="empty"><h2>{tab === "history" ? "No tracked uploads yet" : tab === "archived" ? "No archived assets" : "No inventory items found"}</h2><p>{tab === "history" ? "Assets uploaded here will remain indexed across projects." : tab === "archived" ? "Archived uploads will appear here and can be restored." : "Check the API key's inventory scope, or refresh the library."}</p>{tab === "history" && <button onClick={onUpload}>Choose files</button>}</div> }

function AssetCard({ asset, selected, onToggle, onDetails }: { asset: AssetSummary; selected: boolean; onToggle(): void; onDetails(): void }) { return <article className={selected ? "card selected" : "card"}>
  <button className="preview" onClick={onDetails} aria-label={`Open ${asset.displayName}`}><div className="thumb">{asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt=""/> : <span>{asset.assetType?.slice(0, 2) || "?"}</span>}</div></button>
  <div className="card-copy"><label><input type="checkbox" checked={selected} onChange={onToggle}/><span className="sr-only">Select</span></label><div><strong title={asset.displayName}>{asset.displayName}</strong><small>{asset.assetType || "Asset"} · {asset.assetId}</small></div></div>
  <div className="card-actions"><button onClick={() => vscode.postMessage({ type: "copy", ids: [asset.assetId] })}>Copy</button><button className="quiet" onClick={() => vscode.postMessage({ type: "open", assetId: asset.assetId })}>Open ↗</button></div>
</article> }

function Queue({ state }: { state: ExtensionState }) { return <div className="queue">{state.jobs.length ? state.jobs.map(job => <div className="job" key={job.id}><div className={`status ${job.status}`}/><div><strong>{job.displayName}</strong><small>{job.assetType || "Choose type"} · {formatBytes(job.size)}</small>{job.error && <p className="error">{job.error}</p>}</div><span className="job-state">{job.status}</span>{["queued", "uploading", "processing"].includes(job.status) && <button className="quiet" onClick={() => vscode.postMessage({ type: "cancelJob", id: job.id })}>Cancel</button>}{job.assetId && <button onClick={() => vscode.postMessage({ type: "copy", ids: [job.assetId!] })}>Copy ID</button>}</div>) : <div className="empty"><h2>The queue is empty</h2><p>Choose files or a folder to start a batch.</p><button onClick={() => vscode.postMessage({ type: "pickFiles" })}>Choose files</button></div>}</div> }

function UploadReview({ candidates: initial, creators, onClose, onSubmit }: { candidates: UploadCandidate[]; creators: CreatorTarget[]; onClose(): void; onSubmit(items: UploadCandidate[], creator: CreatorTarget): void }) {
  const [items, setItems] = useState(initial);
  const [creatorIndex, setCreatorIndex] = useState(0);
  const update = (id: string, change: Partial<UploadCandidate>) => setItems(current => current.map(item => item.id === id ? { ...item, ...change } : item));
  const valid = items.filter(item => item.assetType && !item.validationError);
  return <div className="overlay"><section className="modal wide" role="dialog" aria-modal="true" aria-label="Review upload"><div className="modal-head"><div><p className="eyebrow">Bulk import</p><h2>Review {items.length} files</h2></div><button className="quiet close" onClick={onClose}>×</button></div>
    <label className="field">Publish as<select value={creatorIndex} onChange={e => setCreatorIndex(Number(e.target.value))}>{creators.map((creator, i) => <option value={i} key={`${creator.kind}-${creator.id}`}>{creator.label}</option>)}</select></label>
    <div className="review-list">{items.map(item => <div className="review" key={item.id}><div className="file-icon">{item.fileName.split(".").pop()?.toUpperCase()}</div><div className="review-fields"><input value={item.displayName} onChange={e => update(item.id, { displayName: e.target.value })} aria-label={`Name for ${item.fileName}`}/><small>{item.fileName} · {formatBytes(item.size)}</small><textarea value={item.description} onChange={e => update(item.id, { description: e.target.value })} placeholder="Description"/></div><select value={item.assetType ?? ""} onChange={e => update(item.id, { assetType: e.target.value as UploadCandidate["assetType"] })} aria-label={`Type for ${item.fileName}`}><option value="">Choose type</option>{item.allowedTypes.map(type => <option key={type}>{type}</option>)}</select><button className="quiet" onClick={() => setItems(current => current.filter(x => x.id !== item.id))}>Remove</button>{item.validationError && <p className="error row-error">{item.validationError}</p>}</div>)}</div>
    <footer><span>{valid.length} ready, {items.length - valid.length} need attention</span><button disabled={!valid.length || !creators[creatorIndex]} onClick={() => onSubmit(valid, creators[creatorIndex]!)}>Upload {valid.length}</button></footer>
  </section></div>;
}

function Details({ asset, versions, onClose }: { asset: AssetSummary; versions?: unknown[]; onClose(): void }) {
  const [name, setName] = useState(asset.displayName); const [description, setDescription] = useState(asset.description ?? "");
  useEffect(() => { setName(asset.displayName); setDescription(asset.description ?? ""); }, [asset]);
  return <div className="drawer" role="dialog" aria-label="Asset details"><div className="modal-head"><div><p className="eyebrow">{asset.assetType || "Asset"}</p><h2>{asset.displayName}</h2></div><button className="quiet close" onClick={onClose}>×</button></div>
    <div className="detail-thumb">{asset.thumbnailUrl ? <img src={asset.thumbnailUrl} alt=""/> : <span>No preview</span>}</div>
    <dl><dt>Asset ID</dt><dd>{asset.assetId}</dd><dt>Moderation</dt><dd>{asset.moderationState || "Unknown"}</dd><dt>Revision</dt><dd>{asset.revisionId || "Unknown"}</dd><dt>Creator</dt><dd>{asset.creator?.label || "Unknown"}</dd></dl>
    <label className="field">Name<input value={name} onChange={e => setName(e.target.value)}/></label><label className="field">Description<textarea value={description} onChange={e => setDescription(e.target.value)}/></label>
    <div className="detail-actions"><button onClick={() => vscode.postMessage({ type: "updateMetadata", assetId: asset.assetId, displayName: name, description })}>Save metadata</button><button className="quiet" onClick={() => vscode.postMessage({ type: "copy", ids: [asset.assetId] })}>Copy ID</button><button className="quiet" onClick={() => vscode.postMessage({ type: "versions", assetId: asset.assetId })}>Versions</button>{asset.archived ? <button onClick={() => vscode.postMessage({ type: "archive", assetId: asset.assetId, restore: true })}>Restore</button> : <button className="danger" onClick={() => vscode.postMessage({ type: "archive", assetId: asset.assetId })}>Archive</button>}</div>
    {versions && <div className="versions"><h3>Versions</h3>{versions.length ? versions.map((raw, i) => { const version = raw as Record<string, unknown>; const number = String(version.versionNumber ?? version.revisionId ?? i + 1); return <div key={number}><span>Version {number}</span><button className="quiet" onClick={() => vscode.postMessage({ type: "rollback", assetId: asset.assetId, versionNumber: number })}>Rollback</button></div>; }) : <p>No versions returned.</p>}</div>}
  </div>;
}

function formatBytes(value: number) { if (value < 1000) return `${value} B`; if (value < 1_000_000) return `${(value / 1000).toFixed(1)} KB`; return `${(value / 1_000_000).toFixed(1)} MB`; }
createRoot(document.getElementById("root")!).render(<App/>);
