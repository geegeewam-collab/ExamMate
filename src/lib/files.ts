const loadScript = (src: string) =>
  new Promise<void>((ok, no) => {
    const e = document.createElement('script');
    e.src = src;
    e.onload = () => ok();
    e.onerror = () => no(new Error('script'));
    document.head.appendChild(e);
  });

/** Reads .txt/.md/.docx/.pdf into plain text. docx and pdf libraries load from a CDN on first use. */
export async function readTextFile(f: File): Promise<string> {
  const n = f.name.toLowerCase();
  const w = window as any;
  let text = '';
  if (n.endsWith('.docx')) {
    if (!w.mammoth) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
    text = (await w.mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value;
  } else if (n.endsWith('.pdf')) {
    if (!w.pdfjsLib) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      w.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const pdf = await w.pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
    for (let k = 1; k <= pdf.numPages; k++) {
      const c = await (await pdf.getPage(k)).getTextContent();
      text += c.items.map((x: { str: string }) => x.str).join(' ') + '\n';
    }
  } else {
    text = await f.text();
  }
  return text.trim();
}
