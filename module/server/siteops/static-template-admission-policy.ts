export const REQUIRED_STATIC_TEMPLATE_EXECUTION_CANDIDATE_ID =
  "static-template-22-hirael-agency-landing" as const;

export const REQUIRED_STATIC_TEMPLATE_RUNTIME_MEDIA = [
  {
    kind: "image",
    url: "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260516_090123_74be96d4-9c1b-40cf-932a-96f4f4babed3.png&w=1280&q=85",
    bytes: 1_243_139,
    sha256: "0558e2172a0701dd8e827467874a2c19274525f9cfc10d7b7252e814b619bc20",
  },
  {
    kind: "image",
    url: "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260516_090133_c157d30b-a99a-4477-bec1-a446149ec3f2.png&w=1280&q=85",
    bytes: 803_376,
    sha256: "98afffb93f712b38043d37fa2b3102dff4ce0c7e4993f10606ea94d0e5ae9d90",
  },
  {
    kind: "video",
    url: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260516_122702_390f5305-8719-41d5-ae80-d23ab3796c28.mp4",
    bytes: 5_382_028,
    sha256: "7ae4366f98d04032dcb7d39cbaf0de8acd2d621e6596c4f1a61ada7692cad432",
  },
  {
    kind: "video",
    url: "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260516_123323_f909c2b8-ff6c-4edf-882b-8ebcdbe389b5.mp4",
    bytes: 5_250_214,
    sha256: "d130650249850e82ee1e9c248aed7761c8e842998f0cec479c9d1a6ac154fc38",
  },
] as const;

/** The recorded media set must describe this candidate, never another template. */
export function staticTemplateRuntimeMedia(candidateId: string) {
  return candidateId === REQUIRED_STATIC_TEMPLATE_EXECUTION_CANDIDATE_ID
    ? REQUIRED_STATIC_TEMPLATE_RUNTIME_MEDIA
    : [];
}
