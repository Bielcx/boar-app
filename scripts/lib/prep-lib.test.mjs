import { describe, it, expect } from "vitest";
import { decodeEntities, htmlToText } from "./prep-lib.mjs";

describe("htmlToText", () => {
  it("keeps the main content with headings and lists, drops navigation and scripts", () => {
    const html = `<html><head><title>Water | Ready.gov</title><script>x()</script></head><body>
      <nav>Menu Home</nav><main><h1>Water</h1><p>Store at least 1 gallon per person&nbsp;per day.</p>
      <h2>Treat water</h2><ul><li>Boil for <b>1 minute</b>.</li><li>Use bleach.</li></ul><footer>Links</footer></main></body></html>`;
    expect(htmlToText(html)).toEqual({
      title: "Water",
      text: "Store at least 1 gallon per person per day.\n\n## Treat water\n\n- Boil for 1 minute .\n- Use bleach.",
    });
  });
  it("decodes entities", () => {
    expect(decodeEntities("A&amp;B &#8211; &#x2014; &deg;F &bogus;")).toBe("A&B – — °F &bogus;");
  });
});
