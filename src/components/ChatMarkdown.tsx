import type { ReactNode } from "react";

/** Safe-ish markdown for investor chat view: paragraphs, lists, bold, inline code. */
export function ChatMarkdown({ text }: { text: string }) {
  const blocks = splitBlocks(text.trim());
  return (
    <div className="co-md">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

type Block =
  | { type: "p"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

function splitBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "p", lines: para });
  }
  return blocks;
}

function Block({ block }: { block: Block }) {
  if (block.type === "ul") {
    return (
      <ul>
        {block.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>
    );
  }
  if (block.type === "ol") {
    return (
      <ol>
        {block.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ol>
    );
  }
  return <p>{inline(block.lines.join(" "))}</p>;
}

function inline(raw: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(raw))) {
    if (m.index > last) nodes.push(raw.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    }
    last = m.index + token.length;
  }
  if (last < raw.length) nodes.push(raw.slice(last));
  return nodes;
}
