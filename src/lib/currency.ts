export function parseBudget(value: string | null | undefined) {
  if (!value) return 0
  const normalized = value.replace(/,/g, '')
  const match = normalized.match(/-?\d+(?:\.\d+)?/)
  if (!match) return 0
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeCurrencyCode(value: string | null | undefined) {
  const code = (value || 'USD').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : 'USD'
}

export function formatMoney(value: number, currencyCode: string | null | undefined) {
  const currency = normalizeCurrencyCode(currencyCode)
  try {
    return new Intl.NumberFormat(currency === 'PHP' ? 'en-PH' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${Math.round(value).toLocaleString('en-US')}`
  }
}

export function formatLeadBudget(budget: string | null | undefined, currencyCode: string | null | undefined) {
  if (!budget) return '—'
  const value = parseBudget(budget)
  return value ? formatMoney(value, currencyCode) : '—'
}

export function budgetTotalsByCurrency<T extends { budget: string | null; currency_code: string | null | undefined }>(rows: T[]) {
  const totals = new Map<string, number>()
  rows.forEach((row) => {
    const value = parseBudget(row.budget)
    if (!value) return
    const currency = normalizeCurrencyCode(row.currency_code)
    totals.set(currency, (totals.get(currency) || 0) + value)
  })
  return totals
}

export function formatCurrencyTotals(totals: Map<string, number>) {
  if (!totals.size) return '—'
  return [...totals.entries()]
    .sort(([a], [b]) => {
      if (a === 'USD') return -1
      if (b === 'USD') return 1
      return a.localeCompare(b)
    })
    .map(([currency, total]) => `${formatMoney(total, currency)} ${currency}`)
    .join(' · ')
}
