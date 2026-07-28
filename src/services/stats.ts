export interface DashboardStats {
  inspections: number | null
  defects: number | null
  turbines: number | null
  accuracy: number | null
}

export function getMockStats(): DashboardStats {
  return {
    inspections: null,
    defects: null,
    turbines: null,
    accuracy: null,
  }
}
