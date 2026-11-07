export type PreviewAsset={id:string;filename:string;mimeType:string;bytes:number;dataUrl:string;uploadedAt:string;expiresAt:number};
export function readPreviewAssets(scope:string):PreviewAsset[]{return JSON.parse(localStorage.getItem(`frontmind:assets-preview:v1:${scope}`)??"[]");}
export async function savePreviewAsset(scope:string,blob:Blob,headers:Headers){
  const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("无法读取本地材料"));reader.readAsDataURL(blob);});
  const asset:PreviewAsset={id:`asset_${crypto.randomUUID()}`,filename:decodeURIComponent(headers.get("X-FrontMind-Filename")??"参考材料"),mimeType:headers.get("X-FrontMind-Mime")??blob.type,bytes:blob.size,dataUrl,uploadedAt:new Date().toISOString(),expiresAt:Date.now()+7*86400000};
  localStorage.setItem(`frontmind:assets-preview:v1:${scope}`,JSON.stringify([...readPreviewAssets(scope),asset]));
  return {localAssetId:asset.id,filename:asset.filename,bytes:asset.bytes,expiresAt:asset.expiresAt};
}
