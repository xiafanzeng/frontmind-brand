import {constants} from 'node:fs';
import {lstat,realpath,open,mkdir,rename,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const MAX_DOCUMENT_BYTES=8*1024*1024;
export function relativeName(name){
 if(typeof name!=='string'||!name||name.includes('\\')||path.isAbsolute(name)||name.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.')))throw new Error('REPORT_FILE_PATH_INVALID');
 return name;
}
export async function checkedPath(root,name,{createParents=false}={}){
 relativeName(name);const base=await realpath(root);let current=base;
 const parts=name.split('/');
 for(let i=0;i<parts.length;i++){
  current=path.join(current,parts[i]);
  try{const stat=await lstat(current);if(stat.isSymbolicLink()||(i<parts.length-1&&!stat.isDirectory()))throw new Error('REPORT_FILE_LINK_FORBIDDEN');}
  catch(error){if(error.code!=='ENOENT')throw error;if(i<parts.length-1){if(!createParents)throw error;await mkdir(current,{mode:0o700});}}
 }
 return current;
}
export async function readDocument(root,name,maxBytes=MAX_DOCUMENT_BYTES){
 const filename=await checkedPath(root,name);const file=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();if(!stat.isFile()||stat.size>maxBytes)throw new Error('REPORT_DOCUMENT_TOO_LARGE');return await file.readFile('utf8');}finally{await file.close();}
}
export async function writeDocument(root,name,text){
 if(typeof text!=='string'||Buffer.byteLength(text)>MAX_DOCUMENT_BYTES)throw new Error('REPORT_DOCUMENT_TOO_LARGE');
 const filename=await checkedPath(root,name,{createParents:true});const temporary=path.join(path.dirname(filename),`.${path.basename(filename)}-${randomUUID()}.tmp`);
 const file=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
 try{await file.writeFile(text);await file.sync();}finally{await file.close();}
 await rename(temporary,filename);
 return filename;
}
export async function listDocuments(root,sub='work',limit=Number.MAX_SAFE_INTEGER){
 let directory;try{directory=await checkedPath(root,sub);if(!(await lstat(directory)).isDirectory())return [];}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const candidates=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){
  if(!entry.isFile()||entry.isSymbolicLink()||entry.name.startsWith('.')||!/\.(md|json)$/.test(entry.name))continue;
  const relative=`${sub}/${entry.name}`;const filename=await checkedPath(root,relative);const stat=await lstat(filename);
  candidates.push({id:relative,title:entry.name,filename,updatedAt:stat.mtime.toISOString(),size:stat.size});
 }
 candidates.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 const documents=[];
 for(const {filename,...meta} of candidates.slice(0,limit)){
  const file=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);let text;
  try{const buffer=Buffer.alloc(Math.min(meta.size,8192));const {bytesRead}=await file.read(buffer,0,buffer.length,0);text=buffer.subarray(0,bytesRead).toString('utf8').slice(0,2048);}finally{await file.close();}
  documents.push({...meta,text,truncated:meta.size>Buffer.byteLength(text)});
 }
 return documents;
}
