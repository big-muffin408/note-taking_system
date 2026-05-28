import TurndownService from 'turndown';
import { marked } from 'marked';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}

export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

const INLINE_TAG_RE = /<\/?(?:em|strong|i|b|u|mark|span)(?:\s[^>]*)?>/gi;

function stripInlineTagsAndDecodeEntities(s: string): string {
  return s
    .replace(INLINE_TAG_RE, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Clean up math regions in HTML produced by older parsers that didn't shield
// $$…$$ / $…$ from markdown's italic/bold handling. Without this, <em> sneaks
// inside the LaTeX, splitting the math across DOM text nodes so the editor's
// regex only catches a $…$ fragment and KaTeX errors on commands like \tag
// that require display mode.
export function sanitizeMathHtml(html: string): string {
  let out = html.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) => `$$${stripInlineTagsAndDecodeEntities(inner)}$$`);
  out = out.replace(/(?<!\$)\$(?!\$)([^$\n<>]*?(?:<\/?(?:em|strong|i|b|u|mark|span)[^>]*>[^$\n<>]*?)+)\$(?!\$)/g,
    (_m, inner: string) => `$${stripInlineTagsAndDecodeEntities(inner)}$`);
  return out;
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
