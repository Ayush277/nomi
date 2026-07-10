/** Pull text out of an uploaded file for the Nomi Space. Plain text is read
 * directly; PDFs go through pdf.js (bundled, no CDN). Runs in the dashboard
 * page. */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractText(file: File): Promise<{ kind: string; text: string }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const parts: string[] = [];
    const pages = Math.min(pdf.numPages, 50);
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((it: any) => it.str ?? '').join(' '));
    }
    return { kind: 'pdf', text: parts.join('\n\n') };
  }
  // txt / md / csv / json and anything text-like
  return { kind: 'text', text: await file.text() };
}
