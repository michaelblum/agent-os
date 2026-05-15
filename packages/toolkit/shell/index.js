import { attributeParts, escapeHtml } from '../controls/_html.js';

function classAttribute(...classes) {
  return classes.flat().filter(Boolean).join(' ');
}

function renderElement(tag, baseClassName, props = {}) {
  const {
    content = '',
    className = '',
    attributes = {},
    dataset = {},
    rawAttributes = [],
  } = props;
  const classes = classAttribute(baseClassName, className);
  const attrs = attributeParts({
    attributes: {
      ...attributes,
      ...(classes ? { class: classes } : {}),
    },
    dataset,
    rawAttributes,
  });
  return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${content}</${tag}>`;
}

export function renderWorkbenchToolbar(props = {}) {
  return renderElement(props.tag || 'div', 'aos-workbench-toolbar', props);
}

export function renderWorkbenchToolbarSection(props = {}) {
  return renderElement(props.tag || 'section', 'aos-workbench-toolbar-section', props);
}

export function renderWorkbenchReadout(props = {}) {
  const { label = '', value = '', content = '', rawAttributes = [] } = props;
  const body = content || [
    label ? `<strong>${escapeHtml(label)}</strong>` : '',
    value ? ` ${escapeHtml(value)}` : '',
  ].join('');
  return renderElement(props.tag || 'span', props.baseClassName || 'toolbar-readout', {
    ...props,
    content: body,
    rawAttributes,
  });
}

export function renderWorkbenchPaneHeader(props = {}) {
  const { title = '', subtitle = '', actions = '', content = '' } = props;
  const body = content || [
    '<div>',
    title ? `<h2>${escapeHtml(title)}</h2>` : '',
    subtitle ? `<span>${escapeHtml(subtitle)}</span>` : '',
    '</div>',
    actions,
  ].join('');
  return renderElement(props.tag || 'header', props.baseClassName || 'pane-header', {
    ...props,
    content: body,
  });
}

export function renderWorkbenchSectionTitle(props = {}) {
  const { title = '', content = '' } = props;
  return renderElement(props.tag || 'div', props.baseClassName || 'aos-workbench-section-title', {
    ...props,
    content: content || escapeHtml(title),
  });
}

export function renderWorkbenchStatusBar(props = {}) {
  return renderElement(props.tag || 'footer', props.baseClassName || 'aos-workbench-status', props);
}

export function renderWorkbenchSummaryRows(props = {}) {
  const {
    rows = [],
    rowClassName = 'aos-workbench-summary-row',
    labelTag = 'span',
    valueTag = 'strong',
    wrapperTag = '',
    baseClassName = '',
    className = '',
    content = '',
  } = props;
  const body = content || rows.map(([label, value]) => (
    `<div class="${escapeHtml(rowClassName)}"><${labelTag}>${escapeHtml(label)}</${labelTag}><${valueTag}>${escapeHtml(value)}</${valueTag}></div>`
  )).join('');
  if (!wrapperTag) return body;
  return renderElement(wrapperTag, baseClassName, { ...props, className, content: body });
}
