import { useEffect, useRef, useState, type ReactNode } from "react";
import { AgentWorkbenchShell } from "@frontmind/module-ui/components/AgentWorkbenchShell";
import { WorkbenchTaskToolbar } from "@frontmind/module-ui/dashboard/WorkbenchTaskToolbar";
import { workbenchStatus } from "@frontmind/module-ui/dashboard/workbench-status";
import { brandHost, setWorkbenchTaskQuery, useConversation } from "../module/client/host";
import EnterpriseQaConversation from "../module/client/EnterpriseQaConversation";

/** Standalone assembly of the same workbench frame and task controls as Dashboard. */
export default function EnterpriseQaWorkbench({ projectId, preview, children }: {
  projectId: string;
  preview: boolean;
  children?: ReactNode;
}) {
  const workspace = useConversation();
  const [panel, setPanel] = useState<"tasks" | "outputs">("outputs");
  const creating = useRef(false);
  const active = workspace.activeConversation;
  const newConversation = () => {
    const id = workspace.createConversation({ title: "企业问答", reuseEmpty: false, purpose: "enterprise_qa" });
    setWorkbenchTaskQuery(id);
  };
  useEffect(() => {
    if (workspace.hydrated && !active && !creating.current) {
      creating.current = true;
      newConversation();
    }
    if (active) creating.current = false;
  }, [workspace.hydrated, active, workspace.createConversation]);
  const auxiliary = <div className="workbench-task-panel">
    <div className="workbench-panel-tabs" role="tablist" aria-label="会话与知识来源">
      <button type="button" role="tab" id="tasks-tab-enterprise-qa" aria-controls="tasks-panel-enterprise-qa" aria-selected={panel === "tasks"} onClick={() => setPanel("tasks")}>会话</button>
      <button type="button" role="tab" id="outputs-tab-enterprise-qa" aria-controls="outputs-panel-enterprise-qa" aria-selected={panel === "outputs"} onClick={() => setPanel("outputs")}>知识来源</button>
    </div>
    <div role="tabpanel" id={`${panel}-panel-enterprise-qa`} aria-labelledby={`${panel}-tab-enterprise-qa`}>
      {panel === "tasks" ? <WorkbenchTaskToolbar
        tasks={workspace.state.conversations}
        currentId={active?.id}
        disabled={!workspace.hydrated}
        loading={workspace.loading}
        error={workspace.syncError}
        onRetry={() => void workspace.refreshConversations()}
        presentation="panel"
        labels={{ newAction: "新会话", history: "会话历史", noun: "会话" }}
        onNew={newConversation}
        onSelect={id => { workspace.setActive(id); setWorkbenchTaskQuery(id); }}
        onDelete={workspace.deleteConversation}
        requestNavigation={action => brandHost().requestWorkspaceNavigation(action)}
      /> : children}
    </div>
  </div>;
  return <AgentWorkbenchShell
    projectId={projectId}
    moduleId="enterprise-qa"
    title="企业问答"
    taskTitle={active?.title ?? "新会话"}
    taskKey={active?.id ?? "new"}
    layout="workflow"
    resultTitle="会话与知识来源"
    scrollMain={false}
    status={active?.status && active.status !== "idle" ? workbenchStatus(active.status) : undefined}
    main={<EnterpriseQaConversation key={active?.id ?? "new"} preview={preview} />}
    auxiliary={auxiliary}
    requestNavigation={action => brandHost().requestWorkspaceNavigation(action)}
  />;
}
