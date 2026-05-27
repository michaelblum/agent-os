// modal.js — shared modal helpers for Studio flows.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderFields(fields = []) {
  return fields.map((field) => {
    const attrs = [];
    if (field.pattern) attrs.push(`pattern="${escapeHtml(field.pattern)}"`);
    if (field.placeholder) attrs.push(`placeholder="${escapeHtml(field.placeholder)}"`);
    return `
      <label>${escapeHtml(field.label)}</label>
      <input data-key="${escapeHtml(field.key)}" value="${escapeHtml(field.value ?? '')}" ${attrs.join(' ')}>
    `;
  }).join('');
}

export function showFormModal({ title, fields = [], confirmLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const host = document.getElementById('modal-host');
    host.innerHTML = `
      <div class="modal">
        <h3>${escapeHtml(title)}</h3>
        ${renderFields(fields)}
        <div class="buttons">
          <button data-act="cancel">Cancel</button>
          <button data-act="ok" class="primary ${danger ? 'danger' : ''}">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    host.hidden = false;

    const firstInput = host.querySelector('input');
    firstInput?.focus();
    firstInput?.select();

    const onClick = (e) => {
      const act = e.target?.dataset?.act;
      if (act === 'cancel') close(null);
      if (act === 'ok') {
        const values = {};
        for (const input of host.querySelectorAll('input')) {
          values[input.dataset.key] = input.value.trim();
        }
        close(values);
      }
    };

    host.addEventListener('click', onClick);

    function close(result) {
      host.hidden = true;
      host.innerHTML = '';
      host.removeEventListener('click', onClick);
      resolve(result);
    }
  });
}

export function showChoiceModal({ title, message = '', choices = [] }) {
  return new Promise((resolve) => {
    const host = document.getElementById('modal-host');
    const buttons = choices.map((choice) => (
      `<button data-choice="${escapeHtml(choice.value)}" class="${choice.primary ? 'primary' : ''} ${choice.danger ? 'danger' : ''}">${escapeHtml(choice.label)}</button>`
    )).join('');
    host.innerHTML = `
      <div class="modal">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="buttons">${buttons}</div>
      </div>
    `;
    host.hidden = false;

    const onClick = (e) => {
      const value = e.target?.dataset?.choice;
      if (!value) return;
      close(value);
    };

    host.addEventListener('click', onClick);

    function close(result) {
      host.hidden = true;
      host.innerHTML = '';
      host.removeEventListener('click', onClick);
      resolve(result);
    }
  });
}
