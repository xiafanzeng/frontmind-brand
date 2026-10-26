import {cp,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('./report-harness/',import.meta.url));
const destination=fileURLToPath(new URL('../dist/workflows/report-harness/',import.meta.url));
await mkdir(destination,{recursive:true});
await cp(source,destination,{recursive:true,dereference:false});
console.log('Report Harness runtime copied.');
