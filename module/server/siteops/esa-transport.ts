import * as EsaModels from '@alicloud/esa20240910';
import * as OpenApi from '@alicloud/openapi-client';
import {AliyunCredential,AliyunEsaClient} from './aliyun-sdk-constructors.js';
import type {EsaDirectApi,EsaRoutineView,EsaCodeVersionView,EsaSiteView} from './esa-provider.js';
type EsaSiteCoverage='overseas'|'domestic';
const ESA_ENDPOINT='esa.cn-hangzhou.aliyuncs.com';
const ESA_TIMEOUT_MS=15_000;
function errorText(error: unknown) {
  if (!error || typeof error !== "object") return String(error ?? "");
  const value = error as { code?: unknown; name?: unknown; message?: unknown };
  return `${String(value.code ?? "")} ${String(value.name ?? "")} ${String(value.message ?? "")}`;
}

function isNotFound(error: unknown) {
  return /not.?found|does not exist|不存在|routine.*invalid/i.test(
    errorText(error),
  );
}


const normalizeHostname=(value:string)=>value.trim().replace(/\.$/u,'').toLowerCase();
function mapRoutine(name: string, body: any): EsaRoutineView {
  const production = (body?.envs ?? []).find(
    (entry: any) => String(entry?.env).toLowerCase() === "production",
  )?.codeDeploy;
  return {
    name,
    hasAssets: body?.hasAssets === true,
    defaultRelatedRecord: body?.defaultRelatedRecord ?? null,
    production: production?.deployId
      ? {
          deploymentId: String(production.deployId),
          codeVersions: (production.codeVersions ?? []).map((entry: any) => ({
            codeVersion: String(entry.codeVersion ?? ""),
            percentage: Number(entry.percentage ?? 0),
          })),
        }
      : null,
  };
}

function mapVersion(body: any): EsaCodeVersionView | null {
  if (!body?.codeVersion) return null;
  return {
    codeVersion: String(body.codeVersion),
    status: String(body.status ?? ""),
    description: body.codeDescription ?? null,
    extraInfo: body.extraInfo ?? null,
    hasAssets: body.hasAssets !== false,
  };
}

function mapSite(body: any): EsaSiteView | null {
  if (!body?.siteId || !body?.siteName) return null;
  return {
    siteId: Number(body.siteId),
    siteName: normalizeHostname(String(body.siteName)),
    status: String(body.status ?? ""),
    accessType: String(body.accessType ?? ""),
    coverage: String(body.coverage ?? ""),
    verifyCode: body.verifyCode ? String(body.verifyCode) : null,
    cnameZone: body.cnameZone ? String(body.cnameZone) : null,
  };
}

export class OfficialEsaDirectApi implements EsaDirectApi {
  private readonly client: InstanceType<typeof AliyunEsaClient>;

  constructor() {
    const credential = new AliyunCredential();
    this.client = new AliyunEsaClient(
      new OpenApi.Config({
        credential,
        endpoint: ESA_ENDPOINT,
        protocol: "HTTPS",
        regionId: "cn-hangzhou",
        connectTimeout: ESA_TIMEOUT_MS,
        readTimeout: ESA_TIMEOUT_MS,
        userAgent: "frontmind-siteops/1.0",
      }),
    );
  }

