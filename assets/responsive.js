/* =====================================================================
   EduOne - responsive.js
   1) Convierte las tablas .table-modern en "tarjetas" en celular
      (agrega data-label a cada celda, incluso a las filas que se
      generan después con JS/Firebase).
   2) Acordeón para las asignaturas del estudiante.
   ===================================================================== */
(function () {
  'use strict';

  var MAX_COLS = 8; // tablas más anchas (ej. planilla de notas) conservan scroll horizontal

  function prepararTabla(table) {
    if (table.hasAttribute('data-no-stack') || table.classList.contains('planilla-table')) return;
    var ths = table.querySelectorAll('thead th');
    if (!ths.length || ths.length > MAX_COLS) return;

    var etiquetas = Array.prototype.map.call(ths, function (th) {
      return (th.textContent || '').replace(/\s+/g, ' ').trim();
    });

    table.classList.add('rs-stack');
    var filas = table.querySelectorAll('tbody tr');
    for (var r = 0; r < filas.length; r++) {
      var i = 0;
      var celdas = filas[r].children;
      for (var c = 0; c < celdas.length; c++) {
        var td = celdas[c];
        if (td.tagName !== 'TD') continue;
        if (!td.hasAttribute('data-label')) {
          td.setAttribute('data-label', td.hasAttribute('colspan') ? '' : (etiquetas[i] || ''));
        }
        i += td.colSpan || 1;
      }
    }
  }

  function procesar() {
    var tablas = document.querySelectorAll('table.table-modern');
    for (var t = 0; t < tablas.length; t++) prepararTabla(tablas[t]);
  }

  var pendiente = false;
  function programar() {
    if (pendiente) return;
    pendiente = true;
    (window.requestAnimationFrame || setTimeout)(function () { pendiente = false; procesar(); });
  }

  function iniciar() {
    procesar();
    new MutationObserver(programar).observe(document.body, { childList: true, subtree: true });

    // Acordeón de asignaturas (delegación: el HTML se genera dinámicamente)
    document.addEventListener('click', function (e) {
      var head = e.target.closest && e.target.closest('.asignatura-bloque-header.acordeon');
      if (!head) return;
      var bloque = head.closest('.asignatura-bloque');
      if (bloque) bloque.classList.toggle('abierto');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var head = e.target.closest && e.target.closest('.asignatura-bloque-header.acordeon');
      if (!head) return;
      e.preventDefault();
      head.click();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
