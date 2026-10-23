import { chromium } from "playwright";

/**
 * Default: stateful smoke for the redesigned live routes. Entering the routes
 * invokes their real controllers and may open/create a conversation or SiteOps
 * project. It does not generate, revise, reset, delete, or publish a website.
 * Add --execute-rag to submit one real question.
 * Add --execute-site plus FRONTMIND_ACCEPTANCE_ALLOW_PAID=1 to create one real
 * website build from a pre-build project.
 * Add --execute-site-revision plus the same paid guard to submit a safe
 * revision when a preview_ready/approved/live build already exists. Neither
 * website path resets, deletes, or publishes. Credentials are accepted only
 * through environment variables and are never printed. Template selection
 * defaults to /help|帮助中心/ and can be narrowed with
 * FRONTMIND_ACCEPTANCE_TEMPLATE_PATTERN. Site/assistant fields can be set with
 * FRONTMIND_ACCEPTANCE_SITE_NAME, FRONTMIND_ACCEPTANCE_SITE_GOAL,
 * FRONTMIND_ACCEPTANCE_ASSISTANT_NAME and FRONTMIND_ACCEPTANCE_WELCOME.
 */

const baseUrl = process.env.FRONTMIND_ACCEPTANCE_URL;
if (!baseUrl) {
  throw new Error("FRONTMIND_ACCEPTANCE_URL is required");
}

const executeRag = process.argv.includes("--execute-rag");
const executeSite = process.argv.includes("--execute-site");
const executeSiteRevision = process.argv.includes("--execute-site-revision");
if (executeSite && executeSiteRevision) {
  throw new Error(
    "Choose either --execute-site or --execute-site-revision, not both",
  );
}
if (
  (executeSite || executeSiteRevision)
  && process.env.FRONTMIND_ACCEPTANCE_ALLOW_PAID !== "1"
) {
  throw new Error(
    "Real website generation or revision requires FRONTMIND_ACCEPTANCE_ALLOW_PAID=1",
  );
}

const templatePatternSource =
  process.env.FRONTMIND_ACCEPTANCE_TEMPLATE_PATTERN ?? "(?:help|帮助中心)";
let templatePattern;
try {
  templatePattern = new RegExp(templatePatternSource, "iu");
} catch (error) {
  throw new Error(
    `FRONTMIND_ACCEPTANCE_TEMPLATE_PATTERN is invalid: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const timeoutMs = Number(
  process.env.FRONTMIND_ACCEPTANCE_TIMEOUT_MS ?? 15 * 60 * 1000,
);
if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) {
  throw new Error("FRONTMIND_ACCEPTANCE_TIMEOUT_MS must be at least 10000");
}

function pageUrl(view, parameters = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set("view", view);
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function expectVisible(locator, message, timeout = 30_000) {
  await locator.waitFor({ state: "visible", timeout }).catch((error) => {
    throw new Error(`${message}: ${error.message}`);
  });
}

function compactLine(value, maximumLength) {
  return value.replace(/\s+/gu, " ").trim().slice(0, maximumLength);
}

function acceptanceMarker() {
  return new Date().toISOString().replace(/\D/gu, "").slice(0, 14);
}

async function readBuildSnapshot(page) {
  const status = page.getByTestId("siteops-build-status");
  const text = (await status.textContent()) ?? "";
  const ordinalMatch = text.match(/真实构建\s*#(\d+)/u);
  const link = page.getByTestId("siteops-preview-link");
  return {
    ordinal: ordinalMatch ? Number(ordinalMatch[1]) : 0,
    previewUrl: (await link.count()) > 0 ? await link.getAttribute("href") : null,
    statusText: compactLine(text, 500),
  };
}

async function waitForSiteOpsObservation(page) {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await readBuildSnapshot(page);
  while (
    Date.now() < deadline
    && snapshot.statusText.includes("正在连接真实建站服务")
  ) {
    await page.waitForTimeout(500);
    snapshot = await readBuildSnapshot(page);
  }
  if (snapshot.statusText.includes("正在连接真实建站服务")) {
    throw new Error("The live SiteOps controller did not finish opening its project");
  }
  return snapshot;
}

async function waitForNewBuildPreview(page, previousOrdinal) {
  const deadline = Date.now() + timeoutMs;
  let latest = await readBuildSnapshot(page);
  while (Date.now() < deadline) {
    latest = await readBuildSnapshot(page);
    if (latest.ordinal > previousOrdinal && latest.previewUrl) return latest;
    if (
      latest.ordinal > previousOrdinal
      && /建站失败|建站需要处理|建站已取消/u.test(latest.statusText)
    ) {
      throw new Error(
        `The new real build #${latest.ordinal} stopped before producing a preview: ${latest.statusText}`,
      );
    }
    await page.waitForTimeout(1_500);
  }
  throw new Error(
    `SiteOps did not produce a newer real preview after build #${previousOrdinal}; latest UI state: ${latest.statusText || "unavailable"}`,
  );
}

