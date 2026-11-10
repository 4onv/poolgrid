import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validatePlan } from "./core.js";
const read = (name) =>
  readFile(new URL(name, import.meta.url), "utf8").then((value) =>
    value.replace(/\r\n?/g, "\n"),
  );
export async function renderPlan(input) {
  const plan = validatePlan(input),
    [page, css, core, parser, app] = await Promise.all(
      ["page.html", "style.css", "core.js", "parse-json.js", "app.js"].map(
        read,
      ),
    );
  const api = "validatePlan,evaluateScenario,analyzePlan,buildGrid,toMarkdown";
  const js = `(()=>{\n'use strict';\nconst {${api}}=(()=>{${core.replace(/^export /gm, "")}\nreturn {${api}};})();\nconst parseJson=(()=>{${parser.replace(/^export /gm, "")}\nreturn parseJson;})();\n${app}\n})();`;
  if (/<\/script/i.test(js) || /<\/style/i.test(css))
    throw Error("Unexpected template closing tag.");
  const hash = (value) => createHash("sha256").update(value).digest("base64");
  const data = JSON.stringify(plan).replace(
    /[<>&\u2028\u2029]/g,
    (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  const parts = {
    CSS: css,
    JS: js,
    DATA: data,
    CSP: `default-src 'none';script-src 'sha256-${hash(js)}';style-src 'sha256-${hash(css)}';connect-src 'none';img-src 'none';object-src 'none';base-uri 'none';form-action 'none'`,
  };
  return page.replace(/%%(CSS|JS|DATA|CSP)%%/g, (_match, key) => parts[key]);
}
