import type {IntentWorkspace} from "../module/contracts/intent-workbench";
import type {KnowledgeBaseProgressDto,KnowledgeBaseProgressBranchDto} from "../module/contracts/knowledge-base-public-progress";
import type {KnowledgeSnapshotView} from "../module/client/components/KnowledgeBaseViewer";
import {previewKnowledgeProgress,previewKnowledgeSnapshot} from "./preview-data";
import {createIntentPreviewApi} from "./intent-preview";

/** Both the intent executor and the sidebar directory project the same stored nodes. */
export function projectPreviewKnowledge(workspace:IntentWorkspace){
  const branches:KnowledgeBaseProgressBranchDto[]=[];
  workspace.nodes.forEach((node,ordinal)=>{
    let branch=branches.find(branch=>branch.title===node.branch);
    if(!branch){branch={id:`intent-branch-${branches.length}`,title:node.branch,total:0,handled:0,confirmed:0,directPrefilled:0,pending:0,current:0,needsVerification:0,leaves:[]};branches.push(branch);}
    branch.leaves.push({id:node.id,title:node.title,branchId:branch.id,branchTitle:branch.title,ordinal,status:node.verified?"confirmed":"needs_verification",contentMarkdown:node.content});
    branch.total++;if(node.verified){branch.confirmed++;branch.handled++;}else branch.needsVerification++;
  });
  const confirmed=workspace.nodes.filter(node=>node.verified).length;
  const progress:KnowledgeBaseProgressDto={...structuredClone(previewKnowledgeProgress),branches,
    build:{...previewKnowledgeProgress.build,id:"preview-shared-knowledge",conversationId:"preview-shared-knowledge",status:"published",currentLeafId:null,revision:workspace.revision,contentVersion:workspace.revision+1,hasPublishedSnapshot:true},
    summary:{total:workspace.nodes.length,handled:confirmed,confirmed,directPrefilled:0,pending:0,current:0,needsVerification:workspace.nodes.length-confirmed,overallPercent:Math.round(confirmed/Math.max(1,workspace.nodes.length)*100)},packageAllowed:false};
  const documents=workspace.nodes.map((node,index)=>({id:node.id,path:`${index+1}-${node.id}.md`,title:node.title,content:node.content,branchTitle:node.branch}));
  const snapshot:KnowledgeSnapshotView={...previewKnowledgeSnapshot,id:"preview-shared-knowledge",version:workspace.revision+1,documents,documentCount:documents.length,characterCount:documents.reduce((total,doc)=>total+doc.content.length,0)};
  return {progress,snapshot};
}
export async function readPreviewKnowledge(scope:string){return projectPreviewKnowledge(await createIntentPreviewApi(scope).observe());}
