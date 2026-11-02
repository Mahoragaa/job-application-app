import type { StructuredResume } from "./ai-resume";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── Minimal Pure-TS ZIP Builder (Store Mode with CRC32) ──

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipArchive(files: Array<{ name: string; content: string }>): Blob {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // Local file header (30 bytes + file name)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true);         // version needed
    lv.setUint16(6, 0, true);          // flags
    lv.setUint16(8, 0, true);          // compression = 0 (stored)
    lv.setUint16(10, 0, true);         // mod time
    lv.setUint16(12, 0, true);         // mod date
    lv.setUint32(14, crc, true);       // crc32
    lv.setUint32(18, size, true);      // compressed size
    lv.setUint32(22, size, true);      // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);         // extra length
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    // Central directory header (46 bytes + file name)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true);         // version made by
    cv.setUint16(6, 20, true);         // version needed
    cv.setUint16(8, 0, true);          // flags
    cv.setUint16(10, 0, true);         // compression = 0
    cv.setUint16(12, 0, true);         // mod time
    cv.setUint16(14, 0, true);         // mod date
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);         // extra length
    cv.setUint16(32, 0, true);         // comment length
    cv.setUint16(34, 0, true);         // disk number
    cv.setUint16(36, 0, true);         // internal attrs
    cv.setUint32(38, 0, true);         // external attrs
    cv.setUint32(42, offset, true);    // local header offset
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const allChunks = [...localParts, ...centralParts, eocd];
  const totalLength = allChunks.reduce((acc, c) => acc + c.byteLength, 0);
  const merged = new Uint8Array(new ArrayBuffer(totalLength));
  let pos = 0;
  for (const chunk of allChunks) {
    merged.set(chunk, pos);
    pos += chunk.byteLength;
  }

  return new Blob([merged.buffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// ─── OpenXML Paragraph Helpers ───────────────────

function docxParagraph(
  runsXml: string,
  opts: { align?: "center" | "left"; spaceAfter?: number; spaceBefore?: number; bottomBorder?: boolean } = {}
): string {
  const jc = opts.align === "center" ? `<w:jc w:val="center"/>` : "";
  const spacing = `<w:spacing w:before="${opts.spaceBefore ?? 0}" w:after="${opts.spaceAfter ?? 100}"/>`;
  const border = opts.bottomBorder
    ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="CBD5E1"/></w:pBdr>`
    : "";
  return `<w:p><w:pPr>${jc}${spacing}${border}</w:pPr>${runsXml}</w:p>`;
}

function docxRun(
  text: string,
  opts: { bold?: boolean; italic?: boolean; sizeHalfPt?: number; color?: string } = {}
): string {
  const b = opts.bold ? "<w:b/>" : "";
  const i = opts.italic ? "<w:i/>" : "";
  const sz = `<w:sz w:val="${opts.sizeHalfPt ?? 21}"/><w:szCs w:val="${opts.sizeHalfPt ?? 21}"/>`;
  const color = opts.color ? `<w:color w:val="${opts.color}"/>` : "";
  const font = `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>`;
  return `<w:r><w:rPr>${font}${b}${i}${sz}${color}</w:rPr><w:t xml:space="preserve">${escapeXml(
    text
  )}</w:t></w:r>`;
}

function buildSectionHeaderXml(title: string): string {
  return docxParagraph(
    docxRun(title.toUpperCase(), { bold: true, sizeHalfPt: 22, color: "1E293B" }),
    { spaceBefore: 180, spaceAfter: 80, bottomBorder: true }
  );
}

export function downloadResumeAsDocx(resume: StructuredResume, fileName: string) {
  const paragraphs: string[] = [];

  // 1. Candidate Name & Contact Info
  paragraphs.push(
    docxParagraph(
      docxRun(resume.fullName || "Candidate Name", {
        bold: true,
        sizeHalfPt: 34,
        color: "0F172A",
      }),
      { align: "center", spaceAfter: 60 }
    )
  );

  if (resume.contactInfo) {
    paragraphs.push(
      docxParagraph(
        docxRun(resume.contactInfo, { sizeHalfPt: 19, color: "475569" }),
        { align: "center", spaceAfter: 160, bottomBorder: true }
      )
    );
  }

  // 2. Professional Summary
  if (resume.summary) {
    paragraphs.push(buildSectionHeaderXml("Professional Summary"));
    paragraphs.push(
      docxParagraph(docxRun(resume.summary, { sizeHalfPt: 21 }), {
        spaceAfter: 120,
      })
    );
  }

  // 3. Technical Skills
  if (resume.skills.length > 0) {
    paragraphs.push(buildSectionHeaderXml("Technical Skills"));
    for (const group of resume.skills) {
      paragraphs.push(
        docxParagraph(
          docxRun(`${group.category}: `, { bold: true, sizeHalfPt: 21 }) +
            docxRun(group.items.join(", "), { sizeHalfPt: 21 }),
          { spaceAfter: 60 }
        )
      );
    }
  }

  // 4. Professional Experience
  if (resume.experience.length > 0) {
    paragraphs.push(buildSectionHeaderXml("Professional Experience"));
    for (const exp of resume.experience) {
      const meta = [exp.location, exp.dates].filter(Boolean).join(" | ");
      paragraphs.push(
        docxParagraph(
          docxRun(exp.role, { bold: true, sizeHalfPt: 22 }) +
            docxRun(` — ${exp.company}`, { bold: true, sizeHalfPt: 21, color: "334155" }) +
            (meta ? docxRun(`  (${meta})`, { italic: true, sizeHalfPt: 19, color: "64748B" }) : ""),
          { spaceBefore: 100, spaceAfter: 50 }
        )
      );
      for (const b of exp.bullets) {
        paragraphs.push(
          docxParagraph(docxRun(`•  ${b}`, { sizeHalfPt: 21 }), {
            spaceAfter: 50,
          })
        );
      }
    }
  }

  // 5. Projects
  if (resume.projects.length > 0) {
    paragraphs.push(buildSectionHeaderXml("Projects"));
    for (const proj of resume.projects) {
      paragraphs.push(
        docxParagraph(
          docxRun(proj.name, { bold: true, sizeHalfPt: 22 }) +
            (proj.techStack
              ? docxRun(`  |  ${proj.techStack}`, {
                  italic: true,
                  sizeHalfPt: 19,
                  color: "475569",
                })
              : ""),
          { spaceBefore: 80, spaceAfter: 50 }
        )
      );
      for (const b of proj.bullets) {
        paragraphs.push(
          docxParagraph(docxRun(`•  ${b}`, { sizeHalfPt: 21 }), {
            spaceAfter: 50,
          })
        );
      }
    }
  }

  // 6. Education
  if (resume.education.length > 0) {
    paragraphs.push(buildSectionHeaderXml("Education"));
    for (const edu of resume.education) {
      paragraphs.push(
        docxParagraph(
          docxRun(edu.degree || edu.institution, { bold: true, sizeHalfPt: 21 }) +
            (edu.degree ? docxRun(` — ${edu.institution}`, { sizeHalfPt: 21 }) : "") +
            (edu.dates ? docxRun(` (${edu.dates})`, { italic: true, sizeHalfPt: 19, color: "64748B" }) : "") +
            (edu.details ? docxRun(` | ${edu.details}`, { sizeHalfPt: 19 }) : ""),
          { spaceAfter: 60 }
        )
      );
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const blob = buildZipArchive([
    { name: "[Content_Types].xml", content: contentTypesXml },
    { name: "_rels/.rels", content: relsXml },
    { name: "word/document.xml", content: documentXml },
  ]);

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".docx") ? fileName : `${fileName}.docx`;
  link.click();
  URL.revokeObjectURL(url);
}
