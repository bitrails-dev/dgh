// Runnable check for the Lexical serializer. Run: node --experimental-strip-types src/lib/lexical.selfcheck.ts
import assert from "node:assert";
import { lexicalToHtml } from "./lexical.ts";

// Empty / null inputs are safe.
assert.equal(lexicalToHtml(null), "");
assert.equal(lexicalToHtml({}), "");
assert.equal(lexicalToHtml({ root: { children: [] } }), "");

// Paragraph with mixed marks + a link, plus a heading and a list.
const tree = {
  root: {
    children: [
      { type: "heading", tag: "h2", children: [{ type: "text", text: "Title" }] },
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Hello ", format: 0 },
          { type: "text", text: "bold", format: 1 },
          { type: "text", text: " & <safe>", format: 0 },
          { type: "link", fields: { url: "https://x.test", newTab: true }, children: [{ type: "text", text: "link" }] },
        ],
      },
      { type: "list", tag: "ul", children: [{ type: "listitem", children: [{ type: "text", text: "one" }] }] },
    ],
  },
};
const html = lexicalToHtml(tree);
assert.ok(html.includes("<h2>Title</h2>"), "heading");
assert.ok(html.includes("<strong>bold</strong>"), "bold mark");
assert.ok(html.includes("&amp; &lt;safe&gt;"), "html escaped");
assert.ok(html.includes('<a href="https://x.test" target="_blank" rel="noopener noreferrer">link</a>'), "link + newTab");
assert.ok(html.includes("<ul><li>one</li></ul>"), "list");

// Unknown node keeps its text rather than dropping it.
assert.equal(lexicalToHtml({ root: { children: [{ type: "weird", text: "kept" }] } }), "kept");

console.log("lexical.selfcheck: OK");
