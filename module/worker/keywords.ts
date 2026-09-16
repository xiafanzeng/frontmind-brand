/** One in-process sweep at a time; row claims inside the business service also
 * fence concurrent workers. The private host selects the brand worker role. */
export function createKeywordWorker(core:{sweep():Promise<unknown>;report(error:unknown):void}) {
 let scheduler:NodeJS.Timeout|null=null,sweep:Promise<unknown>|null=null;
 return {
 start(options?:{intervalMs?:number}) {if(scheduler)return;const run=()=>{if(sweep)return;sweep=core.sweep().catch(core.report).finally(()=>{sweep=null});};run();scheduler=setInterval(run,Math.max(10000,options?.intervalMs??30000));scheduler.unref?.();},
 async stop(){if(scheduler)clearInterval(scheduler);scheduler=null;await sweep;},
 };
}
