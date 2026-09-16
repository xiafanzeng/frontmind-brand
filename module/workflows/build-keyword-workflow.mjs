import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
const defaultSourceRoot=path.join(path.dirname(fileURLToPath(import.meta.url)),'generate-brand-question-universe');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const date=new Date('2020-01-01T00:00:00.000Z');
async function files(root,prefix=''){const result=[];for(const entry of (await fs.readdir(path.join(root,prefix),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const relative=path.posix.join(prefix,entry.name);if(entry.isSymbolicLink())throw new Error('KEYWORD_WORKFLOW_SYMLINK');if(entry.isDirectory())result.push(...await files(root,relative));else if(entry.isFile())result.push(relative);else throw new Error('KEYWORD_WORKFLOW_SPECIAL_FILE');}return result;}
export async function buildKeywordWorkflow(outputRoot,options={}){
 const sourceRoot=options.sourceRoot??defaultSourceRoot;
 await fs.mkdir(outputRoot,{recursive:true});
 if(path.resolve(outputRoot)!==path.resolve(sourceRoot))await fs.cp(sourceRoot,outputRoot,{recursive:true});
 const manifest=JSON.parse(await fs.readFile(path.join(sourceRoot,'upstream/MANIFEST.json'),'utf8'));
 const source=path.join(sourceRoot,'source');const names=await files(source);const zip=new JSZip();let unchanged=names.length===manifest.fileCount;
 for(const name of names){const bytes=await fs.readFile(path.join(source,name));const original=manifest.entries.find(entry=>entry.path===`generate-brand-question-universe/${name}`);if(original?.sha256!==hash(bytes))unchanged=false;zip.file(`generate-brand-question-universe/${name}`,bytes,{date,unixPermissions:(await fs.stat(path.join(source,name))).mode&0o777});}
 const upstream=unchanged?await fs.readFile(path.join(sourceRoot,'upstream',manifest.sourceFilename)):await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:9},platform:'UNIX'});
 const upstreamSha=hash(upstream);const version=`2.0.0+${upstreamSha.slice(0,12)}`;
 const adapterDirectory=path.join(sourceRoot,'frontmind-adapter-v1.0.0');const adapterManifest=JSON.parse(await fs.readFile(path.join(adapterDirectory,'MANIFEST.json'),'utf8'));
 adapterManifest.upstream.archiveSha256=upstreamSha;adapterManifest.files=[];
 const adapter=new JSZip();
 for(const name of ['SKILL.md','runtime-contract.json']){const bytes=await fs.readFile(path.join(adapterDirectory,name));adapterManifest.files.push({path:name,bytes:bytes.length,sha256:hash(bytes)});adapter.file(name,bytes,{date,unixPermissions:0o644});}
 adapter.file('MANIFEST.json',JSON.stringify(adapterManifest,null,2)+'\n',{date,unixPermissions:0o644});
 const adapterBytes=await adapter.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:9},platform:'UNIX'});
 const archives=path.join(outputRoot,'archives');await fs.mkdir(archives,{recursive:true});
 const current={schemaVersion:1,version,upstream:{filename:`brand-keywords-${upstreamSha}.zip`,sha256:upstreamSha},adapter:{filename:`brand-keywords-adapter-${hash(adapterBytes)}.zip`,sha256:hash(adapterBytes)}};
 await fs.writeFile(path.join(archives,current.upstream.filename),upstream);await fs.writeFile(path.join(archives,current.adapter.filename),adapterBytes);await fs.writeFile(path.join(outputRoot,'current.json'),JSON.stringify(current,null,2)+'\n');return current;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const output=process.argv[process.argv.indexOf('--output')+1];if(!output||output===process.argv[1])throw new Error('Use --output DIRECTORY');process.stdout.write(JSON.stringify(await buildKeywordWorkflow(path.resolve(output)))+'\n');}