async function configureDesignFields(page, { revision }) {
  const marker = acceptanceMarker();
  const siteNameInput = page.getByTestId("website-site-name");
  const siteGoalInput = page.getByTestId("website-site-goal");
  await expectVisible(siteNameInput, "The real website-name field is missing");
  if (await siteNameInput.isDisabled() || await siteGoalInput.isDisabled()) {
    throw new Error(
      revision
        ? "The current SiteOps build does not allow a safe revision from the redesigned page"
        : "The pre-build SiteOps brief fields are unexpectedly locked",
    );
  }
  const currentSiteName = compactLine(await siteNameInput.inputValue(), 80);
  const currentSiteGoal = compactLine(await siteGoalInput.inputValue(), 200);
  const siteName = compactLine(
    process.env.FRONTMIND_ACCEPTANCE_SITE_NAME
      ?? (revision
        ? `${currentSiteName || "企业帮助中心"} 验收${marker}`
        : currentSiteName || "企业帮助中心"),
    80,
  );
  const siteGoal = compactLine(
    process.env.FRONTMIND_ACCEPTANCE_SITE_GOAL
      ?? (revision
        ? `真实改版验收目标 ${marker}：${currentSiteGoal || "帮助客户依据企业知识自助解决问题"}`
        : currentSiteGoal || "帮助客户依据企业知识自助解决问题"),
    200,
  );
  if (!siteName || !siteGoal) {
    throw new Error("Website name and goal must both be non-empty");
  }
  await siteNameInput.fill(siteName);
  await siteGoalInput.fill(siteGoal);
  await page.getByRole("button", { name: "继续", exact: true }).last().click();

  const assistantNameInput = page.getByTestId("website-assistant-name");
  const welcomeInput = page.getByTestId("website-assistant-welcome");
  await expectVisible(assistantNameInput, "The real assistant configuration step did not open");
  if (await assistantNameInput.isDisabled() || await welcomeInput.isDisabled()) {
    throw new Error("The real assistant revision fields are unexpectedly locked");
  }
  const currentAssistantName = compactLine(await assistantNameInput.inputValue(), 60);
  const currentWelcome = compactLine(await welcomeInput.inputValue(), 140);
  const assistantName = compactLine(
    (process.env.FRONTMIND_ACCEPTANCE_ASSISTANT_NAME ?? currentAssistantName)
      || "企业知识助手",
    60,
  );
  const welcome = compactLine(
    (process.env.FRONTMIND_ACCEPTANCE_WELCOME ?? currentWelcome)
      || "您好，我会依据企业知识为您解答。",
    140,
  );
  if (!assistantName || !welcome) {
    throw new Error("Assistant name and welcome message must both be non-empty");
  }
  await assistantNameInput.fill(assistantName);
  await welcomeInput.fill(welcome);
  return { assistantName, siteGoal, siteName, welcome };
}