  async getRoutine(name: string) {
    try {
      const response = await this.client.getRoutine(
        new EsaModels.GetRoutineRequest({ name }),
      );
      return response.body ? mapRoutine(name, response.body) : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async createRoutine(input: { name: string; description: string }) {
    const response = await this.client.createRoutine(
      new EsaModels.CreateRoutineRequest({
        name: input.name,
        description: input.description,
        hasAssets: true,
      }),
    );
    if (response.body?.status !== "OK")
      throw new Error("ESA_CREATE_ROUTINE_REJECTED");
  }

  async listCodeVersions(input: { name: string; marker: string }) {
    const response = await this.client.listRoutineCodeVersions(
      new EsaModels.ListRoutineCodeVersionsRequest({
        name: input.name,
        pageNumber: 1,
        pageSize: 20,
        searchKeyWord: input.marker,
      }),
    );
    return (response.body?.codeVersions ?? [])
      .map(mapVersion)
      .filter((entry): entry is EsaCodeVersionView => Boolean(entry))
      .filter(
        (entry) =>
          entry.description === input.marker ||
          entry.extraInfo?.includes(input.marker) === true,
      );
  }

  async getCodeVersion(input: { name: string; codeVersion: string }) {
    try {
      const response = await this.client.getRoutineCodeVersionInfo(
        new EsaModels.GetRoutineCodeVersionInfoRequest(input),
      );
      return mapVersion(response.body);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async createAssetsCodeVersion(input: {
    name: string;
    description: string;
    extraInfo: string;
  }) {
    const response = await this.client.createRoutineWithAssetsCodeVersion(
      new EsaModels.CreateRoutineWithAssetsCodeVersionRequest({
        name: input.name,
        codeDescription: input.description,
        extraInfo: input.extraInfo,
        confOptions:
          new EsaModels.CreateRoutineWithAssetsCodeVersionRequestConfOptions({
            notFoundStrategy: "404Page",
          }),
      }),
    );
    const body = response.body;
    const upload = body?.ossPostConfig;
    if (
      !body?.codeVersion ||
      !upload?.url ||
      !upload.key ||
      !upload.OSSAccessKeyId ||
      !upload.policy ||
      !upload.signature
    ) {
      throw new Error("ESA_UPLOAD_CONFIGURATION_INCOMPLETE");
    }
    return {
      codeVersion: body.codeVersion,
      upload: {
        url: upload.url,
        key: upload.key,
        accessKeyId: upload.OSSAccessKeyId,
        policy: upload.policy,
        signature: upload.signature,
        securityToken: upload.XOssSecurityToken ?? null,
      },
    };
  }

  async createProductionDeployment(input: {
    name: string;
    codeVersion: string;
  }) {
    const response = await this.client.createRoutineCodeDeployment(
      new EsaModels.CreateRoutineCodeDeploymentRequest({
        name: input.name,
        env: "production",
        strategy: "percentage",
        codeVersions: [
          new EsaModels.CreateRoutineCodeDeploymentRequestCodeVersions({
            codeVersion: input.codeVersion,
            percentage: 100,
          }),
        ],
      }),
    );
    if (!response.body?.deploymentId)
      throw new Error("ESA_DEPLOYMENT_ID_MISSING");
    return { deploymentId: response.body.deploymentId };
  }

  async listSites(siteName: string) {
    const response = await this.client.listSites(
      new EsaModels.ListSitesRequest({
        siteName,
        siteSearchType: "exact",
        pageNumber: 1,
        pageSize: 20,
      }),
    );
    return (response.body?.sites ?? [])
      .map(mapSite)
      .filter((entry): entry is EsaSiteView => Boolean(entry))
      .filter((entry) => entry.siteName === siteName);
  }

  async createSite(input: {
    siteName: string;
    instanceId: string;
    coverage: EsaSiteCoverage;
  }) {
    const response = await this.client.createSite(
      new EsaModels.CreateSiteRequest({
        siteName: input.siteName,
        instanceId: input.instanceId,
        accessType: "CNAME",
        coverage: input.coverage,
      }),
    );
    if (!response.body?.siteId) throw new Error("ESA_SITE_ID_MISSING");
    return {
      siteId: response.body.siteId,
      verifyCode: response.body.verifyCode ?? null,
    };
  }

  async updateSiteCoverage(input: {
    siteId: number;
    coverage: EsaSiteCoverage;
  }) {
    await this.client.updateSiteCoverage(
      new EsaModels.UpdateSiteCoverageRequest(input),
    );
  }

  async verifySite(siteId: number) {
    const response = await this.client.verifySite(
      new EsaModels.VerifySiteRequest({ siteId }),
    );
    return response.body?.passed === true;
  }

  async getMatchSite(recordName: string) {
    try {
      const response = await this.client.getMatchSite(
        new EsaModels.GetMatchSiteRequest({ recordName }),
      );
      if (!response.body?.siteId || !response.body.siteName) return null;
      const sites = await this.listSites(response.body.siteName);
      return (
        sites.find((site) => site.siteId === response.body?.siteId) ?? null
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async listRelatedRecords(input: { name: string; recordName: string }) {
    const response = await this.client.listRoutineRelatedRecords(
      new EsaModels.ListRoutineRelatedRecordsRequest({
        name: input.name,
        pageNumber: 1,
        pageSize: 20,
        searchKeyWord: input.recordName,
      }),
    );
    return (response.body?.relatedRecords ?? [])
      .filter(
        (entry) =>
          entry.recordName === input.recordName &&
          entry.siteId &&
          entry.recordId,
      )
      .map((entry) => ({
        recordId: Number(entry.recordId),
        recordName: String(entry.recordName),
        siteId: Number(entry.siteId),
      }));
  }

  async createRelatedRecord(input: {
    name: string;
    recordName: string;
    siteId: number;
  }) {
    const response = await this.client.createRoutineRelatedRecord(
      new EsaModels.CreateRoutineRelatedRecordRequest(input),
    );
    if (response.body?.status !== "OK")
      throw new Error("ESA_RELATED_RECORD_REJECTED");
  }

  async deleteRelatedRecord(input: {
    name: string;
    recordId: number;
    recordName: string;
    siteId: number;
  }) {
    try {
      const response = await this.client.deleteRoutineRelatedRecord(
        new EsaModels.DeleteRoutineRelatedRecordRequest(input),
      );
      if (response.body?.status !== "OK") {
        throw new Error("ESA_RELATED_RECORD_DELETE_REJECTED");
      }
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  }

  async deleteRoutine(name: string) {
    try {
      const response = await this.client.deleteRoutine(
        new EsaModels.DeleteRoutineRequest({ name }),
      );
      if (response.body?.status !== "OK") {
        throw new Error("ESA_ROUTINE_DELETE_REJECTED");
      }
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  }

  async listEdgeRoutineRecords(input: { siteId: number; recordName: string }) {
    const response = await this.client.listEdgeRoutineRecords(
      new EsaModels.ListEdgeRoutineRecordsRequest({
        siteId: input.siteId,
        recordName: input.recordName,
        recordMatchType: "exact",
        pageNumber: 1,
        pageSize: 20,
      }),
    );
    return (response.body?.records ?? [])
      .filter(
        (entry) =>
          entry.recordName === input.recordName && Boolean(entry.recordCname),
      )
      .map((entry) => ({
        recordName: String(entry.recordName),
        recordCname: String(entry.recordCname),
      }));
  }
}
