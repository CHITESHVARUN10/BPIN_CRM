import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'
import { createArrayCsvStringifier } from 'csv-writer'
import { formatDateLabel } from './dates.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'BL Logo.png')

const CSV_HEADER = ['S.No', 'Token No', 'Date', 'Technician', 'Region', 'Brand', 'Model (SKU)', 'Description', 'Serial Number', 'Vehicle', 'Customer Reported', 'Problem', 'Details', 'Images count', 'Videos count']

function recordBrand(record) {
  return record.productSnapshot?.category === 'ROCKFORD FOSGATE' ? 'Rockford Fosgate' : 'Blaupunkt'
}

export function recordCsvRow(record, index) {
  const details = record.problem?.isOther
    ? `Other: ${record.problem?.otherDescription || ''}${record.notes ? ` | ${record.notes}` : ''}`
    : (record.notes || '')
  const vehicle = [record.vehicle?.make, record.vehicle?.model].filter(Boolean).join(' ')
  const photos = (record.images || []).filter((m) => m.kind !== 'video').length
  const videos = (record.images || []).filter((m) => m.kind === 'video').length
  return [
    String(index + 1),
    record.tokenNo,
    formatDateLabel(record.visitDate),
    record.technician?.name || 'Unknown',
    record.technician?.region || '',
    recordBrand(record),
    record.productSnapshot?.sku || '',
    record.productSnapshot?.description || '',
    record.serialNumber,
    vehicle,
    record.customerReport || '',
    record.problem?.name || '',
    details,
    String(photos),
    String(videos),
  ]
}

export function buildRecordCsv(records) {
  const csv = createArrayCsvStringifier({ header: CSV_HEADER })
  return '\ufeff' + csv.getHeaderString() + csv.stringifyRecords(records.map(recordCsvRow)) + '\n'
}

function clip(text, max) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

const PDF_COLS = [
  { key: 'token', label: 'Token', width: 95 },
  { key: 'date', label: 'Date', width: 62 },
  { key: 'technician', label: 'Technician', width: 125 },
  { key: 'sku', label: 'Model (SKU)', width: 130 },
  { key: 'problem', label: 'Problem', width: 110 },
  { key: 'serial', label: 'Serial', width: 120 },
]

export async function buildRecordPdf(records, { from, to }, res) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40, bufferPages: true })
  const filename = `bpin-report-${from ? formatDateLabel(from) : 'all'}-${to ? formatDateLabel(to) : ''}.pdf`
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  doc.pipe(res)

  const drawPageHeader = () => {
    if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, 40, 36, { fit: [130, 26] })
    else doc.text('BLAUPUNKT', 40, 36)
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#111111').text('BPIN Service Report', 270, 36, { continued: false, lineGap: 2 })
    doc.font('Helvetica').fontSize(9).fillColor('#555555')
    const rangeText = from && to ? `${formatDateLabel(from)} – ${formatDateLabel(to)}` : 'All time'
    doc.text(`Range: ${rangeText}    Records: ${records.length}    Generated: ${new Date().toLocaleString()}`, 270, 58)
    doc.moveTo(40, 76).lineTo(doc.page.width - 40, 76).strokeColor('#e5e5e5').stroke()
    doc.font('Helvetica').fontSize(9)
  }

  const drawTableHeader = (y) => {
    doc.rect(40, y, doc.page.width - 80, 16).fill('#171717')
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff')
    let x = 46
    for (const col of PDF_COLS) {
      doc.text(col.label, x, y + 4, { width: col.width - 8, height: 10 })
      x += col.width
    }
    return y + 16
  }

  const start = () => new Promise((resolve) => {
    drawPageHeader()
    let y = drawTableHeader(84)
    if (!records.length) {
      doc.font('Helvetica').fontSize(10).fillColor('#666666').text('No records in this range.', 40, y + 12)
    } else {
      doc.font('Helvetica').fontSize(8.5)
      for (let i = 0; i < records.length; i++) {
        const record = records[i]
        const values = {
          token: clip(record.tokenNo, 22),
          date: formatDateLabel(record.visitDate),
          technician: clip(record.technician?.name, 30),
          sku: clip(record.productSnapshot?.sku, 32),
          problem: clip(record.problem?.name, 34),
          serial: clip(record.serialNumber, 32),
        }
        const rowH = 18
        if (y + rowH > doc.page.height - 40) {
          doc.addPage()
          drawPageHeader()
          y = drawTableHeader(84)
        }
        if (i % 2 === 1) doc.rect(40, y, doc.page.width - 80, rowH).fill('#f5f5f5').fillColor('#111111')
        else doc.fillColor('#111111')
        let x = 46
        for (const col of PDF_COLS) {
          doc.text(values[col.key], x, y + 5, { width: col.width - 8, height: rowH - 6, ellipsis: true })
          x += col.width
        }
        doc.strokeColor('#ececec').moveTo(40, y + rowH).lineTo(doc.page.width - 40, y + rowH).stroke()
        y += rowH
      }
    }
    doc.end()
    doc.on('end', resolve)
  })

  let first = true
  doc.on('pageAdded', () => {
    if (first) {
      first = false
      return
    }
    drawPageHeader()
  })

  await start()
}
