export type SourceLabel = "LIVE" | "ESTIMATED" | "ROAMWISE RECOMMENDED" | "FALLBACK";

export interface DataSourceMetadata {
  provider: string;
  data_type: string;
  retrieved_at: string | null;
  freshness: string;
  is_live: boolean;
  label: SourceLabel;
}

export function liveSource(
  provider: string,
  dataType: string,
  retrievedAt: string
): DataSourceMetadata {
  return {
    provider,
    data_type: dataType,
    retrieved_at: retrievedAt,
    freshness: "current",
    is_live: true,
    label: "LIVE",
  };
}

export function estimatedSource(
  dataType: string,
  retrievedAt: string | null = null
): DataSourceMetadata {
  return {
    provider: "Roamwise",
    data_type: dataType,
    retrieved_at: retrievedAt,
    freshness: "estimated",
    is_live: false,
    label: "ESTIMATED",
  };
}

export function recommendedSource(dataType: string): DataSourceMetadata {
  return {
    provider: "Roamwise",
    data_type: dataType,
    retrieved_at: null,
    freshness: "decision engine",
    is_live: false,
    label: "ROAMWISE RECOMMENDED",
  };
}

export function fallbackSource(dataType: string, retrievedAt: string | null = null): DataSourceMetadata {
  return {
    provider: "Roamwise",
    data_type: dataType,
    retrieved_at: retrievedAt,
    freshness: "provider unavailable",
    is_live: false,
    label: "FALLBACK",
  };
}