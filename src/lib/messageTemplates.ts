export type TemplateVariableKey =
  | 'lead.first_name'
  | 'lead.name'
  | 'lead.company'
  | 'lead.email'
  | 'lead.routing_status'
  | 'workspace.company_name'
  | 'workspace.website_url'
  | 'workspace.sender_name'
  | 'workspace.reply_to_email'
  | 'workspace.email_signature'

export type MessageTemplateContext = {
  lead: {
    first_name: string
    name: string
    company: string
    email: string
    routing_status: string
  }
  workspace: {
    company_name: string
    website_url: string
    sender_name: string
    reply_to_email: string
    email_signature: string
  }
}

export const TEMPLATE_VARIABLES: { key: TemplateVariableKey; label: string; group: 'Lead' | 'Workspace' }[] = [
  { key: 'lead.first_name', label: 'Lead first name', group: 'Lead' },
  { key: 'lead.name', label: 'Lead full name', group: 'Lead' },
  { key: 'lead.company', label: 'Lead company', group: 'Lead' },
  { key: 'lead.email', label: 'Lead email', group: 'Lead' },
  { key: 'lead.routing_status', label: 'Lead routing status', group: 'Lead' },
  { key: 'workspace.company_name', label: 'Company name', group: 'Workspace' },
  { key: 'workspace.website_url', label: 'Company website', group: 'Workspace' },
  { key: 'workspace.sender_name', label: 'Sender name', group: 'Workspace' },
  { key: 'workspace.reply_to_email', label: 'Reply-to email', group: 'Workspace' },
  { key: 'workspace.email_signature', label: 'Email signature', group: 'Workspace' },
]

const ALLOWED_VARIABLES = new Set<TemplateVariableKey>(TEMPLATE_VARIABLES.map((item) => item.key))
const VARIABLE_PATTERN = /{{\s*([a-zA-Z0-9_.]+)\s*}}/g

function valueForKey(context: MessageTemplateContext, key: TemplateVariableKey) {
  const [scope, field] = key.split('.') as ['lead' | 'workspace', string]
  return String((context[scope] as Record<string, string>)[field] || '')
}

export function extractTemplateVariables(template: string) {
  const variables: string[] = []
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    if (!variables.includes(match[1])) variables.push(match[1])
  }
  return variables
}

export function validateMessageTemplate(template: string) {
  const unknownVariables = extractTemplateVariables(template).filter(
    (key) => !ALLOWED_VARIABLES.has(key as TemplateVariableKey),
  )

  const withoutRecognizedTokens = template.replace(VARIABLE_PATTERN, '')
  const malformedToken = withoutRecognizedTokens.includes('{{') || withoutRecognizedTokens.includes('}}')

  return {
    valid: unknownVariables.length === 0 && !malformedToken,
    unknownVariables,
    malformedToken,
  }
}

export function renderTemplateText(template: string, context: MessageTemplateContext) {
  const validation = validateMessageTemplate(template)
  if (!validation.valid) {
    const reason = validation.unknownVariables.length
      ? `Unknown template variable: ${validation.unknownVariables.join(', ')}`
      : 'Malformed template variable.'
    throw new Error(reason)
  }

  return template.replace(VARIABLE_PATTERN, (_match, rawKey: string) => {
    const key = rawKey as TemplateVariableKey
    return valueForKey(context, key)
  })
}

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function renderTemplateHtml(template: string, context: MessageTemplateContext) {
  return escapeHtml(renderTemplateText(template, context)).replace(/\r?\n/g, '<br />')
}

export function firstNameFromName(name: string | null | undefined) {
  return (name || '').trim().split(/\s+/)[0] || 'there'
}

export const SAMPLE_TEMPLATE_CONTEXT: MessageTemplateContext = {
  lead: {
    first_name: 'Jordan',
    name: 'Jordan Lee',
    company: 'Northstar Studio',
    email: 'jordan@example.com',
    routing_status: 'Hot',
  },
  workspace: {
    company_name: 'Your company',
    website_url: 'https://yourcompany.com',
    sender_name: 'Your team',
    reply_to_email: 'hello@yourcompany.com',
    email_signature: 'Best,\nYour team',
  },
}
