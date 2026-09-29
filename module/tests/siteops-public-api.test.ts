// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {JenovaBrandTrackingClient} from "../server/jenova-brand-tracking-client.js";
import {buildTwentyFirstToolArguments} from "../server/twenty-first-service.js";
import {buildAliyunOAuthAuthorizationUrl,ALIYUN_OAUTH_AUTHORIZE_ENDPOINT} from "../server/siteops/aliyun-platform-service.js";
import {assertAliyunDomainSelectionSafe} from "../server/siteops/aliyun-provider.js";
import {rewriteSiteOpsPreviewDocument} from "../server/siteops/artifact-api.js";

describe("public Brand provider implementation",()=>{
 it("dispatches and parses Brand Tracker through the module client",async()=>{
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response(
   'event: stream_started\ndata: {"session_id":"session-1","run_id":"run-1"}\n\nevent: stream_ended\ndata: {"success":true,"usage":{"cost":"0.125"}}\n\n',
   {headers:{"content-type":"text/event-stream"}}
  ));
  const events:unknown[]=[];
  await new JenovaBrandTrackingClient({fetchImpl,baseUrl:"https://provider.invalid/v1"}).streamMessage({apiKey:"jnv_sk_test_only",userId:"user-7",content:"检查品牌资料",idempotencyKey:"brand:request-1",onEvent:event=>{events.push(event);}});
  const init=fetchImpl.mock.calls[0]![1]!;
  expect(JSON.parse(String(init.body))).toMatchObject({agent:"brand-tracker",content:"检查品牌资料",stream:true});
  expect(new Headers(init.headers).get("idempotency-key")).toBe("brand:request-1");
  expect(events).toMatchObject([{type:"started",sessionId:"session-1",runId:"run-1"},{type:"ended",success:true,usageCost:"0.12500000"}]);
 });
 it("builds 21st request arguments from the advertised provider contract",()=>{
  expect(buildTwentyFirstToolArguments({operation:"get_component",tool:{name:"get_component",inputSchema:{type:"object",properties:{id:{type:"number"}},required:["id"]}},value:"143"})).toEqual({id:143});
 });
 it("owns the Aliyun authorization request without exposing the application secret",()=>{
  const url=buildAliyunOAuthAuthorizationUrl({clientId:"4724570903440411234",clientSecret:"test-only-secret",callbackUrl:"https://brand.frontmind.cn/api/site-ops/aliyun/oauth/callback"},"signed-state");
  expect(url.origin+url.pathname).toBe(ALIYUN_OAUTH_AUTHORIZE_ENDPOINT);
  expect(url.searchParams.get("scope")).toBe("openid aliuid /acs/alidns");
  expect(url.searchParams.get("state")).toBe("signed-state");
  expect(url.toString()).not.toContain("test-only-secret");
  expect(()=>assertAliyunDomainSelectionSafe({sameDomain:false,hasExistingDomainState:true})).toThrow("当前项目已接入其他域名");
 });
 it("rewrites preview assets while preserving external resource URLs",()=>{
  const html=Buffer.from('<img src="/assets/logo.png"><a href="https://example.com">外部资料</a>');
  const output=rewriteSiteOpsPreviewDocument({bytes:html,mimeType:"text/html",previewPrefix:"/api/site-ops/builds/build-1/preview/"}).toString();
  expect(output).toContain('/api/site-ops/builds/build-1/preview/assets/logo.png');
  expect(output).toContain('href="https://example.com"');
 });
});
