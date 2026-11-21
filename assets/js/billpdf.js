/* Download a bill sheet as a real PDF file (bill page and admin page share this). */
(function (w) {
  'use strict';
  w.SelviBillPdf = {
    download: function (sheet, no, btn, fallback) {
      if (!w.html2canvas || !w.jspdf) { if (fallback) fallback(); return Promise.resolve(); }
      var old = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Preparing PDF\u2026'; }
      return w.html2canvas(sheet, { scale: 2, backgroundColor: '#ffffff', useCORS: true, windowWidth: 1000,
        onclone: function (doc) { var el = doc.getElementById(sheet.id); if (el) { el.style.boxShadow = 'none'; el.style.borderRadius = '0'; el.style.maxWidth = 'none'; el.style.width = '794px'; el.style.margin = '0'; } } })
        .then(function (canvas) {
          var pdf = new w.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
          var pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight(), m = 24;
          var width = pw - 2 * m, pageH = ph - 2 * m, scale = width / canvas.width, sliceH = Math.floor(pageH / scale), y = 0, first = true;
          while (y < canvas.height) {
            var h = Math.min(sliceH, canvas.height - y), part = document.createElement('canvas');
            part.width = canvas.width; part.height = h;
            part.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
            if (!first) pdf.addPage();
            pdf.addImage(part.toDataURL('image/jpeg', 0.95), 'JPEG', m, m, width, h * scale);
            y += h; first = false;
          }
          pdf.save('Selvi-Fireworks-Bill-' + no + '.pdf');
        }).catch(function () { if (fallback) fallback(); })
        .then(function () { if (btn) { btn.disabled = false; btn.textContent = old; } });
    }
  };
})(window);
