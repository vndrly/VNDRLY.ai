export function buildGateReportPrintDocument(report: HTMLElement, title: string) {
  const clone = report.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".print\\:hidden").forEach(element => element.remove());
  const titleElement = document.createElement("title"); titleElement.textContent = title;
  return `<!doctype html><html><head><meta charset="utf-8">${titleElement.outerHTML}<style>
    body { font: 11px Arial, sans-serif; color: black; margin: 0; }
    h2 { font-size: 18px; } p { line-height: 1.4; }
    dl { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; border-block: 1px solid #aaa; padding: 10px 0; }
    dd { margin: 0; font-weight: bold; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8pt; }
    th, td { border-bottom: 1px solid #ddd; padding: 5px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    thead { display: table-header-group; } tr { break-inside: avoid; }
    @page { size: landscape; margin: 12mm; }
  </style></head><body>${clone.outerHTML}</body></html>`;
}

export function printGateReport(report: HTMLElement, title: string) {
  // A dedicated document avoids fixed-height/overflow ancestors clipping pages.
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;bottom:0;right:0";
  frame.onload = () => {
    const target = frame.contentWindow;
    if (!target) return;
    target.addEventListener("afterprint", () => frame.remove(), { once: true });
    target.focus(); target.print();
  };
  frame.srcdoc = buildGateReportPrintDocument(report, title);
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 5 * 60_000);
}
