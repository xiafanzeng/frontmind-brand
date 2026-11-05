import {useMemo, useState} from "react";
import {FileText, Search} from "lucide-react";
import type {IntentChange, IntentNode, IntentReceipt} from "../../contracts/intent-workbench";
import KnowledgeChangeComparison from "./KnowledgeChangeComparison";

/** Receipt snapshots are authoritative even after the live node has been removed. */
export default function KnowledgeChangesView({nodes, receipt, initialNodeId}: {
  nodes: IntentNode[];
  receipt?: IntentReceipt;
  initialNodeId?: string;
}) {
  const [selectedId, setSelectedId] = useState(initialNodeId);
  const [search, setSearch] = useState("");
  const entries = useMemo(() => {
    const grouped = new Map<string, IntentChange[]>();
    for (const change of receipt?.changes ?? []) {
      if (change.action.kind !== "node" || !change.action.nodeId ||
        !["succeeded", "reverted"].includes(change.status)) continue;
      const changes = grouped.get(change.action.nodeId) ?? [];
      changes.push(change);
      grouped.set(change.action.nodeId, changes);
    }
    return [...grouped].map(([id, changes]) => {
      const node = nodes.find(item => item.id === id);
      return {id, changes, node, title: node?.title ?? `历史节点 · ${id}`,
        branch: node?.branch ?? "执行记录快照"};
    });
  }, [nodes, receipt]);
  const selected = entries.find(entry => entry.id === selectedId) ?? entries[0];

  if (!selected) {
    const failed = receipt?.changes.filter(change => change.action.kind === "node" && change.status === "failed") ?? [];
    const pending = receipt?.changes.some(change => change.action.kind === "node" && change.status === "pending");
    return <section className="iw-panel" aria-label="知识库变更状态"><div className="iw-article">
      <h2>{!receipt ? "暂无执行记录" : pending ? "知识库正文尚未写入" : failed.length ? "本次未成功修改知识库正文" : "本次未修改知识库正文"}</h2>
      <p>{!receipt ? "请选择一条执行记录查看前后对比。" : pending ? "正文写入仍待确认，成功后才能查看前后 diff。" : failed.length ? "正文写入失败，未产生已成功写入的前后 diff。" : "此记录仅包含问题或资料待办操作，没有知识库正文写入记录，因此没有正文 diff。"}</p>
      {failed.length > 0 && <ul>{failed.map(change => <li key={change.action.id}>{change.action.title}：{change.error ?? "写入未完成"}</li>)}</ul>}
      {receipt && <p className="iw-method">问题操作 {receipt.changes.filter(change => change.action.kind === "question").length} 项 · 资料待办 {receipt.changes.filter(change => change.action.kind === "todo").length} 项。资料待办不会自动修改知识库正文。</p>}
    </div></section>;
  }

  return <div className="iw-knowledge">
    <article className="iw-panel">
      <h3>{selected.title}<small>{selected.branch}</small></h3>
      <KnowledgeChangeComparison key={`${receipt?.id}:${selected.id}`} changes={selected.changes}
        current={selected.node?.content} createdAt={receipt?.createdAt}/>
      {selected.node && <p className="iw-method">{selected.node.verified ? "当前节点已确认" : "当前节点需再核验；不会计为充分支撑"}</p>}
    </article>
    <aside className="iw-panel iw-tree">
      <h3>本次变更节点 <small>{entries.length} 个</small></h3>
      <label><Search size={16}/><input aria-label="搜索变更节点" placeholder="搜索变更节点" value={search} onChange={event => setSearch(event.target.value)}/></label>
      {entries.filter(entry => `${entry.title}${entry.branch}`.includes(search)).map(entry => <button
        type="button" className={selected.id === entry.id ? "active" : ""} key={entry.id}
        aria-pressed={selected.id === entry.id} onClick={() => setSelectedId(entry.id)}>
        <FileText size={16}/><span><b>{entry.title}</b><small>{entry.branch}</small></span>
        <em>{entry.changes.every(change => change.status === "reverted") ? "已撤销" : entry.node ? "已写入" : "历史快照"}</em>
      </button>)}
    </aside>
  </div>;
}
