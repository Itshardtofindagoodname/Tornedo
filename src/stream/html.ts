/**
 * Minimal, forgiving HTML parser used by the streaming scraper providers
 * (4KHDHub, CircleFTP, hub cloud resolvers, ...). We do not need a standards
 * DOM - just nested elements + attributes + descendant text, with selectors
 * limited to `tag`, `.class`, `#id`, `[attr=value]` and space-separated
 * descendant chains (e.g. "#episodes .episode-download-item").
 */

export type HtmlNode = HtmlElement | string;

export interface HtmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}

export function isElement(node: HtmlNode): node is HtmlElement {
  return typeof node !== "string";
}

/** Concatenated descendant text (whitespace-normalized). */
export function htmlText(node: HtmlNode | HtmlNode[] | undefined): string {
  if (node === undefined) return "";
  const stack: HtmlNode[] = Array.isArray(node) ? [...node] : [node];
  let out = "";
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (typeof item === "string") {
      out += item;
    } else {
      for (let i = item.children.length - 1; i >= 0; i--) stack.push(item.children[i]!);
      out += " ";
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

export function htmlAttr(el: HtmlElement, name: string): string | undefined {
  const raw = el.attrs[name];
  if (raw === undefined) return undefined;
  return raw.trim();
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

const SKIP_TAGS = new Set(["script", "style", "template", "svg", "head"]);

const TAG_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?(?:[a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrText)) !== null) {
    if (m[1] === undefined || attrs[m[1]] !== undefined) continue;
    attrs[m[1]] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  }
  return attrs;
}

/** Parse a tag string (`<a class="x" href="/y">`) with its attrs. */
export function parseTagMarkup(tagText: string): { tag: string | null; attrs: Record<string, string> } | null {
  const m = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/.exec(tagText);
  if (m === null) return null;
  return { tag: m[1]!.toLowerCase(), attrs: parseAttrs(m[2] ?? "") };
}

export function parseHtml(input: string): HtmlNode[] {
  const roots: HtmlNode[] = [];
  const stack: HtmlElement[] = [];
  let text = "";
  let lastIndex = 0;

  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(input)) !== null) {
    const whole = m[0]!;
    if (whole.startsWith("<!--") || whole.startsWith("<!")) continue;
    if (whole.startsWith("<![CDATA[")) continue;
    if (lastIndex < m.index) {
      text += input.slice(lastIndex, m.index);
    }
    lastIndex = TAG_RE.lastIndex;
    const tag = whole.slice(1, 2) === "/" ? whole.slice(2, whole.indexOf(">")) : undefined;
    const isClosing = whole.charAt(1) === "/";
    const tagName = (isClosing ? /^([a-zA-Z][a-zA-Z0-9]*)/.exec(whole.slice(2))?.[1] : /^([a-zA-Z][a-zA-Z0-9]*)/.exec(whole.slice(1))?.[1])?.toLowerCase();
    if (tagName === undefined) continue;
    if (tagName === "br") {
      text += "\n";
      continue;
    }
    const attrs = parseAttrs(whole.slice(1 + tagName.length, whole.length - 1));

    if (isClosing) {
      // Flush text into current parent.
      const parent = stack[stack.length - 1];
      if (parent !== undefined && text.length > 0) {
        parent.children.push(text);
        text = "";
      }
      for (let i = stack.length - 1; i >= 0; i--) {
        const el = stack[i]!;
        stack.pop();
        if (el.tag === tagName) break;
      }
      continue;
    }

    const selfClosing = VOID_TAGS.has(tagName) || SKIP_TAGS.has(tagName);
    const parent = stack[stack.length - 1];
    const receiver = parent === undefined ? roots : parent.children;
    if (text.length > 0) {
      receiver.push(text);
      text = "";
    }
    if (selfClosing) {
      receiver.push({ tag: tagName, attrs, children: [] });
    } else {
      const el: HtmlElement = { tag: tagName, attrs, children: [] };
      receiver.push(el);
      stack.push(el);
    }
  }
  if (lastIndex < input.length) {
    const tail = input.slice(lastIndex);
    if (text.length > 0 || tail.trim().length > 0) {
      const parent = stack[stack.length - 1];
      const merged = text + tail;
      if (parent === undefined) roots.push(merged);
      else parent.children.push(merged);
    }
  }
  return roots;
}

interface Selector {
  tag: string | null;
  classNames: string[];
  id: string | null;
  attrName: string | null;
  attrValue: string | null;
}

function parseSelector(selector: string): Selector | null {
  const s = selector.trim();
  if (s.length === 0) return null;
  const m = /^(?:([a-zA-Z][a-zA-Z0-9]*))?((?:\.[a-zA-Z_][\w-]*)*)?(?:#([a-zA-Z_][\w-]*))?(?:\[([a-zA-Z_:][\w:.-]*)(?:=([^\]]+))?\])?$/.exec(s);
  if (m === null) return null;
  const sel: Selector = { tag: null, classNames: [], id: null, attrName: null, attrValue: null };
  sel.tag = m[1] === undefined ? null : m[1].toLowerCase();
  if (m[2] !== undefined) {
    for (const cls of m[2].match(/\.[a-zA-Z_][\w-]*/g) ?? []) sel.classNames.push(cls.slice(1));
  }
  sel.id = m[3] ?? null;
  sel.attrName = m[4] ?? null;
  sel.attrValue = m[5] === undefined ? null : m[5].replace(/^["']|["']$/g, "");
  return sel;
}

function elementMatches(el: HtmlElement, sel: Selector): boolean {
  if (sel.tag !== null && el.tag !== sel.tag) return false;
  if (sel.classNames.length > 0) {
    const classes = (el.attrs["class"] ?? "").split(/\s+/);
    for (const c of sel.classNames) if (!classes.includes(c)) return false;
  }
  if (sel.id !== null && el.attrs["id"] !== sel.id) return false;
  if (sel.attrName !== null) {
    const v = el.attrs[sel.attrName];
    if (v === undefined) return false;
    if (sel.attrValue !== null && v !== sel.attrValue) return false;
  }
  return true;
}

export function queryHtml(root: HtmlNode[], selector: string): HtmlElement | null {
  return queryAllHtml(root, selector)[0] ?? null;
}

export function queryAllHtml(root: HtmlNode[], selector: string): HtmlElement[] {
  const parts = selector.split(/\s+/).filter((p) => p.length > 0);
  const parsed = parts.map(parseSelector).filter((s): s is Selector => s !== null);
  if (parsed.length === 0) return [];

  const results: HtmlElement[] = [];
  const stack: Array<{ nodes: HtmlNode[]; selectors: Selector[]; index: number }> = [
    { nodes: root, selectors: parsed, index: 0 },
  ];
  while (stack.length > 0) {
    const { nodes, selectors, index } = stack.pop()!;
    for (const node of nodes) {
      if (typeof node === "string") continue;
      if (elementMatches(node, selectors[index]!)) {
        if (index === selectors.length - 1) results.push(node);
        else stack.push({ nodes: node.children, selectors, index: index + 1 });
      }
    }
  }
  return results;
}