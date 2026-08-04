export type Category = 'shopping' | 'medical' | 'transport' | 'disaster';

export const CATEGORY_LABELS: Record<Category, string> = {
  shopping: '買い物',
  medical: '医療',
  transport: '交通',
  disaster: '災害',
};

export const WARD = '新宿区';

export interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
}

export interface Facility {
  id: number;
  category: Category;
  name: string;
  lat: number;
  lon: number;
  address: string;
  distanceM: number;
  source: string;
  updatedAt: string;
}

export interface Rule {
  id: number;
  category: Category;
  ward: string;
  title: string;
  body: string;
  source: string;
  sourceUrl: string;
  updatedAt: string;
}

export interface AskRequest {
  address: string;
  category: Category;
}

export interface AskResponse {
  answer: string;
  location: GeocodeResult;
  facilities: Facility[];
  rules: Rule[];
}
