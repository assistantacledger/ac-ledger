/**
 * Opens a new blank browser window containing the inner HTML of `element`,
 * then triggers the print dialog and closes the window.
 *
 * This avoids the "blank page" issue that occurs when window.print() is called
 * in a React app shell (sidebar, overlays, etc. get included or the target
 * content is hidden behind CSS transforms).
 */
export function printViaNewWindow(element: HTMLElement, title: string = 'Print') {
  const printWin = window.open('', '_blank')
  if (!printWin) {
    // Fallback if pop-up was blocked
    window.print()
    return
  }

  printWin.document.write(
    `<!DOCTYPE html><html><head>` +
    `<meta charset="utf-8">` +
    `<title>${title}</title>` +
    `<style>` +
    `* { box-sizing: border-box; }` +
    `body { margin: 0; padding: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }` +
    `@page { size: A4; margin: 0; }` +
    `</style>` +
    `</head><body>${element.innerHTML}</body></html>`
  )
  printWin.document.close()
  printWin.focus()
  setTimeout(() => {
    printWin.print()
    printWin.close()
  }, 500)
}
