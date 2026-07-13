// Minimal Payload-Lexical → HTML serializer. Payload's default editor emits a well-defined
// JSON tree; this covers the nodes a hospital article actually uses (paragraphs, headings,
// lists, quotes, links, and bold/italic/underline/strike/code marks).
// ponytail: covers common nodes; unknown nodes fall back to rendering their children/text, so
// nothing is dropped silently. Swap for @payloadcms/richtext-lexical's converter if authors
// start using tables/uploads inside rich text.

const IS_BOLD = 1, IS_ITALIC = 2, IS_STRIKE = 4, IS_UNDERLINE = 8, IS_CODE = 16;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return esc(s).replace(/"/g, "&quot;");
}

function renderText(node: any): string {
  let out = esc(String(node.text ?? ""));
  const f = node.format ?? 0;
  if (f & IS_CODE) out = `<code>${out}</code>`;
  if (f & IS_BOLD) out = `<strong>${out}</strong>`;
  if (f & IS_ITALIC) out = `<em>${out}</em>`;
  if (f & IS_UNDERLINE) out = `<u>${out}</u>`;
  if (f & IS_STRIKE) out = `<s>${out}</s>`;
  return out;
}

function renderChildren(node: any): string {
  return (node?.children ?? []).map(renderNode).join("");
}

function renderNode(node: any): string {
  if (!node || typeof node !== "object") return "";
  switch (node.type) {
    case "text":
      return renderText(node);
    case "linebreak":
      return "<br/>";
    case "paragraph": {
      const inner = renderChildren(node);
      return inner ? `<p>${inner}</p>` : "";
    }
    case "heading": {
      const tag = /^h[1-6]$/.test(node.tag) ? node.tag : "h2";
      return `<${tag}>${renderChildren(node)}</${tag}>`;
    }
    case "quote":
      return `<blockquote>${renderChildren(node)}</blockquote>`;
    case "list": {
      const tag = node.tag === "ol" || node.listType === "number" ? "ol" : "ul";
      return `<${tag}>${renderChildren(node)}</${tag}>`;
    }
    case "listitem":
      return `<li>${renderChildren(node)}</li>`;
    case "link": {
      const url = node.fields?.url ?? node.url ?? "#";
      const newTab = node.fields?.newTab ? ' target="_blank" rel="noopener noreferrer"' : "";
      return `<a href="${escAttr(String(url))}"${newTab}>${renderChildren(node)}</a>`;
    }
    default:
      // Unknown node: keep its content rather than lose it.
      return node.children ? renderChildren(node) : node.text ? renderText(node) : "";
  }
}

// Accepts a Lexical editor value ({ root: {...} }) or a bare root; returns "" for empty/null.
export function lexicalToHtml(value: any): string {
  if (!value) return "";
  const root = value.root ?? value;
  if (!root?.children) return "";
  return renderChildren(root);
}
