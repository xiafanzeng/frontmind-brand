import {readPreviewAssets} from "./preview-assets";
export function createPreviewAnswerVisual(scope:string){return {
  Button:({children,className,...props}:any)=><button type="button" className={["fm-brand-button","fm-brand-button--secondary",className].filter(Boolean).join(" ")} {...props}>{children}</button>,
  FilePreview:({file}:any)=>{const asset=readPreviewAssets(scope).find(item=>item.id===(file?.fileId??file?.id));return <a href={asset?.dataUrl} download={asset?.filename}>{asset?.filename??file?.name??file?.filename??"参考材料"}</a>;},
  ImagePreview:({fileId,alt,className}:any)=>{const asset=readPreviewAssets(scope).find(item=>item.id===fileId);return asset?<img src={asset.dataUrl} alt={alt??asset.filename} className={className}/>:null;},
};}
