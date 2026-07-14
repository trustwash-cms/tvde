import type { EventContentArg } from '@fullcalendar/core';
import type { CalendarEventRecord } from './calendar-types';
import { appendInvoiceStatusBadge, getCalendarInvoiceUi } from './calendar-invoice-ui';

function readRawEvent(arg: EventContentArg): CalendarEventRecord | undefined {
  return arg.event.extendedProps?.raw as CalendarEventRecord | undefined;
}

export function buildCalendarEventContent(arg: EventContentArg) {
  if (!arg.isStart) {
    return { domNodes: [] };
  }

  const raw = readRawEvent(arg);
  const invoiceUi = getCalendarInvoiceUi(raw);

  if (arg.view.type === 'dayGridMonth') {
    const row = document.createElement('div');
    row.className = 'fc-month-event';

    const dot = document.createElement('span');
    dot.className = 'fc-month-event__dot';
    if (invoiceUi?.completed) {
      dot.classList.add('fc-month-event__dot--completed');
    } else if (invoiceUi?.failed) {
      dot.classList.add('fc-month-event__dot--failed');
    }
    dot.style.backgroundColor =
      invoiceUi?.completed
        ? '#22c55e'
        : invoiceUi?.failed
          ? '#ef4444'
          : (arg.event.backgroundColor ?? arg.event.borderColor ?? 'var(--color-primary)');
    row.appendChild(dot);

    const titleEl = document.createElement('span');
    titleEl.className = 'fc-month-event__title';
    titleEl.textContent = arg.event.title;
    row.appendChild(titleEl);

    if (invoiceUi) {
      appendInvoiceStatusBadge(row, invoiceUi);
    }

    return { domNodes: [row] };
  }

  const wrap = document.createElement('div');
  wrap.className = 'fc-apple-event';

  if (!arg.event.allDay && arg.timeText) {
    const timeEl = document.createElement('div');
    timeEl.className = 'fc-apple-event__time';
    timeEl.textContent = arg.timeText;
    wrap.appendChild(timeEl);
  }

  const titleRow = document.createElement('div');
  titleRow.className = 'fc-apple-event__title-row';

  const titleEl = document.createElement('div');
  titleEl.className = 'fc-apple-event__title';
  titleEl.textContent = arg.event.title;
  titleRow.appendChild(titleEl);

  if (invoiceUi) {
    appendInvoiceStatusBadge(titleRow, invoiceUi);
  }

  wrap.appendChild(titleRow);

  return { domNodes: [wrap] };
}
