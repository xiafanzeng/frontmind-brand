import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {packageSocraticKnowledgeBaseSkill} from '../workflows/build-knowledge-base-workflow.mjs';
import {buildEnterpriseRagEvaluationWorkflow,ENTERPRISE_RAG_EVALUATION_WORKFLOW} from '../workflows/build-rag-evaluation-workflow.mjs';
import {createKnowledgeBaseSkillRuntime} from '../dist/server/knowledge-base-skill-runtime.js';

test('a workflow upgrade preserves exact old pins and never substitutes the new alias',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'brand-workflow-version-'));
 try {
  const sourceRoot=path.join(root,'source');
  await fs.cp(fileURLToPath(new URL('../workflows/socratic-kb-builder',import.meta.url)),sourceRoot,{recursive:true});
  const outputPath=path.join(root,'runtime/socratic-kb-builder-v5.skill');
  const old=await packageSocraticKnowledgeBaseSkill({sourceRoot,outputPath});
  await fs.appendFile(path.join(sourceRoot,'SKILL.md'),'\nSynthetic workflow version acceptance change.\n');
  const next=await packageSocraticKnowledgeBaseSkill({sourceRoot,outputPath});
  assert.notEqual(next.contentHash,old.contentHash);
  const create=()=>createKnowledgeBaseSkillRuntime({archiveCandidates:()=>[outputPath],persistKnowledgeBaseSkillArchive:()=>{throw Error('unexpected persistence');},readKnowledgeBaseLocalSource:()=>{throw Error('unexpected storage read');}});
  const runtime=create();
  const retained=await runtime.loadKnowledgeBaseSkillArchive({version:'5',contentHash:old.contentHash});
  const current=await runtime.loadKnowledgeBaseSkillArchive({version:'5',contentHash:next.contentHash});
  assert.equal(retained.contentHash,old.contentHash);
  assert.equal(current.contentHash,next.contentHash);
  assert.equal(retained.instructions.includes('Synthetic workflow version'),false);
  assert.equal(current.instructions.includes('Synthetic workflow version'),true);
  await fs.unlink(path.join(root,'runtime',`socratic-kb-builder-v5-${old.contentHash}.skill`));
  await assert.rejects(create().loadKnowledgeBaseSkillArchive({version:'5',contentHash:old.contentHash}));
 } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('enterprise RAG evaluator publishes its declared version and follows source updates',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'brand-rag-evaluation-workflow-'));
 try {
  const sourcePath=path.join(root,'SKILL.md');
  await fs.copyFile(fileURLToPath(new URL('../workflows/evaluate-enterprise-rag/SKILL.md',import.meta.url)),sourcePath);
  const outputRoot=path.join(root,'dist/workflows/evaluate-enterprise-rag');
  const first=await buildEnterpriseRagEvaluationWorkflow({sourcePath,outputRoot});
  const initial=await fs.readFile(first.outputPath,'utf8');
  assert.equal(ENTERPRISE_RAG_EVALUATION_WORKFLOW.version,'2.0.0');
  assert.match(initial,/^---\r?\nname: evaluate-enterprise-rag\r?\nversion: 2\.0\.0\r?\n/u);
  await fs.appendFile(sourcePath,'\nSynthetic evaluator revision.\n');
  await buildEnterpriseRagEvaluationWorkflow({sourcePath,outputRoot});
  const updated=await fs.readFile(first.outputPath,'utf8');
  assert.notEqual(updated,initial);
  assert.match(updated,/Synthetic evaluator revision\./u);
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
