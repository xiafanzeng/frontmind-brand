export const MAX_DOCUMENT_BYTES:number;
export function relativeName(name:string):string;
export function checkedPath(root:string,name:string,options?:{createParents?:boolean}):Promise<string>;
export function readDocument(root:string,name:string,maxBytes?:number):Promise<string>;
export function writeDocument(root:string,name:string,text:string):Promise<string>;
export function listDocuments(root:string,sub?:string,limit?:number):Promise<Array<{id:string;title:string;text:string;updatedAt:string;size:number;truncated:boolean}>>;
