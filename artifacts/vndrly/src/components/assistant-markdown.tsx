import { Link } from "wouter";
import {
  normalizeAssistantLinkHref,
  normalizeAssistantMarkdownInput,
} from "@/lib/assistant-link-href";

/**
 * Tiny markdown renderer for assistant messages. Supports the subset
 * Claude actually emits in this app: paragraphs, bullets, **bold**,
 * `code`, [text](url) links. Anything else falls through as plain text
 * so we never explode on a malformed token mid-stream.
 *
 * Why not react-markdown? It's another ~25KB and a dependency we don't
 * need for the small subset above.
 */
export function AssistantMarkdown({ text }: { text: string }) {
  const normalized = normalizeAssistantMarkdownInput(text.replace(/\r\n/g, "\n"));
  // Strip Windows newlines and split into paragraph blocks.
  const paragraphs = normalized.split(/\n\n+/);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {paragraphs.map((para, i) => {
        // Bullet list: every line starts with - or *.
        const lines = para.split("\n");
        const isList = lines.length > 0 && lines.every((l) => /^[-*]\s+/.test(l.trim()));
        if (isList) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.replace(/^\s*[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {renderInline(para)}
          </p>
        );
      })}
    </div>
  );
}

// Inline pass: handles bold, code, and links.
function renderInline(s: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let rest = s;
  let key = 0;
  // Order matters: link first (longest match), then bold, then code.
  const patterns: Array<{
    re: RegExp;
    render: (m: RegExpExecArray) => React.ReactNode;
  }> = [
    {
      re: /\[([^\]]+)\]\(([^)]+)\)/,
      render: (m) => {
        const href = normalizeAssistantLinkHref(m[2]) ?? m[2].trim();
        // Hard-allowlist the protocol so a model-emitted
        // `[Click](javascript:alert(1))` can't execute on click. We
        // accept three shapes only:
        //   1. relative app routes that start with `/` but NOT `//`
        //      (which is protocol-relative and could escape the origin)
        //   2. http:// or https:// absolute URLs
        //   3. mailto: and tel: links
        // Anything else (e.g. javascript:, data:, vbscript:) renders as
        // plain text — the user still sees the link label, just not as
        // a clickable element.
        const isInternal = href.startsWith("/") && !href.startsWith("//");
        const isSafeAbsolute = /^(https?:|mailto:|tel:)/i.test(href);
        if (isInternal) {
          return (
            <Link href={href} key={key++} className="underline text-primary hover:text-primary/80">
              {m[1]}
            </Link>
          );
        }
        if (isSafeAbsolute) {
          return (
            <a
              key={key++}
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="underline text-primary hover:text-primary/80"
            >
              {m[1]}
            </a>
          );
        }
        // Unsafe protocol — render the label as plain text so we never
        // surface a clickable javascript: / data: link.
        return <span key={key++}>{m[1]}</span>;
      },
    },
    {
      re: /\*\*([^*]+)\*\*/,
      render: (m) => <strong key={key++}>{m[1]}</strong>,
    },
    {
      re: /`([^`]+)`/,
      render: (m) => (
        <code key={key++} className="bg-muted px-1 py-0.5 rounded text-xs font-mono">
          {m[1]}
        </code>
      ),
    },
  ];

  // Greedy left-to-right walk: at each position pick the earliest match
  // across all patterns.
  while (rest.length > 0) {
    let earliest: { idx: number; m: RegExpExecArray; render: (m: RegExpExecArray) => React.ReactNode } | null = null;
    for (const p of patterns) {
      const m = p.re.exec(rest);
      if (m && (earliest === null || m.index < earliest.idx)) {
        earliest = { idx: m.index, m, render: p.render };
      }
    }
    if (!earliest) {
      nodes.push(rest);
      break;
    }
    if (earliest.idx > 0) nodes.push(rest.slice(0, earliest.idx));
    nodes.push(earliest.render(earliest.m));
    rest = rest.slice(earliest.idx + earliest.m[0].length);
  }
  return nodes;
}
