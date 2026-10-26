import {Router,type Request,type Response} from 'express';
import {z} from 'zod';
import type {ModuleHttpCore} from './http-api.js';
import {BrandReportError,createBrandReportService,startBrandReportWorker} from './report-service.js';

export function createBrandReportRouter(core:ModuleHttpCore):Router{
 const router=Router();startBrandReportWorker(core);
 const service=(req:Request)=>{
  const context=core.context(req);const actor=(req as Request&{frontmindUser?:{id:number;role:string}}).frontmindUser;
  if(!actor||actor.id!==context.actorUserId)throw new BrandReportError('UNAUTHORIZED','请先登录企业工作区。',401);
  return createBrandReportService(core,context,actor);
 };
 const error=(res:Response,value:unknown)=>{const known=value instanceof BrandReportError;res.status(known?value.status:value instanceof z.ZodError?400:503).json({error:{code:known?value.code:value instanceof z.ZodError?'INVALID_INPUT':'REPORT_UNAVAILABLE',message:known?value.message:value instanceof z.ZodError?'提交内容格式不正确。':'品牌报告服务暂不可用，请稍后重新读取。'}});};
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 router.get('/',async(req,res)=>{try{res.json(await service(req).workspace());}catch(e){error(res,e);}});
 router.post('/',async(req,res)=>{try{res.status(202).json(await service(req).start(req.body));}catch(e){error(res,e);}});
 router.get('/:id',async(req,res)=>{try{res.json(await service(req).observe(req.params.id));}catch(e){error(res,e);}});
 router.post('/:id/confirm',async(req,res)=>{try{res.json(await service(req).confirm(req.params.id,req.body));}catch(e){error(res,e);}});
 router.post('/:id/retry',async(req,res)=>{try{res.json(await service(req).retry(req.params.id));}catch(e){error(res,e);}});
 router.post('/:id/stop',async(req,res)=>{try{res.json(await service(req).stop(req.params.id));}catch(e){error(res,e);}});
 router.get('/:id/process',async(req,res)=>{try{
  const after=z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(req.query.after??0);
  res.json(await service(req).processView(req.params.id,after));
 }catch(e){error(res,e);}});
 router.get('/:id/intermediate',async(req,res)=>{try{
  const file=z.string().min(1).max(300).parse(req.query.file);
  const document=await service(req).intermediateDocument(req.params.id,file);
  res.setHeader('Content-Type','text/plain; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
  res.send(document.text);
 }catch(e){error(res,e);}});
 router.get('/:id/files/:file',async(req,res)=>{try{
  const {info,bytes,brandName}=await service(req).artifact(req.params.id,req.params.file);
  res.setHeader('Content-Type',`${info.mimeType}${info.mimeType==='text/html'?'; charset=utf-8':''}`);
  res.setHeader('X-Content-Type-Options','nosniff');
  // Generated reports contain escaped content only. No remote scripts, frames, or same-origin API access.
  res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  res.setHeader('Content-Disposition',`${req.query.download==='1'||info.mimeType!=='text/html'?'attachment':'inline'}; filename="${info.id}"; filename*=UTF-8''${encodeURIComponent(`${brandName}-${info.id}`)}`);
  res.send(bytes);
 }catch(e){error(res,e);}});
 return router;
}
