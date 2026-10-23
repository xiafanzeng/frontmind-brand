import {
  siteBriefSchema,
  type SiteBrief,
} from "../../contracts/siteops.js";

function compactBriefText(value: unknown, max = 600) {
  return String(value ?? "")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/[#>*_`|\[\]()]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

function normalizedSiteLanguage(value: string) {
  const compact = compactBriefText(value, 32);
  if (/^(?:zh(?:-CN)?|中文(?:（简体）|\(简体\)|简体)?|简体中文)$/iu.test(compact)) {
    return "zh-CN";
  }
  if (/^(?:en(?:-US)?|English|英文|英语)$/iu.test(compact)) {
    return "en-US";
  }
  return null;
}

/**
 * Merge customer-confirmed text into the existing SiteBrief fields that the
 * build runtime already freezes. Visual and assistant preferences can travel
 * inside conversionGoal, but are deliberately not promoted to first-class
 * fields because the current SiteBrief protocol has no such contract.
 */
export function mergeSiteOpsCustomerBriefMessage(
  brief: SiteBrief,
  text: string,
): SiteBrief {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  const nextContacts = [...brief.contacts];
  const addContact = (
    kind: SiteBrief["contacts"][number]["kind"],
    value: string,
  ) => {
    const compact = compactBriefText(value, 512);
    if (
      compact &&
      !nextContacts.some(
        (item) =>
          item.kind === kind &&
          item.value.toLowerCase() === compact.toLowerCase(),
      )
    ) {
      // Authenticated customer input is customer-confirmed, rather than
      // attributed to a frozen knowledge document.
      nextContacts.push({ kind, value: compact, sourceDocumentIds: [] });
    }
  };
  for (const email of normalized.match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,
  ) ?? []) {
    addContact("email", email);
  }
  for (const phone of normalized.match(
    /(?:\+?86[-\s]?)?(?:1[3-9]\d{9}|0\d{2,3}[-\s]?\d{7,8})/gu,
  ) ?? []) {
    addContact("phone", phone);
  }
  const address = normalized.match(
    /(?:办公地址|联系地址|公司地址|地址)\s*[:：]\s*([^\n]{4,200})/u,
  )?.[1];
  if (address) addContact("address", address);

  const companyNameValue = normalized.match(
    /(?:网站名称|站点名称|企业名称|公司名称)\s*[:：]\s*([^\n]{1,255})/u,
  )?.[1];
  const languageValue = normalized.match(
    /(?:站点语言|网站语言|主要语言)\s*[:：]\s*([^\n]{2,32})/u,
  )?.[1];
  const audienceValue = normalized.match(
    /(?:目标受众|核心受众|受众|面向)\s*[:：]\s*([^\n]{2,500})/u,
  )?.[1];
  const conversionValue = normalized.match(
    /(?:转化目标|核心目标|建站目标|站点简介)\s*[:：]\s*([^\n]{1,500})/u,
  )?.[1];
  const hasBuilderStructuredLabel =
    /(?:网站名称|站点名称|企业名称|公司名称|站点语言|网站语言|主要语言|转化目标|核心目标|建站目标|站点简介)\s*[:：]/u.test(
      normalized,
    );
  const companyNameCandidate = companyNameValue
    ? compactBriefText(companyNameValue, 255)
    : "";
  const companyName = companyNameCandidate && !/[<>]/u.test(companyNameCandidate)
    ? companyNameCandidate
    : brief.companyName;
  const primaryLanguage = languageValue
    ? normalizedSiteLanguage(languageValue) ?? brief.primaryLanguage
    : brief.primaryLanguage;
  const audienceCandidate = audienceValue
    ? compactBriefText(audienceValue, 500)
    : "";
  const audience = audienceCandidate ? [audienceCandidate] : brief.audience;
  const conversionCandidate = compactBriefText(
    conversionValue ?? (hasBuilderStructuredLabel ? "" : normalized),
    500,
  );
  const conversionGoal = conversionCandidate && !/[<>]/u.test(conversionCandidate)
    ? conversionCandidate
    : brief.conversionGoal;
  const hasNewContact = nextContacts.length > brief.contacts.length;

  return siteBriefSchema.parse({
    ...brief,
    companyName: companyName || brief.companyName,
    primaryLanguage: primaryLanguage || brief.primaryLanguage,
    contacts: nextContacts.slice(0, 20),
    audience,
    conversionGoal,
    unknowns: brief.unknowns.filter((item) => {
      if (companyName !== brief.companyName && /(?:企业|公司|网站|站点).*名称/u.test(item)) return false;
      if (primaryLanguage !== brief.primaryLanguage && item.includes("语言")) return false;
      if (audienceCandidate && item.includes("目标受众")) return false;
      if (conversionValue && item.includes("转化")) return false;
      if (hasNewContact && item.includes("联系方式")) return false;
      return true;
    }),
  });
}
