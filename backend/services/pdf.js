import PDFDocument from "pdfkit";

export const money = (c) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: process.env.CURRENCY || "USD" });

const X = 40, W = 515, LIMIT = 770;

function table(pdf, b) {
  const cols = b.columns;
  const total = cols.reduce((s, c) => s + (c.w || 1), 0);
  let x = X;
  const pos = cols.map((c) => {
    const w = ((c.w || 1) / total) * W;
    const p = { x, w };
    x += w;
    return p;
  });
  const row = (vals, font, y, head) =>
    cols.forEach((c, i) => {
      const v = vals[c.key];
      const t = head ? c.label : v == null ? "" : c.money ? money(v) : String(v);
      pdf.font(font).fontSize(8.5).fillColor("#000")
        .text(t, pos[i].x + 2, y, { width: pos[i].w - 6, align: c.money ? "right" : "left", lineBreak: false, ellipsis: true });
    });
  let y = pdf.y;
  const head = () => {
    row({}, "Helvetica-Bold", y, true);
    pdf.moveTo(X, y + 13).lineTo(X + W, y + 13).lineWidth(0.5).strokeColor("#888").stroke();
    y += 17;
  };
  head();
  for (const r of b.rows) {
    if (y > LIMIT) { pdf.addPage(); y = 40; head(); }
    row(r, r.bold ? "Helvetica-Bold" : "Helvetica", y);
    y += 15;
  }
  if (b.footer) {
    if (y > LIMIT) { pdf.addPage(); y = 40; }
    pdf.moveTo(X, y - 2).lineTo(X + W, y - 2).lineWidth(0.5).strokeColor("#000").stroke();
    row(b.footer, "Helvetica-Bold", y + 2);
    y += 19;
  }
  pdf.y = y + 6;
}

function lines(pdf, b) {
  let y = pdf.y;
  for (const r of b.rows) {
    if (y > LIMIT) { pdf.addPage(); y = 40; }
    const ind = (r.indent || 0) * 16;
    const bold = r.bold || r.heading;
    pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(r.heading ? 10 : 9.5).fillColor("#000")
      .text(r.label, X + ind, y, { width: W - 130 - ind, lineBreak: false });
    if (r.amount != null) {
      if (r.rule) pdf.moveTo(X + W - 110, y - 2).lineTo(X + W, y - 2).lineWidth(0.5).strokeColor("#000").stroke();
      pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor("#000")
        .text(money(r.amount), X + W - 120, y, { width: 120, align: "right", lineBreak: false });
    }
    y += r.heading ? 18 : 15;
  }
  pdf.y = y;
}

export function sendPdf(res, doc, filename) {
  const pdf = new PDFDocument({ size: "A4", margins: { top: 40, left: 40, right: 40, bottom: 30 }, bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
  pdf.pipe(res);

  pdf.font("Helvetica-Bold").fontSize(9).fillColor("#555").text(doc.company, X, 40);
  pdf.font("Helvetica-Bold").fontSize(17).fillColor("#000").text(doc.title, X, pdf.y + 2);
  if (doc.subtitle) pdf.font("Helvetica").fontSize(9).fillColor("#555").text(doc.subtitle, X);
  pdf.y += 14;

  for (const b of doc.blocks) {
    if (pdf.y > LIMIT) pdf.addPage();
    if (b.type === "table") table(pdf, b);
    else if (b.type === "lines") lines(pdf, b);
    else if (b.type === "heading") {
      pdf.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(b.text, X, pdf.y + 8);
      pdf.y += 6;
    } else if (b.type === "note") {
      pdf.font("Helvetica-Oblique").fontSize(9).fillColor(b.ok === false ? "#b00020" : "#2e7d32").text(b.text, X, pdf.y + 8, { width: W });
    }
  }

  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(i);
    pdf.font("Helvetica").fontSize(8).fillColor("#888").text(`Page ${i + 1} of ${range.count}`, X, 800, { width: W, align: "right", lineBreak: false });
  }
  pdf.end();
}