async function verifyGeneratedPreview(context, previewUrl, expected) {
  const preview = await context.newPage();
  try {
    const response = await preview.goto(new URL(previewUrl, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    if (!response?.ok()) {
      throw new Error(
        `Generated website preview returned HTTP ${response?.status() ?? "unknown"}`,
      );
    }
    const normalizedName = compactLine(expected.siteName, 80);
    const normalizedGoal = compactLine(expected.siteGoal, 200);
    await preview.waitForFunction(
      ({ name, goal }) => {
        const text = document.body?.innerText.replace(/\s+/gu, " ").trim() ?? "";
        return Boolean((name && text.includes(name)) || (goal && text.includes(goal)));
      },
      { name: normalizedName, goal: normalizedGoal },
      { timeout: Math.min(timeoutMs, 60_000) },
    ).catch(() => undefined);
    const previewText = compactLine(await preview.locator("body").innerText(), 200_000);
    const matched = [normalizedName, normalizedGoal].filter(Boolean).find(
      (value) => previewText.includes(value),
    );
    if (!matched) {
      throw new Error(
        "The newer real preview loaded, but its rendered text contains neither the submitted website name nor the submitted goal",
      );
    }
    log(
      `PASS newer real preview rendered submitted ${matched === normalizedName ? "website name" : "website goal"}`,
    );
  } finally {
    await preview.close();
  }
}

const launchOptions = { headless: process.env.HEADFUL !== "1" };
if (process.env.FRONTMIND_ACCEPTANCE_BROWSER_CHANNEL) {
  launchOptions.channel = process.env.FRONTMIND_ACCEPTANCE_BROWSER_CHANNEL;
}

const browser = await chromium.launch(launchOptions);
try {
  const username = process.env.FRONTMIND_ACCEPTANCE_HTTP_USER;
  const password = process.env.FRONTMIND_ACCEPTANCE_HTTP_PASSWORD;
  if (Boolean(username) !== Boolean(password)) {
    throw new Error(
      "FRONTMIND_ACCEPTANCE_HTTP_USER and FRONTMIND_ACCEPTANCE_HTTP_PASSWORD must be provided together",
    );
  }
  const context = await browser.newContext({
    ...(username && password
      ? { httpCredentials: { username, password } }
      : {}),
    ignoreHTTPSErrors:
      process.env.FRONTMIND_ACCEPTANCE_IGNORE_HTTPS_ERRORS === "1",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  if (!executeRag && !executeSite && !executeSiteRevision) {
    log(
      "INFO stateful smoke: live controllers may open/create a RAG conversation and SiteOps project; no question, build, revision, reset, delete, or publish will be submitted",
    );
  }

  await page.goto(pageUrl("enterprise-qa"), { waitUntil: "domcontentloaded" });
  await expectVisible(
    page.getByTestId("enterprise-rag-live-root"),
    "The live Enterprise RAG route did not render the redesigned surface",
  );
  await expectVisible(
    page.getByRole("heading", { name: "让回答真正满足用户需求" }),
    "The redesigned Enterprise RAG heading is missing",
  );
  if (await page.getByText("AI友好官网管理", { exact: true }).count()) {
    throw new Error("The Enterprise RAG route fell back to the legacy SiteOps UI");
  }
  log("PASS redesigned Enterprise RAG route");

  if (executeRag) {
    const input = page.getByTestId("rag-question-input");
    const submit = page.getByTestId("rag-submit");
    if (await submit.isDisabled()) {
      throw new Error(
        "Real RAG is unavailable: publish the knowledge base and verify model readiness first",
      );
    }
    const question =
      process.env.FRONTMIND_ACCEPTANCE_QUESTION ??
      "FrontMind 可以帮企业做什么？请给出知识来源。";
    const answer = page.getByTestId("rag-answer");
    const prior = (await answer.textContent())?.trim() ?? "";
    await input.fill(question);
    await submit.click();
    await page.waitForFunction(
      ({ testId, previous }) => {
        const text = document
          .querySelector(`[data-testid="${testId}"]`)
          ?.textContent?.trim();
        return Boolean(
          text &&
            text !== previous &&
            !text.includes("正在") &&
            !text.includes("尚无待评估回答"),
        );
      },
      { testId: "rag-answer", previous: prior },
      { timeout: timeoutMs },
    );
    await expectVisible(
      page.getByTestId("rag-source").first(),
      "The real RAG answer completed without a source reference",
    );
    log("PASS real Enterprise RAG answer and source");
  }

  await page.goto(pageUrl("website"), { waitUntil: "domcontentloaded" });
  await expectVisible(
    page.getByTestId("website-builder-live-root"),
    "The live website route did not render the redesigned builder",
  );
  await expectVisible(
    page.getByRole("heading", { name: "从知识库快速搭建帮助中心" }),
    "The redesigned website-builder heading is missing",
  );
  await expectVisible(
    page.getByTestId("siteops-build-status"),
    "The redesigned builder did not receive live SiteOps state",
  );
  const openedSiteOps = await waitForSiteOpsObservation(page);
  if (await page.getByText("AI友好官网管理", { exact: true }).count()) {
    throw new Error("The website route fell back to the legacy SiteOps UI");
  }
  log(`PASS redesigned website route with live SiteOps state: ${openedSiteOps.statusText}`);

  if (executeSite || executeSiteRevision) {
    const initialBuild = openedSiteOps;
    let submittedConfiguration;

    if (executeSite) {
      if (initialBuild.ordinal > 0) {
        throw new Error(
          `A real build already exists (#${initialBuild.ordinal}); use --execute-site-revision for a safe non-publishing revision instead of trying to select a new template`,
        );
      }
      const deadline = Date.now() + timeoutMs;
      let executableCards = [];
      while (executableCards.length === 0 && Date.now() < deadline) {
        const cards = page.getByTestId("website-template-card");
        executableCards = [];
        for (let index = 0; index < await cards.count(); index += 1) {
          const card = cards.nth(index);
          const radio = card.locator('input[type="radio"]');
          if ((await radio.count()) > 0 && !(await radio.isDisabled())) {
            executableCards.push({
              card,
              radio,
              text: compactLine((await card.innerText()) ?? "", 500),
            });
          }
        }
        if (executableCards.length > 0) break;
        const advance = page.getByTestId("siteops-advance");
        if ((await advance.count()) > 0 && !(await advance.isDisabled())) {
          await advance.click();
        }
        await page.waitForTimeout(1_000);
      }
      if (executableCards.length === 0) {
        throw new Error(
          "No executable real template became available before the acceptance timeout",
        );
      }
      const selected = executableCards.find(({ text }) => templatePattern.test(text));
      if (!selected) {
        throw new Error(
          `No executable template matched FRONTMIND_ACCEPTANCE_TEMPLATE_PATTERN=${JSON.stringify(templatePatternSource)}. Available executable templates: ${executableCards.map(({ text }) => JSON.stringify(text)).join(", ")}`,
        );
      }
      await selected.radio.check();
      await page.getByRole("button", { name: "继续配置真实 brief" }).click();
      submittedConfiguration = await configureDesignFields(page, { revision: false });
      const build = page.getByTestId("website-build-start");
      if (await build.isDisabled()) {
        throw new Error("The selected real template and brief did not enable website generation");
      }
      await build.click();
      log(
        `INFO submitted real SiteOps generation with template matching ${JSON.stringify(templatePatternSource)}; no publish/reset/delete action was requested`,
      );
    } else {
      if (initialBuild.ordinal < 1) {
        throw new Error(
          "--execute-site-revision requires an existing real build; use --execute-site for the first build",
        );
      }
      await page.getByRole("button", { name: /确认结构/u }).click();
      submittedConfiguration = await configureDesignFields(page, { revision: true });
      const revise = page.getByTestId("website-revision-submit");
      await expectVisible(
        revise,
        "The existing SiteOps state does not expose the safe revision action",
      );
      if (await revise.isDisabled()) {
        throw new Error("The safe real revision action is disabled for the current SiteOps state");
      }
      await revise.click();
      log(
        `INFO submitted a real SiteOps revision after build #${initialBuild.ordinal}; no publish/reset/delete action was requested`,
      );
    }

    const nextBuild = await waitForNewBuildPreview(page, initialBuild.ordinal);
    await verifyGeneratedPreview(context, nextBuild.previewUrl, submittedConfiguration);
    log(
      `PASS real SiteOps ${executeSiteRevision ? "revision" : "generation"} produced newer build #${nextBuild.ordinal}; assistant name/welcome and theme are generation preferences and were not asserted`,
    );
  }

  if (process.env.FRONTMIND_ACCEPTANCE_SCREENSHOT) {
    await page.screenshot({
      path: process.env.FRONTMIND_ACCEPTANCE_SCREENSHOT,
      fullPage: true,
    });
  }

  await context.close();
} finally {
  await browser.close();
}
