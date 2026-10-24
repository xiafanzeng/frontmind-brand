import { runStaticTemplateCatalogCli, reportCatalogCliFailure } from "./static-template-catalog-cli.js";
runStaticTemplateCatalogCli(process.argv.slice(2)).catch(reportCatalogCliFailure);
