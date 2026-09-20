import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

/**
 * Renders a DOM node (the receipt card) to a PNG and PDF. Both live here
 * so PaymentReceipt.tsx can offer "user decides how they want to export"
 * without duplicating the canvas-capture step for each format — capture
 * once, branch on output type.
 *
 * scale:2 matches typical device pixel ratios so the exported image isn't
 * soft/blurry when shared to WhatsApp at full size.
 */
async function captureNode(node: HTMLElement): Promise<HTMLCanvasElement> {
  return html2canvas(node, {
    scale: 2,
    backgroundColor: null,   // preserves the receipt's own light/dark background rather than forcing white
    useCORS: true,
  })
}

export async function exportReceiptAsPng(node: HTMLElement, filename: string): Promise<void> {
  const canvas = await captureNode(node)
  const link = document.createElement('a')
  link.download = `${filename}.png`
  link.href = canvas.toDataURL('image/png', 1.0)
  link.click()
}

export async function exportReceiptAsPdf(node: HTMLElement, filename: string): Promise<void> {
  const canvas = await captureNode(node)
  const imgData = canvas.toDataURL('image/png', 1.0)

  // Size the PDF page to the receipt's own aspect ratio (tall, receipt-like)
  // rather than forcing it onto a fixed A4 — a wide gutter of white space
  // around a narrow receipt looks like an export bug, not a real document.
  const widthMm = 100
  const heightMm = (canvas.height / canvas.width) * widthMm

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [widthMm, heightMm],
  })
  pdf.addImage(imgData, 'PNG', 0, 0, widthMm, heightMm)
  pdf.save(`${filename}.pdf`)
}

/**
 * Web Share API where supported (mobile browsers, installed PWA) — shares
 * the receipt as an actual image file, not just a text link, so it drops
 * straight into WhatsApp/Instagram the way a real receipt screenshot
 * would. Falls back to a plain PNG download when navigator.share (or
 * file-sharing support specifically) isn't available — most desktop
 * browsers as of this writing.
 */
export async function shareReceipt(node: HTMLElement, filename: string): Promise<'shared' | 'downloaded'> {
  const canvas = await captureNode(node)
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 1.0))
  if (!blob) throw new Error('Could not generate receipt image')

  const file = new File([blob], `${filename}.png`, { type: 'image/png' })

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'MonieKing Receipt' })
      return 'shared'
    } catch (err) {
      // User cancelled the native share sheet — not an error, just no-op.
      if ((err as Error)?.name === 'AbortError') return 'downloaded'
      throw err
    }
  }

  // Fallback: trigger a download so there's still SOME way to get the
  // receipt out of the browser on platforms without file-sharing support.
  const link = document.createElement('a')
  link.download = `${filename}.png`
  link.href = URL.createObjectURL(blob)
  link.click()
  URL.revokeObjectURL(link.href)
  return 'downloaded'
}
