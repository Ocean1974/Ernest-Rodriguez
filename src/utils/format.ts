export function formatCurrency(value: string | number | null | undefined): string {
  const numericValue = Number.parseFloat(String(value ?? 0));
  return Number.isFinite(numericValue)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(numericValue)
    : "$0";
}

export function formatInteger(value: string | number | null | undefined): string {
  const numericValue = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(numericValue) ? new Intl.NumberFormat("en-US").format(numericValue) : "0";
}
